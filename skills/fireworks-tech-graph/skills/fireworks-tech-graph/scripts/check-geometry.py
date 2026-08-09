#!/usr/bin/env python3
"""Topology gate for orthogonal SVG diagrams.

Fail-closed checks (WES field practice, 2026-08):
  1. Connector-through-node penetration: sampled points of every external
     connector must never fall inside a non-adjacent container rect.
  2. Line-line crossing: horizontal vs vertical segment pairs must not
     strictly intersect.

Conventions:
  - Containers = <rect> elements carrying a filter attribute (shadowed nodes).
  - External connectors = <path> with marker-end and stroke-width >= 1.5.
    Internal chain arrows (stroke-width < 1.5) are excluded.
  - Only M/H/V path commands are accepted; other commands warn and skip.

Exit code 0 = gate passed; 1 = violations found.
Usage: python3 check-geometry.py <file.svg>
"""
import sys
import re
import xml.etree.ElementTree as ET

INSET = 3.0          # px margin when testing penetration
SAMPLES = 40         # samples per segment (ends trimmed)
MIN_EXT_STROKE = 1.5


def parse_segments(d):
    """Parse M/H/V-only path data into point list; None if non-orthogonal."""
    toks = re.findall(r"[A-Za-z]|-?\d*\.?\d+", d)
    pts, cx, cy, i = [], 0.0, 0.0, 0
    while i < len(toks):
        t = toks[i]
        if t == "M":
            cx, cy = float(toks[i + 1]), float(toks[i + 2])
            pts.append((cx, cy))
            i += 3
        elif t == "H":
            cx = float(toks[i + 1])
            pts.append((cx, cy))
            i += 2
        elif t == "V":
            cy = float(toks[i + 1])
            pts.append((cx, cy))
            i += 2
        else:
            return None
    return [(pts[k], pts[k + 1]) for k in range(len(pts) - 1)]


def main(path):
    # Hardened input gate: reject DTD/entity declarations (no untrusted expansion).
    with open(path, "rb") as f:
        raw = f.read()
    if b"<!DOCTYPE" in raw or b"<!ENTITY" in raw:
        print("GATE FAILED: DOCTYPE/ENTITY declarations are not allowed")
        sys.exit(1)
    root = ET.parse(path).getroot()
    rects, connectors = [], []
    for el in root.iter():
        tag = el.tag.split("}")[-1]
        if tag == "rect" and el.get("filter"):
            rects.append(tuple(float(el.get(a, 0)) for a in ("x", "y", "width", "height")))
        elif tag == "path" and el.get("marker-end"):
            if float(el.get("stroke-width", 1)) < MIN_EXT_STROKE:
                continue
            segs = parse_segments(el.get("d", ""))
            if segs is None:
                print("WARN non-orthogonal path skipped: %s..." % el.get("d", "")[:48])
                continue
            connectors.append((el.get("d"), segs))

    penetrations, crossings = [], []

    # 1. penetration: sampled interior points vs container rects
    for d, segs in connectors:
        for (x1, y1), (x2, y2) in segs:
            for ri, (rx, ry, rw, rh) in enumerate(rects):
                hit = False
                for s in range(4, SAMPLES - 3):
                    t = s / float(SAMPLES)
                    px, py = x1 + (x2 - x1) * t, y1 + (y2 - y1) * t
                    if rx + INSET < px < rx + rw - INSET and ry + INSET < py < ry + rh - INSET:
                        hit = True
                        break
                if hit:
                    penetrations.append((d, "rect#%d" % ri))

    # 2. crossing: horizontal vs vertical segment pairs
    horiz, vert = [], []
    for d, segs in connectors:
        for (x1, y1), (x2, y2) in segs:
            if y1 == y2 and x1 != x2:
                horiz.append((min(x1, x2), max(x1, x2), y1, d))
            elif x1 == x2 and y1 != y2:
                vert.append((x1, min(y1, y2), max(y1, y2), d))
    for hx0, hx1, hy, hd in horiz:
        for vx, vy0, vy1, vd in vert:
            if hd == vd:
                continue
            if hx0 < vx < hx1 and vy0 < hy < vy1:
                crossings.append((hd, vd))

    print("connectors=%d containers=%d penetrations=%d crossings=%d"
          % (len(connectors), len(rects), len(penetrations), len(crossings)))
    for item in penetrations:
        print("  PENETRATION", item)
    for item in crossings:
        print("  CROSSING", item)
    if penetrations or crossings:
        print("GATE FAILED")
        sys.exit(1)
    print("GATE PASSED")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(2)
    main(sys.argv[1])
