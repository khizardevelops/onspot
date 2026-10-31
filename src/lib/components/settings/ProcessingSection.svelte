<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

<script lang="ts">
	import { tick } from 'svelte';
	import { appSettings, setSetting } from '#lib/stores/settings.js';
	import {
		cancelLanguageDownload,
		downloadLanguageData,
		languageData
	} from '#lib/stores/languageData.js';
	import { processingRequirements, type ProcessingTarget } from '#lib/stores/processing.js';
	import { defaultVoiceOf, getLanguage, getVoice } from '#lib/languages/index.js';
	import { getProvider } from '#lib/adapters/llm/index.js';
	import SettingsSection from '#lib/components/settings/SettingsSection.svelte';
	import CapabilityRow from '#lib/components/settings/CapabilityRow.svelte';
	import TranscriptionSettings from '#lib/components/settings/TranscriptionSettings.svelte';
	import CorrectionSettings from '#lib/components/settings/CorrectionSettings.svelte';
	import ReadbackSettings from '#lib/components/settings/ReadbackSettings.svelte';
	import { NeoButton } from '@dvcol/neo-svelte/buttons';
	import { formatBytes } from '#lib/utils/bytes.js';
	import { NeoProgressBar } from '@dvcol/neo-svelte/progress';
	import { AlertTriangle, Check, Download } from '@lucide/svelte';

	interface Props {
		focus?: ProcessingTarget | null;
		/** Bumped by the Settings page so the same anchor can reopen a row. */
		focusNonce?: number;
	}

	let { focus = null, focusNonce = 0 }: Props = $props();

	const language = $derived(getLanguage($appSettings.targetLanguage));
	const voice = $derived(
		language
			? (getVoice(language.id, $appSettings.ttsVoice) ?? defaultVoiceOf(language))
			: undefined
	);
	const requirements = $derived($processingRequirements);
	const checking = $derived($languageData.status === 'checking');
	const downloading = $derived($languageData.status === 'downloading');
	const dataError = $derived($languageData.status === 'error' ? $languageData.error : null);
	const missing = $derived(requirements.filter((requirement) => !requirement.met));
	const ready = $derived(missing.length === 0 && !checking);
	const downloadBytes = $derived($languageData.pending?.storage ?? 0);
	const localMissing = $derived(
		($appSettings.sttMode === 'local' && !$languageData.installed.stt) ||
			($appSettings.ttsMode === 'local' && !$languageData.installed.voice) ||
			($appSettings.ttsMode === 'local' && !$languageData.installed.explanationVoice)
	);
	const firstSetup = $derived(
		missing.find((requirement) => !requirement.id.endsWith('-download')) ?? null
	);

	const correctionName = $derived(
		$appSettings.correctionMode === 'local'
			? hostOf($appSettings.localLlmUrl)
			: getProvider($appSettings.llmProvider).name
	);
	const readbackName = $derived(
		$appSettings.ttsCloudProvider === 'elevenlabs'
			? 'ElevenLabs'
			: hostOf($appSettings.ttsApiBaseUrl)
	);
	const cloudFlow = $derived(
		[
			$appSettings.sttMode === 'cloud' ? 'recordings → Groq' : null,
			$appSettings.correctionMode === 'cloud' ? `transcripts → ${correctionName}` : null,
			$appSettings.ttsMode === 'cloud' ? `corrected text → ${readbackName}` : null
		].filter((line): line is string => Boolean(line))
	);

	let open = $state<ProcessingTarget | null>(null);

	$effect(() => {
		focusNonce;
		if (focus) open = focus;
	});

	function hostOf(url: string): string {
		try {
			return new URL(url).host;
		} catch {
			return url || 'your server';
		}
	}

	function toggle(target: ProcessingTarget): void {
		open = open === target ? null : target;
	}

	async function focusRow(target: ProcessingTarget): Promise<void> {
		open = target;
		await tick();
		document.getElementById(target)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
	}

	function changeMode(target: ProcessingTarget, value: string): void {
		if (target === 'speech-to-text') setSetting('sttMode', value as 'local' | 'cloud');
		else if (target === 'llm') setSetting('correctionMode', value as 'cloud' | 'local');
		else setSetting('ttsMode', value as 'local' | 'cloud');

		open = target;
	}

	function requirementFor(target: ProcessingTarget) {
		return requirements.find((requirement) => requirement.target === target);
	}

	function statusFor(target: ProcessingTarget): string {
		if (checking) return 'Checking…';
		const requirement = requirementFor(target);
		if (requirement?.met) return 'Ready';
		return requirement?.id.endsWith('-download') ? 'Install' : 'Set up';
	}

	function hintFor(target: ProcessingTarget): string {
		if (target === 'speech-to-text') {
			return `Turn your recording into text. ${
				$appSettings.sttMode === 'local'
					? 'Whisper small on this device.'
					: 'Groq Whisper in the cloud, no download.'
			}`;
		}

		if (target === 'llm') {
			return `Correct and explain what you said. ${
				$appSettings.correctionMode === 'local'
					? 'Your own OpenAI-compatible server.'
					: `${getProvider($appSettings.llmProvider).name} in the cloud.`
			}`;
		}

		return `Speak the corrected sentence back to you. ${
			$appSettings.ttsMode === 'local'
				? `${voice?.name ?? 'Piper'} on this device.`
				: $appSettings.ttsCloudProvider === 'elevenlabs'
					? 'ElevenLabs in the cloud.'
					: 'An OpenAI-compatible speech API.'
		}`;
	}

