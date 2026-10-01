import type { ITTSAdapter } from './BaseTTSAdapter';
import { PiperAdapter } from './PiperAdapter';
import { PiperPlusAdapter } from './PiperPlusAdapter';
import { LOCAL_VOICES } from './voices';
import type { ModelProgress, TtsModelConfig, TtsSynthesis } from '../../types';

/**
 * Local TTS voices for onspot (French: Piper; Japanese: piper-plus).
 *
 * French choices:
 *
 * Decided by a human listening test (2026-09-13), scoring for pronunciation
 * modelling quality — not by the round-trip WER or rtf numbers alone, which
 * measure intelligibility and speed, not how a voice actually sounds. Ranked:
 *
 *   1. Piper Tom (M, medium)     — winner. Probably needs an EQ boost in the
 *                                  high end and a loudness increase.
 *   2. Piper UPMC — jessica (#0)
 *   3. Piper Siwis (F, medium)
 *   4. Piper UPMC — pierre (#1)
 *
 * `Piper MLS (medium)` is kept unranked, not rejected: 125 speakers in one
 * checkpoint, to be auditioned separately later.
 *
 * Everything else that was in the lab lost this listening test and was
 * removed: `Piper Siwis (F, low)`, MMS-TTS French (fp32/q8/fp16), Audio8 TTS
 * 0.6B (remote), Web Speech API. See docs/benchmarks/tts.md for why each of
 * those was in the running and what disqualified it. Earlier, before this
 * listening test: Kokoro-82M (frozen English-only voice registry in
 * kokoro-js) and Matcha-TTS (no French model exists) were rejected outright.
 */
class TTSRegistry {
  private adapters: Map<string, ITTSAdapter> = new Map();

  constructor() {
    // One card per download. A card's config only covers choices that reuse the
    // same weights (speaker within a multi-speaker voice); a different Piper
    // voice is a different download, so it stays its own card.
    // The engine decides the G2P: eSpeak for Piper voices, OpenJTalk (WASM)
    // for piper-plus Japanese voices. Both share this worker's lifecycle.
    for (const { id, name, engine, voicePath, downloadSize, modelLanguage } of LOCAL_VOICES) {
      const a =
        engine === 'piper-plus'
          ? new PiperPlusAdapter({ id, name, voicePath, downloadSize, modelLanguage })
          : new PiperAdapter({ id, name, voicePath, downloadSize });
      this.adapters.set(a.config.id, a);
    }
  }

  public getAllConfigs(): TtsModelConfig[] {
    return Array.from(this.adapters.values()).map((a) => a.config);
  }

  public getAdapter(id: string): ITTSAdapter | undefined {
    return this.adapters.get(id);
  }

  /** Applies a config change, reloading the adapter's weights if needed. */
  public async configure(
    id: string,
    change: { voice?: string; speaker?: string; dtype?: string }
  ): Promise<void> {
    const adapter = this.adapters.get(id) as any;
    if (!adapter) return;
    // Only same-weights choices remain configurable; everything else is a card.
    if (change.speaker && adapter.setSpeaker) adapter.setSpeaker(change.speaker);
    if (change.voice && adapter.setVoice) adapter.setVoice(change.voice);
  }

  public async loadModel(id: string, onProgress?: (p: ModelProgress) => void): Promise<ITTSAdapter> {
    const adapter = this.adapters.get(id);
    if (!adapter) throw new Error(`TTS adapter "${id}" not found`);
    await adapter.load(onProgress);
    return adapter;
  }

  public async synthesize(id: string, text: string): Promise<TtsSynthesis> {
    const adapter = this.adapters.get(id);
    if (!adapter) throw new Error(`TTS adapter "${id}" not found`);
    if (adapter.status !== 'ready') await adapter.load();
    return adapter.synthesize(text);
  }

  /** Keep no more than one 63–77 MB voice session resident at a time. */
  public async disposeOthers(activeId: string): Promise<void> {
    for (const [id, adapter] of this.adapters) {
      if (id !== activeId && adapter.status === 'ready') await adapter.dispose();
    }
  }

  public async disposeAll(): Promise<void> {
    for (const adapter of this.adapters.values()) {
      if (adapter.status !== 'unloaded') await adapter.dispose();
    }
  }
}

export const ttsRegistry = new TTSRegistry();
