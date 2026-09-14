<script lang="ts">
	import { appSettings, setSetting } from '$lib/stores/settings';
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
	import { listLocalVoices } from '$lib/adapters/tts/service';
	import { exportAllData } from '$lib/utils/export';
	import { toast } from '$lib/stores/toast';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { AlertTriangle, Check, Download, Loader2, RefreshCw } from '@lucide/svelte';

	const levels = ['A2', 'B1', 'B2', 'C1'];
	const voices = listLocalVoices();

	let remoteModels = $state<string[]>([]);
	let refreshing = $state(false);
	let refreshMessage = $state('');

	let testing = $state(false);
	let testOk = $state<boolean | null>(null);
	let testMessage = $state('');
	let exporting = $state(false);

	async function exportData() {
		exporting = true;
		try {
			await exportAllData();
			toast('Export downloaded');
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

	function onProviderChange(event: Event) {
		const provider = (event.target as HTMLSelectElement).value as LlmProviderId;
		setSetting('llmProvider', provider);
		remoteModels = [];
		refreshMessage = '';
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
	<div class="mx-auto max-w-2xl px-8 py-10">
		<h1 class="font-serif text-2xl font-medium">Settings</h1>
		<p class="mb-8 text-sm text-muted-foreground">
			Everything runs on this device unless you add a cloud key. Keys never leave your device and
			are never written to the synced database.
		</p>

		<section class="mb-8 border-b pb-6">
			<h2 class="mb-4 text-xs font-semibold tracking-widest text-faint uppercase">Language</h2>
			<div class="flex items-center justify-between gap-6 py-2">
				<Label for="level">Your level</Label>
				<select
					id="level"
					class="h-9 min-w-48 rounded-md border bg-background px-2 text-sm"
					value={$appSettings.level}
					onchange={(event) => setSetting('level', (event.target as HTMLSelectElement).value)}
				>
					{#each levels as level (level)}<option value={level}>{level}</option>{/each}
				</select>
			</div>
			<div class="flex items-center justify-between gap-6 py-2">
				<Label>Default mode</Label>
				<select
					class="h-9 min-w-48 rounded-md border bg-background px-2 text-sm"
					value={$appSettings.mode}
					onchange={(event) =>
						setSetting('mode', (event.target as HTMLSelectElement).value as 'exam' | 'casual')}
				>
					<option value="exam">Exam</option>
					<option value="casual">Casual</option>
				</select>
			</div>
		</section>

		<section class="mb-8 border-b pb-6">
			<h2 class="mb-4 text-xs font-semibold tracking-widest text-faint uppercase">
				AI provider (BYOK)
			</h2>
			<div class="flex items-center justify-between gap-6 py-2">
				<Label>Provider</Label>
				<select
					class="h-9 min-w-48 rounded-md border bg-background px-2 text-sm"
					value={$appSettings.llmProvider}
					onchange={onProviderChange}
				>
					{#each Object.values(LLM_PROVIDERS) as provider (provider.id)}
						<option value={provider.id}>{provider.name}</option>
					{/each}
				</select>
			</div>

			{#if $appSettings.llmProvider === 'custom'}
				<div class="flex items-center justify-between gap-6 py-2">
					<Label for="baseUrl">Base URL</Label>
					<Input
						id="baseUrl"
						class="max-w-64"
						placeholder="https://…/v1"
						value={$appSettings.customBaseUrl}
						oninput={(event: Event) =>
							setSetting('customBaseUrl', (event.target as HTMLInputElement).value)}
					/>
				</div>
				<div class="flex items-center justify-between gap-6 py-2">
					<Label for="customModel">Model name</Label>
					<Input
						id="customModel"
						class="max-w-64"
						placeholder="e.g. my-model"
						value={$appSettings.customModel}
						oninput={(event: Event) =>
							setSetting('customModel', (event.target as HTMLInputElement).value)}
					/>
				</div>
			{:else}
				<div class="flex items-center justify-between gap-6 py-2">
					<Label for="model">Model</Label>
					<select
						id="model"
						class="h-9 min-w-64 rounded-md border bg-background px-2 text-sm"
						value={$appSettings.llmModel}
						onchange={(event) => setSetting('llmModel', (event.target as HTMLSelectElement).value)}
					>
						{#each modelOptions as option (option.id)}
							<option value={option.id}
								>{option.label}{option.note ? ` — ${option.note}` : ''}</option
							>
						{/each}
					</select>
				</div>
				<div class="flex items-center gap-3 pt-1">
					<Button variant="outline" size="sm" onclick={refreshModels} disabled={refreshing}>
						<RefreshCw class="size-3.5 {refreshing ? 'animate-spin' : ''}" />
						{refreshing ? 'Refreshing…' : 'Refresh model list'}
					</Button>
					{#if refreshMessage}
						<span class="break-words text-xs text-muted-foreground">{refreshMessage}</span>
					{/if}
				</div>
			{/if}

			<div class="flex flex-wrap items-center gap-3 pt-3">
				<Button variant="secondary" size="sm" onclick={runConnectionTest} disabled={testing}>
					{#if testing}<Loader2 class="size-3.5 animate-spin" />{/if}
					{testing ? 'Testing…' : 'Test connection'}
				</Button>
				{#if testOk === true}
					<span class="flex min-w-0 items-start gap-1 text-xs text-[var(--good)]">
						<Check class="mt-0.5 size-3.5 shrink-0" />
						<span class="max-h-32 overflow-y-auto break-words whitespace-pre-wrap">{testMessage}</span>
					</span>
				{:else if testOk === false}
					<span class="flex min-w-0 items-start gap-1 text-xs text-[var(--error)]">
						<AlertTriangle class="mt-0.5 size-3.5 shrink-0" />
						<span class="max-h-32 overflow-y-auto break-words whitespace-pre-wrap">{testMessage}</span>
					</span>
				{/if}
			</div>

			{#if providerConfig.note}
				<p class="mt-2 text-xs leading-relaxed text-muted-foreground">{providerConfig.note}</p>
			{/if}
			{#if providerConfig.keyUrl || providerConfig.modelsUrl}
				<div class="mt-1 flex gap-4 text-xs">
					{#if providerConfig.keyUrl}
						<a
							href={providerConfig.keyUrl}
							target="_blank"
							rel="noreferrer"
							class="text-[var(--brand)] underline">{providerConfig.name} API keys</a
						>
					{/if}
					{#if providerConfig.modelsUrl}
						<a
							href={providerConfig.modelsUrl}
							target="_blank"
							rel="noreferrer"
							class="text-[var(--brand)] underline">Model list & permissions</a
						>
					{/if}
				</div>
			{/if}

			{#if $appSettings.llmProvider === 'groq'}
				<div class="mt-3 flex items-center justify-between gap-6 py-2">
					<Label for="groqKey">Groq API key</Label>
					<Input id="groqKey" type="password" class="max-w-64" bind:value={$groqApiKey} />
				</div>
			{:else if $appSettings.llmProvider === 'deepseek'}
				<div class="mt-3 flex items-center justify-between gap-6 py-2">
					<Label for="dsKey">DeepSeek API key</Label>
					<Input id="dsKey" type="password" class="max-w-64" bind:value={$deepseekApiKey} />
				</div>
			{:else}
				<div class="mt-3 flex items-center justify-between gap-6 py-2">
					<Label for="customKey">API key</Label>
					<Input id="customKey" type="password" class="max-w-64" bind:value={$customApiKey} />
				</div>
			{/if}
		</section>

		<section class="mb-8 border-b pb-6">
			<h2 class="mb-4 text-xs font-semibold tracking-widest text-faint uppercase">Speech</h2>
			<div class="flex items-center justify-between gap-6 py-2">
				<Label>Transcription</Label>
				<select
					class="h-9 min-w-48 rounded-md border bg-background px-2 text-sm"
					value={$appSettings.sttMode}
					onchange={(event) =>
						setSetting('sttMode', (event.target as HTMLSelectElement).value as 'local' | 'cloud')}
				>
					<option value="local">Local (Whisper Small, WASM)</option>
					<option value="cloud">Cloud (Groq)</option>
				</select>
			</div>
			<div class="flex items-center justify-between gap-6 py-2">
				<Label>Voice</Label>
				<select
					class="h-9 min-w-48 rounded-md border bg-background px-2 text-sm"
					value={$appSettings.ttsMode}
					onchange={(event) =>
						setSetting('ttsMode', (event.target as HTMLSelectElement).value as 'local' | 'cloud')}
				>
					<option value="local">Local (Piper)</option>
					<option value="cloud">Cloud (OpenAI)</option>
				</select>
			</div>
			{#if $appSettings.ttsMode === 'local'}
				<div class="flex items-center justify-between gap-6 py-2">
					<Label>Piper voice</Label>
					<select
						class="h-9 min-w-48 rounded-md border bg-background px-2 text-sm"
						value={$appSettings.ttsVoice}
						onchange={(event) => setSetting('ttsVoice', (event.target as HTMLSelectElement).value)}
					>
						{#each voices as voice (voice.id)}<option value={voice.id}>{voice.label}</option>{/each}
					</select>
				</div>
			{:else}
				<div class="flex items-center justify-between gap-6 py-2">
					<Label for="openaiKey">OpenAI API key</Label>
					<Input id="openaiKey" type="password" class="max-w-64" bind:value={$openaiApiKey} />
				</div>
			{/if}
		</section>

		<section>
			<h2 class="mb-4 text-xs font-semibold tracking-widest text-faint uppercase">Storage</h2>
			<div class="flex items-center justify-between gap-6 py-2 text-sm">
				<span class="text-muted-foreground">Database</span>
				<Badge variant="outline">On this device (SQLite)</Badge>
			</div>
			<div class="flex items-center justify-between gap-6 py-2">
				<div>
					<p class="text-sm">Export my data</p>
					<p class="text-xs text-muted-foreground">
						Sessions, attempts, corrections and recordings as a JSON file.
					</p>
				</div>
				<Button variant="secondary" size="sm" onclick={exportData} disabled={exporting}>
					{#if exporting}<Loader2 class="size-3.5 animate-spin" />{:else}<Download
							class="size-3.5"
						/>{/if}
					Export
				</Button>
			</div>
			<p class="text-xs text-muted-foreground">
				Cloud sync (Google Drive, WebDAV) is planned for a later phase.
			</p>
		</section>
	</div>
</div>
