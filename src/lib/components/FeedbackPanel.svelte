<script lang="ts">
	import { quickCollapse } from '#lib/neo.js';
	import { untrack } from 'svelte';
	import { flip } from 'svelte/animate';
	import { fade, fly } from 'svelte/transition';
	import type { Correction, CorrectionSeverity } from '#lib/adapters/db/index.js';
	import type { AttemptView } from '#lib/stores/practice.js';
	import { playAttempt, playRecording, speakText } from '#lib/stores/practice.js';
	import { correctionTitle, isDeletion, isInsertion } from '#lib/utils/corrections.js';
	import { NeoButton } from '@dvcol/neo-svelte/buttons';
	import { NeoCollapse } from '@dvcol/neo-svelte/collapse';
	import { NeoDivider } from '@dvcol/neo-svelte/divider';
	import type { NeoMenuItem } from '@dvcol/neo-svelte/floating/menu';
	import PopMenu from '#lib/components/PopMenu.svelte';
	import { NeoTab, NeoTabs } from '@dvcol/neo-svelte/nav';
	import { NeoPill } from '@dvcol/neo-svelte/pill';
	import {
		ArrowRight,
		BarChart3,
		Check,
		ChevronDown,
		ListFilter,
		MessageSquareText,
		Plus,
		RotateCcw,
		Trash2,
		Volume2
	} from '@lucide/svelte';

	type Filter = 'all' | 'error' | 'warning' | 'suggestion' | 'grammar' | 'register' | 'filler' | 'style';

	interface SessionStats {
		attempts: number;
		words: number;
		time: number;
		errors: number;
	}

	interface Props {
		attempt: AttemptView | null;
		open?: boolean;
		activeCorrectionId?: string | null;
		stats: SessionStats;
		onSelectCorrection?: (attemptId: string, correctionId: string) => void;
	}

	let { attempt, open = $bindable(true), activeCorrectionId = null, stats, onSelectCorrection }: Props = $props();
	let filter = $state<Filter>('all');
	let expandedId = $state<string | null>(null);
	let knownAttemptId = $state<string | null>(null);
	let statsOpen = $state(false);

	const CATEGORY_LABEL: Record<string, string> = {
		grammar: 'Grammar',
		register: 'Register',
		filler: 'Fillers',
		style: 'Style'
	};

	const SEVERITY_LABEL: Record<CorrectionSeverity, string> = {
		error: 'Error',
		warning: 'Warning',
		suggestion: 'Suggestion'
	};

	const SEVERITY_CLASS: Record<CorrectionSeverity, string> = {
		error: 'text-[var(--error)]',
		warning: 'text-[var(--warn)]',
		suggestion: 'text-[var(--brand)]'
	};

	const EXAM_BADGE: Record<string, string> = {
		'strictly-avoid': 'Avoid in exam',
		avoid: 'Avoid in exam',
		'use-sparingly': 'Use sparingly',
		allowed: 'Allowed'
	};

	const counts = $derived.by(() => {
		const list = attempt?.corrections ?? [];
		return {
			all: list.length,
			error: list.filter((item) => item.severity === 'error').length,
			warning: list.filter((item) => item.severity === 'warning').length,
			suggestion: list.filter((item) => item.severity === 'suggestion').length
		};
	});

	const categoryCounts = $derived.by(() => {
		const list = attempt?.corrections ?? [];
		return {
			grammar: list.filter((item) => item.category === 'grammar').length,
			register: list.filter((item) => item.category === 'register').length,
			filler: list.filter((item) => item.category === 'filler').length,
			style: list.filter((item) => item.category === 'style').length
		};
	});

	const corrections = $derived.by(() => {
		const list = [...(attempt?.corrections ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
		if (filter === 'all') return list;
		if (filter === 'error' || filter === 'warning' || filter === 'suggestion') {
			return list.filter((item) => item.severity === filter);
		}
		return list.filter((item) => item.category === filter);
	});

	const TABS = $derived([
		{ id: 'all', label: 'All', count: counts.all },
		{ id: 'error', label: 'Errors', count: counts.error },
		{ id: 'warning', label: 'Warnings', count: counts.warning },
		{ id: 'suggestion', label: 'Suggestions', count: counts.suggestion }
	]);

	const tabValue = $derived(
		filter === 'all' || filter === 'error' || filter === 'warning' || filter === 'suggestion'
			? filter
			: ''
	);
	const categoryActive = $derived(
		filter === 'grammar' || filter === 'register' || filter === 'filler' || filter === 'style'
	);

	$effect(() => {
		if (attempt?.id !== knownAttemptId) {
			knownAttemptId = attempt?.id ?? null;
			filter = 'all';
			expandedId = null;
		}
	});

	$effect(() => {
		const id = activeCorrectionId;
		if (!id || !attempt?.corrections.some((item) => item.id === id)) return;
		expandedId = id;
		// A filter that hides the correction clicked in the transcript would make the click look broken.
		if (!untrack(() => corrections).some((item) => item.id === id)) filter = 'all';
		// Bring it into view once the panel has rendered (it may have just opened).
		requestAnimationFrame(() =>
			document
				.querySelector(`[data-correction-id="${CSS.escape(id)}"]`)
				?.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
		);
	});

	const CATEGORIES = ['grammar', 'register', 'filler', 'style'] as const;
	let filterMenuOpen = $state(false);
	const filterItems = $derived<NeoMenuItem[]>([
		{
			value: 'type',
			label: 'Feedback type',
			section: true,
			items: CATEGORIES.map((category) => ({
				value: category,
				label: CATEGORY_LABEL[category],
				after: categoryAfter,
				color: filter === category ? 'primary' : undefined
			}))
		},
		...(categoryActive ? [{ value: 'all', label: 'Clear type filter', divider: { top: true } }] : [])
	]);

	function onFilterSelect(item: NeoMenuItem): void {
		filter = item.value as Filter;
	}

	function select(correction: Correction, open = true): void {
		if (!attempt) return;
		expandedId = open ? correction.id : null;
		onSelectCorrection?.(attempt.id, correction.id);
	}

	function fmtTime(seconds: number): string {
		const mins = Math.floor(seconds / 60);
		const secs = Math.floor(seconds % 60);
		return `${mins}:${String(secs).padStart(2, '0')}`;
	}
</script>

{#snippet categoryAfter({ item }: { item: { value: unknown } })}
	<span class="flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
		{categoryCounts[item.value as keyof typeof categoryCounts]}
		{#if filter === item.value}<Check class="size-3.5 text-[var(--primary)]" />{/if}
	</span>
{/snippet}

<aside
	class="feedback-shell flex min-h-0 flex-col overflow-hidden border-t lg:border-t-0 lg:border-l"
	data-state={open ? 'open' : 'closed'}
>
	<div class="coach-bar flex shrink-0 items-center gap-1 p-2 sm:px-3">
		<button
			type="button"
			class="coach-trigger relative flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-xl px-2 text-left text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none"
			aria-label={open ? 'Close feedback' : 'Open feedback'}
			aria-expanded={open}
			title={open ? 'Close feedback' : 'Open feedback'}
			onclick={() => (open = !open)}
		>
			<span class="coach-icon grid size-7 shrink-0 place-items-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">
				<MessageSquareText class="size-3.5" />
			</span>
			<span class="coach-title min-w-0 flex-1 text-xs font-semibold tracking-[0.14em] uppercase">Feedback</span>
			{#if attempt && counts.all > 0}
				<NeoPill class="coach-count" size="small" rounded elevation={0} tinted>{counts.all}</NeoPill>
			{/if}
			<!-- The direction marker is part of the same full-width feedback control. -->
			<ChevronDown class="coach-chevron size-4 shrink-0 transition-transform duration-200 {open ? 'rotate-180' : ''}" />
		</button>
		<!-- Playback lives in the header so the summary below gets the full width. -->
		{#if attempt}
			<div class="coach-actions flex shrink-0 items-center gap-0.5">
				<NeoButton text rounded class="coach-action" aria-label="Play your recording" title="Your recording" onclick={() => playRecording(attempt.id)}>
					{#snippet icon()}<RotateCcw class="size-4" />{/snippet}
				</NeoButton>
				<NeoButton text rounded class="coach-action" aria-label="Play natural version" title="Natural version" onclick={() => playAttempt(attempt.id)}>
					{#snippet icon()}<Volume2 class="size-4" />{/snippet}
				</NeoButton>
			</div>
		{/if}
	</div>

	<NeoCollapse transition={quickCollapse}
		bind:open
		standalone
		class="coach-content flex min-h-0 flex-1 overflow-hidden"
		containerProps={{ class: 'coach-collapse flex min-h-0 flex-1 flex-col' }}
	>
			<!-- `.coach-content` is a row flex box; without `w-full` this column shrinks to its content. -->
			<div class="flex h-full min-h-0 w-full min-w-0 flex-col">
	{#if attempt}
		<div class="shrink-0 px-4 pt-0.5 pb-3 sm:px-5">
			{#if attempt.summary}
				<p class="mb-2.5 text-sm leading-relaxed text-muted-foreground">{attempt.summary}</p>
			{/if}

			{#if attempt.corrections.length > 0}
				<div class="flex items-stretch gap-1.5">
					<!-- Severity tabs carry their own per-severity tint: no generic accent border. -->
					<div class="severity-tabs custom-selection min-w-0 flex-1">
						<NeoTabs
							active={tabValue || undefined}
							onchange={(id) => {
								// A category filter clears the active tab; NeoTabs echoes that as `undefined`.
								if (id) filter = id as Filter;
							}}
							class="feedback-tabs"
							elevation={-2}
							rounded
							dim={false}
						>
							{#each TABS as tab (tab.id)}
								<NeoTab tabId={tab.id} data-severity={tab.id} tabProps={{ class: 'feedback-tab' }} aria-label="{tab.label}: {tab.count}">
									<span class="flex flex-col items-center gap-[3px]">
										<span class="text-base leading-none font-semibold tabular-nums">{tab.count}</span>
										<span class="feedback-tab-label">{tab.label}</span>
									</span>
								</NeoTab>
							{/each}
						</NeoTabs>
					</div>

					<PopMenu
						items={filterItems}
						bind:open={filterMenuOpen}
						placement="bottom-end"
						onSelect={onFilterSelect}
						rounded
					>
						<NeoButton
							aria-label="Filter by feedback type"
							title="Filter by type"
							class="filter-key {categoryActive ? 'active is-selected' : ''}"
							rounded
							elevation={categoryActive ? -2 : 2}
							color={categoryActive ? 'primary' : undefined}
						>
							{#snippet icon()}<ListFilter class="size-4" />{/snippet}
						</NeoButton>
					</PopMenu>
				</div>
			{/if}
		</div>

		<NeoDivider />

		<div class="min-h-0 flex-1 overflow-y-auto px-4 sm:px-5">
			{#if attempt.corrections.length === 0}
				<div class="grid min-h-40 place-items-center py-8 text-center" in:fade={{ duration: 280 }}>
					<div>
						<div class="mx-auto grid size-11 place-items-center rounded-2xl bg-[var(--good-soft)] text-[var(--good)]"><Check class="size-5" /></div>
						<p class="mt-3 font-medium">Clean take</p>
						<p class="mt-1 text-sm text-muted-foreground">Nothing needs correcting.</p>
					</div>
				</div>
			{:else if corrections.length === 0}
				<p class="py-8 text-center text-sm text-muted-foreground" in:fade={{ duration: 180 }}>Nothing in this filter.</p>
			{:else}
				<div class="space-y-2 py-2">
					{#each corrections as correction (correction.id)}
						{@const expanded = expandedId === correction.id}
						<div
							data-correction-id={correction.id}
							animate:flip={{ duration: 220 }}
							in:fly={{ y: 8, duration: 220 }}
							out:fade={{ duration: 120 }}
							class="overflow-hidden sheet rounded-2xl transition-colors {correction.id === activeCorrectionId ? 'border-[var(--brand)]/50' : ''}"
						>
							<button
								type="button"
								aria-expanded={expanded}
								onclick={() => select(correction, !expanded)}
								class="feedback-section-trigger flex min-h-11 w-full items-start justify-between gap-3 px-3 py-2.5 text-left focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none {correction.id === activeCorrectionId ? 'bg-[var(--brand-soft)]' : ''}"
							>
								<span class="min-w-0 flex-1">
									<span class="flex flex-wrap items-center gap-1.5">
										<NeoPill size="small" rounded elevation={0} class="category-pill">
											{CATEGORY_LABEL[correction.category] ?? correction.category}
										</NeoPill>
										<span class="flex items-center gap-1 text-[11px] font-medium {SEVERITY_CLASS[correction.severity]}">
											<span class="size-1.5 rounded-full bg-current"></span>{SEVERITY_LABEL[correction.severity]}
										</span>
									</span>
									<span class="mt-1 block text-sm font-semibold text-foreground">{correctionTitle(correction)}</span>

									<span class="mt-1.5 flex min-w-0 flex-wrap items-center gap-2 font-serif text-base leading-snug">
										{#if isDeletion(correction)}
											<span class="rounded-md bg-[var(--error-soft)] px-1.5 py-0.5 text-muted-foreground line-through decoration-[var(--error)] decoration-2">{correction.original}</span>
											<NeoPill size="small" rounded elevation={0} tinted color="error" class="gap-1">
												<Trash2 class="size-3" /> Remove
											</NeoPill>
										{:else if isInsertion(correction)}
											<NeoPill size="small" rounded elevation={0} tinted color="success" class="gap-1">
												<Plus class="size-3" /> Add
											</NeoPill>
											<span class="font-semibold">{correction.replacement}</span>
										{:else}
											<span class="text-muted-foreground line-through decoration-current/50">{correction.original}</span>
											<ArrowRight class="size-3.5 shrink-0 text-faint" />
											<span class="font-semibold">{correction.replacement}</span>
										{/if}
									</span>
									{#if correction.replacementTranslation && !isDeletion(correction)}
										<span class="mt-1 block text-xs text-muted-foreground">{correction.replacementTranslation}</span>
									{/if}
								</span>
								<ChevronDown class="mt-2 size-4 shrink-0 text-faint transition-transform duration-300 {expanded ? 'rotate-180' : ''}" />
							</button>

							<NeoCollapse transition={quickCollapse} open={expanded} standalone class="correction-detail px-3">
								<div class="border-t border-border/70 pt-2 pb-2.5">
									{#if correction.explanation}
										<p class="text-sm leading-relaxed text-muted-foreground">{correction.explanation}</p>
									{/if}
									{#if correction.formalAlternatives.length > 0}
										<div class="mt-2 flex flex-wrap items-center gap-1.5">
											<span class="text-xs text-faint">Try instead</span>
											{#each correction.formalAlternatives as alternative (alternative)}
												<NeoPill size="small" rounded elevation={1}>{alternative}</NeoPill>
											{/each}
										</div>
									{/if}
									<div class="mt-2 flex flex-wrap items-center gap-2">
										{#if correction.examStatus}
											<NeoPill
												size="small"
												rounded
												elevation={0}
												tinted
												color={correction.examStatus === 'strictly-avoid' || correction.examStatus === 'avoid' ? 'error' : undefined}
												class="exam-pill"
											>{EXAM_BADGE[correction.examStatus] ?? correction.examStatus}</NeoPill>
										{/if}
										{#if correction.speakText || correction.replacement}
											<NeoButton text rounded color="primary" class="hear-button" onclick={() => void speakText(correction.speakText ?? correction.replacement)}>
												{#snippet icon()}<Volume2 class="size-3.5" />{/snippet}
												Hear it
											</NeoButton>
										{/if}
									</div>
								</div>
							</NeoCollapse>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{:else}
		<div class="grid min-h-0 flex-1 place-items-center p-6 text-center" in:fade={{ duration: 240 }}>
			<div>
				<div class="mx-auto grid size-12 place-items-center rounded-2xl bg-[var(--brand-soft)] text-[var(--brand)]"><MessageSquareText class="size-5" /></div>
				<p class="mt-3 font-medium">Feedback lives here</p>
				<p class="mt-1 max-w-52 text-sm text-muted-foreground">Select an attempt after your first recording.</p>
			</div>
		</div>
	{/if}

	<div class="shrink-0 border-t bg-background/45">
		<button
			type="button"
			class="feedback-section-trigger flex h-9 w-full items-center justify-between gap-2 px-4 text-xs text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none sm:px-5"
			aria-label={statsOpen ? 'Collapse session stats' : 'Expand session stats'}
			aria-expanded={statsOpen}
			onclick={() => (statsOpen = !statsOpen)}
		>
			<span class="flex items-center gap-1.5 font-medium"><BarChart3 class="size-3.5" /> Session stats</span>
			<ChevronDown class="size-3.5 transition-transform duration-300 {statsOpen ? 'rotate-180' : ''}" />
		</button>
		<NeoCollapse transition={quickCollapse} bind:open={statsOpen} standalone>
				<div class="grid grid-cols-2 gap-1.5 px-4 pb-3 sm:px-5">
					<div class="rounded-xl bg-[var(--surface-2)] px-3 py-1.5">
						<p class="text-[10px] tracking-wide text-faint uppercase">Takes</p>
						<p class="text-sm font-semibold tabular-nums">{stats.attempts}</p>
					</div>
					<div class="rounded-xl bg-[var(--surface-2)] px-3 py-1.5">
						<p class="text-[10px] tracking-wide text-faint uppercase">Words</p>
						<p class="text-sm font-semibold tabular-nums">{stats.words}</p>
					</div>
					<div class="rounded-xl bg-[var(--surface-2)] px-3 py-1.5">
						<p class="text-[10px] tracking-wide text-faint uppercase">Time</p>
						<p class="text-sm font-semibold tabular-nums">{fmtTime(stats.time)}</p>
					</div>
					<div class="rounded-xl bg-[var(--surface-2)] px-3 py-1.5">
						<p class="text-[10px] tracking-wide text-faint uppercase">Errors</p>
						<p class="text-sm font-semibold tabular-nums {stats.errors > 0 ? 'text-[var(--error)]' : ''}">{stats.errors}</p>
					</div>
				</div>
		</NeoCollapse>
	</div>
			</div>
	</NeoCollapse>
</aside>

<style>
	.feedback-shell {
		background:
			linear-gradient(180deg, color-mix(in srgb, var(--card) 22%, transparent), transparent 55%),
			radial-gradient(circle at 100% 0%, var(--brand-soft), transparent 45%);
	}

	/* Disclosure rows are one control. Their chevrons are visual state markers,
	   not independent hover targets; avoid the generic legacy hover treatment. */
	:global(.coach-trigger),
	:global(.feedback-section-trigger) {
		background: transparent;
		color: var(--muted-foreground);
		transition: none;
	}
	:global(.coach-trigger:hover),
	:global(.feedback-section-trigger:hover) {
		background: transparent;
		color: var(--muted-foreground);
	}

	/*
	 * Severity tabs: a neo inset tab channel whose sliding raised key follows the
	 * selected tab; the selected label takes its severity colour. Tabs size to
	 * their label within a floor and a ceiling, so "All" stays narrow.
	 */
	.severity-tabs {
		container-type: inline-size;
	}
	.severity-tabs :global(.neo-tabs.feedback-tabs),
	.severity-tabs :global(.neo-tabs .neo-tabs-group) {
		width: 100%;
	}
	.severity-tabs :global(.neo-tabs-group) {
		height: 50px;
		padding: 4px;
		gap: 2px;
		flex-wrap: nowrap;
	}
	.severity-tabs :global(.neo-tab.feedback-tab) {
		flex: 1 1 auto;
		min-width: 40px;
		max-width: 104px;
		height: 100%;
	}
	.severity-tabs :global(.neo-tab.feedback-tab .neo-button) {
		width: 100%;
		height: 100%;
		padding-inline: 6px;
		justify-content: center;
		color: var(--on-control);
	}
	.severity-tabs :global(.neo-tab.feedback-tab.neo-active .neo-button) { color: var(--foreground); }
	.severity-tabs :global(.neo-tab.feedback-tab.neo-active .neo-button[data-severity='error']) { color: var(--error); }
	.severity-tabs :global(.neo-tab.feedback-tab.neo-active .neo-button[data-severity='warning']) { color: var(--warn); }
	.severity-tabs :global(.neo-tab.feedback-tab.neo-active .neo-button[data-severity='suggestion']) { color: var(--brand); }
	.severity-tabs :global(.feedback-tab-label) {
		display: block;
		max-width: 100%;
		overflow: hidden;
		font-size: 11px;
		font-weight: 500;
		line-height: 1;
		letter-spacing: -0.01em;
		white-space: nowrap;
	}
	@container (max-width: 250px) {
		.severity-tabs :global(.feedback-tab-label) { font-size: 10px; }
		.severity-tabs :global(.neo-tab.feedback-tab .neo-button) { padding-inline: 4px; }
	}

	.feedback-shell :global(.neo-button.filter-key) {
		width: 40px;
		height: 50px;
		padding: 0;
		justify-content: center;
		color: var(--on-control);
	}
	.feedback-shell :global(.neo-button.filter-key.active) { color: var(--primary); }
	.feedback-shell :global(.neo-button.coach-action) {
		width: 32px;
		height: 32px;
		padding: 0;
		justify-content: center;
		color: var(--muted-foreground);
	}
	.feedback-shell :global(.neo-button.hear-button) {
		min-height: 26px;
		padding: 2px 8px;
		gap: 4px;
		font-size: 12px;
	}
	.feedback-shell :global(.neo-pill.coach-count) {
		min-width: 24px;
		height: 24px;
		justify-content: center;
		font-variant-numeric: tabular-nums;
	}
	/* Pills sit inside serif correction text; keep their labels in the UI face. */
	.feedback-shell :global(.neo-pill) { font-family: var(--font-sans); }
	.feedback-shell :global(.neo-pill.category-pill),
	.feedback-shell :global(.neo-pill.exam-pill) {
		font-size: 10px;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}
	.feedback-shell :global(.neo-pill.category-pill) { background-color: var(--surface-2); }

	@media (min-width: 1024px) {
		.feedback-shell[data-state='closed'] .coach-bar { padding-inline: 7px; }
		.feedback-shell[data-state='closed'] :global(.coach-trigger) {
			min-height: 52px;
			justify-content: center;
			gap: 3px;
			padding-inline: 0;
		}
		.feedback-shell[data-state='closed'] :global(.coach-title) { display: none; }
		.feedback-shell[data-state='closed'] .coach-actions { display: none; }
		.feedback-shell[data-state='closed'] :global(.coach-count) {
			position: absolute;
			top: 1px;
			right: 1px;
			min-width: 18px;
			height: 18px;
			font-size: 10px;
		}
	}

	/* On phones a collapsed panel is deliberately just a thin, tappable handle. */
	@media (max-width: 1023px) {
		.feedback-shell[data-state='closed'] .coach-bar {
			height: 36px;
			padding: 0 8px;
		}
		.feedback-shell[data-state='closed'] :global(.coach-trigger) {
			min-height: 36px;
			gap: 6px;
			padding-inline: 4px;
		}
		.feedback-shell[data-state='closed'] :global(.coach-icon) {
			width: 24px;
			height: 24px;
			border-radius: 8px;
		}
		.feedback-shell[data-state='closed'] :global(.coach-title) {
			font-size: 10px;
			letter-spacing: 0.11em;
		}
	}

	.feedback-shell[data-state='closed'] .coach-actions { display: none; }
</style>
