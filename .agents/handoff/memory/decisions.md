# Decisions

### Pace LLM requests and rotate Groq models instead of failing on 429 (2026-11-01)
User: "better error handling and also error preventing by rotating the groq models … if the prompt
is longer then allowed tokens per limit then we need to chunk it". Groq's per-minute allowances
refill continuously ("2 tokens over → try again in 15ms"), so `adapters/llm/pacing.ts` keeps a
token bucket per key+model (TPM, and OTPM where stated), charges each request before sending,
waits the moment it needs, or moves to the next model of `GROQ_ROTATION_MODELS` (120B → Qwen 3.8 →
20B). Only limits the provider stated are paced (a paid plan must not be throttled to free limits);
the first refusal teaches them (ledger, 24 h). Feedback waits up to 45 s for the learner's model
(20B broke JSON and lost corrections on a long take); translations/meanings rotate after 3 s.
Setting "When a model is busy" (`llmRotation`, Groq only). Long work is split instead of enlarged:
evaluation in ≤260-word parts (joined: corrections in order, first note, mistakes interleaved, last
follow-up), translations in ≤80-word parts, hover meanings per ~90-word section on demand.

### Translations only when the learner asks (2026-11-01)
User: "the translation should not be auto generated, only when the user deliberately choose to
generate translation". The `translationMode` setting and the evaluation's `includeTranslations`
path are removed; cards start with translation off; a shown-but-empty note offers "Translate".

### Translate what the learner meant, not what was transcribed (2026-10-31)
User: translations should be of "Did you mean to say?", not the attempt "which can contain utter
nonsense"; with no errors, "You said" = "Did you mean to say?". Version 3 sets mark the change;
old transcript translations are hidden and replaced lazily (active card or on request) to avoid a
burst of LLM calls when an old session opens.

### Phones get the bar at the bottom (2026-10-31)
User, after the composer merged into the top bar: "the fix for mobile should be that the whole
navbar should be at the bottom". On every page at <=640px the bar is a bottom bar (thumb reach
for the mic and navigation); desktop and tablets keep it at the top.

