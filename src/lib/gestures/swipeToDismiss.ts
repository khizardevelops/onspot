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
 */
import { FlingVelocity, TOUCH_SCREEN_QUERY, TOUCH_SLOP_PX, keepsItsOwnDrag } from './touch';

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

/** Dragged past this share of its way off the screen, the surface leaves when the finger lifts. */
const DISMISS_FRACTION = 0.3;
/** A flick this fast (px/ms) away from the screen dismisses it however short it was (vaul's drawers use 0.4 too). */
const FLING_PX_PER_MS = 0.4;
/** A flick also has to travel this far, so a twitch on lifting does not count. */
const MIN_FLING_PX = 24;
/** Leaving and springing back, in ms; reduced motion makes both immediate. */
const LEAVE_MS = 180;
const RETURN_MS = 220;
const LEAVE_EASING = 'cubic-bezier(0.4, 0, 1, 1)';
const RETURN_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';

/**
 * Touches an inner gesture has taken (the stats sheet inside Feedback). The
 * inner listener runs first as the touch bubbles, so the outer one leaves them.
 */
const takenTouches = new WeakSet<TouchEvent>();

type Phase = 'idle' | 'deciding' | 'dragging';

export class SwipeToDismiss {
	#options: SwipeToDismissOptions;
	#phase: Phase = 'idle';
	#startX = 0;
	#startY = 0;
	/** How far the surface can travel before it is off the screen, measured when the drag starts. */
	#travel = 1;
	#offset = 0;
	#velocity = new FlingVelocity();
	#settling: ReturnType<typeof setTimeout> | null = null;

	constructor(options: SwipeToDismissOptions) {
		this.#options = options;
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
			this.#clearSettling();
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
			if (Math.hypot(along, across) < TOUCH_SLOP_PX) return;
			// The first move decides: towards the way out, and more along than across.
			if (along <= 0 || Math.abs(across) >= along || !this.#begin()) {
				this.#phase = 'idle';
				return;
			}
		}

		event.preventDefault();
		this.#follow(Math.max(0, along));
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
		const draggedFar = this.#offset >= this.#travel * DISMISS_FRACTION;
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

	/** Starts following the finger; false when there is no surface to move. */
	#begin(): boolean {
		const surface = this.#options.surface();
		if (!surface) return false;
		this.#clearSettling();
		this.#phase = 'dragging';
		this.#velocity.reset();

		// Measured from where the surface is now to the edge of the screen it leaves by.
		const box = surface.getBoundingClientRect();
		this.#travel = Math.max(1, this.#options.direction === 'down' ? innerHeight - box.top : innerWidth - box.left);
		surface.style.transition = 'none';
		return true;
	}

	#follow(offset: number): void {
		this.#offset = offset;
		this.#velocity.add(offset);
		this.#place(offset);
		this.#options.onProgress?.(Math.min(1, offset / this.#travel));
	}

	#place(offset: number): void {
		const surface = this.#options.surface();
		if (!surface) return;
		surface.style.translate = this.#options.direction === 'down' ? `0 ${offset}px` : `${offset}px 0`;
	}

	/**
	 * Slides the rest of the way out, then closes and hands the surface back to
	 * its own styles. Its closing transition (the stats sheet slides down) must
	 * not play as well: the closed styles are applied with transitions off, and
	 * only then is the offset dropped, so it stays out of sight throughout.
	 */
	#leave(): void {
		const duration = this.#settle(LEAVE_MS, LEAVE_EASING);
		this.#place(this.#travel);
		this.#options.onProgress?.(1);
		this.#afterSettling(duration, () => {
			const surface = this.#options.surface();
			if (surface) surface.style.transition = 'none';
			this.#options.onDismiss();
			// The next frame: the component has rendered the closed state by then.
			requestAnimationFrame(() => {
				if (surface) applyStylesNow(surface);
				this.#restoreStyles();
			});
		});
	}

	#springBack(): void {
		const duration = this.#settle(RETURN_MS, RETURN_EASING);
		this.#place(0);
		this.#options.onProgress?.(0);
		this.#afterSettling(duration, () => this.#restoreStyles());
	}

	/** Animates the surface's next move; returns how long it takes. */
	#settle(duration: number, easing: string): number {
		const surface = this.#options.surface();
		const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
		const ms = reducedMotion ? 0 : duration;
		if (surface) surface.style.transition = ms ? `translate ${ms}ms ${easing}` : 'none';
		return ms;
	}

	/** A timer rather than `transitionend`, which never comes when nothing moved. */
	#afterSettling(duration: number, then: () => void): void {
		this.#clearSettling();
		this.#settling = setTimeout(() => {
			this.#settling = null;
			then();
		}, duration);
	}

	#clearSettling(): void {
		if (this.#settling) clearTimeout(this.#settling);
		this.#settling = null;
	}

	#restoreStyles(): void {
		const surface = this.#options.surface();
		this.#offset = 0;
		this.#options.onProgress?.(0);
		if (!surface) return;
		surface.style.removeProperty('translate');
		surface.style.removeProperty('transition');
	}
}

/** Makes the browser compute an element's styles now, so later style changes do not transition from earlier ones. */
function applyStylesNow(element: HTMLElement): void {
	element.getBoundingClientRect();
}
