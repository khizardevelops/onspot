<script lang="ts">
	/**
	 * Interactive clone of the feedback sidebar that lives inline in
	 * `src/routes/+page.svelte`.
	 *
	 * It keeps the correction-list interaction (click a row to link it to the
	 * transcript mark) and the read-back buttons. The practice store and the TTS
	 * service are replaced with local state: `speakText()`/`playAttempt()` become
	 * a simulated playing state.
	 */
	import type { MockAttempt } from './MockAttemptCard.svelte';
	import { RotateCcw, Volume2 } from '@lucide/svelte';

	interface Props {
		attempts: MockAttempt[];
		active: MockAttempt | null;
		activeCorrectionId?: string | null;
		onToggleCorrection?: (correctionId: string) => void;
	}

	let {
		attempts,
		active,
		activeCorrectionId = null,
		onToggleCorrection
	}: Props = $props();

	let speaking = $state<'yours' | 'natural' | 'correction' | null>(null);
	let playbackTimer: ReturnType<typeof setTimeout> | null = null;

	function simulatePlayback(kind: 'yours' | 'natural' | 'correction') {
		speaking = kind;
		if (playbackTimer) clearTimeout(playbackTimer);
		playbackTimer = setTimeout(() => {
			if (speaking === kind) speaking = null;
			playbackTimer = null;
		}, 900);
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

	function fmtTime(seconds: number): string {
		const mins = Math.floor(seconds / 60);
		const secs = Math.floor(seconds % 60);
		return `${mins}:${String(secs).padStart(2, '0')}`;
	}

	const stats = $derived.by(() => {
		const words = attempts.reduce((sum, attempt) => sum + attempt.wordCount, 0);
		const time = attempts.reduce((sum, attempt) => sum + attempt.durationSec, 0);
		const errors = attempts.reduce(
			(sum, attempt) => sum + attempt.corrections.filter((c) => c.severity === 'error').length,
			0
		);
		return { attempts: attempts.length, words, time, errors };
	});
</script>

<aside
	class="flex flex-col overflow-y-auto border-l bg-card"
	aria-label="Feedback and session stats"
>
	{#if active}
		<div class="border-b p-4">
			<div class="mb-2 flex items-center justify-between">
				<span class="text-[11px] font-medium tracking-widest text-faint uppercase">Feedback</span>
				<div class="flex gap-1">
					<button
						type="button"
						class="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium {speaking ===
						'yours'
							? 'bg-[var(--surface-2)] text-foreground'
							: 'text-muted-foreground hover:bg-[var(--surface-2)]'}"
						onclick={() => simulatePlayback('yours')}
					>
						<RotateCcw class="size-3.5" /> Yours
					</button>
					<button
						type="button"
						class="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium {speaking ===
						'natural'
							? 'bg-[var(--surface-2)] text-foreground'
							: 'text-muted-foreground hover:bg-[var(--surface-2)]'}"
						onclick={() => simulatePlayback('natural')}
					>
						<Volume2 class="size-3.5" /> Natural
					</button>
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
							onclick={() => onToggleCorrection?.(correction.id)}
							onkeydown={(event) => {
								if (event.key === 'Enter' || event.key === ' ') {
									event.preventDefault();
									onToggleCorrection?.(correction.id);
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
									<span class="truncate text-[11px] text-muted-foreground">{correction.label}</span>
								</div>
								{#if correction.speakText || correction.replacement}
									<button
										type="button"
										title="Hear it"
										class="grid size-6 shrink-0 place-items-center rounded {speaking === 'correction'
											? 'bg-[var(--brand-soft)] text-[var(--brand)]'
											: 'text-[var(--brand)] hover:bg-[var(--brand-soft)]'}"
										onclick={(event) => {
											event.stopPropagation();
											simulatePlayback('correction');
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
				Select an attempt to see feedback.
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
			<span class="text-muted-foreground">Mistakes</span><span class="text-[var(--error)]"
				>{stats.errors}</span
			>
		</div>
	</div>
</aside>
