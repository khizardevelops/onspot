<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

<script lang="ts">
	/**
	 * The on-device voice library: one language's voices grouped by the model
	 * that speaks them, with each model's download (one for a shared model such
	 * as Supertonic, one per voice for Piper) and a way to try every voice.
	 * Choosing a voice applies it at once; the library stays open to compare.
	 *
	 * The Settings page places it: `beside` the settings when the page is wide
	 * enough, `over` them as a sheet otherwise (phones, narrow windows).
	 */
	import { onDestroy, onMount } from 'svelte';
	import { NeoButton } from '@dvcol/neo-svelte/buttons';
	import { NeoInput } from '@dvcol/neo-svelte/inputs';
	import { NeoProgressBar } from '@dvcol/neo-svelte/progress';
	import { Check, Download, Loader2, Play, Square, X } from '@lucide/svelte';
	import {
		explanationVoicesFor,
		getInstructionLanguage,
		requireLanguage,
		voicesFor,
		type LanguageVoice
	} from '#lib/languages/index.js';
	import { appSettings, setSetting } from '#lib/stores/settings.js';
	import { languageData } from '#lib/stores/languageData.js';
	import {
		cancelVoiceDownload,
		downloadKeyOf,
		downloadVoice,
		groupVoicesByModel,
		refreshInstalled,
		stopTrial,
		tryVoice,
		voiceLibrary,
		type VoiceGroup,
		type VoiceRole
	} from '#lib/stores/voiceLibrary.js';
	import { closeOnBack } from '#lib/platform/backButton.svelte.js';
	import { formatBytes } from '#lib/utils/bytes.js';

	interface Props {
		role: VoiceRole;
		/** `beside`: a column next to the settings; `over`: a sheet over them, when there is no room beside. */
		layout: 'beside' | 'over';
		onclose: () => void;
	}

	let { role, layout, onclose }: Props = $props();

	/** From this many voices the library offers a search field. */
	const SEARCH_FROM_VOICES = 7;

	/** Explanation voices speak at their natural pace; the target voice at the learner's. */
	const NATURAL_PACE = 1;

	const target = $derived(requireLanguage($appSettings.targetLanguage));
	const languageCode = $derived(role === 'target' ? target.id : $appSettings.instructionLanguage);
	const languageName = $derived(role === 'target' ? target.name : getInstructionLanguage(languageCode).name);
	const voices = $derived(role === 'target' ? voicesFor(languageCode) : explanationVoicesFor(languageCode));
	const selectedVoiceId = $derived(role === 'target' ? $appSettings.ttsVoice : $appSettings.explanationVoice);
	const selectedVoice = $derived(voices.find((voice) => voice.id === selectedVoiceId));
	const pace = $derived(role === 'target' ? $appSettings.targetSpeechPace : NATURAL_PACE);

	const title = $derived(role === 'target' ? `${languageName} voices` : `${languageName} voices for explanations`);
	const purpose = $derived(
		role === 'target'
			? `Reads back your corrected ${languageName}.`
			: `Reads the ${languageName} of explanations; their ${target.name} words keep your read-back voice.`
	);

	let query = $state('');
	const matchingVoices = $derived.by(() => {
		const needle = query.trim().toLowerCase();
		if (!needle) return voices;
		return voices.filter(
			(voice) => voice.name.toLowerCase().includes(needle) || voice.downloadSize.toLowerCase().includes(needle)
		);
	});
	const groups = $derived(groupVoicesByModel(matchingVoices));

	/** Language data is downloading; a second download now would compete with it for the voice worker. */
	const languageDataDownloading = $derived($languageData.status === 'downloading');

	let heading = $state<HTMLElement | null>(null);

	// Which downloads are on this device, whenever the list changes (another language or role).
	$effect(() => {
		void refreshInstalled(voices);
	});

	closeOnBack(() => true, () => onclose());

	onMount(() => heading?.focus({ preventScroll: true }));
	onDestroy(stopTrial);

	function choose(voice: LanguageVoice): void {
		setSetting(role === 'target' ? 'ttsVoice' : 'explanationVoice', voice.id);
	}

	function isInstalled(voice: LanguageVoice): boolean | undefined {
		return $voiceLibrary.installed[downloadKeyOf(voice)];
	}

	function onKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Escape') return;
		event.stopPropagation();
		onclose();
	}

	/** A voice's own facts; in a shared download the size belongs to the model above. */
	function voiceFacts(voice: LanguageVoice, group: VoiceGroup): string {
		return group.sharedDownload ? 'Included in the download above' : voice.downloadSize;
	}
