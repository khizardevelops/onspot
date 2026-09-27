import { flip, offset, shift, size, type UseFloatingOptions } from '@skeletonlabs/floating-ui-svelte';
import { fade, scale } from 'svelte/transition';

/*
 * Shared timing presets for neo-svelte's floating and collapsing components.
 * Library defaults wait 600ms before a tooltip opens, open submenus on a
 * hover delay, pop overlays in/out over 200ms and animate collapses over
 * 300ms. onspot's controls must answer at once, so spread these into props.
 * (CSS transitions on neo elements are capped globally in app.css.)
 */

/** Overlay enter/exit: a near-instant pop, no lingering fade-out. */
export const quickPop = {
	in: { use: scale, props: { duration: 90, start: 0.97, opacity: 0 } },
	out: { use: fade, props: { duration: 50 } }
};

/** Tooltips: open almost immediately on hover, never on focus alone. */
export const quickTooltip = { hoverDelay: 60, openDelay: 0, openOnFocus: false, ...quickPop } as const;

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

/** Menus open on click only (see PopMenu). Their overlay uses neo's CSS fade, capped in app.css. */
export const quickMenu = { openOnHover: false, openOnFocus: false, openOnClick: true } as const;

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

/** Select dropdowns. */
export const quickSelect = { hoverDelay: 0, openDelay: 0, listProps: { ...quickPop } };

/** Collapse height transition. */
export const quickCollapse = { duration: 120 } as const;
