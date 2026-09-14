<script lang="ts">
	import type { Correction, CorrectionCategory } from '$lib/adapters/db';
	import { playWord } from '$lib/stores/pronunciation';

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
		category?: CorrectionCategory;
		correctionId?: string;
	}

	const TOKEN_RE = /([\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*)|(\s+)|([^\s])/gu;

	const CATEGORY_CLASS: Record<CorrectionCategory, string> = {
		grammar: 'text-[var(--error)] underline decoration-dotted decoration-1',
		register: 'text-[var(--warn)] underline decoration-dotted decoration-1',
		filler: 'text-[var(--warn)] underline decoration-dotted decoration-1',
		style: 'text-[var(--good)] underline decoration-dotted decoration-1'
	};

	/**
	 * Splits the text into word/whitespace/punctuation tokens and tags the words
	 * covered by a correction. Tagging tokens (rather than wrapping substrings in
	 * markup) keeps every word individually hoverable for pronunciation, and lets
	 * a click select the correction.
	 */
	const tokens = $derived.by<Token[]>(() => {
		const list: Token[] = [];
		for (const match of text.matchAll(TOKEN_RE)) {
			list.push({ text: match[0], word: Boolean(match[1]) });
		}

		for (const correction of corrections) {
			if (!correction.original) continue;
			let from = 0;
			for (;;) {
				const at = text.indexOf(correction.original, from);
				if (at === -1) break;
				const to = at + correction.original.length;

				let cursor = 0;
				for (const token of list) {
					const start = cursor;
					const end = cursor + token.text.length;
					if (token.word && start < to && end > at) {
						token.category = correction.category;
						token.correctionId ??= correction.id;
					}
					cursor = end;
				}
				from = to;
			}
		}
		return list;
	});

	function activate(token: Token) {
		if (token.correctionId && onSelect) {
			onSelect(token.correctionId);
			return;
		}
		// No correction here: clicking is a manual pronunciation trigger.
		playWord(token.text);
	}
</script>

<span class={className} style="white-space: pre-wrap">
	{#each tokens as token, index (index)}
		{#if token.word}
			<span
				role="button"
				tabindex="-1"
				title={token.correctionId ? 'Click to see the correction' : 'Click to hear this word'}
				class="cursor-pointer rounded px-0.5 transition-colors {token.correctionId ===
				activeCorrectionId
					? 'bg-[var(--brand-soft)] ring-1 ring-[var(--brand)] ring-inset'
					: 'hover:bg-[var(--surface-2)]'} {token.category ? CATEGORY_CLASS[token.category] : ''}"
				onclick={(event) => {
					// The transcript lives inside the attempt's select button; without
					// this, selecting a correction immediately re-selects the attempt
					// and clears the selection.
					event.stopPropagation();
					activate(token);
				}}
				onkeydown={(event) => {
					if (event.key === 'Enter' || event.key === ' ') {
						event.preventDefault();
						event.stopPropagation();
						activate(token);
					}
				}}
			>{token.text}</span>
		{:else}{token.text}{/if}
	{/each}
</span>
