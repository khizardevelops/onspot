# onspot brand assets, v2

The same spotlight on your voice as v1 (`../v1/`), redrawn to read larger in docks and launchers:

- **No tile and no colour.** v1 drew an amber mark on a dark squircle; v2 is transparent and drawn in
  one ink: **white for dark mode, black for light mode**. An outline holds the shape.
- **Two outlines:** a squircle and a circle, each in both modes. The mark inside is identical in all.
- **A glyph** for any other context: one solid shape in one ink, no gradient and no opacity.
- **Every SVG takes any colour**: it is drawn in `currentColor`, so one value recolours the whole
  file, fades included ("Any colour" below). Backgrounds are transparent.
- **A wider beam with the wave higher in it**, so the mark is squatter and fills the outline:
  the tallest bar is 313 px on the 1024 canvas (v1: 224 px, +40 %).

## Files

| File | What it is |
| --- | --- |
| `onspot-brand.vectorcraft` | Source (VectorCraft). Artboards: the icons and marks in both modes, four logos, Construction, three glyphs; each artboard shows its mode's background in the app (exports are transparent). Global swatches *Dark mode ink* (white), *Light mode ink* and *Glyph ink* (black) in the `onspot v2` group; the brand art's fills and strokes are linked to them. |
| `app-icon-{squircle,circle}-{dark,light}.svg`, `…-1024.png` | App icons on the 1024 canvas. `-dark` is the dark-mode version (white), `-light` the light-mode version (black); either SVG takes any colour. |
| `app-icon-{squircle,circle}-{dark,light}-tile.svg` | The same icons cropped to their keyline, for favicons and inline use (as v1's `app-icon-tile.svg`). |
| `mark-{dark,light}.svg/.png` | The mark alone, cropped to its box (18 m x 14.25 m). |
| `logo-{squircle,circle}-{dark,light}.svg/.png` | Icon and wordmark side by side. |
| `glyph-mark.svg/.png`, `glyph-{squircle,circle}.svg`, `…-1024.png`, `…-tile.svg` | The glyph: the mark alone, or in either outline (1024 canvas, or cropped to the keyline). Each SVG is a single path filled with `currentColor`; the PNGs are black. |
| `construction.png` | Construction sheet: both icons on their grids, the logo's alignment, the two versions. |
| `source/geometry.py`, `source/construction.py` | The derivation: they write the exact SVGs that were pasted into the VectorCraft document (`python3 source/geometry.py OUT_DIR`, needs numpy and scipy), including each glyph's parts and an exact clip-path rendering of it to check the merged shape against. |
| `platform/` | The icon as the platforms show it (below, "Where the app uses it"): `app-icon.svg` and `app-icon-1024.png` (1024 canvas), `app-icon-tile.svg`, `android/` (adaptive layers), `installer/`. |
| `source/platform_art.py` | Writes `platform/` from the finished exports (run after `finish_svgs.py`). |
| `source/finish_svgs.py` | Run after every export: turns the ink into `currentColor`, gives every id a unique `onspot-<file>-` prefix, drops VectorCraft's empty groups for the other artboards, and writes the tiles. Safe to re-run. |

The SVGs and PNGs are VectorCraft's exports of the source, finished by `source/finish_svgs.py`;
they match the script's SVGs to the pixel. Edit the `.vectorcraft` file (or change the script and
paste its SVGs in again), export, then run `python3 source/finish_svgs.py`.

## Icon grid

A 1024 canvas = **192 units**, Material's product-icon grid (1 unit = 5.333 px).

| Outline | Keyline (outer edge) | Why |
| --- | --- | --- |
| Circle | 176 units = 938.667 px (11/12) | Material's circle keyline |
| Squircle | 160 units = 853.333 px (5/6) | The squircle with the circle's area (+0.4 %), so both carry the same visual weight, as Material's keylines do. Corners: v1's continuous corner, 0.225 of the side (Apple's ratio), scaled. |

- **Outline:** 0.75 m wide (m below), in the mode's ink, its outer edge on the keyline.
- **Clearance:** the mark stays 1 m inside the outline's inner edge.
- **Placement:** the centre of area of the mark's silhouette is the canvas centre (7.141 m below
  the lamp's centre). Centring the bounding box instead left the wide pool looking low.
- **Size:** each outline allows a largest module (squircle 39.657 px, circle 39.076 px); both use
  the smaller, **m = 39.076 px**, so the two icons share one mark.

