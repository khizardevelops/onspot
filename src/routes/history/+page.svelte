<script lang="ts">
	import { quickCollapse } from '$lib/neo';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { getDatabaseAdapter, type Attempt, type Session } from '$lib/adapters/db';
	import { importLegacyJsonBackup } from '$lib/utils/export';
	import RestoreDatabaseButton from '$lib/components/RestoreDatabaseButton.svelte';
	import {
		deleteSession,
		hydrateLatestSession,
		openSession,
		playStoredAudio,
		renameSession
	} from '$lib/stores/practice';
	import { toast } from '$lib/stores/toast';
	import { NeoButton } from '@dvcol/neo-svelte/buttons';
	import { NeoCard } from '@dvcol/neo-svelte/cards';
	import { NeoCollapse } from '@dvcol/neo-svelte/collapse';
	import { NeoDivider } from '@dvcol/neo-svelte/divider';
	import type { NeoMenuItem } from '@dvcol/neo-svelte/floating/menu';
	import PopMenu from '$lib/components/PopMenu.svelte';
	import { NeoInput } from '@dvcol/neo-svelte/inputs';
	import { NeoPill } from '@dvcol/neo-svelte/pill';
	import {
		CalendarArrowDown,
		CalendarArrowUp,
		CaseSensitive,
		Pencil,
		Play,
		Regex,
		Search,
		SlidersHorizontal,
		Trash2,
		Upload
	} from '@lucide/svelte';

	let sessions = $state<Session[]>([]);
	let attemptsBySession = $state<Record<string, Attempt[]>>({});
	let loading = $state(true);
	let loadError = $state('');
	let restoring = $state(false);
	let restoreInput = $state<HTMLInputElement | null>(null);
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

	const sortIcons = { newest: CalendarArrowDown, oldest: CalendarArrowUp };
	const sortItems = $derived<NeoMenuItem[]>(
		(['newest', 'oldest'] as const).map((value) => ({
			value,
			label: value === 'newest' ? 'Newest first' : 'Oldest first',
			before: sortIcon,
			color: sortOrder === value ? 'primary' : undefined
		}))
	);

	function setSortOrder(value: string): void {
		sortOrder = value === 'oldest' ? 'oldest' : 'newest';
		try {
			localStorage.setItem(SORT_KEY, sortOrder);
		} catch {
			// Storage may be disabled; the order still applies for this visit.
		}
	}

	async function load() {
		loading = true;
		loadError = '';
		try {
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
		} catch (error) {
			loadError = error instanceof Error ? error.message : 'The local database could not be opened.';
		} finally {
			loading = false;
		}
	}

	async function restoreBackup(event: Event): Promise<void> {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file || restoring) return;
		restoring = true;
		try {
			const restored = await importLegacyJsonBackup(file);
			await hydrateLatestSession();
			toast(`Restored ${restored.sessions} sessions and ${restored.attempts} takes.`);
			await load();
		} catch (error) {
			toast(error instanceof Error ? error.message : 'Restore failed');
		} finally {
			restoring = false;
		}
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
			<div class="history-tools flex w-full items-center gap-2 sm:w-auto">
				<NeoInput
					class="history-search"
					containerProps={{ class: 'history-search-field' }}
					placeholder="Search title or transcript…"
					aria-label="Search sessions"
					bind:value={query}
					rounded
					elevation={-2}
					clearable
				>
					{#snippet before()}<Search class="size-4 text-muted-foreground" />{/snippet}
				</NeoInput>
				<PopMenu items={sortItems} placement="bottom-end" onSelect={(item) => setSortOrder(String(item.value))} rounded>
					<NeoButton
						class="history-tool"
						rounded
						elevation={2}
						aria-label={`Sort by date, ${sortOrder === 'newest' ? 'newest' : 'oldest'} first`}
					>
						{#snippet icon()}
							{#if sortOrder === 'newest'}<CalendarArrowDown class="size-4" />{:else}<CalendarArrowUp class="size-4" />{/if}
						{/snippet}
						<span class="hidden sm:inline">{sortOrder === 'newest' ? 'Newest' : 'Oldest'}</span>
					</NeoButton>
				</PopMenu>
				<NeoButton
					class="history-tool options-toggle relative {optionsOpen ? 'is-selected' : ''}"
					toggle
					bind:checked={optionsOpen}
					rounded
					elevation={2}
					aria-label="Search options"
					aria-expanded={optionsOpen}
					aria-controls="search-options"
					title="Search options"
				>
					{#snippet icon()}<SlidersHorizontal class="size-4" />{/snippet}
					{#if optionsActive && !optionsOpen}
						<span class="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-primary" aria-hidden="true"></span>
					{/if}
				</NeoButton>
			</div>
		</div>

		<NeoCollapse transition={quickCollapse} id="search-options" bind:open={optionsOpen}>
			<div class="flex flex-wrap items-center justify-end gap-2 px-1 pt-1 pb-2">
				<NeoButton class="search-option" toggle bind:checked={regex} aria-pressed={regex} rounded elevation={1}>
					{#snippet icon()}<Regex class="size-4" />{/snippet}
					Regex
				</NeoButton>
				<NeoButton class="search-option" toggle bind:checked={caseSensitive} aria-pressed={caseSensitive} rounded elevation={1}>
					{#snippet icon()}<CaseSensitive class="size-4" />{/snippet}
					Case sensitive
				</NeoButton>
			</div>
		</NeoCollapse>

		<p class="mt-1 mb-5 min-h-4 text-right text-xs {result.error ? 'text-[var(--error)]' : 'text-muted-foreground'}" aria-live="polite">
			{#if query.trim()}
				{result.error
					? `Invalid regex — ${result.error}`
					: `${result.sessions.length} of ${sessions.length} session${sessions.length === 1 ? '' : 's'} match`}
			{/if}
		</p>

		{#if loading}
			<p class="text-sm text-muted-foreground">Loading…</p>
		{:else if loadError}
			<div class="rounded-lg border border-[var(--error)]/35 bg-[var(--error-soft)] p-8 text-center">
				<p class="font-serif text-lg text-[var(--error)]">History could not be loaded</p>
				<p class="mx-auto mt-1 max-w-xl text-sm text-muted-foreground">{loadError}</p>
				<NeoButton class="mt-4" rounded elevation={2} onclick={() => void load()}>Try again</NeoButton>
			</div>
		{:else if sessions.length === 0}
			<div class="rounded-lg border border-dashed p-10 text-center">
				<p class="font-serif text-lg">No sessions in this device storage</p>
				<p class="mt-1 text-sm text-muted-foreground">
					Restore an existing onspot backup here, or start from <a class="text-[var(--brand)] underline" href="/">Practice</a>.
				</p>
				<div class="mt-4 flex flex-wrap items-center justify-center gap-2">
					<RestoreDatabaseButton label="Restore .sqlite backup" onrestored={() => load()} />
					<input bind:this={restoreInput} class="sr-only" type="file" accept="application/json,.json" onchange={restoreBackup} />
					<NeoButton rounded elevation={2} onclick={() => restoreInput?.click()} disabled={restoring} loading={restoring}>
						{#snippet icon()}<Upload class="size-4" />{/snippet}
						{restoring ? 'Restoring…' : 'Restore .json backup'}
					</NeoButton>
				</div>
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
							<NeoDivider flex="1" aria-hidden="true" />
							<span class="text-xs text-faint tabular-nums">
								{group.sessions.length} session{group.sessions.length === 1 ? '' : 's'}
							</span>
						</h2>
						<div class="session-list flex flex-col gap-2.5">
							{#each group.sessions as session (session.id)}
								{@const attempts = attemptsFor(session)}
								{@const snippet = snippetHtml(session)}
								<NeoCard
									class="session-card"
									glass
									rounded="1rem"
									elevation={2}
									hover={1}
									spacing="1rem 1.25rem"
								>
									<button type="button" class="session-open min-w-0 flex-1 text-left" onclick={() => open(session)}>
										<p class="w-full truncate font-serif text-base font-medium">{session.title}</p>
										<p class="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
											<span class="tabular-nums">{timeOfDay.format(new Date(session.createdAt))}</span>
											<span class="text-faint">·</span>
											<span>{attempts.length} take{attempts.length === 1 ? '' : 's'}</span>
											<span class="text-faint">·</span>
											<span class="tabular-nums">{fmtDuration(attempts.reduce((sum, attempt) => sum + attempt.durationSec, 0))}</span>
											<NeoPill
												class="mode-pill ml-1"
												size="small"
												elevation={0}
												tinted
												color={session.mode === 'exam' ? 'error' : 'primary'}
											>
												{session.mode === 'exam' ? 'Exam' : 'Casual'}
											</NeoPill>
										</p>
										{#if snippet}
											<p class="mt-1 truncate font-serif text-[0.8125rem] text-muted-foreground">
												{@html snippet}
											</p>
										{/if}
									</button>
									<div class="flex shrink-0 items-center gap-0.5">
										<NeoButton
											class="session-action"
											text
											rounded
											aria-label="Replay last recording"
											title="Replay last recording"
											onclick={() => replay(session)}
										>
											{#snippet icon()}<Play class="size-3.5" />{/snippet}
										</NeoButton>
										<NeoButton class="session-action" text rounded aria-label="Rename" title="Rename" onclick={() => rename(session)}>
											{#snippet icon()}<Pencil class="size-3.5" />{/snippet}
										</NeoButton>
										<NeoButton
											class="session-action"
											text
											rounded
											color="error"
											aria-label="Delete"
											title="Delete"
											onclick={() => remove(session)}
										>
											{#snippet icon()}<Trash2 class="size-3.5" />{/snippet}
										</NeoButton>
									</div>
								</NeoCard>
							{/each}
						</div>
					</section>
				{/each}
			</div>
		{/if}
	</div>
</div>

{#snippet sortIcon({ item }: { item: { value: unknown } })}
	{@const Icon = sortIcons[item.value as SortOrder]}
	<Icon class="size-4" />
{/snippet}

<style>
	/*
	 * Session cards are neo glass cards (frosted over the paper page); neo owns
	 * their relief and hover lift. Only the row layout is set here.
	 */
	.session-list :global(.neo-card.session-card) {
		width: 100%;
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: 0.75rem;
	}
	.session-open:focus-visible {
		outline: 2px solid color-mix(in srgb, var(--ring) 60%, transparent);
		outline-offset: 4px;
		border-radius: 10px;
	}
	.history-tools :global(.history-search-field) {
		flex: 1 1 auto;
		min-width: 0;
	}
	@media (min-width: 640px) {
		.history-tools :global(.history-search-field) { width: 16rem; flex: 0 0 auto; }
	}
	.history-tools :global(.neo-button.history-tool) {
		height: 2.25rem;
		min-width: 2.25rem;
		flex-shrink: 0;
		color: var(--on-control);
	}
	:global(.neo-button.session-action) {
		width: 2rem;
		height: 2rem;
		padding: 0;
		justify-content: center;
	}
</style>