</script>

{#snippet downloadControl(voice: LanguageVoice, what: string)}
	{@const key = downloadKeyOf(voice)}
	{@const running = $voiceLibrary.download?.key === key ? $voiceLibrary.download.progress : null}
	{@const installed = isInstalled(voice)}
	{@const failure = $voiceLibrary.errors[key]}
	{#if running}
		<div class="download-progress">
			<NeoProgressBar
				value={running.progress}
				rounded
				height="6px"
				color="var(--brand)"
				aria-label={`Downloading ${what}`}
			/>
			<div class="download-status">
				<span>{running.status || 'Downloading…'}</span>
				<NeoButton rounded class="small-button" onclick={cancelVoiceDownload}>Cancel</NeoButton>
			</div>
		</div>
	{:else if installed}
		<span class="tag tag-installed"><Check class="size-3" aria-hidden="true" /> On this device</span>
	{:else if installed === false}
		<NeoButton
			rounded
			class="small-button"
			disabled={Boolean($voiceLibrary.download) || languageDataDownloading}
			onclick={() => void downloadVoice(voice)}
		>
			{#snippet icon()}<Download class="size-3.5" />{/snippet}
			Download {formatBytes(voice.downloadBytes)}
		</NeoButton>
	{/if}
	{#if failure}<p class="library-error" role="alert">{failure}</p>{/if}
{/snippet}

{#snippet tryControl(voice: LanguageVoice)}
	{@const trial = $voiceLibrary.trial?.voiceId === voice.id ? $voiceLibrary.trial : null}
	{@const installed = isInstalled(voice) === true}
	{#if trial}
		<NeoButton rounded class="small-button" onclick={stopTrial}>
			{#snippet icon()}
				{#if trial.status === 'loading'}<Loader2 class="size-3.5 animate-spin" />{:else}<Square class="size-3.5" />{/if}
			{/snippet}
			{trial.status === 'loading' ? 'Speaking…' : 'Stop'}
		</NeoButton>
	{:else if installed || voice.samplePath}
		<NeoButton rounded class="small-button" onclick={() => void tryVoice(voice, languageCode, installed, pace)}>
			{#snippet icon()}<Play class="size-3.5" />{/snippet}
			{installed ? 'Try' : 'Sample'}
		</NeoButton>
	{/if}
{/snippet}

{#snippet library()}
	<!-- Escape belongs to the whole library (search field included), not to one control in it. -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<section
		id="voice-library"
		class="voice-library"
		data-layout={layout}
		role={layout === 'over' ? 'dialog' : 'region'}
		aria-modal={layout === 'over' ? 'true' : undefined}
		aria-labelledby="voice-library-title"
		onkeydown={onKeydown}
	>
		<header class="library-header">
			<div class="min-w-0 flex-1">
				<p class="library-eyebrow">{role === 'target' ? 'Read-back voice' : 'Explanation voice'}</p>
				<h2 id="voice-library-title" class="library-title" tabindex="-1" bind:this={heading}>{title}</h2>
				<p class="library-purpose">{purpose}</p>
				<p class="library-current">
					{selectedVoice ? `Using ${selectedVoice.name}` : 'No voice chosen yet'}
				</p>
			</div>
			<button type="button" class="library-close" aria-label="Close the voice library" onclick={onclose}>
				<X class="size-4" aria-hidden="true" />
			</button>
		</header>

		{#if voices.length >= SEARCH_FROM_VOICES}
			<div class="library-search">
				<NeoInput
					id="voice-library-search"
					rounded
					pressed
					elevation={-2}
					width="100%"
					placeholder="Search by name"
					aria-label="Search voices"
					value={query}
					oninput={(event: Event) => (query = (event.target as HTMLInputElement).value)}
				/>
			</div>
		{/if}

		<div class="library-scroll">
			{#each groups as group (group.engine)}
				{@const groupInstalled = group.sharedDownload ? isInstalled(group.voices[0]) : undefined}
				<section class="model-group" aria-labelledby={`voice-model-${group.engine}`}>
					<header class="model-header">
						<h3 id={`voice-model-${group.engine}`} class="model-name">
							{group.model.name}
							<span class="model-count">{group.voices.length} {group.voices.length === 1 ? 'voice' : 'voices'}</span>
						</h3>
						<p class="model-summary">{group.model.summary}</p>
						<p class="model-details">{group.model.details}</p>
						{#if group.sharedDownload}
							<div class="model-download">{@render downloadControl(group.voices[0], group.model.name)}</div>
							{#if groupInstalled === false && !$voiceLibrary.download}
								<p class="model-hint">Download once to try and use any of these voices.</p>
							{/if}
						{/if}
					</header>

					<ul class="voice-list">
						{#each group.voices as voice (voice.id)}
							{@const selected = voice.id === selectedVoiceId}
							{@const installed = isInstalled(voice)}
							<li class="voice-row" data-selected={selected}>
								<button type="button" class="voice-choice" aria-pressed={selected} onclick={() => choose(voice)}>
									<span class="voice-name">{voice.name}</span>
									<span class="voice-facts">{voiceFacts(voice, group)}</span>
									<span class="voice-tags">
										{#if selected}<span class="tag tag-selected">Selected</span>{/if}
										<span class="tag">
											{voice.approval.status === 'approved' ? 'Listening-tested' : 'Not reviewed yet'}
										</span>
										{#if !group.sharedDownload && installed}
											<span class="tag tag-installed">On this device</span>
										{/if}
									</span>
								</button>
								<div class="voice-actions">
									{@render tryControl(voice)}
									{#if !group.sharedDownload && installed !== true}
										{@render downloadControl(voice, voice.name)}
									{/if}
								</div>
								{#if $voiceLibrary.errors[voice.id]}
									<p class="library-error" role="alert">{$voiceLibrary.errors[voice.id]}</p>
								{/if}
							</li>
						{/each}
					</ul>
				</section>
			{:else}
				<p class="library-empty">
					{voices.length === 0
						? `There is no on-device ${languageName} voice yet; Cloud text-to-speech speaks it.`
						: `No voice matches “${query.trim()}”.`}
				</p>
			{/each}
		</div>

		<footer class="library-footer">
			<p class="library-note">Voices download to this device and work offline afterwards.</p>
			<NeoButton rounded color="primary" onclick={onclose}>Done</NeoButton>
		</footer>
	</section>
{/snippet}

{#if layout === 'over'}
	<div class="library-overlay">
		<button type="button" class="library-scrim" tabindex="-1" aria-label="Close the voice library" onclick={onclose}></button>
		{@render library()}
	</div>
{:else}
	{@render library()}
{/if}

<style>
	.voice-library {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
		border: 1px solid var(--sheet-line);
		border-radius: 18px;
		background: var(--card);
		box-shadow: var(--sheet-highlight), var(--shadow-sheet);
		overflow: hidden;
	}

	/* Over the settings: a sheet from the right edge; on a phone, the whole screen. */
	.library-overlay {
		position: fixed;
		inset: 0;
		z-index: 110;
		display: flex;
		justify-content: flex-end;
	}
	.library-scrim {
		position: absolute;
		inset: 0;
		border: 0;
		background: rgb(30 24 14 / 0.32);
		cursor: default;
	}
	.voice-library[data-layout='over'] {
		position: relative;
		width: min(30rem, var(--ui-vw));
		height: var(--ui-vh);
		border-radius: 18px 0 0 18px;
		padding-bottom: env(safe-area-inset-bottom);
		animation: library-in 160ms ease-out;
	}
	@media (max-width: 520px) {
		.voice-library[data-layout='over'] {
			border-radius: 0;
			border-width: 0;
		}
	}
	.voice-library[data-layout='beside'] {
		animation: library-in 160ms ease-out;
	}
	@keyframes library-in {
		from {
			opacity: 0;
			transform: translateX(16px);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.voice-library {
			animation: none !important;
		}
	}

	.library-header {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		padding: 1.125rem 1.25rem 0.75rem;
	}
	.library-eyebrow {
		font-size: 0.6875rem;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--muted-foreground);
	}
	.library-title {
		margin: 0.125rem 0 0;
		font-family: var(--font-serif, inherit);
		font-size: 1.125rem;
		font-weight: 600;
		line-height: 1.35;
	}
	.library-title:focus {
		outline: none;
	}
	.library-purpose,
	.library-current {
		margin-top: 0.25rem;
		font-size: 0.75rem;
		line-height: 1.4;
		color: var(--muted-foreground);
	}
	.library-current {
		color: var(--foreground);
		font-weight: 500;
	}
	.library-close {
		display: grid;
		place-items: center;
		flex-shrink: 0;
		width: 36px;
		height: 36px;
		border: 0;
		border-radius: 10px;
		background: none;
		color: var(--muted-foreground);
		cursor: pointer;
	}
	.library-close:hover {
		color: var(--foreground);
		background: var(--control);
	}
	.library-close:focus-visible {
		outline: 2px solid var(--primary);
		outline-offset: 2px;
	}
	.library-search {
		padding: 0 1.25rem 0.75rem;
	}

	.library-scroll {
		display: flex;
		flex: 1 1 auto;
		flex-direction: column;
		gap: 1.25rem;
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: 0.25rem 1.25rem 1rem;
	}

	.model-group {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
	}
	.model-header {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		padding-bottom: 0.25rem;
		border-bottom: 1px solid var(--border);
	}
	.model-name {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.5rem;
		margin: 0;
		font-size: 0.9375rem;
		font-weight: 650;
	}
	.model-count {
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--muted-foreground);
	}
	.model-summary {
		font-size: 0.8125rem;
		line-height: 1.45;
	}
	.model-details,
	.model-hint {
		font-size: 0.75rem;
		line-height: 1.4;
		color: var(--muted-foreground);
	}
	.model-download {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.375rem;
	}

	.voice-list {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.voice-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 0.75rem;
		padding: 0.5rem 0.625rem 0.5rem 0.25rem;
		border: 1px solid transparent;
		border-radius: 12px;
		background: var(--surface-2);
	}
	.voice-row[data-selected='true'] {
		border-color: var(--primary);
		background: color-mix(in srgb, var(--primary) 9%, var(--surface-2));
	}
	.voice-choice {
		display: flex;
		flex: 1 1 12rem;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.125rem;
		min-width: 0;
		min-height: 36px;
		padding: 0.25rem 0.5rem;
		border: 0;
		border-radius: 9px;
		background: none;
		color: inherit;
		cursor: pointer;
		text-align: left;
	}
	.voice-choice:hover .voice-name {
		color: var(--primary);
	}
	.voice-choice:focus-visible {
		outline: 2px solid var(--primary);
		outline-offset: 2px;
	}
	.voice-name {
		font-size: 0.875rem;
		font-weight: 600;
		line-height: 1.3;
	}
	.voice-facts {
		font-size: 0.75rem;
		line-height: 1.35;
		/* Stronger than --muted-foreground so 12px text clears AA on the tinted selected row. */
		color: color-mix(in srgb, var(--foreground) 62%, var(--muted-foreground));
	}
	.voice-tags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.5rem;
		margin-top: 0.125rem;
	}
	.tag {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.6875rem;
		font-weight: 600;
		line-height: 1.4;
		color: color-mix(in srgb, var(--foreground) 62%, var(--muted-foreground));
	}
	.tag-selected {
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--primary);
	}
	.tag-installed {
		color: var(--good);
	}
	.voice-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: flex-end;
		gap: 0.375rem;
		margin-left: auto;
	}
	/* The project's touch floor, for every button in the library. */
	.voice-library :global(.neo-button) {
		min-height: 36px;
	}

	.download-progress {
		display: flex;
		flex: 1 1 14rem;
		flex-direction: column;
		gap: 0.375rem;
		min-width: 12rem;
	}
	.download-status {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		font-size: 0.75rem;
		color: var(--muted-foreground);
	}
	.library-error {
		flex-basis: 100%;
		font-size: 0.75rem;
		line-height: 1.4;
		color: var(--error);
	}
	.library-empty {
		padding: 1.5rem 0.25rem;
		font-size: 0.8125rem;
		line-height: 1.5;
		color: var(--muted-foreground);
	}

	.library-footer {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.625rem;
		padding: 0.75rem 1.25rem 1rem;
		border-top: 1px solid var(--border);
	}
	.library-note {
		flex: 1 1 12rem;
		font-size: 0.75rem;
		line-height: 1.4;
		color: var(--muted-foreground);
	}
</style>
