"""
Pull the printed labels, and where they sit, out of a floor-plan PDF.

`pdf-to-svg.py` keeps the drawing and throws the type away, which is right for
an image but loses the only thing that says which shape is room 143. The plans
letter every hall and meeting room, so reading the text back with its position
lets each shape be matched to the room it is.

Positions are the text matrix's translation in page points, y up from the
bottom-left corner, which is the space the SVG's paths are written in too.

    python3 scripts/plan-labels.py plans/icc-level-1.pdf plans/icc-level-1.labels.json
"""
import json
import re
import sys
import zlib

NUM = r'[-+]?[0-9]*\.?[0-9]+'
STRING = r'\((?:[^()\\]|\\.)*\)'

# The plans set their labels in WinAnsi-encoded simple fonts, so a byte is a
# character. \n and friends are PDF string escapes, not part of the label.
ESCAPES = {'n': '\n', 'r': '\r', 't': '\t', 'b': '\b', 'f': '\f'}


def content_streams(data: bytes) -> str:
    """Every /Contents stream of the first page, concatenated in order."""
    objs = {}
    for m in re.finditer(rb'(\d+)\s+\d+\s+obj', data):
        objs[int(m.group(1))] = data[m.end(): data.find(b'endobj', m.end())]

    order = []
    for body in objs.values():
        if b'/Type/Page' in body[:400] and b'/Contents' in body:
            many = re.search(rb'/Contents\s*\[([^\]]*)\]', body)
            if many:
                order = [int(n) for n in re.findall(rb'(\d+)\s+\d+\s+R', many.group(1))]
            else:
                one = re.search(rb'/Contents\s+(\d+)\s+\d+\s+R', body)
                order = [int(one.group(1))] if one else []
            break

    parts = []
    for num in order:
        body = objs.get(num, b'')
        at = re.search(rb'stream\r?\n', body)
        if not at:
            continue
        try:
            parts.append(zlib.decompress(body[at.end(): body.rfind(b'endstream')]))
        except zlib.error:
            pass
    return b'\n'.join(parts).decode('latin-1')


def unescape(raw: str) -> str:
    out, i = [], 0
    while i < len(raw):
        if raw[i] == '\\' and i + 1 < len(raw):
            octal = re.match(r'[0-7]{1,3}', raw[i + 1:])
            if octal:
                out.append(chr(int(octal.group(0), 8)))
                i += 1 + len(octal.group(0))
                continue
            out.append(ESCAPES.get(raw[i + 1], raw[i + 1]))
            i += 2
            continue
        out.append(raw[i])
        i += 1
    return ''.join(out)


def mul(a, b):
    """PDF matrices: [a b c d e f]."""
    return [
        a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
        a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
        a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
    ]


def labels(path: str) -> list[dict]:
    content = content_streams(open(path, 'rb').read())
    tokens = re.findall(
        r'(' + NUM + r')|/([A-Za-z0-9#._-]+)|(\[.*?\])|(' + STRING + r')|([A-Za-z*\'"]+)',
        content, re.S)

    ctm = [1, 0, 0, 1, 0, 0]
    text = line = [1, 0, 0, 1, 0, 0]
    stack, operands, found = [], [], []

    def emit(value: str) -> None:
        value = value.strip()
        if value:
            placed = mul(text, ctm)
            found.append({'text': value, 'x': round(placed[4], 2), 'y': round(placed[5], 2)})

    for num, name, arr, string, op in tokens:
        if num:
            operands.append(float(num))
        elif name or arr or string:
            operands.append(name or arr or string)
        else:
            nums = [v for v in operands if isinstance(v, float)]
            strings = [v for v in operands if isinstance(v, str)]

            if op == 'q':
                stack.append(ctm[:])
            elif op == 'Q':
                if stack:
                    ctm = stack.pop()
            elif op == 'cm' and len(nums) >= 6:
                ctm = mul(nums[-6:], ctm)
            elif op == 'BT':
                text = line = [1, 0, 0, 1, 0, 0]
            elif op == 'Tm' and len(nums) >= 6:
                text = line = nums[-6:]
            elif op in ('Td', 'TD') and len(nums) >= 2:
                text = line = mul([1, 0, 0, 1, nums[-2], nums[-1]], line)
            elif op == 'T*':
                text = line = mul([1, 0, 0, 1, 0, -1], line)
            elif op in ('Tj', "'", '"') and strings:
                emit(unescape(strings[-1][1:-1]))
            elif op == 'TJ' and strings:
                emit(''.join(unescape(run[1:-1])
                             for run in re.findall(STRING, strings[-1])))
            operands = []

    return found


def main() -> None:
    found = labels(sys.argv[1])
    json.dump(found, open(sys.argv[2], 'w'), indent=1)
    print(f'{sys.argv[2]}: {len(found)} labels')


if __name__ == '__main__':
    main()