### The composer merged into the top bar (2026-10-31)
User: merge the navbar and the bottom prompt bar to save room. The prompt became the page heading
(the session title, which mostly repeated the prompt's topic, moved to the line under it). The
prompt stays visible while recording, because the learner talks about it; the live level and
progress go beside it (desktop) or in the bar's second row (phones). Navigation folds into ☰ under
900px of bar width rather than only on phones. Trade-off noted: on phones the mic is now at the top
of the screen instead of under the thumb.

### The Feedback bookmark is a paper tab on the sidebar's edge (2026-10-31, replaces the ribbon below)
User: the bookmark pokes out from the side, attached to the sidebar, tucked behind it while open and
untucked with animation on collapse; it must be paper (not a satin ribbon) and poke out less. Hence a
30px divider tab under the sidebar, riding its edge. The error filter keeps neo's round track and
keys (the user asked to undo squaring them); the stats/close keys beside it stay 4px.

### Collapsed Feedback is a bookmark, not a rail (2026-10-31)
User: collapsing should hide the panel completely, leaving only a bookmark poking out with the error
count. The 64px desktop rail and 36px tablet handle are gone; the takes get the full width. The
ribbon hangs from under the top bar at the right gutter (above the paper timeline, right of the
cards) and is teal at zero errors so a clean take does not look alarming.

### Feedback panel follows the user's notebook mockup, adapted (2026-10-31)
Kept from the mockup: notebook page, pinned header with paperclip, icon-only inset filter track with
badges, taped white cards with one-line corrections, bottom-sheet stats in one row. Adapted: the
by-type filter (no place in the mockup) lives behind the header's filter name; a close control was
added (the panel collapses on desktop and is a sheet on phones); the panel's duplicate playback
buttons were removed; app fonts and tokens replace Lora/Google Fonts; dark-mode variants added; the
mockup's centred 420px demo container does not apply (the panel is already a 330–440px column).
**Trap found:** the root layout styles `:global(.paper-key)` (the hidden paper-texture canvas) with
`visibility: hidden; pointer-events: none`; any element given class `paper-key` vanishes and leaves
the accessibility tree. Header keys use `header-key`.

### Jumps and locks use the stack's timed scroll, never native smooth scrolling (2026-10-31)
User: a timeline click took too long and the card crawled "at the speed of an ant" into place. That
was `scrollTo({ behavior: 'smooth' })`: long distances and a long ease-out tail. Timeline jumps,
clicks on the pile and the lock after a scroll now call `animateTo` (stack positions, easeInOutCubic)
with `240ms + 45ms × cards`, capped at 650ms. Measured: neighbour 315ms, 19 cards 645ms, the last
30px in under 20ms; a wheel notch is locked on the next card within ~465ms. The new-take drop keeps
its deliberate 1050ms.

### The pile scrolls like text: down digs into older takes (2026-10-31)
User: inside a long card scrolling is "inverted" relative to the cards. With the demo's mapping,
scrolling down moved the text up but dropped the next card down. Rather than change the look (cards
still drop from the slot, newest on top), the mapping is reversed: scrolling down lifts the top card
up and away (older takes beneath), scrolling up drops newer ones back. Both motions now follow the
wheel and the finger, the newest take is at scroll 0 (no scrolling to the end on load), and the
timeline lists newest first so its dot moves with the scroll. The demo's position math is otherwise
unchanged (only `scrollProgress` is mirrored).

### Translations sit on a yellow sticky note (2026-10-31, replaces the plain notes below)
The plain margin-labelled lines were too subtle: on a ruled card they read as the take's own text
(user, angrily: "no UI to indicate that these phrases are now translation"). The section is now a
sticky note stuck on the card (own pale-yellow paper over the rules, bottom lift, folded corner,
amber "Translation" header and labels; dark: muted olive paper). Note: the user's screenshot of the
plain version also showed the *old* markup without its old CSS, a half-applied hot update in their
tab; the dev server was serving the new component. A reload fixes that state.

### Translations are notes on the card, not boxes (2026-10-31)
User: the translation UI "is really bad and does not match". Teal-tinted rounded boxes and raised
chips read as a different app on the paper cards. Variants are now margin-labelled lines in the
explanation's ink, toggles are pencil-underlined text, the word breakdown is a notebook vocabulary
list. The follow-up's Show English uses the same `.pencil-link`.

### Phones: secondary panels open from the top bar; 36px touch floor (2026-10-31)
User: the phone timeline strip and the Feedback handle took too much room, the prompt card was too
big, the buttons were too big, the bar too tall. On phones the timeline and Feedback are top-bar
buttons (the paper drops from the top of the stage; Feedback stays the existing bottom sheet), the
composer is a single row with icon-only round actions (their labels become `aria-label`s), and
Exam/Casual lives in the ⋯ menu. The touch floor is 36px, deliberately under the 44pt/48dp
guidance, because the user asked for smaller buttons; it is one token (`--touch-target`) to raise
again. The timeline toggle carries `data-timeline-toggle` so the paper's outside-tap close does not
fight it.

### Attempt cards are paper index cards (2026-10-31)
User: "the cards need to look like they're made of paper; the theme is stationery, paper, DIY". The
paper lives on AttemptCard (the card's own look) and the tape and shadow on the pile's shell
(physical placement). Ruled lines are a body background so they scroll with the text; they are
faint enough to read as texture, since text sizes do not line up with them.

### Navigation moved from the rail into a per-page top bar (2026-10-31)
User: remove the vertical navbar, move its buttons into the top bar (which had a lot of empty space),
free the rail's width; and "the whole app needs to work on a phone". Only Practice had a top bar, so
`AppHeader.svelte` is shared and **each page renders its own** rather than the layout owning one: a
layout-wide bar would have pushed the Feedback panel down by its height, while a page-level bar sits
above the attempt stack only. Navigation is on the bar's left so it stays in the same place on every
page (a right-aligned cluster would jump between Practice's stage column and the full-width pages).
Icon keys with tooltips, as on the rail; text labels did not fit Practice's 694px stage at 1024px.
Phones keep the disclosed ☰ menu, now inline at the bar's end instead of a fixed overlay. Measured
at 1280×900: the attempt stage grew from 833px to 883px wide and the bar is 67px (the old session
header was 79px).

### Timeline hover: hover the static sheet, move only its inner lift (2026-10-31)
The hovered element itself slid 12px left and scaled, so a pointer near its right edge ended up
outside it, the hover ended, it slid back under the pointer, and it looped. Hover now lives on an
outer element that never transforms; the visual lift is a child (the hover still covers the moved
paper, because hit-testing a transformed child counts for its ancestors). Touch gets an explicit
tap-to-open state, and `:hover` expansion is limited to `(hover: hover)` so phones do not get sticky
emulated hover.

### Selections are drawn as a highlighter, per token (2026-10-31)
User: "the selection highlight should be like an actual highlighter". `::selection` and the Custom
Highlight API only allow colours, not shapes, so the native selection colour is made transparent and
the selected words are inked with classes on their own elements. Wrapping the range in one `<mark>`
was rejected: re-parenting the word nodes would destroy the live selection (it is anchored in them).
So every token keeps its element (gaps became spans), the band is identical on each so it joins without
seams, and only the first and last tokens get the pooled ink and the chisel `clip-path`. The ends
overrun the words by 0.22em using a negative margin plus equal padding, so layout never shifts. A
stroke that wraps keeps flat ends at the line break (detecting wraps was not worth it).

### Attempts are a stack of index cards with a paper timeline (2026-10-31)
User request, from their HTML demo (`~/Downloads/card-scroll+timeline-component.html`): takes drop
from a slot under the header onto a pile; the card beneath blurs only after the drop is 35% along
(not linear); a torn aged-paper timeline on the right is the mini-map. The demo's scroll math is kept
as-is in `components/cardStack.ts` (`stackPosition`, `cardPose`, `scrollTopForCard`). Adapted to the
app: the scroll container is the Practice stage, not the window (so no `--header-height`; the
session header is already fixed above it); cards are capped to the stage and scroll inside
themselves (takes run to 5 minutes; the demo's cards are short); the timeline sits on the stage's
right edge with room reserved beside the cards, and is hidden under 560px of stage width.
Additions the demo lacks, each for a reason:
- **Locking onto a card when scrolling stops.** Free scrolling left half-dropped stacks, and a tall
  card on top could capture the wheel mid-drop. CSS `scroll-snap-type: y mandatory` was tried first
  and dropped: Chromium's precise wheel deltas snapped straight back (one 100px notch never moved a
  410px card) and WebKit's behaviour differs again. A JS lock 120 ms after the last scroll event
  (`lockedCard`: >10% of a card in a direction goes on, less falls back) works the same everywhere;
  a held finger/button defers it.
- **The card on top is the selected take** (supersedes "scrolling never selects an attempt", which
  made sense for a list with several visible cards).
- **Buried cards fade out past depth 3** and stop being painted, so a long session does not composite
  dozens of 8px-blurred layers; tall deep cards would otherwise also stick out of the pile.
- **The timeline's drop shadow is a `filter: drop-shadow` on a wrapper:** the demo's `box-shadow` sits
  under a `clip-path` and is clipped away, so it never showed.
- Arrival animates in stack positions, not pixels: the composer changes height as the take lands,
  and the stage's resize otherwise derailed the drop (seen as a stutter in testing).
- Fonts are self-hosted (`@fontsource/caveat`, `@fontsource/courier-prime`, OFL); Linux has no
  Courier New or Caveat, and no font CDN is allowed.

### Selection snaps to whole words; touch keeps native handles (2026-10-31)
A word is the atomic unit (user request: like double-click-and-drag). With a mouse the app owns the
drag (preventDefault on mousedown, word under the pointer via `elementFromPoint`, native selection
set to word boundaries), so the selection is word-granular while dragging, still a real selection
(copy works), and a press under 4 px of movement stays a click that plays the word. On touch, taking
over the gesture would break scrolling, so the long-press handles stay and the selection is snapped
to whole words after a 350 ms pause. The "skip the next click" flag expires after the current input
event, because a drag that ends on another word sends its click to their parent, not to a word.

### Phrases: model-found expressions plus any range the learner selects (2026-10-30)
Word-by-word glosses mislead on multi-word units ("il y a" = "he there has", "pommes de terre" =
"apples of earth"). The gloss call returns expressions with the words; a first prompt over-grouped
ordinary phrases ("avec ma sœur", "nous avons acheté"), so the rule now says an expression is only one
whose word-by-word reading is wrong, with counter-examples, and the label always keeps the hovered
word's own meaning on a second line, so grouping never hides a word. Custom ranges use the native
Selection API (mouse drag, double-click, phone long-press handles all work) mapped to word indexes
via `data-word-index` + `range.intersectsNode`, read after a 350 ms settle; the label goes below a
selection, clear of the phone's selection menu. A drag-select inside a card no longer selects/lifts
the card (`AttemptStream.selectCard` ignores clicks with a non-collapsed selection in the card).
Stored format changed to `{ words, phrases }` per text; the first word-only format is treated as not
fetched, so those takes are glossed again once.

### Word meanings come from the learner's LLM, once per take (2026-10-30)
Hover translations must be in-context ("allé" → "went") and text may leave the device only through
the learner's configured endpoint, so a dictionary API is out. The first hover glosses every word of
the take's texts in one call (numbered words in, `{ texts: [{ glosses }] }` out, padded/cut to the
word count so indexes always align) and stores them on the attempt. Lazy, not per take: a gloss call
right after each evaluation would compete for Groq's per-minute budget and cost tokens for takes
nobody hovers. Mistaken words get the likely meaning in brackets ("[went?]"). Only one label shows at
a time (a module-level owner in `Transcript.svelte`), and it is portalled to `<body>` because cards
sit in a scrolling, 3D-transformed list.

### The explanation speaks like a teacher; the app checks each line (2026-10-30, revised)
Composing every sentence from a template ("You said X. Say Y: Incorrect article usage …") read like
a report (user feedback). Now the model writes the words: `explanation: { note, mistakes: [{ said,
say, line }] }`, where `line` is one natural spoken sentence (≤25 words) and `note` an opening
reaction (≤15 words, never previewing a mistake). The app still validates `said`/`say` (identical,
overlapping, more than three → dropped), keeps a line only if it names the fix and stays under 40
words, adds missing `<wrong>`/`<right>` highlights, and otherwise falls back to a plain sentence
("You said …; say … instead."). Prompt examples must not match a real learner sentence: the model
copied an example's wording verbatim when the input was the example's own scenario.

### The explanation is composed by the app from the model's mistake data (2026-10-30)
Free-text explanations produced, in testing and for the user: "You said X. Say X" (an unclear
phrase reported as a mistake), "Say  (remove it)" (empty fix), invented fixes, and the same mistake
twice. Prose cannot be validated, so the model now returns `explanation: { mistakes: [{ said, say,
why }], note }` and `composeExplanation` (`adapters/llm/explanation.ts`) drops fixes with the same
words (`sameWords`), mistakes overlapping one already named (`overlappingWords`), keeps three, and
writes "You said <wrong>…</wrong>. Say <right>…</right>: why." / "Leave out <wrong>…</wrong>: why." /
the note / "That was all correct." The fixed English phrases are the language of instruction's;
another instruction language means translating them. Corrections with the same words as their
original are dropped too. A model that still returns prose is accepted as markup. Stored format is
unchanged. Remaining variance is judgment (whether an odd phrase is a mistake), not broken output.

### Replies auto-play reliably: prime the player in the tap, never fail silently (2026-10-30)
WebKit (Safari, the Tauri desktop webviews) lets an element play sound on its own only after it
played inside a user gesture; the app's `play().catch(() => {})` hid refusals. Start and Stop now
call `primeAudioPlayback()` synchronously (0.1 s of silence on the shared element, once, ignored by
the player state), and a `NotAllowedError` shows "Tap ▶ to listen". Verified: real take under
Chromium's normal policy auto-plays; the refusal notice with a stubbed `play()`. Playwright's
scripted calls count as user activation, so a real WebKit refusal was not reproducible here.

### An attempt has three spoken tracks; the explanation is tagged text (2026-10-30)
- **You said** speaks the transcript verbatim (mistakes included) with the target voice.
- **Did you mean to say?** is `correctedText`: the learner's sentence with every error and warning
  fixed, natural but faithful (no added/dropped content, no optional suggestions); identical to the
  transcript when nothing needs fixing, in which case the row is replaced by a "Correct" pill. It
  replaced the free `naturalSpeech` rewrite, which could differ even for a correct take.
- **Explanation** is in the language of instruction (`translationTarget`), ≤60 words, the three most
  important mistakes, and always ends with a target-language follow-up question. Every
  target-language span is wrapped in `<wrong>`, `<right>`, `<key>` or `<ask>`: the tags drive the
  highlights and mark language, so a future local voice can route tagged spans to the target voice.
  Inline tags were chosen over a JSON segment array: fewer tokens, natural for LLMs, and a tolerant
  regex parser (unknown/unclosed/nested tags dropped) keeps malformed replies readable.
- Storage: migration 7 **adds** `explanation` and copies `summary`; `summary`/`natural_speech` stay
  as unused columns so an older app version can still open a synced database (renaming would break
  it). The explanation auto-plays after a take; without cloud TTS the correct version plays.
- The follow-up question is its own field, `followUp: { question, translation }` (migration 8), not an
  `<ask>` tag: the translation (language of instruction) is hidden until the learner reveals it, so
  they try the target language first. The spoken explanation ends with the question; the translation
  is never spoken. Old `<ask>` markup is still parsed and lifted into the same block.
- Explanation audio is **cloud-only** for now (user decision, 2026-10-30): Piper voices only speak
  the target language, and the user will decide the local approach.

### ElevenLabs: free plans cannot use Voice Library voices; no hard-coded voice ids (2026-10-30)
Free accounts get HTTP 402 `paid_plan_required` for library voices. `/v2/voices` gives no plan
requirement (`available_for_tiers: []`), but library copies carry `sharing.status: "copied"`. The
picker therefore reads the plan from `/v1/user/subscription` and hides those on `free`. The old
"built-in" ids were wrong by now: `21m00Tcm4TlvDq8ikWAM` (Rachel) resolves to "Janet",
`AZnzlk…` to "Elara", `MF3mGy…` to "Peter", `TxGEqn…` to "Craig" (all paid library voices). Premade
voices (category `premade`) work on every plan; the default is Alice `Xb7hH8MSUJpSbSDYk0k2`.
Because a key restricted to text-to-speech cannot read its plan, library voices are listed only when
the plan is **known** paid, and a 402 at speech time self-heals (remember the key, switch to Alice,
retry, toast) rather than surfacing an error after the learner has spoken.

### Usage monitor: provider granularity, labelled sources, counted where unreadable (2026-10-30)
Limits are shown the way providers enforce them (Groq/OpenAI per model per organization,
ElevenLabs/DeepSeek per account). Browsers cannot read `x-ratelimit-*` (not CORS-exposed), and even
the headers never carry tokens/day or audio limits, so a device-local ledger counts usage against
Groq's dated published limits; live headers (Tauri), refusal bodies and account APIs override counts
where available, and every figure says which source it is. Linear refill (measured) ages readings.
Groq is shown **per model** with a picker defaulting to the model in use (user request), because
each model has its own budget and ceilings; Groq's Free and Developer tables are both kept and the
plan is inferred from live headers. The ledger lives in `localStorage` keyed by a key hash, never the
synced DB. Estimates convert
limits into takes/read-alouds/minutes because that is the decision a learner makes. A rejected
alternative was a "Check now" probe call: in the browser it cannot read the headers either, and on
desktop every real call already refreshes them.

### A voice list is a modal, not a dropdown (2026-10-25)
An ElevenLabs account can hold 100 voices and every option needs a metadata line, so a popover grew
taller than the section it belonged to and covered the API key, model and preview. Voices therefore
use `components/settings/VoicePicker.svelte`: a compact row trigger (selected name + one detail line)
that opens a dialog with a search field, a scrolling list and a pinned footer for the section's own
actions plus Done. Rules that come with it:
- Only the list scrolls; the dialog caps at `min(38rem, calc(100dvh - 4rem))` so a short phone
  viewport still reaches Done.
- Arrow keys/Home/End walk options; Home/End stay with the text field while searching.
- The search field auto-focuses **only on `pointer: fine`**. Auto-focus on touch opens the keyboard
  over a list the learner is usually just scanning. neo's dialog focuses its first control after a
  100 ms debounce, so the focus call waits ~130 ms and backs off if focus already moved inside.
- The 12px detail line cannot use `--muted-foreground`: it measured 3.91:1 on the tinted selected
  row in light mode. It uses `color-mix(in srgb, var(--foreground) 62%, var(--muted-foreground))`
  (7.65–9.93:1). Any future small secondary text on a tinted surface needs the same check.

A plain `SettingSelect` is still correct for short, label-only lists (provider, model, level).

### Settings hydration never reverts a choice the learner just made (2026-10-25)
`initSettings()` reads the database on startup and after a restore, then assigned the whole snapshot
with `store.set(loaded)`. On a cold start the read takes long enough that a click on a Local/Cloud
switch could land first and be silently undone, which is a real data-loss-shaped bug (the learner
sees the toggle move back, and the next render disagrees with what they chose). Settings now:
- records any field that changed while `hydrated` is false (`pending`),
- re-applies those fields over the loaded snapshot,
- sets `applying` around the hydration write so it is never persisted back (which would bump the
  sync revision right after a download).

Every write to settings in the app is user-initiated (`setSetting` from a control, or the first-run
picker), so nothing in the background can sneak into `pending`. The `hydrated` gate still keeps
defaults for fields a restored database lacks from being written.

### Each step is Local or Cloud; no global preset (2026-10-25)
The app names the three steps **Speech-to-text**, **LLM** and **Text-to-speech** (the internal
`sttMode`/`correctionMode`/`ttsMode` names are unchanged). They are independent choices:
- **Speech-to-text:** Local Whisper, or Cloud Groq `whisper-large-v3-turbo`.
- **LLM:** a cloud LLM (Groq/DeepSeek/custom), or a **local OpenAI-compatible server**
  (LM Studio, llama.cpp, Ollama, vLLM, …). The local option is an endpoint, not an embedded model;
  its key is optional. `chatCompletion`/`listModels` do not require a key, and the LLM client
  uses the Tauri HTTP plugin on desktop so a local server does not need CORS.
- **Text-to-speech:** Local Piper, **ElevenLabs**, or an OpenAI-compatible speech API (OpenAI
  official or a local server). Both cloud providers remain first-class. Their keys, models and
  voices are stored in separate fields (`elevenLabsModel`/`elevenLabsVoiceId` vs
  `ttsApiBaseUrl`/`ttsApiModel`/`ttsApiVoice`) so switching never destroys the other setup.
  ElevenLabs uses `POST /v1/text-to-speech/{voice_id}` with `xi-api-key`, `eleven_multilingual_v2`
  (or turbo v2.5), and `output_format=mp3_44100_128`; voices come from `GET /v2/voices`. The MP3 is
  decoded with `AudioContext` and cached like every other spoken reply.

`stores/processing.ts` derives the requirements; the Settings rows, download footer and Practice gate
all consume it, so they cannot disagree. `stores/languageData.ts` checks/downloads **only the local
parts the current choices need**; cloud-only setups need no speech downloads.

**No global preset.** The earlier Balanced/Cloud/Private shortcuts were removed: a preset hid the
per-step choice the learner is actually making. Settings has two tabs, **Learning** and **Data**;
Learning contains the language card and one row per step. Each row has a Local/Cloud segmented
control and an inline disclosure; the rows are independent, only one detail is open at a time, and
changing a row's mode opens that row. The disclosure uses a `0fr`/`1fr` grid transition so the
detail components stay mounted, and the inactive detail is `inert`. The first-run picker asks for
the three Local/Cloud choices after the language. Practice links to `#speech-to-text`, `#llm` or
`#text-to-speech`; the older `#transcription`, `#ai-provider` and `#voice` anchors still focus the
same rows.

**neo-svelte 1.2.0 trap:** a `NeoSelect` (our `SettingSelect`) sets `indeterminate`/`focused` in its
cleanup, which Svelte rejects as `state_unsafe_mutation` if it unmounts during a tab/mode switch.
Keep tab content and the correction/read-back branches mounted and hide inactive ones with CSS.
Transient **model** lists use a text input plus clickable fetched options instead of swapping in
a select (voices use the `VoicePicker` modal, see above). This is why the Settings page uses
`class:hidden` rather than `{#if}` for those regions.

### Cloud sync is a whole-database snapshot with a content revision (2026-10-25)
Sync moves the same `.sqlite` image as Export/Import. Both sides are compared before anything is
written; upload is safe, and a download (which replaces local data) needs an explicit choice.
Change detection uses a **device-local monotonic revision** in `localStorage`
(`src/lib/adapters/db/revision.ts`), bumped by every `SqlDatabaseAdapter` write that changes learner
data; `setSyncMetadata` does not bump it. `sync_metadata` still stores the remote id/etag and a
readable copy of the revision.

Byte hashing was tried and rejected: three consecutive exports of an unchanged database differed in
the header change counter (offset 24) and free-page contents (~90 bytes), so a raw-image hash always
looked like a local edit. A logical fingerprint would work but costs a full dump on every sync; the
counter is exact and O(1). The synced revision is captured **before** an upload so a write during
the transfer is caught by the next sync. A download goes through `importSqliteBytes()`, which
reuses the restore header/schema checks, storage pre-check, rollback and rehydration; the native
path additionally scans the schema text (`isOnspotDatabase`) because only the web worker validates
with SQLite itself.

### Google Drive sync: appDataFolder, desktop loopback PKCE, web Google Identity Services (2026-10-25)
The backup lives in `appDataFolder` with the `drive.appdata` scope, so it is app-private and does
not appear in the learner's normal Drive listing. Upload is resumable because the database carries
base64 audio.

Desktop uses the installed-app authorization-code flow with PKCE and a loopback redirect:
`src-tauri/src/oauth.rs` binds `127.0.0.1:0`, the system browser handles consent, and the webview
exchanges the code and keeps a refresh token in `localStorage`. The **web build uses Google
Identity Services' token client** instead: Google's public web clients cannot exchange an
authorization code without a client secret, so PKCE is not available there. That is the one
deliberate deviation from the inception's "PKCE" wording; the web token lasts about an hour and the
learner reconnects. Client ids are build-time (`VITE_GOOGLE_CLIENT_ID_DESKTOP/_WEB`), not secrets.
Mobile Drive sync is deferred; the UI hides it on Android/iOS.

### WebDAV: `webdav` in the browser, Tauri HTTP transport elsewhere (2026-10-25)
The browser uses the `webdav` package and therefore needs the server to allow the app origin via
CORS. `webdav@5.10` imports `@buttercup/fetch` directly and exposes no transport hook; a Tauri
webview `fetch` is subject to the origin policy, so the desktop/mobile path implements only
PROPFIND/MKCOL/PUT/GET over the Tauri HTTP plugin. Basic auth credentials live in `localStorage`,
never in the synced database. The HTTP capability is broad (`https://*`, `http://*`) because the
learner supplies the server URL; keep it in mind when reviewing permissions.

### iOS is deferred, not partially built (2026-10-25)
The inception lists mobile as a later iteration. Android is built and verified; iOS needs macOS +
Xcode, `tauri ios init`, microphone usage descriptions, code signing and a whisper.cpp CMake build
for iOS. This Linux machine cannot produce or test any of that, so there is no iOS project and no
claim that it works. `currentRuntime()` reports `ios` and Google Drive is hidden there so the shared
code is ready. See `docs/architecture/platforms.md`.

### Linux desktop microphone: the app grants WebKit's user-media requests (2026-10-06)
WebKitGTK (the Linux Tauri webview) denies `getUserMedia` unless the app handles its
`permission-request` signal; the desktop app showed "Not allowed: the microphone".
`src-tauri/src/microphone.rs` (Linux only) enables media streams and allows only
`UserMediaPermissionRequest`s. Windows/macOS/Android use the OS prompt. Verified via tauri-driver.

### bun is the package manager; Node stays the runtime (2026-10-06)
`bun install` / `bun run` / `bunx` replace npm (lockfile migrated from package-lock.json with
identical top-level versions). The benefit is install speed and one tool; it does not affect the
app (WebView + Rust). Vite/SvelteKit are not run on the bun runtime (`--bun`): SvelteKit 3 / Vite 8
were freshly migrated and the app leans on workers, WASM and Tauri, so that is risk without gain.
The four packages with install scripts (sharp, onnxruntime-node, protobufjs, @parcel/watcher) were
already blocked under npm 12 and are equally skipped by bun; the app needs none of them. CI uses
oven-sh/setup-bun.

### STT: native whisper.cpp in the desktop and Android apps (2026-10-04)
The apps run whisper.cpp natively through the in-repo Tauri plugin `src-tauri/plugins/speech`
(whisper-rs 0.16, `ggml-small-q5_1.bin`, 190 MB). Measured: WER 5.8% on desktop and phone,
rtf ~0.75 on the phone (S24 FE) and below 1 on a busy laptop, ~600 MB for the whole Android app
with the model loaded, against ~1.9–2.1 GB extra for Transformers.js. The browser build keeps
Transformers.js. `src/lib/speech/stt/localEngine.ts` is the only place that picks the engine.
Supersedes the 2026-09-30 "stay on Transformers.js" and the WebGPU-spike decisions. CPU only for
now; Vulkan is a later step.

### Android IPC and TLS traps (2026-10-04)
- Android's Tauri IPC has no binary channel: a `Uint8Array` body reaches Rust as a JSON array of
  numbers, not `InvokeBody::Raw`. `commands.rs::body_bytes` accepts both.
- reqwest's default rustls platform verifier panics on Android without a JNI init step (download
  hangs at 0%; a release build would abort). Model downloads use bundled Mozilla roots
  (`webpki-root-certs` + `tls_certs_only`).
- Tauri rejects commands with the Rust error as a *string*; the practice screen only shows
  `Error` messages, so `nativeEngine.ts` rethrows strings as `Error`.

### LLM: GPT-OSS uses reasoning_effort=low (2026-10-04)
At default effort gpt-oss-120b's reasoning used ~2100 of the 3072-token evaluation budget and the
JSON answer was truncated (`json_validate_failed`). `client.ts` sends `reasoning_effort: 'low'` to
GPT-OSS models only: 3/3 valid, ~4 s.

### STT on WebGPU: whisper.cpp + ggml WebGPU passes on desktop, blocked on Android (2026-10-04)
Spike on branch `spike/whisper-webgpu`: 190 MB vs 299 MB, +0.57/+1.0 GB vs +1.9/+2.1 GB RAM,
rtf ~0.2 vs ~1.9, WER 5.8% vs 5.5% (docs/benchmarks/stt.md). Not yet adopted: Chrome/WebView
blocklist WebGPU on many Android GPUs (Samsung Xclipse confirmed), and the WebView lacks
cross-origin isolation. Adopting it needs a fallback plan for Android (native whisper.cpp in
Tauri, or Transformers.js). Ratchet rejected (dormant since 2024-11); Candle official WASM is
CPU-only.

### SvelteKit 3 migration (2026-10-04, branch `migration`)
Migrated with `npx sv migrate sveltekit-3 --tasks all`. Kit 3.0.0, adapter-static 4, Svelte
5.57.1, Vite 8.3.2, vite-plugin-svelte 7.3.1. TypeScript stays 6.x: Kit 3 and svelte-check peer
`^6` (npm `latest` is 7). Imports use `#lib/...` (package.json `imports`) with explicit
extensions (`.js` for `.ts` modules, `.svelte`); `$lib` no longer exists. tsconfig extends
`$app/tsconfig`, includes `src` + `vite.config.ts`, and excludes the vendored piper-plus glue
`.js` (the new base config type-checks it; it must stay byte-matched, its `.d.ts` types it).
Other deps deliberately not bumped: Tauri JS plugins must track the Rust crates' minor versions,
`onnxruntime-web`/transformers need browser re-verification, `piper-plus`/neo are pinned.

### Practice requires a configured LLM before recording (2026-10-03)
User decision: Start speaking is replaced by "Add API key" (→ `/settings/#ai-provider`) until the
selected provider is usable — Groq/DeepSeek need a key, custom needs URL + model (key optional).
Every take is evaluated by the LLM, so recording without one only fails after the learner speaks.
`startRecording()` enforces the same rule.

### Wrong-language takes are one whole-transcript error (2026-10-03)
User decision: answering in another language must never read as a "Clean take". The LLM reports
`spokenLanguage`; `normalizeEvaluation` replaces the corrections with a single grammar error
("Answered in X instead of <language>") so totals and Insights count it. No schema migration.

### STT runtime: stay on Transformers.js, not whisper.cpp / wllama (2026-09-30)
wllama is llama.cpp for GGUF LLMs; it cannot run Whisper or Piper and there is no local LLM.
whisper.cpp (`@transcribe/shout`) was measured on `/stt-bench/`: ~0.6 GB browser PSS vs
~2.4 GB, 190/264 MB vs 299 MB, q8_0 same WER on eval2 — but rtf 14.6 (q5_1) / 22.7 (q8_0)
against 1.81 on the same machine, and it needs SharedArrayBuffer (absent in the Android
WebView). Evidence: `docs/benchmarks/stt.md`. Revisit only if a WASM whisper.cpp build is
shown to run near real time.

### Japanese TTS: piper-plus engine, not Piper + jpreprocess (2026-09-25)
No jpreprocess WASM exists for the browser; the official Piper Japanese voice needs Piper 1.7's
own OpenJTalk scheme and is non-commercial. piper-plus (MIT) ships exactly the requested
technology (jpreprocess/OpenJTalk G2P in WASM + VITS) and MIT/Apache/PD-data voices. It runs as a
second adapter in the existing TTS worker on our ORT instance; its `PiperPlus` class is not used
(it re-downloads without cache/progress and silently drops Japanese if G2P fails). The 60 MB
phonemizer is fetched from unpkg and SHA-256-verified, never bundled.

Settled calls and the evidence behind them. Reversing one needs new evidence, not a hunch. Raw
measurements live in `docs/benchmarks/`; the summaries below link there rather than repeat tables.

## STT model: `whisper-small q4` (299 MB)
5.5% aggregate WER over three clips, stable across them (4.5-6.8%). The alternatives:
base fp32 9.9%, base q4 11.0%, French fine-tune 21.7%. Costs rtf 1.48 — slower than real time,
accepted because transcript quality is what this app needs.

## Long-form decoding: sequential windows, not pipeline chunking
Transformers.js' overlap merge drops whole chunks without timestamps and swings from 8.0% to
63.2% WER over a two-second stride change; `stride >= chunk/2` never terminates. Sequential
windows seeking to the last emitted timestamp: 7.2%, and ~2x faster.

## Device: WASM, not WebGPU
WebGPU is available here and builds sessions, but returns 92% WER at q4 and 68.8% at int8
against 9.6% on WASM. This reverses an approved decision; the approval was conditional on
quantized weights needing WebGPU, and they do not.

## Precision: q4 only
int8/uint8/q8 all fail to build a session — one broken export under three names, with a 4-bit
`embed_tokens` missing its scale. Confirmed across `whisper-base`, `whisper-base-ONNX` and
`whisper-small`. fp16 fails separately (no float16 path on WASM).

## TTS voice: `Piper Tom (M, medium)`, decided by listening test
STT-style benchmarks (rtf, round-trip WER) measure speed and intelligibility, not how a voice
sounds — so the TTS choice was made by ear, not by the numbers `docs/benchmarks/tts.md` tracks.
Ranked 2026-09-13: 1) Piper Tom (M, medium) — needs an EQ boost in the high end and more
loudness; 2) Piper UPMC, jessica (#0); 3) Piper Siwis (F, medium); 4) Piper UPMC, pierre (#1).
`Piper MLS (medium)` (125 speakers) kept unranked for later individual auditioning. Removed
from the registry entirely (not just unranked): `Piper Siwis (F, low)`, MMS-TTS French at all
three precisions, Audio8 TTS 0.6B (remote), Web Speech API — each lost the listening test or a
technical gate. Their evidence stays in `docs/benchmarks/tts.md`.

## Rejected: `whisper-small-cv11-french`
Best single-clip score of any model (2.4% on set1) and the worst aggregate (21.7%). Truncates,
emits filler dots, mangles proper nouns. Kept out of the registry with a comment saying why.

## Rejected: Kokoro-82M for French
kokoro-js ships a frozen English-only voice registry; `ff_siwis` downloads but cannot be
registered. Its own model card grades French **B- on <11 hours**, a single voice. Its G2P
dependency (`phonemizer`) is English-only too.

## Rejected: Matcha-TTS
No French model exists anywhere. sherpa-onnx's French offering *is* Piper.

## French G2P: `@diffusionstudio/piper-wasm`
The only browser eSpeak build carrying French data. 18 MB, gitignored, shared by every Piper
voice. Call it with the input as a JSON **array**; a bare object aborts with an opaque
emscripten pointer.

## Piper implemented directly, not via `piper-tts-web`
That package pins onnxruntime-web 1.20 and Transformers 3.3. With kokoro-js also present that
would be three Transformers copies and two ORT versions in one page.

## Separate ONNX Runtimes for Piper and Transformers.js
Sharing one via `globalThis[Symbol.for('onnxruntime')]` makes Transformers.js take a branch
that never populates `supportedDevices`, breaking every model load.

## One card per download
Voice, precision and repo differences are separate cards. Speaker-within-a-voice and OS-voice
pickers stay as card config, because they reuse the same weights.

## `eval/` is the single source of truth for test data
Discovered by `import.meta.glob`; never copied into `public/` or inlined into source. Four
genuine transcript errors in set1 and one in eval3 were corrected; `Et bien`/`Eh bien` was
deliberately left alone as contested and acoustically identical.

---

## Product architecture (Phase 1)

### SvelteKit SPA, not the Vite+Svelte starter
The inception requires `@sveltejs/adapter-static` with `fallback: 'index.html'` for a purely
client-side app. Migrated the root Vite project in place, keeping the adapters and utilities.
`prerender` is **false**: `prerender = true` makes adapter-static write a second `index.html`
that the fallback then overwrites.

### COOP/COEP via a Vite middleware, not `server.headers`
SvelteKit's Vite plugin installs its own dev/preview servers and drops `server.headers` /
`preview.headers`. A `configureServer`/`configurePreviewServer` middleware sets them instead.
Verified `crossOriginIsolated === true` in headless Chromium.

### DB abstraction: one CRUD layer over a `SqlDriver`
`IDatabaseAdapter` is implemented once in `SqlDatabaseAdapter`; Tauri and OPFS supply only a
driver. This keeps the two runtimes from drifting and keeps SQL out of stores/components.
`TauriSqlAdapter` translates `?` → `$1` (the plugin documents `$#` for SQLite). Audio is stored as
base64 `TEXT`, not `BLOB`, so both drivers behave identically. `export`/`import` are a portable
SQL dump; a raw `.sqlite` page image is a possible later optimisation for Tauri.

### OPFS uses the SAH-pool VFS in a Worker
OPFS synchronous access handles are worker-only. The SAH pool avoids the async-proxy worker and
is the current recommended backend. It works without cross-origin isolation, but isolation is
still required for ORT-Web `SharedArrayBuffer`, so both are kept.

### Arch linker pin
`src-tauri/.cargo/config.toml` sets `linker = "gcc"`. GCC reports `x86_64-pc-linux-gnu` while
Rust's host triple is `x86_64-unknown-linux-gnu`, so the toolchain looked for a non-existent
`x86_64-linux-gnu-gcc`. Scoped to the host target so other platforms are unaffected.

### API keys live in localStorage, not the database
The database is the thing that gets exported and synced to Google Drive / WebDAV. BYOK keys
(Groq, DeepSeek, OpenAI, HF) are therefore kept in `localStorage` under `onspot.key.*`
(`stores/secrets.ts`), and only non-secret preferences go in the DB (`stores/settings.ts`).
This is the same rule the lab already applied to the HF token: never commit it, never put it in a
`VITE_` variable.

### One OpenAI-compatible LLM client for Groq and DeepSeek
Both providers implement `POST {baseUrl}/chat/completions` with a bearer key, so a single client
(`adapters/llm/client.ts`) serves both plus any custom OpenAI-compatible endpoint. The evaluation
prompt requests `response_format: { type: 'json_object' }` but the parser also strips code fences
and scans for the outer `{...}`, because not every provider honours JSON mode.

### LLM output maps onto the prototype's four categories
The evaluation JSON has `corrections`, `vocabulary` and `connectors`, but only the four existing
correction categories (`grammar`/`register`/`filler`/`style`) are persisted, so the prototype's
insight columns and DB schema do not need to change. Vocabulary upgrades become `style`
suggestions; connector advice becomes `register`/`filler`.

### Local STT runs in a Web Worker
The lab left main-thread inference open because the tab froze hard enough that Playwright could
not click during a load. The product needs a responsive UI (live waveform, progress bar), so
`speech/stt/transformers/stt.worker.ts` now owns the pipeline and the decode loop; `WorkerWhisperAdapter` is the
main-thread proxy. PCM is moved in by transfer (the caller's array is sliced first, because a
transfer detaches the buffer). Verified: the worker imports Transformers.js and relays real
download progress with no main-thread block.

### UI: shadcn-svelte for primitives, prototype for layout
shadcn-svelte is installed (button, card, input, label, textarea, badge) and its `cn` helper plus
element-ref types live in `src/lib/utils/index.ts` (the registry imports `$lib/utils`). The
bespoke prototype look (rail, composer, serif transcript, feedback panel) is built directly with
Tailwind against the tokens in `src/app.css`, rather than forcing the prototype into stock
shadcn styling.

### No "target exam" setting
The prototype/settings originally carried a "Target exam" select (DELF B1, TCF, …). Removed at the
user's request: the LLM prompt now states only the CEFR level. The Exam/Casual *mode* is separate
and stays — it drives the register/filler advice and the exam-status badges.

### LLM model is an enum-backed dropdown, not free text
`adapters/llm/providers.ts` defines `LLM_MODELS` (the enum) and `LlmModelId`. The Settings model
field is a `<select>` per provider, plus a "Refresh model list" button that calls
`GET {baseUrl}/models` with the key and merges unknown ids in as "From your account". The custom
provider keeps free-text base URL + model inputs. Each provider carries a `note` and links
(`keyUrl`, `modelsUrl`) so a user who cannot see a model is told to enable it under Groq's Model
Permissions (or the equivalent) rather than being left stuck.

### DeepSeek model names moved on
The inception named `deepseek-chat` / `deepseek-reasoner`. DeepSeek's current API (checked
2026-09) serves `deepseek-flash` and `deepseek-v4-pro` (legacy names still accepted). The enum and
default use the current names.

