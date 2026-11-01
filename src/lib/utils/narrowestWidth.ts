// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * How narrow a box can get before its content has to lay out differently.
 *
 * The box is laid out at trial widths and each watched element is compared
 * with how it sits at the box's full width: it must keep its height (no extra
 * line, not hidden by a container query) and must not overflow or cut off
 * more of its content. Line breaking only ever adds lines as a box narrows,
 * so a binary search finds the narrowest width that passes.
 *
 * Trial widths go through `min-width` and `max-width`, never `width`, so a
 * transition running on the box's `width` carries on undisturbed. Every trial
 * happens inside one task: nothing is painted, and no ResizeObserver ever sees
 * a trial size, so measuring cannot feed back into itself.
 */

/** Where a watched element sits, in the terms that matter for "laid out the same". */
interface ElementShape {
	height: number;
	/** How much of its content runs past its right edge (overflow, or text cut by an ellipsis). */
	overflow: number;
}

/** Height differences below this are sub-pixel rounding, not a new line. */
const SAME_HEIGHT_TOLERANCE_PX = 0.5;

export interface NarrowestWidthOptions {
	/** The box whose width is being decided. */
	box: HTMLElement;
	/** The widest the box may be, as any CSS length (a `var()` is fine). */
	maxWidth: string;
	/** Elements that must lay out as they do at `maxWidth`. */
	watched: HTMLElement[];
	/** Scrolling elements inside the box; a trial must not move their scroll position. */
	scrollers: HTMLElement[];
}

/**
 * The narrowest whole-pixel width at which every watched element lays out as
 * it does when the box is `maxWidth` wide.
 *
 * @param options The box, its maximum width, the elements to keep as they are
 *   and the scrolling elements to leave where they are.
 * @returns A width in px; the maximum itself when nothing can give way.
 */
export function narrowestWidthKeepingLayout({ box, maxWidth, watched, scrollers }: NarrowestWidthOptions): number {
	const scrollPositions = scrollers.map((scroller) => scroller.scrollTop);

	try {
		const fullWidth = layOutAt(box, maxWidth);
		const fullWidthShapes = watched.map(readShape);

		const keepsLayoutAt = (width: number): boolean => {
			layOutAt(box, `${width}px`);
			return watched.every((element, index) => isSameShape(readShape(element), fullWidthShapes[index]));
		};

		// `fitting` always keeps the layout and `tooNarrow` never does; close the gap to a pixel.
		let fitting = fullWidth;
		let tooNarrow = 0;
		while (fitting - tooNarrow > 1) {
			const trialWidth = Math.floor((fitting + tooNarrow) / 2);
			if (keepsLayoutAt(trialWidth)) fitting = trialWidth;
			else tooNarrow = trialWidth;
		}

		return Math.ceil(fitting);
	} finally {
		box.style.removeProperty('min-width');
		box.style.removeProperty('max-width');

		// A wider trial shortens the content, and the browser clamps the scroll position to fit.
		scrollers.forEach((scroller, index) => {
			const savedPosition = scrollPositions[index];
			if (scroller.scrollTop !== savedPosition) scroller.scrollTop = savedPosition;
		});
	}
}

/** Pins the box to `width` and returns the width it then lays out at, in px. */
function layOutAt(box: HTMLElement, width: string): number {
	box.style.minWidth = width;
	box.style.maxWidth = width;
	return box.getBoundingClientRect().width;
}

function readShape(element: HTMLElement): ElementShape {
	return {
		height: element.getBoundingClientRect().height,
		overflow: element.scrollWidth - element.clientWidth
	};
}

/** True when `trial` has the reference's height and overflows no more than it does. */
function isSameShape(trial: ElementShape, reference: ElementShape): boolean {
	const sameHeight = Math.abs(trial.height - reference.height) < SAME_HEIGHT_TOLERANCE_PX;
	const noMoreOverflow = trial.overflow <= reference.overflow;
	return sameHeight && noMoreOverflow;
}
