<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

<script lang="ts">
	/**
	 * Feedback for the selected take, as a page of a notebook: a pinned sheet of
	 * card stock at the top holds the filters, each correction is a card taped in
	 * below it, and the session's stats slide up from the bottom when asked for.
	 * Closed, the panel slides away (it stays rendered, inert, so it can slide
	 * out whole) and the Practice page's bookmark ribbon opens it again (on
	 * phones, a button in the top bar).
	 */
	import { quickCollapse } from '#lib/neo.js';
	import { untrack } from 'svelte';
	import { flip } from 'svelte/animate';
	import { fade, fly } from 'svelte/transition';
	import type { Correction, CorrectionSeverity } from '#lib/adapters/db/index.js';
	import type { AttemptView } from '#lib/stores/practice.js';
	import { speakText } from '#lib/stores/practice.js';
	import { correctionTitle, isDeletion, isInsertion } from '#lib/utils/corrections.js';
	import { parseExplanation } from '#lib/adapters/llm/index.js';
	import { NeoButton } from '@dvcol/neo-svelte/buttons';
	import { NeoCollapse } from '@dvcol/neo-svelte/collapse';
	import { NeoTab, NeoTabs } from '@dvcol/neo-svelte/nav';
	import type { NeoMenuItem } from '@dvcol/neo-svelte/floating/menu';
	import PopMenu from '#lib/components/PopMenu.svelte';
	import {
		ArrowRight,
		ChartNoAxesColumn,
		Check,
		ChevronDown,
		CircleX,
		Lightbulb,
		List,
		ListFilter,
		MessageSquareText,
		PanelRightClose,
		TriangleAlert,
		Volume2
	} from '@lucide/svelte';

	type Severity = 'error' | 'warning' | 'suggestion';
	type Category = 'grammar' | 'register' | 'filler' | 'style';
	type Filter = 'all' | Severity | Category;

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
	let filterMenuOpen = $state(false);

	const CATEGORIES: Category[] = ['grammar', 'register', 'filler', 'style'];

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

	/** What the header says is showing. */
	const FILTER_LABEL: Record<Filter, string> = {
		all: 'All feedback',
		error: 'Errors',
		warning: 'Warnings',
		suggestion: 'Suggestions',
		grammar: 'Grammar',
		register: 'Register',
		filler: 'Fillers',
		style: 'Style'
	};

	/** The icon-only filter track; the name of the one pressed shows beside it. */
	const SEVERITY_FILTERS = [
		{ id: 'all', label: 'All feedback', icon: List },
		{ id: 'error', label: 'Errors', icon: CircleX },
		{ id: 'warning', label: 'Warnings', icon: TriangleAlert },
		{ id: 'suggestion', label: 'Suggestions', icon: Lightbulb }
	] as const;

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
		return Object.fromEntries(
			CATEGORIES.map((category) => [category, list.filter((item) => item.category === category).length])
		) as Record<Category, number>;
	});

	const corrections = $derived.by(() => {
		const list = [...(attempt?.corrections ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
		if (filter === 'all') return list;
		if (filter === 'error' || filter === 'warning' || filter === 'suggestion') {
			return list.filter((item) => item.severity === filter);
		}
		return list.filter((item) => item.category === filter);
	});

	const STATS = $derived([
		{ label: 'Takes', value: String(stats.attempts) },
		{ label: 'Words', value: String(stats.words) },
		{ label: 'Time', value: fmtTime(stats.time) },
		{ label: 'Errors', value: String(stats.errors), alert: stats.errors > 0 }
	]);

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

	/** The header's name opens the filter by type (grammar, register, …). */
	const filterItems = $derived<NeoMenuItem[]>([
		{ value: 'all', label: 'All feedback', after: filterCount, divider: { bottom: true } },
		{
			value: 'type',
			label: 'Feedback type',
			section: true,
			items: CATEGORIES.map((category) => ({
				value: category,
				label: CATEGORY_LABEL[category],
				after: filterCount,
				color: filter === category ? 'primary' : undefined
			}))
		}
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

{#snippet filterCount({ item }: { item: { value: unknown } })}
	{@const value = item.value as Filter}
	<span class="flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
		{value === 'all' ? counts.all : categoryCounts[value as Category]}
		{#if filter === value}<Check class="size-3.5 text-[var(--primary)]" />{/if}
	</span>
{/snippet}

<aside
	class="feedback-shell relative flex min-h-0 flex-col overflow-hidden border-t lg:border-t-0 lg:border-l"
	data-state={open ? 'open' : 'closed'}
	inert={!open}
>
		<!-- The pinned sheet, casting its shadow over the cards below. -->
		<!--
			One toolbar on the pinned sheet: what is showing (and the by-type menu)
			on the left; on the right, the severity filter and the panel's two
			actions, all the same height on one line.
		-->
		<header class="feedback-paper">
			<PopMenu items={filterItems} bind:open={filterMenuOpen} placement="bottom-start" onSelect={onFilterSelect} rounded>
				<button type="button" class="filter-name" aria-label={`Showing ${FILTER_LABEL[filter]}. Filter by type`} aria-expanded={filterMenuOpen}>
					<ListFilter class="filter-name-icon size-4 shrink-0" />
					{#key filter}<span class="filter-name-label truncate" in:fade={{ duration: 150 }}>{FILTER_LABEL[filter]}</span>{/key}
					<ChevronDown class="size-3.5 shrink-0 opacity-60" />
				</button>
			</PopMenu>

			<!-- neo tabs: an inset track; each segment is an icon with its count beside it, the chosen one raised. -->
			<div class="filter-track custom-selection">
				<NeoTabs
					active={filter === 'all' || filter === 'error' || filter === 'warning' || filter === 'suggestion' ? filter : undefined}
					onchange={(id) => {
						// A by-type filter leaves no tab active; neo echoes that as `undefined`.
						if (id) filter = id as Filter;
					}}
					aria-label="Filter feedback by severity"
					elevation={-2}
					rounded
					dim={false}
				>
					{#each SEVERITY_FILTERS as option (option.id)}
						{@const Icon = option.icon}
						{@const count = counts[option.id]}
						<NeoTab
							tabId={option.id}
							data-severity={option.id}
							title={option.label}
							aria-label={`${option.label}: ${count}`}
							tabProps={{ class: `filter-key${count === 0 ? ' empty' : ''}` }}
						>
							<span class="filter-segment" aria-hidden="true">
								<Icon size={14} strokeWidth={2.2} />
								<span class="filter-count">{count}</span>
							</span>
						</NeoTab>
					{/each}
				</NeoTabs>
			</div>

			<span class="toolbar-divider" aria-hidden="true"></span>

			<div class="toolbar-actions">
				<NeoButton
					text
					rounded
					class="toolbar-action {statsOpen ? 'is-selected' : ''}"
					aria-label={statsOpen ? 'Hide session stats' : 'Show session stats'}
					aria-expanded={statsOpen}
					aria-controls="session-stats"
					title="Session stats"
					onclick={() => (statsOpen = !statsOpen)}
				>
					{#snippet icon()}<ChartNoAxesColumn size={16} strokeWidth={2.2} />{/snippet}
				</NeoButton>
				<NeoButton text rounded class="toolbar-action" aria-label="Close feedback" title="Close" onclick={() => (open = false)}>
					{#snippet icon()}
						<PanelRightClose class="close-rail-icon" size={16} />
						<ChevronDown class="close-sheet-icon" size={16} />
					{/snippet}
				</NeoButton>
			</div>
		</header>

		<div class="feedback-list" class:stats-room={statsOpen}>
			{#if !attempt}
				<div class="list-note" in:fade={{ duration: 240 }}>
					<MessageSquareText class="size-5" />
					<p class="font-medium text-foreground">Feedback lives here</p>
					<p>Select an attempt after your first recording.</p>
				</div>
			{:else if attempt.corrections.length === 0}
				<div class="list-note" in:fade={{ duration: 280 }}>
					<span class="clean-mark grid place-items-center"><Check class="size-5" /></span>
					<p class="font-medium text-foreground">Clean take</p>
					<p>Nothing needs correcting.</p>
				</div>
			{:else if corrections.length === 0}
				<p class="list-note" in:fade={{ duration: 180 }}>Nothing in this filter.</p>
			{:else}
				<ul class="feedback-cards">
					{#each corrections as correction (correction.id)}
						{@const expanded = expandedId === correction.id}
						<li
							data-correction-id={correction.id}
							animate:flip={{ duration: 220 }}
							in:fly={{ y: 8, duration: 220 }}
							out:fade={{ duration: 120 }}
							class="feedback-card"
							class:expanded
							class:linked={correction.id === activeCorrectionId}
						>
							<button type="button" class="card-summary" aria-expanded={expanded} onclick={() => select(correction, !expanded)}>
								<span class="card-tags">
									<span class="tag">{CATEGORY_LABEL[correction.category] ?? correction.category}</span>
									<span class="severity" data-severity={correction.severity}>{SEVERITY_LABEL[correction.severity]}</span>
									<ChevronDown class="card-chevron size-4" />
								</span>
								<span class="card-title">{correctionTitle(correction)}</span>

								<!-- One line: what was said, struck through, then what to say. -->
								<span class="correction-line">
									{#if isDeletion(correction)}
										<span class="wrong-text">{correction.original}</span>
										<span class="tag tag-remove">Remove</span>
									{:else if isInsertion(correction)}
										<span class="tag tag-add">Add</span>
										<span class="right-text">{correction.replacement}</span>
									{:else}
										<span class="wrong-text">{correction.original}</span>
										<ArrowRight class="size-3.5 shrink-0 opacity-50" />
										<span class="right-text">{correction.replacement}</span>
									{/if}
								</span>
								{#if correction.replacementTranslation && !isDeletion(correction)}
									<span class="card-gloss" dir="auto">{correction.replacementTranslation}</span>
								{/if}
							</button>

							<NeoCollapse transition={quickCollapse} open={expanded} standalone>
								<div class="card-details">
									<!-- The model marks words in explanations as it does on the card; show them, never the tags. -->
									{#if correction.explanation}
										<p dir="auto">
											{#each parseExplanation(correction.explanation) as part, position (position)}
												{#if part.highlight === 'wrong'}<s class="mark-wrong">{part.text}</s>{:else if part.highlight}<strong class="mark-word">{part.text}</strong>{:else}{part.text}{/if}
											{/each}
										</p>
									{/if}
									{#if correction.formalAlternatives.length > 0}
										<div class="mt-2 flex flex-wrap items-center gap-1.5">
											<span class="text-xs text-faint">Try instead</span>
											{#each correction.formalAlternatives as alternative (alternative)}
												<span class="tag">{alternative}</span>
											{/each}
										</div>
									{/if}
									<div class="mt-2 flex flex-wrap items-center gap-3">
										{#if correction.examStatus}
											<span class="tag" class:tag-remove={correction.examStatus === 'strictly-avoid' || correction.examStatus === 'avoid'}>
												{EXAM_BADGE[correction.examStatus] ?? correction.examStatus}
											</span>
										{/if}
										{#if correction.speakText || correction.replacement}
											<button type="button" class="pencil-link gap-1" onclick={() => void speakText(correction.speakText ?? correction.replacement)}>
												<Volume2 class="size-3.5" /> Hear it
											</button>
										{/if}
									</div>
								</div>
							</NeoCollapse>
						</li>
					{/each}
				</ul>
			{/if}
		</div>

		<!-- Takes no room until asked for; then it slides up over the bottom of the list. -->
		<section id="session-stats" class="stats-sheet" class:open={statsOpen} aria-label="Session stats" inert={!statsOpen}>
			<div class="stats-header">
				<span>Session stats</span>
				<button type="button" class="stats-close" aria-label="Hide session stats" onclick={() => (statsOpen = false)}>
					<ChevronDown size={16} strokeWidth={2.5} />
				</button>
			</div>
			<div class="stats-row">
				{#each STATS as stat (stat.label)}
					<div class="stat-card">
						<span class="stat-label">{stat.label}</span>
						<span class="stat-value" class:alert={stat.alert}>{stat.value}</span>
					</div>
				{/each}
			</div>
		</section>
</aside>

<style>
	/*
	 * A notebook page: warm paper with grain, a red margin line and binder
	 * holes on the left. Everything written on it starts right of the margin.
	 */
	.feedback-shell {
		--notebook: var(--background);
		--pinned-paper: #fcfaf5;
		--card-paper: #ffffff;
		--ink: var(--foreground);
		--ruled-blue: rgb(43 91 132 / 0.26);
		--margin-red: rgb(229 168 161 / 0.75);
		--binder-hole: #c5c0b4;
		--neu-dark: #dcd7cb;
		--neu-light: #ffffff;
		--pinned-shadow: 0 12px 24px rgb(0 0 0 / 0.12), 0 4px 8px rgb(0 0 0 / 0.06), 0 2px 4px rgb(0 0 0 / 0.04);
		--card-shadow: 0 8px 16px rgb(0 0 0 / 0.08), 0 2px 4px rgb(0 0 0 / 0.04), 0 0 0 1px rgb(0 0 0 / 0.03);
		--card-shadow-lifted: 0 12px 24px rgb(0 0 0 / 0.12), 0 4px 8px rgb(0 0 0 / 0.06), 0 0 0 1px rgb(0 0 0 / 0.03);
		--tape: rgb(240 235 220 / 0.85);
		--label-tape: rgb(249 244 231 / 0.97);
		--stat-edge: rgb(120 100 70 / 0.22);
		--grain: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.07'/%3E%3C/svg%3E");
		/* A narrow margin: the holes and the red line, then the content, as close as they look right. */
		--margin-at: 20px;
		--content-start: 28px;

		background-color: var(--notebook);
		background-image: var(--grain);
	}
	:global([data-theme='dark']) .feedback-shell {
		--pinned-paper: #24211c;
		--card-paper: #2b2823;
		--ruled-blue: rgb(140 170 210 / 0.12);
		--margin-red: rgb(229 140 130 / 0.38);
		--binder-hole: #0d0c0a;
		--neu-dark: rgb(0 0 0 / 0.6);
		--neu-light: rgb(255 240 215 / 0.06);
		--pinned-shadow: 0 12px 24px rgb(0 0 0 / 0.45), 0 4px 8px rgb(0 0 0 / 0.3);
		--card-shadow: 0 8px 16px rgb(0 0 0 / 0.35), 0 2px 4px rgb(0 0 0 / 0.25), 0 0 0 1px rgb(255 240 215 / 0.04);
		--card-shadow-lifted: 0 12px 24px rgb(0 0 0 / 0.45), 0 4px 8px rgb(0 0 0 / 0.3), 0 0 0 1px rgb(255 240 215 / 0.05);
		--tape: rgb(200 185 150 / 0.3);
		--label-tape: rgb(92 84 68 / 0.96);
		--stat-edge: rgb(255 240 215 / 0.1);
	}
	:global([data-theme='dark']) .stats-sheet {
		background-color: color-mix(in srgb, var(--notebook) 92%, #000);
	}
	:global([data-theme='dark']) .stat-card {
		box-shadow:
			inset 0 1px 0 rgb(255 240 215 / 0.06),
			0 1px 1px rgb(0 0 0 / 0.4),
			0 4px 8px -2px rgb(0 0 0 / 0.5),
			0 10px 18px -8px rgb(0 0 0 / 0.55);
	}
	.feedback-shell[data-state='open']::before {
		content: '';
		position: absolute;
		top: 0;
		bottom: 0;
		left: var(--margin-at);
		z-index: 1;
		width: 2px;
		background-color: var(--margin-red);
		pointer-events: none;
	}
	.feedback-shell[data-state='open']::after {
		content: '';
		position: absolute;
		top: 0;
		bottom: 0;
		left: 4px;
		z-index: 1;
		width: 10px;
		background-image: radial-gradient(circle, var(--binder-hole) 3.5px, transparent 4.5px);
		background-size: 10px 34px;
		background-position: 0 20px;
		background-repeat: repeat-y;
		filter: drop-shadow(1px 1px 0 rgb(255 255 255 / 0.6));
		pointer-events: none;
	}

	/* ------------------------------------------------------------------ The pinned sheet */

	.feedback-paper {
		position: relative;
		z-index: 20;
		display: flex;
		flex-shrink: 0;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.625rem 0.5rem var(--content-start);
		border-bottom: 2px solid rgb(0 0 0 / 0.08);
		border-radius: 0 0 2px 2px;
		background-color: var(--pinned-paper);
		background-image:
			var(--grain),
			repeating-linear-gradient(to bottom, transparent 0 24px, var(--ruled-blue) 24px 25px);
		box-shadow: var(--pinned-shadow);
	}
	.feedback-paper::before {
		content: '';
		position: absolute;
		top: 0;
		bottom: 0;
		left: var(--margin-at);
		width: 2px;
		background-color: var(--margin-red);
	}

	/* Every control in the toolbar is this tall, and they share one centre line. */
	.feedback-paper {
		--toolbar-height: 32px;
		--segment-width: 34px;
		container-type: inline-size;
		gap: 5px;
	}
	/* Touch screens: the app's touch floor (see app.css) for every control alike. */
	@media (pointer: coarse) {
		.feedback-paper {
			--toolbar-height: var(--touch-target, 36px);
		}
	}

	/* The name of what is showing; it also opens the filter by type. */
	.filter-name {
		position: relative;
		z-index: 2;
		display: inline-flex;
		flex: 0 1 auto;
		align-items: center;
		gap: 3px;
		min-width: 0;
		height: var(--toolbar-height);
		padding: 0 1px 0 0;
		isolation: isolate;
		border: 0;
		background: none;
		color: var(--ink);
		/* Written like a heading on the page: the app's serif, as in the takes. */
		font-family: var(--font-serif);
		font-size: 0.875rem;
		font-weight: 600;
		letter-spacing: -0.005em;
		text-align: left;
		cursor: pointer;
	}
	.filter-name :global(.filter-name-icon) {
		display: none;
		color: var(--muted-foreground);
	}
	/*
	 * A strip of masking tape under the label, so the text sits on the tape
	 * rather than across the sheet's ruled lines: opaque enough to hide them.
	 * Crepe tape: fine creases across its width, paper grain, a soft sheen,
	 * torn ends, a slight tilt and a lift. It reaches a little past the button
	 * into the gaps around it, so it costs the label no room.
	 */
	.filter-name::before {
		content: '';
		position: absolute;
		inset: 4px -6px 4px -8px;
		z-index: -1;
		background-color: var(--label-tape);
		background-image:
			linear-gradient(180deg, rgb(255 255 255 / 0.4), transparent 45%, rgb(80 60 30 / 0.06)),
			url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='40'%3E%3Cfilter id='c'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.7 0.03' numOctaves='2' seed='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23c)' opacity='0.32'/%3E%3C/svg%3E"),
			url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='1.1' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23g)' opacity='0.3'/%3E%3C/svg%3E");
		background-size: auto, 160px 40px, 120px 120px;
		background-blend-mode: normal, multiply, multiply;
		box-shadow:
			0 1px 1px rgb(60 45 20 / 0.12),
			0 2px 4px -1px rgb(60 45 20 / 0.14);
		transform: rotate(-1deg);
		clip-path: polygon(
			3px 0, calc(100% - 2px) 0, 100% 18%, calc(100% - 3px) 36%, 100% 54%, calc(100% - 2px) 72%, 100% 90%,
			calc(100% - 3px) 100%, 2px 100%, 0 84%, 3px 66%, 0 48%, 2px 30%, 0 12%
		);
	}
	/* The menu's trigger wrapper must shrink too, or a narrow panel spills sideways. */
	.feedback-paper :global(.neo-tooltip-trigger) {
		display: flex;
		flex: 1 1 0;
		min-width: 0;
		align-items: center;
	}

	/*
	 * The severity filter: neo tabs, an inset rounded track with the chosen
	 * segment raised (neo's own tab states). Each segment is the same width, an
	 * icon with its count beside it in one ink; the chosen one takes its
	 * severity's colour, and an empty one fades.
	 */
	.filter-track {
		position: relative;
		z-index: 2;
		flex-shrink: 0;
	}
	.filter-track :global(.neo-tabs .neo-tabs-group) {
		height: var(--toolbar-height);
		min-height: var(--toolbar-height);
		gap: 2px;
		padding: 3px;
		border-radius: 999px;
		flex-wrap: nowrap;
		align-items: stretch;
	}
	/* neo puts the tab's class on its wrapper and the attributes on the button inside it. */
	.filter-track :global(.neo-tab.filter-key) {
		width: var(--segment-width);
		height: 100%;
	}
	.filter-track :global(.neo-tab.filter-key .neo-tab-button) {
		width: 100%;
		height: 100%;
		min-width: 0;
		min-height: 0;
		padding: 0;
		justify-content: center;
		border-radius: 999px;
		color: var(--muted-foreground);
	}
	.filter-segment {
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}
	.filter-count {
		min-width: 0.6em;
		font-size: 11px;
		font-weight: 700;
		line-height: 1;
		font-variant-numeric: tabular-nums;
		text-align: left;
	}
	.filter-track :global(.neo-tab.filter-key.empty .filter-segment) {
		opacity: 0.5;
	}
	.filter-track :global(.neo-tab.filter-key.neo-active .neo-tab-button) {
		color: var(--ink);
	}
	.filter-track :global(.neo-tab.neo-active .neo-tab-button[data-severity='error']) {
		color: var(--error);
	}
	.filter-track :global(.neo-tab.neo-active .neo-tab-button[data-severity='warning']) {
		color: var(--warn);
	}
	.filter-track :global(.neo-tab.neo-active .neo-tab-button[data-severity='suggestion']) {
		color: var(--brand);
	}

	/* The panel's own actions, apart from the filter: the same flat neo buttons, the same size. */
	.toolbar-divider {
		position: relative;
		z-index: 2;
		flex-shrink: 0;
		width: 1px;
		height: 20px;
		background-color: color-mix(in srgb, var(--muted-foreground) 30%, transparent);
	}
	.toolbar-actions {
		position: relative;
		z-index: 2;
		display: flex;
		flex-shrink: 0;
		align-items: center;
		gap: 2px;
	}
	.toolbar-actions :global(.neo-button.toolbar-action) {
		width: var(--toolbar-height);
		height: var(--toolbar-height);
		min-width: var(--toolbar-height);
		min-height: var(--toolbar-height);
		padding: 0;
		justify-content: center;
		color: var(--muted-foreground);
	}
	.toolbar-actions :global(.neo-button.toolbar-action.is-selected) {
		color: var(--primary);
	}
	/* Desktop closes into the bookmark on the right; smaller screens close downwards. */
	.toolbar-actions :global(.close-sheet-icon) {
		display: none;
	}
	@media (max-width: 1023px) {
		.toolbar-actions :global(.close-rail-icon) {
			display: none;
		}
		.toolbar-actions :global(.close-sheet-icon) {
			display: block;
		}
	}

	/*
	 * A narrow desktop panel (1024px windows): the filter's name gives way to
	 * its icon, and below 300px the segments tighten and the divider goes, so
	 * the toolbar never crowds or truncates.
	 */
	@media (min-width: 641px) {
		@container (width < 340px) {
			.filter-name :global(.filter-name-icon) {
				display: block;
			}
			.filter-name :global(.filter-name-label) {
				display: none;
			}
			.filter-name {
				flex: 0 0 auto;
			}
			.feedback-paper :global(.neo-tooltip-trigger) {
				flex: 0 0 auto;
				margin-right: auto;
			}
		}
		@container (width < 300px) {
			.filter-track :global(.neo-tab.filter-key) {
				width: 32px;
			}
			.toolbar-divider {
				display: none;
			}
		}
	}

	/*
	 * Phones: two rows, so the filter's name always fits. The name, stats and
	 * close share the first row; the severity filter spans the second, its
	 * segments sharing the width evenly.
	 */
	@media (max-width: 640px) {
		.feedback-paper {
			flex-wrap: wrap;
			row-gap: 6px;
		}
		.filter-track {
			order: 10;
			flex-basis: 100%;
		}
		.filter-track :global(.neo-tabs),
		.filter-track :global(.neo-tabs .neo-tabs-group) {
			width: 100%;
		}
		.filter-track :global(.neo-tab.filter-key) {
			flex: 1 1 0;
			width: auto;
		}
		.toolbar-divider {
			display: none;
		}
	}

	/* ------------------------------------------------------------------ The taped-in cards */

	.feedback-list {
		position: relative;
		z-index: 2;
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 0.5rem 0.875rem 1.5rem var(--content-start);
		scrollbar-width: thin;
		transition: padding-bottom 0.3s ease;
	}
	/* Room to scroll the last card out from under the open stats. */
	.feedback-list.stats-room {
		padding-bottom: 8rem;
	}
	.feedback-cards {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.feedback-card {
		position: relative;
		margin: 0.875rem 0;
		border-radius: 4px;
		background-color: var(--card-paper);
		box-shadow: var(--card-shadow);
		transition:
			box-shadow 0.2s ease,
			transform 0.2s ease;
	}
	.feedback-card.expanded {
		box-shadow: var(--card-shadow-lifted);
		transform: translateY(-2px);
	}
	/* The correction picked in the transcript. */
	.feedback-card.linked {
		outline: 1.5px solid color-mix(in srgb, var(--brand) 70%, transparent);
		outline-offset: 2px;
	}
	/* Masking tape holding the card in; alternate cards are taped a little off-centre. */
	.feedback-card::before {
		content: '';
		position: absolute;
		top: -11px;
		left: 50%;
		z-index: 1;
		width: 64px;
		height: 22px;
		border-right: 1px solid rgb(0 0 0 / 0.05);
		border-left: 1px solid rgb(255 255 255 / 0.4);
		background-color: var(--tape);
		box-shadow: 0 2px 4px rgb(0 0 0 / 0.08);
		transform: translateX(-50%) rotate(-2deg);
		pointer-events: none;
	}
	.feedback-card:nth-child(even)::before {
		left: 40%;
		transform: translateX(-50%) rotate(1.5deg);
	}

	.card-summary {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		width: 100%;
		padding: 0.75rem 0.875rem;
		border: 0;
		background: transparent;
		color: var(--ink);
		text-align: left;
		cursor: pointer;
	}
	.card-tags {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.card-tags :global(.card-chevron) {
		margin-left: auto;
		color: var(--muted-foreground);
		transition: transform 0.3s ease;
	}
	.feedback-card.expanded .card-tags :global(.card-chevron) {
		transform: rotate(180deg);
	}
	.tag {
		padding: 2px 8px;
		border-radius: 999px;
		background-color: color-mix(in srgb, var(--muted-foreground) 13%, transparent);
		color: color-mix(in srgb, var(--ink) 70%, var(--muted-foreground));
		font-size: 9px;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}
	.tag-remove {
		background-color: var(--error-soft);
		color: var(--error);
	}
	.tag-add {
		background-color: var(--good-soft);
		color: var(--good);
	}
	.severity {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		font-size: 9px;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}
	.severity::before {
		content: '';
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background-color: currentColor;
	}
	.severity[data-severity='error'] {
		color: var(--error);
	}
	.severity[data-severity='warning'] {
		color: var(--warn);
	}
	.severity[data-severity='suggestion'] {
		color: var(--brand);
	}
	.card-title {
		font-size: 0.9375rem;
		font-weight: 700;
		line-height: 1.3;
	}
	.correction-line {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.375rem;
		font-size: 0.875rem;
		line-height: 1.3;
	}
	.wrong-text {
		opacity: 0.6;
		text-decoration: line-through;
		text-decoration-thickness: 1.5px;
		text-decoration-color: var(--error);
	}
	.right-text {
		font-weight: 600;
	}
	.card-gloss {
		color: var(--muted-foreground);
		font-size: 0.75rem;
	}
	.card-details {
		padding: 0.75rem 0.875rem;
		border-top: 1px solid color-mix(in srgb, var(--muted-foreground) 15%, transparent);
		border-radius: 0 0 4px 4px;
		background-color: color-mix(in srgb, var(--notebook) 35%, var(--card-paper));
		color: var(--muted-foreground);
		font-size: 0.8125rem;
		line-height: 1.45;
	}

	.mark-word {
		color: var(--ink);
		font-family: var(--font-serif);
		font-weight: 600;
	}
	.mark-wrong {
		text-decoration-color: var(--error);
	}

	.list-note {
		display: grid;
		justify-items: center;
		gap: 0.375rem;
		padding: 2.5rem 1rem;
		color: var(--muted-foreground);
		font-size: 0.875rem;
		text-align: center;
	}
	.clean-mark {
		width: 2.75rem;
		height: 2.75rem;
		margin-bottom: 0.25rem;
		border-radius: 1rem;
		background-color: var(--good-soft);
		color: var(--good);
	}

	/* ------------------------------------------------------------------ Session stats */

	.stats-sheet {
		position: absolute;
		right: 0;
		bottom: 0;
		left: 0;
		z-index: 30;
		padding: 1.125rem 0.875rem 0.875rem var(--content-start);
		border-radius: 14px 14px 0 0;
		/* The darker notebook paper, so the white stat cards stand out of it. */
		background-color: color-mix(in srgb, var(--notebook) 88%, #8a7a5c);
		background-image:
			var(--grain),
			repeating-linear-gradient(to bottom, transparent 0 24px, color-mix(in srgb, var(--ruled-blue) 40%, transparent) 24px 25px);
		box-shadow:
			0 -1px 0 rgb(255 255 255 / 0.5),
			0 -10px 30px rgb(0 0 0 / 0.15);
		transform: translateY(100%);
		transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
	}
	.stats-sheet.open {
		transform: translateY(0);
	}
	/* The sheet's grip. */
	.stats-sheet::before {
		content: '';
		position: absolute;
		top: 6px;
		left: 50%;
		width: 36px;
		height: 4px;
		border-radius: 3px;
		background-color: color-mix(in srgb, var(--muted-foreground) 35%, transparent);
		transform: translateX(-50%);
	}
	.stats-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.625rem;
		color: var(--ink);
		font-size: 0.75rem;
		font-weight: 700;
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}
	.stats-close {
		display: grid;
		place-items: center;
		width: 28px;
		height: 28px;
		border: 0;
		background: none;
		color: var(--ink);
		cursor: pointer;
	}
	.stats-row {
		display: flex;
		gap: 0.5rem;
	}
	/* White card stock lifted off the sheet: a hairline edge, a lit top, a layered shadow. */
	.stat-card {
		display: flex;
		flex: 1;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		min-width: 0;
		padding: 0.5rem 0.25rem;
		border: 1px solid var(--stat-edge);
		border-radius: 6px;
		background-color: var(--card-paper);
		box-shadow:
			inset 0 1px 0 rgb(255 255 255 / 0.9),
			0 1px 1px rgb(60 50 35 / 0.12),
			0 4px 8px -2px rgb(60 50 35 / 0.22),
			0 10px 18px -8px rgb(60 50 35 / 0.25);
	}
	.stat-label {
		color: var(--muted-foreground);
		font-size: 9px;
		font-weight: 700;
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}
	.stat-value {
		color: var(--ink);
		font-family: 'Courier Prime', 'Courier New', Courier, monospace;
		font-size: 0.9375rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	.stat-value.alert {
		color: var(--error);
	}

	/* ------------------------------------------------------------------ Depth */

	/*
	 * The panel is a sheet lying over the takes: it casts a soft shadow onto
	 * them (to the left on desktop, upwards when it sits below them on tablets).
	 * Phones show it as a floating sheet, which has its own shadow.
	 */
	@media (min-width: 1024px) {
		.feedback-shell {
			z-index: 15;
			box-shadow:
				-1px 0 0 rgb(60 50 35 / 0.08),
				-18px 0 34px -10px rgb(60 50 35 / 0.38),
				-5px 0 10px -3px rgb(60 50 35 / 0.2);
		}
		:global([data-theme='dark']) .feedback-shell {
			box-shadow:
				-14px 0 28px -12px rgb(0 0 0 / 0.7),
				-4px 0 8px -4px rgb(0 0 0 / 0.5);
		}
	}
	@media (min-width: 641px) and (max-width: 1023px) {
		.feedback-shell {
			z-index: 15;
			box-shadow:
				0 -18px 34px -10px rgb(60 50 35 / 0.38),
				0 -5px 10px -3px rgb(60 50 35 / 0.2);
		}
		:global([data-theme='dark']) .feedback-shell {
			box-shadow: 0 -14px 28px -12px rgb(0 0 0 / 0.7);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.feedback-card,
		.stats-sheet,
		.feedback-list {
			transition-duration: 1ms;
		}
	}
</style>
