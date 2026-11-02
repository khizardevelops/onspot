<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

<script lang="ts">
	import { NeoButton } from '@dvcol/neo-svelte/buttons';
	import { NeoDialog } from '@dvcol/neo-svelte/floating/dialog';
	import { quickDialog } from '#lib/neo.js';
	import {
		OFFERED_LANGUAGES,
		DEFAULT_LANGUAGE_ID,
		defaultVoiceOf,
		getLanguage,
		isCandidate
	} from '#lib/languages/index.js';
	import { setSetting } from '#lib/stores/settings.js';
	import { setTargetLanguage } from '#lib/stores/practice.js';
	import { localSttModel } from '#lib/speech/stt/service.js';
	import PaperSegmentedControl from '#lib/components/PaperSegmentedControl.svelte';
	import { Check } from '@lucide/svelte';

	let selected = $state(DEFAULT_LANGUAGE_ID);
	let sttMode = $state<'local' | 'cloud'>('local');
	let correctionMode = $state<'cloud' | 'local'>('cloud');
	let ttsMode = $state<'local' | 'cloud'>('local');
	let step = $state(1);
	let saving = $state(false);
	// A required first-run choice: the dialog cannot be dismissed, only answered.
	let open = $state(true);

	const language = $derived(getLanguage(selected));
	const sttBytes = $derived(language ? (localSttModel(language.id)?.bytes ?? 0) : 0);
	const voiceBytes = $derived(language ? (defaultVoiceOf(language)?.downloadBytes ?? 0) : 0);
	const downloadBytes = $derived(
		(sttMode === 'local' ? sttBytes : 0) + (ttsMode === 'local' ? voiceBytes : 0)
	);
	const downloadLabel = $derived(`${Math.round(downloadBytes / 1e6)} MB`);

	async function confirm(): Promise<void> {
		if (saving) return;
		saving = true;
		try {
			await setTargetLanguage(selected);
			setSetting('sttMode', sttMode);
			setSetting('correctionMode', correctionMode);
			setSetting('ttsMode', ttsMode);
			open = false;
		} finally {
			saving = false;
		}
	}
</script>

<NeoDialog
	{...quickDialog}
	bind:open
	modal
	closedby="none"
	rounded
	elevation={3}
	width={{ max: 'min(30rem, calc(100vw - 2rem))' }}
	padding="0"
	aria-label={step === 1
		? 'Choose the language you want to study'
		: 'Choose how each step runs'}
	class="language-gate"
