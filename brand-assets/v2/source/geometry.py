"""onspot v2: exact geometry for the app icons (squircle and circle outline), the mark and the logos.

    python3 geometry.py [OUT_DIR]   # needs numpy and scipy; default OUT_DIR: ./out

Writes the SVGs that were pasted into ../onspot-brand.vectorcraft, one per artboard, and prints the
solved module. The VectorCraft document is the editable source; this script is the derivation.

Units: the canvas is 1024 px = 192 grid units (Material's product-icon grid); the mark is built
on one module, m = the waveform bar width.
"""
import math
import os
import re
import sys

import numpy as np
from scipy.spatial import cKDTree

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(sys.argv[1]) if __name__ == '__main__' and len(sys.argv) > 1 else os.path.join(HERE, 'out')

CANVAS = 1024
GRID = 192
UNIT = CANVAS / GRID
CENTRE = CANVAS / 2

CIRCLE_KEYLINE = 176 * UNIT    # Material product-icon circle: 176 of 192
SQUIRCLE_KEYLINE = 160 * UNIT  # the squircle with the circle's area (5/6 of the canvas)

# Mark proportions (module units).
BAR_HEIGHTS = (3, 5, 8, 5, 3)
BAR_PITCH = 2.5
ELLIPSE_ASPECT = 6   # lamp and pool are 1:6 ellipses, one consistent view of round shapes
LAMP = 9             # lamp : pool = 1 : 2
POOL = 18
THROW = 12           # lamp centre to pool centre; the beam widens 3 m every 8 m on each side
WAVE_AXIS = THROW - max(BAR_HEIGHTS) / 2  # the tallest bar stands on the pool's centre line

STROKE = 0.75     # outline width, m
CLEARANCE = 1.0   # outline's inner edge to the mark, m

# Two versions and no colour: everything is drawn in one ink, white for dark mode and black for light
# mode. The beam fades from the lamp to the pool (stops at 0, 1/2, 1) and the pool fades from its
# centre (stops at 0, 1), by opacity alone. Black on white reads stronger than white on black, so
# light mode fades further; at these values the lamp stays distinct from the beam and the bars from
# the cone behind them in both.
MODES = {
    'dark': {'ink': '#ffffff', 'beam': (0.6, 0.24, 0.06), 'pool': (0.45, 0.1)},
    'light': {'ink': '#000000', 'beam': (0.45, 0.18, 0.04), 'pool': (0.35, 0.08)},
}

V1_TILE = "M383.414 100 L640.586 100 C722.193 100 762.997 100 799.794 112.143 L806.921 113.888 C854.878 131.344 892.656 169.122 910.112 217.079 L911.857 224.206 C924 261.003 924 301.807 924 383.414 L924 640.586 C924 722.193 924 762.997 911.857 799.794 L910.112 806.921 C892.656 854.878 854.878 892.656 806.921 910.112 L799.794 911.857 C762.997 924 722.193 924 640.586 924 L383.414 924 C301.807 924 261.003 924 224.206 911.857 L217.079 910.112 C169.122 892.656 131.344 854.878 113.888 806.921 L112.143 799.794 C100 762.997 100 722.193 100 640.586 L100 383.414 C100 301.807 100 261.003 112.143 224.206 L113.888 217.079 C131.344 169.122 169.122 131.344 217.079 113.888 L224.206 112.143 C261.003 100 301.807 100 383.414 100 Z"
V1_TILE_SIDE = 824


def fmt(v: float) -> str:
    s = f'{v:.3f}'.rstrip('0').rstrip('.')
    return '0' if s == '-0' else s


# ------------------------------------------------------------------ squircle

def squircle_path(side: float, cx: float = CENTRE, cy: float = CENTRE) -> str:
    """v1's continuous-corner tile (Apple's macOS body, corner 0.225 of the side) at another size."""
    k = side / V1_TILE_SIDE
    toks = re.findall(r'[MLCZ]|-?\d+\.?\d*', V1_TILE)
    out, i = [], 0
    while i < len(toks):
        if toks[i] in 'MLCZ':
            out.append(toks[i])
            i += 1
            continue
        x, y = float(toks[i]), float(toks[i + 1])
        out.append(f'{fmt(cx + (x - 512) * k)} {fmt(cy + (y - 512) * k)}')
        i += 2
    return ' '.join(out)


