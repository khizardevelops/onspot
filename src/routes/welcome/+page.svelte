<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

<script lang="ts">
	/**
	 * First-run setup guide. It explains the two choices that decide whether
	 * onspot can work: the LLM that corrects a take, and the voice that reads it
	 * back. Keys stay in this browser; nothing here writes to the synced
	 * database. Settings can reopen this page at any time.
	 */
	import { get } from 'svelte/store';
	import { asset } from '$app/paths';
	import { goto } from '$app/navigation';
	import { pageHref } from '#lib/pages.js';
	import { appSettings, setSetting, settingsReady } from '#lib/stores/settings.js';
	import {
		customApiKey,
		deepseekApiKey,
		elevenLabsApiKey,
		groqApiKey
	} from '#lib/stores/secrets.js';
	import { refreshLanguageData } from '#lib/stores/languageData.js';
	import {
		AUTOMATIC_MODEL,
		getProvider,
		testConnection,
		type LlmEndpoint
	} from '#lib/adapters/llm/index.js';
	import { markOnboardingDone, markOnboardingSkipped, onboardingStatus } from '#lib/onboarding.js';
	import { getLanguage } from '#lib/languages/index.js';
	import SecretInput from '#lib/components/settings/SecretInput.svelte';
	import { NeoButton } from '@dvcol/neo-svelte/buttons';
	import { NeoInput } from '@dvcol/neo-svelte/inputs';
	import {
		ArrowLeft,
		ArrowRight,
		Check,
		ChevronRight,
		Cloud,
		ExternalLink,
		KeyRound,
		Laptop,
		Mic,
		Sparkles,
		Volume2
	} from '@lucide/svelte';

	type ProviderChoice = 'groq' | 'deepseek' | 'openai' | 'custom';
	type VoiceChoice = 'local' | 'cloud';
	type Step = 0 | 1 | 2;

	interface ProviderOption {
		id: ProviderChoice;
		name: string;
		badge: string;
		detail: string;
	}

	const PROVIDERS: ProviderOption[] = [
		{
			id: 'groq',
			name: 'Groq',
			badge: 'Free · recommended',
			detail: 'A free key for the coach. The same key can transcribe your speech, so there is no big download.'
		},
		{
			id: 'deepseek',
			name: 'DeepSeek',
			badge: 'Paid per token',
			detail: 'Low-cost tokens. Speech-to-text stays on this device; install its data in Settings.'
		},
		{
			id: 'openai',
			name: 'ChatGPT · OpenAI',
			badge: 'Your OpenAI key',
			detail: 'Use an OpenAI key with a model such as gpt-4o-mini. OpenAI-compatible.'
		},
		{
			id: 'custom',
			name: 'Claude · custom endpoint',
			badge: 'OpenAI-compatible gateway',
			detail: 'Use OpenRouter (or another gateway) with a Claude model, or any OpenAI-compatible server. Paste its URL, model and key.'
		}
	];

	const returning = onboardingStatus() !== null;

	let step = $state<Step>(0);
	let provider = $state<ProviderChoice>('groq');
	let useGroqForStt = $state(true);
	let voice = $state<VoiceChoice>('local');
	const providerName = $derived(PROVIDERS.find((option) => option.id === provider)?.name ?? 'your provider');

	let groqKey = $state(get(groqApiKey));
	let deepseekKey = $state(get(deepseekApiKey));
	let customKey = $state(get(customApiKey));
	let elevenKey = $state(get(elevenLabsApiKey));
	let customUrl = $state('');
	let customModel = $state('');

	let testing = $state(false);
	let coachError = $state('');
	let coachNotice = $state('');
	let coachNoticeTone = $state<'good' | 'error'>('good');
	let voiceError = $state('');

	let seeded = false;
	$effect(() => {
		// Settings hydrate after a direct load; seed the editable fields once.
		if (seeded || !$settingsReady) return;
		seeded = true;
		if ($appSettings.llmProvider === 'custom') {
			provider = $appSettings.customBaseUrl.includes('api.openai.com') ? 'openai' : 'custom';
		} else {
			provider = $appSettings.llmProvider;
		}
		customUrl = $appSettings.customBaseUrl;
		customModel = $appSettings.customModel;
		useGroqForStt = $appSettings.sttMode === 'cloud' || provider === 'groq';
		voice = $appSettings.ttsMode;
	});

	const STEPS = [
		{ label: 'Coach key', icon: KeyRound },
		{ label: 'Voice', icon: Volume2 },
		{ label: 'Ready', icon: Check }
	] as const;

	const keyUrl = $derived(
		provider === 'groq'
			? 'https://console.groq.com/keys'
			: provider === 'deepseek'
				? 'https://platform.deepseek.com/api_keys'
				: 'https://platform.openai.com/api-keys'
	);
	const keyLabel = $derived(
		provider === 'groq'
			? 'Groq API key'
			: provider === 'deepseek'
				? 'DeepSeek API key'
				: 'API key'
	);
	const keyPlaceholder = $derived(
		provider === 'groq' ? 'gsk_…' : provider === 'deepseek' ? 'sk-…' : 'Paste your key'
	);

	function chooseProvider(next: ProviderChoice): void {
		provider = next;
		coachError = '';
		coachNotice = '';
		if (next === 'openai') {
			customUrl = 'https://api.openai.com/v1';
			customModel = 'gpt-4o-mini';
		}
		if (next === 'custom' && (customUrl.includes('api.openai.com') || customModel === 'gpt-4o-mini')) {
			customUrl = '';
			customModel = '';
		}
		if (next === 'groq') useGroqForStt = true;
	}

	function keyForProvider(): string {
		if (provider === 'groq') return groqKey.trim();
		if (provider === 'deepseek') return deepseekKey.trim();
		return customKey.trim();
	}

	function setKeyForProvider(value: string): void {
		if (provider === 'groq') groqApiKey.set(value);
		else if (provider === 'deepseek') deepseekApiKey.set(value);
		else customApiKey.set(value);
	}

	/** What is missing before the coach can be saved, or null. */
	function coachProblem(): string | null {
		const key = keyForProvider();
		if (provider === 'groq' && !key) return 'Paste your Groq key first.';
		if (provider === 'deepseek' && !key) return 'Paste your DeepSeek key first.';
		if (provider === 'openai' && !key) return 'Paste your OpenAI key first.';
		if (provider === 'custom') {
			if (!customUrl.trim()) return 'Add the endpoint URL first.';
			try {
				new URL(customUrl.trim());
			} catch {
				return 'That endpoint URL is not valid.';
			}
			if (!customModel.trim()) return 'Add the model name first.';
		}
		return null;
	}

	/** The endpoint to test, before anything is written to the learner's settings. */
	function testEndpoint(): LlmEndpoint {
		if (provider === 'groq' || provider === 'deepseek') {
			const config = getProvider(provider);
			return { baseUrl: config.baseUrl, apiKey: keyForProvider(), model: config.defaultModel };
		}
		return { baseUrl: customUrl.trim(), apiKey: customKey.trim(), model: customModel.trim() };
	}

	/** Writes the coach choices. Call only after `coachProblem` returns null. */
	function applyCoach(): void {
		const key = keyForProvider();
		setKeyForProvider(key);
		setSetting('correctionMode', 'cloud');
		setSetting('llmProvider', provider === 'openai' || provider === 'custom' ? 'custom' : provider);
		setSetting('llmModel', AUTOMATIC_MODEL);
		if (provider === 'openai' || provider === 'custom') {
			setSetting('customBaseUrl', customUrl.trim());
			setSetting('customModel', customModel.trim());
		}
		// Only Groq offers cloud speech-to-text here. Other providers keep the
		// learner's existing speech choice.
		if (provider === 'groq') setSetting('sttMode', useGroqForStt ? 'cloud' : 'local');
		else setSetting('sttMode', 'local');
	}

	async function checkCoach(): Promise<boolean> {
		coachError = '';
		coachNotice = '';
		const problem = coachProblem();
		if (problem) {
			coachError = problem;
			return false;
		}

		testing = true;
		try {
			const reply = await testConnection(testEndpoint());
			// A bad key is never saved: it only becomes the live coach after it answers.
			applyCoach();
			coachNoticeTone = 'good';
			coachNotice = `Connected. The model replied: ${reply}`;
			return true;
		} catch (error) {
			coachNoticeTone = 'error';
			coachNotice = error instanceof Error ? error.message : 'The connection test failed.';
			return false;
		} finally {
			testing = false;
		}
	}

	async function continueFromCoach(): Promise<void> {
		if (await checkCoach()) step = 1;
	}

	function continueWithoutCheck(): void {
		const problem = coachProblem();
		if (problem) {
			coachError = problem;
			return;
		}
		applyCoach();
		step = 1;
	}

	function applyVoice(): string | null {
		if (voice === 'local') {
			setSetting('ttsMode', 'local');
			return null;
		}

		const key = elevenKey.trim();
		if (!key) return 'Paste your ElevenLabs key, or choose the on-device voice.';
		elevenLabsApiKey.set(key);
		setSetting('ttsMode', 'cloud');
		setSetting('ttsCloudProvider', 'elevenlabs');
		return null;
	}

	function continueFromVoice(): void {
		voiceError = '';
		const problem = applyVoice();
		if (problem) {
			voiceError = problem;
			return;
		}
		step = 2;
	}

	async function finish(): Promise<void> {
		markOnboardingDone();
		await refreshLanguageData();
		await goto(pageHref('/'));
	}

	function dismiss(): void {
		// Reopening the guide from Settings must not undo a previous completion.
		if (onboardingStatus() === null) markOnboardingSkipped();
		void goto(pageHref('/'));
	}

	const needsLocalData = $derived(
		$appSettings.sttMode === 'local' || $appSettings.ttsMode === 'local'
	);
	/** The first local step Settings should open for its one-time download. */
	const dataHash = $derived($appSettings.sttMode === 'local' ? '#speech-to-text' : '#text-to-speech');
	const studiedLanguage = $derived(
		getLanguage($appSettings.targetLanguage)?.name ?? $appSettings.targetLanguage
	);
