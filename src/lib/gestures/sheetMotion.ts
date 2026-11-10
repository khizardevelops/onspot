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

/**
 * The curve a sheet moves along, as cubic-bezier control points: it gathers
 * speed over its first frames and eases into place. Its peak is about twice
 * the average speed. The curves sheets used before moved 263 px in the first
 * frame of a 700 px rise (180 ms, 0.22/1/0.36/1), which read as a jump; a
 * sheet is large, and needs to be seen travelling. `PracticeScreen.svelte`'s
 * `--feedback-sheet-easing` is this curve at rest.
 */
const SHEET_CURVE = { x1: 0.35, restingY1: 0.1, x2: 0.3, y2: 1 } as const;

/** A sheet let go without a flick settles at this pace: a whole phone sheet (about 700 px) in about 420 ms. */
const CALM_SETTLE_MS_PER_PX = 0.6;

/** However short or fast, a settle takes this long at least (so it reads as motion, not a jump) and at most. */
const SETTLE_MS = { min: 200, max: 420 } as const;

/** The steepest the curve can start: its first control point at full height. */
const STEEPEST_START = 1 / SHEET_CURVE.x1;

/** `SHEET_CURVE` starting at `startSlope` times its average speed (never slower than at rest). */
function sheetEasing(startSlope: number): string {
	const y1 = Math.min(1, Math.max(SHEET_CURVE.restingY1, startSlope * SHEET_CURVE.x1));
	return `cubic-bezier(${SHEET_CURVE.x1}, ${y1.toFixed(3)}, ${SHEET_CURVE.x2}, ${SHEET_CURVE.y2})`;
}

/**
 * How a sheet settles once the finger lets it go. The further it still has
 * to go, the longer it takes, so a sheet let go halfway eases the rest of the
 * way instead of jumping there, and it starts at the speed the finger left
 * it at: it does not lurch forward on a slow release or stall on a flick. A
 * flick too fast for the curve to match shortens the settle instead.
 *
 * @param distance How far the sheet still has to go, in px.
 * @param speed How fast the finger was moving that way as it lifted, px/ms; 0 or less when it was not.
 */
export function settleMotion(distance: number, speed: number): SettleMotion {
	const remaining = Math.abs(distance);
	const calmMs = remaining * CALM_SETTLE_MS_PER_PX;
	const flungMs = speed > 0 ? (STEEPEST_START * remaining) / speed : Infinity;
	const ms = Math.round(Math.min(SETTLE_MS.max, Math.max(SETTLE_MS.min, Math.min(calmMs, flungMs))));

	const startSlope = remaining > 0 ? (speed * ms) / remaining : 0;
	return { ms, easing: sheetEasing(startSlope) };
}

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
