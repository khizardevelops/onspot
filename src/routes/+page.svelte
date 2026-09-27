<script lang="ts">
	
	import { onMount } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { goto } from '$app/navigation';
	import {
		clearError,
		deleteSession,
		newSession,
		nextPrompt,
		practice,
		renameSession,
		setSessionMode,
		startRecording,
		stopAndAnalyze
	} from '$lib/stores/practice';
	import { appSettings } from '$lib/stores/settings';
	import { languageData } from '$lib/stores/languageData';
	import { getLanguage } from '$lib/languages';
	import { toast } from '$lib/stores/toast';
	import AttemptStream from '$lib/components/AttemptStream.svelte';
	import FeedbackPanel from '$lib/components/FeedbackPanel.svelte';
	import { closeOnBack } from '$lib/platform/backButton.svelte';
	import PaperSegmentedControl from '$lib/components/PaperSegmentedControl.svelte';
	import { NeoButton } from '@dvcol/neo-svelte/buttons';
	import { NeoCard } from '@dvcol/neo-svelte/cards';
	import { NeoDialog } from '@dvcol/neo-svelte/floating/dialog';
	import type { NeoMenuItem } from '@dvcol/neo-svelte/floating/menu';
	import PopMenu from '$lib/components/PopMenu.svelte';
	import { NeoInput } from '@dvcol/neo-svelte/inputs';
	import { NeoProgressBar } from '@dvcol/neo-svelte/progress';
	import {
		AlertTriangle,
		Download,
		Loader2,
		Mic,
		MoreHorizontal,
		Pencil,
		SkipForward,
		Square,
		Trash2,
		X
	} from '@lucide/svelte';

	const BAR_COUNT = 36;
	const MODE_OPTIONS = [
		{ value: 'exam', label: 'Exam', tone: 'error' as const },
		{ value: 'casual', label: 'Casual', tone: 'brand' as const }
	];
	const language = $derived(getLanguage($appSettings.targetLanguage));
	const dataReady = $derived($languageData.status === 'ready');
	const checkingData = $derived($languageData.status === 'checking');
	/** Cloud-only setups need no local weights, so the download gate is skipped. */
	const localDataNeeded = $derived($appSettings.sttMode === 'local' || $appSettings.ttsMode === 'local');
	const sessionReady = $derived(dataReady || !localDataNeeded);
	const active = $derived(
		$practice.attempts.find((attempt) => attempt.id === $practice.activeAttemptId) ?? null
	);
	const busy = $derived($practice.phase === 'transcribing' || $practice.phase === 'evaluating');
	const recording = $derived($practice.phase === 'recording');
	const locked = $derived($practice.sessionId !== null);

	let activeCorrectionId = $state<string | null>(null);
	let lastAttemptId: string | null = null;
	let deleteOpen = $state(false);
	let coachOpen = $state(true);
	// Android Back: close the delete dialog, or the Feedback sheet on phones (where it covers the page).
	closeOnBack(() => deleteOpen, () => (deleteOpen = false));
	closeOnBack(
		() => coachOpen && matchMedia('(max-width: 640px)').matches,
		() => (coachOpen = false)
	);
	let renaming = $state(false);
	let renameValue = $state('');

	$effect(() => {
		if ($practice.activeAttemptId !== lastAttemptId) {
			lastAttemptId = $practice.activeAttemptId;
			activeCorrectionId = null;
		}
	});

	onMount(() => {
		// The transcript and recording controls deserve the first screenful on a
		// phone. Desktop keeps its review pane open until the user closes it.
		coachOpen = matchMedia('(min-width: 1024px)').matches;
	});

	function selectCorrection(_attemptId: string, correctionId: string): void {
		activeCorrectionId = correctionId;
		coachOpen = true;
	}

	function beginRename(): void {
		renameValue = $practice.prompt.title;
		renaming = true;
	}

	async function commitRename(): Promise<void> {
		const sessionId = $practice.sessionId;
		const title = renameValue.trim();
		if (!sessionId || !title || title === $practice.prompt.title) {
			renaming = false;
			return;
		}
		await renameSession(sessionId, title);
		renaming = false;
		toast('Session renamed');
	}

	async function deleteCurrent(): Promise<void> {
		const sessionId = $practice.sessionId;
		if (!sessionId) return;
		await deleteSession(sessionId);
		newSession();
		activeCorrectionId = null;
		deleteOpen = false;
		toast('Session deleted');
	}

	function fmtTime(seconds: number): string {
		const mins = Math.floor(seconds / 60);
		const secs = Math.floor(seconds % 60);
		return `${mins}:${String(secs).padStart(2, '0')}`;
	}

	/** Deterministic profile: only one CSS transform changes per bar update. */
	function waveScale(index: number): number {
		const middle = (BAR_COUNT - 1) / 2;
		const envelope = 1 - Math.abs(index - middle) / middle;
		const texture = 0.58 + Math.abs(Math.sin(index * 1.73)) * 0.42;
		return Math.max(0.1, (0.2 + envelope * texture) * (0.35 + $practice.level * 1.8));
	}

	const sessionActions: NeoMenuItem[] = [
		{ value: 'rename', label: 'Rename session', before: sessionActionIcon, divider: { bottom: true } },
		{ value: 'delete', label: 'Delete session', before: sessionActionIcon, color: 'error' }
	];

	function onSessionAction(item: NeoMenuItem): void {
		if (item.value === 'rename') beginRename();
		else if (item.value === 'delete') deleteOpen = true;
	}

	const stats = $derived.by(() => {
		const attempts = $practice.attempts;
		return {
			attempts: attempts.length,
			words: attempts.reduce((sum, attempt) => sum + attempt.wordCount, 0),
			time: attempts.reduce((sum, attempt) => sum + attempt.durationSec, 0),
			errors: attempts.reduce(
				(sum, attempt) => sum + attempt.corrections.filter((item) => item.severity === 'error').length,
				0
			)
		};
	});
