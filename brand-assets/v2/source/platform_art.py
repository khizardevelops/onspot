"""The v2 icon as the platforms show it, and the installer art, from the finished v2 files.

    python3 source/platform_art.py   # after finish_svgs.py; then scripts/brand-assets.sh renders the PNGs

Every platform shows one icon: the in-app logo in light mode (app.css: .logo-tile, .logo-ink). That
is the circle icon in the app's teal on a disc of the raised keys' card stock, with the keys' soft
glare at the top left. It is built from the VectorCraft exports (app-icon-circle-light.svg,
mark-light.svg, glyph-mark.svg), recoloured through their currentColor, so the art is exact.

Writes platform/:
  app-icon.svg, app-icon-tile.svg   the icon on the 1024 canvas, and cropped to its keyline
  android/                          the adaptive icon's layers (108 dp): the mark alone, and the
                                    glyph for themed (monochrome) icons; the launcher draws the shape
  installer/                        the NSIS, WiX and DMG images
"""
import os
import re

from geometry import (CENTRE, CIRCLE_KEYLINE, ELLIPSE_ASPECT, LAMP, POOL, WAVE_AXIS, CENTROID,
                      V1_WORD_BASELINE, V1_WORD_S, fmt, solved, transform_path, v1_wordmark)

HERE = os.path.dirname(os.path.abspath(__file__))
BRAND = os.path.dirname(HERE)
OUT = os.path.join(BRAND, 'platform')
V1_INSTALLER = os.path.join(BRAND, '..', 'v1', 'installer')

# The light theme's tokens (src/app.css).
TEAL = '#0f766e'   # --brand: the icon's ink
DISC = '#faf6ef'   # --key: the raised keys' card stock
PAPER = '#efeae0'  # --background: the page
TEXT = '#221f1a'   # --foreground: the wordmark
GLARE = 0.85       # .logo-tile's glare: white at 85 %, at (30 %, 24 %) of the disc, gone by 0.6 of its width

# Android adaptive icon: a 108 dp layer, of which the launcher shows the middle 72 dp; the mark
# takes the same share of it as of the circle icon's keyline (m = 36 dp / 12.01 m).
ADAPTIVE = 108
ADAPTIVE_M = 3.0  # dp; the pool's ends sit 30.9 dp from the centre, inside the 33 dp safe circle


def art(name: str) -> tuple[str, list[float]]:
    """A finished v2 SVG's drawing (without its svg element, comments and title) and its viewBox."""
    svg = open(os.path.join(BRAND, name), encoding='utf-8').read()
    view_box = [float(v) for v in re.search(r'viewBox="([^"]+)"', svg).group(1).split()]
    body = svg[re.search(r'<svg\b[^>]*>', svg).end():svg.rindex('</svg>')]
    body = re.sub(r'<!--.*?-->', '', body, flags=re.S)
    body = re.sub(r'\s*<title>.*?</title>', '', body, flags=re.S)
    return body.strip('\n'), view_box


def icon(transform: str = '') -> str:
    """The icon in 1024-canvas coordinates: the disc, its glare, and the circle icon in teal."""
    body, _ = art('app-icon-circle-light.svg')
    r = CIRCLE_KEYLINE / 2
    at = f' transform="{transform}"' if transform else ''
    return f'''<g{at} color="{TEAL}">
  <defs>
    <radialGradient id="onspot-icon-glare" cx="0.3" cy="0.24" r="0.6">
      <stop offset="0" stop-color="#ffffff" stop-opacity="{GLARE}"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="{fmt(CENTRE)}" cy="{fmt(CENTRE)}" r="{fmt(r)}" fill="{DISC}"/>
  <circle cx="{fmt(CENTRE)}" cy="{fmt(CENTRE)}" r="{fmt(r)}" fill="url(#onspot-icon-glare)"/>
{body}
</g>'''


def placed_icon(cx: float, cy: float, diameter: float) -> tuple[str, float]:
    """The icon with its keyline circle at (cx, cy), `diameter` across; and the wave axis's y there."""
    k = diameter / CIRCLE_KEYLINE
    m, offset = solved()
    axis = CENTRE + (offset + WAVE_AXIS) * m
    return icon(f'translate({fmt(cx - CENTRE * k)} {fmt(cy - CENTRE * k)}) scale({k:.6f})'), cy + (axis - CENTRE) * k


def wordmark(x_height: float, baseline: float, left: float | None = None, centre: float | None = None) -> str:
    """The v2 wordmark (v1's letters, stroke = x-height / 5) in the text ink."""
    paths, x0, x1 = v1_wordmark()
    k = (x_height / 5) / V1_WORD_S
    width = (x1 - x0) * k
    left = centre - width / 2 if left is None else left
    return '\n'.join(f'<path d="{transform_path(paths[p], k, x0, V1_WORD_BASELINE, left, baseline)}" fill="{TEXT}"/>'
                     for p in ('on', 'spot'))


