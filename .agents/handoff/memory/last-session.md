# Last Session

## Outcome
Redesigned the live product UI around shadcn-svelte primitives, fixed deletion feedback semantics,
made the card conveyor visually explicit, and moved/capped costly local-model work so interaction
stays responsive. A follow-up made the complete Coach notes pane collapsible and phone-first.

## UI and interaction
- Installed shadcn Tabs, Dropdown Menu, Collapsible, Progress, Separator, Tooltip, Select and
  Alert Dialog primitives; `components.json` now uses the supported `nova` style.
- Replaced all seven native Settings selects with labelled shadcn Select popovers.
- Rebuilt Practice, AttemptCard and the extracted FeedbackPanel with layered glass surfaces,
  gradient accents, smoother state transitions and accessible primitive-based controls.
- Feedback now reads `7 All / 2 Errors / 3 Warnings / 2 Suggestions`; Grammar, Register, Fillers
  and Style live in the hamburger menu with counts.
- Deletions (`original` nonempty, `replacement` empty) show a struck original and **Remove** badge,
  never an arrow. The prompt now defines the empty-replacement contract and asks for concrete,
  nonredundant labels; `correctionTitle()` cleans legacy/redundant labels.
- The conveyor uses scroll-driven 3D rotation/translation/fade with an unsupported-browser rAF
  fallback. All motion disables under `prefers-reduced-motion`.
- At <=640px the rail becomes a bottom navigation bar. The full requested feedback labels remain
  visible at 390x844 without horizontal overflow.
- Coach notes now opens and closes through a labelled shadcn Collapsible trigger. Desktop reduces
  it to a 64px icon/count rail; phones start with a 58px bar and gain the screen space for attempts.
  Opening uses a 42%-height scrollable review pane, and choosing transcript feedback reopens it.

## Performance
- New `tts.worker.ts` + `WorkerPiperAdapter.ts`: Piper config download, G2P and ONNX inference are
  lazy/off-main-thread; requests serialize, PCM transfers, one voice stays resident, and models
  dispose after 90 seconds idle.
- Whisper threads cap at two on capable machines and one elsewhere; Whisper also disposes after
  90 seconds idle.
- Reworked Piper weight caching to stream to Cache Storage and one growable inference buffer,
  avoiding multiple full model copies.
- Reduced broad reactive churn: 25Hz mic level, 4Hz elapsed timer, separate audio activity store,
  bounded/revoked blob URLs, parallel correction DB reads, one observed stream card, and
  `content-visibility` for old cards.
- Font imports are Latin-only rather than every language subset.

## Verification
- `npm run check`: 0 errors, 0 warnings.
- `npm run build`: successful static production build.
- Headless Chrome seeded five attempts and seven corrections: severity tabs/counts, category menu,
  deletion strike-through, cleaned labels, animated disclosure, conveyor transform, reduced motion,
  and 390px responsive layout all passed with no runtime/console errors.
- The same browser suite verifies Coach notes close/reopen on desktop, its 440px→64px animated
  column change, closed-first 390px layout, 58px→329px mobile expansion, linked-correction reopen,
  reduced motion and zero horizontal overflow.
- Settings has zero native selects, seven labelled shadcn Select triggers, working option changes,
  user-facing selected labels, and no horizontal overflow at 390px.
- Cold Piper Tom runtime test on a fresh origin: downloaded 64MB and generated 2.94s of speech in
  44.9s while the page delivered 2,688 animation frames; maximum sampled main-thread gap was 87ms.

## Next work
- Phase 3 BYOC sync remains the next feature phase.
- A complete Whisper-small + configured LLM practice run and Piper Tom EQ/loudness pass remain.
- Automated axe/visual regression coverage and true virtualization for extreme histories remain
  worthwhile follow-ups.