### Settings has a real connection test
`testConnection()` in `adapters/llm/client.ts` sends the smallest possible chat completion
(`max_tokens: 16`, "reply OK") with a 20s timeout, rather than calling `GET /models`. That
exercises the exact path evaluation uses — auth, base URL and model availability together — and
returns the model's reply so the user can see it actually produced output. The endpoint is built
by `stores/llm.ts` `currentLlmEndpoint()`, now shared with practice evaluation instead of being
duplicated. Browser-verified: no key → "Add an API key first."; invalid key → Groq's 401
"Invalid API Key" is surfaced verbatim.

### Per-word pronunciation: synthesize on click and cache, do not slice the sentence
Clicking a word in the transcript plays it; hover only highlights. The tempting "synthesize the sentence once and split
the audio at word boundaries" needs forced alignment and fights French liaisons and the absence of
inter-word silence. Since Piper's VITS is deterministic, `stores/pronunciation.ts` synthesizes a
word once, caches the WAV object URL, and reuses it; `components/Transcript.svelte` renders each
word as a token with click and keyboard handlers. The
token approach also carries the correction colour instead of nesting correction markup around
already-hoverable words. `utils/highlight.ts` was deleted.

### A session's mode is locked once it starts
`PracticeState.mode` is the live mode. `setSessionMode()` is a no-op once `sessionId` is set, and
the header switch is disabled. `openSession()` restores the stored session mode. A draft session
can still switch, which also updates the default setting. The rail `+` button (`newSession()`)
clears the session and unlocks the mode. Evaluation now uses the session mode, not the global
setting.

