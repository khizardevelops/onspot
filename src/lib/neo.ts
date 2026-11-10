// SPDX-License-Identifier: AGPL-3.0-or-later

import { flip, offset, shift, size } from '@floating-ui/dom';
import type { UseFloatingOptions } from '@skeletonlabs/floating-ui-svelte';
import { cubicIn, quartOut, sineOut } from 'svelte/easing';
import { fade, scale, type TransitionConfig } from 'svelte/transition';
import { noteTooltipClosed, tooltipJustClosed } from '#lib/stores/tooltipWarmth.svelte.js';
import { placedUnderZoom } from '#lib/utils/floatingZoom.js';

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
	/** A menu or select list coming in. */
	popEnter: 110,
	/** …and going: faster than it came. */
	popExit: 80,
	/** A tooltip coming in: about nine frames, so it is seen to fade in rather than flash. */
	tooltipEnter: 150,
	/** A tooltip taking over from its neighbour's, which is still fading. */
	tooltipHop: 90,
	/** A tooltip going. */
	tooltipExit: 110,
	/** A dialog coming in (it carries more weight than a menu). */
	dialogEnter: 160,
	/** …and going. */
	dialogExit: 100,
	/** A section opening or closing in place. */
	collapse: 120
} as const;

/** Where a dialog starts, as a fraction of its size: close enough to read as the same thing settling. */
const DIALOG_START_SCALE = 0.96;

/** Read once: neither changes while onspot is open in practice, and the presets are plain objects. */
const prefersReducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
/** Touch screens cannot hover: a tapped control keeps `:hover` until the next tap, so hover-only affordances stay off. */
const canHover = typeof matchMedia !== 'function' || matchMedia('(hover: hover)').matches;

/** A duration, or none at all when the learner asked for reduced motion. */
function motionMs(ms: number): number {
	return prefersReducedMotion ? 0 : ms;
}

/**
 * A menu or select list coming and going: a short fade, and nothing else.
 * They used to grow from 97 % as well, but scaling small text moves each letter
 * by fractions of a pixel, differently for every width: letters reversed
 * direction by up to 0.7 px on some labels and not at all on others (measured
 * 2026-11-08), which reads as jitter on some surfaces only.
 */
export const quickPop = {
	in: { use: fade, props: { duration: motionMs(MOTION_MS.popEnter), easing: sineOut } },
	out: { use: fade, props: { duration: motionMs(MOTION_MS.popExit), easing: sineOut } }
};

/**
 * A floating surface closes when what is under it scrolls, as a native
 * dropdown does. It lives on top of the whole page, so it would otherwise stay
 * where it opened while its trigger slid away (a select's list, 600 px from
 * its field).
 */
const closesOnPageScroll = { ancestorScroll: true } as const;

/** Space kept between a floating menu, list or label and the viewport edge. */
const VIEWPORT_MARGIN = 12;

/** How far a tooltip or a select's list sits from its trigger (neo's own default). */
const NEAR_TRIGGER_GAP = 6;

/**
 * A small floating surface next to its trigger (a tooltip, a select's list):
 * on the side asked for, the other side when there is no room, and slid back
 * inside the window. Placed right under the interface scale (`floatingZoom.ts`),
 * which neo's own positioning is not.
 */
const nearTrigger: UseFloatingOptions = {
	middleware: placedUnderZoom((zoom) => [
		offset(NEAR_TRIGGER_GAP * zoom),
		flip({ padding: VIEWPORT_MARGIN * zoom }),
		shift({ padding: VIEWPORT_MARGIN * zoom })
	])
};

/**
 * How long the pointer rests on a key before its tooltip opens. Long enough
 * that a pointer on its way somewhere else sets nothing off (at 60 ms labels
 * popped up all along its path), short of the 600 ms neo waits by default.
 */
const TOOLTIP_REST_MS = 250;

/**
 * A tooltip coming in: a fade on a sine curve, so it is seen to arrive (a quart
 * curve over 90 ms reached 55 % opacity in one frame, a flash). Nothing scales,
 * for the reason given at `quickPop`. One that takes over from a neighbour's,
 * still fading out, comes in faster.
 */
