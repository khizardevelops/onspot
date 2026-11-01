# onspot brand assets

A spotlight on your voice: a lamp throws a beam onto a floor, and a waveform stands in the light.
`ai-generated-logo.png` was the prototype; everything else here is rebuilt on exact geometry.

## Files

| File | What it is |
| --- | --- |
| `onspot-brand.vectorcraft` | Source (VectorCraft). Artboards: App icon, Logo, Construction. Global swatches in the `onspot` group. |
| `app-icon.svg`, `app-icon-1024.png` | App icon: mark only, no text (platform guidance: words don't survive 16–32 px). |
| `app-icon-tile.svg` | The same icon cropped to its 824 tile (`viewBox="100 100 824 824"`), for the web. |
| `logo.svg`, `logo-1024.png` | Logo: the mark above the wordmark on the same tile, as in the prototype. |
| `construction.png` | Construction sheet: module grid, keylines, type lines, palette. |
| `android/` | Android adaptive icon layers: the mark alone (`ic_launcher_foreground.svg`) and the themed-icon layer (`ic_launcher_monochrome.svg`). |
| `installer/` | Installer artwork: NSIS header and sidebar, WiX banner and dialog, DMG background. |

The Logo artboard keeps the wordmark's centreline strokes on the hidden layer
*Logo wordmark centrelines (editable)*; the visible wordmark is their outlined, united copy.

The `android/` and `installer/` SVGs are compositions of the masters' own paths (the mark, the
wordmark and the icon tile, placed by transform), so they share the geometry exactly. If the mark
or wordmark changes, copy the new paths into them.

## Where the app uses it

The macOS master is the app icon on every desktop platform (a deliberate choice; it keeps Apple's
margin everywhere). `scripts/brand-assets.sh` renders everything below from this folder; it needs
bun, resvg and ImageMagick 7.

- **Desktop icons, iOS and Android's legacy icon:** `tauri icon` on `app-icon-1024.png` with
  `--ios-color '#151412'` writes `src-tauri/icons/`. It rewrites `icon.icns` with its entries in
  another order; if that is its only change, `git checkout` it.
- **Android launcher (adaptive icon):** the launcher crops the 108 dp layer to its own shape and
  shows only the middle 72 dp, so the foreground is the mark alone (m = 2.5 dp: 45 × 50 dp, the
  same 68 % share as the macOS tile) on the Ink background. The mark's farthest points, the pool's
  ends, sit 31.2 dp from the centre, inside the 33 dp safe circle. The monochrome layer is the same
  mark in white for Android 13 themed icons.
- **Installers** (`src-tauri/icons/installer/`, wired in `tauri.conf.json`):

  | Image | Size | Content |
  | --- | --- | --- |
  | `nsis-sidebar.bmp` | 164 × 314 | Welcome and finish pages: the logo on Ink (scale 0.22) |
  | `nsis-header.bmp` | 150 × 57 | Left of each page title: the icon (37 px) and the wordmark (x-height 11 px), "on" in Ink on white |
  | `wix-dialog.bmp` | 493 × 312 | MSI welcome and finish: the NSIS sidebar panel, white where WiX draws text |
  | `wix-banner.bmp` | 493 × 58 | MSI page banner: the icon (44 px) on the right, white under WiX's title |
  | `dmg-background.png` | 660 × 400 | Paper, an Amber arrow from the app (180, 170) to Applications (480, 170), the wordmark |

  NSIS and WiX read 24-bit BMPs. The setup `.exe`, its uninstaller and the MSI's entry in
  Installed apps use `icon.ico`; the DMG's volume icon is `icon.icns`.
- **Software centres (Flatpak metainfo):** brand colours Light `#FFC24D` and, for dark mode,
  `#714D1D` (Amber darkened and muted in OKLCH, 0.45 / 0.08; 2.4 : 1 against the Ink tile).
- **Web favicon and the header mark:** `static/app-icon.svg`, a copy of `app-icon-tile.svg`.
  Browsers expect a favicon to fill its box; with the macOS margin the tile was ~13 px at 16 px.
  `AppHeader.svelte` shows it at 36 px, the height of the header row.
- **The repository README:** `app-icon-tile.svg` at 52 px beside the title.

Change the icon here, then re-run `scripts/brand-assets.sh` and copy the SVG again.

## Icon grid

Apple's macOS template: a 1024 canvas with an 824 body at (100, 100), corner radius 185.4.
The corners are continuous (curvature-smooth), the iOS/macOS "squircle", not circular arcs.

## The mark

One module, **m = the waveform bar width**. Every dimension is a whole multiple of m.

| Part | Size | Why |
| --- | --- | --- |
| Bars | 1 m wide, heights 3 : 5 : 8 : 5 : 3 m, pitch 2.5 m | Fibonacci heights; centred on one axis |
| Lamp | ellipse 6 m × 1 m | |
| Pool | ellipse 18 m × 3 m | lamp : pool = 1 : 3; both ellipses 1 : 6 (one consistent view of round shapes) |
| Throw | 18 m, lamp centre to pool centre | the beam widens 1 m every 3 m |
| Beam | the convex hull of lamp and pool | edges are the exact common tangents of both ellipses |
| Mark box | 18 m × 20 m | the tallest bar ends at the pool's centre |

App icon: m = 28 pt, mark centred in the canvas. Logo: m = 23 pt.

## The wordmark

Monoline lowercase with round caps (the same caps as the bars), stroke **s**:

- x-height 5 s, overshoot 2 %, descender 3.125 s (5/8 x-height), t height 6.5 s (1.3 x-height).
- o, n, p: circles of centreline radius 2 s.
- s: two bowls (48 : 52) joined by their internal common tangent at 24°, stretched to 4/5 of o.
- t: crossbar on the x-height; foot radius 1.5 s.
- Spacing (outer edge to outer edge): o–n 0.8 s, s–p 0.45 s, p–o 0.7 s, o–t 0.5 s; word space 2.25 s.
- In the logo, s = 3m/5, so the x-height equals the shortest bar (3 m); the pool sits 3 m above the x-height.

## Palette

| Swatch | Hex | Use |
| --- | --- | --- |
| Ink | `#151412` | Tile (the app's dark `--background`) |
| Cream | `#EDE7DC` | "on" (the app's dark `--foreground`) |
| Light | `#FFC24D` | Lamp, bars, beam top |
| Amber | `#F6A531` | "spot", beam fade, pool |
| Paper | `#EFEAE0` | Light backgrounds (the app's light `--background`) |

The beam fades Light 60 % → Amber 22 % → Amber 4 %. The pool is a radial Amber gradient, 60 % → 15 %.
