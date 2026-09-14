I need to build a standalone, 1:1 interactive sandbox of the "chat history" UI using the "Clone and Clean" approach.
**CRITICAL CHANGE:** Do NOT force all UI elements open simultaneously, and do NOT strip out `{#if}` blocks or Svelte state logic. I want the sandbox to be completely interactive—clicking a card, toggling translation variants, opening tooltips, and switching tabs must work exactly as a real user would experience it.
Please execute the following steps:
1. **Trace Component Dependencies:** Identify the primary chat history component and all deeply nested child/grandchild UI components (cards, translation blocks, audio buttons, correction popovers, variant toggles).
2. **Clone into Sandbox:** Create a directory at `src/routes/ui-sandbox/components/`. Copy the identified components into this directory as `Mock...` components (e.g., `MockAttemptCard.svelte`). Update internal imports so they reference each other in isolation.
3. **Preserve Local Interactivity (Clean Backend Dependencies):**
* **KEEP** all interactive Svelte state logic (`let isOpen = false`, `{#if}` blocks, click handlers, tab switching, hover tooltips).
* **REMOVE** external API calls, database fetches, and complex global store dependencies. Replace them with clean local component state.

4. **Create Sandbox Route with Rich Mock Data:** Create `src/routes/ui-sandbox/+page.svelte`. In the `<script>` block, hardcode a comprehensive data object representing a complex live scenario. Pass this data into your `Mock` components:
* User messages with inline grammar corrections.
* French/target phrases and proverbs.
* Word-for-word, literal, and multiple idiomatic translation variants.
* Text-to-speech audio state triggers.

5. **Configure Repomix:** Add a script to `package.json` called `"bundle:ui"` that runs `npx repomix --include "src/routes/ui-sandbox/**/*.svelte"`.

The end result must be a working page at `/ui-sandbox` where I can click through cards and test all progressive disclosure features naturally, and running `npm run bundle:ui` produces a clean Svelte file that captures both the layout and the interactive logic for AI analysis.
