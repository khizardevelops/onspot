<script lang="ts">
	import { quickCollapse } from '#lib/neo.js';
	import { onMount, tick } from 'svelte';
	import { goto } from '$app/navigation';
	import {
		LEVELS,
		appSettings,
		resetVoiceTuning,
		setSetting,
		setVoiceTuning,
		voiceTuning
	} from '#lib/stores/settings.js';
	import { hydrateLatestSession, setTargetLanguage } from '#lib/stores/practice.js';
	import {
		cancelLanguageDownload,
		downloadLanguageData,
		languageData
	} from '#lib/stores/languageData.js';
	import {
		OFFERED_LANGUAGES,
		isCandidate,
		getLanguage,
		getVoice,
		isNeutralTuning,
		languageDownloadBytes,
		type VoiceTuning
	} from '#lib/languages/index.js';
	import { customApiKey, deepseekApiKey, groqApiKey, openaiApiKey } from '#lib/stores/secrets.js';
	import {
		LLM_PROVIDERS,
		getModelOptions,
		getProvider,
		listModels,
		testConnection,
		type LlmProviderId
	} from '#lib/adapters/llm/index.js';
	import { currentLlmEndpoint } from '#lib/stores/llm.js';
	import { ttsPreview } from '#lib/stores/ttsPreview.js';
	import { listLocalVoices } from '#lib/adapters/tts/service.js';
	import { tuningBands } from '#lib/utils/audioEffects.js';
	import { exportDatabaseFile, importLegacyJsonBackup } from '#lib/utils/export.js';
	import { toast } from '#lib/stores/toast.js';
	import VoicePreview from '#lib/components/VoicePreview.svelte';
	import RestoreDatabaseButton from '#lib/components/RestoreDatabaseButton.svelte';
	import SettingsSection from '#lib/components/settings/SettingsSection.svelte';
	import SettingRow from '#lib/components/settings/SettingRow.svelte';
	import SecretInput from '#lib/components/settings/SecretInput.svelte';
	import VoiceEqualizer from '#lib/components/settings/VoiceEqualizer.svelte';
	import SettingSelect from '#lib/components/settings/SettingSelect.svelte';
	import { NeoButton } from '@dvcol/neo-svelte/buttons';
	import { NeoCard } from '@dvcol/neo-svelte/cards';
	import { NeoCollapse } from '@dvcol/neo-svelte/collapse';
	import { NeoInput } from '@dvcol/neo-svelte/inputs';
	import { NeoTab, NeoTabs } from '@dvcol/neo-svelte/nav';
	import { NeoPill } from '@dvcol/neo-svelte/pill';
	import { NeoProgressBar } from '@dvcol/neo-svelte/progress';
	import {
		AlertTriangle,
		Check,
		Download,
		ExternalLink,
		HardDrive,
		RefreshCw,
		RotateCcw,
		Upload,
		X
	} from '@lucide/svelte';

	const INPUT_CLASS = 'w-full @md/field-group:w-72';

	const voices = $derived(listLocalVoices($appSettings.targetLanguage));
	const language = $derived(getLanguage($appSettings.targetLanguage));
	const downloading = $derived($languageData.status === 'downloading');
	const dataReady = $derived($languageData.status === 'ready');
	const dataError = $derived($languageData.status === 'error' ? $languageData.error : null);
	const tuning = $derived(voiceTuning($appSettings, $appSettings.ttsVoice));
	const tuningActive = $derived(!isNeutralTuning(tuning));
	const voiceLabel = $derived(
		voices.find((voice) => voice.id === $appSettings.ttsVoice)?.label ?? 'this voice'
	);
	const bands = $derived(
		tuningBands(getVoice($appSettings.targetLanguage, $appSettings.ttsVoice)?.processing)
	);
	const previewPlaying = $derived($ttsPreview.playing);

	let showAdvanced = $state(true);
	let advancedSection = $state<HTMLElement | null>(null);
	let remoteModels = $state<string[]>([]);
	let refreshing = $state(false);
	let refreshMessage = $state('');

	let testing = $state(false);
	let testOk = $state<boolean | null>(null);
	let testMessage = $state('');
	let exporting = $state(false);
	let restoring = $state(false);
	let restoreInput = $state<HTMLInputElement | null>(null);

	function updateTuning(key: keyof VoiceTuning, value: number): void {
		setVoiceTuning($appSettings.ttsVoice, { [key]: value } as Partial<VoiceTuning>);
	}

	/** Reveals the advanced controls in place and brings them into view. */
	function showAdvancedSettings(): void {
		if (showAdvanced) return;
		showAdvanced = true;
		void tick().then(() => {
			const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
			advancedSection?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
		});
	}

	function formatBytes(bytes: number): string {
		return `${Math.round(bytes / 1e6)} MB`;
	}

	onMount(() => {
		// Keep the model list current without requiring the user to press
		// Refresh: a key is all the /models call needs.
		const provider = $appSettings.llmProvider;
		if (provider !== 'custom' && keyFor(provider)) void refreshModels();
	});

	async function exportData() {
		exporting = true;
		try {
			if (await exportDatabaseFile()) toast('Database exported');
		} catch (error) {
			toast(error instanceof Error ? error.message : 'Export failed');
		} finally {
			exporting = false;
		}
	}

	async function restoreLegacyBackup(event: Event): Promise<void> {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file || restoring) return;
		restoring = true;
		try {
			const restored = await importLegacyJsonBackup(file);
			await hydrateLatestSession();
			toast(`Restored ${restored.sessions} sessions and ${restored.attempts} takes.`);
			await goto('/history/');
		} catch (error) {
			toast(error instanceof Error ? error.message : 'Restore failed');
		} finally {
			restoring = false;
		}
	}

	const providerConfig = $derived(getProvider($appSettings.llmProvider));

	/** Curated models for the provider, plus any saved/fetched id not in the enum. */
	const modelOptions = $derived.by(() => {
		const base = getModelOptions($appSettings.llmProvider);
		const known = new Set(base.map((option) => option.id));
		const options = [...base];

		const current = $appSettings.llmModel;
		if (current && !known.has(current)) {
			options.push({ id: current, label: `${current} (saved)` });
			known.add(current);
		}
		for (const id of remoteModels) {
			if (known.has(id)) continue;
			options.push({ id, label: id, note: 'From your account' });
			known.add(id);
		}
		return options;
	});

	function keyFor(provider: LlmProviderId): string {
		if (provider === 'groq') return $groqApiKey;
		if (provider === 'deepseek') return $deepseekApiKey;
		return $customApiKey;
	}

	function onProviderChange(value: string) {
		const provider = value as LlmProviderId;
		setSetting('llmProvider', provider);
		remoteModels = [];
		refreshToken++;
		refreshing = false;
		refreshMessage = '';
		testOk = null;
		testMessage = '';
		if (provider !== 'custom') {
			setSetting('llmModel', getProvider(provider).defaultModel);
		}
	}

	let refreshToken = 0;

	async function refreshModels() {
		const provider = $appSettings.llmProvider;
		const apiKey = keyFor(provider);
		if (!apiKey) {
			refreshMessage = `Add your ${providerConfig.name} API key first.`;
			return;
		}
		// A provider switch while the request is out must not fill the new
		// provider's list with the old provider's models.
		const token = ++refreshToken;
		refreshing = true;
		refreshMessage = '';
		try {
			const baseUrl = provider === 'custom' ? $appSettings.customBaseUrl : providerConfig.baseUrl;
			const models = await listModels({ baseUrl, apiKey, model: '' });
			if (token !== refreshToken) return;
			remoteModels = models;
			refreshMessage = `Found ${models.length} model${models.length === 1 ? '' : 's'}.`;
		} catch (error) {
			if (token !== refreshToken) return;
			refreshMessage = error instanceof Error ? error.message : String(error);
		} finally {
			if (token === refreshToken) refreshing = false;
		}
	}

	// A connection result describes the endpoint it tested; editing the key,
	// model or URL makes it stale.
	// (Built in functions, not a $derived: a store's first read inside a
	// derived subscribes to it, which Svelte rejects as an unsafe mutation.)
	function endpointSignature(): string {
		return [
			$appSettings.llmProvider,
			keyFor($appSettings.llmProvider),
			$appSettings.llmModel,
			$appSettings.customBaseUrl,
			$appSettings.customModel
		].join('\u0000');
	}
	let testedSignature = '';
	$effect(() => {
		if (endpointSignature() !== testedSignature && !testing) {
			testOk = null;
			testMessage = '';
		}
	});

	async function runConnectionTest() {
		testing = true;
		testOk = null;
		testMessage = '';
		testedSignature = endpointSignature();
		try {
			const endpoint = currentLlmEndpoint();
			if (!endpoint.baseUrl) throw new Error('Add a base URL first.');
			if (!endpoint.apiKey) throw new Error('Add an API key first.');
			if (!endpoint.model) throw new Error('Choose a model first.');

			const reply = await testConnection(endpoint);
			testOk = true;
			testMessage = reply
				? `Connected — the model replied "${reply}".`
				: 'Connected, but the model returned an empty reply.';
		} catch (error) {
			testOk = false;
			testMessage = error instanceof Error ? error.message : String(error);
		} finally {
			testing = false;
		}
	}
