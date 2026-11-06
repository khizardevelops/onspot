<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

<script lang="ts">
	/**
	 * The practice screen: the bar with the prompt and its controls, the stack
	 * of takes, and the Feedback panel (a sidebar on desktop, a sheet on
	 * phones). The Practice page shows the learner's own session on it;
	 * Settings → Text size's live preview shows a sample session on the very
	 * same screen, so what the learner sizes there is what a session looks
	 * like. A sample session is not live (see `stores/practiceSession.ts`):
	 * the bar's real work (recording, a new prompt, renaming or deleting the
	 * session, the mode) does nothing and those keys are inert, the setup and
	 * usage notices are left out, and the navigation cannot leave the preview;
	 * scrolling the takes, folding their parts and Feedback work as usual.
	 */
	import { pageHref } from '#lib/pages.js';

	import { flushSync, onMount, untrack } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { goto } from '$app/navigation';
	import * as learnerSession from '#lib/stores/practice.js';
	import { LEARNER_SESSION, providePracticeSession, type PracticeSession } from '#lib/stores/practiceSession.js';
	import { appSettings } from '#lib/stores/settings.js';
	import { languageData } from '#lib/stores/languageData.js';
	import { reminders, snoozeReminders } from '#lib/stores/reminders.js';
	import {
		firstMissingRequirement,
		processingReady,
		processingRequirements
	} from '#lib/stores/processing.js';
	import { getLanguage } from '#lib/languages/index.js';
	import { exportSessionTranscript } from '#lib/utils/sessionTranscript.js';
	import { usageWarnings } from '#lib/usage/monitor.js';
	import { pacingWait } from '#lib/adapters/llm/index.js';
	import { toast } from '#lib/stores/toast.js';
	import { MAX_RECORDING_SEC } from '#lib/config.js';
	import AppHeader from '#lib/components/AppHeader.svelte';
	import AttemptStream from '#lib/components/AttemptStream.svelte';
	import FeedbackPanel from '#lib/components/FeedbackPanel.svelte';
	import { closeOnBack } from '#lib/platform/backButton.svelte.js';
	import { SwipeToOpen } from '#lib/gestures/swipeToOpen.js';
	import PaperSegmentedControl from '#lib/components/PaperSegmentedControl.svelte';
	import { NeoButton } from '@dvcol/neo-svelte/buttons';
	import { NeoDialog } from '@dvcol/neo-svelte/floating/dialog';
	import { quickDialog } from '#lib/neo.js';
	import type { NeoMenuItem } from '@dvcol/neo-svelte/floating/menu';
	import PopMenu from '#lib/components/PopMenu.svelte';
	import { NeoInput } from '@dvcol/neo-svelte/inputs';
	import { NeoProgressBar } from '@dvcol/neo-svelte/progress';
	import {
		AlertTriangle,
		Bell,
		Check,
		Download,
		KeyRound,
		Layers,
		Loader2,
		MessageSquareText,
		Mic,
		MoreHorizontal,
		Pencil,
		SkipForward,
		Square,
		Trash2,
		X
	} from '@lucide/svelte';

	interface Props {
		/** The session shown: the learner's own unless given (the text-size preview's sample). */
		session?: PracticeSession;
	}

	let { session = LEARNER_SESSION }: Props = $props();
	// A screen shows one session for its whole life.
	const { state: practice, live } = untrack(() => session);
	providePracticeSession(untrack(() => session));

	/** The bar's real work, done only in a live session; a sample session's keys look the same and do nothing. */
	function whenLive<Args extends unknown[]>(action: (...args: Args) => unknown): (...args: Args) => void {
		return (...args) => {
			if (live) void action(...args);
		};
	}
	const cancelRecording = whenLive(learnerSession.cancelRecording);
	const clearError = whenLive(learnerSession.clearError);
	const newSession = whenLive(learnerSession.newSession);
	const nextPrompt = whenLive(learnerSession.nextPrompt);
	const setSessionMode = whenLive(learnerSession.setSessionMode);
	const startRecording = whenLive(learnerSession.startRecording);
	const stopAndAnalyze = whenLive(learnerSession.stopAndAnalyze);

	const BAR_COUNT = 36;
	const MODE_OPTIONS = [
		{ value: 'exam', label: 'Exam', tone: 'error' as const },
		{ value: 'casual', label: 'Casual', tone: 'brand' as const }
	];
	const language = $derived(getLanguage($appSettings.targetLanguage));
	const checkingData = $derived($languageData.status === 'checking');
	/* A sample session is ready by definition: its bar shows the key a ready session has. */
	const sessionReady = $derived(!live || $processingReady);
	const firstMissing = $derived($firstMissingRequirement);
	const missingRequirements = $derived(
		$processingRequirements.filter((requirement) => !requirement.met)
	);
	const setupHash = $derived(
		firstMissing?.target === 'speech-to-text'
			? `${pageHref('/settings')}#speech-to-text`
			: firstMissing?.target === 'llm'
				? pageHref('/welcome')
				: `${pageHref('/settings')}#text-to-speech`
	);
	const setupLabel = $derived(
		firstMissing?.id.endsWith('-download')
			? 'Install data'
			: firstMissing
				? `Set up ${firstMissing.title}`
				: 'Finish setup'
	);
	const active = $derived(
		$practice.attempts.find((attempt) => attempt.id === $practice.activeAttemptId) ?? null
	);
	const busy = $derived($practice.phase === 'transcribing' || $practice.phase === 'evaluating');

	/** A feedback request waiting for room under the provider's per-minute limit says so, instead of looking stuck. */
	const waitingText = $derived.by(() => {
		if ($practice.phase !== 'evaluating' || !$pacingWait) return null;
		const seconds = Math.max(1, Math.ceil(($pacingWait.until - Date.now()) / 1000));
		return `${$pacingWait.provider}'s per-minute limit: continuing in ${seconds} s…`;
	});
	const recording = $derived($practice.phase === 'recording');
	const locked = $derived($practice.sessionId !== null);
	/*
	 * The ambience follows the live practice mode. The mode can only be
	 * switched in a draft, so the glare has to react there; once a session has
	 * takes the mode is locked and the glare simply stays with it.
	 */
	const glareTone = $derived($practice.mode === 'exam' ? 'exam' : 'casual');

	let activeCorrectionId = $state<string | null>(null);
	let lastAttemptId: string | null = null;
	let deleteOpen = $state(false);
	let coachOpen = $state(true);
	/** How narrow the Feedback sidebar can be without its toolbar or cards laying out differently (desktop only). */
	let feedbackContentWidth = $state<number | null>(null);
	/** That width as the `--feedback-content-width` the grid and the bookmark are sized by (none: the maximum). */
	const feedbackContentWidthStyle = $derived(feedbackContentWidth === null ? undefined : `${feedbackContentWidth}px`);
	/** How far a swipe has taken the Feedback sheet towards closing (0 to 1); the shade behind it fades with it. */
	let feedbackSwipeProgress = $state(0);
	/** The session's paper timeline; on phones it opens from a button in the top bar. */
	let timelineOpen = $state(false);
	/** Phone layout: Feedback and the timeline open from the top bar, and the mode moves into the session menu. */
	let phone = $state(false);
	// Android Back: close the delete dialog, the timeline, or the Feedback sheet on phones (where it covers the page).
	closeOnBack(() => deleteOpen, () => (deleteOpen = false));
	closeOnBack(() => timelineOpen, () => (timelineOpen = false));
	closeOnBack(
		() => coachOpen && phone,
		() => (coachOpen = false)
	);
	let renaming = $state(false);
	let renameValue = $state('');

	/*
	 * Phones: swiping up on the bar pulls the Feedback sheet up with the finger
	 * (the bar's Feedback button still opens it with a tap). Its shade came in
	 * with the finger too, so it must not fade in again once the sheet is open.
	 */
	let bar = $state<HTMLElement>();
	let feedbackSheet = $state<HTMLElement>();
	let pulledOpen = $state(false);

	$effect(() => {
		if (!bar) return;
		const pullUp = new SwipeToOpen({
			surface: () => feedbackSheet,
			enabled: () => phone && !coachOpen,
			onPullStart: () => {
				pulledOpen = true;
				feedbackSwipeProgress = 1;
				coachOpen = true;
				flushSync();
			},
			onPullCancel: () => (coachOpen = false),
			onProgress: (openness) => (feedbackSwipeProgress = 1 - openness)
		});
		return pullUp.listen(bar);
	});

	// However it closes, it opens with its rise the next time unless pulled again.
	$effect(() => {
		if (!coachOpen) pulledOpen = false;
	});

	$effect(() => {
		if ($practice.activeAttemptId !== lastAttemptId) {
			lastAttemptId = $practice.activeAttemptId;
			activeCorrectionId = null;
		}
	});

	/** The most serious usage problem, shown under the prompt so a take does not fail on a spent limit. */
	const usageWarning = $derived($usageWarnings[0] ?? null);
	const otherUsageWarnings = $derived(Math.max(0, $usageWarnings.length - 1));

	onMount(() => {
		// The transcript and recording controls deserve the first screenful on a
		// phone. Desktop keeps its review pane open until the user closes it.
		const desktop = matchMedia('(min-width: 1024px)');
		coachOpen = desktop.matches;
		// Crossing the breakpoint resets the pane, or a desktop-open review pane
		// would arrive on a phone as a sheet covering the recording controls.
		const sync = (event: MediaQueryListEvent) => (coachOpen = event.matches);
		desktop.addEventListener('change', sync);

		const phoneQuery = matchMedia('(max-width: 640px)');
		phone = phoneQuery.matches;
		const syncPhone = (event: MediaQueryListEvent) => (phone = event.matches);
		phoneQuery.addEventListener('change', syncPhone);

		return () => {
			desktop.removeEventListener('change', sync);
			phoneQuery.removeEventListener('change', syncPhone);
		};
	});

	/** The take on top has this many corrections; the phone's Feedback button shows the count. */
	const correctionCount = $derived(active?.corrections.length ?? 0);
	/** Its errors, shown on the bookmark that reopens a collapsed Feedback panel. */
	const errorCount = $derived(active?.corrections.filter((correction) => correction.severity === 'error').length ?? 0);

	function selectCorrection(attemptId: string, correctionId: string): void {
		// A correction in another take selects that take too, or Feedback would
		// keep showing the previous take's list. Recording the id first stops the
		// effect above from clearing the correction it is about to show.
		if (attemptId !== $practice.activeAttemptId) {
			lastAttemptId = attemptId;
			session.setActiveAttempt(attemptId);
		}
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
		if (!live || !sessionId || !title || title === $practice.prompt.title) {
			renaming = false;
			return;
		}
		try {
			await learnerSession.renameSession(sessionId, title);
			renaming = false;
			toast('Session renamed');
		} catch (error) {
			toast(error instanceof Error ? `Could not rename: ${error.message}` : 'Could not rename the session.');
		}
	}

	async function deleteCurrent(): Promise<void> {
		const sessionId = $practice.sessionId;
		if (!live || !sessionId) return;
		try {
			await learnerSession.deleteSession(sessionId);
		} catch (error) {
			toast(error instanceof Error ? `Could not delete: ${error.message}` : 'Could not delete the session.');
			return;
		}
		newSession();
		activeCorrectionId = null;
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

	/*
	 * The session menu. On phones the Exam / Casual switch does not fit the top
	 * bar, so a session that can still change mode offers it here instead.
	 */
	const sessionActions = $derived<NeoMenuItem[]>(
		locked
			? [
					{ value: 'export', label: 'Export transcript', before: sessionActionIcon, divider: { bottom: true } },
					{ value: 'rename', label: 'Rename session', before: sessionActionIcon, divider: { bottom: true } },
					{ value: 'delete', label: 'Delete session', before: sessionActionIcon, color: 'error' }
				]
			: [
					{
						value: 'mode',
						label: 'Practice mode',
						section: true,
						items: MODE_OPTIONS.map((option) => ({
							value: `mode:${option.value}`,
							label: option.value === 'exam' ? 'Exam focus' : 'Conversation',
							after: modeCheck
						}))
					}
				]
	);
	/** Desktop shows the session menu once there is a session to rename; phones always need it for the mode. */
	const showSessionMenu = $derived((locked || phone) && !busy && !recording);

	function onSessionAction(item: NeoMenuItem): void {
		const key = String(item.value);
		if (key === 'export') void exportCurrentTranscript();
		else if (key === 'rename') beginRename();
		else if (key === 'delete') deleteOpen = true;
		else if (key.startsWith('mode:')) setSessionMode(key.slice(5) as 'exam' | 'casual');
	}

	async function exportCurrentTranscript(): Promise<void> {
		const sessionId = $practice.sessionId;
		if (!live || !sessionId) return;
		try {
			if (await exportSessionTranscript(sessionId)) toast('Transcript exported');
		} catch (error) {
			toast(error instanceof Error ? `Could not export: ${error.message}` : 'Could not export the transcript.');
		}
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

{#snippet sessionActionIcon({ item }: { item: { value: unknown } })}
	{#if item.value === 'export'}<Download size={16} />{:else if item.value === 'rename'}<Pencil size={16} />{:else}<Trash2 size={16} />{/if}
{/snippet}

{#snippet sessionLine()}
	<span class="truncate">{$practice.prompt.title || 'New session'}</span><span class="text-faint">·</span>
	<span class="shrink-0">{language?.name ?? 'Language'}</span><span class="text-faint">·</span>
	<span class="shrink-0">{$appSettings.level}</span><span class="text-faint">·</span>
	<span class="shrink-0 {$practice.mode === 'exam' ? 'text-[var(--error)]' : 'text-[var(--brand)]'}">
		{$practice.mode === 'exam' ? 'Exam focus' : 'Conversation'}
	</span>
{/snippet}

<!--
	The bar's main action: start speaking (or finish setup first), stop and
	analyse, or cancel the work in progress. Phones show it as a round icon.
-->
{#snippet mainAction()}
	{#if busy}
		<!-- A slow provider must not hold the learner hostage until its timeout. -->
		<NeoButton text rounded class="bar-action" onclick={cancelRecording}>Cancel</NeoButton>
	{:else if recording}
		<NeoButton color="error" rounded class="bar-action main-action" aria-label="Stop and analyze" onclick={() => stopAndAnalyze()}>
			{#snippet icon()}<Square size={14} />{/snippet}
			<!-- Phones: icon only, so it sits centred in the round button (neo spaces any label). -->
			{#if !phone}<span>Stop & analyze</span>{/if}
		</NeoButton>
	{:else if sessionReady}
		<NeoButton rounded class="bar-action main-action record-button solid-action" aria-label="Start speaking" inert={!live} onclick={() => startRecording()}>
			{#snippet icon()}<Mic size={16} />{/snippet}
			{#if !phone}<span>Start speaking</span>{/if}
		</NeoButton>
	{:else}
		<NeoButton rounded color="primary" class="bar-action" onclick={() => goto(setupHash)}>
			{#snippet icon()}
				{#if firstMissing?.id.endsWith('-download')}<Download size={16} />{:else}<KeyRound size={16} />{/if}
			{/snippet}
			{setupLabel}
		</NeoButton>
	{/if}
{/snippet}

<!--
	Phones: the bar's second row, under the prompt: every button, the
	recording or the progress when there is one, and the main action last,
	under the thumb. (The navigation menu starts the row; see AppHeader.) The
	session line is left out: it cost room for nothing on a phone.
-->
{#snippet phoneRow()}
	{#if recording}
		{@render recordingLevel()}
		<NeoButton text rounded class="icon-button bar-button" aria-label="Discard this take" onclick={cancelRecording}>
			{#snippet icon()}<X size={16} />{/snippet}
		</NeoButton>
	{:else if busy}
		{@render workInProgress()}
	{:else}
		<span class="min-w-0 flex-1" aria-hidden="true"></span>
	{/if}
	{#if !recording && !busy}
		<NeoButton text rounded class="icon-button bar-button" aria-label="New prompt" inert={!live} onclick={() => nextPrompt()}>
			{#snippet icon()}<SkipForward size={15} />{/snippet}
		</NeoButton>
	{/if}
	{#if $practice.attempts.length > 0}
		<NeoButton
			text
			rounded
			class="icon-button bar-button"
			aria-label="Takes in this session"
			aria-controls="paper-timeline"
			aria-expanded={timelineOpen}
			data-timeline-toggle
			onclick={() => (timelineOpen = !timelineOpen)}
		>
			{#snippet icon()}<Layers size={16} />{/snippet}
		</NeoButton>
	{/if}
	<NeoButton
		text
		rounded
		class="icon-button bar-button"
		aria-label={correctionCount ? `Feedback, ${correctionCount} correction${correctionCount === 1 ? '' : 's'}` : 'Feedback'}
		aria-expanded={coachOpen}
		onclick={() => (coachOpen = !coachOpen)}
	>
		{#snippet icon()}
			<span class="relative grid place-items-center">
				<MessageSquareText size={16} />
				{#if correctionCount > 0}<span class="bar-badge">{correctionCount}</span>{/if}
			</span>
		{/snippet}
	</NeoButton>
	{#if showSessionMenu}
		<PopMenu items={sessionActions} placement="top-end" onSelect={onSessionAction} rounded>
			<NeoButton text rounded class="icon-button bar-button" aria-label="Session actions" inert={!live}>
				{#snippet icon()}<MoreHorizontal size={16} />{/snippet}
			</NeoButton>
		</PopMenu>
	{/if}
	{@render mainAction()}
{/snippet}

<!-- Desktop: the prompt's controls beside it in the one row. -->
{#snippet desktopActions()}
	{#if busy}
		{@render workInProgress()}
	{:else if recording}
		{@render recordingLevel()}
		<NeoButton text rounded class="icon-button" aria-label="Discard this take" title="Discard this take" onclick={cancelRecording}>
			{#snippet icon()}<X size={16} />{/snippet}
		</NeoButton>
	{:else}
		<NeoButton text rounded class="icon-button" aria-label="New prompt" title="New prompt" inert={!live} onclick={() => nextPrompt()}>
			{#snippet icon()}<SkipForward size={16} />{/snippet}
		</NeoButton>
	{/if}
	{@render mainAction()}

	<!-- The mode is fixed while a take is recorded or processed, so the switch makes room then. -->
	{#if !recording && !busy}
		<span class="bar-divider" aria-hidden="true"></span>
		<PaperSegmentedControl
			value={$practice.mode}
			options={MODE_OPTIONS}
			ariaLabel="Practice mode"
			disabled={locked}
			lockedHint="The mode is fixed once a session has takes. Start a new session to switch."
			onValueChange={(value) => setSessionMode(value as 'exam' | 'casual')}
			size="sm"
			class="practice-mode-control"
		/>
		<!-- Renaming or deleting mid-take would race the take being saved into this session. -->
		{#if showSessionMenu}
			<PopMenu items={sessionActions} placement="bottom-end" onSelect={onSessionAction} rounded>
				<NeoButton text rounded class="icon-button" aria-label="Session actions" inert={!live}>
					{#snippet icon()}<MoreHorizontal size={16} />{/snippet}
				</NeoButton>
			</PopMenu>
		{/if}
	{/if}
{/snippet}

<!-- The live level and the timer while recording. -->
{#snippet recordingLevel()}
	<div class="bar-recording" in:fade={{ duration: 160 }}>
		<div class="waveform" aria-hidden="true">
			{#each Array(BAR_COUNT) as _, index (index)}
				<span style={`transform: scaleY(${waveScale(index)})`}></span>
			{/each}
		</div>
		<span class="bar-timer"><span class="text-foreground">{fmtTime($practice.elapsed)}</span><span class="max-sm:hidden"> / {fmtTime(MAX_RECORDING_SEC)}</span></span>
	</div>
{/snippet}

<!-- Transcribing or evaluating: what is happening and how far along. -->
{#snippet workInProgress()}
	<div class="bar-busy" aria-live="polite" in:fade={{ duration: 160 }}>
		<Loader2 class="size-4 shrink-0 animate-spin text-[var(--brand)]" />
		<div class="min-w-0 flex-1">
			<div class="flex items-center justify-between gap-2 text-[12px]">
				<span class="truncate font-medium">{waitingText ?? ($practice.statusText || 'Working…')}</span>
				{#if $practice.progress}<span class="shrink-0 font-mono text-[11px] text-muted-foreground">{$practice.progress.progress}%</span>{/if}
			</div>
			<NeoProgressBar
				class="bar-progress mt-1"
				value={$practice.progress?.progress ?? ($practice.phase === 'evaluating' ? 92 : 8)}
				color="linear-gradient(90deg, var(--brand), var(--brand-2))"
				elevation={-1}
				rounded
			/>
		</div>
	</div>
{/snippet}

{#snippet modeCheck({ item }: { item: { value: unknown } })}
	<Check size={15} class="menu-check {String(item.value) === `mode:${$practice.mode}` ? '' : 'invisible'}" aria-hidden="true" />
{/snippet}

<div
	class="practice-grid relative grid h-full grid-cols-1"
	data-glare={glareTone}
	class:coach-closed={!coachOpen}
	class:pulled-open={pulledOpen}
	style:--feedback-content-width={feedbackContentWidthStyle}
>
	<section class="practice-stage relative flex min-h-0 min-w-0 flex-col overflow-hidden">
		<div class="ambient ambient-one" aria-hidden="true"></div>
		<div class="ambient ambient-two" aria-hidden="true"></div>
		<div class="ambient ambient-three" aria-hidden="true"></div>

		<!--
			One bar for the whole page: navigation, the prompt (or the recording, or
			the work in progress) and its controls, the mode and the session menu.
			Phones split it in two rows inside the same bar: the prompt above, every
			button below; swiping up on it pulls Feedback up.
		-->
		<AppHeader below={phone ? phoneRow : undefined} actions={phone ? undefined : desktopActions} preview={!live} bind:element={bar}>
			{#snippet heading()}
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
					<!-- The prompt is the page's heading in every phase (it is what the learner talks about); the session is the line under it. -->
					<div class="bar-prompt" in:fade={{ duration: 200 }}>
						<h1 class="prompt-text" data-text-section="prompt" title={$practice.prompt.text}>{$practice.prompt.text}</h1>
						{#if !phone}<p class="session-line">{@render sessionLine()}</p>{/if}
					</div>
				{/if}
			{/snippet}
		</AppHeader>

		<!-- Setup, usage, reminders and errors: a slim strip under the bar, only when there is something to say (and never for a sample session). -->
		{#if live && ($practice.error || (!busy && !recording && (!sessionReady || usageWarning || ($reminders.ready && $reminders.due && sessionReady))))}
			<div class="bar-notices" in:fly={{ y: -6, duration: 220 }} out:fade={{ duration: 140 }}>
				{#if $practice.error}
					<div class="bar-notice" data-tone="error" role="alert">
						<AlertTriangle class="mt-0.5 size-4 shrink-0" />
						<div class="min-w-0 flex-1">
							<p class="max-h-24 overflow-y-auto break-words whitespace-pre-wrap">{$practice.error}</p>
							<a class="text-xs font-medium text-[var(--brand)] underline underline-offset-4" href={pageHref('/settings')}>Open settings</a>
						</div>
						<NeoButton text rounded class="icon-button" aria-label="Dismiss error" onclick={clearError}>
							{#snippet icon()}<X size={16} />{/snippet}
						</NeoButton>
					</div>
				{/if}
				{#if !busy && !recording && !sessionReady}
					<div class="bar-notice" data-tone="warn" role="status">
						<AlertTriangle class="mt-0.5 size-4 shrink-0" />
						<p class="min-w-0">
							{#if checkingData}
								Checking {language?.name ?? 'language'} data…
							{:else if firstMissing}
								<span class="sm:hidden">{firstMissing.title} is not ready.</span>
								<span class="hidden sm:inline">
									Before you start, finish setup:
									{#if missingRequirements.length === 1}
										{firstMissing.detail}
									{:else}
										{missingRequirements.map((requirement) => requirement.title).join(' · ')}.
									{/if}
								</span>
								<a class="font-medium text-[var(--brand)] underline underline-offset-4" href={setupHash}>Open Settings</a>
							{:else}
								Finish setup in Settings before you start speaking.
							{/if}
						</p>
					</div>
				{:else if !busy && !recording && usageWarning}
					{@const tone = usageWarning.level === 'error' ? 'error' : 'warn'}
					<div class="bar-notice usage-notice" data-tone={tone} role="status">
						<AlertTriangle class="mt-0.5 size-4 shrink-0" />
						<p class="min-w-0">
							{usageWarning.message}
							{#if otherUsageWarnings > 0}<span class="text-muted-foreground"> (+{otherUsageWarnings} more)</span>{/if}
							<a class="font-medium text-[var(--brand)] underline underline-offset-4" href={`${pageHref('/settings')}#usage`}>See usage</a>
						</p>
					</div>
				{/if}
				{#if !busy && !recording && sessionReady && $reminders.ready && $reminders.due}
					<div class="bar-notice reminder-notice" data-tone="note" role="status">
						<Bell class="mt-0.5 size-4 shrink-0" />
						<p class="min-w-0 flex-1">
							A short take now keeps {language?.name ?? 'your language'} fresh.
						</p>
						<NeoButton rounded class="reminder-start" onclick={() => startRecording()}>Start speaking</NeoButton>
						<NeoButton
							text
							rounded
							class="icon-button"
							aria-label="Dismiss reminder"
							title="Not now"
							onclick={snoozeReminders}
						>
							{#snippet icon()}<X size={16} />{/snippet}
						</NeoButton>
					</div>
				{/if}
			</div>
		{/if}

		<div class="relative z-10 min-h-0 flex-1">
			<AttemptStream {activeCorrectionId} onSelectCorrection={selectCorrection} bind:timelineOpen />
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

	</section>

	<!-- Phones: Feedback opens as a sheet over the page (from the bar's button, or pulled up from the bar); tapping outside or swiping it down closes it, and the shade follows it. -->
	{#if coachOpen}
		<button
			type="button"
			class="coach-scrim"
			aria-label="Close feedback"
			style:opacity={1 - feedbackSwipeProgress}
			onclick={() => (coachOpen = false)}
		></button>
	{/if}
	<FeedbackPanel
		attempt={active}
		{activeCorrectionId}
		{stats}
		bind:open={coachOpen}
		bind:contentWidth={feedbackContentWidth}
		bind:shell={feedbackSheet}
		onSelectCorrection={selectCorrection}
		onSwipeProgress={(progress) => (feedbackSwipeProgress = progress)}
	/>

	<!--
		A paper index tab in the Feedback sidebar, poking out of its left edge with
		the take's error count. Open, the sidebar covers it (tucked in); collapsed,
		it rides the edge out and pops out to open the sidebar again. Phones open
		Feedback from the top bar instead.
	-->
	{#if !phone}
		<button
			type="button"
			class="feedback-bookmark"
			style:--feedback-content-width={feedbackContentWidthStyle}
			class:tucked={coachOpen}
			class:clean={errorCount === 0}
			aria-label={`Open feedback: ${errorCount} error${errorCount === 1 ? '' : 's'}`}
			title="Open feedback"
			inert={coachOpen}
			onclick={() => (coachOpen = true)}
		>
			<span class="tab-paper">
				<MessageSquareText size={12} strokeWidth={2.2} />
				<span class="tab-count">{errorCount}</span>
			</span>
		</button>
	{/if}
</div>

<!-- neo-svelte 1.2.0 does not export NeoDialogConfirm, so the confirm is composed from NeoDialog. -->
<NeoDialog {...quickDialog} bind:open={deleteOpen} portal rounded filled elevation={3} aria-labelledby="delete-session-title" aria-describedby="delete-session-body">
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
	/* Set per element, never inherited: see the desktop layout below. */
	@property --feedback-content-width {
		syntax: '*';
		inherits: false;
	}

	.practice-grid {
		/* Neo components reserve a shadow margin by default; this layout spaces them itself. */
		--neo-shadow-margin: 0;
		--neo-shadow-margin-lg: 0;
		/* Transparent so the app's paper texture shows behind the practice stage. */
		background: transparent;
		/* How long the Feedback sidebar takes to slide in or out (desktop), or the sheet to rise (tablets). */
		--feedback-slide-duration: 180ms;
		--feedback-slide-easing: cubic-bezier(0.22, 1, 0.36, 1);
		/* The ambience's two inks: brand by default, mode-coloured once a session exists. */
		--glare-one: var(--brand);
		--glare-two: var(--brand);
		--glare-three: var(--brand);
		--glare-soft: var(--brand);
		/* Perceptual strength: red needs more colour at the same alpha to read as bright as cyan. */
		--glare-strength-one: 14%;
		--glare-strength-two: 12%;
		--glare-strength-three: 10%;
		--glare-strength-soft: 10%;
	}
	:global(.practice-grid[data-glare='casual']) {
		--glare-one: var(--brand);
		--glare-two: var(--brand-2);
		--glare-three: var(--brand-3);
		--glare-soft: var(--brand-2);
	}
	:global(.practice-grid[data-glare='exam']) {
		--glare-one: var(--error);
		--glare-two: var(--destructive);
		--glare-three: var(--error);
		--glare-soft: var(--error);
		--glare-strength-one: 22%;
		--glare-strength-two: 18%;
		--glare-strength-three: 16%;
		--glare-strength-soft: 16%;
	}
	.practice-stage {
		isolation: isolate;
		/* The app's paper shows through; only the faint mode glow sits on it. */
		background: radial-gradient(circle at 8% 4%, color-mix(in srgb, var(--glare-soft) var(--glare-strength-soft), transparent), transparent 28%);
	}
	/* ------------------------------------------------------------------ The bar's prompt and controls */

	.bar-prompt {
		min-width: 0;
	}
	/* The prompt, as the page's heading: the serif of the takes, up to two lines. */
	.prompt-text {
		display: -webkit-box;
		overflow: hidden;
		font-family: var(--font-serif);
		font-size: calc(0.9375rem * var(--text-scale-prompt, 1));
		font-weight: 600;
		line-height: 1.3;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
	}
	.session-line {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		min-width: 0;
		overflow: hidden;
		color: var(--muted-foreground);
		font-size: 11px;
		line-height: 1.35;
		white-space: nowrap;
	}
	/* Beside the prompt on desktop; in the second row on phones. */
	.bar-recording {
		display: flex;
		flex: 1 1 auto;
		align-items: center;
		gap: 0.625rem;
		width: 9rem;
		min-width: 0;
	}
	.waveform {
		display: flex;
		flex: 1;
		align-items: center;
		justify-content: center;
		gap: 3px;
		min-width: 0;
		height: 2rem;
		overflow: hidden;
	}
	.waveform span {
		flex-shrink: 0;
		width: 3px;
		height: 1.75rem;
		border-radius: 999px;
		background: linear-gradient(180deg, var(--brand-2), var(--brand));
		transform-origin: center;
		transition: transform 75ms;
	}
	.bar-timer {
		flex-shrink: 0;
		color: var(--muted-foreground);
		font-family: var(--font-mono);
		font-size: 0.8125rem;
		font-variant-numeric: tabular-nums;
	}
	.bar-busy {
		display: flex;
		flex: 1 1 auto;
		align-items: center;
		gap: 0.5rem;
		width: 12rem;
		min-width: 0;
	}
	.bar-busy :global(.bar-progress) {
		height: 4px;
	}
	.practice-grid :global(.neo-button.bar-action) {
		height: 32px;
		padding-inline: 12px;
		gap: 6px;
		font-weight: 500;
	}
	.practice-grid :global(.neo-button.record-button) {
		background: linear-gradient(120deg, var(--brand), var(--brand-2));
		color: var(--primary-foreground);
		font-weight: 600;
	}
	/* Pointers that hover only: a tapped key would keep the look until the next tap. */
	@media (hover: hover) {
		.practice-grid :global(.neo-button.record-button:hover) {
			filter: brightness(1.07);
		}
	}
	.bar-divider {
		width: 1px;
		height: 22px;
		margin-inline: 0.25rem;
		background: var(--border);
	}

	/* Setup, usage and error notices: a slim strip under the bar. */
	.bar-notices {
		position: relative;
		z-index: 15;
		display: grid;
		gap: 0.375rem;
		padding: 0.375rem var(--page-gutter) 0;
	}
	.bar-notice {
		--tone: var(--warn);
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		padding: 0.4rem 0.625rem;
		border: 1px solid color-mix(in srgb, var(--tone) 30%, transparent);
		border-radius: 0.625rem;
		background: color-mix(in srgb, var(--tone) 9%, var(--card));
		color: var(--foreground);
		font-size: 0.8125rem;
		line-height: 1.45;
	}
	.bar-notice[data-tone='error'] {
		--tone: var(--error);
	}
	.bar-notice[data-tone='note'] {
		--tone: var(--brand);
	}
	.reminder-notice {
		flex-wrap: wrap;
		align-items: center;
	}
	.reminder-notice p {
		flex: 1 1 10rem;
	}
	.bar-notice :global(.neo-button.reminder-start) {
		height: 28px;
		padding-inline: 0.625rem;
		font-size: 0.75rem;
	}
	.bar-notice > :global(svg:first-child) {
		color: var(--tone);
	}

	.practice-grid :global(.neo-button.icon-button) { width: 32px; height: 32px; padding: 0; justify-content: center; color: var(--muted-foreground); }
	:global(.rename-input) { min-width: 0; flex: 1; }
	.confirm-dialog { max-width: 24rem; padding: 0.5rem; }
	.empty-orb { background: linear-gradient(145deg, var(--brand), var(--brand-2) 60%, var(--brand-3)); }
	/*
	 * The mode's glow: two large soft colours that drift slowly out of phase,
	 * the way Apple's tinted backgrounds move. The animation is transform-only,
	 * so the compositor runs it; the paper underneath never repaints. The
	 * gradients are the blur; no filter is needed.
	 */
	.ambient {
		position: absolute;
		z-index: -1;
		border-radius: 999px;
		pointer-events: none;
		opacity: 0.5;
		will-change: transform;
	}
	/* Large and low, where the page is visible under the cards, so the colour actually reads. */
	.ambient-one {
		right: 6%;
		bottom: 2%;
		width: 24rem;
		height: 24rem;
		background: radial-gradient(circle, color-mix(in srgb, var(--glare-one) var(--glare-strength-one), transparent), transparent 68%);
		animation: glare-drift-one 38s ease-in-out infinite alternate;
	}
	.ambient-two {
		bottom: 16%;
		left: 2%;
		width: 20rem;
		height: 20rem;
		background: radial-gradient(circle, color-mix(in srgb, var(--glare-two) var(--glare-strength-two), transparent), transparent 68%);
		animation: glare-drift-two 46s ease-in-out -12s infinite alternate;
	}
	.ambient-three {
		bottom: 6%;
		left: 30%;
		width: 26rem;
		height: 26rem;
		background: radial-gradient(circle, color-mix(in srgb, var(--glare-three) var(--glare-strength-three), transparent), transparent 70%);
		animation: glare-drift-three 52s ease-in-out -20s infinite alternate;
	}
	@keyframes glare-drift-one {
		0% { transform: translate3d(0, 0, 0) scale(1); }
		50% { transform: translate3d(-7%, 5%, 0) scale(1.14); }
		100% { transform: translate3d(6%, -6%, 0) scale(0.92); }
	}
	@keyframes glare-drift-two {
		0% { transform: translate3d(0, 0, 0) scale(1); }
		50% { transform: translate3d(8%, -6%, 0) scale(0.9); }
		100% { transform: translate3d(-6%, 5%, 0) scale(1.16); }
	}
	@keyframes glare-drift-three {
		0% { transform: translate3d(0, 0, 0) scale(1); }
		50% { transform: translate3d(-8%, -5%, 0) scale(1.1); }
		100% { transform: translate3d(7%, 4%, 0) scale(0.94); }
	}
	@media (prefers-reduced-motion: reduce) {
		.ambient {
			animation: none;
			will-change: auto;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.practice-grid { --feedback-slide-duration: 1ms; }
		.waveform span { transition-duration: 1ms !important; }
	}
	/*
	 * Desktop: the sidebar lies over the right of the page and slides in and
	 * out whole (a transform, so the compositor moves it), instead of squeezing
	 * its text. Its column only keeps the room free: it changes at once, so the
	 * takes reflow once, under the sidebar or into the room it is sliding into.
	 * (Animating the column itself laid out the whole stack, every word of
	 * every card, on every frame of the slide.)
	 *
	 * Its width follows its content: FeedbackPanel reports the narrowest width
	 * at which its toolbar and cards lay out as they do at the maximum
	 * (`--feedback-content-width`), and the takes get the rest. The maximum is
	 * the old fixed width; the minimum keeps a usable column. A content change
	 * resizes the column and the sidebar together, at once.
	 *
	 * That width is set on just the elements that use it (the grid, the panel
	 * and the bookmark) and does not inherit (see `@property` above): on the
	 * grid an inherited variable restyled every word of every card whenever it
	 * changed (57 ms on the long takes), which happens as each take is shown.
	 */
	@media (min-width: 1024px) {
		.practice-grid {
			--feedback-min-width: 330px;
			--feedback-max-width: clamp(var(--feedback-min-width), 31vw, 440px);
			grid-template-columns: minmax(0, 1fr) clamp(
				var(--feedback-min-width),
				var(--feedback-content-width, var(--feedback-max-width)),
				var(--feedback-max-width)
			);
		}
		.practice-grid.coach-closed { grid-template-columns: minmax(0, 1fr) 0px; }
		.practice-grid :global(aside.feedback-shell),
		.feedback-bookmark {
			--feedback-open-width: clamp(
				var(--feedback-min-width),
				var(--feedback-content-width, var(--feedback-max-width)),
				var(--feedback-max-width)
			);
		}
		.practice-grid :global(aside.feedback-shell) {
			position: absolute;
			top: 0;
			right: 0;
			bottom: 0;
			width: var(--feedback-open-width);
			transition: transform var(--feedback-slide-duration) var(--feedback-slide-easing);
		}
		/* Its shadow goes once it is out of sight, or a sliver would stay at the window's edge. */
		.practice-grid.coach-closed :global(aside.feedback-shell) {
			box-shadow: none;
			transform: translateX(100%);
			transition:
				transform var(--feedback-slide-duration) var(--feedback-slide-easing),
				box-shadow 0s linear var(--feedback-slide-duration);
		}
	}
	@media (max-width: 1023px) {
		.practice-grid { grid-template-rows: minmax(0, 1fr) 42%; }
		.practice-grid.coach-closed { grid-template-rows: minmax(0, 1fr) 0px; }
	}
	/* Tablets: the panel rises into the room under the takes. */
	@media (min-width: 641px) and (max-width: 1023px) {
		.practice-grid:not(.coach-closed) :global(aside.feedback-shell) {
			animation: sheet-in var(--feedback-slide-duration) var(--feedback-slide-easing);
		}
	}
	.coach-scrim { display: none; }
	/* Below desktop, collapsed feedback is gone entirely; the bookmark (or, on phones, the top bar) brings it back. */
	@media (max-width: 1023px) {
		.practice-grid.coach-closed :global(aside.feedback-shell) { display: none; }
	}

	/*
	 * The bookmark: a manila card-stock tab sticking out of the sidebar's left
	 * edge, like a divider tab in a notebook. The button rides the sidebar's
	 * edge (moved by its width, with the sidebar's own slide), and the
	 * paper sits under the sidebar, so sliding the paper right tucks it in.
	 * Tucking is quick; coming out waits for the sidebar to start leaving and
	 * overshoots a little. Both are transforms, so the compositor runs them.
	 * Its deckled edge is a clip, so its shadow is on the button around it.
	 */
	.feedback-bookmark {
		position: absolute;
		top: 68px;
		right: 0;
		z-index: 12;
		padding: 0;
		border: 0;
		background: none;
		filter:
			drop-shadow(-1px 1px 1px rgb(60 40 15 / 0.35))
			drop-shadow(-3px 5px 6px rgb(60 40 15 / 0.2));
		cursor: pointer;
		transform: translateX(calc(-1 * var(--feedback-open-width, 0px)));
		transition: transform var(--feedback-slide-duration) var(--feedback-slide-easing);
	}
	.practice-grid.coach-closed .feedback-bookmark {
		transform: translateX(0);
	}
	.feedback-bookmark .tab-paper {
		transition: transform 260ms cubic-bezier(0.34, 1.45, 0.64, 1) 100ms;
	}
	.feedback-bookmark.tucked .tab-paper {
		transform: translateX(105%);
		transition: transform 140ms cubic-bezier(0.4, 0, 1, 1);
	}
	.feedback-bookmark:not(.tucked):hover .tab-paper,
	.feedback-bookmark:not(.tucked):focus-visible .tab-paper {
		transform: translateX(-3px);
		transition: transform 0.18s cubic-bezier(0.22, 1, 0.36, 1);
	}
	/*
	 * Manila card stock: fibres and grain, crumpled light and shade, one
	 * crease, a deckled outer edge, and a darker band where it slides under the
	 * sidebar. The count is written on it in red pencil (graphite green when
	 * the take is clean).
	 */
	.feedback-bookmark .tab-paper {
		--manila: #e8d4a4;
		--paper-glow: rgb(255 252 240 / 0.45);
		--paper-shadow: rgb(120 85 35 / 0.18);
		--fold-shade: rgb(105 75 30 / 0.3);
		--crease-light: rgb(255 250 235 / 0.45);
		--crease-dark: rgb(110 80 30 / 0.22);
		--pencil: #a3271b;
		--icon-opacity: 0.75;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1px;
		width: 32px;
		height: 50px;
		padding-right: 3px;
		background-color: var(--manila);
		background-image:
			radial-gradient(ellipse 70% 45% at 30% 22%, var(--paper-glow), transparent 70%),
			radial-gradient(ellipse 60% 40% at 70% 78%, var(--paper-shadow), transparent 72%),
			linear-gradient(112deg, transparent 44%, var(--crease-light) 47%, var(--crease-dark) 49.5%, transparent 53%),
			linear-gradient(270deg, var(--fold-shade), transparent 7px),
			url('../textures/bookmark-grain.webp'),
			url('../textures/bookmark-fibres.webp');
		background-size: auto, auto, auto, auto, 120px 120px, 90px 90px;
		background-blend-mode: screen, multiply, normal, multiply, multiply, soft-light;
		color: var(--pencil);
		clip-path: polygon(
			4px 0, 100% 0, 100% 100%, 4px 100%,
			2px 94%, 3px 87%, 0 80%, 2px 72%, 1px 64%, 3px 56%, 0 48%,
			2px 40%, 1px 32%, 3px 24%, 0 16%, 2px 8%
		);
	}
	.feedback-bookmark.clean .tab-paper {
		--pencil: #2f5f57;
	}
	/*
	 * Dark: kraft card stock dark enough for light pencil, with the light and
	 * the crease kept faint. A bright patch behind the count or the icon left
	 * them at 2.7:1; now the worst spot is 5.8:1 (measured at 4x, 2026-11-01).
	 */
	:global([data-theme='dark']) .feedback-bookmark .tab-paper {
		--manila: #4f412b;
		--paper-glow: rgb(255 240 210 / 0.07);
		--paper-shadow: rgb(0 0 0 / 0.22);
		--fold-shade: rgb(0 0 0 / 0.4);
		--crease-light: rgb(255 240 210 / 0.06);
		--crease-dark: rgb(0 0 0 / 0.25);
		--pencil: #ffd9cc;
		--icon-opacity: 1;
	}
	:global([data-theme='dark']) .feedback-bookmark.clean .tab-paper {
		--pencil: #cdeee5;
	}
	.feedback-bookmark .tab-paper :global(svg) {
		opacity: var(--icon-opacity);
	}
	.tab-count {
		font-family: 'Caveat', 'Comic Sans MS', cursive;
		font-size: 21px;
		font-weight: 700;
		line-height: 0.9;
		transform: rotate(-4deg);
	}
	@media (prefers-reduced-motion: reduce) {
		.feedback-bookmark,
		.feedback-bookmark .tab-paper {
			transition-duration: 1ms !important;
			transition-delay: 0s !important;
		}
	}
	/* The phone's top-bar buttons, and the correction count on Feedback. */
	.practice-grid :global(.neo-button.bar-button) { width: 32px; height: 32px; }
	.bar-badge {
		position: absolute;
		top: -7px;
		right: -9px;
		min-width: 15px;
		height: 15px;
		padding: 0 4px;
		border-radius: 999px;
		background: var(--error);
		color: #fff;
		font-size: 9.5px;
		font-weight: 700;
		line-height: 15px;
		text-align: center;
	}

	/*
	 * Phones. There is no room to split the screen between takes and feedback,
	 * so Feedback is a bottom sheet over the page (the layout keeps nothing when
	 * closed), and the bar takes a second row for its small controls.
	 */
	@media (max-width: 640px) {
		/* Feedback opens from the bar; closed, it takes no room in the layout. */
		.practice-grid,
		.practice-grid.coach-closed { grid-template-rows: minmax(0, 1fr); }
		/*
		 * The sheet stays laid out when closed, just below the screen, on a
		 * layer of its own. Shown from `display: none`, its first frame laid out
		 * and drew the whole sheet at once (a 70–110 ms stall as it was pulled
		 * up, measured on a Galaxy S24 FE), and giving up its layer after each
		 * swipe drew it again. The button slides it; swipes move it directly.
		 */
		.practice-grid :global(aside.feedback-shell),
		.practice-grid.coach-closed :global(aside.feedback-shell) {
			display: flex;
			position: fixed;
			inset: auto 0 0 0;
			z-index: 70;
			height: min(82dvh, calc(100% - 56px));
			border-top: 1px solid var(--sheet-line);
			border-radius: 20px 20px 0 0;
			background-color: var(--card);
			box-shadow: var(--shadow-float);
			translate: 0 0;
			transition: translate var(--feedback-slide-duration) var(--feedback-slide-easing);
			will-change: translate;
		}
		/* Out of sight, its shadow too; it leaves faster than it came. */
		.practice-grid.coach-closed :global(aside.feedback-shell) {
			box-shadow: none;
			translate: 0 calc(100% + 24px);
			transition-timing-function: cubic-bezier(0.4, 0, 1, 1);
		}
		.coach-scrim {
			display: block;
			position: fixed;
			inset: 0;
			z-index: 65;
			border: 0;
			background: color-mix(in srgb, #000 32%, transparent);
			animation: scrim-in 200ms ease-out;
			/* Its own layer: it fades with every move of a swipe, which otherwise redrew the screen under it. */
			will-change: opacity;
		}
		/* Pulled up from the bar: the shade already came in with the finger. */
		.practice-grid.pulled-open .coach-scrim {
			animation: none;
		}
		/* The bar is at the bottom (see AppHeader); notices sit just above it. */
		.bar-notices { order: 98; padding: 0 var(--page-gutter) 0.375rem; }
		/* The bar's main action is a round icon button; its label is the accessible name. */
		.practice-grid :global(.neo-button.bar-action.main-action) { width: 34px; height: 34px; min-width: 34px; min-height: 34px; padding: 0; justify-content: center; }
		/* neo offsets an icon to make room for a label (margin 0 5px 0 -5px) and packs it left; there is no label here. */
		.practice-grid :global(.neo-button.bar-action.main-action .neo-content) { justify-content: center; }
		.practice-grid :global(.neo-button.bar-action.main-action .neo-icon) { margin: 0; }
		.prompt-text { font-size: calc(0.875rem * var(--text-scale-prompt, 1)); }
		.bar-recording, .bar-busy { width: auto; }
	}
	@keyframes sheet-in { from { transform: translateY(100%); } }
	@keyframes scrim-in { from { opacity: 0; } }
	@media (prefers-reduced-motion: reduce) {
		.practice-grid :global(aside.feedback-shell), .coach-scrim { animation: none !important; }
	}
</style>
