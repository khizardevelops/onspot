<script lang="ts">
  import { onMount } from 'svelte';
  import { ttsRegistry } from '../tts/registry';
  import { pcmToWavUrl, scoreRoundTrip, ROUND_TRIP_STT_ID } from '../tts/roundTrip';
  import { sttRegistry } from '../adapters/registry';
  import type { TtsModelConfig, TtsSynthesis } from '../types';

  /**
   * Presets chosen to expose the specific ways French TTS fails, rather than
   * to sound pleasant:
   *  - liaisons: does it link les_amis / grand_appartement?
   *  - question vs statement: pitch rise vs drop on identical words
   *  - pacing: does it pause at commas in nested clauses?
   */
  const PRESETS: Array<{ label: string; text: string; why: string }> = [
    { label: 'Liaisons', text: "Elles ont un grand appartement.",
      why: "Tests 's', 'd' and 't' linking - VITS usually nails these, StyleTTS2 can drop them." },
    { label: 'Question', text: "Tu viens demain ?",
      why: 'Pitch should rise at the end.' },
    { label: 'Statement', text: "Tu viens demain.",
      why: 'Same words as the question - pitch should fall instead.' },
    { label: 'Pacing', text: "Alors, pour commencer, on va se présenter chacun à notre tour, si vous êtes d'accord.",
      why: 'Nested clauses - listen for natural pauses at the commas.' },
    { label: 'Prompt', text: "Bonjour ! Parlez-moi de votre week-end. Qu'est-ce que vous avez fait samedi dernier ?",
      why: 'A realistic onspot speaking prompt.' },
  ];

  let text = PRESETS[0].text;
  let activePreset = PRESETS[0].label;
  let models: TtsModelConfig[] = [];
  let selectedIds: string[] = [];
  let results: TtsSynthesis[] = [];
  let audioUrls: Record<string, string> = {};
  let isRunning = false;
  let statusMessage = '';
  let roundTrip = true;

  onMount(() => refresh());

  function refresh() {
    models = ttsRegistry.getAllConfigs();
  }

  function toggle(id: string) {
    selectedIds = selectedIds.includes(id)
      ? selectedIds.filter((m) => m !== id)
      : [...selectedIds, id];
  }

  function usePreset(p: (typeof PRESETS)[number]) {
    text = p.text;
    activePreset = p.label;
  }

  /** Config changes swap weights, so the card returns to Unloaded. */
  async function configure(id: string, change: { voice?: string; speaker?: string; dtype?: string }) {
    await ttsRegistry.configure(id, change);
    refresh();
  }

  async function preload(id: string) {
    try {
      await ttsRegistry.loadModel(id, () => refresh());
    } finally {
      refresh();
    }
  }

  async function run() {
    if (!text.trim() || selectedIds.length === 0) return;
    isRunning = true;
    const fresh: TtsSynthesis[] = [];

    for (const id of selectedIds) {
      const cfg = ttsRegistry.getAdapter(id)?.config;
      statusMessage = `Synthesizing with ${cfg?.name ?? id}...`;
      try {
        let result = await ttsRegistry.synthesize(id, text);
        if (roundTrip && result.audio.length) {
          statusMessage = `Transcribing ${cfg?.name ?? id} back through Whisper...`;
          result = await scoreRoundTrip(result);
        }
        if (result.audio.length) {
          audioUrls[result.id] = pcmToWavUrl(result.audio, result.samplingRate);
        }
        fresh.push(result);
      } catch (err: any) {
        fresh.push({
          id: `err-${Date.now()}-${id}`, modelId: id, modelName: cfg?.name ?? id,
          text, audio: new Float32Array(0), samplingRate: 0, durationSec: 0,
          synthesisMs: 0, realTimeFactor: 0, peak: 0,
          timestamp: new Date().toLocaleTimeString(),
          roundTripText: `[Failed: ${err?.message ?? err}]`,
        });
      }
    }

    results = fresh;
    audioUrls = { ...audioUrls };
    isRunning = false;
    statusMessage = '';
    refresh();
  }

  function werColor(w?: number) {
    if (w === undefined) return 'var(--text-muted)';
    if (w <= 10) return 'var(--accent-emerald)';
    if (w <= 25) return 'var(--accent-cyan)';
    if (w <= 50) return 'var(--accent-amber)';
    return 'var(--accent-rose)';
  }

  $: sttReady = sttRegistry.getAdapter(ROUND_TRIP_STT_ID)?.config.status === 'ready';
</script>

