// SPDX-License-Identifier: AGPL-3.0-or-later

import { derived } from 'svelte/store';
import { defaultVoiceOf, getLanguage, getVoice } from '#lib/languages/index.js';
import { appSettings } from './settings';
import { languageData } from './languageData';
import { ttsApiRequiresKey } from './ttsConfig';
import {
	customApiKey,
	deepseekApiKey,
	elevenLabsApiKey,
	groqApiKey,
	openaiApiKey
} from './secrets';

/**
 * Per-capability processing choices.
 *
 * Speech-to-text, the LLM and text-to-speech each choose local or cloud
 * independently. The same requirement list drives the Settings rows and the
 * Practice gate, so they can never disagree.
 */

export type ProcessingTarget = 'speech-to-text' | 'llm' | 'text-to-speech';

export type ProcessingRequirementId =
	| 'transcription-download'
	| 'transcription-key'
	| 'correction-endpoint'
	| 'correction-key'
	| 'readback-download'
	| 'readback-key';

export interface ProcessingRequirement {
	id: ProcessingRequirementId;
	title: string;
	detail: string;
	met: boolean;
	/** Which capability row fixes it. */
	target: ProcessingTarget;
}

function hostOf(url: string): string {
	try {
		return new URL(url).host;
	} catch {
		return url || 'the configured server';
	}
}

/** Everything the current choices still need, in pipeline order. */
export const processingRequirements = derived(
	[
		appSettings,
		languageData,
		groqApiKey,
		deepseekApiKey,
		customApiKey,
		openaiApiKey,
		elevenLabsApiKey
	],
	([$settings, $data, $groq, $deepseek, $custom, $openai, $eleven]): ProcessingRequirement[] => {
		const language = getLanguage($settings.targetLanguage);
		const voice = language
			? (getVoice(language.id, $settings.ttsVoice) ?? defaultVoiceOf(language))
			: undefined;

		const requirements: ProcessingRequirement[] = [];

		if ($settings.sttMode === 'local') {
			requirements.push({
				id: 'transcription-download',
				title: 'Speech-to-text',
				detail: $data.installed.stt
					? 'Whisper small is on this device.'
					: 'Download Whisper small in the Speech-to-text section.',
				met: $data.installed.stt,
				target: 'speech-to-text'
			});
		} else {
			const hasKey = $groq.trim() !== '';
			requirements.push({
				id: 'transcription-key',
				title: 'Speech-to-text',
				detail: hasKey ? 'Groq Whisper is ready.' : 'Add a Groq key for cloud speech-to-text.',
				met: hasKey,
				target: 'speech-to-text'
			});
		}

		if ($settings.correctionMode === 'local') {
			const ready =
				$settings.localLlmUrl.trim() !== '' && $settings.localLlmModel.trim() !== '';
			requirements.push({
				id: 'correction-endpoint',
				title: 'LLM',
				detail: ready
					? `Using ${hostOf($settings.localLlmUrl)}.`
					: 'Set the local server URL and model.',
				met: ready,
				target: 'llm'
			});
		} else {
			const provider = $settings.llmProvider;
			let met = false;
			let detail = '';

			if (provider === 'groq') {
				met = $groq.trim() !== '';
				detail = met ? 'Groq LLM is ready.' : 'Add a Groq key for the LLM.';
			} else if (provider === 'deepseek') {
				met = $deepseek.trim() !== '';
				detail = met ? 'DeepSeek LLM is ready.' : 'Add a DeepSeek key for the LLM.';
			} else {
				met =
					$settings.customBaseUrl.trim() !== '' && $settings.customModel.trim() !== '';
				detail = met
					? `Using ${hostOf($settings.customBaseUrl)}.`
					: 'Set the custom endpoint URL and model.';
			}

			requirements.push({
				id: 'correction-key',
				title: 'LLM',
				detail,
				met,
				target: 'llm'
			});
		}

		if ($settings.ttsMode === 'local') {
			requirements.push({
				id: 'readback-download',
				title: 'Text-to-speech',
				detail: $data.installed.voice
					? `${voice?.name ?? 'The voice'} is on this device.`
					: `Download ${voice?.name ?? 'a voice'} in the Text-to-speech section.`,
				met: $data.installed.voice,
				target: 'text-to-speech'
			});
		} else if ($settings.ttsCloudProvider === 'elevenlabs') {
			const endpointReady =
				$settings.elevenLabsModel.trim() !== '' && $settings.elevenLabsVoiceId.trim() !== '';
			const hasKey = $eleven.trim() !== '';

			requirements.push({
				id: 'readback-key',
				title: 'Text-to-speech',
				detail: !endpointReady
					? 'Choose an ElevenLabs model and voice.'
					: !hasKey
						? 'Add an ElevenLabs API key.'
						: 'ElevenLabs is ready.',
				met: endpointReady && hasKey,
				target: 'text-to-speech'
			});
		} else {
			const endpointReady =
				$settings.ttsApiBaseUrl.trim() !== '' &&
				$settings.ttsApiModel.trim() !== '' &&
				$settings.ttsApiVoice.trim() !== '';
			const needsKey = ttsApiRequiresKey($settings);
			const hasKey = $openai.trim() !== '';

			requirements.push({
				id: 'readback-key',
				title: 'Text-to-speech',
				detail: !endpointReady
					? 'Set the endpoint, model and voice.'
					: needsKey && !hasKey
						? 'Add an OpenAI API key.'
						: `Ready on ${hostOf($settings.ttsApiBaseUrl)}.`,
				met: endpointReady && (!needsKey || hasKey),
				target: 'text-to-speech'
			});
		}

		return requirements;
	}
);

/** True when speech-to-text, the LLM and text-to-speech are all usable. */
export const processingReady = derived(processingRequirements, (requirements) =>
	requirements.every((requirement) => requirement.met)
);

/** The first thing the learner must fix, or null when ready. */
export const firstMissingRequirement = derived(
	processingRequirements,
	(requirements) => requirements.find((requirement) => !requirement.met) ?? null
);
