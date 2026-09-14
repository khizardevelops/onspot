<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { getDatabaseAdapter, type Attempt, type Session } from '$lib/adapters/db';
	import { computeInsights, type InsightsData, type Occurrence } from '$lib/insights';
	import { openSession } from '$lib/stores/practice';
	import { toast } from '$lib/stores/toast';
	import { ArrowLeft } from '@lucide/svelte';

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
	<div class="mx-auto max-w-4xl px-8 py-10">
		{#if loading}
			<p class="text-sm text-muted-foreground">Loading…</p>
		{:else if selected}
			<button
				type="button"
				class="mb-4 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
				onclick={() => (selectedKey = null)}
			>
				<ArrowLeft class="size-4" /> All patterns
			</button>
			<h1 class="font-serif text-2xl font-medium">{selected.label}</h1>
			<p class="mb-6 text-sm text-muted-foreground">
				{selected.count} occurrence{selected.count === 1 ? '' : 's'} across
				{selected.sessionIds.length} session{selected.sessionIds.length === 1 ? '' : 's'}
			</p>

			<div class="flex flex-col gap-6">
				{#each groups as group (group.session?.id ?? 'unknown')}
					<div>
						<div class="mb-2 flex items-baseline justify-between border-b pb-1.5">
							<button
								type="button"
								class="font-serif text-base font-medium hover:text-[var(--brand)]"
								onclick={() => group.session && open(group.session.id)}
							>
								{group.session?.title ?? 'Unknown session'}
							</button>
							<span class="text-xs text-muted-foreground">
								{group.session ? fmtDate(group.session.createdAt) : ''}
							</span>
						</div>
						<div class="flex flex-col gap-2">
							{#each group.occurrences as occurrence (occurrence.correction.id)}
								<div class="rounded-lg border bg-card p-3">
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
								</div>
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
				<div class="rounded-lg border bg-card p-4">
					<p class="text-[11px] font-medium tracking-widest text-faint uppercase">Sessions</p>
					<p class="mt-2 font-serif text-2xl">{data.totals.sessions}</p>
				</div>
				<div class="rounded-lg border bg-card p-4">
					<p class="text-[11px] font-medium tracking-widest text-faint uppercase">Speaking</p>
					<p class="mt-2 font-serif text-2xl">{fmtDuration(data.totals.speakingSeconds)}</p>
				</div>
				<div class="rounded-lg border bg-card p-4">
					<p class="text-[11px] font-medium tracking-widest text-faint uppercase">Words</p>
					<p class="mt-2 font-serif text-2xl">{data.totals.words}</p>
				</div>
				<div class="rounded-lg border bg-card p-4">
					<p class="text-[11px] font-medium tracking-widest text-faint uppercase">Mistakes</p>
					<p class="mt-2 font-serif text-2xl text-[var(--error)]">{data.totals.errors}</p>
				</div>
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
						<div class="mb-3 flex items-baseline justify-between border-b pb-2">
							<h2 class="text-[11px] font-bold tracking-widest uppercase">Exam patterns</h2>
							<span class="text-[10.5px] text-faint">Speaking mistakes to drill</span>
						</div>
						<div class="flex flex-col gap-2">
							{#each examPatterns as pattern (pattern.key)}
								<button
									type="button"
									class="flex items-center justify-between gap-3 rounded-lg border bg-card p-3 text-left transition-shadow hover:shadow-sm"
									onclick={() => (selectedKey = pattern.key)}
								>
									<div class="min-w-0">
										<p class="truncate font-serif text-sm font-medium">{pattern.label}</p>
										<p class="text-[10px] font-medium tracking-wider uppercase {categoryClass(
											pattern.category
										)}">{CATEGORY_LABEL[pattern.category] ?? pattern.category}</p>
									</div>
									<span class="shrink-0 font-serif text-lg">{pattern.count}</span>
								</button>
							{/each}
						</div>
					</div>

					<div>
						<div class="mb-3 flex items-baseline justify-between border-b pb-2">
							<h2 class="text-[11px] font-bold tracking-widest uppercase">Core grammar</h2>
							<span class="text-[10.5px] text-faint">Errors first</span>
						</div>
						<div class="flex flex-col gap-2">
							{#each grammarPatterns as pattern (pattern.key)}
								<button
									type="button"
									class="flex items-center justify-between gap-3 rounded-lg border bg-card p-3 text-left transition-shadow hover:shadow-sm"
									onclick={() => (selectedKey = pattern.key)}
								>
									<p class="truncate font-serif text-sm font-medium">{pattern.label}</p>
									<span class="shrink-0 font-serif text-lg">{pattern.count}</span>
								</button>
							{/each}
						</div>
					</div>
				</div>
			{/if}
		{/if}
	</div>
</div>
