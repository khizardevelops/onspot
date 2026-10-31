// SPDX-License-Identifier: AGPL-3.0-or-later

import { BaseTTSAdapter } from '../BaseTtsAdapter';
import { fetchWithTimeout } from '#lib/adapters/llm/client.js';
import { recordCall, recordRefusal } from '#lib/usage/ledger.js';
import type { ModelProgress, TtsModelConfig } from '#lib/types.js';
import { OPUS_MIME_TYPE } from '#lib/speech/audioFormat.js';
import { decodeSpeech } from './speechAudio';

const OPENAI_BASE_URL = 'https://api.openai.com/v1';

/**
 * Speech servers that refused Opus (some self-hosted ones only speak WAV), by
 * base URL, so each is asked once and then gets WAV straight away.
 */
const serversWithoutOpus = new Set<string>();

/** A refusal of the request itself (a format the server lacks), as opposed to auth, quota or an outage. */
function refusedFormat(status: number): boolean {
	return status === 400 || status === 415 || status === 422;
}

export interface OpenAITtsOptions {
	apiKey?: string;
	/** Base URL of any OpenAI-compatible speech server. */
	baseUrl?: string;
	model?: string;
	voice?: string;
}

/**
 * Cloud Text-to-Speech via an OpenAI-compatible speech endpoint (BYOK).
 *
 * Defaults to OpenAI; the same adapter also drives a local compatible server
 * (for example Kokoro or openedai-speech) when its base URL is supplied. The
 * text is sent to that endpoint and comes back as Opus (`fetchSpeech`), or as
 * WAV from a server without Opus.
 */
export class OpenAITtsAdapter extends BaseTTSAdapter {
	private apiKey: string;
	private readonly baseUrl: string;
	private readonly model: string;
	private voice: string;

	constructor(options: OpenAITtsOptions = {}) {
		const config: TtsModelConfig = {
			id: 'openai-tts',
			name: 'OpenAI TTS',
			description: 'Cloud text-to-speech via OpenAI. Sends text to OpenAI; requires an API key.',
			provider: 'Remote API',
			remote: true,
			modelRepoId: 'openai/gpt-4o-mini-tts',
			downloadSize: '0 MB · network',
			language: 'French (fr)',
			canReturnAudio: true,
			status: 'unloaded'
		};
		super(config);
		this.apiKey = options.apiKey ?? '';
		this.baseUrl = (options.baseUrl || OPENAI_BASE_URL).replace(/\/+$/, '');
		this.model = options.model ?? 'gpt-4o-mini-tts';
		this.voice = options.voice ?? 'alloy';
	}

	/** OpenAI requires a key; most self-hosted speech servers do not. */
	private requiresKey(): boolean {
		try {
			return new URL(this.baseUrl).hostname === 'api.openai.com';
		} catch {
			return true;
		}
	}

	private speechUrl(): string {
		return `${this.baseUrl}/audio/speech`;
	}

	public setApiKey(apiKey: string): void {
		this.apiKey = apiKey;
	}

	public setVoice(voice: string): void {
		this.voice = voice;
	}

	public isSupported(): boolean {
		return typeof fetch === 'function';
	}

	public async load(onProgress?: (progress: ModelProgress) => void): Promise<void> {
		if (onProgress) this.onProgressCallback = onProgress;
		if (this.requiresKey() && !this.apiKey) {
			this.setStatus('error', 'An OpenAI API key is required for cloud text-to-speech.');
			throw new Error('An OpenAI API key is required for cloud text-to-speech.');
		}
		this.setStatus('ready');
		this.updateProgress('Speech API ready', 100);
	}

	/** Speaks the text as PCM, like every local adapter (decoded from `fetchSpeech`). */
	protected async doSynthesize(text: string): Promise<{ audio: Float32Array; samplingRate: number }> {
		return decodeSpeech(await this.fetchSpeech(text));
	}

	/**
	 * Speaks the text.
	 *
	 * @returns The audio as the server sent it: Ogg Opus, or WAV from a server without Opus.
	 */
	public async fetchSpeech(text: string): Promise<Blob> {
		const format = serversWithoutOpus.has(this.baseUrl) ? 'wav' : 'opus';
		const response = await this.requestSpeech(text, format);

		if (format === 'opus' && refusedFormat(response.status)) {
			serversWithoutOpus.add(this.baseUrl);
			return this.fetchSpeech(text);
		}
		return this.readSpeech(response, text, format);
	}

	private async requestSpeech(text: string, format: 'opus' | 'wav'): Promise<Response> {
		if (this.requiresKey() && !this.apiKey) {
			throw new Error('An OpenAI API key is required for cloud text-to-speech.');
		}

		const headers: Record<string, string> = { 'Content-Type': 'application/json' };
		if (this.apiKey.trim()) headers.Authorization = `Bearer ${this.apiKey.trim()}`;

		return fetchWithTimeout(
			this.speechUrl(),
			{
				method: 'POST',
				headers,
				body: JSON.stringify({
					model: this.model,
					voice: this.voice,
					input: text,
					response_format: format
				})
			},
			{ timeoutMs: 60_000 }
		);
	}

	private async readSpeech(response: Response, text: string, format: 'opus' | 'wav'): Promise<Blob> {
		if (!response.ok) {
			const detail = await response.text().catch(() => '');
			recordRefusal({ url: this.speechUrl(), apiKey: this.apiKey, model: this.model, body: detail });
			throw new Error(
				`Speech API failed (HTTP ${response.status})${detail ? `: ${detail.slice(0, 300)}` : ''}`
			);
		}

		recordCall({
			url: this.speechUrl(),
			apiKey: this.apiKey,
			model: this.model,
			characters: text.length,
			headers: response.headers
		});

		return new Blob([await response.arrayBuffer()], { type: format === 'opus' ? OPUS_MIME_TYPE : 'audio/wav' });
	}
}