def sample_path(d: str, per_curve: int = 400) -> np.ndarray:
    toks = re.findall(r'[MLCZ]|-?\d+\.?\d*', d)
    pts, i, cur = [], 0, None
    while i < len(toks):
        t = toks[i]
        if t in 'ML':
            nxt = np.array([float(toks[i + 1]), float(toks[i + 2])])
            if cur is not None:
                for u in np.linspace(0, 1, 40)[1:]:
                    pts.append(cur + (nxt - cur) * u)
            else:
                pts.append(nxt)
            cur = nxt
            i += 3
        elif t == 'C':
            p = [np.array([float(toks[i + 1 + 2 * k]), float(toks[i + 2 + 2 * k])]) for k in range(3)]
            for u in np.linspace(0, 1, per_curve)[1:]:
                pts.append((1 - u) ** 3 * cur + 3 * (1 - u) ** 2 * u * p[0] + 3 * (1 - u) * u ** 2 * p[1] + u ** 3 * p[2])
            cur = p[2]
            i += 7
        else:
            i += 1
    return np.array(pts)


def polygon_area(P: np.ndarray) -> float:
    x, y = P[:, 0], P[:, 1]
    return 0.5 * abs(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))


# ------------------------------------------------------------------ the mark

def mark_outline_points(n: int = 6000) -> np.ndarray:
    """The mark's silhouette (lamp and pool ellipses; the beam is their hull), lamp centre at 0."""
    t = np.linspace(0, 2 * math.pi, n, endpoint=False)
    lamp = np.c_[LAMP / 2 * np.cos(t), LAMP / 2 / ELLIPSE_ASPECT * np.sin(t)]
    pool = np.c_[POOL / 2 * np.cos(t), THROW + POOL / 2 / ELLIPSE_ASPECT * np.sin(t)]
    return np.vstack([lamp, pool])


def tangent_points():
    """Right-hand common tangent of lamp and pool. Stretching y by the aspect turns both
    ellipses into circles, whose outer tangent is exact; the stretch maps it back."""
    a1, a2, k = LAMP / 2, POOL / 2, ELLIPSE_ASPECT
    distance = THROW * k
    ny = -(a2 - a1) / distance
    nx = math.sqrt(1 - ny * ny)
    return (a1 * nx, a1 * ny / k), (a2 * nx, THROW + a2 * ny / k)


MARK_POINTS = mark_outline_points()


def silhouette_centroid() -> float:
    """Distance from the lamp centre down to the centre of area of the mark's silhouette (m)."""
    from scipy.spatial import ConvexHull
    hull = MARK_POINTS[ConvexHull(MARK_POINTS).vertices]
    x, y = hull[:, 0], hull[:, 1]
    cross = x * np.roll(y, -1) - np.roll(x, -1) * y
    return float(((y + np.roll(y, -1)) * cross).sum() / (3 * cross.sum()))


CENTROID = silhouette_centroid()
LAMP_OFFSET = -CENTROID  # the lamp centre sits this far from the canvas centre (m): centre of area on the centre


def largest_m(shape: str) -> float:
    """The largest module that keeps the mark 1 m clear of the outline's inner edge."""
    if shape == 'circle':
        reach = np.hypot(MARK_POINTS[:, 0], MARK_POINTS[:, 1] + LAMP_OFFSET).max()
        return (CIRCLE_KEYLINE / 2) / (reach + STROKE + CLEARANCE)

    def fits(m):
        tree = cKDTree(sample_path(squircle_path(SQUIRCLE_KEYLINE - STROKE * m)))
        P = MARK_POINTS * m + np.array([CENTRE, CENTRE + LAMP_OFFSET * m])
        return tree.query(P)[0].min() / m - STROKE / 2 >= CLEARANCE

    lo, hi = 25.0, 50.0
    for _ in range(50):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if fits(mid) else (lo, mid)
    return lo


