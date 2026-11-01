<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

<script lang="ts">
	import type { Correction, CorrectionSeverity, TextGlosses } from '#lib/adapters/db/index.js';
	import { playWord } from '#lib/stores/pronunciation.js';
	import type { TextSpan } from '#lib/utils/segments.js';
	import { isJapaneseText, tokenizeWords } from '#lib/utils/words.js';
	import { TranscriptMeanings } from './transcriptMeanings.svelte.js';
	import { TouchWordSelection, WordDragSelection, selectedWordRange } from './wordSelection.js';
	import WordGloss from './WordGloss.svelte';

	interface Props {
		text: string;
		/**
		 * Shows only this part of `text` (character offsets, end exclusive).
		 * Words keep their indexes in the whole text, so meanings and
		 * selections line up with the whole text's.
		 */
		excerpt?: TextSpan;
		/** Word indexes to mark as changed (the correct version's fixes). */
		changedWords?: ReadonlySet<number>;
		/** Words the correct version drops, as said, by the word index they stood before (the word count: after the last word). */
		removedBefore?: ReadonlyMap<number, string>;
		/** Words a fix replaces, as said, by the index of the fix's first word. */
		replacedBefore?: ReadonlyMap<number, string>;
		corrections?: Correction[];
		/** Correction highlighted in the feedback panel, if any. */
		activeCorrectionId?: string | null;
		/** Called when a word covered by a correction is clicked. */
		onSelect?: (correctionId: string) => void;
		/** Word meanings and expressions for hover translations; null until fetched. */
		glosses?: TextGlosses | null;
		/** Fetches `glosses`, on the first hover. Without it, words show no meaning. */
		requestGlosses?: (wordIndex: number) => Promise<void>;
		/** Translates a selected range of words (`start`..`end` word indexes). */
		requestPhrase?: (start: number, end: number, phrase: string) => Promise<string>;
		class?: string;
	}

	let {
		text,
		excerpt,
		changedWords,
		removedBefore,
		replacedBefore,
		corrections = [],
		activeCorrectionId = null,
		onSelect,
		glosses = null,
		requestGlosses,
		requestPhrase,
		class: className = ''
	}: Props = $props();

	let root = $state<HTMLElement | null>(null);
	const showsMeanings = $derived(Boolean(requestGlosses));

	// Mouse selection moves a whole word at a time; a finished selection is translated.
	const wordDrag = new WordDragSelection(
		() => root,
		() => meanings.selectionFinished(root)
	);

	const meanings = new TranscriptMeanings({
		glosses: () => glosses,
		requestGlosses: (wordIndex) => requestGlosses?.(wordIndex) ?? Promise.resolve(),
		requestPhrase: (start, end, phrase) =>
			requestPhrase?.(start, end, phrase) ?? Promise.reject(new Error('Selections are not translated here.')),
		phraseText: (start, end) => {
			const words = tokens.filter((token) => token.word);
			return words[start] && words[end] ? text.slice(words[start].start, words[end].end) : '';
		},
		isSelecting: () => wordDrag.dragging
	});

	/**
	 * The click that ends a word selection, and the second click of a
	 * double-click, are part of selecting; they must not also play the word or
	 * open its correction.
	 */
	function isSelectionClick(event: MouseEvent): boolean {
		return wordDrag.consumeSelectionClick() || event.detail > 1;
	}

	// Scrolling anything that holds this text (its partial-view window, the card, the page) moves
	// the words under a resting pointer: a hovered word's meaning goes with it.
	$effect(() => {
		if (!showsMeanings) return;
		const onScroll = (event: Event) => {
			const scrolledAroundText = event.target instanceof Node && root !== null && event.target.contains(root);
			if (scrolledAroundText) meanings.textScrolled();
		};
		// Scroll events do not bubble; they are seen here while capturing.
		document.addEventListener('scroll', onScroll, { capture: true, passive: true });
		return () => document.removeEventListener('scroll', onScroll, { capture: true });
	});

	/** The words under the learner's selection, inked like a highlighter while they select. */
	let marked = $state<{ start: number; end: number } | null>(null);

	/** True while `marked` is a finger's selection (the app's own) rather than the document's. */
	let markedByTouch = $state(false);

	function markSelection(): void {
		const range = root ? selectedWordRange(root) : null;
		const unchanged = range?.start === marked?.start && range?.end === marked?.end;
		if (!unchanged) marked = range;
	}

	// Selecting words with a mouse (drag, double-click) inks them and asks for their meaning.
	$effect(() => {
		if (!showsMeanings) return;
		const onSelectionChange = () => {
			// A finger's selection is not in the document; only a tap puts it away.
			if (markedByTouch) return;
			markSelection();
			meanings.selectionChanged(root);
		};
		document.addEventListener('selectionchange', onSelectionChange);
		return () => document.removeEventListener('selectionchange', onSelectionChange);
	});

	// On a phone a long press and drag inks the words; lifting the finger asks for their meaning.
	const touchSelection = new TouchWordSelection(
		(range) => {
			marked = range;
			markedByTouch = range !== null;
			meanings.clearSelection();
		},
		(range) => root && meanings.showSelection(root, range.start, range.end)
	);

	$effect(() => {
		if (!showsMeanings || !root) return;
		return touchSelection.listen(root);
	});

	// A tap anywhere puts the finger's selection away, as it would the platform's.
	$effect(() => {
		if (!markedByTouch) return;
		const putAway = () => touchSelection.clear();
		document.addEventListener('click', putAway, true);
		return () => document.removeEventListener('click', putAway, true);
	});

	function inHighlight(wordIndex: number | undefined): boolean {
		const range = meanings.highlight;
		return Boolean(range && wordIndex !== undefined && range.start <= wordIndex && wordIndex <= range.end);
	}

	interface Token {
		text: string;
		word: boolean;
		start: number;
		end: number;
		severity?: CorrectionSeverity;
		correctionId?: string;
		deletion?: boolean;
		/** Position among the word tokens, which is the index of its meaning in `glosses`. */
		wordIndex?: number;
	}

	/** Japanese words run together; the per-word padding would read as spaces. */
	const unspaced = $derived(isJapaneseText(text));

	/**
	 * Colour signals severity, not category — a `register` correction of
	 * severity `error` must read as an error. Category is shown separately in the
	 * feedback panel.
	 */
	const SEVERITY_CLASS: Record<CorrectionSeverity, string> = {
		error: 'text-[var(--error)]',
		warning: 'text-[var(--warn)]',
		suggestion: 'text-[var(--brand)]'
	};

	/** Resolves a correction to a character range, preferring stored offsets. */
	function rangeFor(correction: Correction, claimed: Array<[number, number]>): [number, number] | null {
		if (correction.start != null && correction.end != null && correction.end > correction.start) {
			return [correction.start, correction.end];
		}
		if (!correction.original) return null;
		// Legacy rows (no offsets): claim the first unclaimed occurrence.
		let from = 0;
		for (;;) {
			const at = text.indexOf(correction.original, from);
			if (at === -1) return null;
			const range: [number, number] = [at, at + correction.original.length];
			const overlaps = claimed.some(([start, end]) => range[0] < end && range[1] > start);
			if (!overlaps) return range;
			from = at + correction.original.length;
		}
	}

	/**
	 * The highlighter stroke in token positions, from the first selected word to
	 * the last, so the spaces and punctuation between them are inked too.
	 */
	const markedTokens = $derived.by(() => {
		if (!marked) return null;
		const { start, end } = marked;
		const from = tokens.findIndex((token) => token.wordIndex === start);
		const to = tokens.findIndex((token) => token.wordIndex === end);
		return from >= 0 && to >= from ? { from, to } : null;
	});

	function isMarked(index: number): boolean {
		return Boolean(markedTokens && markedTokens.from <= index && index <= markedTokens.to);
	}

	/** Tokenises the text and tags tokens covered by a correction range. */
	const tokens = $derived.by<Token[]>(() => {
		const list: Token[] = tokenizeWords(text);

		let wordIndex = 0;
		for (const token of list) if (token.word) token.wordIndex = wordIndex++;

		const claimed: Array<[number, number]> = [];
		for (const correction of corrections) {
			const range = rangeFor(correction, claimed);
			if (!range) continue;
			claimed.push(range);
			for (const token of list) {
				// First correction wins, so the colour matches the correction a click opens.
				if (token.word && !token.correctionId && token.start < range[1] && token.end > range[0]) {
					token.severity = correction.severity;
					token.correctionId = correction.id;
					token.deletion = Boolean(correction.original.trim()) && !correction.replacement.trim();
				}
			}
		}
		return list;
	});

	/** The tokens on screen (all of them, or the excerpt's) and the position of the first in `tokens`. */
	const shown = $derived.by(() => {
		if (!excerpt) return { from: 0, tokens };

		const from = tokens.findIndex((token) => token.start >= excerpt.start);
		const after = tokens.findIndex((token) => token.end > excerpt.end);
		if (from === -1) return { from: 0, tokens: [] };

		return { from, tokens: tokens.slice(from, after === -1 ? tokens.length : after) };
	});

	const lastWordIndex = $derived(tokens.reduce((last, token) => token.wordIndex ?? last, -1));

	function isChanged(token: Token): boolean {
		return token.wordIndex !== undefined && Boolean(changedWords?.has(token.wordIndex));
	}

	/** A space or punctuation between two changed words belongs to the same change. */
	function isInsideChange(index: number): boolean {
		const before = tokens[index - 1];
		const after = tokens[index + 1];
		return Boolean(before && after && isChanged(before) && isChanged(after));
	}

	/**
	 * What the learner said right before this word that the correct version
	 * does not keep: words it drops, then the words this fix replaces.
	 */
	function saidBefore(token: Token): string | undefined {
		if (token.wordIndex === undefined) return undefined;

		const dropped = removedBefore?.get(token.wordIndex);
		const replaced = replacedBefore?.get(token.wordIndex);
		const said = [dropped, replaced].filter(Boolean).join(' ');
		return said || undefined;
	}

	/** The words dropped after this one, the last of the text. */
	function droppedAfter(token: Token): string | undefined {
		return token.wordIndex === lastWordIndex ? removedBefore?.get(lastWordIndex + 1) : undefined;
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<span
	bind:this={root}
	class="transcript-text {className}"
	class:has-marks={markedTokens !== null}
	style="white-space: pre-wrap"
	style:--word-pad={unspaced ? '0px' : '0.125rem'}
	onmousedown={(event) => showsMeanings && wordDrag.press(event)}
	ondblclick={(event) => showsMeanings && wordDrag.selectOne(event)}
>
	{#each shown.tokens as token, offset (shown.from + offset)}
		{@const index = shown.from + offset}
		{@const struck = saidBefore(token)}
		{@const droppedAtEnd = droppedAfter(token)}
		<!-- No whitespace between the tags here: the text keeps it (pre-wrap), so a line break would add a space. -->
		{#if struck}<del class="said-words">{struck}</del>{' '}{/if}{#if token.word && token.correctionId}
			<button
				type="button"
				data-word-index={token.wordIndex}
				title={showsMeanings ? undefined : 'Show this correction'}
				class:marked={isMarked(index)}
				class:mark-start={index === markedTokens?.from}
				class:mark-end={index === markedTokens?.to}
				class="correction-word cursor-pointer rounded {unspaced ? '' : 'px-0.5'} {inHighlight(token.wordIndex) ? 'expression-highlight' : ''} underline decoration-dotted decoration-1 transition-colors {token.correctionId ===
				activeCorrectionId
					? 'bg-[var(--brand-soft)] ring-1 ring-[var(--brand)] ring-inset'
					: 'hover:bg-[var(--surface-2)]'} {token.deletion
					? 'line-through decoration-[var(--error)] decoration-2 underline-offset-4'
					: ''} {SEVERITY_CLASS[token.severity ?? 'suggestion']}"
				onpointerenter={(event) => showsMeanings && meanings.hoverWord(event, token.wordIndex)}
				onpointerleave={(event) => meanings.leaveWord(event)}
				onfocus={(event) => showsMeanings && meanings.focusWord(event.currentTarget, token.wordIndex)}
				onblur={() => meanings.blurWord()}
				onclick={(event) => {
					event.stopPropagation();
					if (isSelectionClick(event)) return;
					onSelect?.(token.correctionId as string);
					if (showsMeanings) meanings.tapWord(event, token.wordIndex);
				}}
			>{token.text}</button>
		{:else if token.word}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<span
				data-word-index={token.wordIndex}
				title={showsMeanings ? undefined : 'Click to hear this word'}
				class:marked={isMarked(index)}
				class:mark-start={index === markedTokens?.from}
				class:mark-end={index === markedTokens?.to}
				class:changed-word={isChanged(token)}
				class="cursor-pointer rounded {unspaced ? '' : 'px-0.5'} {inHighlight(token.wordIndex) ? 'expression-highlight' : ''} transition-colors hover:bg-[var(--surface-2)]"
				onpointerenter={(event) => showsMeanings && meanings.hoverWord(event, token.wordIndex)}
				onpointerleave={(event) => meanings.leaveWord(event)}
				onclick={(event) => {
					event.stopPropagation();
					if (isSelectionClick(event)) return;
					playWord(token.text);
					if (showsMeanings) meanings.tapWord(event, token.wordIndex);
				}}>{token.text}</span
			>
		{:else}<span class:marked={isMarked(index)} class:changed-gap={isInsideChange(index)}>{token.text}</span>{/if}{#if droppedAtEnd}{' '}<del
				class="said-words">{droppedAtEnd}</del
			>{/if}
	{/each}
</span>

<WordGloss
	anchor={meanings.label?.anchor ?? null}
	text={meanings.label?.text ?? ''}
	detail={meanings.label?.detail}
	isStatus={meanings.label?.isStatus ?? false}
	placement={meanings.label?.placement ?? 'top'}
/>

<style>
	/* Every word of the expression under the pointer, so it reads as one unit. */
	.expression-highlight {
		background: var(--brand-soft);
	}

	/*
	 * Selected words are inked like a highlighter pen: a translucent band over
	 * the body of the text with soft edges and a faint streak, ink pooled where
	 * the stroke starts, and the slanted ends of a chisel tip. The browser's own
	 * selection colour is hidden under it; a mouse selection itself is
	 * untouched, so it still copies. Each word and each gap is its own element, so the band is
	 * the same on all of them and joins without seams; only the ends differ.
	 */
	.transcript-text {
		--highlighter-ink: rgb(255 230 0 / 0.5);
		--highlighter-pool: rgb(255 208 0 / 0.72);
		--highlighter-streak: rgb(255 190 0 / 0.14);
		/* How far each end of the stroke reaches past its word, and the chisel's slant across the line. */
		--stroke-overrun: 0.22em;
		--chisel-slant: 0.2em;
	}
	:global([data-theme='dark']) .transcript-text {
		--highlighter-ink: rgb(250 204 21 / 0.3);
		--highlighter-pool: rgb(250 204 21 / 0.46);
		--highlighter-streak: rgb(255 230 120 / 0.08);
	}
	.has-marks :global(::selection) {
		background-color: transparent;
	}

	/* A mouse selection runs through corrections too (buttons are not selectable by default); a finger selects its own way. */
	.correction-word {
		user-select: text;
	}
	@media (hover: none) and (pointer: coarse) {
		.correction-word {
			user-select: none;
		}
	}

	.marked,
	.marked:hover {
		--band: linear-gradient(transparent, var(--highlighter-ink) 12%, var(--highlighter-ink) 86%, transparent);
		--streak: linear-gradient(transparent 58%, var(--highlighter-streak) 62%, transparent 70%);
		border-radius: 0;
		background-color: transparent;
		background-image: var(--streak), var(--band);
		background-position: 0 72%;
		background-size: 100% 78%;
		background-repeat: no-repeat;
	}

	/*
	 * The ends reach a little past the words, as a stroke does; the margin and
	 * padding cancel out, so no text moves. The clip cuts each end on the same
	 * slant, inside that overrun, so it never cuts a letter.
	 */
	.marked.mark-start {
		margin-left: calc(-1 * var(--stroke-overrun));
		padding-left: calc(var(--stroke-overrun) + var(--word-pad));
		background-image:
			linear-gradient(to right, var(--highlighter-pool), transparent 0.8em),
			var(--streak),
			var(--band);
		clip-path: polygon(var(--chisel-slant) 0, 100% 0, 100% 100%, 0 100%);
	}
	.marked.mark-end {
		margin-right: calc(-1 * var(--stroke-overrun));
		padding-right: calc(var(--stroke-overrun) + var(--word-pad));
		clip-path: polygon(0 0, 100% 0, calc(100% - var(--chisel-slant)) 100%, 0 100%);
	}
	.marked.mark-start.mark-end {
		clip-path: polygon(var(--chisel-slant) 0, 100% 0, calc(100% - var(--chisel-slant)) 100%, 0 100%);
	}

	/*
	 * The correct version's fixes, what the learner should have said: tinted
	 * and underlined green, in bold like the explanation's "say this"
	 * highlights. The ink stays the text colour, so contrast never depends on
	 * the tint.
	 */
	.changed-word,
	.changed-gap {
		background-color: color-mix(in srgb, var(--good) 15%, transparent);
		text-decoration: underline solid var(--good) 1.5px;
		text-underline-offset: 3px;
	}
	.changed-word {
		font-weight: 600;
	}

	/*
	 * Words the learner said that the correct version does not keep, dropped
	 * or replaced by the fix after them: shown where they were said, struck
	 * through, small and quiet, so the passage says what changed (a bare mark
	 * left the learner guessing what).
	 */
	.said-words {
		font-size: 0.88em;
		color: color-mix(in srgb, var(--error) 80%, var(--muted-foreground));
		text-decoration: line-through;
		text-decoration-color: var(--error);
		text-decoration-thickness: 1.5px;
	}
</style>
