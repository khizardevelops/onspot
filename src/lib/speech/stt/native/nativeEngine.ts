import { Channel, invoke, type InvokeArgs, type InvokeOptions } from '@tauri-apps/api/core';
import type { LanguageDefinition } from '#lib/languages/index.js';
import type { ModelProgress } from '#lib/types.js';
import type { LocalSttEngine } from '../LocalSttEngine';

/**
 * whisper.cpp running natively in the desktop and Android apps, through the
 * `speech` Tauri plugin (`src-tauri/plugins/speech`). The model is a file in
 * the app's data folder, read straight from disk by native code.
 */

interface DownloadProgress {
	received: number;
	total: number;
}

/**
 * Calls a plugin command. Tauri rejects with the Rust error as a plain
 * string; it is rethrown as an Error so the UI can show the message.
 */
async function call<T>(name: string, args?: InvokeArgs, options?: InvokeOptions): Promise<T> {
	try {
		return await invoke<T>(`plugin:speech|${name}`, args, options);
	} catch (error) {
		throw error instanceof Error ? error : new Error(String(error));
	}
}

function modelOf(language: LanguageDefinition) {
	return language.stt.models.whisperCpp;
}

async function isInstalled(file: string): Promise<boolean> {
	const status = await call<{ installed: boolean }>('model_status', { file });
	return status.installed;
}

function megabytes(bytes: number): string {
	return (bytes / 1e6).toFixed(0);
}

async function prepare(
	language: LanguageDefinition,
	onProgress?: (progress: ModelProgress) => void
): Promise<void> {
	const model = modelOf(language);
	if (!(await isInstalled(model.file))) {
		const progress = new Channel<DownloadProgress>();
		progress.onmessage = ({ received, total }) =>
			onProgress?.({
				status: `Downloading ${megabytes(received)} / ${megabytes(total)} MB`,
				progress: total ? (received / total) * 99 : 0
			});
		await call('download_model', {
			file: model.file,
			url: model.url,
			sha256: model.sha256,
			onProgress: progress
		});
	}
	onProgress?.({ status: 'Loading the speech model…', progress: 99 });
	await call('load_model', { file: model.file });
	onProgress?.({ status: 'Speech model ready.', progress: 100 });
}

export const nativeWhisperEngine: LocalSttEngine = {
	model(language) {
		const { file, bytes } = modelOf(language);
		return { label: `whisper.cpp ${file}`, bytes };
	},

	async missingBytes(language) {
		const model = modelOf(language);
		return (await isInstalled(model.file)) ? 0 : model.bytes;
	},

	prepare,

	cancelPrepare() {
		void call('cancel_download');
	},

	async remove(language) {
		await call('delete_model', { file: modelOf(language).file });
	},

	async transcribe(pcm16k, language, onProgress) {
		const model = modelOf(language);
		if (!(await isInstalled(model.file))) await prepare(language, onProgress);
		// Sent as bytes: raw binary over the desktop IPC (3.8 MB for a minute of audio).
		// Android's bridge has no binary channel; the plugin accepts its JSON form too.
		const body = new Uint8Array(pcm16k.buffer, pcm16k.byteOffset, pcm16k.byteLength);
		return call<string>('transcribe', body, {
			headers: { 'x-model': model.file, 'x-language': language.stt.code }
		});
	}
};