# ------------------------------------------------------------------ SVG

def gradient_defs(prefix: str, x: float, lamp_y: float, pool_y: float, m: float, mode: str) -> str:
    ink, style = MODES[mode]['ink'], MODES[mode]
    beam = ''.join(f'\n      <stop offset="{o}" stop-color="{ink}" stop-opacity="{a}"/>' for o, a in zip((0, 0.5, 1), style['beam']))
    pool = ''.join(f'\n      <stop offset="{o}" stop-color="{ink}" stop-opacity="{a}"/>' for o, a in zip((0, 1), style['pool']))
    r = POOL / 2 * m
    return (
        f'    <linearGradient id="{prefix}beam" x1="{fmt(x)}" y1="{fmt(lamp_y)}" x2="{fmt(x)}" y2="{fmt(pool_y)}" gradientUnits="userSpaceOnUse">{beam}\n    </linearGradient>\n'
        f'    <radialGradient id="{prefix}pool" cx="0" cy="0" r="{fmt(r)}" gradientTransform="matrix(1 0 0 {fmt(1 / ELLIPSE_ASPECT)} {fmt(x)} {fmt(pool_y)})" gradientUnits="userSpaceOnUse">{pool}\n    </radialGradient>\n'
    )


def bar_path(cx: float, cy: float, h: float, m: float) -> str:
    """A bar with round caps as a path (half-circle caps drawn as two quarter arcs each)."""
    r = m / 2
    top, bottom = cy - h / 2, cy + h / 2
    return (f'M{fmt(cx)} {fmt(top)} A{fmt(r)} {fmt(r)} 0 0 1 {fmt(cx + r)} {fmt(top + r)} '
            f'L{fmt(cx + r)} {fmt(bottom - r)} A{fmt(r)} {fmt(r)} 0 0 1 {fmt(cx)} {fmt(bottom)} '
            f'A{fmt(r)} {fmt(r)} 0 0 1 {fmt(cx - r)} {fmt(bottom - r)} L{fmt(cx - r)} {fmt(top + r)} '
            f'A{fmt(r)} {fmt(r)} 0 0 1 {fmt(cx)} {fmt(top)} Z')


def beam_silhouette(m: float, x: float, lamp_y: float) -> str:
    """The mark's silhouette: the convex hull of lamp and pool, edged by their common tangents."""
    a1, a2 = LAMP / 2 * m, POOL / 2 * m
    b1, b2 = a1 / ELLIPSE_ASPECT, a2 / ELLIPSE_ASPECT
    (t1x, t1y), (t2x, t2y) = tangent_points()
    t1x, t1y, t2x, t2y = t1x * m, lamp_y + t1y * m, t2x * m, lamp_y + t2y * m
    return (f'M{fmt(x + t1x)} {fmt(t1y)} L{fmt(x + t2x)} {fmt(t2y)} '
            f'A{fmt(a2)} {fmt(b2)} 0 1 1 {fmt(x - t2x)} {fmt(t2y)} '
            f'L{fmt(x - t1x)} {fmt(t1y)} A{fmt(a1)} {fmt(b1)} 0 0 1 {fmt(x + t1x)} {fmt(t1y)} Z')


