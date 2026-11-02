// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Moving a sheet with the finger, shared by the swipes that close one and the
 * swipe that pulls one open: when a drag has gone far enough or fast enough,
 * how the sheet settles once the finger lifts, and the mover that places it.
 *
 * The mover keeps a slow drag smooth on phones. While the sheet moves it has
 * its own compositor layer (`will-change`), so following the finger is not a
 * repaint of its paper, shadows and cards on every move, and it is placed
 * once per frame however many touch events arrive in between.
 */

/** Dragged past this share of its way, the sheet goes the rest of the way when the finger lifts. */
export const SETTLE_FRACTION = 0.3;
/** A flick this fast (px/ms) carries the sheet the rest of the way however short it was (vaul's drawers use 0.4 too). */
export const FLING_PX_PER_MS = 0.4;
/** A flick also has to travel this far, so a twitch on lifting does not count. */
export const MIN_FLING_PX = 24;

/** How a sheet settles once the finger lifts. */
export interface SettleMotion {
	ms: number;
	easing: string;
}

/** Leaving the screen: quick, accelerating away. */
export const LEAVING: SettleMotion = { ms: 180, easing: 'cubic-bezier(0.4, 0, 1, 1)' };
/** Coming to rest in place (springing back, or arriving open): decelerating into place. */
export const ARRIVING: SettleMotion = { ms: 220, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' };

/** The axis the sheet moves along: down and up are `y`, sideways is `x`. */
export type SheetAxis = 'x' | 'y';

export class SheetMover {
	#surface: () => HTMLElement | null | undefined;
	#axis: SheetAxis;
	/** The offset waiting for the next frame, and that frame. */
	#pendingOffset: number | null = null;
	#frame = 0;
	#settling: ReturnType<typeof setTimeout> | null = null;

	/**
	 * @param surface The element that moves.
	 * @param axis Which way it moves.
	 */
	constructor(surface: () => HTMLElement | null | undefined, axis: SheetAxis) {
		this.#surface = surface;
		this.#axis = axis;
	}

	/**
	 * Takes the surface over for a drag: it stops any settling, drops its
	 * transition so it follows the finger exactly, and gets its own layer.
	 *
	 * @returns The surface, or null when there is none to move.
	 */
	grab(): HTMLElement | null {
		const surface = this.#surface();
		if (!surface) return null;
		this.#stopSettling();
		this.#cancelFrame();
		surface.style.transition = 'none';
		surface.style.willChange = 'translate';
		return surface;
	}

	/** Places the surface `offset` px along its axis, at the next frame. */
	follow(offset: number): void {
		this.#pendingOffset = offset;
		if (this.#frame) return;
		this.#frame = requestAnimationFrame(() => {
			this.#frame = 0;
			if (this.#pendingOffset !== null) this.place(this.#pendingOffset);
			this.#pendingOffset = null;
		});
	}

	/** Places the surface now; a CSS length (such as `100%`) or px. */
	place(offset: number | string): void {
		const surface = this.#surface();
		if (!surface) return;
		const length = typeof offset === 'number' ? `${offset}px` : offset;
		surface.style.translate = this.#axis === 'y' ? `0 ${length}` : `${length} 0`;
	}

	/**
	 * Animates the surface to `offset`, then calls `then`. Reduced motion
	 * moves it at once.
	 */
	settle(offset: number, motion: SettleMotion, then: () => void): void {
		const surface = this.#surface();
		this.#cancelFrame();
		const ms = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : motion.ms;
		if (surface) surface.style.transition = ms ? `translate ${ms}ms ${motion.easing}` : 'none';
		this.place(offset);
		// A timer rather than `transitionend`, which never comes when nothing moved.
		this.#stopSettling();
		this.#settling = setTimeout(() => {
			this.#settling = null;
			then();
		}, ms);
	}

	/** Hands the surface back to its own styles. */
	release(): void {
		this.#stopSettling();
		this.#cancelFrame();
		const surface = this.#surface();
		if (!surface) return;
		surface.style.removeProperty('translate');
		surface.style.removeProperty('transition');
		surface.style.removeProperty('will-change');
	}

	/** Stops everything pending (the listener is going away). */
	stop(): void {
		this.#stopSettling();
		this.#cancelFrame();
	}

	#cancelFrame(): void {
		if (this.#frame) cancelAnimationFrame(this.#frame);
		this.#frame = 0;
		this.#pendingOffset = null;
	}

	#stopSettling(): void {
		if (this.#settling) clearTimeout(this.#settling);
		this.#settling = null;
	}
}

/** Makes the browser compute an element's styles now, so later style changes do not transition from earlier ones. */
export function applyStylesNow(element: HTMLElement): void {
	element.getBoundingClientRect();
}