</script>

{#snippet installButton()}
	<NeoButton
		rounded
		color="primary"
		disabled={downloading || checking || downloadBytes === 0}
		onclick={() => void downloadLanguageData(language?.id)}
	>
		{#snippet icon()}<Download class="size-4" />{/snippet}
		Install{downloadBytes > 0 ? ` ${formatBytes(downloadBytes)}` : ''}
	</NeoButton>
{/snippet}

<SettingsSection id="processing" title="Processing">
	<p class="mb-1 px-1 text-xs leading-relaxed text-muted-foreground">
		Choose Local or Cloud for each step. They are independent, so you can change one without
		touching the others.
	</p>

	<div class="capabilities">
		<CapabilityRow
			id="speech-to-text"
			title="Speech-to-text"
			hint={hintFor('speech-to-text')}
			mode={$appSettings.sttMode}
			status={statusFor('speech-to-text')}
			ready={Boolean(requirementFor('speech-to-text')?.met)}
			open={open === 'speech-to-text'}
			onToggle={() => toggle('speech-to-text')}
			onModeChange={(value) => changeMode('speech-to-text', value)}
		>
			<TranscriptionSettings />
		</CapabilityRow>

		<CapabilityRow
			id="llm"
			title="LLM"
			hint={hintFor('llm')}
			mode={$appSettings.correctionMode}
			status={statusFor('llm')}
			ready={Boolean(requirementFor('llm')?.met)}
			open={open === 'llm'}
			onToggle={() => toggle('llm')}
			onModeChange={(value) => changeMode('llm', value)}
		>
			<CorrectionSettings />
		</CapabilityRow>

		<CapabilityRow
			id="text-to-speech"
			title="Text-to-speech"
			hint={hintFor('text-to-speech')}
			mode={$appSettings.ttsMode}
			status={statusFor('text-to-speech')}
			ready={Boolean(requirementFor('text-to-speech')?.met)}
			open={open === 'text-to-speech'}
			onToggle={() => toggle('text-to-speech')}
			onModeChange={(value) => changeMode('text-to-speech', value)}
		>
			<ReadbackSettings />
		</CapabilityRow>
	</div>

	<div class="processing-footer">
		{#if checking}
			<p class="text-xs text-muted-foreground">Checking installed data…</p>
		{:else if ready}
			<div class="flex flex-wrap items-center justify-between gap-3">
				<p class="flex items-center gap-1.5 text-sm font-medium text-[var(--good)]">
					<Check class="size-4" />
					Ready to practise.
				</p>
				<!-- Practice does not wait for the explanation voice; installing it is still offered. -->
				{#if localMissing}{@render installButton()}{/if}
			</div>
		{:else}
			<div class="flex flex-wrap items-center justify-between gap-3">
				<div class="min-w-0">
					<p class="text-sm font-medium">
						{missing.length} step{missing.length === 1 ? '' : 's'} left
					</p>
					<p class="mt-0.5 max-w-md text-xs leading-normal text-muted-foreground">
						{missing.map((requirement) => requirement.title).join(' · ')}
					</p>
				</div>
				<div class="flex flex-wrap gap-2">
					{#if firstSetup}
						<NeoButton rounded onclick={() => void focusRow(firstSetup.target)}>
							Set up {firstSetup.title}
						</NeoButton>
					{/if}
					{#if localMissing}{@render installButton()}{/if}
				</div>
			</div>
		{/if}

		{#if cloudFlow.length > 0}
			<p class="mt-3 text-xs leading-normal text-muted-foreground">
				Leaves this device: {cloudFlow.join(' · ')}.
			</p>
		{:else if ready}
			<p class="mt-3 text-xs leading-normal text-muted-foreground">No cloud API calls.</p>
		{/if}

		{#if downloading}
			<div class="mt-3 flex flex-col gap-2">
				<NeoProgressBar
					value={$languageData.progress}
					rounded
					height="6px"
					color="var(--brand)"
					aria-label="Language data download progress"
				/>
				<div class="flex items-center justify-between gap-3">
					<p class="min-w-0 truncate text-xs text-muted-foreground">
						{$languageData.statusText || 'Fetching model files…'}
					</p>
					<NeoButton rounded class="small-button" onclick={cancelLanguageDownload}>
						Cancel
					</NeoButton>
				</div>
			</div>
		{/if}

		{#if dataError}
			<p class="mt-3 flex items-start gap-1.5 text-xs text-[var(--error)]">
				<AlertTriangle class="mt-0.5 size-3.5 shrink-0" />
				<span class="break-words">{dataError}</span>
			</p>
		{/if}
	</div>
</SettingsSection>

<style>
	.capabilities {
		display: flex;
		flex-direction: column;
	}
	.capabilities > :global(.capability) + :global(.capability) {
		border-top: 1px solid var(--border);
	}
	.processing-footer {
		padding-top: 1rem;
		border-top: 1px solid var(--border);
	}
</style>
