<script module lang="ts">
	import type { MockCorrection } from './MockTranscript.svelte';

	export interface MockTranslationSet {
		version?: 2;
		idiomatic: string;
		idiomaticVariants: string[];
		literal: string;
		wordForWord: string;
		wordBreakdown: { source: string; target: string }[];
	}

	export interface MockAttempt {
		id: string;
		transcript: string;
		correctedText: string;
		naturalSpeech: string;
		translation: string;
		translations: MockTranslationSet | null;
		summary: string;
		corrections: MockCorrection[];
		durationSec: number;
		wordCount: number;
		createdAt: string;
		audioUrl: string | null;
		ttsVoice: string | null;
	}
</script>

<script lang="ts">
	/**
	 * Interactive 1:1 clone of `$lib/components/AttemptCard.svelte`.
	 *
	 * All Svelte state logic and `{#if}` progressive-disclosure blocks are kept:
	 * the translation menu, idiomatic variants, word breakdown, sentence segments
	 * and voice selector all open and close exactly like production.
	 *
	 * Removed: the practice store, the TTS service, the LLM translation service
	 * and the app-settings store. Their calls are replaced with local component
	 * state (simulated playback/spinners) so the card is fully click-testable.
	 */
	import { untrack } from 'svelte';
	import MockTranscript from './MockTranscript.svelte';
	import { ChevronDown, Languages, Loader2, RotateCcw, Scissors, Volume2 } from '@lucide/svelte';

	interface Props {
		attempt: MockAttempt;
		index: number;
		active: boolean;
		activeCorrectionId?: string | null;
		onSelectCorrection?: (attemptId: string, correctionId: string) => void;
	}

	let {
		attempt,
		index,
		active,
		activeCorrectionId = null,
		onSelectCorrection
	}: Props = $props();

	type TranslationView = 'off' | 'idiomatic' | 'literal' | 'wordForWord' | 'all';

	const voices = [
		{ id: 'piper-tom-medium', label: 'Piper Tom (M, medium)' },
		{ id: 'piper-upmc-jessica', label: 'Piper UPMC · jessica' },
		{ id: 'piper-siwis-medium', label: 'Piper Siwis (F, medium)' }
	];

	const TRANSLATION_OPTIONS: { id: TranslationView; label: string; detail: string }[] = [
		{ id: 'idiomatic', label: 'Idiomatic', detail: 'Natural English with the same meaning' },
		{ id: 'literal', label: 'Literal', detail: 'English that follows the French structure' },
		{ id: 'wordForWord', label: 'Word-for-word', detail: 'Each word translated in French order' },
		{ id: 'all', label: 'Compare all three', detail: 'Show every version together' },
		{ id: 'off', label: 'Hide translation', detail: 'Keep only the French transcript visible' }
	];

	let translationView = $state<TranslationView>('off');
	let showSegments = $state(false);
	let rerendering = $state(false);
	let menuOpen = $state(false);
	let generatingTranslations = $state(false);
	let translationError = $state<string | null>(null);
	let showIdiomaticVariants = $state(false);
	let showWordBreakdown = $state(false);
	// Seeded once from the attempt; the selector then owns the value locally.
	let voice = $state(untrack(() => attempt.ttsVoice ?? voices[0].id));
	let speaking = $state<'corrected' | 'recording' | 'segment' | null>(null);
	let playbackTimer: ReturnType<typeof setTimeout> | null = null;

	const translations = $derived({
		idiomatic: attempt.translations?.idiomatic || attempt.translation,
		idiomaticVariants: attempt.translations?.idiomaticVariants ?? [],
		literal: attempt.translations?.literal || '',
		wordForWord: attempt.translations?.wordForWord || '',
		wordBreakdown: attempt.translations?.wordBreakdown ?? []
	});

	const translationLabel = $derived.by(() => {
		if (translationView === 'off') return 'Translate';
		if (translationView === 'all') return 'All translations';
		return TRANSLATION_OPTIONS.find((option) => option.id === translationView)?.label ?? 'Translate';
	});

	const visibleTranslations = $derived.by(() => {
		if (translationView === 'off') return [];
		if (translationView === 'all') {
			return [translations.idiomatic, translations.literal, translations.wordForWord].filter(
				(value): value is string => Boolean(value)
			);
		}
		const value = translations[translationView];
		return value ? [value] : [];
	});

	function needsGeneration(view: TranslationView): boolean {
		if (view === 'off') return false;
		if (attempt.translations?.version !== 2) return true;
		if (view === 'all') {
			return !translations.idiomatic || !translations.literal || !translations.wordForWord;
		}
		return !translations[view];
	}

	/**
	 * Replaces `ensureAttemptTranslations()`. There is no LLM here, so it fakes
	 * the async round-trip and never fails; the UI's loading and error branches
	 * remain reachable for interaction testing.
	 */
	async function requestTranslations(_force: boolean): Promise<boolean> {
		translationError = null;
		if (generatingTranslations) return false;
		generatingTranslations = true;
		try {
			await new Promise((resolve) => setTimeout(resolve, 650));
			return true;
		} finally {
			generatingTranslations = false;
		}
	}

	async function chooseTranslation(view: TranslationView) {
		translationView = view;
		menuOpen = false;
		translationError = null;
		if (needsGeneration(view)) await requestTranslations(false);
	}

	async function regenerateTranslations() {
		menuOpen = false;
		showIdiomaticVariants = false;
		showWordBreakdown = false;
		await requestTranslations(true);
	}

	async function toggleWordBreakdown() {
		if (showWordBreakdown) {
			showWordBreakdown = false;
			return;
		}
		if (translations.wordBreakdown.length === 0) {
			const generated = await requestTranslations(true);
			if (!generated) return;
		}
		showWordBreakdown = true;
	}

	const segments = $derived(
		splitSentences(attempt.naturalSpeech || attempt.correctedText || attempt.transcript)
	);

	function splitSentences(text: string): string[] {
		const matches = text.match(/[^.!?…]+[.!?…]+[\s]*|[^.!?…]+$/g);
		if (!matches) return text.trim() ? [text.trim()] : [];
		return matches.map((segment) => segment.trim()).filter(Boolean);
	}

	/** Simulated playback: the pressed button shows a "playing" state briefly. */
	function simulatePlayback(kind: 'corrected' | 'recording' | 'segment') {
		speaking = kind;
		if (playbackTimer) clearTimeout(playbackTimer);
		playbackTimer = setTimeout(() => {
			if (speaking === kind) speaking = null;
			playbackTimer = null;
		}, 900);
	}

	/** Replaces `setAttemptVoice()`, which re-renders TTS through the service. */
	async function rerender(event: Event) {
		const next = (event.target as HTMLSelectElement).value;
		rerendering = true;
		try {
			await new Promise((resolve) => setTimeout(resolve, 600));
			voice = next;
		} finally {
			rerendering = false;
		}
	}

	function fmtClock(iso: string): string {
		return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
	}