</script>

<svelte:head><title>Set up onspot</title></svelte:head>

<div class="setup-page">
	<header class="setup-bar">
		<div class="setup-brand">
			<span class="logo-tile size-8 shrink-0" aria-hidden="true">
				<span class="logo-ink dark:hidden" style="mask-image: url({asset('app-icon-circle-light-tile.svg')}); -webkit-mask-image: url({asset('app-icon-circle-light-tile.svg')})"></span>
				<span class="logo-ink hidden dark:block" style="mask-image: url({asset('app-icon-circle-dark-tile.svg')}); -webkit-mask-image: url({asset('app-icon-circle-dark-tile.svg')})"></span>
			</span>
			<div>
				<p class="setup-eyebrow">{returning ? 'Setup guide' : 'Welcome'}</p>
				<h1 class="setup-title">Set up onspot</h1>
			</div>
		</div>
		<NeoButton text rounded onclick={dismiss}>
			{returning ? 'Back to app' : 'Skip for now'}
			<ChevronRight size={15} />
		</NeoButton>
	</header>

	<div class="setup-scroll">
		<div class="setup-column">
			<ol class="setup-progress" aria-label="Setup steps">
				{#each STEPS as item, index (item.label)}
					{@const Icon = item.icon}
					<li class:current={step === index} class:done={step > index}>
						<span class="setup-step-icon"><Icon size={14} /></span>
						<span>{item.label}</span>
					</li>
				{/each}
			</ol>

			{#if step === 0}
				<section class="setup-card" aria-labelledby="setup-coach-title">
					<div class="setup-intro">
						<span class="setup-icon"><KeyRound size={20} /></span>
						<div>
							<h2 id="setup-coach-title">Connect your coach</h2>
							<p>
								onspot needs an LLM to correct and explain what you say. Keys stay in this
								browser and are never written to the synced database.
							</p>
						</div>
					</div>

					<div class="provider-grid" role="group" aria-label="LLM provider">
						{#each PROVIDERS as option (option.id)}
							<button
								type="button"
								class="provider-card"
								class:selected={provider === option.id}
								aria-pressed={provider === option.id}
								onclick={() => chooseProvider(option.id)}
							>
								<span class="provider-name">{option.name}</span>
								<span class="provider-badge">{option.badge}</span>
								<span class="provider-detail">{option.detail}</span>
							</button>
						{/each}
					</div>

					<div class="setup-fields">
						<label class="setup-label" for="onboarding-key">{keyLabel}</label>
						{#if provider === 'groq'}
							<SecretInput id="onboarding-key" bind:value={groqKey} label={keyLabel} placeholder={keyPlaceholder} />
						{:else if provider === 'deepseek'}
							<SecretInput id="onboarding-key" bind:value={deepseekKey} label={keyLabel} placeholder={keyPlaceholder} />
						{:else}
							<SecretInput id="onboarding-key" bind:value={customKey} label={keyLabel} placeholder={keyPlaceholder} />
						{/if}
						<div class="setup-key-help">
							{#if provider === 'custom'}
								<p>
									This covers OpenRouter for Claude, a gateway, or any OpenAI-compatible
									server. OpenRouter uses <code>https://openrouter.ai/api/v1</code> and a
									model name copied from its dashboard. For a server running on this
									computer, use Settings → LLM → Local instead.
								</p>
							{:else if provider === 'openai'}
								<p>Uses OpenAI's API at <code>https://api.openai.com/v1</code>.</p>
							{:else}
								<p>
									{provider === 'groq'
										? 'The free plan is enough to start. '
										: 'DeepSeek charges per token. '}
									<a class="setup-link" href={keyUrl} target="_blank" rel="noreferrer">
										Create your {providerName} key
										<ExternalLink size={12} />
									</a>
								</p>
							{/if}
						</div>
					</div>

					{#if provider === 'openai' || provider === 'custom'}
						<div class="setup-two-fields">
							<div class="setup-fields">
								<label class="setup-label" for="onboarding-base">Endpoint URL</label>
								<NeoInput
									id="onboarding-base"
									bind:value={customUrl}
									placeholder="https://openrouter.ai/api/v1"
									rounded
									elevation={-2}
									aria-label="Endpoint URL"
								/>
							</div>
							<div class="setup-fields">
								<label class="setup-label" for="onboarding-model">Model</label>
								<NeoInput
									id="onboarding-model"
									bind:value={customModel}
									placeholder={provider === 'openai' ? 'gpt-4o-mini' : 'the model name'}
									rounded
									elevation={-2}
									aria-label="Model name"
								/>
							</div>
						</div>
					{/if}

					{#if provider === 'groq'}
						<label class="setup-check">
							<input type="checkbox" bind:checked={useGroqForStt} />
							<span>
								<strong>Use Groq for speech-to-text too.</strong>
								The same key transcribes your speech, so you can start without the
								~299 MB Whisper download. Cloud speech uses your Groq limits.
							</span>
						</label>
					{:else}
						<p class="setup-note">
							Speech-to-text stays on this device for now. Install its language data in
							Settings before your first take.
						</p>
					{/if}

					{#if coachError}
						<p class="setup-message error" role="alert">{coachError}</p>
					{/if}
					{#if coachNotice}
						<p class="setup-message" class:error={coachNoticeTone === 'error'} data-tone={coachNoticeTone} role="status">
							{coachNotice}
						</p>
					{/if}

					<div class="setup-actions">
						<NeoButton text rounded onclick={continueWithoutCheck} disabled={testing}>
							Skip the check
						</NeoButton>
						<div class="setup-actions-end">
							<NeoButton rounded onclick={() => void checkCoach()} loading={testing}>
								Test key
							</NeoButton>
							<NeoButton color="primary" rounded onclick={() => void continueFromCoach()} loading={testing}>
								Continue
								<ArrowRight size={16} />
							</NeoButton>
						</div>
					</div>
				</section>
			{:else if step === 1}
				<section class="setup-card" aria-labelledby="setup-voice-title">
					<div class="setup-intro">
						<span class="setup-icon"><Volume2 size={20} /></span>
						<div>
							<h2 id="setup-voice-title">Choose how corrections sound</h2>
							<p>
								Every take can be read back to you. This step is only about the voice;
								you can change it later in Settings.
							</p>
						</div>
					</div>

					<div class="voice-grid">
						<button
							type="button"
							class="voice-card"
							class:selected={voice === 'local'}
							aria-pressed={voice === 'local'}
							onclick={() => (voice = 'local')}
						>
							<span class="voice-icon"><Laptop size={20} /></span>
							<span class="voice-title">On this device</span>
							<span class="voice-badge">Private · free · offline</span>
							<span class="voice-detail">
								Piper voices are clear but flatter. They need a one-time voice download
								(about 64 MB) in Settings.
							</span>
						</button>
						<button
							type="button"
							class="voice-card"
							class:selected={voice === 'cloud'}
							aria-pressed={voice === 'cloud'}
							onclick={() => (voice = 'cloud')}
						>
							<span class="voice-icon"><Cloud size={20} /></span>
							<span class="voice-title">ElevenLabs</span>
							<span class="voice-badge">Better sounding · needs a key</span>
							<span class="voice-detail">
								Cloud voices sound noticeably more natural and emotional. They use an
								ElevenLabs key and your monthly credits.
							</span>
						</button>
					</div>

					<p class="setup-honest">
						<Sparkles size={15} />
						Honest answer: cloud text-to-speech sounds better. The on-device voice is
						private, free and offline, but flatter.
					</p>

					{#if voice === 'cloud'}
						<div class="setup-fields">
							<label class="setup-label" for="onboarding-eleven">ElevenLabs API key</label>
							<SecretInput
								id="onboarding-eleven"
								bind:value={elevenKey}
								label="ElevenLabs API key"
								placeholder="Paste your ElevenLabs key"
							/>
							<div class="setup-key-help">
								<p>
									Premade voices work on the free plan.
									<a class="setup-link" href="https://elevenlabs.io/app/settings/api-keys" target="_blank" rel="noreferrer">
										Create an ElevenLabs key
										<ExternalLink size={12} />
									</a>
								</p>
							</div>
						</div>
					{/if}

					{#if voiceError}
						<p class="setup-message error" role="alert">{voiceError}</p>
					{/if}

					<div class="setup-actions">
						<NeoButton text rounded onclick={() => (step = 0)}>
							<ArrowLeft size={16} />
							Back
						</NeoButton>
						<NeoButton color="primary" rounded onclick={continueFromVoice}>
							Continue
							<ArrowRight size={16} />
						</NeoButton>
					</div>
				</section>
			{:else}
				<section class="setup-card" aria-labelledby="setup-ready-title">
					<div class="setup-intro">
						<span class="setup-icon ready"><Check size={20} /></span>
						<div>
							<h2 id="setup-ready-title">You are ready to speak</h2>
							<p>
								Here is what onspot will use. The first take will be transcribed,
								corrected and read back.
							</p>
						</div>
					</div>

					<dl class="setup-summary">
						<div>
							<dt>Coach</dt>
							<dd>{providerName} · Automatic model</dd>
						</div>
						<div>
							<dt>Speech-to-text</dt>
							<dd>{$appSettings.sttMode === 'cloud' ? 'Groq Whisper (cloud)' : 'On this device (Whisper)'}</dd>
						</div>
						<div>
							<dt>Voice</dt>
							<dd>{voice === 'cloud' ? 'ElevenLabs (cloud)' : 'On this device (Piper)'}</dd>
						</div>
						<div>
							<dt>Studying</dt>
							<dd>{studiedLanguage}</dd>
						</div>
					</dl>

					{#if needsLocalData}
						<p class="setup-message" data-tone="note" role="status">
							<Mic size={15} />
							<span>
								One more step: install the language data in Settings before your first
								take. It is a one-time download and then works offline.
								<a class="setup-link" href={`${pageHref('/settings')}${dataHash}`}>
									Open Settings
									<ChevronRight size={12} />
								</a>
							</span>
						</p>
					{/if}

					<div class="setup-actions">
						<NeoButton text rounded onclick={() => (step = 1)}>
							<ArrowLeft size={16} />
							Back
						</NeoButton>
						<NeoButton color="primary" rounded onclick={() => void finish()}>
							Start practising
							<ArrowRight size={16} />
						</NeoButton>
					</div>
				</section>
			{/if}

			<p class="setup-footer">
				API keys are stored only in this browser. The database that gets backed up and
				synced never contains them.
			</p>
		</div>
	</div>
</div>

<style>
	.setup-page {
		display: flex;
		height: 100%;
		flex-direction: column;
		min-height: 0;
	}
	.setup-bar {
		display: flex;
		flex: 0 0 auto;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.75rem var(--page-gutter);
		border-bottom: 1px solid var(--border);
	}
	.setup-brand {
		display: flex;
		min-width: 0;
		align-items: center;
		gap: 0.75rem;
	}
	.setup-brand .logo-tile {
		flex: 0 0 auto;
	}
	.setup-eyebrow {
		color: var(--muted-foreground);
		font-size: 0.6875rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}
	.setup-title {
		font-size: 1rem;
		font-weight: 600;
		letter-spacing: -0.02em;
	}
	.setup-scroll {
		flex: 1 1 auto;
		min-height: 0;
		overflow-y: auto;
		padding: 1.25rem var(--page-gutter) 3rem;
	}
	.setup-column {
		display: grid;
		gap: 1.25rem;
		width: 100%;
		max-width: 760px;
		margin: 0 auto;
	}
	.setup-progress {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.setup-progress li {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		color: var(--muted-foreground);
		font-size: 0.75rem;
		font-weight: 600;
	}
	.setup-progress li + li::before {
		content: '·';
		margin-right: 0.15rem;
		color: var(--faint);
	}
	.setup-progress li.current {
		color: var(--foreground);
	}
	.setup-progress li.done {
		color: var(--brand);
	}
	.setup-step-icon {
		display: grid;
		width: 22px;
		height: 22px;
		place-items: center;
		border: 1px solid var(--border);
		border-radius: 999px;
		background: var(--surface-2);
	}
	.setup-progress li.current .setup-step-icon {
		border-color: var(--primary);
		background: var(--brand-soft);
		color: var(--primary);
	}
	.setup-progress li.done .setup-step-icon {
		border-color: var(--good);
		background: var(--good-soft);
		color: var(--good);
	}

	.setup-card {
		display: grid;
		gap: 1.25rem;
		padding: 1.25rem;
		border: 1px solid var(--sheet-line);
		border-radius: 20px;
		background: var(--sheet-frost);
		box-shadow: var(--sheet-highlight), var(--shadow-sheet);
	}
	@media (min-width: 640px) {
		.setup-card {
			padding: 1.75rem;
		}
	}
	.setup-intro {
		display: flex;
		align-items: flex-start;
		gap: 0.875rem;
	}
	.setup-icon {
		display: grid;
		flex: 0 0 auto;
		width: 40px;
		height: 40px;
		place-items: center;
		border-radius: 12px;
		background: var(--brand-soft);
		color: var(--brand);
	}
	.setup-icon.ready {
		background: var(--good-soft);
		color: var(--good);
	}
	.setup-intro h2 {
		font-size: 1.125rem;
		font-weight: 650;
		letter-spacing: -0.02em;
	}
	.setup-intro p {
		margin-top: 0.25rem;
		color: var(--muted-foreground);
		font-size: 0.8125rem;
		line-height: 1.55;
	}

	.provider-grid {
		display: grid;
		gap: 0.5rem;
	}
	@media (min-width: 640px) {
		.provider-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
	.provider-card {
		display: grid;
		align-content: start;
		gap: 0.25rem;
		padding: 0.75rem 0.875rem;
		border: 1px solid var(--border);
		border-radius: 12px;
		background: var(--surface-2);
		color: var(--foreground);
		text-align: left;
		cursor: pointer;
		transition:
			border-color var(--motion-press) var(--motion-ease-out),
			background-color var(--motion-press) var(--motion-ease-out);
	}
	.provider-card:hover {
		background: var(--key);
	}
	.provider-card.selected {
		border-color: var(--primary);
		background: color-mix(in srgb, var(--brand-soft) 70%, var(--surface-2));
		box-shadow: var(--paper-emboss);
	}
	.provider-name {
		font-size: 0.875rem;
		font-weight: 650;
	}
	.provider-badge {
		color: var(--brand);
		font-size: 0.6875rem;
		font-weight: 600;
	}
	.provider-detail {
		color: var(--muted-foreground);
		font-size: 0.75rem;
		line-height: 1.45;
	}

	.setup-fields {
		display: grid;
		gap: 0.35rem;
		min-width: 0;
	}
	.setup-label {
		font-size: 0.8125rem;
		font-weight: 600;
	}
	.setup-key-help,
	.setup-note,
	.setup-honest,
	.setup-footer {
		color: var(--muted-foreground);
		font-size: 0.75rem;
		line-height: 1.5;
	}
	.setup-key-help code {
		padding: 0.05rem 0.25rem;
		border-radius: 4px;
		background: var(--surface-2);
		color: var(--foreground);
		font-family: var(--font-mono);
		font-size: 0.7rem;
	}
	.setup-link {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		color: var(--brand);
		font-weight: 600;
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	.setup-two-fields {
		display: grid;
		gap: 0.75rem;
	}
	@media (min-width: 640px) {
		.setup-two-fields {
			grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
		}
	}
	.setup-check {
		display: flex;
		align-items: flex-start;
		gap: 0.55rem;
		cursor: pointer;
		color: var(--muted-foreground);
		font-size: 0.75rem;
		line-height: 1.5;
	}
	.setup-check input {
		margin-top: 0.15rem;
		accent-color: var(--primary);
	}
	.setup-check strong {
		color: var(--foreground);
	}

	.voice-grid {
		display: grid;
		gap: 0.75rem;
	}
	@media (min-width: 640px) {
		.voice-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
	.voice-card {
		display: grid;
		align-content: start;
		gap: 0.3rem;
		padding: 0.875rem;
		border: 1px solid var(--border);
		border-radius: 14px;
		background: var(--surface-2);
		color: var(--foreground);
		text-align: left;
		cursor: pointer;
		transition:
			border-color var(--motion-press) var(--motion-ease-out),
			background-color var(--motion-press) var(--motion-ease-out);
	}
	.voice-card:hover {
		background: var(--key);
	}
	.voice-card.selected {
		border-color: var(--primary);
		background: color-mix(in srgb, var(--brand-soft) 70%, var(--surface-2));
		box-shadow: var(--paper-emboss);
	}
	.voice-icon {
		display: grid;
		width: 32px;
		height: 32px;
		place-items: center;
		border-radius: 10px;
		background: var(--brand-soft);
		color: var(--brand);
	}
	.voice-title {
		font-size: 0.9375rem;
		font-weight: 650;
	}
	.voice-badge {
		color: var(--brand);
		font-size: 0.6875rem;
		font-weight: 600;
	}
	.voice-detail {
		color: var(--muted-foreground);
		font-size: 0.75rem;
		line-height: 1.5;
	}
	.setup-honest {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		padding: 0.6rem 0.75rem;
		border: 1px solid color-mix(in srgb, var(--warn) 30%, transparent);
		border-radius: 10px;
		background: var(--warn-soft);
		color: var(--foreground);
	}
	.setup-honest :global(svg) {
		flex: 0 0 auto;
		margin-top: 0.1rem;
		color: var(--warn);
	}

	.setup-message {
		display: flex;
		align-items: flex-start;
		gap: 0.45rem;
		padding: 0.55rem 0.7rem;
		border-radius: 9px;
		background: var(--surface-2);
		color: var(--foreground);
		font-size: 0.75rem;
		line-height: 1.5;
		overflow-wrap: anywhere;
	}
	.setup-message[data-tone='good'] {
		background: var(--good-soft);
	}
	.setup-message[data-tone='note'] {
		background: var(--brand-soft);
	}
	.setup-message.error {
		background: var(--error-soft);
		color: var(--error);
	}
	.setup-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
		padding-top: 0.25rem;
		border-top: 1px solid var(--border);
	}
	.setup-actions-end {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-left: auto;
	}
	.setup-actions :global(.neo-button) {
		gap: 0.4rem;
	}
	.setup-summary {
		display: grid;
		gap: 0.35rem;
		margin: 0;
		padding: 0;
	}
	.setup-summary > div {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.55rem 0;
		border-bottom: 1px solid var(--border);
		font-size: 0.8125rem;
	}
	.setup-summary > div:last-child {
		border-bottom: 0;
	}
	.setup-summary dt {
		color: var(--muted-foreground);
	}
	.setup-summary dd {
		font-weight: 600;
		text-align: right;
	}
	.setup-footer {
		text-align: center;
	}
</style>
