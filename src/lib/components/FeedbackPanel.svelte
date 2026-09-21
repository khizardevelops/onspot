<script lang="ts">
	import { flip } from 'svelte/animate';
	import { fade, fly } from 'svelte/transition';
	import type { Correction, CorrectionSeverity } from '$lib/adapters/db';
	import type { AttemptView } from '$lib/stores/practice';
	import { playAttempt, playRecording, speakText } from '$lib/stores/practice';
	import { correctionTitle, isDeletion, isInsertion } from '$lib/utils/corrections';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Collapsible from '$lib/components/ui/collapsible';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { Separator } from '$lib/components/ui/separator';
	import * as Tabs from '$lib/components/ui/tabs';
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

	/*
	 * The severity tabs are the same kind of control as Exam / Casual: a channel
	 * with one raised knob that slides to the selected tab. Tabs are sized to
	 * their labels, so the knob follows the measured tab rather than a fixed grid.
	 */
	let tabsList = $state<HTMLElement | null>(null);
	let knob = $state({ x: 0, width: 0, visible: false });

	function placeKnob(): void {
		const active = tabsList?.querySelector<HTMLElement>('[role="tab"][data-state="active"]');
		knob = active
			? { x: active.offsetLeft, width: active.offsetWidth, visible: true }
			: { ...knob, visible: false };
	}

	$effect(() => {
		if (!tabsList) return;
		const observer = new ResizeObserver(placeKnob);
		observer.observe(tabsList);
		return () => observer.disconnect();
	});

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
		void tabValue;
		void counts;
		requestAnimationFrame(placeKnob);
	});

	$effect(() => {
		if (activeCorrectionId && attempt?.corrections.some((item) => item.id === activeCorrectionId)) {
			expandedId = activeCorrectionId;
		}
	});

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

<aside
	class="feedback-shell flex min-h-0 flex-col overflow-hidden border-t lg:border-t-0 lg:border-l"
	data-state={open ? 'open' : 'closed'}
