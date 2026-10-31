// SPDX-License-Identifier: AGPL-3.0-or-later

import { BaseSTTAdapter } from '../BaseSttAdapter';
import { encodeWav } from '#lib/utils/wav.js';
import { fetchWithTimeout } from '#lib/adapters/llm/client.js';
import { recordCall, recordRefusal } from '#lib/usage/ledger.js';
import type { ModelConfig, ModelProgress, TranscribeOptions } from '#lib/types.js';

const GROQ_TRANSCRIPTION_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';

/** The Groq Whisper model cloud speech-to-text uses. */
export const GROQ_WHISPER_MODEL = 'whisper-large-v3-turbo';
const SAMPLE_RATE = 16_000;

/** Recording containers Groq accepts, by MIME type, with the file name it reads the format from. */
const UPLOAD_NAMES: Record<string, string> = {
	'audio/webm': 'audio.webm',
	'audio/ogg': 'audio.ogg',
	'audio/mp4': 'audio.m4a',
	'audio/mpeg': 'audio.mp3',
	'audio/flac': 'audio.flac',
	'audio/wav': 'audio.wav'
};

/**
 * The file to upload: the compressed recording when Groq takes its format
 * (a tenth of the size or less, so it uploads fast on a phone), otherwise the
 * PCM as WAV.
 */
function uploadFile(audio16kMono: Float32Array, encodedAudio?: Blob): { file: Blob; name: string } {
	const container = encodedAudio?.type.split(';')[0].trim().toLowerCase() ?? '';
	const name = UPLOAD_NAMES[container];
	if (encodedAudio && encodedAudio.size > 0 && name) return { file: encodedAudio, name };

	return { file: encodeWav(audio16kMono, SAMPLE_RATE), name: 'audio.wav' };
}

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
			description: 'Cloud speech-to-text via Groq. Sends audio to Groq; requires an API key.',
			provider: 'Browser Native',
			modelRepoId: 'groq/whisper-large-v3-turbo',
			parameterCount: 'N/A (cloud)',
			quantizedSize: '0 MB · network',
			language: 'Multilingual / French',
			status: 'unloaded'
		};
		super(config);
		this.apiKey = options.apiKey ?? '';
		this.model = options.model ?? GROQ_WHISPER_MODEL;
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
			this.setStatus('error', 'A Groq API key is required for cloud speech-to-text.');
			throw new Error('A Groq API key is required for cloud speech-to-text.');
		}
		this.setStatus('ready');
		this.updateProgress('Groq ready', 100);
	}

	public async doTranscribe(
		audio16kMono: Float32Array,
		_durationSec: number,
		options?: TranscribeOptions
	): Promise<string> {
		if (!this.apiKey) throw new Error('A Groq API key is required for cloud speech-to-text.');

		const form = new FormData();
		const upload = uploadFile(audio16kMono, options?.encodedAudio);
		form.append('file', upload.file, upload.name);
		form.append('model', this.model);
		form.append('language', options?.language ?? 'en');
		form.append('response_format', 'json');
		if (options?.task === 'translate') form.append('task', 'translate');

		const response = await fetchWithTimeout(
			GROQ_TRANSCRIPTION_URL,
			{
				method: 'POST',
				headers: { Authorization: `Bearer ${this.apiKey.trim()}` },
				body: form
			},
			{ timeoutMs: 120_000 }
		);

		if (!response.ok) {
			const detail = await response.text().catch(() => '');
			recordRefusal({ url: GROQ_TRANSCRIPTION_URL, apiKey: this.apiKey, model: this.model, body: detail });
			throw new Error(
				`Groq speech-to-text failed (HTTP ${response.status})${detail ? `: ${detail.slice(0, 300)}` : ''}`
			);
		}

		// Groq's audio limits count the seconds sent, whatever was said in them.
		recordCall({
			url: GROQ_TRANSCRIPTION_URL,
			apiKey: this.apiKey,
			model: this.model,
			audioSeconds: audio16kMono.length / SAMPLE_RATE,
			headers: response.headers
		});

		const data = await response.json();
		return String(data?.text ?? '');
	}
}
