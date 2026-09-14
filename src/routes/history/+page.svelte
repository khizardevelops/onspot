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
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import { Pencil, Play, Search, Trash2 } from '@lucide/svelte';

	let sessions = $state<Session[]>([]);
	let attemptsBySession = $state<Record<string, Attempt[]>>({});
	let loading = $state(true);
	let query = $state('');
	let regex = $state(false);
	let caseSensitive = $state(false);

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

	function fmtDate(iso: string): string {
		return new Date(iso).toLocaleString('en-GB', {
			day: 'numeric',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function fmtDuration(seconds: number): string {
		const mins = Math.floor(seconds / 60);
		const secs = Math.round(seconds % 60);
		return `${mins}:${String(secs).padStart(2, '0')}`;
	}
</script>

<svelte:head><title>History · onspot</title></svelte:head>

<div class="h-full overflow-y-auto">
	<div class="mx-auto max-w-3xl px-8 py-10">
		<div class="mb-4 flex items-start justify-between gap-6">
			<div>
				<h1 class="font-serif text-2xl font-medium">History</h1>
				<p class="text-sm text-muted-foreground">Your past practice sessions, newest first.</p>
			</div>
			<div class="relative w-64">
				<Search
					class="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-faint"
				/>
				<Input class="pl-8" placeholder="Search title or transcript…" bind:value={query} />
			</div>
		</div>

		<div class="mb-4 flex flex-wrap items-center gap-2">
			<button
				type="button"
				class="h-7 rounded-md border px-2.5 text-xs font-medium transition-colors {regex
					? 'border-transparent bg-[var(--brand-soft)] text-[var(--brand)]'
					: 'text-muted-foreground hover:text-foreground'}"
				onclick={() => (regex = !regex)}>Regex</button
			>
			<button
				type="button"
				class="h-7 rounded-md border px-2.5 text-xs font-medium transition-colors {caseSensitive
					? 'border-transparent bg-[var(--brand-soft)] text-[var(--brand)]'
					: 'text-muted-foreground hover:text-foreground'}"
				onclick={() => (caseSensitive = !caseSensitive)}>Case sensitive</button
			>
			{#if query.trim()}
				<span class="text-xs {result.error ? 'text-[var(--error)]' : 'text-muted-foreground'}">
					{result.error
						? `Invalid regex — ${result.error}`
						: `${result.sessions.length} of ${sessions.length} session${sessions.length === 1 ? '' : 's'} match`}
				</span>
			{/if}
		</div>

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
			<div class="flex flex-col">
				{#each result.sessions as session (session.id)}
					{@const attempts = attemptsFor(session)}
					{@const snippet = snippetHtml(session)}
					<div class="flex items-center gap-4 border-b py-4 last:border-b-0">
						<button type="button" class="min-w-0 flex-1 text-left" onclick={() => open(session)}>
							<p class="truncate font-serif text-base font-medium">{session.title}</p>
							<p class="text-xs text-muted-foreground">
								{fmtDate(session.createdAt)} · {attempts.length} attempt{attempts.length === 1
									? ''
									: 's'} · {fmtDuration(
									attempts.reduce((sum, attempt) => sum + attempt.durationSec, 0)
								)} · {session.mode === 'exam' ? 'Exam' : 'Casual'}
							</p>
							{#if snippet}
								<p class="mt-1 truncate font-serif text-xs text-muted-foreground">
									{@html snippet}
								</p>
							{/if}
						</button>
						<div class="flex shrink-0 items-center gap-0.5">
							<Button
								size="sm"
								variant="ghost"
								title="Replay last recording"
								onclick={() => replay(session)}
							>
								<Play class="size-3.5" />
							</Button>
							<Button size="sm" variant="ghost" title="Rename" onclick={() => rename(session)}>
								<Pencil class="size-3.5" />
							</Button>
							<Button
								size="sm"
								variant="ghost"
								title="Delete"
								class="text-[var(--error)]"
								onclick={() => remove(session)}
							>
								<Trash2 class="size-3.5" />
							</Button>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>
