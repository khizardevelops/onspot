// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What every touch gesture in onspot shares: which screens get them, how far
 * a finger moves before it counts as a swipe, how fast it was going when it
 * lifted, and which elements keep their own drags.
 */

/** Touch screens, where the platform's own text selection is turned off (keep in step with app.css). */
export const TOUCH_SCREEN_QUERY = '(hover: none) and (pointer: coarse)';

/** How far a finger moves before a press becomes a swipe (Android's touch slop is about 8 dp). */
export const TOUCH_SLOP_PX = 10;

/**
 * Elements whose own drags must win over a swipe: text fields, sliders and
 * anything marked `data-swipe-ignore`.
 */
const OWN_DRAG_SELECTOR = [
	'input',
	'textarea',
	'select',
	'[contenteditable=""]',
	'[contenteditable="true"]',
	'[role="slider"]',
	'[data-swipe-ignore]'
].join(', ');

/**
 * Whether a touch on this element belongs to the element itself.
 *
 * @param target Where the finger came down.
 * @param root The element the gesture listens on; ancestors outside it are not checked.
 * @returns True for a text field, a slider, or something inside a box that scrolls sideways.
 */
export function keepsItsOwnDrag(target: EventTarget | null, root: HTMLElement): boolean {
	if (!(target instanceof Element)) return true;
	if (target.closest(OWN_DRAG_SELECTOR)) return true;

	for (let element: Element | null = target; element && element !== root; element = element.parentElement) {
		if (element.scrollWidth > element.clientWidth && scrollsSideways(element)) return true;
	}
	return false;
}

function scrollsSideways(element: Element): boolean {
	const overflow = getComputedStyle(element).overflowX;
	return overflow === 'auto' || overflow === 'scroll';
}

/** How much of the finger's recent path the lift speed is measured over. */
const VELOCITY_WINDOW_MS = 100;

/**
 * The finger's speed along one axis when it lifts, from its last few moves,
 * so a quick flick counts even when it travelled only a little.
 */
export class FlingVelocity {
	#samples: Array<{ at: number; offset: number }> = [];

	/** Forgets the previous gesture. */
	reset(): void {
		this.#samples = [];
	}

	/** Records where the finger is now, along the gesture's axis. */
	add(offset: number, at = performance.now()): void {
		this.#samples.push({ at, offset });
		while (this.#samples.length > 2 && at - this.#samples[0].at > VELOCITY_WINDOW_MS) this.#samples.shift();
	}

	/** Pixels per millisecond over the last moves; positive in the gesture's direction. */
	current(): number {
		const first = this.#samples[0];
		const last = this.#samples.at(-1);
		if (!first || !last || last.at === first.at) return 0;
		return (last.offset - first.offset) / (last.at - first.at);
	}
}