>
	<div class="p-6 sm:p-8">
		<div
			class="brand-orb grid size-12 place-items-center rounded-2xl text-lg font-semibold text-white shadow-lg"
			aria-hidden="true"
		>
			o
		</div>

		{#if step === 1}
			<h1 class="mt-5 font-serif text-2xl font-medium">What do you want to study?</h1>
			<p class="mt-2 text-sm leading-relaxed text-muted-foreground">
				You can switch languages later in Settings. Nothing downloads until you ask.
			</p>

			<div class="mt-5 flex flex-col gap-2.5" role="radiogroup" aria-label="Supported languages">
				{#each OFFERED_LANGUAGES as language (language.id)}
					{@const active = selected === language.id}
					<NeoButton
						class="language-option"
						role="radio"
						aria-checked={active}
						rounded
						elevation={active ? -2 : 2}
						hover={active ? 0 : -1}
						color={active ? 'primary' : undefined}
						onclick={() => (selected = language.id)}
					>
						<span class="min-w-0 flex-1 text-left">
							<span class="block text-sm font-semibold">{language.name}</span>
							<span class="block text-xs text-muted-foreground">
								{language.nativeName}{#if isCandidate(language)} · candidate, not yet approved{/if}
							</span>
						</span>
						{#if active}
							<span class="grid size-6 place-items-center rounded-full bg-[var(--brand)] text-white">
								<Check class="size-3.5" />
							</span>
						{/if}
					</NeoButton>
				{/each}
			</div>

			<p class="mt-4 text-xs leading-relaxed text-muted-foreground">
				Speech and voice models download from the internet onto your device. Nothing is bundled
				with the app.
			</p>

			<NeoButton
				class="confirm-button mt-5"
				rounded
				elevation={3}
				tinted
				color="primary"
				onclick={() => (step = 2)}
			>
				Continue
			</NeoButton>
		{:else}
			<h1 class="mt-5 font-serif text-2xl font-medium">How should each step work?</h1>
			<p class="mt-2 text-sm leading-relaxed text-muted-foreground">
				Speech-to-text, the LLM and text-to-speech are independent. Pick Local or Cloud for each;
				you can change them later in Settings.
			</p>

			<div class="choice-list mt-4">
				<div class="choice-row">
					<div class="choice-copy">
						<p class="choice-title">Speech-to-text</p>
						<p class="choice-hint">
							{sttMode === 'local' ? 'Whisper on this device.' : 'Groq Whisper in the cloud.'}
						</p>
					</div>
					<PaperSegmentedControl
						value={sttMode}
						options={[
							{ value: 'local', label: 'Local' },
							{ value: 'cloud', label: 'Cloud' }
						]}
						ariaLabel="Speech-to-text processing"
						size="sm"
						onValueChange={(value) => (sttMode = value as 'local' | 'cloud')}
					/>
				</div>

				<div class="choice-row">
					<div class="choice-copy">
						<p class="choice-title">LLM</p>
						<p class="choice-hint">
							{correctionMode === 'local'
								? 'Your own OpenAI-compatible server.'
								: 'Groq or DeepSeek in the cloud.'}
						</p>
					</div>
					<PaperSegmentedControl
						value={correctionMode}
						options={[
							{ value: 'local', label: 'Local' },
							{ value: 'cloud', label: 'Cloud' }
						]}
						ariaLabel="LLM processing"
						size="sm"
						onValueChange={(value) => (correctionMode = value as 'cloud' | 'local')}
					/>
				</div>

				<div class="choice-row">
					<div class="choice-copy">
						<p class="choice-title">Text-to-speech</p>
						<p class="choice-hint">
							{ttsMode === 'local'
								? 'Piper on this device.'
								: 'ElevenLabs or OpenAI in the cloud.'}
						</p>
					</div>
					<PaperSegmentedControl
						value={ttsMode}
						options={[
							{ value: 'local', label: 'Local' },
							{ value: 'cloud', label: 'Cloud' }
						]}
						ariaLabel="Text-to-speech processing"
						size="sm"
						onValueChange={(value) => (ttsMode = value as 'local' | 'cloud')}
					/>
				</div>
			</div>

			<p class="mt-4 text-xs leading-relaxed text-muted-foreground">
				{#if downloadBytes > 0}
					About {downloadLabel} will be downloaded for the local steps.
				{:else}
					No speech downloads.
				{/if}
				Cloud steps need their API keys, added later in Settings.{#if correctionMode === 'local'}
					The LLM needs an OpenAI-compatible server you run (LM Studio, llama.cpp, Ollama).{/if}
			</p>

			<div class="mt-5 flex gap-2">
				<NeoButton rounded elevation={2} onclick={() => (step = 1)} disabled={saving}>
					Back
				</NeoButton>
				<NeoButton
					class="confirm-button"
					rounded
					elevation={3}
					tinted
					color="primary"
					loading={saving}
					disabled={saving}
					onclick={() => void confirm()}
				>
					{saving ? 'Saving…' : 'Start with this setup'}
				</NeoButton>
			</div>
		{/if}
	</div>
</NeoDialog>

<style>
	.brand-orb {
		background: linear-gradient(145deg, var(--brand), var(--brand-2) 62%, var(--brand-3));
	}
	:global(.neo-button.language-option) {
		width: 100%;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
		justify-content: flex-start;
	}
	:global(.neo-button.confirm-button) {
		width: 100%;
		flex: 1;
		height: 2.75rem;
		justify-content: center;
		font-weight: 600;
	}
	.choice-list {
		display: flex;
		flex-direction: column;
	}
	.choice-row {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.75rem 0;
		border-bottom: 1px solid var(--border);
	}
	.choice-row:last-child {
		border-bottom: 0;
	}
	.choice-copy {
		min-width: 0;
	}
	.choice-title {
		font-size: 0.875rem;
		font-weight: 600;
		line-height: 1.25rem;
	}
	.choice-hint {
		margin-top: 0.125rem;
		font-size: 0.75rem;
		line-height: 1.1rem;
		color: var(--muted-foreground);
	}
	@media (min-width: 420px) {
		.choice-row {
			flex-direction: row;
			align-items: center;
			justify-content: space-between;
			gap: 1rem;
		}
	}
</style>