</script>

<svelte:head><title>Practice · onspot</title></svelte:head>

{#snippet sessionActionIcon({ item }: { item: { value: unknown } })}
	{#if item.value === 'rename'}<Pencil size={16} />{:else}<Trash2 size={16} />{/if}
{/snippet}

<div class="practice-grid grid h-full grid-cols-1" class:coach-closed={!coachOpen}>
	<section class="practice-stage relative flex min-h-0 min-w-0 flex-col overflow-hidden">
		<div class="ambient ambient-one" aria-hidden="true"></div>
		<div class="ambient ambient-two" aria-hidden="true"></div>

		<header class="session-header paper-surface relative z-20 flex items-center justify-between gap-4 border-b px-4 py-3 sm:px-7 sm:py-4">
			<div class="min-w-0 flex-1">
				{#if renaming}
					<form class="flex max-w-md items-center gap-1" onsubmit={(event) => { event.preventDefault(); void commitRename(); }} in:fly={{ y: -5, duration: 220 }} out:fade={{ duration: 120 }}>
						<NeoInput
							bind:value={renameValue}
							aria-label="Session name"
							containerProps={{ class: 'rename-input' }}
							elevation={-2}
							rounded
							onkeydown={(event) => {
								if (event.key === 'Escape') renaming = false;
							}}
						/>
						<NeoButton type="submit" color="primary" rounded>Save</NeoButton>
						<NeoButton text rounded aria-label="Cancel rename" onclick={() => (renaming = false)}>
							{#snippet icon()}<X size={16} />{/snippet}
						</NeoButton>
					</form>
				{:else}
					<div in:fade={{ duration: 220 }}>
						<h1 class="truncate text-lg font-semibold tracking-[-0.025em] sm:text-xl">{$practice.prompt.title || 'New session'}</h1>
						<p class="mt-0.5 flex items-center gap-1.5 overflow-hidden text-xs whitespace-nowrap text-muted-foreground">
							<span>{language?.name ?? 'Language'}</span><span class="text-faint">·</span>
							<span>{$appSettings.level}</span><span class="hidden text-faint sm:inline">·</span>
							<!-- On phones the Exam / Casual switch beside it already says this. -->
							<span class="hidden sm:inline {$practice.mode === 'exam' ? 'text-[var(--error)]' : 'text-[var(--brand)]'}">
								{$practice.mode === 'exam' ? 'Exam focus' : 'Conversation'}
							</span>
						</p>
					</div>
				{/if}
			</div>

			<div class="flex shrink-0 items-center gap-1.5">
				<PaperSegmentedControl
					value={$practice.mode}
					options={MODE_OPTIONS}
					ariaLabel="Practice mode"
					disabled={locked}
					onValueChange={(value) => setSessionMode(value as 'exam' | 'casual')}
					class="practice-mode-control"
				/>

				{#if locked}
					<PopMenu items={sessionActions} placement="bottom-end" onSelect={onSessionAction} rounded>
						<NeoButton text rounded class="icon-button" aria-label="Session actions">
							{#snippet icon()}<MoreHorizontal size={16} />{/snippet}
						</NeoButton>
					</PopMenu>
				{/if}
			</div>
		</header>

		<div class="relative z-10 min-h-0 flex-1">
			<AttemptStream {activeCorrectionId} onSelectCorrection={selectCorrection} />
			{#if $practice.attempts.length === 0}
				<div class="pointer-events-none absolute inset-0 grid place-items-center px-8 pb-12" in:fade={{ duration: 420 }}>
					<div class="max-w-sm text-center">
						<div class="empty-orb mx-auto grid size-16 place-items-center rounded-[22px] text-white shadow-xl"><Mic class="size-7" /></div>
						<p class="mt-5 text-lg font-semibold tracking-tight">Your speaking timeline starts here</p>
						<p class="mt-1.5 text-sm leading-relaxed text-muted-foreground">Each take will glide into place, with corrections linked directly to your words.</p>
					</div>
				</div>
			{/if}
		</div>

		<footer class="composer-wrap relative z-20 px-3 pb-0 sm:px-6 sm:pb-0">
			<NeoCard class="composer-card" spacing="1rem 1rem 0.75rem" width="100%" elevation={3} glass borderless>
					{#key $practice.phase}
						<div in:fly={{ y: 10, duration: 320, opacity: 0 }} out:fade={{ duration: 140 }}>
							{#if busy}
								<div class="flex items-center gap-3" aria-live="polite">
									<div class="grid size-10 shrink-0 place-items-center rounded-2xl bg-[var(--brand-soft)] text-[var(--brand)]"><Loader2 class="size-5 animate-spin" /></div>
									<div class="min-w-0 flex-1">
										<div class="flex items-center justify-between gap-3 text-sm">
											<span class="truncate font-medium">{$practice.statusText || 'Working…'}</span>
											{#if $practice.progress}<span class="shrink-0 font-mono text-xs text-muted-foreground">{$practice.progress.progress}%</span>{/if}
										</div>
										<NeoProgressBar
											class="composer-progress mt-2"
											value={$practice.progress?.progress ?? ($practice.phase === 'evaluating' ? 92 : 8)}
											color="linear-gradient(90deg, var(--brand), var(--brand-2))"
											elevation={-1}
											rounded
										/>
									</div>
								</div>
							{:else if recording}
								<div class="flex flex-col gap-3 sm:flex-row sm:items-center">
									<div class="waveform flex h-12 min-w-0 flex-1 items-center justify-center gap-[3px]" aria-hidden="true">
										{#each Array(BAR_COUNT) as _, index (index)}
											<span class="h-9 w-[3px] origin-center rounded-full bg-[linear-gradient(180deg,var(--brand-2),var(--brand))] transition-transform duration-75" style={`transform: scaleY(${waveScale(index)})`}></span>
										{/each}
									</div>
									<div class="flex shrink-0 items-center justify-between gap-3 sm:justify-end">
										<span class="font-mono text-sm text-muted-foreground tabular-nums"><span class="text-foreground">{fmtTime($practice.elapsed)}</span> / 1:00</span>
										<NeoButton color="error" rounded class="composer-action" onclick={() => stopAndAnalyze()}>
											{#snippet icon()}<Square size={14} />{/snippet}
											Stop & analyze
										</NeoButton>
									</div>
								</div>
							{:else}
								<div class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
									<div class="min-w-0">
										<p class="eyebrow">Your prompt</p>
										<p class="mt-1.5 max-w-[58ch] font-serif text-lg leading-snug font-medium sm:text-xl">{$practice.prompt.text}</p>
									</div>
									<div class="composer-actions flex shrink-0 flex-wrap gap-2">
										<NeoButton rounded class="composer-action" onclick={() => nextPrompt()}>
											{#snippet icon()}<SkipForward size={16} />{/snippet}
											New prompt
										</NeoButton>
										{#if sessionReady}
											<NeoButton rounded class="composer-action record-button solid-action" onclick={() => startRecording()}>
												{#snippet icon()}<Mic size={16} />{/snippet}
												Start speaking
											</NeoButton>
										{:else}
											<NeoButton rounded color="primary" class="composer-action" onclick={() => goto('/settings/')}>
												{#snippet icon()}<Download size={16} />{/snippet}
												Language data
											</NeoButton>
										{/if}
									</div>
								</div>
								{#if !sessionReady}
									<div class="data-notice mt-3 flex items-start gap-2.5 rounded-xl border border-[var(--warn)]/30 bg-[var(--warn-soft)] p-3 text-sm" role="status" in:fly={{ y: 6, duration: 240 }}>
										<AlertTriangle class="mt-0.5 size-4 shrink-0 text-[var(--warn)]" />
										<p class="min-w-0 leading-relaxed">
											{#if checkingData}
												Checking {language?.name ?? 'language'} data…
											{:else}
												<!-- Phones get the short version: the button beside it already goes to Settings. -->
												<span class="sm:hidden">Download the {language?.name ?? 'language'} speech data in Settings to start.</span>
												<span class="hidden sm:inline">
													Before your first session, open
													<a class="font-medium text-[var(--brand)] underline underline-offset-4" href="/settings/">Settings → Language data</a>
													and click <strong>Download</strong>. That installs the approved speech and voice models for {language?.name ?? 'your language'}.
												</span>
											{/if}
										</p>
									</div>
								{/if}
							{/if}
						</div>
					{/key}

					{#if $practice.error}
						<div class="mt-4 flex items-start gap-2.5 rounded-xl border border-[var(--error)]/25 bg-[var(--error-soft)] p-3 text-sm" role="alert" in:fly={{ y: 8, duration: 260 }} out:fade={{ duration: 140 }}>
							<AlertTriangle class="mt-0.5 size-4 shrink-0 text-[var(--error)]" />
							<div class="min-w-0 flex-1">
								<p class="max-h-32 overflow-y-auto break-words whitespace-pre-wrap">{$practice.error}</p>
								<a class="mt-1 inline-block text-xs font-medium text-[var(--brand)] underline underline-offset-4" href="/settings/">Open settings</a>
							</div>
							<NeoButton text rounded class="icon-button" aria-label="Dismiss error" onclick={clearError}>
								{#snippet icon()}<X size={16} />{/snippet}
							</NeoButton>
						</div>
					{/if}
			</NeoCard>
		</footer>
	</section>

	<!-- Phones: Feedback opens as a sheet over the page; tapping outside closes it. -->
	{#if coachOpen}
		<button type="button" class="coach-scrim" aria-label="Close feedback" onclick={() => (coachOpen = false)}></button>
	{/if}
	<FeedbackPanel attempt={active} {activeCorrectionId} {stats} bind:open={coachOpen} onSelectCorrection={selectCorrection} />
</div>

<!-- neo-svelte 1.2.0 does not export NeoDialogConfirm, so the confirm is composed from NeoDialog. -->
<NeoDialog bind:open={deleteOpen} portal rounded filled elevation={3} aria-labelledby="delete-session-title" aria-describedby="delete-session-body">
	<div class="confirm-dialog">
		<span class="grid size-10 place-items-center rounded-xl bg-[var(--error-soft)] text-[var(--error)]"><Trash2 size={18} /></span>
		<p id="delete-session-title" class="mt-3 text-base font-semibold">Delete this session?</p>
		<p id="delete-session-body" class="mt-1.5 text-sm leading-relaxed text-muted-foreground">
			Every attempt, correction, and saved recording in this session will be removed. This cannot be undone.
		</p>
		<div class="mt-5 flex justify-end gap-2">
			<NeoButton rounded onclick={() => (deleteOpen = false)}>Keep session</NeoButton>
			<NeoButton rounded color="error" onclick={() => { deleteOpen = false; void deleteCurrent(); }}>Delete session</NeoButton>
		</div>
	</div>
</NeoDialog>

<style>
	.practice-grid {
		/* Neo components reserve a shadow margin by default; this layout spaces them itself. */
		--neo-shadow-margin: 0;
		--neo-shadow-margin-lg: 0;
		/* Transparent so the app's paper texture shows behind the practice stage. */
		background: transparent;
		transition: grid-template-columns 420ms cubic-bezier(0.22, 1, 0.36, 1), grid-template-rows 420ms cubic-bezier(0.22, 1, 0.36, 1);
	}
	.practice-stage {
		isolation: isolate;
		/* The app's paper shows through; only the faint brand glow sits on it. */
		background: radial-gradient(circle at 8% 4%, color-mix(in srgb, var(--brand-2) 10%, transparent), transparent 28%);
	}
	/* The header is cut from the same sheet as the page (see .paper-surface), not frosted glass. */
	.session-header { box-shadow: 0 1px 0 color-mix(in srgb, white 40%, transparent); }
	:global([data-theme='dark']) .session-header { box-shadow: 0 1px 0 rgba(255, 255, 255, 0.03); }
	/* Takes scrolling under the composer fade into paper, not into a flat colour. */
	.composer-wrap::before {
		content: '';
		position: absolute;
		inset: 0;
		z-index: -1;
		pointer-events: none;
		background: var(--background) var(--paper-page, none) center / cover fixed;
		mask-image: linear-gradient(180deg, transparent, #000 35%);
	}
	/* The composer is a glass neo card docked to the window bottom. */
	.composer-wrap :global(.neo-card.composer-card.composer-card) {
		margin: 0;
		border-radius: 22px 22px 0 0;
	}
	@media (min-width: 640px) {
		.composer-wrap :global(.neo-card.composer-card.composer-card) { padding: 1.25rem 1.25rem 0.75rem; }
	}
	.composer-wrap :global(.neo-button.composer-action) { height: 40px; padding-inline: 14px; gap: 6px; font-weight: 500; }
	.composer-wrap :global(.neo-button.record-button) { background: linear-gradient(120deg, var(--brand), var(--brand-2)); color: var(--primary-foreground); font-weight: 600; }
	.composer-wrap :global(.neo-button.record-button:hover) { filter: brightness(1.07); }
	.composer-wrap :global(.composer-progress) { height: 6px; }
	.practice-grid :global(.neo-button.icon-button) { width: 36px; height: 36px; padding: 0; justify-content: center; color: var(--muted-foreground); }
	:global(.rename-input) { min-width: 0; flex: 1; }
	.confirm-dialog { max-width: 24rem; padding: 0.5rem; }
	.empty-orb { background: linear-gradient(145deg, var(--brand), var(--brand-2) 60%, var(--brand-3)); }
	.ambient { position: absolute; z-index: -1; border-radius: 999px; pointer-events: none; opacity: 0.5; }
	.ambient-one { top: 10%; right: 8%; width: 15rem; height: 15rem; background: radial-gradient(circle, color-mix(in srgb, var(--brand-2) 14%, transparent), transparent 68%); }
	.ambient-two { bottom: 18%; left: 2%; width: 12rem; height: 12rem; background: radial-gradient(circle, color-mix(in srgb, var(--brand-3) 12%, transparent), transparent 68%); }
	@media (prefers-reduced-motion: reduce) {
		.practice-grid { transition-duration: 1ms; }
		.waveform span { transition-duration: 1ms !important; }
	}
	@media (min-width: 1024px) {
		.practice-grid { grid-template-columns: minmax(0, 1fr) clamp(330px, 31vw, 440px); }
		.practice-grid.coach-closed { grid-template-columns: minmax(0, 1fr) 64px; }
	}
	@media (max-width: 1023px) {
		.practice-grid { grid-template-rows: minmax(0, 1fr) 42%; }
		/* Closed feedback is a handle, not a second mobile toolbar. */
		.practice-grid.coach-closed { grid-template-rows: minmax(0, 1fr) 36px; }
	}
	.coach-scrim { display: none; }

	/*
	 * Phones. There is no room to split the screen between takes, composer and
	 * feedback, so Feedback is a bottom sheet over the page (the layout keeps
	 * only its 36px handle) and the composer is compact.
	 */
	@media (max-width: 640px) {
		.practice-grid,
		.practice-grid.coach-closed { grid-template-rows: minmax(0, 1fr) 36px; }
		.practice-grid:not(.coach-closed) :global(aside.feedback-shell) {
			position: fixed;
			inset: auto 0 0 0;
			z-index: 70;
			height: min(82dvh, calc(100% - 56px));
			border-top: 1px solid var(--sheet-line);
			border-radius: 20px 20px 0 0;
			background-color: var(--card);
			box-shadow: var(--shadow-float);
			animation: sheet-in 200ms cubic-bezier(0.22, 1, 0.36, 1);
		}
		.coach-scrim {
			display: block;
			position: fixed;
			inset: 0;
			z-index: 65;
			border: 0;
			background: color-mix(in srgb, #000 32%, transparent);
			animation: scrim-in 200ms ease-out;
		}
		.composer-wrap { padding-inline: 8px; }
		.composer-wrap :global(.neo-card.composer-card.composer-card) { padding: 0.875rem 0.875rem 0.625rem; }
		/* Two equal actions, primary on the right, rather than two stray pills. */
		.composer-actions { display: grid; grid-template-columns: 1fr 1fr; }
		.composer-wrap :global(.composer-actions .neo-button.composer-action) { justify-content: center; height: 44px; }
		.data-notice { margin-top: 0.625rem; padding: 0.5rem 0.625rem; font-size: 0.8125rem; }
	}
	@keyframes sheet-in { from { transform: translateY(100%); } }
	@keyframes scrim-in { from { opacity: 0; } }
	@media (prefers-reduced-motion: reduce) {
		.practice-grid :global(aside.feedback-shell), .coach-scrim { animation: none !important; }
	}
</style>