function tooltipIn(node: Element): TransitionConfig {
	const duration = tooltipJustClosed() ? MOTION_MS.tooltipHop : MOTION_MS.tooltipEnter;
	return fade(node, { duration: motionMs(duration), easing: sineOut });
}

/**
 * Tooltips: open when the pointer settles on a key, at once when moving along
 * a row of them, never on focus alone, and not at all on touch screens, where
 * a tap would leave its label stuck on screen. They live on top of the whole
 * page (a portal), like menus and select lists: inside a take card they were
 * clamped to the card's edges, and under the interface scale floating-ui took
 * the zoom for a scale on the card, which put a tooltip 100 px from its button
 * at 125 %.
 */
export const quickTooltip = {
	get hoverDelay() {
		return tooltipJustClosed() ? 0 : TOOLTIP_REST_MS;
	},
	openDelay: 0,
	openOnFocus: false,
	openOnHover: canHover,
	portal: true,
	options: nearTrigger,
	dismissOptions: closesOnPageScroll,
	onClose: noteTooltipClosed,
	in: { use: tooltipIn },
	out: { use: fade, props: { duration: motionMs(MOTION_MS.tooltipExit), easing: sineOut } }
} as const;

/**
 * Dialogs: neo scales them in from 105% over 300ms and out the same way.
 * They rise from just under their size and fade, and leave faster.
 */
export const quickDialog = {
	in: { use: scale, props: { duration: motionMs(MOTION_MS.dialogEnter), start: DIALOG_START_SCALE, opacity: 0, easing: quartOut } },
	out: { use: fade, props: { duration: motionMs(MOTION_MS.dialogExit), easing: cubicIn } }
};

/** The smallest a menu is squeezed to, in px, even when there is less room; it scrolls inside. */
const MENU_MIN_SIZE = 160;

/** How far a menu sits from its trigger. */
const MENU_GAP = 8;

/**
 * Floating-ui positioning that keeps a menu fully on screen. neo's own
 * middleware only flips, so on a phone a menu wider than the room beside its
 * trigger ran off the edge (the navigation menu was cut in half). `shift`
 * slides it back inside, `size` caps it to the space available, and the menu
 * scrolls if it is still taller. Placed right under the interface scale
 * (`floatingZoom.ts`): the room it measures is in zoomed pixels, the cap in
 * the menu's own.
 *
 * The cap also goes on the menu list inside the floating element: neo
 * rewrites the floating element's style attribute whenever it moves, which
 * drops a cap set only there (a take card's voice list ran 90px past the
 * bottom of the window, its last voices out of reach).
 */
export const onScreen: UseFloatingOptions = {
	middleware: placedUnderZoom((zoom) => [
		offset(MENU_GAP * zoom),
		flip({ padding: VIEWPORT_MARGIN * zoom }),
		shift({ padding: VIEWPORT_MARGIN * zoom }),
		size({
			padding: VIEWPORT_MARGIN * zoom,
			apply({ availableWidth, availableHeight, elements }) {
				const cap = {
					maxWidth: `${Math.max(MENU_MIN_SIZE, availableWidth / zoom)}px`,
					maxHeight: `${Math.max(MENU_MIN_SIZE, availableHeight / zoom)}px`,
					overflowY: 'auto'
				};
				const menuList = elements.floating.firstElementChild;
				for (const element of [elements.floating, menuList]) {
					if (element instanceof HTMLElement) Object.assign(element.style, cap);
				}
			}
		})
	])
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
	dismissOptions: closesOnPageScroll,
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
	options: onScreen,
	dismissOptions: closesOnPageScroll
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
		// neo reverses a list that opens upwards (Z to A from the top); a list keeps its order, as a native picker does.
		flip: false,
		tooltipProps: { portal: true, options: nearTrigger, dismissOptions: closesOnPageScroll }
	}
};

/** Collapse height transition: decelerating, so the content is there at once and settles. */
export const quickCollapse = { duration: motionMs(MOTION_MS.collapse), easing: quartOut } as const;