### Translation display is controlled per attempt
The evaluation prompt returns translations in the normal call. Each attempt card owns its display
state and exposes a labelled Translate menu; the removed global Practice-header toggle no longer
controls every card. `translationMode` only seeds a card's initial view. DB migration v3 added the
legacy single `attempts.translation`; migration v4 added the JSON `attempts.translations` column.

### Provider model list: curated chat models + filtered live list
The old curated Groq list included Llama 3.1/3.3, which are Enterprise-only and 404 on a standard
key. The curated list is now `openai/gpt-oss-120b` (default) and `openai/gpt-oss-20b`. The
"Refresh model list" result is filtered to chat models — whisper (STT), orpheus (TTS),
prompt-guard/safeguard (classifiers) are removed. `stripThinking()` drops `<think>` blocks from
GPT-OSS replies before display and before JSON extraction.

### Provider errors are shown in full
`chatCompletion`/`listModels` kept only 300 characters of a provider error body, which cut the
actionable tail off Groq's messages. The cap is now 2000, and the UI wraps and scrolls the text
(`max-h-40 overflow-y-auto break-words whitespace-pre-wrap`) instead of clipping it.

### The LLM output cap is derived from 60s of fast speech
A learner answers for at most 60s. Conversational French is ~120-150 wpm and fast speakers reach
~200, so the liberal ceiling is **240 words** (200 wpm + 20% headroom), in `src/lib/config.ts`.
Transcripts are truncated to it (`capWords`) before evaluation, and `MAX_EVALUATION_TOKENS`
(2048) sizes the output budget: correctedText + naturalSpeech + English translation all mirror
the transcript, plus a short summary and a bounded correction list. Requesting far more than the
answer can contain is what tripped low output-tokens-per-minute provider limits (the
`Requested 1110, Limit 1000` 429).

