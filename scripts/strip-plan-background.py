"""
Make a floor plan transparent outside its building.

A plan is drawn to be read on paper, so it carries a page background and the
surrounding streets. Laid over a real map those cover the basemap with a grey
slab that doesn't match the streets underneath it, which reads as the plan
being misaligned even when it is placed correctly.

Dropping the fills that aren't part of the building leaves the rooms, corridors
and service areas floating on the real map, which is what an overlay should be.

The same goes for the printed legend, which is keyed to the paper drawing and
has nothing to say on a map. `--inside` drops anything lying wholly within a
box, given in viewBox coordinates — x1,y1,x2,y2 with y down from the top, the
way the plan is read. PDF pages are y-up, so the converter wraps its paths in a
flipping `<g>`; the box is converted through that flip before anything is
matched against it.

    python3 scripts/strip-plan-background.py public/floorplans/icc-level-1.svg \
        '#eeeeee' '#cccccc' --inside 0,550,240,650
"""
import re
import sys

COORD = re.compile(r'([-+]?\d*\.?\d+)\s+([-+]?\d*\.?\d+)')
FLIP = re.compile(r'<g transform="matrix\(1 0 0 -1 0 ([-+]?\d*\.?\d+)\)"')


def bounds(d: str) -> tuple[float, float, float, float] | None:
    points = [(float(a), float(b)) for a, b in COORD.findall(d)]
    if not points:
        return None
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return min(xs), min(ys), max(xs), max(ys)


def strip(svg: str, fills: set[str], box: tuple[float, ...] | None) -> tuple[str, int]:
    dropped = 0

    def replace(match: re.Match) -> str:
        nonlocal dropped
        if match.group(1).lower() in fills:
            dropped += 1
            return ''
        if box:
            extent = bounds(match.group(0))
            if extent and (
                extent[0] >= box[0] and extent[1] >= box[1]
                and extent[2] <= box[2] and extent[3] <= box[3]
            ):
                dropped += 1
                return ''
        return match.group(0)

    return re.sub(r'<path [^>]*fill="([^"]*)"[^>]*/>\n?', replace, svg), dropped


def main() -> None:
    args = sys.argv[1:]
    box = None
    if '--inside' in args:
        at = args.index('--inside')
        box = tuple(float(v) for v in args[at + 1].split(','))
        args = args[:at] + args[at + 2:]

    path, fills = args[0], {f.lower() for f in args[1:]}
    svg = open(path).read()

    flip = FLIP.search(svg)
    if box and flip:
        height = float(flip.group(1))
        box = (box[0], height - box[3], box[2], height - box[1])

    out, dropped = strip(svg, fills, box)
    open(path, 'w').write(out)
    print(f'{path}: dropped {dropped} paths, {len(out) // 1024} KB')


if __name__ == '__main__':
    main()