>
	<Collapsible.Root bind:open class="contents">
		<div class="coach-bar flex shrink-0 items-center gap-1 p-2 sm:px-3">
			<Collapsible.Trigger
				class="coach-trigger relative flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-xl px-2 text-left text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none"
				aria-label={open ? 'Close feedback' : 'Open feedback'}
				title={open ? 'Close feedback' : 'Open feedback'}
			>
				<span class="coach-icon grid size-7 shrink-0 place-items-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">
					<MessageSquareText class="size-3.5" />
				</span>
				<span class="coach-title min-w-0 flex-1 text-xs font-semibold tracking-[0.14em] uppercase">Feedback</span>
				{#if attempt && counts.all > 0}
					<Badge variant="secondary" class="coach-count h-6 min-w-6 justify-center rounded-full px-1.5 tabular-nums">{counts.all}</Badge>
				{/if}
				<!-- The direction marker is part of the same full-width feedback control. -->
				<ChevronDown class="coach-chevron size-4 shrink-0 transition-transform duration-200 {open ? 'rotate-180' : ''}" />
			</Collapsible.Trigger>
			<!-- Playback lives in the header so the summary below gets the full width. -->
			{#if attempt}
				<div class="coach-actions flex shrink-0 items-center gap-0.5">
					<Button size="icon-sm" variant="ghost" aria-label="Play your recording" title="Your recording" onclick={() => playRecording(attempt.id)}>
						<RotateCcw class="size-4" />
					</Button>
					<Button size="icon-sm" variant="ghost" aria-label="Play natural version" title="Natural version" onclick={() => playAttempt(attempt.id)}>
						<Volume2 class="size-4" />
					</Button>
				</div>
			{/if}
		</div>

		<Collapsible.Content class="coach-content min-h-0 flex-1 overflow-hidden">
			<!-- `.coach-content` is a row flex box; without `w-full` this column shrinks to its content. -->
			<div class="flex h-full min-h-0 w-full min-w-0 flex-col">
	{#if attempt}
		<div class="shrink-0 px-4 pt-0.5 pb-3 sm:px-5">
			{#if attempt.summary}
				<p class="mb-2.5 text-sm leading-relaxed text-muted-foreground">{attempt.summary}</p>
			{/if}

			{#if attempt.corrections.length > 0}
				<div class="flex items-stretch gap-1.5">
					<Tabs.Root
						value={tabValue}
						onValueChange={(value) => (filter = value as Filter)}
						class="severity-tabs min-w-0 flex-1"
					>
						<Tabs.List
							bind:ref={tabsList}
							class="feedback-tabs paper-grain relative flex h-[50px] w-full justify-start gap-0.5 rounded-[14px] p-1"
						>
							<span
								class="tab-knob paper-grain"
								class:visible={knob.visible}
								style:translate={`${knob.x}px 0`}
								style:width={`${knob.width}px`}
								aria-hidden="true"
							></span>
							{#each TABS as tab (tab.id)}
								<Tabs.Trigger value={tab.id} data-severity={tab.id} class="feedback-tab">
									<span class="text-base leading-none font-semibold tabular-nums">{tab.count}</span>
									<span class="feedback-tab-label">{tab.label}</span>
								</Tabs.Trigger>
							{/each}
						</Tabs.List>
					</Tabs.Root>

					<DropdownMenu.Root>
						<DropdownMenu.Trigger
							aria-label="Filter by feedback type"
							title="Filter by type"
							class="filter-key paper-grain grid w-10 shrink-0 place-items-center rounded-[14px] transition-colors focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none {categoryActive ? 'bg-primary text-primary-foreground' : 'bg-control text-on-control hover:bg-control-hover'}"
						>
							<ListFilter class="size-4" />
						</DropdownMenu.Trigger>
						<DropdownMenu.Content align="end" class="w-56 p-1.5" loop>
							<DropdownMenu.Label>Feedback type</DropdownMenu.Label>
							<DropdownMenu.RadioGroup
								value={categoryActive ? filter : ''}
								onValueChange={(value) => (filter = value as Filter)}
							>
								{#each ['grammar', 'register', 'filler', 'style'] as category (category)}
									<DropdownMenu.RadioItem value={category} class="min-h-9">
										<span>{CATEGORY_LABEL[category]}</span>
										<span class="ml-auto text-xs text-muted-foreground tabular-nums">{categoryCounts[category as keyof typeof categoryCounts]}</span>
									</DropdownMenu.RadioItem>
								{/each}
							</DropdownMenu.RadioGroup>
							{#if categoryActive}
								<DropdownMenu.Separator />
								<DropdownMenu.Item onSelect={() => (filter = 'all')}>Clear type filter</DropdownMenu.Item>
							{/if}
						</DropdownMenu.Content>
					</DropdownMenu.Root>
				</div>
			{/if}
		</div>

		<Separator />

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
							animate:flip={{ duration: 220 }}
							in:fly={{ y: 8, duration: 220 }}
							out:fade={{ duration: 120 }}
						>
						<Collapsible.Root
							open={expanded}
							onOpenChange={(open) => select(correction, open)}
							class="group/correction overflow-hidden sheet rounded-2xl transition-colors {correction.id === activeCorrectionId ? 'border-[var(--brand)]/50' : ''}"
						>
							<Collapsible.Trigger
								class="feedback-section-trigger flex min-h-11 w-full items-start justify-between gap-3 px-3 py-2.5 text-left focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none {correction.id === activeCorrectionId ? 'bg-[var(--brand-soft)]' : ''}"
							>
								<span class="min-w-0 flex-1">
									<span class="flex flex-wrap items-center gap-1.5">
										<Badge variant="secondary" class="h-5 bg-[var(--surface-2)] px-1.5 text-[10px] tracking-wide uppercase">
											{CATEGORY_LABEL[correction.category] ?? correction.category}
										</Badge>
										<span class="flex items-center gap-1 text-[11px] font-medium {SEVERITY_CLASS[correction.severity]}">
											<span class="size-1.5 rounded-full bg-current"></span>{SEVERITY_LABEL[correction.severity]}
										</span>
									</span>
									<span class="mt-1 block text-sm font-semibold text-foreground">{correctionTitle(correction)}</span>

									<span class="mt-1.5 flex min-w-0 flex-wrap items-center gap-2 font-serif text-base leading-snug">
										{#if isDeletion(correction)}
											<span class="rounded-md bg-[var(--error-soft)] px-1.5 py-0.5 text-muted-foreground line-through decoration-[var(--error)] decoration-2">{correction.original}</span>
											<Badge variant="destructive" class="gap-1"><Trash2 class="size-3" /> Remove</Badge>
										{:else if isInsertion(correction)}
											<Badge class="gap-1 bg-[var(--good-soft)] text-[var(--good)]"><Plus class="size-3" /> Add</Badge>
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
								<ChevronDown class="mt-2 size-4 shrink-0 text-faint transition-transform duration-300 group-data-[state=open]/correction:rotate-180" />
							</Collapsible.Trigger>

							<Collapsible.Content class="correction-detail overflow-hidden px-3">
								<div class="border-t border-border/70 pt-2 pb-2.5">
									{#if correction.explanation}
										<p class="text-sm leading-relaxed text-muted-foreground">{correction.explanation}</p>
									{/if}
									{#if correction.formalAlternatives.length > 0}
										<div class="mt-2 flex flex-wrap items-center gap-1.5">
											<span class="text-xs text-faint">Try instead</span>
											{#each correction.formalAlternatives as alternative (alternative)}
												<Badge variant="outline" class="font-normal">{alternative}</Badge>
											{/each}
										</div>
									{/if}
									<div class="mt-2 flex flex-wrap items-center gap-2">
										{#if correction.examStatus}
											<Badge
												variant={correction.examStatus === 'strictly-avoid' || correction.examStatus === 'avoid' ? 'destructive' : 'secondary'}
												class="text-[10px] tracking-wide uppercase"
											>{EXAM_BADGE[correction.examStatus] ?? correction.examStatus}</Badge>
										{/if}
										{#if correction.speakText || correction.replacement}
											<Button size="xs" variant="ghost" class="text-[var(--brand)]" onclick={() => void speakText(correction.speakText ?? correction.replacement)}>
												<Volume2 class="size-3.5" /> Hear it
											</Button>
										{/if}
									</div>
								</div>
							</Collapsible.Content>
						</Collapsible.Root>
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
		<Collapsible.Root bind:open={statsOpen}>
			<Collapsible.Trigger
				class="feedback-section-trigger flex h-9 w-full items-center justify-between gap-2 px-4 text-xs text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none sm:px-5"
				aria-label={statsOpen ? 'Collapse session stats' : 'Expand session stats'}
			>
				<span class="flex items-center gap-1.5 font-medium"><BarChart3 class="size-3.5" /> Session stats</span>
				<ChevronDown class="size-3.5 transition-transform duration-300 {statsOpen ? 'rotate-180' : ''}" />
			</Collapsible.Trigger>
			<Collapsible.Content class="stats-detail overflow-hidden">
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
			</Collapsible.Content>
		</Collapsible.Root>
	</div>
			</div>
		</Collapsible.Content>
	</Collapsible.Root>
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
	 * Severity tabs: the Exam / Casual control. A sea-glass channel pressed into
	 * the panel and one raised sheet knob that springs to the selected tab,
	 * whose label takes its severity colour. Tabs size to their label within a
	 * floor and a ceiling, so "All" stays narrow.
	 */
	:global(.severity-tabs) {
		container-type: inline-size;
	}
	:global(.feedback-tabs) {
		background-color: var(--control);
		box-shadow: var(--paper-deboss);
	}
	.tab-knob {
		position: absolute;
		top: 4px;
		bottom: 4px;
		left: 0;
		border-radius: 10px;
		background-color: var(--card);
		box-shadow: var(--paper-emboss-hover);
		opacity: 0;
		transition:
			translate 440ms cubic-bezier(0.34, 1.35, 0.64, 1),
			width 440ms cubic-bezier(0.34, 1.35, 0.64, 1),
			opacity 200ms ease;
	}
	.tab-knob.visible {
		opacity: 1;
	}
	:global(.feedback-tabs .feedback-tab) {
		position: relative;
		z-index: 1;
		flex: 1 1 auto;
		min-width: 40px;
		max-width: 104px;
		height: 100%;
		flex-direction: column;
		gap: 3px;
		padding-inline: 6px;
		border: 0;
		border-radius: 10px;
		background: transparent;
		box-shadow: none;
		color: var(--on-control);
		transition: color 240ms ease;
	}
	:global(.feedback-tabs .feedback-tab:hover) { color: var(--foreground); }
	:global(.feedback-tabs .feedback-tab[data-state='active']) { background: transparent; box-shadow: none; color: var(--foreground); }
	:global(.feedback-tabs .feedback-tab[data-severity='error'][data-state='active']) { color: var(--error); }
	:global(.feedback-tabs .feedback-tab[data-severity='warning'][data-state='active']) { color: var(--warn); }
	:global(.feedback-tabs .feedback-tab[data-severity='suggestion'][data-state='active']) { color: var(--brand); }
	:global(.feedback-tabs .feedback-tab-label) {
		display: block;
		max-width: 100%;
		overflow: hidden;
		font-size: 11px;
		font-weight: 500;
		line-height: 1;
		letter-spacing: -0.01em;
		white-space: nowrap;
	}
	:global(.filter-key) {
		box-shadow: var(--paper-emboss);
	}
	@container (max-width: 250px) {
		:global(.feedback-tabs .feedback-tab-label) { font-size: 10px; }
		:global(.feedback-tabs .feedback-tab) { padding-inline: 4px; }
	}

	:global(.coach-content[data-state='open']) {
		display: flex;
		animation: expand-coach 380ms cubic-bezier(0.22, 1, 0.36, 1);
	}

	:global(.coach-content[data-state='closed']) {
		display: flex;
		animation: collapse-coach 220ms cubic-bezier(0.4, 0, 1, 1);
	}

	@keyframes expand-coach {
		from { height: 0; opacity: 0; transform: translateY(-6px); }
		to { height: var(--bits-collapsible-content-height); opacity: 1; transform: translateY(0); }
	}

	@keyframes collapse-coach {
		from { height: var(--bits-collapsible-content-height); opacity: 1; }
		to { height: 0; opacity: 0; }
	}

	:global(.correction-detail[data-state='open']) {
		animation: expand-detail 320ms cubic-bezier(0.22, 1, 0.36, 1);
	}

	:global(.correction-detail[data-state='closed']) {
		animation: collapse-detail 180ms cubic-bezier(0.4, 0, 1, 1);
	}

	@keyframes expand-detail {
		from { height: 0; opacity: 0; transform: translateY(-4px); }
		to { height: var(--bits-collapsible-content-height); opacity: 1; transform: translateY(0); }
	}

	@keyframes collapse-detail {
		from { height: var(--bits-collapsible-content-height); opacity: 1; }
		to { height: 0; opacity: 0; }
	}

	:global(.stats-detail[data-state='open']) {
		animation: expand-detail 280ms cubic-bezier(0.22, 1, 0.36, 1);
	}

	:global(.stats-detail[data-state='closed']) {
		animation: collapse-detail 160ms cubic-bezier(0.4, 0, 1, 1);
	}

	@media (prefers-reduced-motion: reduce) {
		:global(.coach-content) { animation-duration: 1ms !important; }
		:global(.correction-detail) { animation-duration: 1ms !important; }
		:global(.stats-detail) { animation-duration: 1ms !important; }
	}

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
	@media (prefers-reduced-motion: reduce) {
		.tab-knob { transition-duration: 1ms; }
	}
</style>
