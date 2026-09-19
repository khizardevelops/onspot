# Style

Document coding, naming, file organization, tooling, and communication preferences.

## Code Style

## File Organization

## Naming

## Preferred Tools

## Preferred Patterns

### Product UI
- Keep the default surface minimal and use as little screen space as the task permits.
- Use progressive disclosure for secondary detail and infrequent actions. Show the primary result
  first; reveal alternatives, breakdowns, regeneration, and other detail only when requested.
- Avoid duplicate navigation, labels above self-explanatory content, floating counters, and
  controls that compete with the learner's transcript or feedback.
- Keep compact text labels where an icon alone would make an action unclear.

### Colour hierarchy (tokens in `src/app.css`; one meaning per colour)
- **Paper** `--background`: the crumpled-paper page (Paper Shaders texture), quietest layer.
  **Deep paper** `--rail-bg`: the navigation rail.
- **Sheet** `--card`: content cards and the raised pill/knob of segmented controls. Every card
  uses `.sheet`: frosted (`--sheet-frost` translucent colour + backdrop blur, so the crumpled
  paper shows through), `--sheet-line` hairline, top highlight, layered `--shadow-sheet`
  (hover `--shadow-sheet-hover`). shadcn `Card` includes it; on shadcn `Item` add
  `border-[var(--sheet-line)]` (Item's `border-transparent` otherwise wins). Never a flat
  `bg-card` + border box.
- **Inset** `--surface-2`: panels inside sheets. Never interactive.
- **Control** `--secondary` / `--control(-hover|-line)` / `--on-control`: every neutral button,
  toggle, segment track and rail key (sea-glass). shadcn `outline`/`secondary`/`ghost` buttons
  and `Toggle` are mapped to it — don't give a button the paper or sheet colour.
- **Selected / primary** `--primary`: current page, pressed toggles, the one primary action.
- **Semantic** `--error`/`--warn`/`--good` (brick, ochre, moss): status only, never decoration.
- **Ink** `--foreground` > `--muted-foreground` > `--faint`.
- Rail keys sit in debossed wells; the current page is the one raised (teal) key. The rail is
  the desk and the page (`<main class="page-sheet paper-surface">`) is a sheet laid on it:
  rounded left corners, 6px overlap, `--page-edge-shadow`. No stitches/rope on the seam (user
  rejected them).
- Paper grain on a coloured surface: add `.paper-grain` (blend mode per theme); a surface cut
  from the page itself: `.paper-surface`. Relief is shadow only (`--paper-emboss/deboss`),
  never gradients. The texture is soft crumple/wrinkle facets — no heavy grain or dithering.

## Communication
