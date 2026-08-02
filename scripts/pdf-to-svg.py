"""
Convert the ICC floor-plan PDFs to SVG.

These are pure vector drawings — no raster images — so the whole plan survives
as paths. Only the operator subset the plans actually use is implemented.
"""
import re, sys, zlib

NUM = r'[-+]?[0-9]*\.?[0-9]+'


def content_streams(data):
    """The page's /Contents streams, concatenated in order."""
    objs = {}
    for m in re.finditer(rb'(\d+)\s+\d+\s+obj', data):
        num = int(m.group(1))
        start = m.end()
        end = data.find(b'endobj', start)
        objs[num] = data[start:end]

    order = []
    for num, body in objs.items():
        if b'/Type/Page' in body[:400] and b'/Contents' in body:
            refs = re.search(rb'/Contents\s*\[([^\]]*)\]', body)
            if refs:
                order = [int(n) for n in re.findall(rb'(\d+)\s+\d+\s+R', refs.group(1))]
            else:
                one = re.search(rb'/Contents\s+(\d+)\s+\d+\s+R', body)
                order = [int(one.group(1))] if one else []
            break

    out = []
    for num in order:
        body = objs.get(num, b'')
        sm = re.search(rb'stream\r?\n', body)
        if not sm:
            continue
        raw = body[sm.end(): body.rfind(b'endstream')]
        try:
            out.append(zlib.decompress(raw))
        except Exception:
            pass
    return b'\n'.join(out).decode('latin-1')


def mul(a, b):
    """PDF matrices: [a b c d e f]; result = a x b."""
    return [
        a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
        a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
        a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
    ]


def apply(m, x, y):
    return (m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5])


def rgb(parts):
    if len(parts) == 1:
        v = int(round(parts[0] * 255)); return f'#{v:02x}{v:02x}{v:02x}'
    if len(parts) == 3:
        r, g, b = (int(round(max(0.0, min(1.0, v)) * 255)) for v in parts)
        return f'#{r:02x}{g:02x}{b:02x}'
    if len(parts) == 4:
        c, m_, y_, k = parts
        r, g, b = ((1 - min(1.0, v + k)) for v in (c, m_, y_))
        return rgb([r, g, b])
    return '#000000'


def convert(path):
    data = open(path, 'rb').read()
    box = re.search(rb'/MediaBox\s*\[([^\]]*)\]', data).group(1).split()
    W, H = float(box[2]), float(box[3])
    content = content_streams(data)

    tokens = re.findall(
        r'(' + NUM + r')|/([A-Za-z0-9#._-]+)|(\[[^\]]*\])|(\([^)]*\))|([A-Za-z*\'"]+)',
        content)

    ctm = [1, 0, 0, 1, 0, 0]
    stack = []
    fill, stroke, width = '#000000', '#000000', 1.0
    operands, out, subpath, start_pt = [], [], [], None
    d_parts = []

    def flush(mode):
        nonlocal d_parts
        if d_parts:
            attrs = f'fill="{fill}"' if 'f' in mode else 'fill="none"'
            if 's' in mode:
                attrs += f' stroke="{stroke}" stroke-width="{max(width, 0.15):.2f}"'
            rule = ' fill-rule="evenodd"' if '*' in mode else ''
            out.append(f'<path {attrs}{rule} d="{" ".join(d_parts)}"/>')
        d_parts = []

    def moveto(x, y):
        px, py = apply(ctm, x, y)
        d_parts.append(f'M{px:.2f} {py:.2f}')
        return (x, y)

    for tok in tokens:
        num, name, arr, string, op = tok
        if num:
            operands.append(float(num)); continue
        if name or arr or string:
            operands.append(name or arr or string); continue

        nums = [v for v in operands if isinstance(v, float)]

        if op == 'q':
            stack.append((ctm[:], fill, stroke, width))
        elif op == 'Q':
            if stack: ctm, fill, stroke, width = stack.pop(); ctm = ctm[:]
        elif op == 'cm' and len(nums) >= 6:
            ctm = mul(nums[-6:], ctm)
        elif op == 'm' and len(nums) >= 2:
            start_pt = moveto(nums[-2], nums[-1])
        elif op == 'l' and len(nums) >= 2:
            px, py = apply(ctm, nums[-2], nums[-1]); d_parts.append(f'L{px:.2f} {py:.2f}')
        elif op == 'c' and len(nums) >= 6:
            pts = [apply(ctm, nums[i], nums[i + 1]) for i in (0, 2, 4)]
            d_parts.append('C' + ' '.join(f'{x:.2f} {y:.2f}' for x, y in pts))
        elif op in ('v', 'y') and len(nums) >= 4:
            pts = [apply(ctm, nums[i], nums[i + 1]) for i in (0, 2)]
            d_parts.append('Q' + ' '.join(f'{x:.2f} {y:.2f}' for x, y in pts))
        elif op == 're' and len(nums) >= 4:
            x, y, w, h = nums[-4:]
            corners = [(x, y), (x + w, y), (x + w, y + h), (x, y + h)]
            pts = [apply(ctm, cx, cy) for cx, cy in corners]
            d_parts.append('M' + ' L'.join(f'{px:.2f} {py:.2f}' for px, py in pts) + ' Z')
        elif op == 'h':
            d_parts.append('Z')
        elif op in ('f', 'F', 'f*'):
            flush('f*' if op == 'f*' else 'f')
        elif op in ('S', 's'):
            if op == 's': d_parts.append('Z')
            flush('s')
        elif op in ('B', 'B*', 'b', 'b*'):
            if op.startswith('b'): d_parts.append('Z')
            flush('fs*' if '*' in op else 'fs')
        elif op == 'n':
            d_parts = []
        elif op in ('rg', 'g', 'k'):
            fill = rgb(nums)
        elif op in ('RG', 'G', 'K'):
            stroke = rgb(nums)
        elif op in ('sc', 'scn'):
            if nums: fill = rgb(nums)
        elif op in ('SC', 'SCN'):
            if nums: stroke = rgb(nums)
        elif op == 'w' and nums:
            # Line width is in user space; scale it by the transform.
            scale = (abs(ctm[0]) + abs(ctm[3])) / 2 or 1
            width = nums[-1] * scale
        operands = []

    flush('f')
    body = '\n'.join(out)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:g} {H:g}" '
        f'width="{W:g}" height="{H:g}">\n'
        f'<g transform="matrix(1 0 0 -1 0 {H:g})">\n{body}\n</g>\n</svg>\n'
    )


if __name__ == '__main__':
    svg = convert(sys.argv[1])
    open(sys.argv[2], 'w').write(svg)
    print(f'{sys.argv[2]}: {len(svg)} bytes, {svg.count("<path")} paths')
