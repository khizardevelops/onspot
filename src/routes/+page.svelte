<script lang="ts">
	import {
		clearError,
		deleteSession,
		newSession,
		nextPrompt,
		playAttempt,
		playRecording,
		practice,
		renameSession,
		setSessionMode,
		speakText,
		startRecording,
		stopAndAnalyze
	} from '$lib/stores/practice';
	import { appSettings } from '$lib/stores/settings';
	import { toast } from '$lib/stores/toast';
	import { Button } from '$lib/components/ui/button';
	import AttemptStream from '$lib/components/AttemptStream.svelte';
	import {
		AlertTriangle,
		Loader2,
		Mic,
		Pencil,
		RotateCcw,
		SkipForward,
		Square,
		Trash2,
		Volume2
	} from '@lucide/svelte';

	const BAR_COUNT = 44;
	const active = $derived(
		$practice.attempts.find((attempt) => attempt.id === $practice.activeAttemptId) ?? null
	);
	const busy = $derived($practice.phase === 'transcribing' || $practice.phase === 'evaluating');
	const recording = $derived($practice.phase === 'recording');
	/** Once a session has started its mode is fixed. */
	const locked = $derived($practice.sessionId !== null);

	/** Correction currently highlighted, linked between transcript and feedback. */
	let activeCorrectionId = $state<string | null>(null);
	let lastAttemptId: string | null = null;

	$effect(() => {
		if ($practice.activeAttemptId !== lastAttemptId) {
			lastAttemptId = $practice.activeAttemptId;
			activeCorrectionId = null;
		}
	});

	function selectCorrection(_attemptId: string, correctionId: string) {
		activeCorrectionId = correctionId;
	}

	function toggleCorrection(id: string) {
		activeCorrectionId = activeCorrectionId === id ? null : id;
	}

	async function renameCurrent() {
		const sessionId = $practice.sessionId;
		if (!sessionId) return;
		const title = window.prompt('Session name', $practice.prompt.title);
		if (!title || title.trim() === $practice.prompt.title) return;
		await renameSession(sessionId, title.trim());
		toast('Session renamed');
	}

	async function deleteCurrent() {
		const sessionId = $practice.sessionId;
		if (!sessionId) return;
		if (!window.confirm('Delete this session and all its attempts? This cannot be undone.')) return;
		await deleteSession(sessionId);
		newSession();
		activeCorrectionId = null;
		toast('Session deleted');
	}

	function fmtTime(seconds: number): string {
		const mins = Math.floor(seconds / 60);
		const secs = Math.floor(seconds % 60);
		return `${mins}:${String(secs).padStart(2, '0')}`;
	}

	function barHeight(index: number): number {
		if (!recording) return 8;
		const center = BAR_COUNT / 2;
		const distance = Math.abs(index - center) / center;
		const base = 52 * (1 - distance * 0.65);
		const wobble = 0.45 + 0.55 * Math.abs(Math.sin(performance.now() / 130 + index));
		return Math.max(6, base * $practice.level * 1.7 * wobble);
	}

	const CATEGORY_LABEL: Record<string, string> = {
		grammar: 'Grammar',
		register: 'Register',
		filler: 'Filler',
		style: 'Style'
	};

	const EXAM_BADGE: Record<string, string> = {
		'strictly-avoid': 'Strictly avoid for exam',
		avoid: 'Avoid for exam',
		'use-sparingly': 'Use sparingly',
		allowed: 'Allowed'
	};

	function categoryClass(category: string): string {
		if (category === 'grammar') return 'text-[var(--error)]';
		if (category === 'style') return 'text-[var(--good)]';
		return 'text-[var(--warn)]';
	}

	const stats = $derived.by(() => {
		const attempts = $practice.attempts;
		const words = attempts.reduce((sum, attempt) => sum + attempt.wordCount, 0);
		const time = attempts.reduce((sum, attempt) => sum + attempt.durationSec, 0);
		const errors = attempts.reduce(
			(sum, attempt) => sum + attempt.corrections.filter((c) => c.severity === 'error').length,
			0
		);
		return { attempts: attempts.length, words, time, errors };
	});
</script>

<svelte:head><title>Practice · onspot</title></svelte:head>