### Phase 4 views: Insights, History polish, toasts
- `/insights/` (rail `BarChart3`) aggregates all attempts and corrections client-side
  (`src/lib/insights.ts`): 4 stat cards and recurring patterns grouped by `category|label`,
  style excluded. Clicking a pattern shows every occurrence grouped by session, with an
  "open session" jump. Data comes from a new `listAllCorrections()` on the DB adapter.
- History gained search (title + transcript), replay of the last recording, rename and delete.
  `deleteSession()` removes attempts, corrections and audio explicitly rather than trusting
  `ON DELETE CASCADE`, because the Tauri plugin may run statements on different pooled
  connections where `PRAGMA foreign_keys` was not set.
- A small toast store/component (`stores/toast.ts`, `components/Toasts.svelte`) gives feedback
  for those actions.

### Phase 4 finished: linked correction marks, regex history, header session actions
- `Transcript.svelte` now tags tokens with their correction id and takes `activeCorrectionId` /
  `onSelect`, so a mark highlights and selects its correction and the feedback row highlights the
  mark. **Trap:** the transcript sits inside the attempt's select `<button>`, so the mark click
  must `stopPropagation()` or the parent handler immediately re-selects the attempt and clears the
  correction.
- History search is a `{ sessions, error }` derived: literal substring by default, `RegExp` when
  Regex is on, case toggled; an invalid pattern returns the message instead of throwing, and
  literal matches are highlighted in the snippet.
