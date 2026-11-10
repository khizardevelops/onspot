# Move off neo-svelte gradually, starting with the select on Ark UI

## Context

The user does not want the bugs that come with neo-svelte's floating parts. They proposed migrating piece by
piece, proving it on Settings first, and asked whether anything beats Bits UI as the headless library.

**Recommendation: migrate gradually, by component type rather than by page, on Ark UI (`@ark-ui/svelte`).** This
approval covers only the first step, the select. Everything after it is a separate decision once the pilot has
results. Neither library has been run in this app yet; the comparison comes from source code and package data.

| | Ark UI | Bits UI |
|---|---|---|
| Who builds it | 3 people with 279 to 2016 commits, plus the Zag engine team | one person with 1022, next human 25 |
| Last release | 2026-11-02 | 2026-11-05 |
| Svelte downloads per week | 21.6k (Zag's Svelte layer 100k, used by Skeleton) | 1.7M |
| Zoom | `positioning.updatePosition` replaces the positioning, one shared preset | `ContentStatic`, each part positions itself |
| Parts Bits lacks | Toast, Password input | none extra |
| Engine | shared by React, Vue, Solid, Svelte | Svelte only |
| Install | 68 `@zag-js` packages, only used ones ship, size unmeasured | 6 dependencies |

Ruled out: Flowbite Svelte (ships its own look, no repository activity since 2026-06-27), Melt (no menu builder,
last release 2026-01-04), native customizable `<select>` (needs Safari 27, so older iPhones and WebKit webviews miss it).

Why type, not page: Settings uses 13 neo component types, so moving that page alone leaves two buttons, inputs and
cards in the app at once. One wrapper swapped changes that type everywhere. `SettingSelect` is only used inside
Settings, so "Settings first" and "select first" are the same move.

## Order

| Step | Replaces | Size | Status |
|---|---|---|---|
| 1. Select | `SettingSelect` (`NeoSelect`) | one wrapper, 5 importers | **this plan** |
| 2. Menus | `PopMenu` (`NeoMenu`) | one wrapper, 7 importers | after the pilot |
| 3. Tooltips | `quickTooltip` | 2 files | after the pilot |
| 4. Dialog, Tabs, Collapse, Range, Toast, Password | direct neo use | 1 to 7 files each | optional |
| 5. Button, Input, Card, Pill, Divider, Progress | direct neo use | 30, 9, 5, 8, 4, 6 files | optional, last |

Steps 1 to 3 clear 5 of the 7 workarounds, and stopping there is a valid end state. neo, `NeoThemeProvider` and
`sass-embedded` can only go after step 5. Along the way, 46 `neo-theme-root` lines in `app.css` and 118
`:global(.neo-*)` selectors in 25 components get rewritten or deleted, and that count is the measure of progress.

## Before starting

- **Another Claude session was working on tooltips in this repo** and edited `neo.ts` at 15:10. Check it has finished,
  because this plan edits `neo.ts`, `package.json` and `bun.lock`.
- Read the remaining handoff files, as `AGENTS.md` requires.
- Copy `SettingSelect.svelte` to the scratchpad. It holds uncommitted work, so `git checkout` cannot restore it.
- Take baseline screenshots of the neo select, light and dark, desktop and phone.

## Changes

1. **Older Safari: `src/lib/utils/floatingZoom.ts`, `cssZoomOf`.** It falls back to 1 where `currentCSSZoom` is
   missing, and Safari only gained that in 26.4. Fall back to the computed `zoom` of the root element.
2. **Add `@ark-ui/svelte`.** The running dev server re-optimizes on its own; if it answers 504, `touch vite.config.ts`.
3. **Rewrite `src/lib/components/settings/SettingSelect.svelte` on Ark UI.** Same props, so no importer changes.
   - `Select.Root` with `createListCollection`, `ids={{ trigger: id }}` so the row's `<label for>` still works,
     `Control`, `Trigger`, `ValueText`, `Portal`, `Positioner`, `Content`, `Item`, `ItemText`, plus the description line.
   - Positioning: `positioning={{ applyStyles: false, updatePosition }}`. Our `updatePosition` must first call the
     `updatePosition` Zag passes in, because that call starts its auto-update observers. It then runs
     `computePosition` with `placedUnderZoom` (`offset`, `flip`, `shift`, `size`) and writes `--x` and `--y` on the
     positioner. `size` matches the field's width and caps the height to the room available. It stays in this
     component until menus become a second caller, then moves to `floatingZoom.ts`.
   - Styling in the component, on `[data-part]`, from existing tokens (`--well`, `--key`, the `--neo-box-shadow-*`
     scale), with `min-width: 0` on the field. Enter and exit use the `quickPop` timings.
   - Android Back closes it, through `closeOnBack` as `PopMenu` does.
4. **Delete what it replaces:** `quickSelect` and `SELECT_LIST_MAX_HEIGHT` in `neo.ts`, `closeAfterPick`, and
   `centreCurrentChoice` if Ark already opens at the current choice.

## Pass criteria ("successful")

Reuse the dev server on :5173, and every browser launch uses `--mute-audio`. Probes are in
`/tmp/claude-1000/-mnt-data-synced-Khizar-Folder-My-Project-Files-Programing-Projects-Projects-onspot/96087434-952e-4b11-ba86-aeb769cf5537/scratchpad/`.

- Looks the same as the neo select side by side, light and dark, desktop and 390 px. Show the user the screenshots.
- Inside the window and against its field at 80/100/125/150 %, desktop and phone, including phone at 150 %
  (where neo's list runs 18 px off the right and 68 px off the bottom). No element wider than the window.
- Keeps today's behaviour: opens at the current choice, list order never reverses, a pick closes it and returns
  focus to the field, the closed field shows only the label, the row's label opens it.
- Keyboard: arrows, typeahead, Enter, Escape, Tab. Touch: tap, scroll a long list without picking, tap outside.
- No frame of gliding, and interaction within the app's ~100 ms feedback rule.
- Less code and no library-quirk comments compared with today. Report the bundle size change.
- Project check and SPDX at 0 errors. WebKit through a scratch Playwright if it will run here, otherwise report
  Safari as unverified. Real iPhone, Android WebView and Tauri stay untested, and the user should try a phone.

**If it fails:** rewrite the same file on Bits UI (`Select.ContentStatic`, positioned the same way) and test again.
If that fails too, restore the scratchpad copy, keep neo's select, apply the two small fixes (height from `--ui-vh`,
`min-width: 0` on the field), and remove the added dependency.

## Records

- If it passes, with the user's agreement: update the "Build UI from @dvcol/neo-svelte" bullet in
  `.agents/handoff/rules/style.md`, the UI line in `rules/constraints.md`, and the memory note on neo-svelte.
- `.agents/handoff/memory/decisions.md`: the gradual path, why Ark over Bits and Flowbite, the zoom hook.
- `docs/planning/bugs.md`: keep the item open and note which steps are done.
- `.agents/handoff/memory/tasks.md`, `state.md`, `last-session.md`: update as usual. No commit unless asked.