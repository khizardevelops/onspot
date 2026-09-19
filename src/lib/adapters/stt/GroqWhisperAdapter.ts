import { BaseSTTAdapter } from './BaseAdapter';
import { encodeWav } from '../../utils/wav';
import type { ModelConfig, ModelProgress, TranscribeOptions } from '../../types';

const GROQ_TRANSCRIPTION_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';

/**
 * Cloud Speech-to-Text via Groq's Whisper endpoint (BYOK).
 *
 * Faster than the local model and needs no download, but sends the recording to
 * Groq. Selected only when the user configures a key and opts in.
 */
export class GroqWhisperAdapter extends BaseSTTAdapter {
	private apiKey: string;
	private readonly model: string;

	constructor(options: { apiKey?: string; model?: string } = {}) {
		const config: ModelConfig = {
			id: 'groq-whisper-large-v3-turbo',
			name: 'Groq Whisper Large v3 Turbo',
			description: 'Cloud transcription via Groq. Sends audio to Groq; requires an API key.',
			provider: 'Browser Native',
			modelRepoId: 'groq/whisper-large-v3-turbo',
			parameterCount: 'N/A (cloud)',
			quantizedSize: '0 MB · network',
			language: 'Multilingual / French',
			status: 'unloaded'
		};
		super(config);
		this.apiKey = options.apiKey ?? '';
		this.model = options.model ?? 'whisper-large-v3-turbo';
	}

	/** Keys are read from the secrets store at call time, not baked in. */
	public setApiKey(apiKey: string): void {
		this.apiKey = apiKey;
	}

	public isSupported(): boolean {
		return typeof fetch === 'function';
	}

	public async load(onProgress?: (progress: ModelProgress) => void): Promise<void> {
		if (onProgress) this.onProgressCallback = onProgress;
		if (!this.apiKey) {
			this.setStatus('error', 'A Groq API key is required for cloud transcription.');
			throw new Error('A Groq API key is required for cloud transcription.');
		}
		this.setStatus('ready');
		this.updateProgress('Groq ready', 100);
	}

	public async doTranscribe(
		audio16kMono: Float32Array,
		_durationSec: number,
		options?: TranscribeOptions
	): Promise<string> {
		if (!this.apiKey) throw new Error('A Groq API key is required for cloud transcription.');

		const form = new FormData();
		form.append('file', encodeWav(audio16kMono, 16000), 'audio.wav');
		form.append('model', this.model);
		form.append('language', options?.language ?? 'en');
		form.append('response_format', 'json');
		if (options?.task === 'translate') form.append('task', 'translate');

		const response = await fetch(GROQ_TRANSCRIPTION_URL, {
			method: 'POST',
			headers: { Authorization: `Bearer ${this.apiKey}` },
			body: form
		});

		if (!response.ok) {
			const detail = await response.text().catch(() => '');
			throw new Error(
				`Groq transcription failed (HTTP ${response.status})${detail ? `: ${detail.slice(0, 300)}` : ''}`
			);
		}

		const data = await response.json();
		return String(data?.text ?? '');
	}
}
