// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReferenceElement, VirtualElement } from '@floating-ui/dom';
import type { PhraseGloss, TextGlosses } from '#lib/adapters/db/index.js';
import { hasMeaningAt } from '#lib/adapters/llm/glossary.js';
import { rangeOfWords, selectedWordRange, snapSelectionToWords } from './wordSelection';

/**
 * What a transcript shows when the learner points at its words: the meaning of
 * the word under the pointer (or the whole expression it belongs to, such as
 * "pomme de terre"), or the meaning of any range of whole words they select
 * (see `wordSelection.ts`: a mouse drag moves by words, and on a phone a
 * long press and drag does).
 *
 * `Transcript.svelte` renders the words and forwards pointer, tap and
 * selection events here; this class decides what the one label says, where it
 * points and which words to highlight.
 */

/**
 * How long the pointer must rest on a word before the text's meanings are
 * fetched (a paid request, once per text). Passing over words on the way
 * somewhere costs nothing; once fetched, meanings show at once.
 */
const HOVER_DWELL_MS = 300;
/** How long a tapped word keeps its meaning on screen: touch has no hover to end it. */
const TAP_MEANING_MS = 2_500;
/** Selections change on every pixel of a drag; read them once the learner pauses. */
const SELECTION_SETTLE_MS = 350;

/** The transcript whose label is on screen: one at a time, across every card. */
let activeOwner = $state<symbol | null>(null);

type Status = 'idle' | 'loading' | 'failed';

/** What the learner is pointing at: one word, or a selected range of words. */
type Focus =
	| { kind: 'word'; wordIndex: number; anchor: ReferenceElement }
	| { kind: 'selection'; start: number; end: number; anchor: ReferenceElement };

export interface MeaningLabel {
	anchor: ReferenceElement;
	text: string;
	/** A second, quieter line: the hovered word's own meaning, when the label shows its expression and it differs. */
	detail?: string;
	/** A status ("Translating…") rather than a meaning; shown quieter. */
	isStatus: boolean;
	/** Below a selection, so it does not cover the line above it; a word's meaning goes above. */
	placement: 'top' | 'bottom';
	/**
	 * The selected words as written, to read aloud. Only a selection has them:
	 * a hovered word goes as the pointer leaves, and a word plays when clicked.
	 */
	words?: string;
}

export interface TranscriptMeaningsOptions {
	/** The text's word meanings and phrases, or null until fetched. */
	glosses: () => TextGlosses | null;
	/** Fetches the word meanings and expressions around a word (its section of the text). */
	requestGlosses: (wordIndex: number) => Promise<void>;
	/** Translates a selected range; resolves with its meaning. */
	requestPhrase: (start: number, end: number, phrase: string) => Promise<string>;
	/** Words `start`..`end` (inclusive) exactly as they are written. */
	phraseText: (start: number, end: number) => string;
	/** True while a mouse drag is still choosing words; its in-between selections are not read. */
	isSelecting: () => boolean;
}

