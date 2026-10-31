<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

<script lang="ts">
	import { appSettings } from '#lib/stores/settings.js';
	import { languageData } from '#lib/stores/languageData.js';
	import { groqApiKey } from '#lib/stores/secrets.js';
	import { getLanguage } from '#lib/languages/index.js';
	import { localSttModel } from '#lib/speech/stt/service.js';
	import SettingRow from '#lib/components/settings/SettingRow.svelte';
	import SecretInput from '#lib/components/settings/SecretInput.svelte';
	import { ExternalLink } from '@lucide/svelte';

	const local = $derived($appSettings.sttMode === 'local');
	const language = $derived(getLanguage($appSettings.targetLanguage));
	const model = $derived(language ? localSttModel(language.id) : null);
	/** The LLM card already exposes this key when Groq is the cloud provider. */
	const sharedGroqKey = $derived(
		$appSettings.correctionMode === 'cloud' && $appSettings.llmProvider === 'groq'
	);
</script>

<div class:hidden={!local}>
	<div class="border-b py-3.5">
		<p class="text-sm font-medium">{model?.label ?? 'Whisper small'}</p>
		<p class="mt-0.5 text-xs leading-normal text-muted-foreground">
			{model ? `${(model.bytes / 1e6).toFixed(0)} MB.` : ''}
			{#if $languageData.installed.stt}
				Installed on this device.
			{:else}
				Included in the install below.
			{/if}
		</p>
	</div>
</div>

<div class:hidden={local}>
	<SettingRow label="Groq API key" for="sttGroqKey">
		<SecretInput id="sttGroqKey" label="Groq API key" bind:value={$groqApiKey} />
	</SettingRow>
	{#if sharedGroqKey}
		<p class="border-b py-3.5 text-xs leading-normal text-muted-foreground">
			Also used by the LLM while Groq is selected.
		</p>
	{/if}
	<p class="py-3.5 text-xs leading-normal text-muted-foreground">
		Groq Whisper large-v3-turbo covers every supported language.
		<a href="https://console.groq.com/keys" target="_blank" rel="noreferrer" class="settings-link ml-1">
			Groq API keys <ExternalLink class="size-3" />
		</a>
	</p>
</div>
