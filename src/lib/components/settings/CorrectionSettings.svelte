<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

<script lang="ts">
	import { onMount } from 'svelte';
	import { appSettings, setSetting } from '#lib/stores/settings.js';
	import {
		customApiKey,
		deepseekApiKey,
		groqApiKey,
		localLlmApiKey
	} from '#lib/stores/secrets.js';
	import { currentLlmEndpoint } from '#lib/stores/llm.js';
	import {
		LLM_PROVIDERS,
		getModelOptions,
		getProvider,
		listModels,
		testConnection,
		type LlmProviderId
	} from '#lib/adapters/llm/index.js';
	import SettingRow from '#lib/components/settings/SettingRow.svelte';
	import SettingSelect from '#lib/components/settings/SettingSelect.svelte';
	import SecretInput from '#lib/components/settings/SecretInput.svelte';
	import { NeoButton } from '@dvcol/neo-svelte/buttons';
	import { NeoCard } from '@dvcol/neo-svelte/cards';
	import { NeoInput } from '@dvcol/neo-svelte/inputs';
	import { AlertTriangle, Check, ExternalLink, RefreshCw } from '@lucide/svelte';

	const INPUT_CLASS = 'w-full @md/field-group:w-72';

	const LOCAL_PRESETS = [
		{ value: 'lmstudio', label: 'LM Studio', url: 'http://localhost:1234/v1' },
		{ value: 'llamacpp', label: 'llama.cpp', url: 'http://localhost:8080/v1' },
		{ value: 'ollama', label: 'Ollama', url: 'http://localhost:11434/v1' },
		{ value: 'custom', label: 'Custom', url: '' }
	];

	let localModels = $state<string[]>([]);
	let remoteModels = $state<string[]>([]);
	let refreshing = $state(false);
	let localRefreshMessage = $state('');
	let cloudRefreshMessage = $state('');
	let refreshToken = 0;
	let testing = $state(false);
	let testOk = $state<boolean | null>(null);
	let testMessage = $state('');
	let testedSignature = '';

	const local = $derived($appSettings.correctionMode === 'local');
	const providerConfig = $derived(getProvider($appSettings.llmProvider));

	const localPreset = $derived.by(() => {
		const url = $appSettings.localLlmUrl.trim().replace(/\/+$/, '');
		return (
			LOCAL_PRESETS.find((preset) => preset.url && preset.url.replace(/\/+$/, '') === url)
				?.value ?? 'custom'
		);
	});

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

	function onProviderChange(value: string): void {
		const provider = value as LlmProviderId;
		setSetting('llmProvider', provider);
		remoteModels = [];
		refreshToken++;
		refreshing = false;
		cloudRefreshMessage = '';
		testOk = null;
		testMessage = '';
		if (provider !== 'custom') {
			setSetting('llmModel', getProvider(provider).defaultModel);
		}
	}

	function chooseLocalPreset(value: string): void {
		const preset = LOCAL_PRESETS.find((entry) => entry.value === value);
		if (preset?.url) setSetting('localLlmUrl', preset.url);
		localRefreshMessage = '';
	}

	onMount(() => {
		// Keep the model list current without requiring the user to press
		// Refresh: a key is all the /models call needs.
		const provider = $appSettings.llmProvider;
		if (!local && provider !== 'custom' && keyFor(provider)) void refreshModels();
	});

	async function refreshModels(): Promise<void> {
		const token = ++refreshToken;
		refreshing = true;
		if (local) localRefreshMessage = '';
		else cloudRefreshMessage = '';

		try {
			if (local) {
				const baseUrl = $appSettings.localLlmUrl.trim();
				if (!baseUrl) {
					localRefreshMessage = 'Add the server URL first.';
					return;
				}
				const models = await listModels({ baseUrl, apiKey: $localLlmApiKey, model: '' });
				if (token !== refreshToken) return;
				localModels = models;
				localRefreshMessage = `Found ${models.length} model${models.length === 1 ? '' : 's'}.`;
				return;
			}

			const provider = $appSettings.llmProvider;
			const apiKey = keyFor(provider);
			if (!apiKey) {
				cloudRefreshMessage = `Add your ${providerConfig.name} API key first.`;
				return;
			}
			const baseUrl = provider === 'custom' ? $appSettings.customBaseUrl : providerConfig.baseUrl;
			const models = await listModels({ baseUrl, apiKey, model: '' });
			if (token !== refreshToken) return;
			remoteModels = models;
			cloudRefreshMessage = `Found ${models.length} model${models.length === 1 ? '' : 's'}.`;
		} catch (error) {
			if (token !== refreshToken) return;
			const message = error instanceof Error ? error.message : String(error);
			if (local) localRefreshMessage = message;
			else cloudRefreshMessage = message;
		} finally {
			if (token === refreshToken) refreshing = false;
		}
	}

	// A connection result describes the endpoint it tested; editing the key,
	// model or URL makes it stale. Built in a function because a store's first
	// read inside a derived subscribes to it.
	function endpointSignature(): string {
		return [
			$appSettings.correctionMode,
			$appSettings.llmProvider,
			keyFor($appSettings.llmProvider),
			$appSettings.llmModel,
			$appSettings.customBaseUrl,
			$appSettings.customModel,
			$appSettings.localLlmUrl,
			$appSettings.localLlmModel,
			$localLlmApiKey
		].join('\u0000');
	}

	$effect(() => {
		if (endpointSignature() !== testedSignature && !testing) {
			testOk = null;
			testMessage = '';
		}
	});

	async function runConnectionTest(): Promise<void> {
		testing = true;
		testOk = null;
		testMessage = '';
		testedSignature = endpointSignature();

		try {
			const endpoint = currentLlmEndpoint();
			if (!endpoint.baseUrl) throw new Error('Add a base URL first.');
			if (!endpoint.model) throw new Error('Choose a model first.');

			const needsKey =
				!local && ($appSettings.llmProvider === 'groq' || $appSettings.llmProvider === 'deepseek');
			if (needsKey && !endpoint.apiKey) throw new Error('Add an API key first.');

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

<div class:hidden={!local}>
		<SettingRow label="Server" for="localPreset">
			<SettingSelect
				id="localPreset"
				label="Local server type"
				options={LOCAL_PRESETS.map((preset) => ({ value: preset.value, label: preset.label }))}
				value={localPreset}
				onchange={chooseLocalPreset}
			/>
		</SettingRow>
		<SettingRow label="Server URL" for="localLlmUrl" hint="The OpenAI-compatible /v1 endpoint.">
			<div class={INPUT_CLASS}>
				<NeoInput
					id="localLlmUrl"
					rounded
					pressed
					elevation={-2}
					width="100%"
					placeholder="http://localhost:1234/v1"
					value={$appSettings.localLlmUrl}
					oninput={(event: Event) =>
						setSetting('localLlmUrl', (event.target as HTMLInputElement).value)}
				/>
			</div>
		</SettingRow>
		<SettingRow label="Model" for="localLlmModel">
			<div class={INPUT_CLASS}>
				<NeoInput
					id="localLlmModel"
					rounded
					pressed
					elevation={-2}
					width="100%"
					placeholder="e.g. qwen2.5-7b-instruct"
					value={$appSettings.localLlmModel}
					oninput={(event: Event) =>
						setSetting('localLlmModel', (event.target as HTMLInputElement).value)}
				/>
			</div>
			{#snippet below()}
				<div class="mt-2.5 flex flex-col gap-2 @md/field-group:items-end">
					{#if localModels.length > 0}
						<div class="flex flex-wrap gap-1.5 @md/field-group:justify-end">
							{#each localModels as model (model)}
								<NeoButton
									rounded
									class="small-button"
									color={$appSettings.localLlmModel === model ? 'primary' : undefined}
									onclick={() => setSetting('localLlmModel', model)}
								>
									{model}
								</NeoButton>
							{/each}
						</div>
					{/if}
					<div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 @md/field-group:justify-end">
						{#if localRefreshMessage}
							<span class="min-w-0 text-xs break-words text-muted-foreground">{localRefreshMessage}</span>
						{/if}
						<NeoButton rounded class="small-button" onclick={refreshModels} disabled={refreshing}>
							{#snippet icon()}<RefreshCw class="size-3.5 {refreshing ? 'animate-spin' : ''}" />{/snippet}
							{refreshing ? 'Refreshing…' : 'Refresh models'}
						</NeoButton>
					</div>
				</div>
			{/snippet}
		</SettingRow>
		<SettingRow label="API key (optional)" for="localKey" hint="Only if your server requires one.">
			<SecretInput id="localKey" label="Local server API key" bind:value={$localLlmApiKey} />
		</SettingRow>
	</div>
	<div class:hidden={local}>
		<SettingRow label="Provider" for="provider">
			<SettingSelect
				id="provider"
				label="Provider"
				options={Object.values(LLM_PROVIDERS).map((provider) => ({
					value: provider.id,
					label: provider.name
				}))}
				value={$appSettings.llmProvider}
				onchange={onProviderChange}
			/>
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
				<SettingSelect
					id="model"
					label="Model"
					options={modelOptions.map((option) => ({
						value: option.id,
						label: option.label,
						description: option.note
					}))}
					value={$appSettings.llmModel}
					onchange={(value) => setSetting('llmModel', value)}
					class="@md/field-group:w-80"
				/>
				{#snippet below()}
					<div class="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 @md/field-group:justify-end">
						{#if cloudRefreshMessage}
							<span class="min-w-0 text-xs break-words text-muted-foreground">{cloudRefreshMessage}</span>
						{/if}
						<NeoButton rounded class="small-button" onclick={refreshModels} disabled={refreshing}>
							{#snippet icon()}<RefreshCw class="size-3.5 {refreshing ? 'animate-spin' : ''}" />{/snippet}
							{refreshing ? 'Refreshing…' : 'Refresh model list'}
						</NeoButton>
					</div>
				{/snippet}
			</SettingRow>
		{/if}
	</div>

	<NeoCard class="info-item my-4" rounded elevation={-1} spacing="var(--info-spacing)" width="100%">
		<div class="info-body items-start">
			<div class="info-content">
				<p class="max-w-md text-xs leading-normal text-muted-foreground">
					{local
						? 'Start LM Studio, llama.cpp or Ollama and load a model. onspot only calls the OpenAI-compatible /v1 endpoint. In a browser, the server must allow this origin (CORS); the desktop and mobile apps do not.'
						: (providerConfig.note ??
							'Sends one tiny request with your key and model, exactly as evaluation does.')}
				</p>
				{#if !local && (providerConfig.keyUrl || providerConfig.modelsUrl)}
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
				<p class="flex min-w-0 items-start gap-1.5 text-xs {testOk ? 'text-[var(--good)]' : 'text-[var(--error)]'}">
					{#if testOk}<Check class="mt-0.5 size-3.5 shrink-0" />{:else}<AlertTriangle class="mt-0.5 size-3.5 shrink-0" />{/if}
					<span class="max-h-32 overflow-y-auto break-words whitespace-pre-wrap">{testMessage}</span>
				</p>
			</div>
		{/if}
	</NeoCard>