</script>

<svelte:head><title>Settings · onspot</title></svelte:head>

<div class="h-full overflow-y-auto">
	<div class="mx-auto max-w-[760px] px-4 pt-10 pb-16 sm:px-8 sm:pt-14">
		<h1 class="page-title font-serif text-2xl font-medium">Settings</h1>
		<p class="mt-1.5 mb-8 max-w-xl text-sm leading-relaxed text-muted-foreground">
			Everything runs on this device unless you add a cloud key. Keys never leave your device and
			are never written to the synced database.
		</p>

		<div class="detail-tabs mb-10">
			<NeoTabs
				bind:active={() => (showAdvanced ? 'advanced' : 'general'),
				(next) => {
					if (next === 'advanced') showAdvancedSettings();
					else if (next === 'general') showAdvanced = false;
				}}
				rounded
				slide
				aria-label="Settings detail level"
			>
				<NeoTab tabId="general" value="general">General</NeoTab>
				<NeoTab tabId="advanced" value="advanced">Advanced</NeoTab>
			</NeoTabs>
		</div>

		<!-- LANGUAGE -->
		<SettingsSection id="language" title="Language">
			<SettingRow label="I am studying" for="targetLanguage">
				<SettingSelect id="targetLanguage" label="Language you are studying" options={OFFERED_LANGUAGES.map((entry) => ({
						value: entry.id,
						label: `${entry.name} (${entry.nativeName})${isCandidate(entry) ? ' · candidate, not yet approved' : ''}`
					}))} value={$appSettings.targetLanguage} onchange={(value) => void setTargetLanguage(value)} />
			</SettingRow>
			<SettingRow label="Your level" for="level">
				<SettingSelect id="level" label="Your level" options={LEVELS.map((level) => ({ value: level, label: level }))} value={$appSettings.level} onchange={(value) => setSetting('level', value)} />
			</SettingRow>
			<SettingRow label="Default mode" for="defaultMode">
				<SettingSelect id="defaultMode" label="Default mode" options={[{ value: 'exam', label: 'Exam' }, { value: 'casual', label: 'Casual' }]} value={$appSettings.mode} onchange={(value) => setSetting('mode', value as 'exam' | 'casual')} />
			</SettingRow>

			<NeoCard class="info-item my-4" rounded elevation={-1} spacing="var(--info-spacing)" width="100%">
				<div class="info-body">
				<div class="info-content">
					<p class="flex flex-wrap items-center gap-2 text-sm font-semibold">
						{language?.name ?? 'Language'} data
						{#if dataReady}
							<NeoPill size="small" rounded elevation={0} color="success" tinted>Installed</NeoPill>
						{:else if downloading}
							<NeoPill size="small" rounded elevation={0}>{Math.round($languageData.progress)}%</NeoPill>
						{:else if $languageData.status === 'checking'}
							<NeoPill size="small" rounded elevation={0}>Checking…</NeoPill>
						{:else}
							<NeoPill size="small" rounded elevation={0}>Not installed</NeoPill>
						{/if}
					</p>
					<p class="max-w-md text-xs leading-normal text-muted-foreground">
						The speech-recognition model and voice
						{#if language}({language.stt.modelRepoId} and {voices[0]?.label ?? language.defaultVoice}){/if}
						download from the internet onto this device. Nothing is bundled with the app.
					</p>
					{#if language}
						<!-- What installing costs on this device, from the last cache check. Languages share
						     assets (the same Whisper model), so this is only what is actually missing. -->
						<p class="storage-line max-w-md text-xs leading-normal">
							{#if $languageData.languageId === language.id && $languageData.pending}
								{@const pending = $languageData.pending}
								{#if pending.storage === 0}
									Everything is on this device; nothing more to download.
								{:else}
									<strong>Adds about {formatBytes(pending.storage)}</strong> to this device ·
									about {formatBytes(pending.transfer)} to download.
									{#if pending.stt === 0}
										The speech model is already here (shared with another language), so only the voice{language.voices.some((v) => v.engine === 'piper-plus') ? ' and its Japanese dictionary are' : ' is'} new.
									{/if}
								{/if}
							{:else}
								Up to about {formatBytes(languageDownloadBytes(language))} on this device; less if another language already installed the speech model.
							{/if}
						</p>
					{/if}
				</div>
				<div class="info-actions">
					{#if downloading}
						<NeoButton rounded onclick={cancelLanguageDownload}>
							{#snippet icon()}<X class="size-4" />{/snippet}
							Cancel
						</NeoButton>
					{:else if dataReady}
						<NeoButton rounded color="success" disabled>
							{#snippet icon()}<Check class="size-4" />{/snippet}
							Downloaded
						</NeoButton>
					{:else}
						<NeoButton
							rounded
							color="primary"
							disabled={!language}
							onclick={() => void downloadLanguageData(language?.id)}
						>
							{#snippet icon()}<Download class="size-4" />{/snippet}
							Download
						</NeoButton>
					{/if}
				</div>
				</div>
				{#if downloading || dataError}
					<div class="info-footer">
						{#if downloading}
							<NeoProgressBar
								value={$languageData.progress}
								rounded
								height="6px"
								color="var(--brand)"
								aria-label="Language data download progress"
							/>
							<p class="text-xs text-muted-foreground">{$languageData.statusText || 'Fetching model files…'}</p>
						{/if}
						{#if dataError}
							<p class="flex items-start gap-1.5 text-xs text-[var(--error)]">
								<AlertTriangle class="mt-0.5 size-3.5 shrink-0" />
								<span class="break-words">{dataError}</span>
							</p>
						{/if}
					</div>
				{/if}
			</NeoCard>
		</SettingsSection>

		<!-- AI PROVIDER -->
		<SettingsSection id="ai-provider" title="AI provider (BYOK)">
			<SettingRow label="Provider" for="provider">
				<SettingSelect id="provider" label="Provider" options={Object.values(LLM_PROVIDERS).map((provider) => ({ value: provider.id, label: provider.name }))} value={$appSettings.llmProvider} onchange={onProviderChange} />
			</SettingRow>

			{#if $appSettings.llmProvider === 'groq'}
				<SettingRow label="Groq API key" for="groqKey">
					<SecretInput id="groqKey" label="Groq API key" bind:value={$groqApiKey} />
				</SettingRow>
			{:else if $appSettings.llmProvider === 'deepseek'}
				<SettingRow label="DeepSeek API key" for="dsKey">
					<SecretInput id="dsKey" label="DeepSeek API key" bind:value={$deepseekApiKey} />
				</SettingRow>
			{:else}
				<SettingRow label="Base URL" for="baseUrl">
					<div class={INPUT_CLASS}>
						<NeoInput
							id="baseUrl"
							rounded
							pressed
							elevation={-2}
							width="100%"
							placeholder="https://…/v1"
							value={$appSettings.customBaseUrl}
							oninput={(event: Event) =>
								setSetting('customBaseUrl', (event.target as HTMLInputElement).value)}
						/>
					</div>
				</SettingRow>
				<SettingRow label="API key" for="customKey">
					<SecretInput id="customKey" label="API key" bind:value={$customApiKey} />
				</SettingRow>
			{/if}

			{#if $appSettings.llmProvider === 'custom'}
				<SettingRow label="Model name" for="customModel">
					<div class={INPUT_CLASS}>
						<NeoInput
							id="customModel"
							rounded
							pressed
							elevation={-2}
							width="100%"
							placeholder="e.g. my-model"
							value={$appSettings.customModel}
							oninput={(event: Event) =>
								setSetting('customModel', (event.target as HTMLInputElement).value)}
						/>
					</div>
				</SettingRow>
			{:else}
				<SettingRow label="Model" for="model">
					<SettingSelect id="model" label="Model" options={modelOptions.map((option) => ({ value: option.id, label: option.label, description: option.note }))} value={$appSettings.llmModel} onchange={(value) => setSetting('llmModel', value)} class="@md/field-group:w-80" />
					{#snippet below()}
						<div class="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 @md/field-group:justify-end">
							{#if refreshMessage}
								<span class="min-w-0 text-xs break-words text-muted-foreground">{refreshMessage}</span>
							{/if}
							<NeoButton rounded class="small-button" onclick={refreshModels} disabled={refreshing}>
								{#snippet icon()}<RefreshCw class="size-3.5 {refreshing ? 'animate-spin' : ''}" />{/snippet}
								{refreshing ? 'Refreshing…' : 'Refresh model list'}
							</NeoButton>
						</div>
					{/snippet}
				</SettingRow>
			{/if}

			<NeoCard class="info-item my-4" rounded elevation={-1} spacing="var(--info-spacing)" width="100%">
				<div class="info-body items-start">
				<div class="info-content">
					<p class="max-w-md text-xs leading-normal text-muted-foreground">
						{providerConfig.note ??
							'Sends one tiny request with your key and model, exactly as evaluation does.'}
					</p>
					{#if providerConfig.keyUrl || providerConfig.modelsUrl}
						<div class="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-xs">
							{#if providerConfig.keyUrl}
								<a href={providerConfig.keyUrl} target="_blank" rel="noreferrer" class="settings-link">
									{providerConfig.name} API keys <ExternalLink class="size-3" />
								</a>
							{/if}
							{#if providerConfig.modelsUrl}
								<a href={providerConfig.modelsUrl} target="_blank" rel="noreferrer" class="settings-link">
									Model list & permissions <ExternalLink class="size-3" />
								</a>
							{/if}
						</div>
					{/if}
				</div>
				<div class="info-actions">
					<NeoButton rounded onclick={runConnectionTest} loading={testing}>
						{testing ? 'Testing…' : 'Test connection'}
					</NeoButton>
				</div>
				</div>
				{#if testOk !== null}
					<div class="info-footer">
						<p
							class="flex min-w-0 items-start gap-1.5 text-xs {testOk
								? 'text-[var(--good)]'
								: 'text-[var(--error)]'}"
						>
							{#if testOk}<Check class="mt-0.5 size-3.5 shrink-0" />{:else}<AlertTriangle
									class="mt-0.5 size-3.5 shrink-0"
								/>{/if}
							<span class="max-h-32 overflow-y-auto break-words whitespace-pre-wrap">{testMessage}</span>
						</p>
					</div>
				{/if}
			</NeoCard>
		</SettingsSection>

		<!-- TRANSCRIPTION -->
		<SettingsSection id="transcription" title="Transcription">
			<SettingRow
				label="Speech recognition"
				for="sttMode"
				hint={$appSettings.sttMode === 'local'
					? 'Runs on this device. Your recordings never leave it.'
					: 'Recordings are sent to Groq with your key.'}
			>
				<SettingSelect id="sttMode" label="Speech recognition" options={[{ value: 'local', label: 'Local (Whisper Small)' }, { value: 'cloud', label: 'Cloud (Groq)' }]} value={$appSettings.sttMode} onchange={(value) => setSetting('sttMode', value as 'local' | 'cloud')} />
			</SettingRow>
			{#if $appSettings.sttMode === 'cloud'}
				{#if $appSettings.llmProvider === 'groq'}
					<p class="py-3.5 text-xs text-muted-foreground">
						Uses the Groq API key from AI provider.
					</p>
				{:else}
					<SettingRow label="Groq API key" for="sttGroqKey">
						<SecretInput id="sttGroqKey" label="Groq API key" bind:value={$groqApiKey} />
					</SettingRow>
				{/if}
			{/if}
		</SettingsSection>

		<!-- VOICE & AUDIO -->
		<SettingsSection id="voice" title="Voice & audio">
			<SettingRow
				label="Speech engine"
				for="ttsMode"
				hint={$appSettings.ttsMode === 'local'
					? 'Piper runs on this device.'
					: 'Text is sent to OpenAI with your key.'}
			>
				<SettingSelect id="ttsMode" label="Speech engine" options={[{ value: 'local', label: 'Local (Piper)' }, { value: 'cloud', label: 'Cloud (OpenAI)' }]} value={$appSettings.ttsMode} onchange={(value) => setSetting('ttsMode', value as 'local' | 'cloud')} />
			</SettingRow>

			{#if $appSettings.ttsMode === 'local'}
				<SettingRow label="Voice" for="ttsVoice">
					<SettingSelect id="ttsVoice" label="Voice" options={voices.map((voice) => ({ value: voice.id, label: voice.label }))} value={$appSettings.ttsVoice} onchange={(value) => setSetting('ttsVoice', value)} />
					{#snippet below()}
						{#if !showAdvanced && tuningActive}
							<p class="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground @md/field-group:justify-end">
								Custom equalizer settings are applied to this voice.
								<button type="button" class="settings-link" onclick={showAdvancedSettings}>Adjust</button>
							</p>
						{/if}
					{/snippet}
				</SettingRow>
			{:else}
				<SettingRow label="OpenAI API key" for="openaiKey">
					<SecretInput id="openaiKey" label="OpenAI API key" bind:value={$openaiApiKey} />
				</SettingRow>
			{/if}

			<NeoCollapse transition={quickCollapse} bind:open={showAdvanced} standalone class="advanced-settings">
					<div bind:this={advancedSection} class="border-b pt-4 pb-5">
						<div class="mb-3.5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
							<div class="min-w-0">
								<p class="text-sm font-medium">Equalizer</p>
								<p class="mt-0.5 max-w-sm text-xs leading-relaxed text-muted-foreground">
									Tunes {voiceLabel} relative to its approved sound, for every read-back, word
									and preview.
								</p>
							</div>
							<NeoButton
								rounded
								class="small-button self-start sm:self-auto"
								disabled={!tuningActive || $appSettings.ttsMode !== 'local'}
								onclick={() => resetVoiceTuning($appSettings.ttsVoice)}
							>
								{#snippet icon()}<RotateCcw class="size-3.5" />{/snippet}
								Reset to approved sound
							</NeoButton>
						</div>

						{#if $appSettings.ttsMode === 'local'}
							<VoiceEqualizer {tuning} {bands} playing={previewPlaying} onchange={updateTuning} />
							<p class="mt-2.5 text-xs text-muted-foreground">
								Play the preview below with Loop on to hear changes live. Double-click a fader to
								zero it.
							</p>
						{:else}
							<NeoCard class="info-item" rounded elevation={-1} spacing="var(--info-spacing)" width="100%">
								<p class="text-xs text-[var(--warn)]">
									The equalizer tunes local Piper voices. Switch the speech engine to Local to use
									it.
								</p>
							</NeoCard>
						{/if}
					</div>
			</NeoCollapse>

			<div class="my-4">
				<VoicePreview />
			</div>
		</SettingsSection>

		<!-- STORAGE -->
		<SettingsSection id="storage" title="Storage">
			<SettingRow
				label="Database"
				hint="Sessions, attempts, corrections, recordings and cached voice audio are stored locally."
			>
				<NeoPill rounded elevation={-1} class="text-muted-foreground">
					{#snippet icon()}<HardDrive class="size-3.5" />{/snippet}
					On this device (SQLite)
				</NeoPill>
			</SettingRow>
			<SettingRow
				label="Export database"
				hint="One .sqlite file with everything: sessions, attempts, corrections, translations, prompts, settings, your recordings and every cached voice clip. API keys and downloaded models are not included."
			>
				<NeoButton rounded onclick={exportData} loading={exporting}>
					{#snippet icon()}<Download class="size-4" />{/snippet}
					{exporting ? 'Exporting…' : 'Export .sqlite'}
				</NeoButton>
			</SettingRow>
			<SettingRow
				label="Restore database"
				hint="Put an onspot .sqlite backup back on this device, for example after moving browsers or computers. It replaces everything local, so you will be asked to confirm."
			>
				<RestoreDatabaseButton onrestored={() => goto('/history/')} />
			</SettingRow>
			<SettingRow
				label="Restore legacy backup"
				hint="Merge an older onspot .json export into this device. Existing unrelated sessions stay in place; you will then open History."
			>
				<input bind:this={restoreInput} class="sr-only" type="file" accept="application/json,.json" onchange={restoreLegacyBackup} />
				<NeoButton rounded onclick={() => restoreInput?.click()} loading={restoring}>
					{#snippet icon()}<Upload class="size-4" />{/snippet}
					{restoring ? 'Restoring…' : 'Restore .json'}
				</NeoButton>
			</SettingRow>
			<SettingRow
				label="Interface lab"
				hint="A separate interactive copy of the UI with dummy data. Changes and experiments there never touch your sessions or settings."
			>
				<NeoButton href="/ui-sandbox/" rounded>
					{#snippet icon()}<ExternalLink class="size-4" />{/snippet}
					Open UI sandbox
				</NeoButton>
			</SettingRow>
		</SettingsSection>
	</div>
</div>

<style>
	/* neo's theme styles bare headings (size, weight, margin) outside any layer; restore ours. */
	h1.page-title {
		margin-bottom: 0;
		font-size: 1.5rem;
		line-height: 2rem;
		font-weight: 500;
	}

	/* General / Advanced: neo tabs spanning the column, one sliding selection. */
	.detail-tabs :global(.neo-tabs),
	.detail-tabs :global(.neo-tabs .neo-tabs-group) {
		display: flex;
		width: 100%;
	}
	.detail-tabs :global(.neo-tabs .neo-tab) {
		flex: 1 1 0;
	}
	.detail-tabs :global(.neo-tabs .neo-tab .neo-tab-button) {
		width: 100%;
		justify-content: center;
		font-weight: 600;
	}
	.detail-tabs :global(.neo-tabs .neo-tab.neo-active .neo-tab-button) {
		color: var(--primary);
	}

	:global(.neo-card.info-item) {
		--neo-card-margin: 1rem 0;
		--info-spacing: 16px 18px;
		border-radius: 14px;
	}
	@media (min-width: 640px) {
		:global(.neo-card.info-item) {
			--info-spacing: 18px 22px;
		}
	}
	.info-body {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 12px 16px;
	}
	.info-content {
		display: flex;
		flex: 1 1 14rem;
		min-width: 14rem;
		flex-direction: column;
		gap: 4px;
	}
	.info-actions {
		display: flex;
		gap: 8px;
	}
	.info-footer {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin-top: 12px;
	}

	:global(.neo-button.small-button) {
		font-size: 0.8125rem;
		padding-block: 0.3rem;
	}

	:global(.settings-link) {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		color: var(--brand);
		font-weight: 600;
		text-underline-offset: 3px;
		transition: color 100ms ease;
	}
	:global(.settings-link:hover) {
		color: var(--brand-hover);
		text-decoration: underline;
	}
	.storage-line { color: var(--foreground); margin-top: 4px; }
	.storage-line strong { font-weight: 600; }
</style>
