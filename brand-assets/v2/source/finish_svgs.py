"""Finish VectorCraft's SVG exports in brand-assets/v2/: make them recolourable and write the tiles.

    python3 source/finish_svgs.py   # after exporting from onspot-brand.vectorcraft; safe to re-run

1. Recolourable. VectorCraft writes each version's ink as a hex colour (dark mode #ffffff, light
   mode #000000). Every use of it becomes `currentColor`, so one value colours the whole file:
   - the dark- and light-mode files get their ink back as the svg's `color` attribute, so they look
     exactly as exported until something sets `color`;
   - the glyph gets no default: it takes the colour of where it is placed, and is black on its own.
     Its export is reduced to its one path first (no groups, ids or names).
2. Ready to inline. Every id is prefixed with `onspot-` and the file name, so different files can
   share a page (VectorCraft names every gradient `linear-gradient-1`), and the empty groups
   VectorCraft writes for the other artboards are removed.
3. Tiles. Each 1024 app icon and glyph is copied as `…-tile.svg`, cropped to its keyline.
"""
import os
import re

from geometry import CENTRE, CIRCLE_KEYLINE, MODES, SQUIRCLE_KEYLINE, fmt

BRAND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KEYLINES = {'squircle': SQUIRCLE_KEYLINE, 'circle': CIRCLE_KEYLINE}

# File names: the versions drawn in a mode's ink, and the glyphs.
MODE_FILE = re.compile(r'^(?P<art>app-icon-(?P<shape>squircle|circle)|mark|logo-(squircle|circle))-(?P<mode>dark|light)\.svg$')
GLYPH_FILE = re.compile(r'^glyph-(?P<shape>mark|squircle|circle)\.svg$')

SVG_TAG = re.compile(r'<svg\b[^>]*>')
COLOUR_ATTRIBUTE = re.compile(r'\b(fill|stroke|stop-color)="(#[0-9a-fA-F]{3,8})"')
GLYPH_INK = '#000000'

MODE_NOTE = ('<!-- onspot {mode}-mode version. Recolourable: every part is drawn in currentColor, and the '
             "svg's color attribute ({ink}) is the default. Inline, set CSS color on the svg for any colour "
             '(opacity fades it as one); as a file, edit that attribute. -->')
GLYPH_NOTE = ('<!-- onspot glyph: one shape in one ink. It takes the colour of where it is placed '
              '(currentColor; black on its own). -->')


def long_hex(colour: str) -> str:
    """#fff → #ffffff, lower case, so the same ink compares equal however it was written."""
    colour = colour.lower()
    return '#' + ''.join(c * 2 for c in colour[1:]) if len(colour) == 4 else colour


def set_svg_attributes(svg: str, **values: str) -> str:
    """Set attributes on the root <svg> tag, replacing a value that is already there."""
    def edit(match: re.Match) -> str:
        tag = match.group(0)
        for name, value in values.items():
            attribute = re.compile(rf'\s{name}="[^"]*"')
            if attribute.search(tag):
                tag = attribute.sub(f' {name}="{value}"', tag, count=1)
            else:
                tag = tag[:-1] + f' {name}="{value}">'
        return tag
    return SVG_TAG.sub(edit, svg, count=1)


def add_note(svg: str, note: str) -> str:
    """Put the explanation after the XML declaration, once."""
    if '<!-- onspot' in svg:
        return svg
    declaration = re.match(r'<\?xml[^>]*\?>\n?', svg)
    at = declaration.end() if declaration else 0
    return svg[:at] + note + '\n' + svg[at:]


def ink_to_current_colour(svg: str, ink: str, name: str) -> str:
    """Replace every use of the ink with currentColor; refuse a file that holds any other colour."""
    others = {c for _, c in COLOUR_ATTRIBUTE.findall(svg) if long_hex(c) != ink}
    if others:
        raise SystemExit(f'{name}: expected only {ink}, found {sorted(others)}')
    svg = COLOUR_ATTRIBUTE.sub(lambda m: f'{m.group(1)}="currentColor"', svg)
    body = re.sub(r'<!--.*?-->', '', SVG_TAG.sub('', svg, count=1), flags=re.S)
    if re.search(r'#[0-9a-fA-F]{3,8}\b|rgb\(', body):
        raise SystemExit(f'{name}: a colour is left outside fill, stroke and stop-color')
    return svg


