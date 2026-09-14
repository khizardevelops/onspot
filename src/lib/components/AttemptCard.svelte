<script lang="ts">
	import { fade, fly, slide } from 'svelte/transition';
	import type { AttemptView } from '$lib/stores/practice';
	import {
		ensureAttemptTranslations,
		playAttempt,
		playRecording,
		playSegment,
		setAttemptVoice
	} from '$lib/stores/practice';
	import { appSettings } from '$lib/stores/settings';
	import { listLocalVoices } from '$lib/adapters/tts/service';
	import { splitSentences } from '$lib/utils/segments';
	import { audioActivity, togglePlay } from '$lib/stores/audio';
	import Transcript from './Transcript.svelte';
	import AudioBar from './AudioBar.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import * as Collapsible from '$lib/components/ui/collapsible';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { Separator } from '$lib/components/ui/separator';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import {
		ChevronDown,
		Ellipsis,
		Languages,
		ListMusic,
		Loader2,
		Pause,
		Play,
		RotateCcw,
		Volume2
	} from '@lucide/svelte';

	interface Props {
		attempt: AttemptView;
		index: number;
		active: boolean;
		activeCorrectionId?: string | null;
		onSelectCorrection?: (attemptId: string, correctionId: string) => void;
	}

	let { attempt, index, active, activeCorrectionId = null, onSelectCorrection }: Props = $props();
	type TranslationView = 'off' | 'idiomatic' | 'literal' | 'wordForWord' | 'all';

	const voices = listLocalVoices();
	let showSegments = $state(false);
	let rerendering = $state(false);
	let generatingTranslations = $state(false);
	let translationError = $state<string | null>(null);
	let showIdiomaticVariants = $state(false);
	let showWordBreakdown = $state(false);
	let translationView = $state<TranslationView>(
		$appSettings.translationMode === 'all'
			? 'all'
			: $appSettings.translationMode === 'idiomatic'
				? 'idiomatic'
				: 'off'
	);

	const TRANSLATION_OPTIONS: { id: TranslationView; label: string; detail: string }[] = [
		{ id: 'idiomatic', label: 'Idiomatic', detail: 'Natural English with the same meaning' },
		{ id: 'literal', label: 'Literal', detail: 'English that follows the French structure' },
		{ id: 'wordForWord', label: 'Word-for-word', detail: 'Each word in the original order' },
		{ id: 'all', label: 'Compare all three', detail: 'See the differences side by side' },
		{ id: 'off', label: 'Hide translation', detail: 'Keep the focus on your French' }
	];

	const translations = $derived({
		idiomatic: attempt.translations?.idiomatic || attempt.translation,
		idiomaticVariants: attempt.translations?.idiomaticVariants ?? [],
		literal: attempt.translations?.literal || '',
		wordForWord: attempt.translations?.wordForWord || '',
		wordBreakdown: attempt.translations?.wordBreakdown ?? []
	});

	const translationLabel = $derived.by(() => {
		if (translationView === 'off') return 'Translate';
		if (translationView === 'all') return 'Compare';
		return TRANSLATION_OPTIONS.find((option) => option.id === translationView)?.label ?? 'Translate';
	});

	const visibleTranslations = $derived.by(() => {
		if (translationView === 'off') return [];
		if (translationView === 'all') {
			return [
				{ label: 'Idiomatic', value: translations.idiomatic, italic: false },
				{ label: 'Literal', value: translations.literal, italic: false },
				{ label: 'Word-for-word', value: translations.wordForWord, italic: true }
			].filter((entry) => entry.value);
		}
		const value = translations[translationView];
		const label = TRANSLATION_OPTIONS.find((option) => option.id === translationView)?.label ?? '';
		return value ? [{ label, value, italic: translationView === 'wordForWord' }] : [];
	});

	const segments = $derived(
		splitSentences(attempt.naturalSpeech || attempt.correctedText || attempt.transcript)
	);
	const selectedVoice = $derived(attempt.ttsVoice ?? $appSettings.ttsVoice);

	function needsGeneration(view: TranslationView): boolean {
		if (view === 'off') return false;
		if (attempt.translations?.version !== 2) return true;
		if (view === 'all') return !translations.idiomatic || !translations.literal || !translations.wordForWord;
		return !translations[view];
	}

	async function requestTranslations(force: boolean): Promise<boolean> {
		translationError = null;
		if (generatingTranslations) return false;
		generatingTranslations = true;
		try {
			await ensureAttemptTranslations(attempt.id, force);
			return true;
		} catch (error) {
			translationError = error instanceof Error ? error.message : 'Could not generate translations.';
			return false;
		} finally {
			generatingTranslations = false;
		}
	}

	async function chooseTranslation(value: string): Promise<void> {
		const view = value as TranslationView;
		const previous = translationView;
		translationView = view;
		translationError = null;
		if (needsGeneration(view) && !(await requestTranslations(false))) translationView = previous;
	}

	async function regenerateTranslations(): Promise<void> {
		showIdiomaticVariants = false;
		showWordBreakdown = false;
		await requestTranslations(true);
	}

	async function toggleWordBreakdown(open: boolean): Promise<void> {
		if (!open) {
			showWordBreakdown = false;
			return;
		}
		if (translations.wordBreakdown.length === 0 && !(await requestTranslations(true))) return;
		showWordBreakdown = true;
	}

	function attemptPlaying(): boolean {
		return Boolean(
			$audioActivity.playing &&
				$audioActivity.track?.attemptId === attempt.id &&
				$audioActivity.track?.kind === 'attempt'
		);
	}

	function toggleAttemptAudio(): void {
		if (attemptPlaying()) togglePlay();
		else void playAttempt(attempt.id);
	}

	function segmentPlaying(position: number): boolean {
		return Boolean(
			$audioActivity.playing &&
				$audioActivity.track?.attemptId === attempt.id &&
				$audioActivity.track?.kind === 'segment' &&
				$audioActivity.track?.segmentIndex === position
		);
	}

	function toggleSegment(position: number, text: string): void {
		if (segmentPlaying(position)) togglePlay();
		else void playSegment(attempt.id, text, position);
	}

	async function rerender(voice: string): Promise<void> {
		if (!voice || voice === selectedVoice || rerendering) return;
		rerendering = true;
		try {
			await setAttemptVoice(attempt.id, voice);
		} finally {
			rerendering = false;
		}
	}
