<script lang="ts">
	import { onDestroy } from 'svelte';
	import { getLanguage } from '#lib/languages/index.js';
	import { appSettings } from '#lib/stores/settings.js';
	import { openaiApiKey } from '#lib/stores/secrets.js';
	import {
		pauseVoicePreview,
		playVoicePreview,
		regenerateVoicePreview,
		stopVoicePreview,
		toggleVoicePreviewLoop,
		ttsPreview
	} from '#lib/stores/ttsPreview.js';
	import { NeoButton } from '@dvcol/neo-svelte/buttons';
	import { NeoDialog } from '@dvcol/neo-svelte/floating/dialog';
	import { closeOnBack } from '#lib/platform/backButton.svelte.js';
	import { NeoPill } from '@dvcol/neo-svelte/pill';
	import { NeoProgressBar } from '@dvcol/neo-svelte/progress';
	import { AlertTriangle, Loader2, Pause, Play, Repeat, RotateCcw } from '@lucide/svelte';

	const language = $derived(getLanguage($appSettings.targetLanguage));
	const loading = $derived($ttsPreview.status === 'loading');
	const playing = $derived($ttsPreview.playing);
	const local = $derived($appSettings.ttsMode === 'local');
	const available = $derived(local || Boolean($openaiApiKey));
	let regenerateOpen = $state(false);
	closeOnBack(() => regenerateOpen, () => (regenerateOpen = false));

	// The preview owns its own audio graph; never leave it running off-page.
	onDestroy(stopVoicePreview);
</script>

<div class="voice-preview rounded-2xl border bg-[var(--surface-2)]/40 p-4 sm:p-5">
	<div class="flex items-center justify-between gap-3">
		<p class="text-sm font-semibold">Voice preview</p>
		{#if loading}
			<NeoPill size="small" rounded elevation={0}>{Math.round($ttsPreview.progress)}%</NeoPill>
		{:else if $ttsPreview.status === 'error'}
			<NeoPill size="small" rounded elevation={0} color="error" tinted>Failed</NeoPill>
		{:else if playing}
			<NeoPill size="small" rounded elevation={0} color="success" tinted>{local ? 'Playing live' : 'Playing'}</NeoPill>
		{:else if $ttsPreview.status === 'ready'}
			<NeoPill size="small" rounded elevation={0} color="success" tinted>
				{$ttsPreview.fromCache ? 'Cached' : 'Generated'}
			</NeoPill>
		{:else}
			<NeoPill size="small" rounded elevation={0} borderless={false}>Not generated</NeoPill>
		{/if}
	</div>

	<p class="mt-3 font-serif text-[0.9375rem] leading-relaxed italic">“{language?.preview}”</p>
	<p class="mt-2 text-xs leading-relaxed text-muted-foreground">
		Generated once and cached on this device, so replaying is free.
		{#if local}Equalizer changes are heard live while it plays; turn on Loop to keep listening.{/if}
		{#if !available}Add an OpenAI API key to preview cloud voices.{/if}
	</p>

	<div class="mt-4 flex flex-wrap items-center gap-2">
		<NeoButton
			rounded
			color="primary"
			disabled={loading || !available}
			onclick={() => (playing ? pauseVoicePreview() : void playVoicePreview())}
		>
			{#snippet icon()}
				{#if loading}
					<Loader2 class="size-4 animate-spin" />
				{:else if playing}
					<Pause class="size-4" />
				{:else}
					<Play class="size-4" />
				{/if}
			{/snippet}
			{loading ? 'Generating…' : playing ? 'Pause' : 'Play preview'}
		</NeoButton>
		<NeoButton
			rounded
			toggle
			class="loop-toggle {$ttsPreview.loop && playing ? 'pulsing' : ''}"
			aria-pressed={$ttsPreview.loop}
			bind:checked={() => $ttsPreview.loop, () => toggleVoicePreviewLoop()}
		>
			{#snippet icon()}<Repeat class="size-4" />{/snippet}
			Loop
		</NeoButton>
		<NeoButton
			rounded
			text
			class="ml-auto text-muted-foreground"
			aria-label="Regenerate voice preview"
			title="Regenerate preview"
			disabled={loading || !available}
			onclick={() => (regenerateOpen = true)}
		>
			{#snippet icon()}<RotateCcw class="size-4" />{/snippet}
		</NeoButton>
	</div>

	{#if loading}
		<NeoProgressBar
			value={$ttsPreview.progress}
			class="mt-3"
			rounded
			height="6px"
			color="var(--brand)"
			aria-label="Voice preview progress"
		/>
		{#if $ttsPreview.statusText}
			<p class="mt-1.5 text-xs text-muted-foreground">{$ttsPreview.statusText}</p>
		{/if}
	{/if}
	{#if $ttsPreview.error}
		<p class="mt-2 flex items-start gap-1.5 text-xs text-[var(--error)]">
			<AlertTriangle class="mt-0.5 size-3.5 shrink-0" />
			<span class="break-words">{$ttsPreview.error}</span>
		</p>
	{/if}
</div>

<!-- neo-svelte 1.2.0 does not export NeoDialogConfirm, so the confirm is composed from NeoDialog. -->
<!-- Portaled: the frosted settings card's backdrop-filter would otherwise contain the fixed dialog. -->
<NeoDialog
	bind:open={regenerateOpen}
	portal
	rounded
	backdrop
	filled
	elevation={3}
	aria-labelledby="regenerate-preview-title"
	aria-describedby="regenerate-preview-description"
	width="min(28rem, calc(100vw - 2rem))"
	padding="1.25rem 1.5rem"
>
	<div class="flex flex-col gap-3">
		<span class="grid size-10 place-items-center rounded-full bg-[var(--warn-soft)] text-[var(--warn)]"><RotateCcw class="size-5" /></span>
		<h2 id="regenerate-preview-title" class="dialog-title text-base font-semibold">Regenerate the voice preview?</h2>
		<p id="regenerate-preview-description" class="text-sm leading-relaxed text-muted-foreground">
			This reruns the voice model and replaces the cached preview. It can take a few seconds,
			and cloud voices use an API request. Play the cached preview first if you are not sure.
		</p>
		<div class="mt-2 flex flex-wrap justify-end gap-2">
			<NeoButton rounded onclick={() => (regenerateOpen = false)}>Keep cached preview</NeoButton>
			<NeoButton
				rounded
				color="primary"
				onclick={() => {
					regenerateOpen = false;
					void regenerateVoicePreview();
				}}>Regenerate</NeoButton
			>
		</div>
	</div>
</NeoDialog>

<style>
	h2.dialog-title {
		margin-bottom: 0;
		font-size: 1rem;
		line-height: 1.5rem;
		font-weight: 600;
	}
	.voice-preview {
		border-color: var(--border);
	}
	:global(.neo-button.loop-toggle.pulsing) {
		animation: loop-pulse 2s infinite;
	}
	@keyframes loop-pulse {
		0% {
			box-shadow: 0 0 0 0 color-mix(in srgb, var(--brand) 40%, transparent);
		}
		70% {
			box-shadow: 0 0 0 10px transparent;
		}
		100% {
			box-shadow: 0 0 0 0 transparent;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		:global(.neo-button.loop-toggle.pulsing) {
			animation: none;
		}
	}
</style>
