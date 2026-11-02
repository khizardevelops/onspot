// SPDX-License-Identifier: AGPL-3.0-or-later

import { flip, offset, shift, size, type UseFloatingOptions } from '@skeletonlabs/floating-ui-svelte';
import { cubicIn, quartOut } from 'svelte/easing';
import { fade, scale } from 'svelte/transition';

/*
 * Shared timing presets for neo-svelte's floating, collapsing and dialog
 * components. Library defaults wait 600ms before a tooltip opens, open
 * submenus on a hover delay, pop overlays in/out over 200ms, scale dialogs in
 * over 300ms and animate collapses over 300ms. onspot's controls must answer
 * like a native app's, so spread these into props. (CSS transitions on neo
 * elements are limited to the compositor's properties in app.css, and a
 * finger shows a press at once: see gestures/pressFeedback.ts.)
 *
 * The timings follow native motion: things come in decelerating and leave
 * faster, accelerating; only opacity and transforms move, which the
 * compositor runs off the main thread. Reduced motion makes them instant.
 */

/** How long each kind of surface moves, in ms. */
const MOTION_MS = {
	/** A menu, tooltip or select list coming in. */
	popEnter: 90,
	/** …and going: faster than it came. */
	popExit: 50,
	/** A dialog coming in (it carries more weight than a menu). */
	dialogEnter: 160,
	/** …and going. */
	dialogExit: 100,
	/** A section opening or closing in place. */
	collapse: 120
} as const;

/** Where a popping surface starts, as a fraction of its size: close enough to read as the same thing settling. */
const POP_START_SCALE = 0.97;
const DIALOG_START_SCALE = 0.96;

/** Read once: neither changes while onspot is open in practice, and the presets are plain objects. */
const prefersReducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
/** Touch screens cannot hover: a tapped control keeps `:hover` until the next tap, so hover-only affordances stay off. */
const canHover = typeof matchMedia !== 'function' || matchMedia('(hover: hover)').matches;

/** A duration, or none at all when the learner asked for reduced motion. */
function motionMs(ms: number): number {
	return prefersReducedMotion ? 0 : ms;
}

/** Overlay enter/exit: a near-instant pop, no lingering fade-out. */
export const quickPop = {
	in: { use: scale, props: { duration: motionMs(MOTION_MS.popEnter), start: POP_START_SCALE, opacity: 0, easing: quartOut } },
	out: { use: fade, props: { duration: motionMs(MOTION_MS.popExit), easing: cubicIn } }
};

/**
 * Tooltips: open almost immediately on hover, never on focus alone, and not
 * at all on touch screens, where a tap would leave its label stuck on screen.
 */
export const quickTooltip = { hoverDelay: 60, openDelay: 0, openOnFocus: false, openOnHover: canHover, ...quickPop } as const;

/**
 * Dialogs: neo scales them in from 105% over 300ms and out the same way.
 * They rise from just under their size and fade, and leave faster.
 */
export const quickDialog = {
	in: { use: scale, props: { duration: motionMs(MOTION_MS.dialogEnter), start: DIALOG_START_SCALE, opacity: 0, easing: quartOut } },
	out: { use: fade, props: { duration: motionMs(MOTION_MS.dialogExit), easing: cubicIn } }
};

/** Space kept between a floating menu and the viewport edge. */
const VIEWPORT_MARGIN = 12;

/**
 * Floating-ui positioning that keeps a menu fully on screen. neo's own
 * middleware only flips, so on a phone a menu wider than the room beside its
 * trigger ran off the edge (the navigation menu was cut in half). `shift`
 * slides it back inside, `size` caps it to the space available, and the menu
 * scrolls if it is still taller.
 */
export const onScreen: UseFloatingOptions = {
	middleware: [
		offset(8),
		flip({ padding: VIEWPORT_MARGIN }),
		shift({ padding: VIEWPORT_MARGIN }),
		size({
			padding: VIEWPORT_MARGIN,
			apply({ availableWidth, availableHeight, elements }) {
				Object.assign(elements.floating.style, {
					maxWidth: `${Math.max(160, availableWidth)}px`,
					maxHeight: `${Math.max(160, availableHeight)}px`,
					overflowY: 'auto'
				});
			}
		})
	]
};

/**
 * Menus open on click only (see PopMenu), and exist only while open. NeoMenu
 * keeps a closed menu in the page by default, hidden: every take card carried
 * three (21 on a six-take Practice page), each a full list of neo items that
 * floating-ui also positioned while the page was being built, so every
 * position read forced a layout in the middle of mounting.
 */
export const quickMenu = {
	openOnHover: false,
	openOnFocus: false,
	openOnClick: true,
	unmountOnClose: true,
	...quickPop
} as const;

/**
 * Submenus (e.g. Read-back voice). NeoMenu hands its own tooltip settings down
 * to submenus, so without this they would inherit click-only opening, which
 * neo 1.2.0 ignores. They open on hover, with no delay.
 */
export const quickSubmenu = {
	role: 'menu',
	portal: true,
	padding: '0',
	unmountOnClose: false,
	openOnHover: true,
	openOnFocus: false,
	openOnClick: true,
	hoverDelay: 0,
	openDelay: 0,
	options: onScreen
};

/**
 * The tallest a select's open list gets: about eight options, and never more
 * than half the screen, so it fits above or below its field (neo flips it to
 * the side with room). Longer lists scroll, as native pickers do.
 */
const SELECT_LIST_MAX_HEIGHT = 'min(320px, 50dvh)';

/**
 * Select dropdowns. The open list is a portal on top of the whole app (in
 * place, it opened under the Settings tabs and over other cards depending on
 * where it was), and capped in height: the 21 languages of instruction made a
 * 740px list that ran off the top of a phone. The cap goes through neo's own
 * `height` prop, which sets the list's max-height and keeps it set.
 */
export const quickSelect = {
	hoverDelay: 0,
	openDelay: 0,
	listProps: {
		...quickPop,
		height: { max: SELECT_LIST_MAX_HEIGHT },
		tooltipProps: { portal: true }
	}
};

/** Collapse height transition: decelerating, so the content is there at once and settles. */
export const quickCollapse = { duration: motionMs(MOTION_MS.collapse), easing: quartOut } as const;
