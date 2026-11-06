"""The v2 construction sheet: both icons on their grids, and the logo's alignment, with the palette."""
import math

import geometry as F

PANEL = 1400            # an icon canvas (1024) plus a 376 px label column
SHEET_W, SHEET_H = 3 * PANEL, 1024
# No colour here either: black drawing on white, guides in grey.
INK = '#000000'
GUIDE = '#7a7a7a'
SHEET = '#ffffff'
FONT = "'Noto Sans Mono', 'DejaVu Sans Mono', monospace"


def text(x, y, s, size=14, anchor='start', fill=INK, weight='normal'):
    s = s.replace('&', '&amp;').replace('<', '&lt;')
    return f'<text x="{F.fmt(x)}" y="{F.fmt(y)}" font-family="{FONT}" font-size="{size}" font-weight="{weight}" fill="{fill}" text-anchor="{anchor}">{s}</text>'


def line(x1, y1, x2, y2, stroke=GUIDE, width=1.5, dash=None, opacity=None):
    d = f' stroke-dasharray="{dash}"' if dash else ''
    o = f' stroke-opacity="{opacity}"' if opacity else ''
    return f'<line x1="{F.fmt(x1)}" y1="{F.fmt(y1)}" x2="{F.fmt(x2)}" y2="{F.fmt(y2)}" stroke="{stroke}" stroke-width="{width}"{d}{o}/>'


