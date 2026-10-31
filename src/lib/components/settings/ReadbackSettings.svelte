<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

<script lang="ts">
	import { quickCollapse } from '#lib/neo.js';
	import { tick } from 'svelte';
	import {
		appSettings,
		resetVoiceTuning,
		setSetting,
		setVoiceTuning,
		voiceTuning
	} from '#lib/stores/settings.js';
	import { elevenLabsApiKey, openaiApiKey } from '#lib/stores/secrets.js';
	import { ttsApiRequiresKey } from '#lib/stores/ttsConfig.js';
	import {
		listElevenLabsVoices,
		type ElevenLabsVoice,
		type LibraryAccess
	} from '#lib/speech/tts/cloud/elevenLabsVoices.js';
	import {
		libraryRefusedKeys,
		libraryVoicesRefused,
		replaceUnusableElevenLabsVoice
	} from '#lib/stores/elevenLabsVoice.js';
	import {
		explanationVoicesFor,
		getExplanationVoice,
		getInstructionLanguage,
		getVoice,
		isNeutralTuning,
		requireLanguage,
		type VoiceTuning
	} from '#lib/languages/index.js';
	import { PIPER_VOICES_BASE } from '#lib/speech/tts/piper/assets.js';
	import { downloadLanguageData, languageData } from '#lib/stores/languageData.js';
	import { formatBytes } from '#lib/utils/bytes.js';
	import { listLocalVoices } from '#lib/speech/tts/service.js';
	import { tuningBands } from '#lib/utils/audioEffects.js';
	import { pauseVoicePreview, playVoicePreview, ttsPreview } from '#lib/stores/ttsPreview.js';
	import VoicePreview from '#lib/components/VoicePreview.svelte';
	import SettingRow from '#lib/components/settings/SettingRow.svelte';
	import SettingSelect from '#lib/components/settings/SettingSelect.svelte';
	import VoicePicker from '#lib/components/settings/VoicePicker.svelte';
	import SecretInput from '#lib/components/settings/SecretInput.svelte';
	import VoiceEqualizer from '#lib/components/settings/VoiceEqualizer.svelte';
	import { NeoButton } from '@dvcol/neo-svelte/buttons';
	import { NeoCollapse } from '@dvcol/neo-svelte/collapse';
	import { NeoInput } from '@dvcol/neo-svelte/inputs';
	import { Download, ExternalLink, Loader2, Pause, Play, RefreshCw, RotateCcw } from '@lucide/svelte';

	const INPUT_CLASS = 'w-full @md/field-group:w-72';

	const TTS_PROVIDERS = [
		{ value: 'elevenlabs', label: 'ElevenLabs' },
		{ value: 'openai', label: 'OpenAI / local server' }
	];

	const OPENAI_PRESETS = [
		{
			value: 'openai',
			label: 'OpenAI',
			url: 'https://api.openai.com/v1',
			model: 'gpt-4o-mini-tts',
			voice: 'alloy'
		},
		{
			value: 'local',
			label: 'Local server',
			url: 'http://localhost:8880/v1',
			model: 'tts-1',
			voice: 'alloy'
		},
		{ value: 'custom', label: 'Custom', url: '', model: '', voice: '' }
	];

	const OPENAI_VOICES = [
		{ value: 'alloy', label: 'Alloy', description: 'Balanced and neutral' },
		{ value: 'ash', label: 'Ash', description: 'Clear and conversational' },
		{ value: 'ballad', label: 'Ballad', description: 'Warm and melodic' },
		{ value: 'coral', label: 'Coral', description: 'Bright and expressive' },
		{ value: 'echo', label: 'Echo', description: 'Smooth and measured' },
		{ value: 'fable', label: 'Fable', description: 'Narrative and expressive' },
		{ value: 'nova', label: 'Nova', description: 'Friendly and energetic' },
		{ value: 'onyx', label: 'Onyx', description: 'Deep and authoritative' },
		{ value: 'sage', label: 'Sage', description: 'Calm and thoughtful' },
		{ value: 'shimmer', label: 'Shimmer', description: 'Light and upbeat' },
		{ value: 'verse', label: 'Verse', description: 'Natural and versatile' }
	];

	const local = $derived($appSettings.ttsMode === 'local');
	const provider = $derived($appSettings.ttsCloudProvider);
	const voices = $derived(listLocalVoices($appSettings.targetLanguage));
	const tuning = $derived(voiceTuning($appSettings, $appSettings.ttsVoice));
	const tuningActive = $derived(!isNeutralTuning(tuning));
	const voiceLabel = $derived(
		voices.find((voice) => voice.id === $appSettings.ttsVoice)?.label ?? 'this voice'
	);
	const bands = $derived(
		tuningBands(getVoice($appSettings.targetLanguage, $appSettings.ttsVoice)?.processing)
	);
	const previewPlaying = $derived($ttsPreview.playing);
	const apiNeedsKey = $derived(ttsApiRequiresKey($appSettings));

	let elevenVoices = $state<ElevenLabsVoice[]>([]);
	/** True once the account's voices have loaded, so a saved voice missing from them can be flagged. */
	let elevenVoicesLoaded = $state(false);
	let refreshingVoices = $state(false);
	let voiceMessage = $state('');
	let showAdvanced = $state(false);
	let advancedSection = $state<HTMLElement | null>(null);
	/** Key whose voices were already requested automatically, so it runs once per key. */
	let autoLoadedKey = '';

	// With a saved key, the picker should already list the account's voices instead
	// of asking for a manual refresh. A failed silent load keeps the manual button.
	$effect(() => {
		const key = $elevenLabsApiKey.trim();
		if (!key || key === autoLoadedKey) return;
		autoLoadedKey = key;
		void refreshVoices(true);
	});

	// When ElevenLabs refuses a library voice for this key (a take or a preview
	// hit HTTP 402), list the voices again so the ones it cannot use disappear.
	/** Key whose voices were listed again after a refusal, so it happens once per key. */
	let relistedAfterRefusal = '';
	$effect(() => {
		const key = $elevenLabsApiKey.trim();
		const refused = $libraryRefusedKeys && libraryVoicesRefused(key);
		if (!refused || key === relistedAfterRefusal || !elevenVoicesLoaded) return;
		relistedAfterRefusal = key;
		void refreshVoices(true);
	});

	/** Why library voices are missing from the list, in the learner's terms. */
	const HIDDEN_REASON: Record<Exclude<LibraryAccess, 'allowed'>, string> = {
		'free-plan': 'the free plan cannot use them through the API',
		refused: 'ElevenLabs refused one for this key, so its plan cannot use them',
		unknown:
			'this key cannot read your plan. If you are on a paid plan, give the key the "User: Read" permission and refresh'
	};

	const elevenModelOptions = $derived.by(() => {
		const options = [
			{ value: 'eleven_multilingual_v2', label: 'Multilingual v2 · best quality' },
			{ value: 'eleven_turbo_v2_5', label: 'Turbo v2.5 · faster, half the credits' }
		];
		const current = $appSettings.elevenLabsModel;
		if (current && !options.some((option) => option.value === current)) {
			options.push({ value: current, label: `${current} (saved)` });
		}
		return options;
	});

	const apiPreset = $derived.by(() => {
		const url = $appSettings.ttsApiBaseUrl.trim().replace(/\/+$/, '');
		if (url === 'https://api.openai.com/v1') return 'openai';

		try {
			const host = new URL(url).hostname;
			if (host === 'localhost' || host === '127.0.0.1') return 'local';
		} catch {
			// An incomplete URL is a custom endpoint until it is fixed.
		}

		return 'custom';
	});

	const localVoiceOptions = $derived(
		voices.map((voice) => ({
			value: voice.id,
			label: voice.label,
			description: voice.note ?? 'On-device Piper voice'
		}))
	);

	/*
	 * The voice for explanations, in the language of instruction: auditioned
	 * from short hosted samples, so comparing them downloads no models; only the
	 * chosen one is downloaded, with the language data.
	 */
	const targetLanguage = $derived(requireLanguage($appSettings.targetLanguage));
	const instruction = $derived(getInstructionLanguage($appSettings.instructionLanguage));
	const explanationVoiceOptions = $derived(
		explanationVoicesFor(instruction.id).map((voice) => ({
			value: voice.id,
			label: voice.name,
			description: `${voice.downloadSize} · on-device Piper voice`
		}))
	);
	const chosenExplanationVoice = $derived(getExplanationVoice(instruction.id, $appSettings.explanationVoice));
	let sample: HTMLAudioElement | null = null;
	let samplePlaying = $state(false);

	function stopSample(): void {
		sample?.pause();
		sample = null;
		samplePlaying = false;
	}

	function toggleSample(): void {
		if (samplePlaying) {
			stopSample();
			return;
		}
		if (!chosenExplanationVoice?.samplePath) return;
		sample = new Audio(`${PIPER_VOICES_BASE}${chosenExplanationVoice.samplePath}`);
		sample.addEventListener('ended', stopSample);
		samplePlaying = true;
		sample.play().catch(stopSample);
	}

	// Another voice chosen: the sample playing belongs to the old one.
	$effect(() => {
		void $appSettings.explanationVoice;
		return stopSample;
	});

	const elevenVoiceOptions = $derived.by((): { value: string; label: string; description?: string }[] => {
		const options = elevenVoices.map((voice) => ({
			value: voice.id,
			label: voice.name,
			description: voice.description || 'ElevenLabs account voice'
		}));
		const current = $appSettings.elevenLabsVoiceId;
		if (current && !options.some((option) => option.value === current)) {
			// Not among the voices this key can use: a hidden library voice, or a
			// voice removed from the account.
			options.unshift({
				value: current,
				label: current,
				description: elevenVoicesLoaded
					? 'Saved voice ID, not available to this account · choose another voice'
					: 'Saved voice ID; refresh to load your account voices'
			});
		}
		if (!current) {
			options.unshift({
				value: '',
				label: elevenVoices.length > 0 ? 'Choose a voice' : 'Refresh to load voices',
				description: 'Preview the selected voice before practising'
			});
		}
		return options;
	});

	const openAiVoiceOptions = $derived.by((): { value: string; label: string; description?: string }[] => {
		const options = [...OPENAI_VOICES];
		const current = $appSettings.ttsApiVoice;
		if (current && !options.some((option) => option.value === current)) {
			options.unshift({
				value: current,
				label: `${current} (saved)`,
				description: 'Saved voice ID; choose a built-in OpenAI voice below'
			});
		}
		if (!current) {
			options.unshift({
				value: '',
				label: 'Choose a voice',
				description: 'OpenAI built-in text-to-speech voices'
			});
		}
		return options;
	});

	const previewLoading = $derived($ttsPreview.status === 'loading');
	const previewAvailable = $derived(
		local ||
			(provider === 'elevenlabs'
				? Boolean(
						$elevenLabsApiKey.trim() &&
						$appSettings.elevenLabsModel.trim() &&
						$appSettings.elevenLabsVoiceId.trim()
					)
				: Boolean(
						$appSettings.ttsApiBaseUrl.trim() &&
						$appSettings.ttsApiModel.trim() &&
						$appSettings.ttsApiVoice.trim() &&
						(!apiNeedsKey || $openaiApiKey.trim())
					))
	);
	const previewLabel = $derived(
		previewLoading ? 'Generating…' : previewPlaying ? 'Pause preview' : 'Preview voice'
	);

	function togglePreview(): void {
		if (previewPlaying) pauseVoicePreview();
		else void playVoicePreview();
	}

	function updateTuning(key: keyof VoiceTuning, value: number): void {
		setVoiceTuning($appSettings.ttsVoice, { [key]: value } as Partial<VoiceTuning>);
	}

	function showAdvancedSettings(): void {
		if (showAdvanced) return;
		showAdvanced = true;
		void tick().then(() => {
			const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
			advancedSection?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
		});
	}

	function chooseProvider(value: string): void {
		setSetting('ttsCloudProvider', value as 'elevenlabs' | 'openai');
		voiceMessage = '';
	}

	function chooseOpenAiPreset(value: string): void {
		const preset = OPENAI_PRESETS.find((entry) => entry.value === value);
		if (!preset) return;
		if (preset.url) setSetting('ttsApiBaseUrl', preset.url);
		if (preset.model) setSetting('ttsApiModel', preset.model);
		if (preset.voice) setSetting('ttsApiVoice', preset.voice);
	}

	async function refreshVoices(silent = false): Promise<void> {
		if (refreshingVoices) return;
		refreshingVoices = true;
		if (!silent) voiceMessage = '';

		try {
			const apiKey = $elevenLabsApiKey;
			const { voices, hiddenLibraryVoices, libraryAccess } = await listElevenLabsVoices(apiKey, {
				libraryRefused: libraryVoicesRefused(apiKey)
			});
			elevenVoices = voices;
			elevenVoicesLoaded = true;

			// A saved voice the plan certainly cannot use would fail on the next take;
			// swap it now. With an unreadable plan, the first refusal does it instead.
			const savedVoice = $appSettings.elevenLabsVoiceId;
			const savedVoiceUsable = voices.some((voice) => voice.id === savedVoice);
			const planCannotUseLibrary = libraryAccess === 'free-plan' || libraryAccess === 'refused';
			if (savedVoice && !savedVoiceUsable && planCannotUseLibrary) replaceUnusableElevenLabsVoice();

			const found = `${voices.length} voice${voices.length === 1 ? '' : 's'}`;
			const hiddenVoices = `${hiddenLibraryVoices} Voice Library voice${hiddenLibraryVoices === 1 ? ' is' : 's are'}`;
			const hidden =
				hiddenLibraryVoices > 0 && libraryAccess !== 'allowed'
					? ` ${hiddenVoices} hidden: ${HIDDEN_REASON[libraryAccess]}.`
					: '';
			voiceMessage = `${silent ? `${found} from your account.` : `Found ${found}.`}${hidden}`;
		} catch (error) {
			voiceMessage = silent ? '' : error instanceof Error ? error.message : String(error);
			if (silent) autoLoadedKey = '';
		} finally {
			refreshingVoices = false;
		}
	}
