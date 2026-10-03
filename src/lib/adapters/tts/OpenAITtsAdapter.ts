import { BaseTTSAdapter } from './BaseTTSAdapter';
import { fetchWithTimeout } from '../llm/client';
import type { ModelProgress, TtsModelConfig } from '../../types';

const OPENAI_SPEECH_URL = 'https://api.openai.com/v1/audio/speech';

export interface OpenAITtsOptions {
	apiKey?: string;
	model?: string;
	voice?: string;
}

/**
 * Cloud Text-to-Speech via the OpenAI speech endpoint (BYOK).
 *
 * The alternative to Piper when the user wants a more natural voice and is
 * willing to send the corrected text to OpenAI. Returns PCM decoded from the
 * response so it behaves like every local adapter.
 */
export class OpenAITtsAdapter extends BaseTTSAdapter {
	private apiKey: string;
	private readonly model: string;
	private voice: string;

	constructor(options: OpenAITtsOptions = {}) {
		const config: TtsModelConfig = {
			id: 'openai-tts',
			name: 'OpenAI TTS',
			description: 'Cloud speech synthesis via OpenAI. Sends text to OpenAI; requires an API key.',
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
		this.model = options.model ?? 'gpt-4o-mini-tts';
		this.voice = options.voice ?? 'alloy';
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
		if (!this.apiKey) {
			this.setStatus('error', 'An OpenAI API key is required for cloud speech.');
			throw new Error('An OpenAI API key is required for cloud speech.');
		}
		this.setStatus('ready');
		this.updateProgress('OpenAI TTS ready', 100);
	}

	protected async doSynthesize(text: string): Promise<{ audio: Float32Array; samplingRate: number }> {
		if (!this.apiKey) throw new Error('An OpenAI API key is required for cloud speech.');

		const response = await fetchWithTimeout(
			OPENAI_SPEECH_URL,
			{
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${this.apiKey.trim()}`
				},
				body: JSON.stringify({
					model: this.model,
					voice: this.voice,
					input: text,
					response_format: 'wav'
				})
			},
			{ timeoutMs: 60_000 }
		);

		if (!response.ok) {
			const detail = await response.text().catch(() => '');
			throw new Error(
				`OpenAI speech failed (HTTP ${response.status})${detail ? `: ${detail.slice(0, 300)}` : ''}`
			);
		}

		const bytes = await response.arrayBuffer();
		const context = new AudioContext();
		try {
			const decoded = await context.decodeAudioData(bytes);
			return {
				audio: new Float32Array(decoded.getChannelData(0)),
				samplingRate: decoded.sampleRate
			};
		} finally {
			await context.close();
		}
	}
}
