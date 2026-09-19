<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { getDatabaseAdapter, type Attempt, type Session } from '$lib/adapters/db';
	import {
		deleteSession,
		openSession,
		playStoredAudio,
		renameSession
	} from '$lib/stores/practice';
	import { toast } from '$lib/stores/toast';
	import * as Collapsible from '$lib/components/ui/collapsible';
	import * as InputGroup from '$lib/components/ui/input-group';
	import * as Item from '$lib/components/ui/item';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { Badge } from '$lib/components/ui/badge';
	import { Button, buttonVariants } from '$lib/components/ui/button';
	import { Toggle } from '$lib/components/ui/toggle';
	import {
		CalendarArrowDown,
		CalendarArrowUp,
		CaseSensitive,
		Pencil,
		Play,
		Regex,
		Search,
		SlidersHorizontal,
		Trash2
	} from '@lucide/svelte';

	let sessions = $state<Session[]>([]);
	let attemptsBySession = $state<Record<string, Attempt[]>>({});
	let loading = $state(true);
	let query = $state('');
	let regex = $state(false);
	let caseSensitive = $state(false);
	/** Search options are secondary: folded behind a toggle next to the search box. */
	let optionsOpen = $state(false);
	const optionsActive = $derived(regex || caseSensitive);

	type SortOrder = 'newest' | 'oldest';
	const SORT_KEY = 'onspot.history.sort';
	/** Remembered per device; a view preference, not synced data. */
	let sortOrder = $state<SortOrder>(readSortOrder());

	function readSortOrder(): SortOrder {
		try {
			return localStorage.getItem(SORT_KEY) === 'oldest' ? 'oldest' : 'newest';
		} catch {
			return 'newest';
		}
	}

	function setSortOrder(value: string): void {
		sortOrder = value === 'oldest' ? 'oldest' : 'newest';
		try {
			localStorage.setItem(SORT_KEY, sortOrder);
		} catch {
			// Storage may be disabled; the order still applies for this visit.
		}
	}

	async function load() {
		const db = await getDatabaseAdapter();
		const [sessionRows, attemptRows] = await Promise.all([
			db.listSessions(),
			db.listAllAttempts()
		]);
		sessions = sessionRows;
		const grouped: Record<string, Attempt[]> = {};
		for (const attempt of attemptRows) (grouped[attempt.sessionId] ??= []).push(attempt);
		for (const list of Object.values(grouped)) {
			list.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
		}
		attemptsBySession = grouped;
		loading = false;
	}

	onMount(load);

	const result = $derived.by((): { sessions: Session[]; error: string } => {
		const raw = query.trim();
		if (!raw) return { sessions, error: '' };

		let test: (value: string) => boolean;
		if (regex) {
			try {
				const re = new RegExp(raw, caseSensitive ? '' : 'i');
				test = (value) => re.test(value);
			} catch (error) {
				return {
					sessions: [],
					error: error instanceof Error ? error.message : 'Invalid regular expression'
				};
			}
		} else {
			const needle = caseSensitive ? raw : raw.toLowerCase();
			test = (value) => (caseSensitive ? value : value.toLowerCase()).includes(needle);
		}

		return {
			sessions: sessions.filter(
				(session) =>
					test(session.title) ||
					(attemptsBySession[session.id] ?? []).some((attempt) => test(attempt.transcript))
			),
			error: ''
		};
	});

	const DAY = 86_400_000;
	const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'long' });
	const thisYear = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
	const otherYear = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
	const timeOfDay = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

	function startOfDay(date: Date): number {
		return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
	}

	/** "Today", "Yesterday", a weekday within the last week, then the full date. */
	function dayLabel(day: number): string {
		const days = Math.round((startOfDay(new Date()) - day) / DAY);
		if (days === 0) return 'Today';
		if (days === 1) return 'Yesterday';
		const date = new Date(day);
		if (days > 1 && days < 7) return weekday.format(date);
		return date.getFullYear() === new Date().getFullYear() ? thisYear.format(date) : otherYear.format(date);
	}

	/** Matching sessions in the chosen order, split into one group per calendar day. */
	const groups = $derived.by(() => {
		const direction = sortOrder === 'newest' ? -1 : 1;
		const ordered = [...result.sessions].sort(
			(a, b) => direction * (Date.parse(a.createdAt) - Date.parse(b.createdAt))
		);
		const out: { day: number; label: string; sessions: Session[] }[] = [];
		for (const session of ordered) {
			const day = startOfDay(new Date(session.createdAt));
			let group = out.at(-1);
			if (!group || group.day !== day) {
				group = { day, label: dayLabel(day), sessions: [] };
				out.push(group);
			}
			group.sessions.push(session);
		}
		return out;
	});

	function attemptsFor(session: Session): Attempt[] {
		return attemptsBySession[session.id] ?? [];
	}

	function escapeHtml(value: string): string {
		return value.replace(/[&<>"']/g, (char) =>
			({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] as string
		);
	}

	/** Latest transcript, clipped, with a literal query match wrapped in <mark>. */
	function snippetHtml(session: Session): string {
		const text = attemptsFor(session).at(-1)?.transcript ?? '';
		if (!text) return '';
		const clipped = text.length > 160 ? `${text.slice(0, 160)}…` : text;
		const raw = query.trim();
		if (!raw || regex || result.error) return escapeHtml(clipped);

		const needle = caseSensitive ? raw : raw.toLowerCase();
		const haystack = caseSensitive ? clipped : clipped.toLowerCase();
		const at = haystack.indexOf(needle);
		if (at === -1) return escapeHtml(clipped);

		return (
			escapeHtml(clipped.slice(0, at)) +
			`<mark class="rounded bg-[var(--brand-soft)] px-0.5 text-[var(--brand)]">${escapeHtml(
				clipped.slice(at, at + raw.length)
			)}</mark>` +
			escapeHtml(clipped.slice(at + raw.length))
		);
	}

	async function open(session: Session) {
		await openSession(session.id);
		await goto('/');
	}

	async function replay(session: Session) {
		const last = attemptsFor(session).at(-1);
		if (!last) {
			toast('No recording in this session.');
			return;
		}
		await playStoredAudio(last.id);
	}

	async function rename(session: Session) {
		const title = window.prompt('Session name', session.title);
		if (!title || title.trim() === session.title) return;
		await renameSession(session.id, title.trim());
		await load();
		toast('Session renamed');
	}

	async function remove(session: Session) {
		const ok = window.confirm(
			`Delete "${session.title}" and all its attempts? This cannot be undone.`
		);
		if (!ok) return;
		await deleteSession(session.id);
		await load();
		toast('Session deleted');
	}

	function fmtDuration(seconds: number): string {
		const mins = Math.floor(seconds / 60);
		const secs = Math.round(seconds % 60);
		return `${mins}:${String(secs).padStart(2, '0')}`;
	}
</script>

<svelte:head><title>History · onspot</title></svelte:head>

<div class="h-full overflow-y-auto">
	<div class="mx-auto max-w-3xl px-4 py-10 sm:px-8">
		<div class="mb-3 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
			<div>
				<h1 class="font-serif text-2xl font-medium">History</h1>
				<p class="text-sm text-muted-foreground">Your past practice sessions, by day.</p>
			</div>
			<div class="flex w-full items-center gap-1.5 sm:w-auto">
				<InputGroup.Root class="h-9 w-full bg-background sm:w-64">
					<InputGroup.Addon>
						<Search />
					</InputGroup.Addon>
					<InputGroup.Input
						placeholder="Search title or transcript…"
						aria-label="Search sessions"
						bind:value={query}
					/>
				</InputGroup.Root>
				<DropdownMenu.Root>
					<DropdownMenu.Trigger
						class={buttonVariants({ variant: 'outline', size: 'lg', class: 'shrink-0 px-3' })}
						aria-label={`Sort by date, ${sortOrder === 'newest' ? 'newest' : 'oldest'} first`}
					>
						{#if sortOrder === 'newest'}<CalendarArrowDown />{:else}<CalendarArrowUp />{/if}
						<span class="hidden sm:inline">{sortOrder === 'newest' ? 'Newest' : 'Oldest'}</span>
					</DropdownMenu.Trigger>
					<DropdownMenu.Content align="end" class="w-52 p-1.5">
						<DropdownMenu.Label>Sort by date</DropdownMenu.Label>
						<DropdownMenu.RadioGroup value={sortOrder} onValueChange={setSortOrder}>
							<DropdownMenu.RadioItem value="newest" class="min-h-9">
								<CalendarArrowDown class="size-4 text-muted-foreground" /> Newest first
							</DropdownMenu.RadioItem>
							<DropdownMenu.RadioItem value="oldest" class="min-h-9">
								<CalendarArrowUp class="size-4 text-muted-foreground" /> Oldest first
							</DropdownMenu.RadioItem>
						</DropdownMenu.RadioGroup>
					</DropdownMenu.Content>
				</DropdownMenu.Root>
				<Toggle
					variant="outline"
					size="lg"
					class="options-toggle relative shrink-0"
					bind:pressed={optionsOpen}
					aria-label="Search options"
					aria-expanded={optionsOpen}
					aria-controls="search-options"
					title="Search options"
				>
					<SlidersHorizontal />
					{#if optionsActive && !optionsOpen}
						<span class="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-primary ring-2 ring-control" aria-hidden="true"></span>
					{/if}
				</Toggle>
			</div>
		</div>

		<Collapsible.Root bind:open={optionsOpen}>
			<Collapsible.Content id="search-options" class="search-options overflow-hidden">
				<div class="flex flex-wrap items-center justify-end gap-2 pb-1">
					<Toggle variant="outline" size="sm" class="search-option" bind:pressed={regex}>
						<Regex /> Regex
					</Toggle>
					<Toggle variant="outline" size="sm" class="search-option" bind:pressed={caseSensitive}>
						<CaseSensitive /> Case sensitive
					</Toggle>
				</div>
			</Collapsible.Content>
		</Collapsible.Root>

		<p class="mt-1 mb-5 min-h-4 text-right text-xs {result.error ? 'text-[var(--error)]' : 'text-muted-foreground'}" aria-live="polite">
			{#if query.trim()}
				{result.error
					? `Invalid regex — ${result.error}`
					: `${result.sessions.length} of ${sessions.length} session${sessions.length === 1 ? '' : 's'} match`}
			{/if}
		</p>

		{#if loading}
			<p class="text-sm text-muted-foreground">Loading…</p>
		{:else if sessions.length === 0}
			<div class="rounded-lg border border-dashed p-10 text-center">
				<p class="font-serif text-lg">No sessions yet</p>
				<p class="mt-1 text-sm text-muted-foreground">
					Start one from the <a class="text-[var(--brand)] underline" href="/">Practice</a> tab.
				</p>
			</div>
		{:else if result.error}
			<div class="rounded-lg border border-dashed p-10 text-center">
				<p class="font-serif text-lg text-[var(--error)]">Invalid regular expression</p>
				<p class="mt-1 text-sm text-muted-foreground">{result.error}</p>
			</div>
		{:else if result.sessions.length === 0}
			<div class="rounded-lg border border-dashed p-10 text-center">
				<p class="font-serif text-lg">No matches</p>
				<p class="mt-1 text-sm text-muted-foreground">No session or transcript contains that.</p>
			</div>
		{:else}
			<div class="flex flex-col gap-8 pb-8">
				{#each groups as group (group.day)}
					<section aria-labelledby={`day-${group.day}`}>
						<h2 id={`day-${group.day}`} class="day-heading mb-3 flex items-center gap-3 px-1">
							<span class="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">{group.label}</span>
							<span class="h-px flex-1 bg-border" aria-hidden="true"></span>
							<span class="text-xs text-faint tabular-nums">
								{group.sessions.length} session{group.sessions.length === 1 ? '' : 's'}
							</span>
						</h2>
						<div class="flex flex-col gap-2.5">
							{#each group.sessions as session (session.id)}
								{@const attempts = attemptsFor(session)}
								{@const snippet = snippetHtml(session)}
								<Item.Root class="session-card sheet flex-nowrap gap-3 rounded-2xl border-[var(--sheet-line)] px-5 py-4">
									<button type="button" class="session-open min-w-0 flex-1 text-left" onclick={() => open(session)}>
										<Item.Content class="min-w-0">
											<Item.Title class="w-full truncate font-serif text-base font-medium">{session.title}</Item.Title>
											<Item.Description class="flex flex-wrap items-center gap-x-1.5 text-xs">
												<span class="tabular-nums">{timeOfDay.format(new Date(session.createdAt))}</span>
												<span class="text-faint">·</span>
												<span>{attempts.length} take{attempts.length === 1 ? '' : 's'}</span>
												<span class="text-faint">·</span>
												<span class="tabular-nums">{fmtDuration(attempts.reduce((sum, attempt) => sum + attempt.durationSec, 0))}</span>
												<Badge
													variant="outline"
													class="ml-1 h-5 border-transparent px-1.5 {session.mode === 'exam'
														? 'bg-[var(--error-soft)] text-[var(--error)]'
														: 'bg-[var(--brand-soft)] text-[var(--brand)]'}"
												>
													{session.mode === 'exam' ? 'Exam' : 'Casual'}
												</Badge>
											</Item.Description>
											{#if snippet}
												<p class="mt-1 truncate font-serif text-[0.8125rem] text-muted-foreground">
													{@html snippet}
												</p>
											{/if}
										</Item.Content>
									</button>
									<Item.Actions class="shrink-0 gap-0.5">
										<Button
											size="icon-sm"
											variant="ghost"
											aria-label="Replay last recording"
											title="Replay last recording"
											onclick={() => replay(session)}
										>
											<Play class="size-3.5" />
										</Button>
										<Button size="icon-sm" variant="ghost" aria-label="Rename" title="Rename" onclick={() => rename(session)}>
											<Pencil class="size-3.5" />
										</Button>
										<Button
											size="icon-sm"
											variant="ghost"
											aria-label="Delete"
											title="Delete"
											class="text-[var(--error)] hover:bg-[var(--error-soft)] hover:text-[var(--error)]"
											onclick={() => remove(session)}
										>
											<Trash2 class="size-3.5" />
										</Button>
									</Item.Actions>
								</Item.Root>
							{/each}
						</div>
					</section>
				{/each}
			</div>
		{/if}
	</div>
</div>

<style>
	/*
	 * Session cards are sheets (colour hierarchy: content layer), clearly set
	 * off from the paper page: warm-white fill, hairline border, soft shadow.
	 * Nothing moves on hover, and no fixed-attachment background scrolls with them.
	 */
	:global(.session-card) {
		transition:
			box-shadow 200ms ease,
			border-color 200ms ease;
	}
	:global(.session-card:hover) {
		box-shadow: var(--shadow-sheet-hover);
	}
	:global(.session-card:has(.session-open:active)) {
		box-shadow: var(--shadow-sheet);
	}
	.session-open:focus-visible {
		outline: 2px solid color-mix(in srgb, var(--ring) 60%, transparent);
		outline-offset: 4px;
		border-radius: 10px;
	}


	:global(.search-options[data-state='open']) {
		animation: options-open 260ms cubic-bezier(0.22, 1, 0.36, 1);
	}
	:global(.search-options[data-state='closed']) {
		animation: options-close 180ms cubic-bezier(0.4, 0, 1, 1);
	}
	@keyframes options-open {
		from { height: 0; opacity: 0; }
		to { height: var(--bits-collapsible-content-height); opacity: 1; }
	}
	@keyframes options-close {
		from { height: var(--bits-collapsible-content-height); opacity: 1; }
		to { height: 0; opacity: 0; }
	}

	@media (prefers-reduced-motion: reduce) {
		:global(.session-card) { transition-duration: 1ms; }
		:global(.search-options) { animation-duration: 1ms !important; }
	}
</style>