## The mark

One module, **m = the waveform bar width**.

| Part | Size | v1 | Why |
| --- | --- | --- | --- |
| Bars | 1 m wide, heights 3 : 5 : 8 : 5 : 3 m, pitch 2.5 m | same | Fibonacci heights, one axis |
| Lamp | ellipse 9 m x 1.5 m | 6 m x 1 m | the wider spotlight |
| Pool | ellipse 18 m x 3 m | same | lamp : pool = 1 : 2 (v1 1 : 3); both 1 : 6 ellipses |
| Throw | 12 m, lamp centre to pool centre | 18 m | the beam widens 3 m every 8 m on each side |
| Beam | the convex hull of lamp and pool | same | edges are the exact common tangents of both ellipses |
| Wave axis | 8 m below the lamp | 14 m | the tallest bar still stands on the pool's centre line, now mid-beam |
| Mark box | 18 m x 14.25 m | 18 m x 20 m | squatter, so it fills a round or square outline |

On the canvas (px): lamp centre y 232.961, wave axis 545.567, pool centre 701.871; outline
29.307 wide; mark 703.365 x 556.831.

## The logo

v1's monoline wordmark (`../v1/README.md`, "The wordmark"), placed beside the icon:

- Stroke **s = m**, the bar width, so the letters have the bars' weight and round caps.
- x-height 5 s = **5 m**, the height of bars 2 and 4, **centred on the wave's axis**: "on" reads as
  the waveform continuing.
- 2.5 m (the bar pitch) from the outline's outer edge to the "o".
- The whole wordmark is in the mode's ink, like the icon.

v1's editable wordmark centrelines are in `../v1/onspot-brand.vectorcraft`.

## Two versions, no colour

Everything is one ink per version; the beam and the pool are that ink faded by opacity.

| Version | Ink | Beam (lamp → middle → pool) | Pool (centre → edge) |
| --- | --- | --- | --- |
| Dark mode (`-dark`) | white `#FFFFFF` | 60 % → 24 % → 6 % | 45 % → 10 % |
| Light mode (`-light`) | black `#000000` | 45 % → 18 % → 4 % | 35 % → 8 % |

Black on white reads stronger than white on black, so light mode fades further. At these values
the lamp stays distinct from the top of the beam and the bars from the cone behind them; a
stronger beam (75 / 32 / 8) merged the lamp into the beam and turned the black cone into a solid
shade. The lamp, bars, outline and wordmark are solid ink.

## Any colour

Every SVG is drawn in `currentColor`: one value colours every part, and the beam and pool keep
their fades as opacity of that colour.

| Where | How |
| --- | --- |
| Inline in HTML or a Svelte component | Set CSS `color` on the `<svg>`, e.g. `color: var(--accent)`; `color: inherit` follows the text around it. |
| As a file (`<img>`, favicon, another app) | It renders in its default, the `color` attribute on the `<svg>`: white in `-dark`, black in `-light`. The page can't reach into an `<img>`, so edit that one attribute. The glyph has no default (black on its own), and as a CSS `mask-image` it takes any background colour. |
| Translucent | `opacity` on the `<svg>` fades it as one image. An alpha colour (`rgb(255 255 255 / 45%)`) works too, but fades each part separately, so the lamp and bars add up where they overlap the beam. |

- **Pick the file by the background, not the ink.** Use `-dark` for a light ink on a dark
  background and `-light` for a dark ink on a light one. They differ only in beam strength (table
  above). The glyph suits any ink on any background.
- **Inline the same file twice in two colours?** Give each copy its own ids. Otherwise the second
  copy's beam resolves to the first copy's gradient, and takes the first copy's colour. Different
  files can share a page: their ids are already unique.

## The glyph

One shape in one ink, so it works where gradients and transparency don't: favicons and pinned tabs,
Android's themed (monochrome) icon, menu-bar and tray icons, a single-colour print, a stamp, an
embroidery, an engraving, or text-coloured inline in a page.

