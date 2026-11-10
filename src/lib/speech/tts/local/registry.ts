// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ITTSAdapter } from '../BaseTtsAdapter';
import { PiperAdapter } from '../piper/PiperAdapter';
import { PiperPlusAdapter } from '../piper/PiperPlusAdapter';
import { SupertonicAdapter } from '../supertonic/SupertonicAdapter';
import { ALL_VOICES } from '#lib/languages/voices.js';
import type { LanguageVoice } from '#lib/languages/index.js';

/**
 * Builds the adapter that speaks a voice, by its engine: Piper (eSpeak G2P),
 * piper-plus (OpenJTalk G2P, Japanese) or Supertonic (sherpa-onnx). All three
 * share this worker's lifecycle. Which voices exist, and how each was chosen
 * and approved, is recorded in `src/lib/languages/voices.ts`.
 */
function createAdapter(voice: LanguageVoice): ITTSAdapter {
	const { id, name, downloadSize } = voice;

	switch (voice.engine) {
		case 'supertonic':
			return new SupertonicAdapter({ id, name, downloadSize, language: voice.language, style: voice.style });
		case 'piper-plus':
			return new PiperPlusAdapter({ id, name, downloadSize, voicePath: voice.voicePath, modelLanguage: voice.modelLanguage });
		case 'piper':
			return new PiperAdapter({ id, name, downloadSize, voicePath: voice.voicePath });
	}
}

/** Every on-device voice's adapter, by voice id. Adapters are cheap until loaded. */
class TTSRegistry {
	private readonly adapters = new Map<string, ITTSAdapter>(ALL_VOICES.map((voice) => [voice.id, createAdapter(voice)]));

	public getAdapter(id: string): ITTSAdapter | undefined {
		return this.adapters.get(id);
	}

	/** Unloads every loaded voice except the ones to keep resident (a Piper session is 63–77 MB). */
	public async disposeOthers(keepIds: readonly string[]): Promise<void> {
		for (const [id, adapter] of this.adapters) {
			if (!keepIds.includes(id) && adapter.status === 'ready') await adapter.dispose();
		}
	}
}

export const ttsRegistry = new TTSRegistry();