<section class="glass-panel pane">
  <div class="head">
    <h2>1. Text to speak</h2>
    <span class="tag">{text.trim().split(/\s+/).filter(Boolean).length} words</span>
  </div>
  <div class="presets">
    {#each PRESETS as p}
      <button class="preset {activePreset === p.label ? 'on' : ''}" on:click={() => usePreset(p)} title={p.why}>
        {p.label}
      </button>
    {/each}
  </div>
  <textarea bind:value={text} rows="3" placeholder="Texte français à synthétiser..."></textarea>
  <p class="hint">{PRESETS.find((p) => p.label === activePreset)?.why ?? ''}</p>
</section>

<section class="glass-panel pane">
  <div class="head">
    <h2>2. Select TTS models</h2>
    <span class="tag">{selectedIds.length} selected</span>
  </div>
  <div class="grid">
    {#each models as m (m.id)}
      <div class="card {selectedIds.includes(m.id) ? 'sel' : ''}" role="button" tabindex="0"
           on:click={() => toggle(m.id)}
           on:keydown={(e) => (e.key === 'Enter' || e.key === ' ') && toggle(m.id)}>
        <div class="card-top">
          <input type="checkbox" checked={selectedIds.includes(m.id)} on:change={() => toggle(m.id)} />
          <span class="name">{m.name}</span>
        </div>
        <p class="desc">{m.description}</p>
        <div class="meta">
          <span>📦 {m.downloadSize}</span>
          {#if m.sampleRate}<span>🎚 {(m.sampleRate / 1000).toFixed(1)} kHz</span>{/if}
          <span>⚡ {m.provider}</span>
        </div>

        {#if m.voices?.length || m.speakers?.length}
          <div class="config">
            {#if m.voices?.length}
              <label>
                <span>Voice</span>
                <select value={m.selectedVoice} on:click|stopPropagation
                        on:change={(e) => configure(m.id, { voice: e.currentTarget.value })}>
                  {#each m.voices as v}<option value={v.id}>{v.label}{v.note ? ` — ${v.note}` : ''}</option>{/each}
                </select>
              </label>
            {/if}
            {#if m.speakers?.length}
              <label>
                <span>Speaker</span>
                <select value={m.selectedSpeaker} on:click|stopPropagation
                        on:change={(e) => configure(m.id, { speaker: e.currentTarget.value })}>
                  {#each m.speakers as sp}<option value={sp.id}>{sp.label}</option>{/each}
                </select>
              </label>
            {/if}
          </div>
        {/if}
        <div class="foot">
          {#if m.status === 'ready'}
            <span class="badge ok">✓ Ready{m.device ? ` · ${m.device}` : ''}</span>
          {:else if m.status === 'loading'}
            <div class="loading">
              <span class="badge load">⏳ {m.progress?.progress ?? 0}% - {m.progress?.status ?? 'Loading...'}</span>
              <div class="bar"><div class="fill" style="width:{m.progress?.progress ?? 0}%"></div></div>
            </div>
          {:else if m.status === 'error'}
            <span class="badge err">⚠️ {m.error}</span>
            <button class="mini" on:click|stopPropagation={() => preload(m.id)}>Retry</button>
          {:else}
            <span class="badge idle">💤 Unloaded</span>
            <button class="mini" on:click|stopPropagation={() => preload(m.id)}>Pre-load</button>
          {/if}
        </div>
      </div>
    {/each}
  </div>
</section>

<section class="glass-panel pane">
  <div class="runner">
    <label class="rt">
      <input type="checkbox" bind:checked={roundTrip} />
      Score intelligibility by transcribing back through Whisper Small q4
      {#if roundTrip && !sttReady}<span class="warn">(will download the 299 MB STT model on first run)</span>{/if}
    </label>
    <button class="glass-button glass-button-primary run" disabled={isRunning || !selectedIds.length || !text.trim()} on:click={run}>
      {#if isRunning}<span class="spin">🌀</span><span>{statusMessage}</span>
      {:else if !selectedIds.length}<span>🔊 Select a model to synthesize</span>
      {:else}<span>🔊 Synthesize with {selectedIds.length} model{selectedIds.length === 1 ? '' : 's'}</span>{/if}
    </button>
  </div>
</section>

{#if results.length}
  <section class="glass-panel pane">
    <div class="head"><h2>3. Results</h2><span class="tag">{results.length} synthesized</span></div>
    <div class="results">
      {#each results as r (r.id)}
        <div class="result">
          <h3>{r.modelName}</h3>
          {#if r.audio.length}
            <audio controls src={audioUrls[r.id]}></audio>
            <div class="stats">
              <div><span class="k">Audio</span><span class="v">{r.durationSec}s @ {(r.samplingRate / 1000).toFixed(1)}kHz</span></div>
              <div><span class="k">Synthesis</span><span class="v">{r.synthesisMs} ms</span></div>
              <div><span class="k">RTF</span><span class="v" style="color:{r.realTimeFactor <= 1 ? 'var(--accent-emerald)' : 'var(--accent-amber)'}">{r.realTimeFactor}x</span></div>
              <div><span class="k">Peak</span><span class="v" style="color:{r.peak > 0.01 ? 'var(--accent-emerald)' : 'var(--accent-rose)'}">{r.peak}{r.peak <= 0.01 ? ' (SILENT!)' : ''}</span></div>
              {#if r.roundTripWer !== undefined}
                <div><span class="k">Round-trip WER</span><span class="v" style="color:{werColor(r.roundTripWer)}">{r.roundTripWer}%</span></div>
              {/if}
            </div>
            {#if r.roundTripText}
              <div class="heard"><span class="k">Whisper heard:</span> "{r.roundTripText}"</div>
            {/if}
          {:else}
            <p class="noaudio">{r.roundTripText ?? 'Played through the browser; no audio buffer is returned, so it cannot be scored or replayed.'}</p>
          {/if}
        </div>
      {/each}
    </div>
    <p class="caveat">
      Round-trip WER measures <strong>intelligibility, not naturalness</strong> — a flat robotic voice can score 0%.
      Use it to catch broken audio, then judge cadence and prosody by ear.
    </p>
  </section>
{/if}

<style>
  .pane { padding: 24px; margin-bottom: 24px; }
  .head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
  h2 { font-size: 1.15rem; font-weight: 700; color: var(--text-primary); }
  .tag { font-size: 0.75rem; color: var(--accent-indigo); background: rgba(99,102,241,.12); padding: 2px 8px; border-radius: 6px; }
  .presets { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
  .preset { background: rgba(255,255,255,.04); border: 1px solid var(--border-subtle); color: var(--text-secondary);
            padding: 6px 12px; border-radius: 8px; font-size: .82rem; font-weight: 600; cursor: pointer; }
  .preset.on { background: rgba(99,102,241,.15); border-color: var(--accent-indigo); color: var(--text-primary); }
  textarea { width: 100%; background: rgba(0,0,0,.35); border: 1px solid var(--border-subtle); border-radius: 10px;
             color: var(--text-primary); padding: 12px; font-size: .95rem; resize: vertical; }
  .hint { margin-top: 8px; font-size: .8rem; color: var(--text-muted); font-style: italic; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
  .card { background: rgba(255,255,255,.03); border: 1px solid var(--border-subtle); border-radius: 12px; padding: 14px; cursor: pointer; }
  .card.sel { border-color: var(--accent-indigo); background: rgba(99,102,241,.1); }
  .card-top { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
  .name { font-weight: 700; font-size: .92rem; color: var(--text-primary); }
  .desc { font-size: .78rem; color: var(--text-secondary); line-height: 1.35; margin-bottom: 8px; }
  .meta { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
  .meta span { font-size: .7rem; background: rgba(0,0,0,.3); padding: 2px 6px; border-radius: 5px; color: var(--text-muted); }
  .config { display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px;
            padding: 10px; background: rgba(0,0,0,.28); border-radius: 9px; }
  .config label { display: flex; flex-direction: column; gap: 3px; }
  .config span { font-size: .66rem; text-transform: uppercase; letter-spacing: .04em; color: var(--text-muted); }
  .config select { background: rgba(255,255,255,.05); border: 1px solid var(--border-subtle);
                   color: var(--text-primary); border-radius: 6px; padding: 5px 8px; font-size: .78rem; cursor: pointer; }
  .foot { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .badge { font-size: .74rem; font-weight: 600; }
  .badge.ok { color: var(--accent-emerald); } .badge.idle { color: var(--text-muted); }
  .badge.err { color: var(--accent-rose); } .badge.load { color: var(--accent-cyan); }
  .loading { width: 100%; display: flex; flex-direction: column; gap: 4px; }
  .bar { width: 100%; height: 4px; background: rgba(255,255,255,.1); border-radius: 2px; overflow: hidden; }
  .fill { height: 100%; background: linear-gradient(90deg, var(--accent-indigo), var(--accent-violet)); transition: width .2s ease; }
  .mini { background: rgba(255,255,255,.06); border: 1px solid var(--border-subtle); color: var(--text-primary);
          padding: 4px 10px; border-radius: 6px; font-size: .74rem; font-weight: 600; cursor: pointer; }
  .runner { display: flex; flex-direction: column; gap: 14px; }
  .rt { display: flex; align-items: center; gap: 8px; font-size: .85rem; color: var(--text-secondary); flex-wrap: wrap; }
  .warn { color: var(--accent-amber); font-size: .78rem; }
  .run { align-self: flex-start; }
  .spin { display: inline-block; animation: spin 1s linear infinite; margin-right: 8px; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .results { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 14px; }
  .result { background: rgba(18,21,38,.8); border: 1px solid var(--border-subtle); border-radius: 12px; padding: 14px; }
  .result h3 { font-size: .95rem; font-weight: 700; margin-bottom: 10px; color: var(--text-primary); }
  .result audio { width: 100%; height: 36px; margin-bottom: 10px; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(96px, 1fr)); gap: 8px; margin-bottom: 10px; }
  .stats .k { display: block; font-size: .66rem; text-transform: uppercase; color: var(--text-muted); letter-spacing: .04em; }
  .stats .v { display: block; font-size: .86rem; font-weight: 700; color: var(--text-primary); font-family: ui-monospace, monospace; }
  .heard { font-size: .8rem; color: var(--text-secondary); background: rgba(0,0,0,.3); padding: 8px 10px; border-radius: 8px; line-height: 1.4; }
  .heard .k { color: var(--text-muted); font-size: .7rem; text-transform: uppercase; margin-right: 6px; }
  .noaudio { font-size: .82rem; color: var(--text-muted); font-style: italic; }
  .caveat { margin-top: 14px; font-size: .8rem; color: var(--text-muted); line-height: 1.5; }
</style>
