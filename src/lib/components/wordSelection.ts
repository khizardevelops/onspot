// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Selection by whole words. A word (the text between spaces, as the
 * transcript splits it) is the smallest thing a learner can select: dragging
 * grows the selection a word at a time, the way a double-click-and-drag does,
 * so nobody has to aim at the first and last letter of a phrase.
 *
 * With a mouse the selection stays the browser's own (it is drawn, and
 * copies, as usual); only its edges are placed on word boundaries: the drag is
 * handled here and the browser's letter-by-letter selection is prevented.
 *
 * Touch screens have no platform text selection at all (app.css turns it
 * off: its handles and Cut/Copy menu got in the way). There a long press and
 * drag selects words the app's own way (`TouchWordSelection`), reported as a
 * word range rather than made in the document. A finger that moves past the
 * touch slop before the long press is scrolling, not selecting.
 */
import { TOUCH_SCREEN_QUERY, TOUCH_SLOP_PX } from '#lib/gestures/touch.js';

/** The transcript renders every word with its index in this attribute. */
const WORD_SELECTOR = '[data-word-index]';

/** Movement that turns a press into a drag, so a plain click still plays the word. */
const DRAG_THRESHOLD_PX = 4;

/** How long a finger rests on a word before it starts selecting: Android's long-press timeout. */
const LONG_PRESS_MS = 400;

/** Words `start`..`end` by index, first to last. */
export interface WordRange {
	start: number;
	end: number;
}

function wordIndexOf(word: HTMLElement): number {
	return Number(word.dataset.wordIndex);
}

function textOf(word: HTMLElement | null): Text | null {
	const text = word?.firstChild;
	return text instanceof Text ? text : null;
}

/** The element of word `index` inside `root`. */
function wordElement(root: HTMLElement, index: number): HTMLElement | null {
	return root.querySelector<HTMLElement>(`[data-word-index="${index}"]`);
}

/**
 * A DOM range over words `start`..`end`, for measuring where they are on
 * screen. It is not the document's selection, so nothing is selected.
 *
 * @param root The transcript.
 * @returns The range, or null when those words are not rendered.
 */
export function rangeOfWords(root: HTMLElement, start: number, end: number): Range | null {
	const firstText = textOf(wordElement(root, start));
	const lastText = textOf(wordElement(root, end));
	if (!firstText || !lastText) return null;

	const range = document.createRange();
	range.setStart(firstText, 0);
	range.setEnd(lastText, lastText.length);
	return range;
}

/**
 * Selects every word from one word element to another, in either order.
 *
 * @param from The word the selection starts at (where the press began).
 * @param to The word it reaches.
 */
export function selectWords(from: HTMLElement, to: HTMLElement): void {
	const selection = getSelection();
	const [first, last] = wordIndexOf(from) <= wordIndexOf(to) ? [from, to] : [to, from];
	const firstText = textOf(first);
	const lastText = textOf(last);
	if (!selection || !firstText || !lastText) return;

	selection.setBaseAndExtent(firstText, 0, lastText, lastText.length);
}

/**
 * The words a selection inside `root` touches, in order.
 *
 * @param root The transcript.
 * @returns The touched word elements; empty when the selection is elsewhere or collapsed.
 */
export function selectedWords(root: HTMLElement): HTMLElement[] {
	const selection = getSelection();
	const hasSelection = selection && !selection.isCollapsed && selection.rangeCount > 0;
	if (!hasSelection) return [];

	const range = selection.getRangeAt(0);
	if (!root.contains(range.commonAncestorContainer)) return [];

	return [...root.querySelectorAll<HTMLElement>(WORD_SELECTOR)].filter((word) => range.intersectsNode(word));
}

/**
 * The first and last word a selection inside `root` touches.
 *
 * @param root The transcript.
 * @returns Their word indexes, or null when nothing in `root` is selected.
 */
export function selectedWordRange(root: HTMLElement): { start: number; end: number } | null {
	const words = selectedWords(root);
	if (words.length === 0) return null;

	return { start: wordIndexOf(words[0]), end: wordIndexOf(words[words.length - 1]) };
}

/**
 * Grows a selection inside `root` to whole words: a part of a word selects the
 * whole word. For a touchscreen with a mouse too, which keeps the platform's
 * long-press handles; they move by letters.
 *
 * @param root The transcript.
 * @returns True when the selection was moved (it then fires another `selectionchange`).
 */
export function snapSelectionToWords(root: HTMLElement): boolean {
	const words = selectedWords(root);
	if (words.length === 0) return false;

	const range = getSelection()!.getRangeAt(0);
	const firstText = textOf(words[0]);
	const lastText = textOf(words[words.length - 1]);
	const alreadyWhole =
		range.startContainer === firstText &&
		range.startOffset === 0 &&
		range.endContainer === lastText &&
		range.endOffset === lastText?.length;
	if (alreadyWhole) return false;

	selectWords(words[0], words[words.length - 1]);
	return true;
}

