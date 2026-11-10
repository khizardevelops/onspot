// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * floating-ui under the interface scale. The scale is CSS `zoom` on the page
 * (`stores/zoom.svelte.ts`), which floating-ui 1.8 does not know: it measures
 * the trigger and the window in zoomed pixels but the floating element's own
 * size from its CSS, in unzoomed ones, and the position it returns is applied
 * in the element's own pixels, which the zoom scales again. At 125 % a take
 * card's menu opened 71 px below its button, partly off the window, and a
 * select's list 215 px to the side of its field, over the field itself.
 *
 * The fix measures everything in zoomed pixels (the element's size times the
 * zoom), and divides the result by the zoom where it is applied.
 */
import { computePosition, platform, type Middleware, type Platform } from '@floating-ui/dom';

/** The zoom an element is drawn at; 1 where the browser does not report it. */
export function cssZoomOf(element: Element): number {
	return (element as Element & { currentCSSZoom?: number }).currentCSSZoom ?? 1;
}

/** floating-ui's measurements with the floating element's size in zoomed pixels, like the rest. */
export function zoomedPlatform(zoom: number): Platform {
	if (zoom === 1) return platform;
	return {
		...platform,
		async getDimensions(element) {
			const { width, height } = await platform.getDimensions(element);
			return { width: width * zoom, height: height * zoom };
		}
	};
}

/**
 * Positioning that stays right under the interface scale, for a floating
 * element whose positioning cannot be given its own platform (neo-svelte's
 * menus, selects and tooltips: their `useFloating` passes only middleware on).
 * It places the element itself, with the zoom-aware measurements, and hands
 * floating-ui the result in the element's own pixels.
 *
 * @param middleware The positioning to apply, built for a zoom: distances it
 *   takes (offsets, paddings) are in zoomed pixels, so multiply them by it.
 * @returns The middleware to give floating-ui in place of `middleware`.
 */
export function placedUnderZoom(middleware: (zoom: number) => Middleware[]): Middleware[] {
	return [
		{
			name: 'placedUnderZoom',
			async fn(state) {
				const zoom = cssZoomOf(state.elements.floating);
				const position = await computePosition(state.elements.reference, state.elements.floating, {
					placement: state.initialPlacement,
					strategy: state.strategy,
					middleware: middleware(zoom),
					platform: zoomedPlatform(zoom)
				});

				// A flip to the other side is passed on, so the element knows which side it opened on.
				const flipped = position.placement !== state.placement;
				return {
					x: position.x / zoom,
					y: position.y / zoom,
					data: position.middlewareData,
					reset: flipped ? { placement: position.placement } : undefined
				};
			}
		}
	];
}
