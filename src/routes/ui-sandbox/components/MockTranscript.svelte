<script module lang="ts">
	export type MockCorrectionCategory = 'grammar' | 'register' | 'filler' | 'style';

	export interface MockCorrection {
		id: string;
		attemptId: string;
		category: MockCorrectionCategory;
		severity: 'error' | 'warning' | 'suggestion';
		label: string;
		original: string;
		replacement: string;
		replacementTranslation: string | null;
		explanation: string;
		speakText: string | null;
		examStatus: 'strictly-avoid' | 'avoid' | 'use-sparingly' | 'allowed' | null;
		formalAlternatives: string[];
		sortOrder: number;
		createdAt: string;
	}
</script>

<script lang="ts">
	/**
	 * Interactive 1:1 clone of `#lib/components/Transcript.svelte`.
	 *
	 * The only production dependency removed is `playWord()` from the
	 * pronunciation store. Everything else — token splitting, correction
	 * tagging, hover tooltips, click-to-select and keyboard access — is intact.
	 * Pronunciation is simulated with local component state instead of TTS.
	 */
	import { onDestroy } from 'svelte';

	interface Props {
		text: string;
		corrections?: MockCorrection[];
		activeCorrectionId?: string | null;
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
		category?: MockCorrectionCategory;
		correctionId?: string;
	}

	const TOKEN_RE = /([\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*)|(\s+)|([^\s])/gu;

	const CATEGORY_CLASS: Record<MockCorrectionCategory, string> = {
		grammar: 'text-[var(--error)] underline decoration-dotted decoration-1',
		register: 'text-[var(--warn)] underline decoration-dotted decoration-1',
		filler: 'text-[var(--warn)] underline decoration-dotted decoration-1',
		style: 'text-[var(--good)] underline decoration-dotted decoration-1'
	};

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

	let playingWord = $state<string | null>(null);
	let playTimer: ReturnType<typeof setTimeout> | null = null;

	function activate(token: Token) {
		if (token.correctionId && onSelect) {
			onSelect(token.correctionId);
			return;
		}
		// Simulated local pronunciation: highlight the word briefly.
		playingWord = token.text;
		if (playTimer) clearTimeout(playTimer);
		playTimer = setTimeout(() => {
			playingWord = null;
			playTimer = null;
		}, 650);
	}

	onDestroy(() => {
		if (playTimer) clearTimeout(playTimer);
	});
</script>

<span class={className} style="white-space: pre-wrap">
	{#each tokens as token, index (index)}
		{#if token.word}
			<span
				role="button"
				tabindex="-1"
				title={token.correctionId ? 'Click to see the correction' : 'Click to hear this word'}
				class="cursor-pointer rounded px-0.5 transition-colors {token.text === playingWord
					? 'bg-[var(--brand-soft)] text-[var(--brand)]'
					: ''} {token.correctionId === activeCorrectionId
					? 'bg-[var(--brand-soft)] ring-1 ring-[var(--brand)] ring-inset'
					: 'hover:bg-[var(--surface-2)]'} {token.category ? CATEGORY_CLASS[token.category] : ''}"
				onclick={(event) => {
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