</script>

{#snippet sampleButton()}
	<NeoButton rounded class="small-button" disabled={!chosenExplanationVoice} onclick={toggleSample}>
		{#snippet icon()}
			{#if samplePlaying}<Pause class="size-3.5" />{:else}<Play class="size-3.5" />{/if}
		{/snippet}
		{samplePlaying ? 'Stop sample' : 'Play sample'}
	</NeoButton>
{/snippet}

{#snippet previewButton()}
	<NeoButton
		rounded
		class="small-button"
		disabled={previewLoading || !previewAvailable}
		onclick={togglePreview}
	>
		{#snippet icon()}
			{#if previewLoading}
				<Loader2 class="size-3.5 animate-spin" />
			{:else if previewPlaying}
				<Pause class="size-3.5" />
			{:else}
				<Play class="size-3.5" />
			{/if}
		{/snippet}
		{previewLabel}
	</NeoButton>
{/snippet}

<div class:hidden={!local}>
		<SettingRow label="Voice" for="ttsVoice">
			<div class="w-full @md/field-group:w-72">
				<VoicePicker
					id="ttsVoice"
					title="Piper voice"
					options={localVoiceOptions}
					value={$appSettings.ttsVoice}
					onchange={(value) => setSetting('ttsVoice', value)}
				>
					{#snippet footer()}{@render previewButton()}{/snippet}
				</VoicePicker>
			</div>
			{#snippet below()}
				{#if !showAdvanced}
					<p class="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground @md/field-group:justify-end">
						{tuningActive
							? 'Custom equalizer settings are applied to this voice.'
							: 'Fine-tune this voice with a 4-band equalizer.'}
						<button type="button" class="settings-link" onclick={showAdvancedSettings}>Adjust</button>
					</p>
				{/if}
			{/snippet}
		</SettingRow>

		<NeoCollapse transition={quickCollapse} bind:open={showAdvanced} standalone class="advanced-settings">
			<div bind:this={advancedSection} class="border-b pt-4 pb-5">
				<div class="mb-3.5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
					<div class="min-w-0">
						<p class="text-sm font-medium">Equalizer</p>
						<p class="mt-0.5 max-w-sm text-xs leading-relaxed text-muted-foreground">
							Tunes {voiceLabel} relative to its approved sound, for every spoken reply, word
							and preview.
						</p>
					</div>
					<NeoButton
						rounded
						class="small-button self-start sm:self-auto"
						disabled={!tuningActive}
						onclick={() => resetVoiceTuning($appSettings.ttsVoice)}
					>
						{#snippet icon()}<RotateCcw class="size-3.5" />{/snippet}
						Reset to approved sound
					</NeoButton>
				</div>

				<VoiceEqualizer {tuning} {bands} playing={previewPlaying} onchange={updateTuning} />
				<p class="mt-2.5 text-xs text-muted-foreground">
					Play the preview below with Loop on to hear changes live. Double-click a fader to zero
					it.
				</p>
			</div>
		</NeoCollapse>

		<SettingRow
			label={`${instruction.name} voice`}
			for="explanationVoice"
			hint={explanationVoiceOptions.length > 0
				? `Reads the ${instruction.name} of explanations; their ${targetLanguage.name} words keep the voice above.`
				: `No on-device ${instruction.name} voice yet: explanations are spoken with Cloud text-to-speech.`}
		>
			<div class="w-full @md/field-group:w-72" class:hidden={explanationVoiceOptions.length === 0}>
				<VoicePicker
					id="explanationVoice"
					title={`${instruction.name} voice for explanations`}
					options={explanationVoiceOptions}
					value={$appSettings.explanationVoice}
					onchange={(value) => setSetting('explanationVoice', value)}
				>
					{#snippet footer()}{@render sampleButton()}{/snippet}
				</VoicePicker>
			</div>
			{#snippet below()}
				<p
					class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground @md/field-group:justify-end"
					class:hidden={explanationVoiceOptions.length === 0}
				>
					{!chosenExplanationVoice
						? 'Pick one to hear explanations on this device.'
						: $languageData.installed.explanationVoice
							? 'Installed on this device.'
							: 'Not installed yet.'}
					{@render sampleButton()}
					{#if chosenExplanationVoice && !$languageData.installed.explanationVoice && $languageData.status !== 'checking'}
						<NeoButton
							rounded
							color="primary"
							class="small-button"
							disabled={$languageData.status === 'downloading'}
							onclick={() => void downloadLanguageData()}
						>
							{#snippet icon()}<Download class="size-3.5" />{/snippet}
							{$languageData.status === 'downloading'
								? 'Installing…'
								: `Install${$languageData.pending?.explanationVoice ? ` ${formatBytes($languageData.pending.explanationVoice)}` : ''}`}
						</NeoButton>
					{/if}
				</p>
			{/snippet}
		</SettingRow>
	</div>
	<div class:hidden={local}>
		<SettingRow label="Provider" for="ttsProvider">
			<SettingSelect
				id="ttsProvider"
				label="Cloud text-to-speech provider"
				options={TTS_PROVIDERS}
				value={provider}
				onchange={chooseProvider}
			/>
		</SettingRow>

		<div class:hidden={provider !== 'elevenlabs'}>
			<SettingRow label="API key" for="elevenLabsKey">
				<SecretInput id="elevenLabsKey" label="ElevenLabs API key" bind:value={$elevenLabsApiKey} />
			</SettingRow>
			<SettingRow
				label="Model"
				for="elevenLabsModel"
				hint="Multilingual v2 sounds best and costs 1 credit per character; Turbo v2.5 is faster and costs half as much."
			>
				<SettingSelect
					id="elevenLabsModel"
					label="ElevenLabs model"
					options={elevenModelOptions}
					value={$appSettings.elevenLabsModel}
					onchange={(value) => setSetting('elevenLabsModel', value)}
				/>
			</SettingRow>
			<SettingRow
				label="Voice"
				for="elevenLabsVoice"
				hint="Any multilingual voice can speak your target language; pick one that sounds right."
			>
				<div class="w-full @md/field-group:w-72">
					<VoicePicker
						id="elevenLabsVoice"
						title="ElevenLabs voice"
						options={elevenVoiceOptions}
						value={$appSettings.elevenLabsVoiceId}
						onchange={(value) => {
							if (value) setSetting('elevenLabsVoiceId', value);
						}}
						note={voiceMessage}
					>
						{#snippet footer()}
							{@render previewButton()}
							<NeoButton
								rounded
								class="small-button"
								onclick={() => void refreshVoices()}
								disabled={refreshingVoices}
							>
								{#snippet icon()}<RefreshCw class="size-3.5 {refreshingVoices ? 'animate-spin' : ''}" />{/snippet}
								{refreshingVoices ? 'Refreshing…' : 'Refresh voices'}
							</NeoButton>
						{/snippet}
					</VoicePicker>
				</div>
			</SettingRow>
			<p class="py-3.5 text-xs leading-normal text-muted-foreground">
				The corrected text is sent to ElevenLabs. The free plan has a monthly character allowance;
				check your plan. The multilingual model covers French and Japanese; pick a voice that
				sounds right in your target language.
				<a href="https://elevenlabs.io/app/settings/api-keys" target="_blank" rel="noreferrer" class="settings-link ml-1">
					API keys <ExternalLink class="size-3" />
				</a>
				<a href="https://elevenlabs.io/voice-library" target="_blank" rel="noreferrer" class="settings-link ml-2">
					Voice library <ExternalLink class="size-3" />
				</a>
			</p>
		</div>
		<div class:hidden={provider !== 'openai'}>
			<SettingRow label="Endpoint" for="ttsApiPreset">
				<SettingSelect
					id="ttsApiPreset"
					label="Speech API"
					options={OPENAI_PRESETS.map((preset) => ({ value: preset.value, label: preset.label }))}
					value={apiPreset}
					onchange={chooseOpenAiPreset}
				/>
			</SettingRow>
			<SettingRow label="Base URL" for="ttsApiBaseUrl" hint="OpenAI's URL or your own /v1 speech server.">
				<div class={INPUT_CLASS}>
					<NeoInput
						id="ttsApiBaseUrl"
						rounded
						pressed
						elevation={-2}
						width="100%"
						placeholder="https://api.openai.com/v1"
						value={$appSettings.ttsApiBaseUrl}
						oninput={(event: Event) =>
							setSetting('ttsApiBaseUrl', (event.target as HTMLInputElement).value)}
					/>
				</div>
			</SettingRow>
			<SettingRow label="Model" for="ttsApiModel">
				<div class={INPUT_CLASS}>
					<NeoInput
						id="ttsApiModel"
						rounded
						pressed
						elevation={-2}
						width="100%"
						placeholder="gpt-4o-mini-tts"
						value={$appSettings.ttsApiModel}
						oninput={(event: Event) =>
							setSetting('ttsApiModel', (event.target as HTMLInputElement).value)}
					/>
				</div>
			</SettingRow>
			<SettingRow
				label="Voice"
				for={apiPreset === 'openai' ? 'ttsApiVoiceSelect' : 'ttsApiVoice'}
				hint={apiPreset === 'openai'
					? 'OpenAI accepts alloy, nova, shimmer and others.'
					: 'The voice id your speech server expects.'}
			>
				<div class:hidden={apiPreset !== 'openai'} class="w-full @md/field-group:w-72">
					<VoicePicker
						id="ttsApiVoiceSelect"
						title="OpenAI voice"
						options={openAiVoiceOptions}
						value={$appSettings.ttsApiVoice}
						onchange={(value) => {
							if (value) setSetting('ttsApiVoice', value);
						}}
					>
						{#snippet footer()}{@render previewButton()}{/snippet}
					</VoicePicker>
				</div>
				<div class:hidden={apiPreset === 'openai'}>
					<div class={INPUT_CLASS}>
						<NeoInput
							id="ttsApiVoice"
							rounded
							pressed
							elevation={-2}
							width="100%"
							placeholder="alloy"
							value={$appSettings.ttsApiVoice}
							oninput={(event: Event) =>
								setSetting('ttsApiVoice', (event.target as HTMLInputElement).value)}
						/>
					</div>
				</div>
				{#snippet below()}
					{#if apiPreset !== 'openai'}
						<div class="mt-2.5 flex flex-wrap items-center gap-2 @md/field-group:justify-end">
							{@render previewButton()}
						</div>
					{/if}
				{/snippet}
			</SettingRow>
			<SettingRow
				label="API key"
				for="ttsApiKey"
				hint={apiNeedsKey ? 'Required by OpenAI.' : 'Not needed for this local endpoint.'}
			>
				<SecretInput id="ttsApiKey" label="Text-to-speech API key" bind:value={$openaiApiKey} />
			</SettingRow>
			<p class="py-3.5 text-xs leading-normal text-muted-foreground">
				OpenAI supports every onspot language. A local server must carry the target language and
				accept OpenAI's <code>/audio/speech</code> request.
				<a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer" class="settings-link ml-1">
					OpenAI API keys <ExternalLink class="size-3" />
				</a>
			</p>
		</div>
	</div>

	<div class="my-4">
		<VoicePreview />
	</div>
