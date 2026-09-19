<script lang="ts">
	import { onMount, tick } from 'svelte';
	import {
		appSettings,
		resetVoiceTuning,
		setSetting,
		setVoiceTuning,
		voiceTuning
	} from '$lib/stores/settings';
	import { setTargetLanguage } from '$lib/stores/practice';
	import {
		cancelLanguageDownload,
		downloadLanguageData,
		languageData
	} from '$lib/stores/languageData';
	import {
		APPROVED_LANGUAGES,
		getLanguage,
		getVoice,
		isNeutralTuning,
		languageDownloadBytes,
		type VoiceTuning
	} from '$lib/languages';
	import { customApiKey, deepseekApiKey, groqApiKey, openaiApiKey } from '$lib/stores/secrets';
	import {
		LLM_PROVIDERS,
		getModelOptions,
		getProvider,
		listModels,
		testConnection,
		type LlmProviderId
	} from '$lib/adapters/llm';
	import { currentLlmEndpoint } from '$lib/stores/llm';
	import { ttsPreview } from '$lib/stores/ttsPreview';
	import { listLocalVoices } from '$lib/adapters/tts/service';
	import { tuningBands } from '$lib/utils/audioEffects';
	import { exportDatabaseFile } from '$lib/utils/export';
	import { toast } from '$lib/stores/toast';
	import VoicePreview from '$lib/components/VoicePreview.svelte';
	import SettingsSection from '$lib/components/settings/SettingsSection.svelte';
	import SettingRow from '$lib/components/settings/SettingRow.svelte';
	import SecretInput from '$lib/components/settings/SecretInput.svelte';
	import VoiceEqualizer from '$lib/components/settings/VoiceEqualizer.svelte';
	import { Input } from '$lib/components/ui/input';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Progress } from '$lib/components/ui/progress';
	import * as Collapsible from '$lib/components/ui/collapsible';
	import * as Item from '$lib/components/ui/item';
	import * as Select from '$lib/components/ui/select';
	import * as ToggleGroup from '$lib/components/ui/toggle-group';
	import {
		AlertTriangle,
		Check,
		Download,
		ExternalLink,
		HardDrive,
		Loader2,
		RefreshCw,
		RotateCcw,
		X
	} from '@lucide/svelte';

	const levels = ['A2', 'B1', 'B2', 'C1'];
	const SELECT_CLASS = 'w-full bg-background data-[size=default]:h-9 @md/field-group:w-72';
	const INPUT_CLASS = 'h-9 w-full @md/field-group:w-72';

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
		refreshMessage = '';
		testOk = null;
		testMessage = '';
		if (provider !== 'custom') {
			setSetting('llmModel', getProvider(provider).defaultModel);
		}
	}

	async function refreshModels() {
		refreshing = true;
		refreshMessage = '';
		try {
			const baseUrl =
				$appSettings.llmProvider === 'custom'
					? $appSettings.customBaseUrl
					: providerConfig.baseUrl;
			remoteModels = await listModels({
				baseUrl,
				apiKey: keyFor($appSettings.llmProvider),
				model: ''
			});
			refreshMessage = `Found ${remoteModels.length} model${remoteModels.length === 1 ? '' : 's'}.`;
		} catch (error) {
			refreshMessage = error instanceof Error ? error.message : String(error);
		} finally {
			refreshing = false;
		}
	}

	async function runConnectionTest() {
		testing = true;
		testOk = null;
		testMessage = '';
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
		<h1 class="font-serif text-2xl font-medium">Settings</h1>
		<p class="mt-1.5 mb-8 max-w-xl text-sm leading-relaxed text-muted-foreground">
			Everything runs on this device unless you add a cloud key. Keys never leave your device and
			are never written to the synced database.
		</p>

		<ToggleGroup.Root
			type="single"
			bind:value={() => (showAdvanced ? 'advanced' : 'general'),
			(next) => {
				if (next === 'advanced') showAdvancedSettings();
				else if (next === 'general') showAdvanced = false;
			}}
			class="segmented paper-grain relative mb-10 grid w-full grid-cols-2 rounded-xl bg-control p-1"
			aria-label="Settings detail level"
		>
			<span class="segmented-pill paper-grain" class:right={showAdvanced} aria-hidden="true"></span>
			<ToggleGroup.Item value="general" class="segment">General</ToggleGroup.Item>
			<ToggleGroup.Item value="advanced" class="segment">Advanced</ToggleGroup.Item>
		</ToggleGroup.Root>

		<!-- LANGUAGE -->
		<SettingsSection id="language" title="Language">
			<SettingRow label="I am studying" for="targetLanguage">
				<Select.Root
					type="single"
					items={APPROVED_LANGUAGES.map((entry) => ({
						value: entry.id,
						label: `${entry.name} (${entry.nativeName})`
					}))}
					value={$appSettings.targetLanguage}
					onValueChange={(value) => void setTargetLanguage(value)}
				>
					<Select.Trigger id="targetLanguage" aria-label="Language you are studying" class={SELECT_CLASS}><Select.Value /></Select.Trigger>
					<Select.Content>
						{#each APPROVED_LANGUAGES as entry (entry.id)}
							<Select.Item value={entry.id} label={`${entry.name} (${entry.nativeName})`} />
						{/each}
					</Select.Content>
				</Select.Root>
			</SettingRow>
			<SettingRow label="Your level" for="level">
				<Select.Root type="single" items={levels.map((level) => ({ value: level, label: level }))} value={$appSettings.level} onValueChange={(value) => setSetting('level', value)}>
					<Select.Trigger id="level" aria-label="Your level" class={SELECT_CLASS}><Select.Value /></Select.Trigger>
					<Select.Content>
						{#each levels as level (level)}<Select.Item value={level} label={level} />{/each}
					</Select.Content>
				</Select.Root>
			</SettingRow>
			<SettingRow label="Default mode" for="defaultMode">
				<Select.Root type="single" items={[{ value: 'exam', label: 'Exam' }, { value: 'casual', label: 'Casual' }]} value={$appSettings.mode} onValueChange={(value) => setSetting('mode', value as 'exam' | 'casual')}>
					<Select.Trigger id="defaultMode" aria-label="Default mode" class={SELECT_CLASS}><Select.Value /></Select.Trigger>
					<Select.Content>
						<Select.Item value="exam" label="Exam" />
						<Select.Item value="casual" label="Casual" />
					</Select.Content>
				</Select.Root>
			</SettingRow>

			<Item.Root variant="muted" class="info-item my-4">
				<Item.Content class="min-w-56">
					<Item.Title class="font-semibold">
						{language?.name ?? 'Language'} data
						{#if dataReady}
							<Badge class="bg-[var(--good-soft)] text-[var(--good)]">Installed</Badge>
						{:else if downloading}
							<Badge variant="secondary">{Math.round($languageData.progress)}%</Badge>
						{:else if $languageData.status === 'checking'}
							<Badge variant="secondary">Checking…</Badge>
						{:else}
							<Badge variant="outline">Not installed</Badge>
						{/if}
					</Item.Title>
					<Item.Description class="line-clamp-none max-w-md text-xs">
						The approved speech-recognition model and voice
						{#if language}
							({language.stt.modelRepoId} and {voices[0]?.label ?? language.defaultVoice},
							about {formatBytes(languageDownloadBytes(language))})
						{/if}
						download from the internet onto this device. Nothing is bundled with the app.
					</Item.Description>
				</Item.Content>
				<Item.Actions>
					{#if downloading}
						<Button variant="outline" size="lg" class="px-3.5" onclick={cancelLanguageDownload}>
							<X class="size-4" /> Cancel
						</Button>
					{:else if dataReady}
						<Button variant="outline" size="lg" class="px-3.5 text-[var(--good)]" disabled>
							<Check class="size-4" /> Downloaded
						</Button>
					{:else}
						<Button
							size="lg"
							class="px-3.5"
							disabled={!language}
							onclick={() => void downloadLanguageData(language?.id)}
						>
							<Download class="size-4" /> Download
						</Button>
					{/if}
				</Item.Actions>
				{#if downloading || dataError}
					<Item.Footer class="flex-col items-stretch">
						{#if downloading}
							<Progress
								value={$languageData.progress}
								class="h-1.5 bg-[var(--surface-2)] [&>div]:bg-[linear-gradient(90deg,var(--brand),var(--brand-2))] [&>div]:duration-300"
							/>
							<p class="text-xs text-muted-foreground">{$languageData.statusText || 'Fetching model files…'}</p>
						{/if}
						{#if dataError}
							<p class="flex items-start gap-1.5 text-xs text-[var(--error)]">
								<AlertTriangle class="mt-0.5 size-3.5 shrink-0" />
								<span class="break-words">{dataError}</span>
							</p>
						{/if}
					</Item.Footer>
				{/if}
			</Item.Root>
		</SettingsSection>

		<!-- AI PROVIDER -->
		<SettingsSection id="ai-provider" title="AI provider (BYOK)">
			<SettingRow label="Provider" for="provider">
				<Select.Root type="single" items={Object.values(LLM_PROVIDERS).map((provider) => ({ value: provider.id, label: provider.name }))} value={$appSettings.llmProvider} onValueChange={onProviderChange}>
					<Select.Trigger id="provider" aria-label="Provider" class={SELECT_CLASS}><Select.Value /></Select.Trigger>
					<Select.Content>
						{#each Object.values(LLM_PROVIDERS) as provider (provider.id)}
							<Select.Item value={provider.id} label={provider.name} />
						{/each}
					</Select.Content>
				</Select.Root>
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
					<Input
						id="baseUrl"
						class={INPUT_CLASS}
						placeholder="https://…/v1"
						value={$appSettings.customBaseUrl}
						oninput={(event: Event) =>
							setSetting('customBaseUrl', (event.target as HTMLInputElement).value)}
					/>
				</SettingRow>
				<SettingRow label="API key" for="customKey">
					<SecretInput id="customKey" label="API key" bind:value={$customApiKey} />
				</SettingRow>
			{/if}

			{#if $appSettings.llmProvider === 'custom'}
				<SettingRow label="Model name" for="customModel">
					<Input
						id="customModel"
						class={INPUT_CLASS}
						placeholder="e.g. my-model"
						value={$appSettings.customModel}
						oninput={(event: Event) =>
							setSetting('customModel', (event.target as HTMLInputElement).value)}
					/>
				</SettingRow>
			{:else}
				<SettingRow label="Model" for="model">
					<Select.Root type="single" items={modelOptions.map((option) => ({ value: option.id, label: `${option.label}${option.note ? ` — ${option.note}` : ''}` }))} value={$appSettings.llmModel} onValueChange={(value) => setSetting('llmModel', value)}>
						<Select.Trigger id="model" aria-label="Model" class={`${SELECT_CLASS} @md/field-group:w-80`}><Select.Value /></Select.Trigger>
						<Select.Content class="max-w-[min(24rem,calc(100vw-2rem))]">
							{#each modelOptions as option (option.id)}
								<Select.Item value={option.id} label={`${option.label}${option.note ? ` — ${option.note}` : ''}`} />
							{/each}
						</Select.Content>
					</Select.Root>
					{#snippet below()}
						<div class="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 @md/field-group:justify-end">
							{#if refreshMessage}
								<span class="min-w-0 text-xs break-words text-muted-foreground">{refreshMessage}</span>
							{/if}
							<Button variant="outline" size="sm" onclick={refreshModels} disabled={refreshing}>
								<RefreshCw class="size-3.5 {refreshing ? 'animate-spin' : ''}" />
								{refreshing ? 'Refreshing…' : 'Refresh model list'}
							</Button>
						</div>
					{/snippet}
				</SettingRow>
			{/if}

			<Item.Root variant="muted" class="info-item my-4 items-start">
				<Item.Content class="min-w-56">
					<Item.Description class="line-clamp-none max-w-md text-xs">
						{providerConfig.note ??
							'Sends one tiny request with your key and model, exactly as evaluation does.'}
					</Item.Description>
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
				</Item.Content>
				<Item.Actions>
					<Button variant="outline" size="lg" class="px-3.5" onclick={runConnectionTest} disabled={testing}>
						{#if testing}<Loader2 class="size-4 animate-spin" />{/if}
						{testing ? 'Testing…' : 'Test connection'}
					</Button>
				</Item.Actions>
				{#if testOk !== null}
					<Item.Footer>
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
					</Item.Footer>
				{/if}
			</Item.Root>
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
				<Select.Root type="single" items={[{ value: 'local', label: 'Local (Whisper Small)' }, { value: 'cloud', label: 'Cloud (Groq)' }]} value={$appSettings.sttMode} onValueChange={(value) => setSetting('sttMode', value as 'local' | 'cloud')}>
					<Select.Trigger id="sttMode" aria-label="Speech recognition" class={SELECT_CLASS}><Select.Value /></Select.Trigger>
					<Select.Content>
						<Select.Item value="local" label="Local (Whisper Small)" />
						<Select.Item value="cloud" label="Cloud (Groq)" />
					</Select.Content>
				</Select.Root>
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
				<Select.Root type="single" items={[{ value: 'local', label: 'Local (Piper)' }, { value: 'cloud', label: 'Cloud (OpenAI)' }]} value={$appSettings.ttsMode} onValueChange={(value) => setSetting('ttsMode', value as 'local' | 'cloud')}>
					<Select.Trigger id="ttsMode" aria-label="Speech engine" class={SELECT_CLASS}><Select.Value /></Select.Trigger>
					<Select.Content>
						<Select.Item value="local" label="Local (Piper)" />
						<Select.Item value="cloud" label="Cloud (OpenAI)" />
					</Select.Content>
				</Select.Root>
			</SettingRow>

			{#if $appSettings.ttsMode === 'local'}
				<SettingRow label="Voice" for="ttsVoice">
					<Select.Root type="single" items={voices.map((voice) => ({ value: voice.id, label: voice.label }))} value={$appSettings.ttsVoice} onValueChange={(value) => setSetting('ttsVoice', value)}>
						<Select.Trigger id="ttsVoice" aria-label="Voice" class={SELECT_CLASS}><Select.Value /></Select.Trigger>
						<Select.Content>
							{#each voices as voice (voice.id)}<Select.Item value={voice.id} label={voice.label} />{/each}
						</Select.Content>
					</Select.Root>
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

			<Collapsible.Root bind:open={showAdvanced}>
				<Collapsible.Content class="advanced-settings overflow-hidden">
					<div bind:this={advancedSection} class="border-b pt-4 pb-5">
						<div class="mb-3.5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
							<div class="min-w-0">
								<p class="text-sm font-medium">Equalizer</p>
								<p class="mt-0.5 max-w-sm text-xs leading-relaxed text-muted-foreground">
									Tunes {voiceLabel} relative to its approved sound, for every read-back, word
									and preview.
								</p>
							</div>
							<Button
								variant="outline"
								size="sm"
								class="self-start sm:self-auto"
								disabled={!tuningActive || $appSettings.ttsMode !== 'local'}
								onclick={() => resetVoiceTuning($appSettings.ttsVoice)}
							>
								<RotateCcw class="size-3.5" /> Reset to approved sound
							</Button>
						</div>

						{#if $appSettings.ttsMode === 'local'}
							<VoiceEqualizer {tuning} {bands} playing={previewPlaying} onchange={updateTuning} />
							<p class="mt-2.5 text-xs text-muted-foreground">
								Play the preview below with Loop on to hear changes live. Double-click a fader to
								zero it.
							</p>
						{:else}
							<Item.Root variant="muted" class="info-item">
								<Item.Content class="min-w-56">
									<Item.Description class="line-clamp-none text-xs text-[var(--warn)]">
										The equalizer tunes local Piper voices. Switch the speech engine to Local to
										use it.
									</Item.Description>
								</Item.Content>
							</Item.Root>
						{/if}
					</div>
				</Collapsible.Content>
			</Collapsible.Root>

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
				<Badge variant="outline" class="h-8 gap-1.5 rounded-lg px-3 text-muted-foreground">
					<HardDrive class="size-3.5!" /> On this device (SQLite)
				</Badge>
			</SettingRow>
			<SettingRow
				label="Export database"
				hint="One .sqlite file with everything: sessions, attempts, corrections, translations, prompts, settings, your recordings and every cached voice clip. API keys and downloaded models are not included."
			>
				<Button variant="outline" size="lg" class="px-3.5" onclick={exportData} disabled={exporting}>
					{#if exporting}<Loader2 class="size-4 animate-spin" />{:else}<Download class="size-4" />{/if}
					{exporting ? 'Exporting…' : 'Export .sqlite'}
				</Button>
			</SettingRow>
		</SettingsSection>
	</div>
</div>

<style>
	/* shadcn ToggleGroup styled as a segmented control; one pill slides between the options. */
	:global(.segmented .segment) {
		position: relative;
		z-index: 1;
		height: 2.25rem;
		border-radius: 9px;
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--on-control);
		background: transparent;
		transition: color 200ms ease;
	}
	:global(.segmented .segment:hover),
	:global(.segmented .segment[data-state='on']) {
		color: var(--foreground);
		background: transparent;
	}
	.segmented-pill {
		position: absolute;
		top: 4px;
		bottom: 4px;
		left: 4px;
		width: calc(50% - 4px);
		border-radius: 9px;
		background-color: var(--card);
		box-shadow: var(--paper-emboss-hover);
		transition: translate 320ms cubic-bezier(0.22, 1, 0.36, 1);
	}
	.segmented-pill.right {
		translate: 100% 0;
	}

	:global(.info-item) {
		border-radius: 14px;
		border-color: var(--border);
		background: color-mix(in srgb, var(--surface-2) 40%, var(--card));
		padding: 16px 18px;
	}
	@media (min-width: 640px) {
		:global(.info-item) {
			padding: 18px 22px;
		}
	}

	:global(.settings-link) {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		color: var(--brand);
		font-weight: 600;
		text-underline-offset: 3px;
		transition: color 160ms ease;
	}
	:global(.settings-link:hover) {
		color: var(--brand-hover);
		text-decoration: underline;
	}

	:global(.advanced-settings[data-state='open']) {
		animation: expand-advanced 340ms cubic-bezier(0.22, 1, 0.36, 1);
	}
	:global(.advanced-settings[data-state='closed']) {
		animation: collapse-advanced 200ms cubic-bezier(0.4, 0, 1, 1);
	}
	@keyframes expand-advanced {
		from { height: 0; opacity: 0; transform: translateY(-4px); }
		to { height: var(--bits-collapsible-content-height); opacity: 1; transform: translateY(0); }
	}
	@keyframes collapse-advanced {
		from { height: var(--bits-collapsible-content-height); opacity: 1; }
		to { height: 0; opacity: 0; }
	}

	@media (prefers-reduced-motion: reduce) {
		.segmented-pill { transition-duration: 1ms; }
		:global(.advanced-settings) { animation-duration: 1ms !important; }
	}
</style>
