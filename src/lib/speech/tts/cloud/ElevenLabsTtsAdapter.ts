// SPDX-License-Identifier: AGPL-3.0-or-later

import { BaseTTSAdapter } from '../BaseTtsAdapter';
import { fetchWithTimeout } from '#lib/adapters/llm/client.js';
import type { ModelProgress, TtsModelConfig } from '#lib/types.js';
import { recordCall } from '#lib/usage/ledger.js';
import { OPUS_MIME_TYPE } from '#lib/speech/audioFormat.js';
import { DEFAULT_ELEVENLABS_VOICE_ID } from './elevenLabsVoices';
import { decodeSpeech } from './speechAudio';

const ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io/v1';
const DEFAULT_MODEL = 'eleven_multilingual_v2';
/**
 * Ogg Opus at 32 kbps: the most compact format ElevenLabs offers, a fifth of
 * its 128 kbps MP3 and about a thirtieth of the same speech as WAV. It is
 * stored and played as it arrives. (ElevenLabs labels it `audio/opus`.)
 */
const OUTPUT_FORMAT = 'opus_48000_32';

/**
 * ElevenLabs refused the voice because the plan cannot use it through the API
 * (a Voice Library voice on the free plan). The speech service catches this
 * and switches to a voice every plan can use, so it is a recoverable state,
 * not a dead end.
 */
export class PaidPlanVoiceError extends Error {
	constructor() {
		super(
			'This ElevenLabs voice is from the Voice Library, which the free plan cannot use through the API. ' +
				'Choose another voice in Settings → Text-to-speech, or upgrade your ElevenLabs plan.'
		);
		this.name = 'PaidPlanVoiceError';
	}
}

/** True for ElevenLabs' `paid_plan_required` refusal (HTTP 402), e.g. a Voice Library voice on the free plan. */
function needsPaidPlan(status: number, body: string): boolean {
	if (status !== 402) return false;
	try {
		const parsed = JSON.parse(body) as { detail?: { code?: unknown } };
		return parsed.detail?.code === 'paid_plan_required';
	} catch {
		return false;
	}
}

export interface ElevenLabsTtsOptions {
	apiKey?: string;
	/** Overridable for testing or a proxy; defaults to ElevenLabs' public API. */
	baseUrl?: string;
	model?: string;
	voiceId?: string;
}

/**
 * Cloud Text-to-Speech via ElevenLabs (BYOK).
 *
 * ElevenLabs' multilingual model speaks every onspot language; the chosen voice
 * is sent as its voice id. The text goes to ElevenLabs and comes back as Opus
 * (`fetchSpeech`), which the speech service keeps as it is.
 */
export class ElevenLabsTtsAdapter extends BaseTTSAdapter {
	private apiKey: string;
	private readonly baseUrl: string;
	private readonly model: string;
	private voiceId: string;

	constructor(options: ElevenLabsTtsOptions = {}) {
		const config: TtsModelConfig = {
			id: 'elevenlabs-tts',
			name: 'ElevenLabs',
			description: 'Cloud text-to-speech via ElevenLabs. Sends text to ElevenLabs; requires an API key.',
			provider: 'Remote API',
			remote: true,
			modelRepoId: 'elevenlabs/eleven_multilingual_v2',
			downloadSize: '0 MB · network',
			language: 'Multilingual',
			canReturnAudio: true,
			status: 'unloaded'
		};
		super(config);
		this.apiKey = options.apiKey ?? '';
		this.baseUrl = (options.baseUrl || ELEVENLABS_BASE_URL).replace(/\/+$/, '');
		this.model = options.model ?? DEFAULT_MODEL;
		this.voiceId = options.voiceId ?? DEFAULT_ELEVENLABS_VOICE_ID;
	}

	public setApiKey(apiKey: string): void {
		this.apiKey = apiKey;
	}

	public setVoice(voiceId: string): void {
		this.voiceId = voiceId;
	}

	public isSupported(): boolean {
		return typeof fetch === 'function';
	}

	public async load(onProgress?: (progress: ModelProgress) => void): Promise<void> {
		if (onProgress) this.onProgressCallback = onProgress;
		if (!this.apiKey.trim()) {
			this.setStatus('error', 'An ElevenLabs API key is required for cloud text-to-speech.');
			throw new Error('An ElevenLabs API key is required for cloud text-to-speech.');
		}
		this.setStatus('ready');
		this.updateProgress('ElevenLabs ready', 100);
	}

	/** Speaks the text as PCM, like every local adapter (decoded from `fetchSpeech`). */
	protected async doSynthesize(text: string): Promise<{ audio: Float32Array; samplingRate: number }> {
		return decodeSpeech(await this.fetchSpeech(text));
	}

	/**
	 * Speaks the text.
	 *
	 * @returns The audio as ElevenLabs sent it: Ogg Opus.
	 */
	public async fetchSpeech(text: string): Promise<Blob> {
		const response = await this.requestSpeech(text, '');
		return new Blob([await response.arrayBuffer()], { type: OPUS_MIME_TYPE });
	}

	/**
	 * Speaks the text, sent while it is generated: the first audio arrives
	 * about a second after the request rather than once the whole clip is done.
	 * Same characters, same credits.
	 *
	 * @returns The arriving Ogg Opus.
	 */
	public async streamSpeech(text: string): Promise<ReadableStream<Uint8Array>> {
		const response = await this.requestSpeech(text, '/stream');
		if (!response.body) throw new Error('ElevenLabs sent no audio.');
		return response.body;
	}

	/**
	 * Asks ElevenLabs for speech: as one file, or (`/stream`) as it is generated.
	 * ElevenLabs bills the characters when the request is made, either way.
	 */
	private async requestSpeech(text: string, endpoint: '' | '/stream'): Promise<Response> {
		if (!this.apiKey.trim()) {
			throw new Error('An ElevenLabs API key is required for cloud text-to-speech.');
		}

		const voice = encodeURIComponent(this.voiceId);
		const url = `${this.baseUrl}/text-to-speech/${voice}${endpoint}?output_format=${OUTPUT_FORMAT}`;
		const response = await fetchWithTimeout(
			url,
			{
				method: 'POST',
				headers: {
					'xi-api-key': this.apiKey.trim(),
					'Content-Type': 'application/json',
					Accept: 'audio/*'
				},
				body: JSON.stringify({
					text,
					model_id: this.model
				})
			},
			{ timeoutMs: 60_000 }
		);

		if (!response.ok) {
			const detail = await response.text().catch(() => '');
			if (needsPaidPlan(response.status, detail)) throw new PaidPlanVoiceError();
			throw new Error(
				`ElevenLabs speech failed (HTTP ${response.status})${detail ? `: ${detail.slice(0, 300)}` : ''}`
			);
		}

		// ElevenLabs bills the characters of the text; the account total comes from its API.
		recordCall({ url, apiKey: this.apiKey, model: this.model, characters: text.length });
		return response;
	}
}