def mark_group(prefix: str, m: float, x: float, lamp_y: float, mode: str, indent: str = '    ') -> tuple[str, float]:
    ink = MODES[mode]['ink']
    a1, a2 = LAMP / 2 * m, POOL / 2 * m
    b1, b2 = a1 / ELLIPSE_ASPECT, a2 / ELLIPSE_ASPECT
    pool_y = lamp_y + THROW * m
    beam = beam_silhouette(m, x, lamp_y)
    axis = lamp_y + WAVE_AXIS * m
    lines = [
        f'{indent}<g id="{prefix}mark" data-name="Mark (m = {fmt(m)})">',
        f'{indent}  <path id="{prefix}beam-shape" data-name="Beam (tangent hull of lamp and pool)" d="{beam}" fill="url(#{prefix}beam)"/>',
        f'{indent}  <ellipse id="{prefix}pool-shape" data-name="Pool (18 m x 3 m)" cx="{fmt(x)}" cy="{fmt(pool_y)}" rx="{fmt(a2)}" ry="{fmt(b2)}" fill="url(#{prefix}pool)"/>',
        f'{indent}  <ellipse id="{prefix}lamp" data-name="Lamp (9 m x 1.5 m)" cx="{fmt(x)}" cy="{fmt(lamp_y)}" rx="{fmt(a1)}" ry="{fmt(b1)}" fill="{ink}"/>',
    ]
    n = len(BAR_HEIGHTS)
    for i, h in enumerate(BAR_HEIGHTS):
        bx = x + (i - (n - 1) / 2) * BAR_PITCH * m
        lines.append(f'{indent}  <path id="{prefix}bar-{i + 1}" data-name="Bar {i + 1} ({h} m)" d="{bar_path(bx, axis, h * m, m)}" fill="{ink}"/>')
    lines.append(f'{indent}</g>')
    return '\n'.join(lines), pool_y


def outline_element(prefix: str, shape: str, m: float, cx: float, cy: float, mode: str, indent='    ') -> str:
    w = STROKE * m
    ink = MODES[mode]['ink']
    if shape == 'circle':
        return (f'{indent}<circle id="{prefix}outline" data-name="Outline (circle keyline 176/192, stroke 0.75 m)" '
                f'cx="{fmt(cx)}" cy="{fmt(cy)}" r="{fmt(CIRCLE_KEYLINE / 2 - w / 2)}" fill="none" stroke="{ink}" stroke-width="{fmt(w)}"/>')
    return (f'{indent}<path id="{prefix}outline" data-name="Outline (squircle keyline 160/192, stroke 0.75 m)" '
            f'd="{squircle_path(SQUIRCLE_KEYLINE - w, cx, cy)}" fill="none" stroke="{ink}" stroke-width="{fmt(w)}"/>')


SOLVED = {}


def solved():
    """One mark for both outlines: the module that fits the tighter of the two."""
    if 'm' not in SOLVED:
        SOLVED['fits'] = {s: float(largest_m(s)) for s in ('squircle', 'circle')}
        SOLVED['m'] = min(SOLVED['fits'].values())
    return SOLVED['m'], LAMP_OFFSET


def icon_svg(shape: str, mode: str, view: str = 'canvas') -> str:
    m, offset = solved()
    prefix = f'{shape}-{mode}-'
    lamp_y = CENTRE + offset * m
    group, pool_y = mark_group(prefix, m, CENTRE, lamp_y, mode)
    keyline = CIRCLE_KEYLINE if shape == 'circle' else SQUIRCLE_KEYLINE
    if view == 'canvas':
        vb = f'0 0 {CANVAS} {CANVAS}'
        size = fmt(CANVAS)
    else:  # cropped to the keyline, for favicons and inline use
        o = CENTRE - keyline / 2
        vb = f'{fmt(o)} {fmt(o)} {fmt(keyline)} {fmt(keyline)}'
        size = fmt(keyline)
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="{vb}">
  <title>onspot app icon ({shape} outline, {mode} mode)</title>
  <defs>
{gradient_defs(prefix, CENTRE, lamp_y, pool_y, m, mode)}  </defs>
  <g id="{prefix}app-icon" data-name="App icon ({shape}, {mode} mode)">
{outline_element(prefix, shape, m, CENTRE, CENTRE, mode)}
{group}
  </g>
