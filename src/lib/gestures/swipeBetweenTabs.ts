// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Swipe sideways across a tabbed view to show the next or previous tab, as
 * phone apps do. Only a deliberate swipe counts: quick, mostly sideways and
 * long enough, so scrolling down a list never changes tab. Listeners are
 * passive, so it never delays or blocks a scroll. Touch only; text fields,
 * sliders and sideways-scrolling boxes keep their own drags.
 */
import { TOUCH_SCREEN_QUERY, TOUCH_SLOP_PX, keepsItsOwnDrag } from './touch';

/** The next tab (+1, a swipe to the left) or the previous one (-1, a swipe to the right). */
export type TabStep = 1 | -1;

/** A swipe travels at least this far sideways. */
const MIN_SWIPE_PX = 56;
/** And at least this many times further sideways than up or down. */
const MIN_SIDEWAYS_RATIO = 2;
/** A slower movement is someone reading with a finger on the screen, not a swipe. */
const MAX_SWIPE_MS = 600;

export class SwipeBetweenTabs {
	#onSwipe: (step: TabStep) => void;
	#enabled: () => boolean;
	#tracking = false;
	#startX = 0;
	#startY = 0;
	#startedAt = 0;

	/**
	 * @param onSwipe Shows the next or previous tab.
	 * @param enabled Whether swiping changes tab now; always, if left out.
	 */
	constructor(onSwipe: (step: TabStep) => void, enabled: () => boolean = () => true) {
		this.#onSwipe = onSwipe;
		this.#enabled = enabled;
	}

	/**
	 * Follows the touches on a tab's content.
	 *
	 * @param root The content area that swipes.
	 * @returns Stops following them.
	 */
	listen(root: HTMLElement): () => void {
		if (!matchMedia(TOUCH_SCREEN_QUERY).matches) return () => {};

		const press = (event: TouchEvent) => this.#press(event, root);
		root.addEventListener('touchstart', press, { passive: true });
		root.addEventListener('touchmove', this.#move, { passive: true });
		root.addEventListener('touchend', this.#release, { passive: true });
		root.addEventListener('touchcancel', this.#abandon, { passive: true });

		return () => {
			root.removeEventListener('touchstart', press);
			root.removeEventListener('touchmove', this.#move);
			root.removeEventListener('touchend', this.#release);
			root.removeEventListener('touchcancel', this.#abandon);
		};
	}

	#press(event: TouchEvent, root: HTMLElement): void {
		this.#tracking = event.touches.length === 1 && this.#enabled() && !keepsItsOwnDrag(event.target, root);
		if (!this.#tracking) return;
		this.#startX = event.touches[0].clientX;
		this.#startY = event.touches[0].clientY;
		this.#startedAt = event.timeStamp;
	}

	/** A finger that first moves up or down is scrolling; the rest of that touch is not a swipe. */
	#move = (event: TouchEvent): void => {
		if (!this.#tracking) return;
		if (event.touches.length !== 1) {
			this.#tracking = false;
			return;
		}
		const sideways = Math.abs(event.touches[0].clientX - this.#startX);
		const vertical = Math.abs(event.touches[0].clientY - this.#startY);
		if (vertical > TOUCH_SLOP_PX && vertical > sideways) this.#tracking = false;
	};

	#release = (event: TouchEvent): void => {
		if (!this.#tracking) return;
		this.#tracking = false;

		const touch = event.changedTouches[0];
		const sideways = touch.clientX - this.#startX;
		const vertical = touch.clientY - this.#startY;
		const quick = event.timeStamp - this.#startedAt <= MAX_SWIPE_MS;
		const longEnough = Math.abs(sideways) >= MIN_SWIPE_PX;
		const mostlySideways = Math.abs(sideways) >= MIN_SIDEWAYS_RATIO * Math.abs(vertical);
		if (quick && longEnough && mostlySideways) this.#onSwipe(sideways < 0 ? 1 : -1);
	};

	#abandon = (): void => {
		this.#tracking = false;
	};
}
