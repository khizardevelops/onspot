<script lang="ts">
	import type { Correction, CorrectionSeverity } from '$lib/adapters/db';
	import { playWord } from '$lib/stores/pronunciation';
	import { isJapaneseText, tokenizeWords } from '$lib/utils/words';

	interface Props {
		text: string;
		corrections?: Correction[];
		/** Correction highlighted in the feedback panel, if any. */
		activeCorrectionId?: string | null;
		/** Called when a word covered by a correction is clicked. */
		onSelect?: (correctionId: string) => void;
		class?: string;
	}

	let {
		text,
		corrections = [],
		activeCorrectionId = null,
		onSelect,
		class: className = ''
	}: Props = $props();

	interface Token {
		text: string;
		word: boolean;
		start: number;
		end: number;
		severity?: CorrectionSeverity;
		correctionId?: string;
		deletion?: boolean;
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

	/** Tokenises the text and tags tokens covered by a correction range. */
	const tokens = $derived.by<Token[]>(() => {
		const list: Token[] = tokenizeWords(text);

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
</script>

<span class={className} style="white-space: pre-wrap">
	{#each tokens as token, index (index)}
		{#if token.word && token.correctionId}
			<button
				type="button"
				title="Show this correction"
				class="cursor-pointer rounded {unspaced ? '' : 'px-0.5'} underline decoration-dotted decoration-1 transition-colors {token.correctionId ===
				activeCorrectionId
					? 'bg-[var(--brand-soft)] ring-1 ring-[var(--brand)] ring-inset'
					: 'hover:bg-[var(--surface-2)]'} {token.deletion
					? 'line-through decoration-[var(--error)] decoration-2 underline-offset-4'
					: ''} {SEVERITY_CLASS[token.severity ?? 'suggestion']}"
				onclick={(event) => {
					event.stopPropagation();
					onSelect?.(token.correctionId as string);
				}}
			>{token.text}</button>
		{:else if token.word}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<span
				title="Click to hear this word"
				class="cursor-pointer rounded {unspaced ? '' : 'px-0.5'} transition-colors hover:bg-[var(--surface-2)]"
				onclick={(event) => {
					event.stopPropagation();
					playWord(token.text);
				}}>{token.text}</span
			>
		{:else}{token.text}{/if}
	{/each}
</span>