</svg>
'''


# ------------------------------------------------------------------ wordmark and logos

V1_LOGO = os.path.join(HERE, '..', '..', 'v1', 'logo.svg')
V1_WORD_S = 13.8       # v1 logo: stroke s = 3m/5 with m = 23
V1_WORD_BASELINE = 811  # v1: x-height 742–811 (pool bottom 673 + 3 m)
WORD_X_HEIGHT = 5       # m: bars 2 and 4, so the letter stroke (x-height / 5) is the bar width
WORD_GAP = 2.5          # m: outline's outer edge to the first letter (the bar pitch)


def v1_wordmark():
    svg = open(V1_LOGO).read()
    paths = {pid: re.search(r'<path id="%s" d="([^"]+)"' % pid, svg).group(1) for pid in ('on', 'spot')}
    left = min(sample_path(paths['on'])[:, 0].min(), sample_path(paths['spot'])[:, 0].min())
    right = max(sample_path(paths['on'])[:, 0].max(), sample_path(paths['spot'])[:, 0].max())
    return paths, left, right


def transform_path(d: str, k: float, ox: float, oy: float, nx: float, ny: float) -> str:
    """Scale an absolute M/L/C/Z path by k about (ox, oy), moving that point to (nx, ny)."""
    toks = re.findall(r'[MLCZ]|-?\d*\.?\d+(?:e-?\d+)?', d)
    out, i, coord = [], 0, 0
    for t in toks:
        if t in 'MLCZ':
            out.append(t)
            continue
        v = float(t)
        out.append(fmt(nx + (v - ox) * k) if coord % 2 == 0 else fmt(ny + (v - oy) * k))
        coord += 1
    return re.sub(r' (?=[MLCZ])', ' ', ' '.join(out))


def logo_svg(shape: str, mode: str) -> str:
    m, offset = solved()
    prefix = f'logo-{shape}-{mode}-'
    ink = MODES[mode]['ink']
    keyline = CIRCLE_KEYLINE if shape == 'circle' else SQUIRCLE_KEYLINE
    lamp_y = CENTRE + offset * m
    group, pool_y = mark_group(prefix, m, CENTRE, lamp_y, mode)
    paths, left, right = v1_wordmark()
    s = WORD_X_HEIGHT * m / 5
    k = s / V1_WORD_S
    word_left = CENTRE + keyline / 2 + WORD_GAP * m
    word_right = word_left + (right - left) * k
    baseline = lamp_y + (WAVE_AXIS + WORD_X_HEIGHT / 2) * m  # x-height centred on the wave's axis
    on = transform_path(paths['on'], k, left, V1_WORD_BASELINE, word_left, baseline)
    spot = transform_path(paths['spot'], k, left, V1_WORD_BASELINE, word_left, baseline)
    x0, y0 = CENTRE - keyline / 2, CENTRE - keyline / 2
    width, height = word_right - x0, keyline
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="{fmt(width)}" height="{fmt(height)}" viewBox="{fmt(x0)} {fmt(y0)} {fmt(width)} {fmt(height)}">
  <title>onspot logo ({shape} outline, {mode} mode)</title>
  <defs>
{gradient_defs(prefix, CENTRE, lamp_y, pool_y, m, mode)}  </defs>
  <g id="{prefix}logo" data-name="Logo ({shape}, {mode} mode)">
{outline_element(prefix, shape, m, CENTRE, CENTRE, mode)}
{group}
    <g id="{prefix}wordmark" data-name="Wordmark (s = m, x-height 5 m on the wave axis)">
      <path id="{prefix}on" data-name="on" d="{on}" fill="{ink}"/>
      <path id="{prefix}spot" data-name="spot" d="{spot}" fill="{ink}"/>
    </g>
  </g>
</svg>
'''


