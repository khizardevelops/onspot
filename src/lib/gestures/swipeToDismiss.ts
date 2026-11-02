// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Swipe a sheet away: the surface follows the finger in the direction it
 * leaves, and on lift it either leaves (dragged far enough, or flicked) or
 * springs back. Touch only; a mouse keeps the close buttons.
 *
 * It never fights scrolling. A touch on scrolling content counts only while
 * that content is at its start (a list at its top for a sheet that leaves
 * downwards), and the first move decides: a move the other way, or across,
 * is left to the browser for the whole touch. Touch events, not pointer
 * events, because only a cancelled `touchmove` can take a touch away from
 * the browser's scrolling after it began.
 *
 * A slow drag is claimed early: every move towards the way out is cancelled
 * from the first one, before it has gone far enough to count as a swipe. The
 * browser's own scroll threshold (about 8 px) is shorter than ours, so a
 * slow drag otherwise became a scroll first (the list stretched at its top)
 * and the sheet and the list both moved, flickering.
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

/** Which way the surface leaves the screen. */
export type DismissDirection = 'down' | 'right';

export interface SwipeToDismissOptions {
	direction: DismissDirection;
	/** The element that follows the finger. */
	surface: () => HTMLElement | null | undefined;
	/** The surface's scrolling content, if any: a touch on it drags the surface only while it is scrolled to its start. */
	scroller?: () => HTMLElement | null | undefined;
	/** Whether the surface can be swiped away now (it is open, and laid out as a sheet). */
	enabled: () => boolean;
	/** Closes the surface; called once it has left the screen. */
	onDismiss: () => void;
	/** How far it has gone as it follows the finger: 0 in place, 1 off the screen. */
	onProgress?: (progress: number) => void;
}

/**
 * Touches an inner gesture has taken (the stats sheet inside Feedback). The
 * inner listener runs first as the touch bubbles, so the outer one leaves them.
 */
const takenTouches = new WeakSet<TouchEvent>();

type Phase = 'idle' | 'deciding' | 'dragging';

export class SwipeToDismiss {
	#options: SwipeToDismissOptions;
	#mover: SheetMover;
	#phase: Phase = 'idle';
	#startX = 0;
	#startY = 0;
	/** How far along the finger had gone when the drag began; the surface moves from there, so it does not jump. */
	#dragStart = 0;
	/** How far the surface can travel before it is off the screen, measured when the drag starts. */
	#travel = 1;
	#offset = 0;
	#velocity = new FlingVelocity();

	constructor(options: SwipeToDismissOptions) {
		this.#options = options;
		this.#mover = new SheetMover(options.surface, options.direction === 'down' ? 'y' : 'x');
	}

	/**
	 * Follows the touches that start inside an element (usually the surface itself).
	 *
	 * @param root Where a swipe may start.
	 * @returns Stops following them.
	 */
	listen(root: HTMLElement): () => void {
		if (!matchMedia(TOUCH_SCREEN_QUERY).matches) return () => {};

		const press = (event: TouchEvent) => this.#press(event, root);
		root.addEventListener('touchstart', press, { passive: true });
		// Not passive: once the surface follows the finger, the move must not also scroll.
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
		if (takenTouches.has(event) || event.touches.length !== 1 || !this.#options.enabled()) return;
		if (keepsItsOwnDrag(event.target, root) || this.#scrollerIsAway(event.target)) return;

		takenTouches.add(event);
		this.#phase = 'deciding';
		this.#startX = event.touches[0].clientX;
		this.#startY = event.touches[0].clientY;
	}

	#move = (event: TouchEvent): void => {
		if (this.#phase === 'idle') return;
		const touch = event.touches[0];
		const along = this.#alongDirection(touch);

		if (this.#phase === 'deciding') {
			const across = this.#acrossDirection(touch);
			// Towards the way out, and more along than across.
			const headingOut = along > 0 && Math.abs(across) < along;
			// Claimed before the browser can start a scroll of its own (see above).
			if (headingOut && event.cancelable) event.preventDefault();
			if (Math.hypot(along, across) < TOUCH_SLOP_PX) return;
			// The first move past the slop decides.
			if (!headingOut || !this.#begin(along)) {
				this.#phase = 'idle';
				return;
			}
		}

		event.preventDefault();
		this.#follow(Math.max(0, along - this.#dragStart));
	};

	#release = (event: TouchEvent): void => {
		if (this.#phase !== 'dragging') {
			this.#phase = 'idle';
			return;
		}
		// The lift ends the drag; it must not also tap whatever is under the finger.
		event.preventDefault();
		this.#phase = 'idle';

		const velocity = this.#velocity.current();
		const draggedFar = this.#offset >= this.#travel * SETTLE_FRACTION;
		const flicked = velocity >= FLING_PX_PER_MS && this.#offset >= MIN_FLING_PX;
		if (draggedFar || flicked) this.#leave();
		else this.#springBack();
	};

	#abandon = (): void => {
		const wasDragging = this.#phase === 'dragging';
		this.#phase = 'idle';
		if (wasDragging) this.#springBack();
	};

	/** A touch on content scrolled away from its start is a scroll, never a swipe. */
	#scrollerIsAway(target: EventTarget | null): boolean {
		const scroller = this.#options.scroller?.();
		if (!scroller || !(target instanceof Node) || !scroller.contains(target)) return false;
		return this.#options.direction === 'down' ? scroller.scrollTop > 0 : scroller.scrollLeft > 0;
	}

	#alongDirection(touch: Touch): number {
		return this.#options.direction === 'down' ? touch.clientY - this.#startY : touch.clientX - this.#startX;
	}

	#acrossDirection(touch: Touch): number {
		return this.#options.direction === 'down' ? touch.clientX - this.#startX : touch.clientY - this.#startY;
	}

	/**
	 * Starts following the finger; false when there is no surface to move.
	 *
	 * @param along How far the finger has already gone; the surface starts from there.
	 */
	#begin(along: number): boolean {
		const surface = this.#mover.grab();
		if (!surface) return false;
		this.#phase = 'dragging';
		this.#dragStart = along;
		this.#velocity.reset();

		// Measured from where the surface is now to the edge of the screen it leaves by.
		const box = surface.getBoundingClientRect();
		this.#travel = Math.max(1, this.#options.direction === 'down' ? innerHeight - box.top : innerWidth - box.left);
		return true;
	}

	#follow(offset: number): void {
		this.#offset = offset;
		this.#velocity.add(offset);
		this.#mover.follow(offset);
		this.#options.onProgress?.(Math.min(1, offset / this.#travel));
	}

	/**
	 * Slides the rest of the way out, then closes and hands the surface back to
	 * its own styles. Its closing transition (the stats sheet slides down) must
	 * not play as well: the closed styles are applied with transitions off, and
	 * only then is the offset dropped, so it stays out of sight throughout.
	 */
	#leave(): void {
		this.#options.onProgress?.(1);
		this.#mover.settle(this.#travel, LEAVING, () => {
			const surface = this.#options.surface();
			if (surface) surface.style.transition = 'none';
			this.#options.onDismiss();
			// The next frame: the component has rendered the closed state by then.
			requestAnimationFrame(() => {
				if (surface) applyStylesNow(surface);
				this.#restore();
			});
		});
	}

	#springBack(): void {
		this.#options.onProgress?.(0);
		this.#mover.settle(0, ARRIVING, () => this.#restore());
	}

	#restore(): void {
		this.#offset = 0;
		this.#options.onProgress?.(0);
		this.#mover.release();
	}
}