<div class="grid h-full grid-cols-[minmax(0,1fr)_380px]">
	<section class="flex min-w-0 flex-col overflow-hidden">
		<header class="flex items-center justify-between gap-4 border-b px-8 py-4">
			<div class="min-w-0">
				<h1 class="truncate font-serif text-lg font-medium">
					{$practice.prompt.title || 'New session'}
				</h1>
				<p class="truncate text-xs text-muted-foreground">
					{$appSettings.level} ·
					<span class={$practice.mode === 'exam' ? 'text-[var(--error)]' : 'text-[var(--brand)]'}>
						{$practice.mode === 'exam' ? 'Exam' : 'Casual'}
					</span>
				</p>
			</div>
			<div class="flex items-center gap-2">
				<div
					class="flex items-center gap-1 rounded-md bg-[var(--surface-2)] p-0.5 text-[10.5px] font-semibold tracking-wide uppercase {locked
						? 'opacity-60'
						: ''}"
					title={locked ? 'Mode is fixed for this session' : 'Learning mode'}
				>
					<button
						type="button"
						disabled={locked}
						class="h-6 rounded px-2.5 disabled:cursor-not-allowed {$practice.mode === 'exam'
							? 'bg-card text-[var(--error)]'
							: ''}"
						onclick={() => setSessionMode('exam')}>Exam</button
					>
					<button
						type="button"
						disabled={locked}
						class="h-6 rounded px-2.5 disabled:cursor-not-allowed {$practice.mode === 'casual'
							? 'bg-card text-[var(--brand)]'
							: ''}"
						onclick={() => setSessionMode('casual')}>Casual</button
					>
				</div>

				{#if locked}
					<button
						type="button"
						title="Rename session"
						aria-label="Rename session"
						class="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-[var(--surface-2)] hover:text-foreground"
						onclick={renameCurrent}
					>
						<Pencil class="size-3.5" />
					</button>
					<button
						type="button"
						title="Delete session"
						aria-label="Delete session"
						class="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-[var(--error-soft)] hover:text-[var(--error)]"
						onclick={deleteCurrent}
					>
						<Trash2 class="size-3.5" />
					</button>
				{/if}
			</div>
		</header>

		<div class="relative min-h-0 flex-1">
			<AttemptStream {activeCorrectionId} onSelectCorrection={selectCorrection} />
			{#if $practice.attempts.length === 0}
				<div class="pointer-events-none absolute inset-0 grid place-items-center">
					<p class="text-sm text-muted-foreground">
						Your attempts will appear here as a conversation.
					</p>
				</div>
			{/if}
		</div>

		<footer class="border-t px-8 py-5">
			{#if busy}
				<div class="flex items-center gap-3 text-sm text-muted-foreground">
					<Loader2 class="size-4 animate-spin" />
					<span>{$practice.statusText || 'Working…'}</span>
					{#if $practice.progress}
						<span class="text-xs">{$practice.progress.progress}%</span>
					{/if}
				</div>
				{#if $practice.progress}
					<div class="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--surface-2)]">
						<div
							class="h-full rounded-full bg-[var(--brand)] transition-[width] duration-200"
							style="width: {$practice.progress.progress}%"
						></div>
					</div>
				{/if}
			{:else if recording}
				<div class="flex flex-col items-center gap-4">
					<div class="flex h-14 w-full max-w-sm items-center justify-center gap-[3px]">
						{#each Array(BAR_COUNT) as _, index (index)}
							<span
								class="w-[3px] rounded-sm bg-[var(--brand)]"
								style="height: {barHeight(index)}px"
							></span>
						{/each}
					</div>
					<div class="flex items-center gap-4">
						<span class="font-mono text-sm text-muted-foreground"
							><span class="text-foreground">{fmtTime($practice.elapsed)}</span> / 1:00</span
						>
						<Button variant="outline" onclick={() => stopAndAnalyze()}>
							<Square class="size-3.5" />
							Stop & analyze
						</Button>
					</div>
					<p class="text-xs text-muted-foreground">
						Press Stop when you are done (auto-stops at 1:00).
					</p>
				</div>
			{:else}
				<p class="mb-1 text-[11px] font-medium tracking-widest text-muted-foreground uppercase">
					Topic
				</p>
				<p class="mb-4 max-w-[55ch] font-serif text-xl font-medium">{$practice.prompt.text}</p>
				<div class="flex flex-wrap items-center gap-2">
					<Button onclick={() => startRecording()}>
						<Mic class="size-4" />
						Start recording
					</Button>
					<Button variant="outline" onclick={() => nextPrompt()}>
						<SkipForward class="size-4" />
						New topic
					</Button>
				</div>
			{/if}

			{#if $practice.error}
				<div
					class="mt-4 flex items-start gap-2 rounded-md border border-[var(--error)]/30 bg-[var(--error-soft)] p-3 text-sm"
				>
					<AlertTriangle class="mt-0.5 size-4 shrink-0 text-[var(--error)]" />
					<div class="min-w-0 flex-1">
						<p class="max-h-40 overflow-y-auto pr-2 break-words whitespace-pre-wrap">
							{$practice.error}
						</p>
						<a class="mt-1 inline-block text-xs text-[var(--brand)] underline" href="/settings/"
							>Open settings</a
						>
					</div>
					<button
						type="button"
						class="shrink-0 text-xs text-muted-foreground"
						onclick={clearError}>dismiss</button
					>
				</div>
			{/if}
		</footer>
	</section>

	<aside class="flex flex-col overflow-y-auto border-l bg-card">
		{#if active}
			<div class="border-b p-4">
				<div class="mb-2 flex items-center justify-between">
					<span class="text-[11px] font-medium tracking-widest text-faint uppercase">Feedback</span>
					<div class="flex gap-1">
						<Button size="sm" variant="ghost" onclick={() => playRecording(active.id)}>
							<RotateCcw class="size-3.5" /> Yours
						</Button>
						<Button size="sm" variant="ghost" onclick={() => playAttempt(active.id)}>
							<Volume2 class="size-3.5" /> Natural
						</Button>
					</div>
				</div>
				{#if active.summary}
					<p class="text-sm leading-snug text-muted-foreground">{active.summary}</p>
				{/if}
			</div>

			<div class="flex-1 p-4">
				{#if active.corrections.length === 0}
					<p class="text-sm text-muted-foreground">Clean attempt. No corrections.</p>
				{:else}
					<div class="flex flex-col gap-2">
						{#each active.corrections as correction (correction.id)}
							<div
								role="button"
								tabindex="0"
								class="rounded-lg border p-2.5 transition-colors {correction.id === activeCorrectionId
									? 'border-[var(--brand)] bg-[var(--brand-soft)]'
									: 'hover:bg-[var(--surface-2)]'}"
								onclick={() => toggleCorrection(correction.id)}
								onkeydown={(event) => {
									if (event.key === 'Enter' || event.key === ' ') {
										event.preventDefault();
										toggleCorrection(correction.id);
									}
								}}
							>
								<div class="flex items-center justify-between gap-2">
									<div class="flex min-w-0 items-center gap-1.5">
										<span
											class="text-[10px] font-semibold tracking-widest uppercase {categoryClass(
												correction.category
											)}">{CATEGORY_LABEL[correction.category] ?? correction.category}</span
										>
										<span class="truncate text-[11px] text-muted-foreground"
											>{correction.label}</span
										>
									</div>
									{#if correction.speakText || correction.replacement}
										<button
											type="button"
											title="Hear it"
											class="grid size-6 shrink-0 place-items-center rounded text-[var(--brand)] hover:bg-[var(--brand-soft)]"
											onclick={(event) => {
												event.stopPropagation();
												void speakText(correction.speakText ?? correction.replacement);
											}}
										>
											<Volume2 class="size-3.5" />
										</button>
									{/if}
								</div>
								<p class="mt-1 font-serif text-[15px] leading-snug">
									{#if correction.original}
										<span
											class={correction.severity === 'error'
												? 'text-[var(--error)] line-through'
												: 'text-[var(--warn)]'}>{correction.original}</span
										>
										<span class="text-faint"> → </span>
									{/if}
									<span class="font-semibold">{correction.replacement}</span>
								</p>
								{#if correction.replacementTranslation}
									<p class="text-xs text-[var(--brand)]">{correction.replacementTranslation}</p>
								{/if}
								{#if correction.explanation}
									<p class="mt-1 text-[11px] leading-snug text-muted-foreground">
										{correction.explanation}
									</p>
								{/if}
								{#if correction.examStatus}
									<span
										class="mt-1.5 inline-block rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[9.5px] font-bold tracking-wide uppercase text-muted-foreground"
										>{EXAM_BADGE[correction.examStatus] ?? correction.examStatus}</span
									>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{:else}
			<div class="p-4">
				<p class="text-[11px] font-medium tracking-widest text-faint uppercase">Session stats</p>
				<p class="mt-3 text-sm text-muted-foreground">
					Record your first attempt to see feedback.
				</p>
			</div>
		{/if}

		<div class="border-t p-4">
			<p class="mb-3 text-[11px] font-medium tracking-widest text-faint uppercase">Session stats</p>
			<div class="flex justify-between py-1 text-sm">
				<span class="text-muted-foreground">Attempts</span><span>{stats.attempts}</span>
			</div>
			<div class="flex justify-between py-1 text-sm">
				<span class="text-muted-foreground">Words spoken</span><span>{stats.words}</span>
			</div>
			<div class="flex justify-between py-1 text-sm">
				<span class="text-muted-foreground">Speaking time</span><span>{fmtTime(stats.time)}</span>
			</div>
			<div class="flex justify-between py-1 text-sm">
				<span class="text-muted-foreground">Mistakes</span><span
					class="text-[var(--error)]">{stats.errors}</span
				>
			</div>
		</div>
	</aside>
</div>