def mark_svg(mode: str) -> str:
    """The mark alone, cropped to its bounds (18 m x 14.25 m)."""
    m, _ = solved()
    prefix = f'mark-{mode}-'
    top = LAMP / 2 / ELLIPSE_ASPECT * m
    lamp_y = top
    group, pool_y = mark_group(prefix, m, POOL / 2 * m, lamp_y, mode)
    width = POOL * m
    height = top + THROW * m + POOL / 2 / ELLIPSE_ASPECT * m
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="{fmt(width)}" height="{fmt(height)}" viewBox="0 0 {fmt(width)} {fmt(height)}">
  <title>onspot mark ({mode} mode)</title>
  <defs>
{gradient_defs(prefix, POOL / 2 * m, lamp_y, pool_y, m, mode)}  </defs>
{group}
</svg>
'''


# ------------------------------------------------------------------ glyph

# One shape in one ink, for any context: no gradients and no opacity. Light is the space between
# the beam's edges; the lamp and the pool (the spot) are solid, and the wave stands on the spot.
# The beam's edges are the silhouette's own boundary, 0.75 m wide (the outline's width), so the
# glyph has exactly the mark's silhouette and fits its outlines like the icons.
GLYPH_EDGE = STROKE
GLYPH_DIP = 0.25  # m: the gap the ground leaves around a bar that stands in it; minimal, a quarter bar
GLYPH_INK = '#000000'  # drawing ink; the published SVGs use currentColor


def ellipse_path(cx: float, cy: float, rx: float, ry: float) -> str:
    """An ellipse as path data (two half arcs), so it can share one path with other shapes."""
    return (f'M{fmt(cx - rx)} {fmt(cy)} A{fmt(rx)} {fmt(ry)} 0 1 0 {fmt(cx + rx)} {fmt(cy)} '
            f'A{fmt(rx)} {fmt(ry)} 0 1 0 {fmt(cx - rx)} {fmt(cy)} Z')


def glyph_frame(shape: str):
    """(m, mark centre x, lamp centre y, viewBox) for the glyph alone ('mark') or in an outline."""
    m, offset = solved()
    if shape == 'mark':
        top = LAMP / 2 / ELLIPSE_ASPECT * m
        height = top + THROW * m + POOL / 2 / ELLIPSE_ASPECT * m
        return m, POOL / 2 * m, top, f'0 0 {fmt(POOL * m)} {fmt(height)}'
    return m, CENTRE, CENTRE + offset * m, f'0 0 {CANVAS} {CANVAS}'


def glyph_shapes(shape: str, ink: str):
    """The glyph's parts as (name, path data): the lamp, the pool, the bars, and the dips (each bar that
    stands in the pool, widened by the gap the pool leaves around it); and its outline (for an icon)
    as a stroke element."""
    m, x, lamp_y, _ = glyph_frame(shape)
    a1, a2 = LAMP / 2 * m, POOL / 2 * m
    pool_y = lamp_y + THROW * m
    axis = lamp_y + WAVE_AXIS * m
    lamp = ('Lamp (9 m x 1.5 m)', ellipse_path(x, lamp_y, a1, a1 / ELLIPSE_ASPECT))
    pool = ('Pool (18 m x 3 m)', ellipse_path(x, pool_y, a2, a2 / ELLIPSE_ASPECT))
    n = len(BAR_HEIGHTS)
    bars, dips = [], []
    for i, h in enumerate(BAR_HEIGHTS):
        offset = (i - (n - 1) / 2) * BAR_PITCH  # m from the axis
        bx = x + offset * m
        bars.append((f'Bar {i + 1} ({h} m)', bar_path(bx, axis, h * m, m)))
        foot = WAVE_AXIS + h / 2                                                       # m below the lamp
        pool_top = THROW - POOL / 2 / ELLIPSE_ASPECT * math.sqrt(1 - (offset / (POOL / 2)) ** 2)
        if foot > pool_top:  # the bar stands in the pool: the pool dips around it
            gap = GLYPH_DIP * m
            dips.append((f'Dip (bar {i + 1} + {fmt(GLYPH_DIP)} m)', bar_path(bx, axis, h * m + 2 * gap, m + 2 * gap)))
    outline = None
    if shape != 'mark':
        w = STROKE * m
        if shape == 'circle':
            outline = f'<circle cx="{fmt(CENTRE)}" cy="{fmt(CENTRE)}" r="{fmt(CIRCLE_KEYLINE / 2 - w / 2)}" fill="none" stroke="{ink}" stroke-width="{fmt(w)}"/>'
        else:
            outline = f'<path d="{squircle_path(SQUIRCLE_KEYLINE - w)}" fill="none" stroke="{ink}" stroke-width="{fmt(w)}"/>'
    return m, beam_silhouette(m, x, lamp_y), lamp, pool, bars, dips, outline


def named(element: str, name: str) -> str:
    """Give an element an id and a data-name (VectorCraft's object name) after its tag."""
    slug = re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')
    return element.replace(' ', f' id="glyph-{slug}" data-name="{name}" ', 1)


def glyph_parts_svg(shape: str) -> str:
    """The glyph's parts before VectorCraft merges them into one shape: VectorCraft insets the
    silhouette by 0.75 m and subtracts the inset (leaving the beam's edges), subtracts the dips from
    the pool (the ground dips around the tallest bar, which stands in it, so the bar stays whole and
    apart from it), outlines the outline's stroke, and unites everything."""
    m, silhouette, lamp, pool, bars, dips, outline = glyph_shapes(shape, GLYPH_INK)
    *_, view_box = glyph_frame(shape)
    w, h = view_box.split()[2:]
    parts = [named(f'<path d="{silhouette}" fill="{GLYPH_INK}"/>', 'Silhouette (inset 0.75 m and subtract)')]
    parts += [named(f'<path d="{d}" fill="{GLYPH_INK}"/>', name) for name, d in [lamp, pool, *bars, *dips]]
    if outline:
        parts.append(named(outline, f'Outline ({shape})'))
    body = '\n  '.join(parts)
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="{view_box}">
  <title>onspot glyph parts ({shape})</title>
  {body}
</svg>
'''