- Practice header has rename/delete for the current session (`renameSession`/`deleteSession` +
  toasts); delete then starts a fresh session.

### Groq account model probe (2026-09-14)
One `max_tokens: 1` chat completion was sent to every model the key lists, to populate dashboard
metrics and read the `x-ratelimit-*` headers. Full results live in
[`docs/benchmarks/llm-providers.md`](../../../docs/benchmarks/llm-providers.md) — that file is
authoritative; do not copy its table here. Headlines: the gpt-oss/qwen tier is **8 000 TPM** (one
evaluation approaches it);
Llama 3.1/3.3 are Enterprise-only and absent from the account; `whisper-*` are STT, `orpheus-*`
are TTS (terms required), `prompt-guard` is a classifier. The key was read from a local file and
never printed.

### Attempt UX rollout: audio caching, translations, compact corrections
- **Superseded wheel prototype** (`components/AttemptWheel.svelte`): only the current attempt was
  interactive, neighbours are rotated/scaled/faded off-centre. Wheel/keyboard/chevrons move
  between attempts. It was replaced by `AttemptStream.svelte`; the current behavior is documented
  below.
- **TTS is cached in the database** (`speech/tts/service.ts`) keyed by
  `tts:<mode>:<voice>:<hash(text)>`. Repeats cost no model call and survive reload; changing the
  voice is a new key, which is what makes retroactive re-render work. `attempts.tts_voice`
  remembers the last voice used. Agent cards expose a "Play corrected audio" button, a
  sentence-segments toggle, and (local mode) a voice selector that re-renders.
- **Translations**: the LLM returns versioned variants stored as JSON on the attempt. Each card's
  labelled menu controls its own view; `translationMode` only supplies the initial view.
- **Corrections** now carry `replacementTranslation` so `ici → dans ce pays` also teaches what the
  replacement means. The card is compact: category + label + a speaker **icon**, old → new,
  the translation, then a short explanation.
- **Word audio no longer auto-plays on hover** — clicking a word plays it; hover only highlights.
- **Export my data**: Settings → Storage downloads a JSON of sessions, attempts, corrections,
  prompts, settings and base64 recordings (`utils/export.ts`). The TTS cache is excluded
  (regenerable).
- DB migration **v4**: `attempts.translations`, `attempts.tts_voice`,
  `corrections.replacement_translation`. The evaluation output cap rose to **3072** tokens for the
  extra translation variants.

### Superseded prototype: fanned vertical conveyor
After the centered wheel was rejected, `components/AttemptWheel.svelte` briefly used this design:
the **active attempt is flat at the top**, full width; the previous attempts sit **directly
beneath it** in the scroll flow, each rotated around its top edge (`rotateX(offset * 30deg)`,
`transform-origin: top center`) with decreasing opacity, forming a curved glance of the belt.
Scrolling/wheel/↑↓/chevrons/drag move the belt; changing attempts runs a `lay-flat` keyframe on
the newly active card. Cards use the full parent width (the earlier `max-w-2xl` centering is
gone). The wheel only rolls once the active card has hit its own scroll edge.

### Attempt list is a free-scrolling chat with a conveyor exit (superseded 2026-10-31 by the card stack)
The current design (`components/AttemptStream.svelte`,
replacing `AttemptWheel.svelte`):
- A normal `overflow-y-auto` **flat chat list**, oldest → newest, no fixed grid.
- Scroll-linked conveyor: a card gets `rotateX`/`translateY`/opacity only as its top crosses
  above the viewport top (`progress = -relativeTop / 150`), so old cards are pushed up and out
  with the curve, and scrolling back brings them down flat. Fully visible cards are flat.
- A **bottom spacer** = `viewportHeight - lastCardHeight - 24` makes the newest card settle at
  the **top of the viewport when scrolled to the end**, so only the current attempt is on screen.
- Scrolling is visual only and never changes the active attempt. Card click selects explicitly;
  adding a new attempt selects it and settles it at the top.
- New attempts measure the floor spacer, wait for layout, then animate to their final offset.

### Attempt stream: compositor animation, per-card translation, click-to-select
Fixes after the first stream attempt felt glitchy:
- **Animation moved to the compositor.** The per-frame JS transforms were replaced with CSS
  scroll-driven animation (`animation-timeline: view(); animation-range: exit 0% exit 100%`) on
  `.attempt-slot`, wrapped in `@supports`. Cards stay flat until they start exiting the top, then
  curve away; reversing is smooth. No JS writes transforms per scroll; a `ResizeObserver` only
  keeps the floor spacer correct as card content changes.
- **New-card lift uses a timed scroll, not native smooth scrolling.** Browser `behavior: smooth`
  has unspecified timing and snapped when the new card and floor spacer changed layout together.
  `AttemptStream` now eases `scrollTop` over 1050ms and adds a matching inner-card arrival; user
  wheel/touch/pointer input cancels it immediately. The scroll-linked 3D transform stays in CSS.
- **Per-card translation control is visibly labelled `Translate`**, not an icon-only action. Its
  menu offers Idiomatic / Literal / Word-for-word / Compare all three / Hide and explains the
  purpose of every variant. Every menu option remains selectable; choosing a view on an old or
  versionless set runs a focused translation request and persists a complete v2 set. The
  global header toggle was removed; the `translationMode` setting only seeds a card's initial view.
- **No horizontal scrollbar**: the stream is `overflow-x-hidden`; card wrappers, the article,
  translation and segment text use `min-w-0` / `break-words`.
- **Click a card** to select it and scroll it to the top, pushing the rest up; the handler ignores
  clicks that land on buttons/inputs/selects.
- **Scrolling never selects an attempt.** It only moves the conveyor. The feedback panel changes
  through an explicit card click or a newly-created attempt. The previous/next chevrons and count
  overlay were removed; they cluttered the stream and duplicated scrolling plus card clicks.

### Translation semantics are shared, versioned, and progressively disclosed
`adapters/llm/translationPrompt.ts` is the single source of truth for both the initial evaluation
and focused regeneration prompts. It defines idiomatic as native phrasing, literal as grammatical
English that preserves French lexical/structural choices, and word-for-word as exact token or
morpheme order even when the result is broken English. A contrastive `je m'appelle` example
requires `my name is` / `I call myself` / `I me call`, preventing providers from collapsing the
last two variants into the same polished sentence.

`TranslationSet.version = 2` marks output produced with these rules. Old/versionless sets are
regenerated when a translation view is chosen, even if their three legacy strings are non-empty;
incomplete initial-evaluation output remains versionless so a copied idiomatic fallback cannot be
mistaken for a valid literal or word-for-word result. The JSON DB column absorbs the extra fields,
so no SQL migration is needed. V2 also stores up to two meaningfully different idiomatic variants
and an ordered word/morpheme breakdown. The attempt card hides both by default and exposes them
with small disclosure controls; explicit regeneration stays inside the Translate menu.

### UI capture sandbox: clone-and-clean, preserve real interactivity
`docs/prompts/ui-capture.md` asked for a standalone capture of the chat-history UI for an external
AI. Two wrong turns were rejected and reverted:
1. Adding `expanded` / override props to `AttemptStream` and `AttemptCard` — instruments
   production code.
2. Stripping every `{#if}` and freezing the UI into a static "peak clutter" collage — destroys the
   interaction the reviewer needs to judge.
The standing rule is **clone and clean, keep it live**: copies live under
`src/routes/ui-sandbox/components/` as `Mock*` components that share nothing with production
(no stores, no adapters, no DB/LLM/TTS calls) but **keep** their Svelte state, `{#if}` blocks,
click handlers, hover tooltips and tab/toggle behavior. External calls are replaced with local
component state (simulated playback, simulated generation/spinners). `bun run bundle:ui` packs
only `src/routes/ui-sandbox/**/*.svelte`, so the bundle can never leak product code or become a
refactor target for files the product depends on. The sandbox is self-contained and can stay in
the repo indefinitely.