def document(width: float, height: float, title: str, body: str, view_box: str | None = None) -> str:
    return (f'<?xml version="1.0" encoding="UTF-8"?>\n'
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{fmt(width)}" height="{fmt(height)}" '
            f'viewBox="{view_box or f"0 0 {fmt(width)} {fmt(height)}"}">\n'
            f'<title>{title}</title>\n{body}\n</svg>\n')


def app_icons() -> dict[str, str]:
    side = CIRCLE_KEYLINE
    o = CENTRE - side / 2
    return {
        'app-icon.svg': document(1024, 1024, 'onspot app icon', icon()),
        'app-icon-tile.svg': document(side, side, 'onspot app icon (tile)', icon(),
                                      f'{fmt(o)} {fmt(o)} {fmt(side)} {fmt(side)}'),
    }


def adaptive_layers() -> dict[str, str]:
    """The mark alone, its centre of area on the layer's centre, as the foreground; the glyph as the
    monochrome layer (Android tints its alpha). The launcher supplies the shape and the background."""
    m, _ = solved()
    k = ADAPTIVE_M / m
    centroid_x, centroid_y = POOL / 2 * m, (LAMP / 2 / ELLIPSE_ASPECT + CENTROID) * m  # in the mark's box
    at = f'translate({fmt(ADAPTIVE / 2 - centroid_x * k)} {fmt(ADAPTIVE / 2 - centroid_y * k)}) scale({k:.6f})'
    mark, _ = art('mark-light.svg')
    glyph, _ = art('glyph-mark.svg')
    return {
        'android/ic_launcher_foreground.svg': document(ADAPTIVE, ADAPTIVE, 'onspot adaptive icon: foreground',
                                                      f'<g transform="{at}" color="{TEAL}">\n{mark}\n</g>'),
        'android/ic_launcher_monochrome.svg': document(ADAPTIVE, ADAPTIVE, 'onspot adaptive icon: monochrome',
                                                      f'<g transform="{at}" color="#ffffff">\n{glyph}\n</g>'),
    }


def side_panel(width: float, height: float) -> str:
    """The welcome and finish pages' panel: the icon over the wordmark, on the page's paper."""
    cx = width / 2
    cy = height * 0.39
    diameter = 96
    shape, _ = placed_icon(cx, cy, diameter)
    return (f'<rect width="{fmt(width)}" height="{fmt(height)}" fill="{PAPER}"/>\n{shape}\n'
            f'{wordmark(12, cy + diameter / 2 + 36, centre=cx)}')


def installers() -> dict[str, str]:
    files = {}
    files['installer/nsis-sidebar.svg'] = document(164, 314, 'NSIS sidebar (164 x 314)', side_panel(164, 314))
    files['installer/wix-dialog.svg'] = document(
        493, 312, 'WiX dialog (493 x 312)',
        f'<rect width="493" height="312" fill="#ffffff"/>\n{side_panel(164, 312)}')

    # Beside each page title: the icon, and the wordmark with its x-height on the wave's axis.
    shape, axis = placed_icon(33.842, 28.5, 37)
    files['installer/nsis-header.svg'] = document(
        150, 57, 'NSIS header (150 x 57)',
        f'<rect width="150" height="57" fill="#ffffff"/>\n{shape}\n{wordmark(11, axis + 11 / 2, left=61.342)}')
    shape, _ = placed_icon(463, 29, 44)
    files['installer/wix-banner.svg'] = document(
        493, 58, 'WiX banner (493 x 58)', f'<rect width="493" height="58" fill="#ffffff"/>\n{shape}')

    # The DMG window: v1's layout (paper, an arrow from the app to Applications, the wordmark),
    # with the arrow in teal and the wordmark in the text ink.
    dmg = open(os.path.join(V1_INSTALLER, 'dmg-background.svg'), encoding='utf-8').read()
    dmg = dmg.replace('stroke="#f6a531"', f'stroke="{TEAL}"')
    dmg = dmg.replace('fill="#f6a531"', f'fill="{TEXT}"').replace('fill="#151412"', f'fill="{TEXT}"')
    dmg = dmg.replace('fill="#efeae0"', f'fill="{PAPER}"')
    assert '#f6a531' not in dmg and '#ffc24d' not in dmg and '#151412' not in dmg, 'a v1 colour is left'
    files['installer/dmg-background.svg'] = dmg
    return files


def main() -> None:
    files = {**app_icons(), **adaptive_layers(), **installers()}
    for name, svg in files.items():
        path = os.path.join(OUT, name)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'w', encoding='utf-8') as f:
            f.write(svg)
        print('wrote', os.path.relpath(path, BRAND))


if __name__ == '__main__':
    main()