- **Light is the empty space** between the beam's edges. A solid cone read as a lampshade.
- **The beam's edges** are the silhouette's own boundary, 0.75 m wide (the outline's width), so
  the glyph has exactly the mark's silhouette and fits the outlines with the same clearance.
- **The lamp and the pool are solid**; the pool is the spot, and the wave stands on it (the tallest
  bar's foot is on the pool's centre line, as everywhere in v2).
- **The ground dips around the wave.** In one ink the tallest bar, which stands 1.5 m into the
  pool, would merge with it. So the pool dips around that bar with a minimal gap of 0.25 m (a
  quarter bar, `GLYPH_DIP`), and the bar stays whole and solid. The gap reads at 128 px and closes
  up from about 64 px down. Bars 2 and 4 end just above the pool and need no dip.
- **One compound path per file.** VectorCraft insets the silhouette by 0.75 m and subtracts the
  inset, subtracts the dip (bar 3 widened by the gap) from the pool, outlines the outline's stroke,
  and unites everything with the lamp and the bars. No strokes remain, so it scales and converts (vector drawables, icon fonts, cutting plotters)
  without changing weight. The merged shape matches an exact clip-path rendering: no pixel differs
  by more than anti-aliasing.
- **`fill="currentColor"`**: inline in HTML it takes the text colour; as an image it is black; in
  any other tool, recolour the single path.

## Where the app uses it

Everywhere since 2026-11-06; `scripts/brand-assets.sh` renders it all (needs bun, resvg and
ImageMagick 7). After changing the art: export from VectorCraft, `python3 source/finish_svgs.py`,
`python3 source/platform_art.py`, then `scripts/brand-assets.sh`.

**In the app.** The header and the welcome page show `app-icon-circle-light-tile.svg` in light mode
and `app-icon-circle-dark-tile.svg` in dark mode (exact copies in `static/`; Tailwind's `dark:`
variant picks one) on a raised paper disc (`.logo-tile` in `src/app.css`). Each file is a CSS mask
over `--brand` (`.logo-ink`), so the logo is drawn in the app's accent, which follows the session
mode: red in Exam, the app's aqua in Casual.

**On the platforms** (`platform/`, written by `source/platform_art.py`). A platform shows one icon,
so it is the in-app logo in light mode: the circle icon in teal (`#0f766e`, the light theme's
`--brand`) on a disc of the raised keys' card stock (`#faf6ef`, `--key`) with their glare at the
top left. It is drawn on a transparent canvas: no tile behind it, and the circle keyline (11/12)
makes it as large as Material allows.

| Platform | Source | Output |
| --- | --- | --- |
| Desktop (macOS, Windows, Linux) | `platform/app-icon-1024.png` via `tauri icon` | `src-tauri/icons/` (`icon.icns` with every size to 1024, `icon.ico`, PNGs, Windows Store logos) |
| iOS | the same, `--ios-color '#faf6ef'` | `src-tauri/icons/ios/`: the disc's colour fills the square, so the ring sits inside iOS's mask |
| Android launcher | `platform/android/` | the adaptive icon: the mark alone (m = 3 dp, the circle icon's share of the 72 dp the launcher shows; the pool's ends 30.9 dp from the centre, inside the 33 dp safe circle) on `#faf6ef`; the launcher draws the shape, so there is no ring. The monochrome layer (Android 13 themed icons) is the glyph. The legacy and round icons are the whole circle icon. |
| Installers | `platform/installer/` | `src-tauri/icons/installer/`: the NSIS sidebar and WiX dialog (the icon over the wordmark on paper), the NSIS header (the icon and the wordmark, its x-height on the wave's axis), the WiX banner (the icon), the DMG window (v1's layout: a teal arrow, the wordmark in the text ink). |
| Web favicon | `platform/app-icon-tile.svg` | `static/app-icon.svg` (cropped to the keyline: a favicon fills its box). Browsers keep an icon by its URL (Firefox and Zen even past a hard reload), so `src/app.html` links it as `app-icon.svg?v=2`: bump `?v=` there, on the Apple touch icon and in `static/manifest.webmanifest` whenever the icon changes. |
| PWA | `scripts/pwa-assets.sh` | `static/pwa/icons/`: the circle icon on transparency (192, 512), the maskable icon (the Android foreground on `#faf6ef`, the mark taking the same share of the 80 % safe circle), the Apple touch icon (on `#faf6ef`); `static/pwa/splash/`: the icon on the page's paper |
| Flatpak | `platform/app-icon.svg` | the scalable icon; the software-centre banner is the app's pale teal `#c9ddd5` (light) and deep teal `#1e4a43` (dark), in the metainfo |
| Repository README | `platform/app-icon-tile.svg` | 52 px beside the title |