export class TranscriptMeanings {
	#options: TranscriptMeaningsOptions;
	#owner = Symbol('transcript');
	#focus = $state<Focus | null>(null);
	#glossStatus = $state<Status>('idle');
	#phrase = $state<{ key: string; status: Status; meaning: string }>({ key: '', status: 'idle', meaning: '' });
	#tapTimer: ReturnType<typeof setTimeout> | null = null;
	#hoverTimer: ReturnType<typeof setTimeout> | null = null;
	#selectionTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(options: TranscriptMeaningsOptions) {
		this.#options = options;
	}

	/** The expression the word under the pointer belongs to, if any. */
	#expressionAt(wordIndex: number): PhraseGloss | undefined {
		return this.#options
			.glosses()
			?.phrases.find((phrase) => phrase.origin === 'expression' && phrase.start <= wordIndex && wordIndex <= phrase.end);
	}

	/** Words to highlight while the pointer is on an expression; a selection highlights itself. */
	readonly highlight = $derived.by((): { start: number; end: number } | null => {
		const focus = this.#focus;
		if (focus?.kind !== 'word' || activeOwner !== this.#owner) return null;

		const expression = this.#expressionAt(focus.wordIndex);
		return expression ? { start: expression.start, end: expression.end } : null;
	});

	/** What the label says right now, or null when nothing is shown. */
	readonly label = $derived.by((): MeaningLabel | null => {
		const focus = this.#focus;
		if (!focus || activeOwner !== this.#owner) return null;

		if (focus.kind === 'selection' && focus.end > focus.start) return this.#selectionLabel(focus);
		if (focus.kind === 'word') return this.#wordLabel(focus.wordIndex, focus.anchor, 'top');

		// One selected word: its own meaning, below it, and its word to read aloud.
		const label = this.#wordLabel(focus.start, focus.anchor, 'bottom');
		return label ? { ...label, words: this.#options.phraseText(focus.start, focus.end) } : null;
	});

	#wordLabel(wordIndex: number, anchor: ReferenceElement, placement: MeaningLabel['placement']): MeaningLabel | null {
		const glosses = this.#options.glosses();

		const meaning = glosses?.words[wordIndex];

		// The expression is what the words mean together; the word's own meaning
		// stays on a second line when it says something else, so grouping never
		// hides what a word means. Only meanings: the words themselves are right
		// under the pointer (and highlighted), so repeating them wastes the room.
		const expression = this.#expressionAt(wordIndex);
		if (expression) {
			const sameMeaning = meaning?.trim().toLowerCase() === expression.meaning.trim().toLowerCase();
			const detail = meaning && !sameMeaning ? meaning : undefined;
			return { anchor, text: expression.meaning, detail, isStatus: false, placement };
		}

		if (meaning) return { anchor, text: meaning, isStatus: false, placement };

		const status = this.#statusText(this.#glossStatus, hasMeaningAt(glosses, wordIndex) ? 'No translation for this word' : '');
		return status ? { anchor, text: status, isStatus: true, placement } : null;
	}

	/**
	 * A selection is translated as the learner selected it, never answered with
	 * an expression's hover gloss: those are terse ("j'ai préféré" glossed as
	 * "preferred" where the learner expects "I preferred").
	 */
	#selectionLabel(focus: Extract<Focus, { kind: 'selection' }>): MeaningLabel | null {
		const saved = this.#options
			.glosses()
			?.phrases.find(
				(phrase) => phrase.origin === 'selection' && phrase.start === focus.start && phrase.end === focus.end
			);
		const fetched = this.#phrase.key === `${focus.start}-${focus.end}` ? this.#phrase : null;
		const meaning = saved?.meaning ?? (fetched?.status === 'idle' ? fetched.meaning : '');
		// The words can be heard while their meaning is still on its way.
		const words = this.#options.phraseText(focus.start, focus.end);

		if (meaning) return { anchor: focus.anchor, text: meaning, isStatus: false, placement: 'bottom', words };

		const status = this.#statusText(fetched?.status ?? 'loading', '');
		return status ? { anchor: focus.anchor, text: status, isStatus: true, placement: 'bottom', words } : null;
	}

	#statusText(status: Status, otherwise: string): string {
		if (status === 'loading') return 'Translating…';
		if (status === 'failed') return 'Could not translate. Try again.';
		return otherwise;
	}

	// ------------------------------------------------------------ Events from Transcript

	/** True when the word is part of the selection this text holds. */
	holdsWord(wordIndex: number | undefined): boolean {
		const focus = this.#focus;
		if (focus?.kind !== 'selection' || wordIndex === undefined) return false;
		return focus.start <= wordIndex && wordIndex <= focus.end;
	}

	/**
	 * A click or tap on a word of the held selection: the selection is one
	 * unit, so its meaning shows again instead of the word's.
	 *
	 * @returns True when the word belonged to the selection (the click is handled).
	 */
	reshowSelectionAt(wordIndex: number | undefined): boolean {
		if (!this.holdsWord(wordIndex)) return false;
		activeOwner = this.#owner;
		return true;
	}

	/**
	 * The pointer reached a word. Ignored while a mouse button is held (a drag
	 * is selecting). While this text holds a selection, the selection is one
	 * unit until it is put away: its words show its meaning (again, if another
	 * text's label took over), and other words show nothing, so the pointer can
	 * cross them on its way to the label. Until the text's meanings are fetched,
	 * the pointer has to rest on a word first (`HOVER_DWELL_MS`).
	 */
	hoverWord(event: PointerEvent, wordIndex: number | undefined): void {
		if (event.pointerType === 'touch' || event.buttons !== 0) return;
		if (this.#focus?.kind === 'selection') {
			this.reshowSelectionAt(wordIndex);
			return;
		}

		this.#stopHoverTimer();
		const element = event.currentTarget as HTMLElement;
		if (wordIndex !== undefined && hasMeaningAt(this.#options.glosses(), wordIndex)) {
			this.#showWord(element, wordIndex);
			return;
		}
		this.#hoverTimer = setTimeout(() => this.#showWord(element, wordIndex), HOVER_DWELL_MS);
	}

	/** The pointer left a word. */
	leaveWord(event: PointerEvent): void {
		if (event.pointerType === 'touch') return;
		this.#stopHoverTimer();
		if (this.#focus?.kind === 'word') this.#focus = null;
	}

	/**
	 * The text scrolled. A word's meaning goes: the word moved away from the
	 * pointer (or the finger that tapped it), and the word that comes to rest
	 * under the pointer shows its own once scrolling stops. A selection's
	 * meaning stays and follows its words.
	 */
	textScrolled(): void {
		this.#stopHoverTimer();
		if (this.#tapTimer) clearTimeout(this.#tapTimer);
		if (this.#focus?.kind === 'word') this.#focus = null;
	}

	#stopHoverTimer(): void {
		if (this.#hoverTimer) clearTimeout(this.#hoverTimer);
		this.#hoverTimer = null;
	}

	/** A word got keyboard focus (correction marks are buttons). */
	focusWord(element: HTMLElement, wordIndex: number | undefined): void {
		this.#showWord(element, wordIndex);
	}

	/** Keyboard focus left a word. */
	blurWord(): void {
		if (this.#focus?.kind === 'word') this.#focus = null;
	}

	/** On a touch screen the tap that plays a word also shows its meaning for a moment. */
	tapWord(event: MouseEvent, wordIndex: number | undefined): void {
		const isTouch = (event as PointerEvent).pointerType === 'touch' || matchMedia('(hover: none)').matches;
		if (!isTouch) return;

		this.#showWord(event.currentTarget as HTMLElement, wordIndex);
		this.#tapTimer = setTimeout(() => this.blurWord(), TAP_MEANING_MS);
	}

	/** The document selection changed; read it once it settles (touch handles move continuously). */
	selectionChanged(root: HTMLElement | null): void {
		if (this.#options.isSelecting()) return;
		if (this.#selectionTimer) clearTimeout(this.#selectionTimer);
		this.#selectionTimer = setTimeout(() => this.#readSelection(root), SELECTION_SETTLE_MS);
	}

	/** A mouse selection is complete (drag released, double-click, Shift+click); read it now. */
	selectionFinished(root: HTMLElement | null): void {
		if (this.#selectionTimer) clearTimeout(this.#selectionTimer);
		this.#readSelection(root);
	}

	/**
	 * A finger finished selecting words `start`..`end`. That selection is the
	 * app's own (see `TouchWordSelection`), so it is given here rather than read
	 * from the document.
	 */
	showSelection(root: HTMLElement, start: number, end: number): void {
		const words = rangeOfWords(root, start, end);
		if (!words) return;

		this.#selectWords(start, end, { getBoundingClientRect: () => words.getBoundingClientRect(), contextElement: root });
	}

	/** The selection was put away (or a new one is being chosen): its meaning goes too. */
	clearSelection(): void {
		if (this.#focus?.kind === 'selection') this.#focus = null;
	}

	#showWord(element: HTMLElement, wordIndex: number | undefined): void {
		if (wordIndex === undefined) return;
		if (this.#tapTimer) clearTimeout(this.#tapTimer);

		this.#focus = { kind: 'word', wordIndex, anchor: element };
		activeOwner = this.#owner;
		void this.#loadGlosses(wordIndex);
	}

	/** Maps the selection to the words it touches; a selection outside this text clears the label. */
	#readSelection(root: HTMLElement | null): void {
		// Touch handles move by letters; a part of a word selects the whole word.
		if (root) snapSelectionToWords(root);

		const range = root ? selectedWordRange(root) : null;
		if (!root || !range) {
			this.clearSelection();
			return;
		}

		// A copy, so the label stays put while the live selection keeps changing.
		const selected = getSelection()!.getRangeAt(0).cloneRange();
		this.#selectWords(range.start, range.end, { getBoundingClientRect: () => selected.getBoundingClientRect(), contextElement: root });
	}

	/** Shows the meaning of words `start`..`end`: one word's own, or the whole range translated. */
	#selectWords(start: number, end: number, anchor: VirtualElement): void {
		this.#focus = { kind: 'selection', start, end, anchor };
		activeOwner = this.#owner;
		if (start === end) void this.#loadGlosses(start);
		else void this.#loadPhrase(start, end);
	}

	/** Fetches the meanings around a word once; a failure is retried on the next hover. */
	async #loadGlosses(wordIndex: number): Promise<void> {
		if (hasMeaningAt(this.#options.glosses(), wordIndex)) return;

		this.#glossStatus = 'loading';
		try {
			await this.#options.requestGlosses(wordIndex);
			this.#glossStatus = 'idle';
		} catch (error) {
			console.warn('[transcript] word meanings could not be fetched', error);
			this.#glossStatus = 'failed';
		}
	}

	/** Translates a selected range; selecting it again after a failure retries. */
	async #loadPhrase(start: number, end: number): Promise<void> {
		const key = `${start}-${end}`;
		if (this.#phrase.key === key && this.#phrase.status !== 'failed') return;

		this.#phrase = { key, status: 'loading', meaning: '' };
		try {
			const meaning = await this.#options.requestPhrase(start, end, this.#options.phraseText(start, end));
			if (this.#phrase.key === key) this.#phrase = { key, status: 'idle', meaning };
		} catch (error) {
			console.warn('[transcript] the selection could not be translated', error);
			if (this.#phrase.key === key) this.#phrase = { key, status: 'failed', meaning: '' };
		}
	}
}
