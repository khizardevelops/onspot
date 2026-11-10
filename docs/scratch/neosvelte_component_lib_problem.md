<!--docs/prompts/claude_plan_ui_fix.md-->

I wouldn't replace it now. The worst bugs from today don't come from neo, and a different library wouldn't fix them.

**What actually caused today's bugs**
- **Menus and selects gliding in from the corner** came from our own CSS. A global rule in `app.css` animates `translate` on every neo element, and neo positions its floating surfaces with `translate`. The fix is a few lines of CSS.
- **Wrong placement at 125 %** comes from floating-ui not understanding CSS `zoom`, which our interface-scale setting uses. Most Svelte libraries with menus position them with floating-ui (bits-ui, which shadcn-svelte is built on, does too), so a switch would likely bring the same problem. What neo adds is not letting us pass in floating-ui's measurement layer, which forced the middleware workaround.
- **The feedback sheet being too fast** is our own timing, unrelated to neo.

The fixes for all three are written, but the check that confirms them was still running when you asked. I can't tell you yet whether they work.

**Where neo does cost us:** a pile of workarounds, mostly around floating surfaces:
- click-to-open ignored on menus (the `PopMenu` workaround);
- closed menus kept in the page by default;
- a size cap that has to be set twice because neo rewrites the style attribute;
- the select needing extra code to close after a pick;
- long transitions on colours that we override globally;
- hover styles sticking on touch screens;
- the `NeoSelect` focus trap.

It's also a niche library. As far as I know it's mostly one maintainer, which is a long-term risk worth checking (release activity, open issues).

**A middle path if this keeps hurting:**
1. **Replace only the floating parts:** menus, selects and tooltips. That's where nearly all the workarounds live. A headless library such as bits-ui, styled with your existing neumorphic tokens, would give mature accessibility and keyboard behaviour. Cards, buttons and inputs stay on neo, so the look doesn't change. It would still need a zoom correction, unless you also change point 2.
2. **Reconsider CSS `zoom` for the interface scale.** It's the root cause of the misplacement in every library. Scaling through the root font size would avoid it, but only sizes written in `rem` would scale; anything sized in `px` (possibly parts of neo) wouldn't. That needs a quick audit before deciding.

**I'd switch fully only if:**
- the workarounds keep growing,
- upstream doesn't respond to bug reports, or
- you need accessibility guarantees neo can't give.

You moved from shadcn to neo deliberately in September. A full migration would touch nearly every screen, so it should be a deliberate milestone, not a reaction to today's bugs.