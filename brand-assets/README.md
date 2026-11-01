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

The Logo artboard keeps the wordmark's centreline strokes on the hidden layer
*Logo wordmark centrelines (editable)*; the visible wordmark is their outlined, united copy.

## Where the app uses it

The macOS master is used on every platform (a deliberate choice; it keeps Apple's margin everywhere):

- **Desktop and Android icons:** `bun tauri icon brand-assets/app-icon-1024.png --ios-color '#151412'`
  writes `src-tauri/icons/` and the Android launcher icons. The Ink colour fills the transparent
  margin on Android (adaptive background) and iOS, so they show a dark tile, not a white plate.
- **Web favicon and the header mark:** `static/app-icon.svg`, a copy of `app-icon-tile.svg`.
  Browsers expect a favicon to fill its box; with the macOS margin the tile was ~13 px at 16 px.
  `AppHeader.svelte` shows it at 36 px, the height of the header row.
- **The repository README:** `app-icon-tile.svg` at 120 px above the title.

Change the icon here, then re-run the command and copy the SVG again.

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