def glyph_svg(shape: str, ink: str = GLYPH_INK, prefix: str = 'glyph-') -> str:
    """The glyph drawn exactly with SVG's own means, to check VectorCraft's merged shape against: the
    beam's edges are a 1.5 m stroke on the silhouette, clipped to it, so 0.75 m lies inside; the pool
    is clipped to everything but the dips."""
    m, silhouette, lamp, pool, bars, dips, outline = glyph_shapes(shape, ink)
    *_, view_box = glyph_frame(shape)
    vx, vy, w, h = view_box.split()
    everywhere = f'M{vx} {vy} h{w} v{h} h-{w} Z'
    outside_dips = ' '.join([everywhere] + [d for _, d in dips])
    bars_body = '\n  '.join(f'<path d="{d}" fill="{ink}"/>' for _, d in bars)
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="{view_box}">
  <title>onspot glyph ({shape})</title>
  <defs>
    <clipPath id="{prefix}{shape}-inside"><path d="{silhouette}"/></clipPath>
    <clipPath id="{prefix}{shape}-ground"><path d="{outside_dips}" clip-rule="evenodd"/></clipPath>
  </defs>
  <path d="{silhouette}" fill="none" stroke="{ink}" stroke-width="{fmt(2 * GLYPH_EDGE * m)}" clip-path="url(#{prefix}{shape}-inside)"/>
  <path d="{lamp[1]}" fill="{ink}"/>
  <path d="{pool[1]}" fill="{ink}" clip-path="url(#{prefix}{shape}-ground)"/>
  {bars_body}
  {outline or ''}
</svg>
'''


def write_all(out_dir: str) -> None:
    import construction
    os.makedirs(out_dir, exist_ok=True)
    files = {}
    for mode in MODES:
        for shape in ('squircle', 'circle'):
            files[f'app-icon-{shape}-{mode}.svg'] = icon_svg(shape, mode)
            files[f'app-icon-{shape}-{mode}-tile.svg'] = icon_svg(shape, mode, view='tile')
            files[f'logo-{shape}-{mode}.svg'] = logo_svg(shape, mode)
        files[f'mark-{mode}.svg'] = mark_svg(mode)
    for shape in ('mark', 'squircle', 'circle'):
        files[f'glyph-{shape}-parts.svg'] = glyph_parts_svg(shape)
        files[f'glyph-{shape}-check.svg'] = glyph_svg(shape)
    files['construction.svg'] = construction.construction_svg()
    for name, svg in files.items():
        with open(os.path.join(out_dir, name), 'w') as f:
            f.write(svg)
    m, offset = solved()
    fits = ', '.join(f'{shape} {value:.6f}' for shape, value in SOLVED['fits'].items())
    print(f'm = {m:.6f} px (the largest each outline allows: {fits})')
    print(f'lamp centre {offset:.6f} m from the canvas centre; centre of area {CENTROID:.6f} m below the lamp')
    print(f'wrote {len(files)} SVGs to {out_dir}')


if __name__ == '__main__':
    write_all(OUT)
