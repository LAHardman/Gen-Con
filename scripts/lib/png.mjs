/**
 * Just enough PNG to read a floor plan back out of a screenshot.
 *
 * The venue plans are 8-bit non-interlaced PNGs, and the pipeline that reads
 * them needs raw pixels and nothing else — no scaling, no colour management.
 * A decoder for that is a hundred lines against Node's own zlib, which is a
 * better trade than a dependency for a script that runs by hand; the encoder
 * at the bottom is another fifty, and exists so tiles can be stitched back
 * into one sheet.
 */

import { deflateSync, inflateSync } from 'node:zlib';

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
      if (![1, 2, 4, 8].includes(depth)) throw new Error(`unsupported bit depth ${depth}`);
      if (depth !== 8 && colourType !== 0 && colourType !== 3) {
        throw new Error(`unsupported ${depth}-bit colour type ${colourType}`);
      }
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
  // Filtering works on bytes, so below one sample per byte the stride is one
  // byte, not one sample. Rows are padded out to a whole byte either way.
  const stride = Math.max(1, (channels * depth) / 8);
  const rowBytes = Math.ceil((width * channels * depth) / 8);
  const pixels = new Uint8Array(width * height * 4);

  /**
   * One sample, whatever it is packed as.
   *
   * Under eight bits a byte holds several, most significant first — which is
   * how a map tile of flat colour fields is usually written, and what Gen Con
   * serves: sixteen colours, four bits each. Greyscale is stretched to the full
   * range so 1-bit black and white reads as 0 and 255 rather than 0 and 1;
   * a palette index is an index and is left alone.
   */
  const sample = (line, at) => {
    if (depth === 8) return line[at];
    const perByte = 8 / depth;
    const value = (line[Math.floor(at / perByte)] >> (8 - depth * ((at % perByte) + 1))) & ((1 << depth) - 1);
    return colourType === 0 ? Math.round((value * 255) / ((1 << depth) - 1)) : value;
  };

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
        const index = sample(line, from);
        pixels[to] = palette[index * 3];
        pixels[to + 1] = palette[index * 3 + 1];
        pixels[to + 2] = palette[index * 3 + 2];
        pixels[to + 3] = alpha && index < alpha.length ? alpha[index] : 255;
      } else if (colourType === 0 || colourType === 4) {
        const grey = sample(line, from);
        pixels[to] = grey;
        pixels[to + 1] = grey;
        pixels[to + 2] = grey;
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

/**
 * The other direction, for stitching tiles back into one sheet.
 *
 * No filtering and no interlacing: the images this writes are read straight
 * back by the decoder above, and a floor plan of flat colour fields compresses
 * well enough without any of it.
 */
export function encodePng(width, height, pixels) {
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    Buffer.from(pixels.buffer, pixels.byteOffset + y * width * 4, width * 4)
      .copy(raw, y * (width * 4 + 1) + 1);
  }

  const table = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  const crc = (buffer) => {
    let c = 0xffffffff;
    for (const byte of buffer) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (kind, body) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(body.length);
    const named = Buffer.concat([Buffer.from(kind, 'ascii'), body]);
    const check = Buffer.alloc(4);
    check.writeUInt32BE(crc(named));
    return Buffer.concat([length, named, check]);
  };

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