</script>

<article class="w-full min-w-0 rounded-xl border bg-card p-5 text-card-foreground shadow-sm">
	<header class="mb-2 flex flex-wrap items-center justify-between gap-2">
		<div class="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
			<span class="font-semibold tracking-wide text-[var(--brand)] uppercase">Attempt {index}</span>
			<span>{fmtClock(attempt.createdAt)}</span>
			<span>·</span>
			<span>{attempt.durationSec.toFixed(0)}s</span>
			<span>·</span>
			<span>{attempt.wordCount} words</span>
		</div>
		<div class="flex shrink-0 items-center gap-0.5">
			<button
				type="button"
				title="Play corrected audio"
				class="grid size-7 place-items-center rounded-md {speaking === 'corrected'
					? 'bg-[var(--brand-soft)] text-[var(--brand)]'
					: 'text-muted-foreground hover:bg-[var(--surface-2)] hover:text-[var(--brand)]'}"
				onclick={() => simulatePlayback('corrected')}
			>
				<Volume2 class="size-4" />
			</button>
			<button
				type="button"
				title="Replay your recording"
				class="grid size-7 place-items-center rounded-md {speaking === 'recording'
					? 'bg-[var(--surface-2)] text-foreground'
					: 'text-muted-foreground hover:bg-[var(--surface-2)] hover:text-foreground'}"
				onclick={() => simulatePlayback('recording')}
			>
				<RotateCcw class="size-3.5" />
			</button>
			<button
				type="button"
				title="Play sentence by sentence"
				class="grid size-7 place-items-center rounded-md {showSegments
					? 'bg-[var(--brand-soft)] text-[var(--brand)]'
					: 'text-muted-foreground hover:bg-[var(--surface-2)] hover:text-foreground'}"
				onclick={() => (showSegments = !showSegments)}
			>
				<Scissors class="size-3.5" />
			</button>

			<div class="relative">
				<button
					type="button"
					title="Choose a translation style"
					aria-label="Translate this attempt"
					aria-haspopup="menu"
					aria-expanded={menuOpen}
					class="flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium {translationView !== 'off'
						? 'bg-[var(--brand-soft)] text-[var(--brand)]'
						: 'text-muted-foreground hover:bg-[var(--surface-2)] hover:text-foreground'}"
					onclick={() => (menuOpen = !menuOpen)}
				>
					{#if generatingTranslations}
						<Loader2 class="size-3.5 animate-spin" />
					{:else}
						<Languages class="size-3.5" />
					{/if}
					<span>{generatingTranslations ? 'Translating…' : translationLabel}</span>
					<ChevronDown class="size-3" />
				</button>
				{#if menuOpen}
					<button
						type="button"
						class="fixed inset-0 z-40 cursor-default"
						aria-label="Close menu"
						onclick={() => (menuOpen = false)}
					></button>
					<div
						role="menu"
						aria-label="Translation style"
						class="absolute top-full right-0 z-50 mt-1 w-64 rounded-lg border bg-card p-1.5 shadow-lg"
					>
						<p class="px-2 pt-1 pb-1.5 text-[10px] font-semibold tracking-widest text-faint uppercase">
							Translation style
						</p>
						{#each TRANSLATION_OPTIONS as option (option.id)}
							<button
								type="button"
								role="menuitemradio"
								aria-checked={translationView === option.id}
								class="flex w-full items-start gap-2 rounded-md px-2 py-2 text-left hover:bg-[var(--surface-2)] {translationView ===
								option.id
									? 'bg-[var(--brand-soft)] text-[var(--brand)]'
									: 'text-foreground'}"
								onclick={() => void chooseTranslation(option.id)}
							>
								<span class="mt-0.5 grid size-4 shrink-0 place-items-center">
									{#if translationView === option.id}✓{/if}
								</span>
								<span class="min-w-0">
									<span class="block text-xs font-medium">{option.label}</span>
									<span class="mt-0.5 block text-[10.5px] leading-snug text-muted-foreground">
										{option.detail}
									</span>
								</span>
							</button>
						{/each}
						<button
							type="button"
							role="menuitem"
							class="mt-1 flex w-full items-start gap-2 border-t px-2 pt-2 pb-1.5 text-left text-foreground hover:bg-[var(--surface-2)]"
							onclick={() => void regenerateTranslations()}
						>
							<span class="mt-0.5 grid size-4 shrink-0 place-items-center">
								<RotateCcw class="size-3.5" />
							</span>
							<span class="min-w-0">
								<span class="block text-xs font-medium">Regenerate translations</span>
								<span class="mt-0.5 block text-[10.5px] leading-snug text-muted-foreground">
									Replace saved variants with a fresh translation
								</span>
							</span>
						</button>
					</div>
				{/if}
			</div>
		</div>
	</header>

	<MockTranscript
		text={attempt.transcript}
		corrections={attempt.corrections}
		activeCorrectionId={active ? activeCorrectionId : null}
		onSelect={(correctionId) => onSelectCorrection?.(attempt.id, correctionId)}
		class="block break-words font-serif text-[19px] leading-relaxed"
	/>

	{#if translationView !== 'off'}
		<div class="mt-3 min-w-0 rounded-lg bg-[var(--surface-2)] p-3">
			{#if generatingTranslations}
				<p class="flex items-center gap-2 text-sm text-muted-foreground">
					<Loader2 class="size-3.5 animate-spin" />
					Generating and saving translations…
				</p>
			{:else if translationError}
				<p class="text-sm text-[var(--error)]">{translationError}</p>
			{:else}
				{#each visibleTranslations as translation, position (position)}
					<p
						class="text-sm break-words {position > 0 ? 'mt-2 border-t pt-2' : ''} {translationView ===
						'wordForWord'
							? 'text-muted-foreground italic'
							: ''}"
					>
						{translation}
					</p>
				{/each}

				{#if (translationView === 'idiomatic' || translationView === 'all') && translations.idiomaticVariants.length > 0}
					<button
						type="button"
						class="mt-2 flex items-center gap-1 text-[11px] font-medium text-[var(--brand)] hover:underline"
						aria-expanded={showIdiomaticVariants}
						onclick={() => (showIdiomaticVariants = !showIdiomaticVariants)}
					>
						<ChevronDown
							class="size-3 transition-transform {showIdiomaticVariants ? 'rotate-180' : ''}"
						/>
						{showIdiomaticVariants ? 'Hide' : 'Show'} {translations.idiomaticVariants.length}
						alternative{translations.idiomaticVariants.length === 1 ? '' : 's'}
					</button>
					{#if showIdiomaticVariants}
						{#each translations.idiomaticVariants as variant, position (position)}
							<p class="mt-2 border-t pt-2 text-sm break-words">{variant}</p>
						{/each}
					{/if}
				{/if}

				{#if translationView === 'wordForWord' || translationView === 'all'}
					<button
						type="button"
						class="mt-2 flex items-center gap-1 text-[11px] font-medium text-[var(--brand)] hover:underline"
						aria-expanded={showWordBreakdown}
						onclick={() => void toggleWordBreakdown()}
					>
						<ChevronDown
							class="size-3 transition-transform {showWordBreakdown ? 'rotate-180' : ''}"
						/>
						{showWordBreakdown ? 'Hide' : 'Word breakdown'}
					</button>
					{#if showWordBreakdown && translations.wordBreakdown.length > 0}
						<dl class="mt-2 grid grid-cols-[minmax(0,auto)_1fr] gap-x-2 gap-y-1 border-t pt-2 text-xs">
							{#each translations.wordBreakdown as item, position (position)}
								<dt class="font-medium break-words">{item.source}</dt>
								<dd class="min-w-0 text-muted-foreground break-words">{item.target}</dd>
							{/each}
						</dl>
					{/if}
				{/if}
			{/if}
		</div>
	{/if}

	{#if showSegments && segments.length > 1}
		<div class="mt-3 flex min-w-0 flex-col gap-1 rounded-lg border p-2">
			{#each segments as segment, position (position)}
				<div class="flex min-w-0 items-start gap-2 rounded-md px-1 py-1 hover:bg-[var(--surface-2)]">
					<button
						type="button"
						title="Play this sentence"
						class="mt-0.5 grid size-5 shrink-0 place-items-center rounded text-[var(--brand)] hover:bg-[var(--brand-soft)]"
						onclick={() => simulatePlayback('segment')}
					>
						<Volume2 class="size-3.5" />
					</button>
					<p class="min-w-0 font-serif text-sm break-words">{segment}</p>
				</div>
			{/each}
		</div>
	{/if}

	{#if active}
		<div class="mt-3 flex flex-wrap items-center gap-2 border-t pt-3 text-xs text-muted-foreground">
			<span>Read-back voice</span>
			<select
				class="h-7 rounded-md border bg-background px-2 text-xs"
				value={voice}
				onchange={rerender}
				disabled={rerendering}
			>
				{#each voices as option (option.id)}<option value={option.id}>{option.label}</option>{/each}
			</select>
			{#if rerendering}
				<Loader2 class="size-3.5 animate-spin" />
				<span>Re-rendering…</span>
			{/if}
		</div>
	{/if}
</article>
