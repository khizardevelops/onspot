<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { getDatabaseAdapter, type Attempt, type Session } from '$lib/adapters/db';
	import { computeInsights, type InsightsData, type Occurrence } from '$lib/insights';
	import { openSession } from '$lib/stores/practice';
	import { toast } from '$lib/stores/toast';
	import { NeoButton } from '@dvcol/neo-svelte/buttons';
	import { NeoCard } from '@dvcol/neo-svelte/cards';
	import { NeoDivider } from '@dvcol/neo-svelte/divider';
	import { NeoPill } from '@dvcol/neo-svelte/pill';
	import { ArrowLeft, ChevronRight } from '@lucide/svelte';

	let data = $state<InsightsData | null>(null);
	let loading = $state(true);
	let selectedKey = $state<string | null>(null);
	let attemptIndex = $state<Record<string, number>>({});

	const selected = $derived(data?.patterns.find((pattern) => pattern.key === selectedKey) ?? null);

	const groups = $derived.by(() => {
		if (!selected) return [];
		const bySession = new Map<string, { session: Session | undefined; occurrences: Occurrence[] }>();
		for (const occurrence of selected.occurrences) {
			const key = occurrence.session?.id ?? 'unknown';
			let group = bySession.get(key);
			if (!group) {
				group = { session: occurrence.session, occurrences: [] };
				bySession.set(key, group);
			}
			group.occurrences.push(occurrence);
		}
		return [...bySession.values()];
	});

	onMount(async () => {
		const db = await getDatabaseAdapter();
		const [sessions, attempts, corrections] = await Promise.all([
			db.listSessions(),
			db.listAllAttempts(),
			db.listAllCorrections()
		]);
		data = computeInsights(sessions, attempts, corrections);

		const index: Record<string, number> = {};
		const grouped = new Map<string, Attempt[]>();
		for (const attempt of attempts) {
			const list = grouped.get(attempt.sessionId) ?? [];
			list.push(attempt);
			grouped.set(attempt.sessionId, list);
		}
		for (const list of grouped.values()) {
			list.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
			list.forEach((attempt, position) => (index[attempt.id] = position + 1));
		}
		attemptIndex = index;
		loading = false;
	});

	const CATEGORY_LABEL: Record<string, string> = {
		grammar: 'Grammar',
		register: 'Register',
		filler: 'Filler',
		style: 'Style'
	};

	const STATS = [
		{ key: 'sessions', label: 'Sessions' },
		{ key: 'speaking', label: 'Speaking' },
		{ key: 'words', label: 'Words' },
		{ key: 'errors', label: 'Mistakes' }
	] as const;

	function categoryClass(category: string): string {
		if (category === 'grammar') return 'text-[var(--error)]';
		if (category === 'style') return 'text-[var(--good)]';
		return 'text-[var(--warn)]';
	}

	function fmtDuration(seconds: number): string {
		const mins = Math.floor(seconds / 60);
		const secs = Math.round(seconds % 60);
		return `${mins}:${String(secs).padStart(2, '0')}`;
	}

	function fmtDate(iso: string): string {
		return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
	}

	async function open(sessionId: string) {
		await openSession(sessionId);
		toast('Session opened');
		await goto('/');
	}

	const examPatterns = $derived(data?.patterns ?? []);
	const grammarPatterns = $derived((data?.patterns ?? []).filter((p) => p.category === 'grammar'));
</script>

<svelte:head><title>Insights · onspot</title></svelte:head>