def icon_panel(shape: str, ox: float) -> str:
    m, offset = F.solved()
    keyline = F.CIRCLE_KEYLINE if shape == 'circle' else F.SQUIRCLE_KEYLINE
    c = F.CENTRE
    lamp_y = c + offset * m
    pool_y = lamp_y + F.THROW * m
    axis_y = lamp_y + F.WAVE_AXIS * m
    top_y = lamp_y - F.LAMP / 2 / F.ELLIPSE_ASPECT * m
    bottom_y = pool_y + F.POOL / 2 / F.ELLIPSE_ASPECT * m
    w = F.STROKE * m
    out = [f'<g id="construction-{shape}" data-name="App icon construction ({shape})" transform="translate({F.fmt(ox)} 0)">']

    # 192-unit grid, every 16 units (12 x 12), and the canvas.
    step = 16 * F.UNIT
    for i in range(13):
        out.append(line(i * step, 0, i * step, F.CANVAS, width=0.75, opacity=0.14))
        out.append(line(0, i * step, F.CANVAS, i * step, width=0.75, opacity=0.14))
    out.append(f'<rect x="0" y="0" width="{F.CANVAS}" height="{F.CANVAS}" fill="none" stroke="{INK}" stroke-width="0.75"/>')

    # The outline as drawn, its keyline (outer edge) and the clearance boundary (1 m inside its inner edge).
    if shape == 'circle':
        out.append(f'<circle cx="{c}" cy="{c}" r="{F.fmt(keyline / 2 - w / 2)}" fill="none" stroke="{INK}" stroke-width="{F.fmt(w)}" stroke-opacity="0.12"/>')
        out.append(f'<circle cx="{c}" cy="{c}" r="{F.fmt(keyline / 2)}" fill="none" stroke="{GUIDE}" stroke-width="1.5" stroke-dasharray="6 5"/>')
        out.append(f'<circle cx="{c}" cy="{c}" r="{F.fmt(keyline / 2 - w - F.CLEARANCE * m)}" fill="none" stroke="{GUIDE}" stroke-width="1.25" stroke-dasharray="2 3"/>')
    else:
        out.append(f'<path d="{F.squircle_path(keyline - w)}" fill="none" stroke="{INK}" stroke-width="{F.fmt(w)}" stroke-opacity="0.12"/>')
        out.append(f'<path d="{F.squircle_path(keyline)}" fill="none" stroke="{GUIDE}" stroke-width="1.5" stroke-dasharray="6 5"/>')
        out.append(f'<path d="{F.squircle_path(keyline - 2 * (w + F.CLEARANCE * m))}" fill="none" stroke="{GUIDE}" stroke-width="1.25" stroke-dasharray="2 3"/>')

    # Module grid over the mark's box (18 m x 14.25 m), on the lamp centre.
    left, right = c - F.POOL / 2 * m, c + F.POOL / 2 * m
    for k in range(int(F.POOL) + 1):
        out.append(line(left + k * m, top_y, left + k * m, bottom_y, width=0.75, opacity=0.3))
    j = math.ceil((top_y - lamp_y) / m)
    while lamp_y + j * m <= bottom_y:
        out.append(line(left, lamp_y + j * m, right, lamp_y + j * m, width=0.75, opacity=0.3))
        j += 1
    out.append(f'<rect x="{F.fmt(left)}" y="{F.fmt(top_y)}" width="{F.fmt(right - left)}" height="{F.fmt(bottom_y - top_y)}" fill="none" stroke="{GUIDE}" stroke-width="0.75" stroke-opacity="0.5"/>')

    # The mark in construction view.
    (t1x, t1y), (t2x, t2y) = F.tangent_points()
    a1, a2 = F.LAMP / 2 * m, F.POOL / 2 * m
    b1, b2 = a1 / F.ELLIPSE_ASPECT, a2 / F.ELLIPSE_ASPECT
    p1 = (t1x * m, lamp_y + t1y * m)
    p2 = (t2x * m, lamp_y + t2y * m)
    beam = (f'M{F.fmt(c + p1[0])} {F.fmt(p1[1])} L{F.fmt(c + p2[0])} {F.fmt(p2[1])} '
            f'A{F.fmt(a2)} {F.fmt(b2)} 0 1 1 {F.fmt(c - p2[0])} {F.fmt(p2[1])} '
            f'L{F.fmt(c - p1[0])} {F.fmt(p1[1])} A{F.fmt(a1)} {F.fmt(b1)} 0 0 1 {F.fmt(c + p1[0])} {F.fmt(p1[1])} Z')
    out.append(f'<path d="{beam}" fill="{INK}" fill-opacity="0.06" stroke="{INK}" stroke-width="0.75" stroke-opacity="0.35"/>')
    out.append(f'<ellipse cx="{c}" cy="{F.fmt(pool_y)}" rx="{F.fmt(a2)}" ry="{F.fmt(b2)}" fill="none" stroke="{INK}" stroke-width="1.5"/>')
    out.append(f'<ellipse cx="{c}" cy="{F.fmt(lamp_y)}" rx="{F.fmt(a1)}" ry="{F.fmt(b1)}" fill="#ffffff" stroke="{INK}" stroke-width="1.5"/>')
    # Beam edges are the common tangents; extended upwards to the canvas edge.
    slope = (p2[0] - p1[0]) / (p2[1] - p1[1])
    for sign in (1, -1):
        x_top = c + sign * (p1[0] + slope * (0 - p1[1]))
        out.append(line(c + sign * p2[0], p2[1], x_top, 0, dash='6 5', width=1.25))
    n = len(F.BAR_HEIGHTS)
    for i, h in enumerate(F.BAR_HEIGHTS):
        bx = c + (i - (n - 1) / 2) * F.BAR_PITCH * m
        out.append(f'<path d="{F.bar_path(bx, axis_y, h * m, m)}" fill="#ffffff" stroke="{INK}" stroke-width="1.5"/>')
        out.append(text(bx, axis_y - h * m / 2 - 10, f'{h}m', 13, 'middle'))

    # Horizontal guides, labelled in the column on the right.
    guides = [
        (lamp_y, 'lamp  9m x 1.5m'),
        (axis_y, 'wave axis'),
        (c, 'centre of area'),
        (pool_y, 'pool  18m x 3m'),
    ]
    for y, label in guides:
        out.append(line(left - 2 * m, y, F.CANVAS + 16, y, dash='3 4', width=1.25))
        out.append(text(F.CANVAS + 24, y + 5, label, 14))
    out.append(line(c, 0, c, F.CANVAS, dash='3 4', width=1.25))
    cross = 14
    out.append(line(c - cross, c, c + cross, c, stroke=INK, width=1.5))
    out.append(line(c, c - cross, c, c + cross, stroke=INK, width=1.5))

    # Keyline and clearance labels in the column.
    if shape == 'circle':
        title = 'APP ICON  circle outline'
        sub = ['keyline: circle 176/192 of the canvas', '(Material product-icon grid)']
    else:
        title = 'APP ICON  squircle outline'
        sub = ['keyline: squircle 160/192 (5/6),', 'the circle\'s area (+0.4%);', 'continuous corner 0.225 x side']
    col = F.CANVAS + 24
    out.append(text(col, 60, title, 16, weight='bold'))
    y = 92
    for s in sub:
        out.append(text(col, y, s, 13))
        y += 22
    y = 790
    for s in ['canvas 1024 = 192 units, grid every 16', f'm = bar width = {F.fmt(m)} px',
              'outline 0.75m, outer edge on the keyline', 'clearance 1m inside it (dotted)',
              'the mark\'s centre of area is the centre', 'beam edges: the common tangents (dashed)']:
        out.append(text(col, y, s, 13))
        y += 22
    out.append('</g>')
    return '\n'.join(out)


