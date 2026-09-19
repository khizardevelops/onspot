<script lang="ts">
	import { onDestroy } from 'svelte';
	import { getLanguage } from '$lib/languages';
	import { appSettings } from '$lib/stores/settings';
	import { openaiApiKey } from '$lib/stores/secrets';
	import {
		pauseVoicePreview,
		playVoicePreview,
		regenerateVoicePreview,
		stopVoicePreview,
		toggleVoicePreviewLoop,
		ttsPreview
	} from '$lib/stores/ttsPreview';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Toggle } from '$lib/components/ui/toggle';
	import { Progress } from '$lib/components/ui/progress';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { AlertTriangle, Loader2, Pause, Play, Repeat, RotateCcw } from '@lucide/svelte';

	const language = $derived(getLanguage($appSettings.targetLanguage));
	const loading = $derived($ttsPreview.status === 'loading');
	const playing = $derived($ttsPreview.playing);
	const local = $derived($appSettings.ttsMode === 'local');
	const available = $derived(local || Boolean($openaiApiKey));
	let regenerateOpen = $state(false);

	// The preview owns its own audio graph; never leave it running off-page.
	onDestroy(stopVoicePreview);
</script>

<div class="rounded-2xl border bg-[var(--surface-2)]/40 p-4 sm:p-5">
	<div class="flex items-center justify-between gap-3">
		<p class="text-sm font-semibold">Voice preview</p>
		{#if loading}
			<Badge variant="secondary">{Math.round($ttsPreview.progress)}%</Badge>
		{:else if $ttsPreview.status === 'error'}
			<Badge variant="destructive">Failed</Badge>
		{:else if playing}
			<Badge class="bg-[var(--good-soft)] text-[var(--good)]">{local ? 'Playing live' : 'Playing'}</Badge>
		{:else if $ttsPreview.status === 'ready'}
			<Badge class="bg-[var(--good-soft)] text-[var(--good)]">
				{$ttsPreview.fromCache ? 'Cached' : 'Generated'}
			</Badge>
		{:else}
			<Badge variant="outline">Not generated</Badge>
		{/if}
	</div>

	<p class="mt-3 font-serif text-[0.9375rem] leading-relaxed italic">“{language?.preview}”</p>
	<p class="mt-2 text-xs leading-relaxed text-muted-foreground">
		Generated once and cached on this device, so replaying is free.
		{#if local}Equalizer changes are heard live while it plays; turn on Loop to keep listening.{/if}
		{#if !available}Add an OpenAI API key to preview cloud voices.{/if}
	</p>

	<div class="mt-4 flex flex-wrap items-center gap-2">
		<Button
			size="lg"
			class="px-3.5"
			disabled={loading || !available}
			onclick={() => (playing ? pauseVoicePreview() : void playVoicePreview())}
		>
			{#if loading}
				<Loader2 class="size-4 animate-spin" />
			{:else if playing}
				<Pause class="size-4" />
			{:else}
				<Play class="size-4" />
			{/if}
			{loading ? 'Generating…' : playing ? 'Pause' : 'Play preview'}
		</Button>
		<Toggle
			variant="outline"
			size="lg"
			class="loop-toggle px-3.5 {$ttsPreview.loop && playing ? 'pulsing' : ''}"
			pressed={$ttsPreview.loop}
			onPressedChange={toggleVoicePreviewLoop}
		>
			<Repeat class="size-4" /> Loop
		</Toggle>
		<Button
			size="icon-lg"
			variant="ghost"
			class="ml-auto text-muted-foreground"
			aria-label="Regenerate voice preview"
			title="Regenerate preview"
			disabled={loading}
			onclick={() => (regenerateOpen = true)}
		>
			<RotateCcw class="size-4" />
		</Button>
	</div>

	{#if loading}
		<Progress
			value={$ttsPreview.progress}
			class="mt-3 h-1.5 bg-[var(--surface-2)] [&>div]:bg-[linear-gradient(90deg,var(--brand),var(--brand-2))] [&>div]:duration-300"
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

<AlertDialog.Root bind:open={regenerateOpen}>
	<AlertDialog.Content class="rounded-2xl">
		<AlertDialog.Header>
			<AlertDialog.Media class="bg-[var(--warn-soft)] text-[var(--warn)]"><RotateCcw /></AlertDialog.Media>
			<AlertDialog.Title>Regenerate the voice preview?</AlertDialog.Title>
			<AlertDialog.Description>
				This reruns the voice model and replaces the cached preview. It can take a few seconds,
				and cloud voices use an API request. Play the cached preview first if you are not sure.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Keep cached preview</AlertDialog.Cancel>
			<AlertDialog.Action onclick={() => void regenerateVoicePreview()}>Regenerate</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<style>
	:global(.loop-toggle.pulsing) {
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
		:global(.loop-toggle.pulsing) {
			animation: none;
		}
	}
</style>