<div class="h-full overflow-y-auto">
	<div class="insights mx-auto max-w-4xl px-4 py-10 sm:px-8">
		{#if loading}
			<p class="text-sm text-muted-foreground">Loading…</p>
		{:else if selected}
			<NeoButton class="back-button mb-4" text rounded onclick={() => (selectedKey = null)}>
				{#snippet icon()}<ArrowLeft class="size-4" />{/snippet}
				All patterns
			</NeoButton>
			<h1 class="font-serif text-2xl font-medium">{selected.label}</h1>
			<p class="mb-6 text-sm text-muted-foreground">
				{selected.count} occurrence{selected.count === 1 ? '' : 's'} across
				{selected.sessionIds.length} session{selected.sessionIds.length === 1 ? '' : 's'}
			</p>

			<div class="flex flex-col gap-6">
				{#each groups as group (group.session?.id ?? 'unknown')}
					<div>
						<div class="mb-2.5 flex items-center gap-3 px-1">
							<NeoButton
								class="session-link font-serif text-base font-medium"
								text
								rounded
								onclick={() => group.session && open(group.session.id)}
							>
								{group.session?.title ?? 'Unknown session'}
							</NeoButton>
							<NeoDivider flex="1" aria-hidden="true" />
							<span class="text-xs text-faint">
								{group.session ? fmtDate(group.session.createdAt) : ''}
							</span>
						</div>
						<div class="flex flex-col gap-2">
							{#each group.occurrences as occurrence (occurrence.correction.id)}
								<NeoCard class="occurrence-card" glass rounded="1rem" elevation={2} spacing="0.875rem">
									<p class="mb-1 text-xs text-muted-foreground">
										Attempt {attemptIndex[occurrence.attempt.id] ?? '?'} ·
										{fmtDate(occurrence.attempt.createdAt)}
									</p>
									<p class="font-serif text-[15px]">
										{#if occurrence.correction.original}
											<span class="text-[var(--error)] line-through"
												>{occurrence.correction.original}</span
											>
											<span class="text-faint"> → </span>
										{/if}
										<span class="font-semibold">{occurrence.correction.replacement}</span>
									</p>
									<p class="mt-1 text-xs leading-relaxed text-muted-foreground">
										{occurrence.correction.explanation}
									</p>
								</NeoCard>
							{/each}
						</div>
					</div>
				{/each}
			</div>
		{:else if data}
			<h1 class="font-serif text-2xl font-medium">Insights</h1>
			<p class="mb-8 text-sm text-muted-foreground">
				Patterns across your sessions. Click one to see every occurrence.
			</p>

			<div class="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
				{#each STATS as stat (stat.key)}
					<NeoCard class="stat-card" glass rounded="1rem" elevation={2} spacing="1rem">
						<p class="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">{stat.label}</p>
						<p class="mt-1.5 font-serif text-[1.75rem] leading-tight {stat.key === 'errors' ? 'text-[var(--error)]' : ''}">
							{#if stat.key === 'sessions'}{data.totals.sessions}
							{:else if stat.key === 'speaking'}{fmtDuration(data.totals.speakingSeconds)}
							{:else if stat.key === 'words'}{data.totals.words}
							{:else}{data.totals.errors}{/if}
						</p>
					</NeoCard>
				{/each}
			</div>

			{#if data.patterns.length === 0}
				<div class="rounded-lg border border-dashed p-10 text-center">
					<p class="font-serif text-lg">No recurring patterns yet</p>
					<p class="mt-1 text-sm text-muted-foreground">
						Record a few attempts and they will show up here.
					</p>
				</div>
			{:else}
				<div class="grid gap-8 sm:grid-cols-2">
					<div>
						<h2 class="mb-3 flex items-center gap-3 px-1">
							<span class="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">Exam patterns</span>
							<NeoDivider flex="1" aria-hidden="true" />
							<span class="text-xs text-faint">Speaking mistakes to drill</span>
						</h2>
						<div class="flex flex-col gap-2">
							{#each examPatterns as pattern (pattern.key)}
								<NeoButton class="pattern-row" glass rounded="1rem" elevation={2} hover={1} onclick={() => (selectedKey = pattern.key)}>
									<div class="min-w-0">
										<p class="truncate font-serif text-sm font-medium">{pattern.label}</p>
										<p class="text-[10px] font-medium tracking-wider uppercase {categoryClass(
											pattern.category
										)}">{CATEGORY_LABEL[pattern.category] ?? pattern.category}</p>
									</div>
									<span class="flex shrink-0 items-center gap-2">
										<NeoPill class="count-chip" size="small" elevation={-1}>{pattern.count}</NeoPill>
										<ChevronRight class="size-4 text-faint" />
									</span>
								</NeoButton>
							{/each}
						</div>
					</div>

					<div>
						<h2 class="mb-3 flex items-center gap-3 px-1">
							<span class="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">Core grammar</span>
							<NeoDivider flex="1" aria-hidden="true" />
							<span class="text-xs text-faint">Errors first</span>
						</h2>
						<div class="flex flex-col gap-2">
							{#each grammarPatterns as pattern (pattern.key)}
								<NeoButton class="pattern-row" glass rounded="1rem" elevation={2} hover={1} onclick={() => (selectedKey = pattern.key)}>
									<p class="truncate font-serif text-sm font-medium">{pattern.label}</p>
									<span class="flex shrink-0 items-center gap-2">
										<NeoPill class="count-chip" size="small" elevation={-1}>{pattern.count}</NeoPill>
										<ChevronRight class="size-4 text-faint" />
									</span>
								</NeoButton>
							{/each}
						</div>
					</div>
				</div>
			{/if}
		{/if}
	</div>
</div>

<style>
	/* Cards and pattern rows fill their grid cell / column. */
	.insights :global(.neo-card.stat-card),
	.insights :global(.neo-card.occurrence-card) {
		width: 100%;
		align-items: stretch;
	}
	/* Pattern rows are full-width neo keys: label left, count and chevron right. */
	.insights :global(.neo-button.pattern-row) {
		width: 100%;
		padding: 0.75rem 1rem;
		text-align: left;
	}
	.insights :global(.neo-button.pattern-row > .neo-content) {
		width: 100%;
		justify-content: space-between;
		gap: 0.75rem;
	}
	.insights :global(.neo-button.pattern-row .neo-content > *:first-child) { min-width: 0; }
	/* A pattern's count, in the control colour: the row is clickable. */
	.insights :global(.neo-pill.count-chip) {
		min-width: 1.75rem;
		justify-content: center;
		color: var(--on-control);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.insights :global(.neo-button.back-button) { color: var(--muted-foreground); padding-inline: 0.5rem; }
	.insights :global(.neo-button.session-link) { padding-inline: 0.5rem; font-family: var(--font-serif); }
</style>
