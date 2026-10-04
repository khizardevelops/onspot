import { Channel, invoke } from '@tauri-apps/api/core';
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

const command = (name: string) => `plugin:speech|${name}`;

function modelOf(language: LanguageDefinition) {
	return language.stt.models.whisperCpp;
}

async function isInstalled(file: string): Promise<boolean> {
	const status = await invoke<{ installed: boolean }>(command('model_status'), { file });
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
		await invoke(command('download_model'), {
			file: model.file,
			url: model.url,
			sha256: model.sha256,
			onProgress: progress
		});
	}
	onProgress?.({ status: 'Loading the speech model…', progress: 99 });
	await invoke(command('load_model'), { file: model.file });
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
		void invoke(command('cancel_download'));
	},

	async remove(language) {
		await invoke(command('delete_model'), { file: modelOf(language).file });
	},

	async transcribe(pcm16k, language, onProgress) {
		const model = modelOf(language);
		if (!(await isInstalled(model.file))) await prepare(language, onProgress);
		// Raw bytes rather than JSON: a minute of audio is 3.8 MB of PCM.
		const body = new Uint8Array(pcm16k.buffer, pcm16k.byteOffset, pcm16k.byteLength);
		return invoke<string>(command('transcribe'), body, {
			headers: { 'x-model': model.file, 'x-language': language.stt.code }
		});
	}
};