def remove_empty_groups(svg: str) -> str:
    while True:
        tidied = re.sub(r'\n[ \t]*<g\b[^>]*>\s*</g>', '', svg)
        if tidied == svg:
            return svg
        svg = tidied


def id_prefix(stem: str) -> str:
    return f'onspot-{stem}-'


def rename_ids(svg: str, rename) -> str:
    """Rename every id, with every url(#id) and href="#id" that points at it."""
    for old in re.findall(r'\sid="([^"]+)"', svg):
        new = rename(old)
        svg = svg.replace(f' id="{old}"', f' id="{new}"')
        svg = svg.replace(f'url(#{old})', f'url(#{new})').replace(f'href="#{old}"', f'href="#{new}"')
    return svg


def prefix_ids(svg: str, stem: str) -> str:
    """id="x" → id="onspot-<stem>-x"."""
    return rename_ids(svg, lambda i: id_prefix(stem) + i)


def bare_ids(svg: str, stem: str) -> str:
    """Undo prefix_ids, so a re-run starts from VectorCraft's names again."""
    return rename_ids(svg, lambda i: i.removeprefix(id_prefix(stem)))


def glyph_as_one_path(svg: str, name: str) -> str:
    """A glyph export reduced to its single path, keeping the canvas and the fill rule."""
    paths = re.findall(r'<path\b[^>]*/>', svg)
    if len(paths) != 1:
        raise SystemExit(f'{name}: a glyph is one path, found {len(paths)}')
    path = paths[0]
    d = re.search(r'\sd="([^"]+)"', path).group(1)
    rule = re.search(r'\sfill-rule="([^"]+)"', path)
    fill = re.search(r'\sfill="([^"]+)"', path).group(1)
    tag = SVG_TAG.search(svg).group(0)
    size = {a: re.search(rf'\s{a}="([^"]+)"', tag).group(1) for a in ('width', 'height', 'viewBox')}
    shape = GLYPH_FILE.match(name).group('shape')
    rule_attribute = f' fill-rule="{rule.group(1)}"' if rule and rule.group(1) != 'nonzero' else ''
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{size["width"]}" height="{size["height"]}" viewBox="{size["viewBox"]}">\n'
            f'  <title>onspot glyph ({shape})</title>\n'
            f'  <path d="{d}"{rule_attribute} fill="{fill}"/>\n'
            '</svg>\n')


def make_recolourable(name: str, svg: str) -> str:
    mode_file = MODE_FILE.match(name)
    if mode_file:
        mode = mode_file.group('mode')
        ink = MODES[mode]['ink']
        svg = ink_to_current_colour(svg, ink, name)
        return add_note(set_svg_attributes(svg, color=ink), MODE_NOTE.format(mode=mode, ink=ink))
    return add_note(ink_to_current_colour(glyph_as_one_path(svg, name), GLYPH_INK, name), GLYPH_NOTE)


def tile(svg: str, shape: str) -> str:
    """The same drawing, cropped to the outline's keyline (for favicons and inline use)."""
    side = KEYLINES[shape]
    origin = CENTRE - side / 2
    return set_svg_attributes(svg, width=fmt(side), height=fmt(side),
                              viewBox=f'{fmt(origin)} {fmt(origin)} {fmt(side)} {fmt(side)}')


def write_if_changed(path: str, text: str) -> None:
    if os.path.exists(path) and open(path, encoding='utf-8').read() == text:
        print('unchanged', os.path.basename(path))
        return
    with open(path, 'w', encoding='utf-8') as f:
        f.write(text)
    print('wrote    ', os.path.basename(path))


def main() -> None:
    for name in sorted(os.listdir(BRAND)):
        match = MODE_FILE.match(name) or GLYPH_FILE.match(name)
        if not match:
            continue
        stem = name.removesuffix('.svg')
        svg = bare_ids(open(os.path.join(BRAND, name), encoding='utf-8').read(), stem)
        svg = remove_empty_groups(make_recolourable(name, svg))
        write_if_changed(os.path.join(BRAND, name), prefix_ids(svg, stem))

        shape = match.group('shape')
        if shape in KEYLINES and (name.startswith('app-icon-') or name.startswith('glyph-')):
            tile_stem = f'{stem}-tile'
            write_if_changed(os.path.join(BRAND, f'{tile_stem}.svg'), prefix_ids(tile(svg, shape), tile_stem))


if __name__ == '__main__':
    main()