</script>

<Card.Root
	data-card-surface
	class="attempt-card relative w-full min-w-0 gap-0 overflow-visible rounded-[22px] py-0 transition-[border-color,box-shadow,transform] duration-300 {active ? 'active-card' : 'hover:-translate-y-0.5 hover:shadow-[var(--shadow-card-hover)]'}"
>
	<Card.Header class="flex-row items-start justify-between gap-3 px-4 pt-4 pb-0 sm:px-5 sm:pt-5">
		<div class="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
			<Badge variant={active ? 'default' : 'secondary'} class="h-5 px-2 text-[10px] tracking-wide uppercase">Take {index}</Badge>
			<span>{attempt.durationSec.toFixed(0)} sec</span>
			<span class="text-faint">·</span>
			<span>{attempt.wordCount} words</span>
		</div>

		<div class="flex shrink-0 items-center gap-1">
			<Tooltip.Root>
				<Tooltip.Trigger
					aria-label={attemptPlaying() ? 'Pause natural version' : 'Play natural version'}
					class="grid size-9 place-items-center rounded-xl text-muted-foreground transition-all hover:bg-[var(--brand-soft)] hover:text-[var(--brand)] focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none"
					onclick={toggleAttemptAudio}
				>
					{#if attemptPlaying()}<Pause class="size-4" />{:else}<Volume2 class="size-4" />{/if}
				</Tooltip.Trigger>
				<Tooltip.Content>{attemptPlaying() ? 'Pause' : 'Play natural version'}</Tooltip.Content>
			</Tooltip.Root>

			<DropdownMenu.Root>
				<DropdownMenu.Trigger
					aria-label="Translation options"
					class="flex h-9 items-center gap-1.5 rounded-xl px-2.5 text-xs font-medium transition-all focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none {translationView !== 'off' ? 'bg-[var(--brand-soft)] text-[var(--brand)]' : 'text-muted-foreground hover:bg-[var(--surface-2)] hover:text-foreground'}"
				>
					{#if generatingTranslations}<Loader2 class="size-3.5 animate-spin" />{:else}<Languages class="size-3.5" />{/if}
					<span class="hidden sm:inline">{generatingTranslations ? 'Working…' : translationLabel}</span>
					<ChevronDown class="size-3" />
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="end" class="w-72 p-1.5" loop>
					<DropdownMenu.Label>Translation style</DropdownMenu.Label>
					<DropdownMenu.RadioGroup value={translationView} onValueChange={(value) => void chooseTranslation(value)}>
						{#each TRANSLATION_OPTIONS as option (option.id)}
							<DropdownMenu.RadioItem value={option.id} class="min-h-11 items-start py-2">
								<span class="min-w-0">
									<span class="block text-sm font-medium">{option.label}</span>
									<span class="mt-0.5 block text-xs leading-snug text-muted-foreground">{option.detail}</span>
								</span>
							</DropdownMenu.RadioItem>
						{/each}
					</DropdownMenu.RadioGroup>
					<DropdownMenu.Separator />
					<DropdownMenu.Item class="min-h-10" onSelect={() => void regenerateTranslations()}>
						<RotateCcw /> Regenerate saved translations
					</DropdownMenu.Item>
				</DropdownMenu.Content>
			</DropdownMenu.Root>

			<DropdownMenu.Root>
				<DropdownMenu.Trigger aria-label="More attempt actions" class="grid size-9 place-items-center rounded-xl text-muted-foreground transition-all hover:bg-[var(--surface-2)] hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none">
					<Ellipsis class="size-4" />
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="end" class="w-60 p-1.5" loop>
					<DropdownMenu.Item class="min-h-10" onSelect={() => void playRecording(attempt.id)}><RotateCcw /> Replay your recording</DropdownMenu.Item>
					<DropdownMenu.CheckboxItem class="min-h-10" checked={showSegments} onCheckedChange={(checked) => (showSegments = checked)}><ListMusic /> Sentence playback</DropdownMenu.CheckboxItem>
					{#if $appSettings.ttsMode === 'local'}
						<DropdownMenu.Sub>
							<DropdownMenu.SubTrigger class="min-h-10"><Volume2 /> Read-back voice</DropdownMenu.SubTrigger>
							<DropdownMenu.SubContent class="w-64 p-1.5">
								<DropdownMenu.RadioGroup value={selectedVoice} onValueChange={(value) => void rerender(value)}>
									{#each voices as voice (voice.id)}
										<DropdownMenu.RadioItem value={voice.id} class="min-h-10">{voice.label}</DropdownMenu.RadioItem>
									{/each}
								</DropdownMenu.RadioGroup>
							</DropdownMenu.SubContent>
						</DropdownMenu.Sub>
					{/if}
				</DropdownMenu.Content>
			</DropdownMenu.Root>
		</div>
	</Card.Header>

	<Card.Content class="px-4 pt-3 pb-4 sm:px-5 sm:pb-5">
		<Transcript
			text={attempt.transcript}
			corrections={attempt.corrections}
			activeCorrectionId={active ? activeCorrectionId : null}
			onSelect={(correctionId) => onSelectCorrection?.(attempt.id, correctionId)}
			class="block break-words font-serif text-[19px] leading-[1.75]"
		/>

		{#if active}
			<div in:slide={{ duration: 280, axis: 'y' }} out:fade={{ duration: 130 }}>
				<AudioBar attemptId={attempt.id} />
			</div>
		{/if}

		{#if translationError}
			<div class="mt-3 flex items-center justify-between gap-3 rounded-xl bg-[var(--error-soft)] px-3 py-2" role="alert" in:fly={{ y: 6, duration: 240 }} out:fade={{ duration: 120 }}>
				<p class="text-sm text-[var(--error)]">{translationError}</p>
				<Button size="xs" variant="outline" onclick={() => void requestTranslations(true)}>Retry</Button>
			</div>
		{/if}

		{#if translationView !== 'off'}
			<div class="mt-4 min-w-0" aria-live="polite" in:slide={{ duration: 320 }} out:fade={{ duration: 140 }}>
				<Separator class="mb-3" />
				{#if generatingTranslations}
					<p class="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 class="size-4 animate-spin text-[var(--brand)]" /> Generating and saving translations…</p>
				{:else}
					<div class={visibleTranslations.length > 1 ? 'grid gap-3 sm:grid-cols-3' : ''}>
						{#each visibleTranslations as translation (translation.label)}
							<div class="translation-surface min-w-0 rounded-xl px-3 py-2.5" in:fly={{ y: 5, duration: 260 }}>
								<p class="text-[10px] font-semibold tracking-[0.12em] text-faint uppercase">{translation.label}</p>
								<p class="mt-1 text-sm leading-relaxed break-words {translation.italic ? 'text-muted-foreground italic' : ''}">{translation.value}</p>
							</div>
						{/each}
					</div>

					{#if (translationView === 'idiomatic' || translationView === 'all') && translations.idiomaticVariants.length > 0}
						<Collapsible.Root bind:open={showIdiomaticVariants} class="mt-2">
							<Collapsible.Trigger class="flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs font-medium text-[var(--brand)] transition-colors hover:bg-[var(--brand-soft)]">
								<ChevronDown class="size-3.5 transition-transform duration-300 {showIdiomaticVariants ? 'rotate-180' : ''}" />
								{showIdiomaticVariants ? 'Hide' : 'Show'} {translations.idiomaticVariants.length} natural alternative{translations.idiomaticVariants.length === 1 ? '' : 's'}
							</Collapsible.Trigger>
							<Collapsible.Content class="disclosure overflow-hidden">
								<div class="grid gap-2 pt-1 sm:grid-cols-2">
									{#each translations.idiomaticVariants as variant (variant)}
										<p class="rounded-xl bg-[var(--surface-2)] px-3 py-2 text-sm">{variant}</p>
									{/each}
								</div>
							</Collapsible.Content>
						</Collapsible.Root>
					{/if}

					{#if translationView === 'wordForWord' || translationView === 'all'}
						<Collapsible.Root open={showWordBreakdown} onOpenChange={(open) => void toggleWordBreakdown(open)} class="mt-1">
							<Collapsible.Trigger class="flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs font-medium text-[var(--brand)] transition-colors hover:bg-[var(--brand-soft)]">
								<ChevronDown class="size-3.5 transition-transform duration-300 {showWordBreakdown ? 'rotate-180' : ''}" /> Word breakdown
							</Collapsible.Trigger>
							<Collapsible.Content class="disclosure overflow-hidden">
								{#if translations.wordBreakdown.length > 0}
									<dl class="mt-1 grid grid-cols-[minmax(0,auto)_1fr] gap-x-3 gap-y-1.5 rounded-xl bg-[var(--surface-2)] p-3 text-xs">
										{#each translations.wordBreakdown as item, position (`${item.source}-${position}`)}
											<dt class="font-medium break-words">{item.source}</dt><dd class="min-w-0 text-muted-foreground break-words">{item.target}</dd>
										{/each}
									</dl>
								{/if}
							</Collapsible.Content>
						</Collapsible.Root>
					{/if}
				{/if}
			</div>
		{/if}

		{#if showSegments && segments.length > 1}
			<div class="mt-4" in:slide={{ duration: 300 }} out:fade={{ duration: 140 }}>
				<Separator class="mb-3" />
				<p class="eyebrow mb-2"><ListMusic class="size-3.5" /> Sentence playback</p>
				<div class="space-y-1">
					{#each segments as segment, position (position)}
						<div class="flex min-w-0 items-start gap-2 rounded-xl px-1.5 py-1.5 transition-colors hover:bg-[var(--surface-2)]">
							<Button size="icon-sm" variant="ghost" class="mt-0.5 shrink-0 text-[var(--brand)]" aria-label={`${segmentPlaying(position) ? 'Pause' : 'Play'} sentence ${position + 1}`} onclick={() => toggleSegment(position, segment)}>
								{#if segmentPlaying(position)}<Pause class="size-3.5" />{:else}<Play class="size-3.5" />{/if}
							</Button>
							<p class="min-w-0 font-serif text-sm leading-relaxed break-words">{segment}</p>
						</div>
					{/each}
				</div>
			</div>
		{/if}

		{#if rerendering}
			<p class="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite"><Loader2 class="size-3.5 animate-spin" /> Preparing the new voice…</p>
		{/if}
	</Card.Content>
</Card.Root>

<style>
	:global(.attempt-card) {
		background:
			linear-gradient(145deg, color-mix(in srgb, var(--card) 97%, var(--brand-soft)), var(--card) 60%),
			var(--card);
		box-shadow: var(--shadow-card);
	}
	:global(.active-card) {
		box-shadow: 0 0 0 1px var(--brand), 0 18px 55px color-mix(in srgb, var(--brand) 12%, transparent);
	}
	.translation-surface { background: color-mix(in srgb, var(--surface-2) 82%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--border) 65%, transparent); }
	:global(.disclosure[data-state='open']) { animation: disclose 300ms cubic-bezier(0.22, 1, 0.36, 1); }
	:global(.disclosure[data-state='closed']) { animation: conceal 170ms cubic-bezier(0.4, 0, 1, 1); }
	@keyframes disclose { from { height: 0; opacity: 0; transform: translateY(-4px); } to { height: var(--bits-collapsible-content-height); opacity: 1; transform: translateY(0); } }
	@keyframes conceal { from { height: var(--bits-collapsible-content-height); opacity: 1; } to { height: 0; opacity: 0; } }
	@media (prefers-reduced-motion: reduce) { :global(.attempt-card) { transition-duration: 1ms; } :global(.disclosure) { animation-duration: 1ms !important; } }
</style>
