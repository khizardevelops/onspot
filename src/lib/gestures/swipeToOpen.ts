// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pull a closed sheet up from the bar under it: the sheet comes up from the
 * bottom edge with the finger, and on lift it either opens (pulled far
 * enough, or flicked) or drops back out of sight. The mirror of
 * `SwipeToDismiss`; touch only, the bar's button still opens it with a tap.
 *
 * The swipe can start anywhere on the bar, buttons included: a touch becomes
 * a pull only once it has gone up past the slop, and then the lift does not
 * press the button it began on.
 */
import { FlingVelocity, TOUCH_SCREEN_QUERY, TOUCH_SLOP_PX, keepsItsOwnDrag } from './touch';
import {
	ARRIVING,
	FLING_PX_PER_MS,
	LEAVING,
	MIN_FLING_PX,
	SETTLE_FRACTION,
	SheetMover,
	applyStylesNow
} from './sheetMotion';

export interface SwipeToOpenOptions {
	/** The sheet that comes up. */
	surface: () => HTMLElement | null | undefined;
	/** Whether a pull can open it now (it is closed, and laid out as a sheet). */
	enabled: () => boolean;
	/**
	 * Opens the sheet and renders it before returning (Svelte: set the state,
	 * then `flushSync()`), so it can be measured and placed out of sight
	 * before it is ever painted.
	 */
	onPullStart: () => void;
	/** Closes it again: the pull fell short. Called once it is out of sight. */
	onPullCancel: () => void;
	/** How far it is open as it follows the finger: 0 out of sight, 1 fully open. */
	onProgress?: (openness: number) => void;
}

type Phase = 'idle' | 'deciding' | 'pulling';

export class SwipeToOpen {
	#options: SwipeToOpenOptions;
	#mover: SheetMover;
	#phase: Phase = 'idle';
	#startX = 0;
	#startY = 0;
	/** How far up the finger had gone when the pull began; the sheet moves from there, so it does not jump. */
	#pullStart = 0;
	/** The sheet's height: how far it comes up to be fully open. */
	#travel = 1;
	#pulled = 0;
	#velocity = new FlingVelocity();

	constructor(options: SwipeToOpenOptions) {
		this.#options = options;
		this.#mover = new SheetMover(options.surface, 'y');
	}

	/**
	 * Follows the touches that start inside an element (the bar).
	 *
	 * @param root Where a pull may start.
	 * @returns Stops following them.
	 */
	listen(root: HTMLElement): () => void {
		if (!matchMedia(TOUCH_SCREEN_QUERY).matches) return () => {};

		const press = (event: TouchEvent) => this.#press(event, root);
		root.addEventListener('touchstart', press, { passive: true });
		// Not passive: a pull must not also scroll or refresh the page.
		root.addEventListener('touchmove', this.#move, { passive: false });
		root.addEventListener('touchend', this.#release);
		root.addEventListener('touchcancel', this.#abandon);

		return () => {
			root.removeEventListener('touchstart', press);
			root.removeEventListener('touchmove', this.#move);
			root.removeEventListener('touchend', this.#release);
			root.removeEventListener('touchcancel', this.#abandon);
			this.#mover.stop();
		};
	}

	#press(event: TouchEvent, root: HTMLElement): void {
		this.#phase = 'idle';
		if (event.touches.length !== 1 || !this.#options.enabled() || keepsItsOwnDrag(event.target, root)) return;
		this.#phase = 'deciding';
		this.#startX = event.touches[0].clientX;
		this.#startY = event.touches[0].clientY;
	}

	#move = (event: TouchEvent): void => {
		if (this.#phase === 'idle') return;
		const touch = event.touches[0];
		const up = this.#startY - touch.clientY;

		if (this.#phase === 'deciding') {
			const across = touch.clientX - this.#startX;
			const headingUp = up > 0 && Math.abs(across) < up;
			if (headingUp && event.cancelable) event.preventDefault();
			if (Math.hypot(up, across) < TOUCH_SLOP_PX) return;
			if (!headingUp || !this.#begin(up)) {
				this.#phase = 'idle';
				return;
			}
		}

		event.preventDefault();
		this.#follow(Math.min(this.#travel, Math.max(0, up - this.#pullStart)));
	};

	#release = (event: TouchEvent): void => {
		if (this.#phase !== 'pulling') {
			this.#phase = 'idle';
			return;
		}
		// The lift ends the pull; it must not also press the button it started on.
		event.preventDefault();
		this.#phase = 'idle';

		const velocity = this.#velocity.current();
		const pulledFar = this.#pulled >= this.#travel * SETTLE_FRACTION;
		const flicked = velocity >= FLING_PX_PER_MS && this.#pulled >= MIN_FLING_PX;
		if (pulledFar || flicked) this.#arrive();
		else this.#dropBack();
	};

	#abandon = (): void => {
		const wasPulling = this.#phase === 'pulling';
		this.#phase = 'idle';
		if (wasPulling) this.#dropBack();
	};

	/**
	 * Opens the sheet out of sight and starts following the finger; false when
	 * there is no sheet to move.
	 *
	 * @param up How far up the finger has already gone; the sheet starts from there.
	 */
	#begin(up: number): boolean {
		this.#options.onPullStart();
		const surface = this.#mover.grab();
		if (!surface) {
			this.#options.onPullCancel();
			return false;
		}
		this.#mover.place('100%');
		this.#travel = Math.max(1, surface.offsetHeight);
		this.#phase = 'pulling';
		this.#pullStart = up;
		this.#pulled = 0;
		this.#velocity.reset();
		this.#options.onProgress?.(0);
		return true;
	}

	#follow(pulled: number): void {
		this.#pulled = pulled;
		this.#velocity.add(pulled);
		this.#mover.follow(this.#travel - pulled);
		this.#options.onProgress?.(pulled / this.#travel);
	}

	/** Rises the rest of the way, then hands the sheet back to its own (open) styles. */
	#arrive(): void {
		this.#options.onProgress?.(1);
		this.#mover.settle(0, ARRIVING, () => this.#mover.release());
	}

	/**
	 * Drops back out of sight, then closes it and hands it back to its own
	 * styles, which by then are the closed ones (see `SwipeToDismiss`).
	 */
	#dropBack(): void {
		this.#options.onProgress?.(0);
		this.#mover.settle(this.#travel, LEAVING, () => {
			const surface = this.#options.surface();
			if (surface) surface.style.transition = 'none';
			this.#options.onPullCancel();
			requestAnimationFrame(() => {
				if (surface) applyStylesNow(surface);
				this.#mover.release();
			});
		});
	}
}
