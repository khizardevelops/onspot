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
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { Input } from '$lib/components/ui/input';
	import { Progress } from '$lib/components/ui/progress';
	import * as Tabs from '$lib/components/ui/tabs';
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

<div class="practice-grid grid h-full grid-cols-1" class:coach-closed={!coachOpen}>
	<section class="practice-stage relative flex min-h-0 min-w-0 flex-col overflow-hidden">
		<div class="ambient ambient-one" aria-hidden="true"></div>
		<div class="ambient ambient-two" aria-hidden="true"></div>

		<header class="session-header paper-surface relative z-20 flex items-center justify-between gap-4 border-b px-4 py-3 sm:px-7 sm:py-4">
			<div class="min-w-0 flex-1">
				{#if renaming}
					<form class="flex max-w-md items-center gap-1" onsubmit={(event) => { event.preventDefault(); void commitRename(); }} in:fly={{ y: -5, duration: 220 }} out:fade={{ duration: 120 }}>
						<Input
							bind:value={renameValue}
							aria-label="Session name"
							class="h-8 bg-background/80 font-medium shadow-sm"
							onkeydown={(event) => {
								if (event.key === 'Escape') renaming = false;
							}}
						/>
						<Button size="sm" type="submit">Save</Button>
						<Button size="icon-sm" variant="ghost" aria-label="Cancel rename" onclick={() => (renaming = false)}><X /></Button>
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
				<Tabs.Root
					value={$practice.mode}
					onValueChange={(value) => setSessionMode(value as 'exam' | 'casual')}
					aria-label="Practice mode"
				>
					<Tabs.List
						class="mode-switch paper-grain"
						data-mode={$practice.mode}
						data-locked={locked ? '' : undefined}
						title={locked ? 'The mode is fixed once a session has takes' : undefined}
					>
						<span class="mode-knob paper-grain" aria-hidden="true"></span>
						<Tabs.Trigger value="exam" disabled={locked} class="mode-option" data-option="exam">
							<span class="mode-led" aria-hidden="true"></span>Exam
						</Tabs.Trigger>
						<Tabs.Trigger value="casual" disabled={locked} class="mode-option" data-option="casual">
							<span class="mode-led" aria-hidden="true"></span>Casual
						</Tabs.Trigger>
					</Tabs.List>
				</Tabs.Root>

				{#if locked}
					<DropdownMenu.Root>
						<DropdownMenu.Trigger class="grid size-9 place-items-center rounded-xl text-muted-foreground transition-all hover:bg-[var(--surface-2)] hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none" aria-label="Session actions">
							<MoreHorizontal class="size-4" />
						</DropdownMenu.Trigger>
						<DropdownMenu.Content align="end" class="w-48 p-1.5" loop>
							<DropdownMenu.Item class="min-h-9" onSelect={beginRename}><Pencil /> Rename session</DropdownMenu.Item>
							<DropdownMenu.Separator />
							<DropdownMenu.Item class="min-h-9" variant="destructive" onSelect={() => (deleteOpen = true)}><Trash2 /> Delete session</DropdownMenu.Item>
						</DropdownMenu.Content>
					</DropdownMenu.Root>
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
			<Card.Root class="composer-card gap-0 rounded-[22px] rounded-b-none border-b-0 py-0 shadow-[var(--shadow-float)]">
				<Card.Content class="p-4 pb-3 sm:p-5 sm:pb-3">
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
										<Progress value={$practice.progress?.progress ?? ($practice.phase === 'evaluating' ? 92 : 8)} class="mt-2 h-1.5 bg-[var(--surface-2)] [&>div]:bg-[linear-gradient(90deg,var(--brand),var(--brand-2))] [&>div]:duration-500" />
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
										<Button variant="destructive" class="h-10 rounded-xl px-4" onclick={() => stopAndAnalyze()}><Square class="size-3.5" /> Stop & analyze</Button>
									</div>
								</div>
							{:else}
								<div class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
									<div class="min-w-0">
										<p class="eyebrow">Your prompt</p>
										<p class="mt-1.5 max-w-[58ch] font-serif text-lg leading-snug font-medium sm:text-xl">{$practice.prompt.text}</p>
									</div>
									<div class="flex shrink-0 flex-wrap gap-2">
										<Button variant="outline" class="h-10 rounded-xl px-3" onclick={() => nextPrompt()}><SkipForward /> New prompt</Button>
										{#if sessionReady}
											<Button class="record-button h-10 rounded-xl px-4 shadow-lg" onclick={() => startRecording()}><Mic /> Start speaking</Button>
										{:else}
											<Button variant="secondary" class="h-10 rounded-xl px-4" onclick={() => goto('/settings/')}>
												<Download /> Language data
											</Button>
										{/if}
									</div>
								</div>
								{#if !sessionReady}
									<div class="mt-3 flex items-start gap-2.5 rounded-xl border border-[var(--warn)]/30 bg-[var(--warn-soft)] p-3 text-sm" role="status" in:fly={{ y: 6, duration: 240 }}>
										<AlertTriangle class="mt-0.5 size-4 shrink-0 text-[var(--warn)]" />
										<p class="min-w-0 leading-relaxed">
											{#if checkingData}
												Checking {language?.name ?? 'language'} data…
											{:else}
												Before your first session, open
												<a class="font-medium text-[var(--brand)] underline underline-offset-4" href="/settings/">Settings → Language data</a>
												and click <strong>Download</strong>. That installs the approved speech and voice models for {language?.name ?? 'your language'}.
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
							<Button size="icon-sm" variant="ghost" aria-label="Dismiss error" onclick={clearError}><X /></Button>
						</div>
					{/if}
				</Card.Content>
			</Card.Root>
		</footer>
	</section>

	<FeedbackPanel attempt={active} {activeCorrectionId} {stats} bind:open={coachOpen} onSelectCorrection={selectCorrection} />
</div>

<AlertDialog.Root bind:open={deleteOpen}>
	<AlertDialog.Content class="rounded-2xl">
		<AlertDialog.Header>
			<AlertDialog.Media class="bg-[var(--error-soft)] text-[var(--error)]"><Trash2 /></AlertDialog.Media>
			<AlertDialog.Title>Delete this session?</AlertDialog.Title>
			<AlertDialog.Description>Every attempt, correction, and saved recording in this session will be removed. This cannot be undone.</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Keep session</AlertDialog.Cancel>
			<AlertDialog.Action variant="destructive" onclick={() => void deleteCurrent()}>Delete session</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<style>
	.practice-grid {
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
	:global(.record-button) { background: linear-gradient(120deg, var(--brand), var(--brand-2)); color: white; }
	:global(.record-button:hover) { filter: brightness(1.07); transform: translateY(-1px); }
	.empty-orb { background: linear-gradient(145deg, var(--brand), var(--brand-2) 60%, var(--brand-3)); }
	.ambient { position: absolute; z-index: -1; border-radius: 999px; pointer-events: none; opacity: 0.5; }
	.ambient-one { top: 10%; right: 8%; width: 15rem; height: 15rem; background: radial-gradient(circle, color-mix(in srgb, var(--brand-2) 14%, transparent), transparent 68%); }
	.ambient-two { bottom: 18%; left: 2%; width: 12rem; height: 12rem; background: radial-gradient(circle, color-mix(in srgb, var(--brand-3) 12%, transparent), transparent 68%); }
	/*
	 * Exam / Casual: a neumorphic switch. The track is pressed into the header,
	 * a convex knob springs between the options and sinks while pressed, and an
	 * indicator light glows in the mode's colour.
	 */
	:global(.mode-switch) {
		position: relative;
		display: grid;
		grid-template-columns: 1fr 1fr;
		height: 40px;
		padding: 4px;
		border-radius: 14px;
		/* Colour hierarchy: the track is a control (sea-glass stock), pressed in. */
		background-color: var(--control);
		box-shadow: var(--paper-deboss);
	}
	.mode-knob {
		position: absolute;
		top: 4px;
		bottom: 4px;
		left: 4px;
		width: calc(50% - 4px);
		border-radius: 10px;
		/* The raised knob is sheet paper, as in every segmented control. */
		background-color: var(--card);
		box-shadow: var(--paper-emboss-hover);
		transition:
			translate 460ms cubic-bezier(0.34, 1.45, 0.64, 1),
			box-shadow 160ms ease,
			scale 160ms ease;
	}
	:global(.mode-switch[data-mode='casual']) .mode-knob { translate: 100% 0; }
	:global(.mode-switch:has(.mode-option:active:not(:disabled))) .mode-knob {
		box-shadow: var(--paper-emboss);
		scale: 0.97;
	}
	:global(.mode-switch .mode-option) {
		position: relative;
		z-index: 1;
		height: 100%;
		gap: 7px;
		padding-inline: 12px;
		border: 0;
		border-radius: 10px;
		background: transparent;
		box-shadow: none;
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--on-control);
		transition: color 240ms ease;
	}
	:global(.mode-switch .mode-option:hover:not(:disabled)) { color: var(--foreground); }
	:global(.mode-switch .mode-option[data-state='active']) { background: transparent; box-shadow: none; }
	:global(.mode-switch .mode-option[data-option='exam'][data-state='active']) { color: var(--error); }
	:global(.mode-switch .mode-option[data-option='casual'][data-state='active']) { color: var(--brand); }
	:global(.mode-switch .mode-option:focus-visible) {
		outline: 2px solid color-mix(in srgb, var(--ring) 55%, transparent);
		outline-offset: -2px;
	}
	.mode-led {
		width: 6px;
		height: 6px;
		border-radius: 999px;
		background: currentColor;
		opacity: 0.25;
		transition: opacity 240ms ease, box-shadow 240ms ease;
	}
	:global(.mode-switch .mode-option[data-state='active']) .mode-led {
		opacity: 1;
		box-shadow: 0 0 6px currentColor, 0 0 2px currentColor;
	}
	/* Locked for a session with takes: the chosen mode stays lit, the other recedes. */
	:global(.mode-switch .mode-option:disabled) { opacity: 1; cursor: not-allowed; }
	:global(.mode-switch .mode-option:disabled:not([data-state='active'])) { opacity: 0.45; }

	@media (prefers-reduced-motion: reduce) {
		.practice-grid { transition-duration: 1ms; }
		.mode-knob, .mode-led { transition-duration: 1ms; }
		:global(.record-button:hover) { transform: none; }
		.waveform span { transition-duration: 1ms !important; }
	}
	@media (min-width: 1024px) {
		.practice-grid { grid-template-columns: minmax(0, 1fr) clamp(330px, 31vw, 440px); }
		.practice-grid.coach-closed { grid-template-columns: minmax(0, 1fr) 64px; }
	}
	@media (max-width: 1023px) {
		.practice-grid { grid-template-rows: minmax(0, 1fr) 42%; }
		.practice-grid.coach-closed { grid-template-rows: minmax(0, 1fr) 58px; }
	}
</style>