### External UI critique applied to the real components (2026-09-14)
The `ui-sandbox/` mock is only a repomix bundle for external UX review; the fixes were applied to
the live components, not the mock.
- **Active card state**: `AttemptCard` gets `border-[var(--brand)] ring-2 ring-[var(--brand-soft)]`
  when active; inactive gets a hover border.
- **Severity vs category colour**: `Transcript` colours marks by `severity`
  (error/warning/suggestion), not category; the feedback panel shows category as a neutral badge
  and severity as a coloured dot.
- **Offset-based corrections**: `Correction` gained `start`/`end` (migration **v5**), computed in
  `buildCorrections` when claiming distinct occurrences (no double-marking, no overlap); the
  transcript tags tokens by offset and falls back to claiming occurrences for legacy rows.
- **Real audio player**: new `stores/audio.ts` + `components/AudioBar.svelte` (play/pause, seek,
  speed 0.75/1/1.25×, loop, active segment). All practice playback routes through it; the old
  fire-and-forget `new Audio()` calls are gone. Segment rows show a pause icon while playing.
- **Responsive split**: page grid is `grid-cols-1 lg:grid-cols-[minmax(0,1fr)_clamp(320px,30vw,420px)]`;
  the feedback panel is below on small screens with a max-height.
- **Feedback panel**: severity summary, category/severity filters, an accordion per correction
  (explanation, `formalAlternatives` chips, exam badge, Hear it), sorted by `sortOrder`. The
  duplicate "Session stats" heading is gone; a single compact one-line summary remains.
- **Card header**: only Play + Translate stay visible; replay recording, sentence mode and voice
  moved into an overflow `…` menu. Nested rounded panels replaced with `border-t` separators.
- **#11 motion**: the conveyor was kept per the user's explicit request but softened
  (`rotateX 34deg`, opacity 0.2) and disabled under `prefers-reduced-motion`.
- **A11y**: card slots are focusable (`role=button`, Enter/Space), transcript corrections are real
  buttons (only those are tab stops), icon buttons have `aria-label`s, translation/audio async
  states are `aria-live`, menus close on Escape.