def logo_panel(ox: float) -> str:
    m, offset = F.solved()
    shape, scale = 'circle', 0.4
    keyline = F.CIRCLE_KEYLINE
    out = [f'<g id="construction-logo" data-name="Logo construction" transform="translate({F.fmt(ox)} 0)">']
    out.append(text(48, 60, 'LOGO  icon + wordmark', 16, weight='bold'))
    out.append(text(48, 92, 'wordmark: v1 monoline, stroke s = m (the bar width)', 13))
    out.append(text(48, 114, 'x-height 5s = 5m = bars 2 and 4, centred on the wave axis', 13))
    out.append(text(48, 136, 'gap: 2.5m (the bar pitch) from the outline\'s outer edge', 13))

    # The logo, scaled, with its alignment lines.
    logo = F.logo_svg(shape, 'light')
    body = logo[logo.index('<defs>'):logo.rindex('</svg>')]
    body = body.replace('id="logo-', 'id="construction-logo-').replace('url(#logo-', 'url(#construction-logo-')
    x0 = F.CENTRE - keyline / 2
    tx, ty = 48 - x0 * scale, 230 - x0 * scale
    out.append(f'<g transform="matrix({scale} 0 0 {scale} {F.fmt(tx)} {F.fmt(ty)})">{body}</g>')
    lamp_y = F.CENTRE + offset * m
    axis = lamp_y + F.WAVE_AXIS * m
    s = F.WORD_X_HEIGHT * m / 5
    baseline = axis + F.WORD_X_HEIGHT / 2 * m

    def Y(v):
        return ty + v * scale

    _, word_l, word_r = F.v1_wordmark()
    word_left = F.CENTRE + keyline / 2 + F.WORD_GAP * m
    word_right = word_left + (word_r - word_l) * s / F.V1_WORD_S
    x_end = tx + word_right * scale + 8
    for v, label in ((baseline - 6.5 * s, 't  6.5s'), (axis - 2.5 * m, 'x-height  5s = 5m'), (axis, 'wave axis'),
                     (baseline, 'baseline'), (baseline + 3.125 * s, 'descender  3.125s')):
        out.append(line(48, Y(v), x_end, Y(v), dash='3 4', width=1.25))
        out.append(text(x_end + 12, Y(v) + 4, label, 12))
    gx1, gx2 = tx + (F.CENTRE + keyline / 2) * scale, tx + word_left * scale
    gy = Y(baseline + 3.125 * s) + 40
    out.append(line(gx1, gy - 8, gx1, gy + 8, width=1.25))
    out.append(line(gx2, gy - 8, gx2, gy + 8, width=1.25))
    out.append(line(gx1, gy, gx2, gy, width=1.25))
    out.append(text((gx1 + gx2) / 2, gy + 24, '2.5m', 12, 'middle'))

    # The two versions on their own backgrounds, and the glyph.
    y = 700
    out.append(text(48, y - 24, 'VERSIONS  one ink each, no colour', 16, weight='bold'))
    tile_w, tile_h, icon = 400, 200, 130
    tiles = (('dark', '#000000', 'dark mode: white #FFFFFF'),
             ('light', '#ffffff', 'light mode: black #000000'),
             ('glyph', '#ffffff', 'glyph: one shape, any one ink'))
    for i, (version, background, caption) in enumerate(tiles):
        x = 48 + i * (tile_w + 30)
        out.append(f'<rect x="{x}" y="{y}" width="{tile_w}" height="{tile_h}" rx="14" fill="{background}" stroke="{INK}" stroke-width="0.75"/>')
        for j, shape in enumerate(('squircle', 'circle')):
            svg = F.glyph_svg(shape, prefix='construction-glyph-') if version == 'glyph' else F.icon_svg(shape, version)
            body = svg[svg.index('<defs>'):svg.rindex('</svg>')]
            k = icon / F.CANVAS
            ix, iy = x + 50 + j * (icon + 40), y + (tile_h - icon) / 2
            out.append(f'<g transform="matrix({F.fmt(k)} 0 0 {F.fmt(k)} {F.fmt(ix)} {F.fmt(iy)})">{body}</g>')
        out.append(text(x, y + tile_h + 30, caption, 14))
        if version == 'glyph':
            note = 'no gradient, no opacity; currentColor'
        else:
            style = F.MODES[version]
            beam = ' > '.join(f'{round(a * 100)}%' for a in style['beam'])
            pool = ' > '.join(f'{round(a * 100)}%' for a in style['pool'])
            note = f'beam {beam}; pool {pool}'
        out.append(text(x, y + tile_h + 52, note, 13))
    out.append('</g>')
    return '\n'.join(out)


def construction_svg() -> str:
    parts = [
        f'<?xml version="1.0" encoding="UTF-8"?>',
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{SHEET_W}" height="{SHEET_H}" viewBox="0 0 {SHEET_W} {SHEET_H}">',
        '<title>onspot v2 construction</title>',
        f'<rect id="sheet" x="0" y="0" width="{SHEET_W}" height="{SHEET_H}" fill="{SHEET}"/>',
        icon_panel('squircle', 0),
        icon_panel('circle', PANEL),
        line(2 * PANEL - 1, 40, 2 * PANEL - 1, SHEET_H - 40, stroke=INK, width=0.75, opacity=0.35),
        line(PANEL - 1, 40, PANEL - 1, SHEET_H - 40, stroke=INK, width=0.75, opacity=0.35),
        logo_panel(2 * PANEL),
        '</svg>',
    ]
    return '\n'.join(parts) + '\n'
