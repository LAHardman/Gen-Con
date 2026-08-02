"""
Georeference a floor plan against the venue's real OpenStreetMap footprint.

The plan and the footprint are the same building drawn twice, so the alignment
is whatever scale and offset make them overlap best. Searching for that is more
reliable than trying to identify corresponding corners by eye.
"""
import json, math, sys

M_LAT = 111320.0


def load_plan(path, drop_below=540, drop_left=300):
    """Building pixels, minus the legend swatches in the bottom-left corner."""
    rows = open(path).read().split('\n')
    pts = []
    for y, row in enumerate(rows):
        if not row:
            continue
        for x, ch in enumerate(row):
            if ch != '1':
                continue
            if y > drop_below and x < drop_left:
                continue
            pts.append((x, y))
    return pts, len(rows[0]), len(rows)


def load_footprint(venue):
    ring = venue['footprint']
    nw_lat = max(p[0] for p in ring)
    nw_lng = min(p[1] for p in ring)
    m_lng = M_LAT * math.cos(nw_lat * math.pi / 180)
    return [((lng - nw_lng) * m_lng, (nw_lat - lat) * M_LAT) for lat, lng in ring]


def inside(x, y, poly):
    hit = False
    n = len(poly)
    for i in range(n):
        ax, ay = poly[i]
        bx, by = poly[i - 1]
        if (ay > y) != (by > y) and x < (bx - ax) * (y - ay) / (by - ay) + ax:
            hit = not hit
    return hit


def main():
    venues = json.load(open('venue-footprints.json'))
    venue = next(v for v in venues if v['venueId'] == 'icc')
    poly = load_footprint(venue)
    W_M, H_M = venue['anchor']['widthMetres'], venue['anchor']['heightMetres']

    plan_pts, PW, PH = load_plan(sys.argv[1])
    plan = set((x // 6, y // 6) for x, y in plan_pts)          # 6 px cells

    STEP = 3.0                                                  # metres per cell
    osm = set()
    y = 0.0
    while y < H_M:
        x = 0.0
        while x < W_M:
            if inside(x, y, poly):
                osm.add((int(x // STEP), int(y // STEP)))
            x += STEP
        y += STEP

    def score(s, ox, oy):
        """Intersection over union of the two building masks, in metre cells."""
        mapped = set()
        for px, py in plan:
            mapped.add((int(((px * 6 - ox) * s) // STEP),
                        int(((py * 6 - oy) * s) // STEP)))
        inter = len(mapped & osm)
        return inter / (len(mapped) + len(osm) - inter)

    best = None
    # Coarse to fine around the ratio of the two bounding boxes.
    ranges = [(0.40, 0.85, 0.025, -300, 100, 25, -200, 150, 25),
              (None, None, 0.005, None, None, 5, None, None, 5),
              (None, None, 0.001, None, None, 1.5, None, None, 1.5)]
    for lo, hi, ds, oxlo, oxhi, dox, oylo, oyhi, doy in ranges:
        if lo is None:
            lo, hi = best[1] - 4 * ds, best[1] + 4 * ds
            oxlo, oxhi = best[2] - 4 * dox, best[2] + 4 * dox
            oylo, oyhi = best[3] - 4 * doy, best[3] + 4 * doy
        s = lo
        while s <= hi:
            ox = oxlo
            while ox <= oxhi:
                oy = oylo
                while oy <= oyhi:
                    v = score(s, ox, oy)
                    if best is None or v > best[0]:
                        best = (v, s, ox, oy)
                    oy += doy
                ox += dox
            s += ds
        print(f'  pass: IoU {best[0]:.3f}  scale {best[1]:.4f} m/px  origin ({best[2]:.1f}, {best[3]:.1f}) px')

    iou, s, ox, oy = best
    # The image corner in metres from the footprint's north-west corner.
    left_m, top_m = (0 - ox) * s, (0 - oy) * s
    right_m, bottom_m = (PW - ox) * s, (PH - oy) * s

    nw_lat = max(p[0] for p in venue['footprint'])
    nw_lng = min(p[1] for p in venue['footprint'])
    m_lng = M_LAT * math.cos(nw_lat * math.pi / 180)

    result = {
        'iou': round(iou, 4),
        'metresPerPixel': round(s, 5),
        'imageSize': [PW, PH],
        'bounds': {
            'north': round(nw_lat - top_m / M_LAT, 7),
            'west': round(nw_lng + left_m / m_lng, 7),
            'south': round(nw_lat - bottom_m / M_LAT, 7),
            'east': round(nw_lng + right_m / m_lng, 7),
        },
    }
    print(json.dumps(result, indent=2))
    json.dump(result, open(sys.argv[2], 'w'), indent=2)


if __name__ == '__main__':
    main()