Still open from the critique: design-token sweep (#6), replacing the JS spacer/ResizeObserver
with CSS (#12), arrow-key menu navigation + 44px touch targets + contrast pass (#13), removing
the redundant `attempt.translation` field (#21), list virtualization (#23), container queries
(#25), and automated a11y/visual tests (#26).

### Apple-inspired interaction and responsiveness pass (2026-09-15)
- Added shadcn-svelte Tabs, Dropdown Menu, Collapsible, Progress, Separator, Tooltip, Select and
  Alert Dialog primitives. Production Practice/Attempt/Feedback interactions and all seven
  Settings choices use these instead of custom menus, native selects, prompt/confirm dialogs, and
  ad-hoc disclosure controls.
- The visual language is restrained glass, layered neutral surfaces and a teal→violet gradient;
  phase changes, disclosures, filtering, translation detail, theme changes and route changes now
  animate. `prefers-reduced-motion` remains authoritative.
- Feedback summary is severity-only and count-over-label; category is secondary and lives in the
  hamburger. Empty replacements are semantic deletions and render as strike-through + Remove.
- The conveyor remains compositor-driven but now exits decisively at 58deg/0.06 opacity. A
  requestAnimationFrame fallback is used only where view timelines are unsupported.
- Mobile navigation moves from the side rail to a 60px bottom bar at <=640px. This prevents the
  requested feedback labels from truncating at a 390px viewport.

### Local-model resource policy (2026-09-15)
- Piper moved completely into a lazy module worker; French G2P and ONNX inference no longer block
  the main thread. Requests serialize, PCM is transferred, only one voice remains loaded, and all
  voice sessions release after 90 seconds idle.
- Whisper remains worker-hosted but now caps ORT WASM at two threads only on >=6-core, >=6GB,
  cross-origin-isolated devices; all other devices use one. Its pipeline also releases after 90
  seconds idle.
- Piper downloads use `ReadableStream.tee()`: Cache Storage consumes one branch while inference
  consumes one growable `Uint8Array`. This removes the former multi-copy 64–77MB memory spike.
- Audio time updates no longer invalidate every AttemptCard; the cards subscribe to a separate
  low-frequency playback-identity store. Replaced blob URLs are revoked, pronunciation URLs are
  bounded to 48, the mic meter is capped at 25Hz, and the visible timer at 4Hz.
- `openSession()` loads correction lists in parallel; offscreen cards use `content-visibility`,
  and the stream observes only its viewport plus newest card. Font imports are Latin-only.
- Browser evidence on a cold fresh origin: Piper Tom downloaded 64MB and generated 2.94 seconds
  of speech in 44.9 seconds while requestAnimationFrame continued at ~60fps (2,688 frames), with
  an 87ms maximum sampled timer gap. No page or console errors.

### Coach notes responsive disclosure (2026-09-15)
- Coach notes is one shadcn Collapsible, not a second custom toggle system. The state is owned by
  Practice and bound into FeedbackPanel so the parent grid and panel content animate together.
- Desktop defaults open and collapses the feedback column from up to 440px to a 64px icon/count
  rail. Below 1024px it defaults closed as a 58px horizontal bar and opens to 42% of app height.
- Selecting a marked transcript word always reopens Coach notes so linked feedback is never hidden.
  Motion follows `prefers-reduced-motion` and the 390px view has no horizontal overflow.

### Language registry is the single source of truth (2026-09-15)
- `src/lib/languages/index.ts` holds every `LanguageDefinition` (STT, voices, prompts, approval).
  Adding a language is one entry after a human quality pass; nothing else in the app names a
  language directly. `docs/architecture/languages.md` is the human-facing tracker.
- A language is offered only when it and each of its STT/voice entries are `approved`; the
  approval record names the test, the date and the evidence file. This preserves the lab rule
  that no download is exposed before a human has judged its output.
- Downloads are manual, per language, and cancellable — never automatic on selection. The
  product requirement is that a mis-click costs nothing, so the user can switch languages and
  download later. The gate tells the user to open Settings → Language data rather than downloading
  silently from the Practice screen.
- The combined progress bar is global (layout-level) so navigation does not hide or cancel it.
- Cancel terminates the model workers; the next use lazily recreates them, so a partial cache
  never blocks a retry.

### TTS correction profiles are declarative and per voice (2026-09-15)
- `LanguageVoice.processing` carries the listening-test correction (high-shelf EQ, compressor /
  limiter, makeup gain, peak normalization target); `utils/audioEffects.ts` renders it in an
  `OfflineAudioContext`. No voice-specific branches live in the DSP code.
- STT input conditioning is deliberately untouched: the approved WER was measured on raw decoded
  PCM, so any filtering would require a fresh measurement before it can be approved.

### Tabs selected state: `data-state`, not `data-active` (2026-09-15)
- bits-ui's Tabs trigger exposes `data-state="active"`; the shadcn base classes that use
  `data-active:` therefore never apply. Custom selected styling must target
  `[data-state=active]` (or `data-[state=active]:`). This was the real reason the feedback
  severity tabs looked identical selected and unselected.

### AlertDialog.Action does not close the dialog (2026-09-24, bits-ui 2.19)
- Unlike Radix, bits-ui's `AlertDialog.Action` is only "the button responsible for taking an
  action" and **does not close** the dialog out of the box (documented behaviour; `Action` uses
  `DialogActionState`, which has no click handler, while `Cancel` uses one that closes). Every
  Action handler must close its bound `open` state itself. This bit Restore database (dialog
  trapped the learner with no result when the import failed) and the Voice preview regenerate
  dialog; the Practice delete dialog already closed explicitly in `deleteCurrent()`.

### Long cards are flat; the conveyor is for short cards only (2026-09-15; superseded 2026-10-31: tall cards scroll inside the stack)
- onspot takes run 60s–5min, so an attempt card can be several viewport-heights once translations
  and a word breakdown are open. The scroll-driven exit animation is meaningless for those cards
  and actively hostile to reading, so cards over `max(480px, 75% viewport)` get a JS `tall` class
  that disables the animation. Short cards keep the conveyor.
- The detection is per-card via `ResizeObserver` (only the resized card is re-measured), so
  expanding/collapsing anything fixes the card's own behaviour immediately.
- Compare-all translations stack vertically at full card width. Vertical space is the axis the
  product has; the old three-column layout squeezed 5-minute content into narrow columns.

### Advanced voice tuning: layered per voice, part of the cache key (2026-09-15)
- The approved `LanguageVoice.processing` profile stays the baseline. Learner adjustments live in
  `settings.voiceTunings[voiceId]` as ±12 dB offsets (`VoiceTuning`) and are merged by
  `resolveProfile`; Reset deletes the entry, restoring the approved sound exactly.
- `processPcm` runs a fixed chain: 3-band EQ → approved compressor (if any) → makeup →
  input-peak normalization → learner volume → final limiter. The limiter is what makes a positive
  volume/EQ boost safe; normalization is computed from the input peak because the final gain
  cannot be known before rendering.
- The cache key includes `tuningSignature`, so each tuning is its own cached WAV and a slider
  change can never replay stale audio. The preview store's selection key includes the same
  signature (caught by the browser test: without it, the in-memory preview replayed stale audio).
- Advanced is the same Settings page, not a second tab: General/Advanced is a segmented toggle
  and the advanced section is a `Collapsible` in the normal flow. Hiding it changes nothing about
  what is applied; values stay in the store.
- Advanced is the default selection on load (user request, 2026-09-18). It is page-local state,
  not a persisted setting.

### Voice preview: reuse the synthesis cache, guard regeneration (2026-09-15)
- Settings previews the selected local/cloud voice with `LanguageDefinition.preview` through the
  same `synthesizeSpeech` path as practice, so the WAV lands in the normal DB audio cache and the
  voice processing profile is heard. No separate cache format or model call path.
- Play never regenerates: it reuses the in-memory blob URL while that URL is the active track,
  otherwise it re-reads the cached WAV. Only the confirm dialog calls `force: true`, because a
  regeneration costs model time (and a cloud request) for no benefit unless the cached audio is
  actually wrong.
- Generation is deduplicated per `mode:language:voice`; if the selection changes mid-generation
  the result is discarded rather than played.

### Card depth beats flat minimalism (2026-09-15)
- Page background and card surfaces are deliberately separated (`#f1efe9` vs white in light,
  `#0b0b0d` vs `#19191d` in dark) with explicit card borders and stronger shadows. Attempt cards
  and feedback correction cards both carry this, because a 5-minute card needs a clear boundary
  while scrolling.

### Settings preview applies processing live (2026-09-18)
The preview is synthesized once raw and played through `createProcessingChain` — the same Web
Audio graph `processPcm` renders offline — so tuning is audible instantly and matches read-backs.
Re-rendering the whole chain (not EQ-after-compressor) matters: Tom's compressor (ratio 8) would
otherwise make the live sound differ from the rendered one.

### Export is the SQLite database itself (2026-09-18)
User request: one `.sqlite` with everything, including cached audio. Web uses sqlite-wasm's
serializer; desktop uses `VACUUM INTO` + Tauri dialog/fs plugins. Keys and models stay out.

### SQLite import replaces the database file (2026-09-24, revised same day)
The `.sqlite` export is a whole-database image, so its restore is a whole-database replace, not a
merge. **Web:** the worker calls `sqlite3_deserialize()` on the open connection (main becomes the
backup in wasm memory), `pool.unlink('/onspot.db')`, writes the backup back with
`VACUUM INTO '/onspot.db'` through the normal VFS write path, and reopens. The first version used
`SAH.pool.importDb('/onspot.db', bytes)`, which writes the raw image with one large
`FileSystemSyncAccessHandle.write()` and never truncates; a Zen/Firefox user hit
`Unknown write() failure.` from that path (sqlite-wasm's SAH xWrite short-write guard), so it was
removed. `VACUUM INTO` also preserves `schema_migrations`, so `init()` still migrates older
backups (verified v5 → v6 backfill). **Desktop:** closes the sqlx pool, overwrites the plugin's
`onspot.db` (app config dir) and removes stale `-journal`/`-wal`/`-shm` sidecars. A table-by-table
copy was rejected: it would leave main's schema current and skip migration backfills, and on
desktop a connection-scoped `ATTACH` can silently run on another pooled connection.
`importSqliteBackup()` reloads settings and Practice after the replace. Because the import is
destructive, it sits behind a shadcn AlertDialog that names the chosen file; the legacy JSON
restore remains the non-destructive merge path. Web browser-verified (Chromium 19/19 + 8/8,
Firefox 7/7 + 7/7 parity); Tauri awaits runtime verification.

### Paper texture is rendered once and cached as an image (2026-09-18)
A live full-screen WebGL canvas slowed first content 2–4× under software GL (History: 0.9–2.4s →
4–6.5s). Snapshotting to WebP (Cache API) makes later loads faster than before (≈0.4–1s) with no
live GL context; the first render is deferred and done at the screen's real pixel ratio.

### UI library: @dvcol/neo-svelte replaces shadcn-svelte (2026-09-24)
User direction: remove shadcn-svelte and use neo-svelte's components throughout. Pinned to the
npm release 1.2.0 (master 2.0 is unreleased). Constraints learnt while migrating:
- `NeoThemeProvider` is mandatory and renders children only after its stylesheet loads; it needs
  `sass-embedded` in devDeps. We pass `reset={false}` (Tailwind preflight) and `remember={false}`
  (the app owns `onspot.theme`).
- 1.2.0 has **no cascade layers**: neo's scoped CSS usually beats a plain `:global(.cls)`.
  Override with `.scope :global(.neo-button.cls)` (or a prop). neo's theme sheet is unlayered, so
  it beats every Tailwind utility — hence the `revert-layer` heading fix in `app.css`.
- Neo buttons wrap children in `.neo-content`; NeoCard without header/footer renders children
  directly (`contentProps` inert).
- `NeoDialogConfirm`/`NeoConfirm` are not exported in 1.2.0 and deep imports are blocked: confirm
  dialogs are `NeoDialog` + two NeoButtons, with `portal` (a glass/backdrop-filter ancestor
  otherwise traps the fixed dialog). Handlers still close the bound `open` explicitly.
- `NeoRange` has no vertical orientation → EQ faders are horizontal.
- `NeoDivider`'s `margin` prop is folded into its height `calc()`; multi-value margins make the
  height invalid (a 21px grey bar). Use `style="margin: …"`.
- NeoTabs can report `undefined` through `onchange` when `active` is cleared; handlers ignore it.
  Neo's deferred empty transition can crash Svelte if a block is removed and restored within a
  microtask.
- NeoPill's type only allows a `div` tag; clickable chips are small NeoButtons.
- Never pass reactive props to NeoThemeProvider: a prop change destroys and remounts the whole
  app (1.2.0). Theme switches go through `NeoThemeSync` → `context.update({ theme })`.
- NeoTooltip 1.2.0 ignores the "click" open reason, so NeoMenu only opens by hover (500ms). Always
  use `$lib/components/PopMenu.svelte`, never NeoMenu directly. Tooltips/collapses take the
  `$lib/neo` timing presets.
- Relief and surfaces are app-owned: `src/neo-depth.css` (generated, × `--neo-depth`) and the
  key/well/sheet rules in `app.css`. Keys lighter card stock + `--paper-key`, wells darker and
  recessed, active tab = raised key in an inset track (2026-09-24, user asked for stronger
  concave/convex and distinct component paper).

### Prefer libraries and existing components (2026-09-18; component library now neo-svelte)
User direction: use web APIs, existing deps and shadcn-svelte components rather than hand-rolled
equivalents (e.g. Web Audio `getFrequencyResponse` instead of hand-written biquad maths).

### `.sqlite` restore never destroys the current database (2026-09-25)
The worker exports the current DB to memory before replacing it and writes it back if the backup
write fails (Firefox quota). `navigator.storage.persist()` is requested from the restore click —
Firefox ignores it without user activation — and never awaited unless room is short (it resolves
only when the user answers the prompt).

- **2026-10-31: no platform text selection on touch screens.** The learner long-presses words to
  translate them; Android's selection handles and Cut/Copy menu got in the way. Transcripts select
  whole words with their own long-press-and-drag (`TouchWordSelection`), kept as app state so the
  platform never sees a selection. Trade-off: text cannot be copied on phones (text fields excepted).

- **2026-10-31: Opus for all stored and uploaded speech.** Smallest codec the platform records and
  plays; Whisper hears 16 kHz, which 24 kbps Opus keeps. Read-back at 32 kbps (listened to closely).
- **2026-10-31: translations are not part of the evaluation unless shown after every take.** With the
  default (off) they were 4–5 renderings per take nobody read; fetched on demand instead.
- **2026-10-31: evaluation prompt order = fixed rules first, take details last**, for provider
  prefix caching.

- **2026-10-31: stream read-back through MSE, not WebCodecs/Web Audio.** Keeps the one `<audio>`
  player (speed, loop, seek, pause) and needs no decoder; Ogg is repackaged to WebM because MSE has
  no Ogg. A stopped stream is still downloaded and stored (cancelling refunds nothing).
- **2026-10-31: hover meanings per text, after a 300 ms rest.** Both texts at once nearly doubled the
  output; an accidental mouse pass used to trigger the paid request.

- **2026-11-01: on-device explanations use two voices.** The English with an English Piper voice the
  learner picks by listening (four candidates, hosted samples), the target-language spans and the
  follow-up question with their selected target voice. Supersedes "explanation audio is
  cloud-only" (2026-10-30).
- **2026-11-01: on-device clips are made ahead of time.** No credits to save, so every clip of a take
  is prepared in priority order (explanation, follow-up, correct version, what was said,
  corrections), one at a time; cloud clips are never prepared.

- **2026-11-01: the language of instruction is the learner's setting, not the target language's.**
  Default English; any of `INSTRUCTION_LANGUAGES` except the studied language. On-device explanation
  voices exist per instruction language (English only so far; others use cloud speech until the user
  picks voices by listening).
- **2026-11-01: nothing hidden is built with a page, and nothing big animates layout.** Closed menus,
  closed Settings rows and stack cards out of reach are built when needed (or when idle), and the
  Feedback panel slides by transform with its column changing in one step, instead of animating the
  column width (which re-laid out every word of every card each frame). Prefer transforms/opacity for
  motion; never read layout while a page is mounting.
