/**
 * Just enough PNG to read a floor plan back out of a screenshot.
 *
 * The venue plans are 8-bit non-interlaced PNGs, and the pipeline that reads
 * them needs raw pixels and nothing else — no scaling, no colour management, no
 * writing. A decoder for that is a hundred lines against Node's own zlib, which
 * is a better trade than a dependency for a script that runs by hand.
 */

import { inflateSync } from 'node:zlib';

/** Reverses one scanline's filter, in place, given the line above it. */
function unfilter(type, line, previous, stride) {
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let i = 0; i < line.length; i += 1) {
    const left = i >= stride ? line[i - stride] : 0;
    const up = previous ? previous[i] : 0;
    const upLeft = previous && i >= stride ? previous[i - stride] : 0;
    if (type === 1) line[i] = (line[i] + left) & 0xff;
    else if (type === 2) line[i] = (line[i] + up) & 0xff;
    else if (type === 3) line[i] = (line[i] + ((left + up) >> 1)) & 0xff;
    else if (type === 4) line[i] = (line[i] + paeth(left, up, upLeft)) & 0xff;
  }
}

/**
 * `{ width, height, pixels }` — pixels as RGBA, four bytes each, row by row.
 *
 * Throws on anything the plans aren't: 16-bit samples, interlacing, or a
 * colour type outside greyscale / RGB / palette / RGBA.
 */
export function decodePng(buffer) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (signature.some((byte, i) => buffer[i] !== byte)) throw new Error('not a PNG');

  let width = 0;
  let height = 0;
  let depth = 0;
  let colourType = 0;
  let palette = null;
  let alpha = null;
  const data = [];

  for (let at = 8; at + 8 <= buffer.length;) {
    const length = buffer.readUInt32BE(at);
    const kind = buffer.toString('ascii', at + 4, at + 8);
    const body = buffer.subarray(at + 8, at + 8 + length);
    at += 12 + length; // length, type, body, CRC

    if (kind === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8];
      colourType = body[9];
      if (depth !== 8) throw new Error(`unsupported bit depth ${depth}`);
      if (body[12] !== 0) throw new Error('interlaced PNGs are not supported');
    } else if (kind === 'PLTE') {
      palette = body;
    } else if (kind === 'tRNS') {
      alpha = body;
    } else if (kind === 'IDAT') {
      data.push(body);
    } else if (kind === 'IEND') {
      break;
    }
  }

  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colourType];
  if (!channels) throw new Error(`unsupported colour type ${colourType}`);

  const raw = inflateSync(Buffer.concat(data));
  const stride = channels;
  const rowBytes = width * channels;
  const pixels = new Uint8Array(width * height * 4);

  let previous = null;
  for (let y = 0; y < height; y += 1) {
    const start = y * (rowBytes + 1);
    const line = Uint8Array.prototype.slice.call(raw, start + 1, start + 1 + rowBytes);
    unfilter(raw[start], line, previous, stride);
    previous = line;

    for (let x = 0; x < width; x += 1) {
      const from = x * channels;
      const to = (y * width + x) * 4;
      if (colourType === 3) {
        const index = line[from];
        pixels[to] = palette[index * 3];
        pixels[to + 1] = palette[index * 3 + 1];
        pixels[to + 2] = palette[index * 3 + 2];
        pixels[to + 3] = alpha && index < alpha.length ? alpha[index] : 255;
      } else if (colourType === 0 || colourType === 4) {
        pixels[to] = line[from];
        pixels[to + 1] = line[from];
        pixels[to + 2] = line[from];
        pixels[to + 3] = colourType === 4 ? line[from + 1] : 255;
      } else {
        pixels[to] = line[from];
        pixels[to + 1] = line[from + 1];
        pixels[to + 2] = line[from + 2];
        pixels[to + 3] = colourType === 6 ? line[from + 3] : 255;
      }
    }
  }

  return { width, height, pixels };
}