/**
 * Mouse selection by words for one transcript. Press on a word and drag:
 * the selection follows the pointer a word at a time. Shift+click extends the
 * current selection to another word; a double-click selects one word.
 */
export class WordDragSelection {
	#root: () => HTMLElement | null;
	#onFinished: () => void;
	#keepsSelection: (word: HTMLElement) => boolean;
	#anchor: HTMLElement | null = null;
	#last: HTMLElement | null = null;
	#startX = 0;
	#startY = 0;
	#dragged = false;
	#clickEndsDrag = false;

	/** True while the mouse is dragging a selection; meanings wait until it ends. */
	dragging = false;

	/**
	 * @param root The transcript element.
	 * @param onFinished Called when a selection is complete (mouse released, double-click).
	 * @param keepsSelection True for a word whose plain click keeps the current selection (a word inside it).
	 */
	constructor(root: () => HTMLElement | null, onFinished: () => void, keepsSelection: (word: HTMLElement) => boolean = () => false) {
		this.#root = root;
		this.#onFinished = onFinished;
		this.#keepsSelection = keepsSelection;
	}

	/** The word under a point, if it belongs to this transcript. */
	#wordAt(x: number, y: number): HTMLElement | null {
		const word = document.elementFromPoint(x, y)?.closest<HTMLElement>(WORD_SELECTOR) ?? null;
		return word && this.#root()?.contains(word) ? word : null;
	}

	/** A mouse press in the transcript. Prevents the browser's letter-by-letter selection. */
	press(event: MouseEvent): void {
		if (event.button !== 0) return;
		event.preventDefault();

		const word = (event.target as Element).closest<HTMLElement>(WORD_SELECTOR);
		const extending = event.shiftKey && this.#anchor && word;
		if (extending) {
			selectWords(this.#anchor!, word);
			this.#swallowClick();
			this.#onFinished();
			return;
		}

		this.#anchor = word;
		this.#last = word;
		this.#startX = event.clientX;
		this.#startY = event.clientY;
		this.#dragged = false;
		window.addEventListener('mousemove', this.#move);
		window.addEventListener('mouseup', this.#release, { once: true });
	}

	#move = (event: MouseEvent): void => {
		const distance = Math.hypot(event.clientX - this.#startX, event.clientY - this.#startY);
		if (!this.#dragged && distance < DRAG_THRESHOLD_PX) return;
		this.#dragged = true;
		this.dragging = true;

		// Between words (a space, a comma) the selection keeps its last word.
		const word = this.#wordAt(event.clientX, event.clientY) ?? this.#last;
		if (!word) return;

		this.#anchor ??= word;
		this.#last = word;
		selectWords(this.#anchor, word);
	};

	#release = (): void => {
		window.removeEventListener('mousemove', this.#move);
		this.dragging = false;

		if (this.#dragged) {
			this.#swallowClick();
			this.#onFinished();
			return;
		}

		// A plain click inside the selection keeps it: it is one unit until a click elsewhere.
		if (this.#anchor && this.#keepsSelection(this.#anchor)) return;

		// A plain click: the press prevented the browser from clearing an old selection, so clear it here.
		const root = this.#root();
		const selection = getSelection();
		if (root && selection && root.contains(selection.anchorNode)) selection.removeAllRanges();
	};

	/** A double-click selects the one word under it. A phone's double tap is not a selection there. */
	selectOne(event: MouseEvent): void {
		if (matchMedia(TOUCH_SCREEN_QUERY).matches) return;

		const word = (event.target as Element).closest<HTMLElement>(WORD_SELECTOR);
		if (!word) return;

		this.#anchor = word;
		selectWords(word, word);
		this.#onFinished();
	}

	/**
	 * Marks the click that follows this press as part of a selection. The flag
	 * lives only until the current input event is done: a drag that ends on
	 * another word sends its click to their common parent, not to a word, and
	 * the next real click must still play.
	 */
	#swallowClick(): void {
		this.#clickEndsDrag = true;
		setTimeout(() => (this.#clickEndsDrag = false), 0);
	}

	/**
	 * True once for the click that ends a drag or a Shift+click, so that click
	 * does not also play the word.
	 */
	consumeSelectionClick(): boolean {
		const wasSelection = this.#clickEndsDrag;
		this.#clickEndsDrag = false;
		return wasSelection;
	}
}

/** The finger selection on screen: one at a time, across every transcript. */
let shownTouchSelection: TouchWordSelection | null = null;

/**
 * Touch selection by words, in place of the platform's own (turned off on
 * touch screens): no handles and no Cut/Copy menu. Long-press a word to
 * select it, keep the finger down and drag to grow the selection a word at a
 * time, lift to finish. A finger that moves before the long press scrolls as
 * usual. A tap anywhere else puts the selection away (`clear`).
 */
export class TouchWordSelection {
	#onChange: (range: WordRange | null) => void;
	#onFinished: (range: WordRange) => void;
	#root: HTMLElement | null = null;
	#pressTimer: ReturnType<typeof setTimeout> | null = null;
	#startX = 0;
	#startY = 0;
	#anchor: HTMLElement | null = null;
	#last: HTMLElement | null = null;
	#selecting = false;
	#range: WordRange | null = null;

	/**
	 * @param onChange Called as the selected words change, and with null when the selection is put away.
	 * @param onFinished Called when the finger lifts with words selected.
	 */
	constructor(onChange: (range: WordRange | null) => void, onFinished: (range: WordRange) => void) {
		this.#onChange = onChange;
		this.#onFinished = onFinished;
	}

	/**
	 * Follows the touches on a transcript; does nothing where there is a mouse.
	 *
	 * @param root The transcript.
	 * @returns Stops following them.
	 */
	listen(root: HTMLElement): () => void {
		if (!matchMedia(TOUCH_SCREEN_QUERY).matches) return () => {};

		this.#root = root;
		root.addEventListener('touchstart', this.#press, { passive: true });
		// Not passive: once the finger is selecting, its moves must not scroll.
		root.addEventListener('touchmove', this.#move, { passive: false });
		root.addEventListener('touchend', this.#release);
		root.addEventListener('touchcancel', this.#abandon);
		root.addEventListener('contextmenu', this.#suppressMenu);

		return () => {
			this.#stopTimer();
			root.removeEventListener('touchstart', this.#press);
			root.removeEventListener('touchmove', this.#move);
			root.removeEventListener('touchend', this.#release);
			root.removeEventListener('touchcancel', this.#abandon);
			root.removeEventListener('contextmenu', this.#suppressMenu);
		};
	}

	/** Puts the selection away, as a tap elsewhere does to the platform's. */
	clear(): void {
		if (!this.#range) return;

		this.#range = null;
		if (shownTouchSelection === this) shownTouchSelection = null;
		this.#onChange(null);
	}

	#press = (event: TouchEvent): void => {
		this.#stopTimer();
		// A second finger is a pinch, not a selection.
		if (event.touches.length !== 1) return;

		const word = (event.target as Element).closest<HTMLElement>(WORD_SELECTOR);
		if (!word) return;

		this.#startX = event.touches[0].clientX;
		this.#startY = event.touches[0].clientY;
		this.#pressTimer = setTimeout(() => this.#begin(word), LONG_PRESS_MS);
	};

	/** The long press: the pressed word is selected, and the finger now chooses words. */
	#begin(word: HTMLElement): void {
		this.#pressTimer = null;
		if (shownTouchSelection !== this) shownTouchSelection?.clear();
		shownTouchSelection = this;

		this.#selecting = true;
		this.#anchor = word;
		this.#selectTo(word);
	}

	#move = (event: TouchEvent): void => {
		const touch = event.touches[0];
		if (!this.#selecting) {
			const moved = Math.hypot(touch.clientX - this.#startX, touch.clientY - this.#startY);
			if (moved > TOUCH_SLOP_PX) this.#stopTimer();
			return;
		}

		event.preventDefault();
		// Between words (a space, a comma) the selection keeps its last word.
		const word = this.#wordAt(touch.clientX, touch.clientY) ?? this.#last;
		if (word) this.#selectTo(word);
	};

	#release = (event: TouchEvent): void => {
		this.#stopTimer();
		if (!this.#selecting) return;

		// The lift ends the selection; it must not also click (and play) the word under it.
		event.preventDefault();
		this.#selecting = false;
		if (this.#range) this.#onFinished(this.#range);
	};

	#abandon = (): void => {
		this.#stopTimer();
		if (!this.#selecting) return;

		this.#selecting = false;
		this.clear();
	};

	/** A long press on text would open the platform's menu; here it selects. */
	#suppressMenu = (event: Event): void => {
		event.preventDefault();
	};

	#selectTo(word: HTMLElement): void {
		this.#last = word;
		const from = wordIndexOf(this.#anchor!);
		const to = wordIndexOf(word);
		const range = { start: Math.min(from, to), end: Math.max(from, to) };

		const unchanged = range.start === this.#range?.start && range.end === this.#range?.end;
		if (unchanged) return;
		this.#range = range;
		this.#onChange(range);
	}

	/** The word under a point, if it belongs to this transcript. */
	#wordAt(x: number, y: number): HTMLElement | null {
		const word = document.elementFromPoint(x, y)?.closest<HTMLElement>(WORD_SELECTOR) ?? null;
		return word && this.#root?.contains(word) ? word : null;
	}

	#stopTimer(): void {
		if (this.#pressTimer) clearTimeout(this.#pressTimer);
		this.#pressTimer = null;
	}
}
