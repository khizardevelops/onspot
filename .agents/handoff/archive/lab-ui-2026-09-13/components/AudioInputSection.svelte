<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import { AudioRecorder, PRESET_FRENCH_SAMPLES, resampleAudioTo16kHz, type SampleAudio } from '../utils/audio';

  const dispatch = createEventDispatcher<{
    audioSelect: { audioData: Float32Array; durationSec: number; referenceText?: string; sourceName: string };
  }>();

  let activeTab: 'preset' | 'record' | 'upload' = 'preset';
  let isRecording = false;
  let recordTime = 0;
  let recordInterval: any = null;
  let recorder: AudioRecorder | null = null;
  let selectedPresetId = PRESET_FRENCH_SAMPLES[0].id;

  let audioUrl: string | null = null;
  let audioDurationSec = 0;
  let currentAudioData: Float32Array | null = null;
  let referenceText = PRESET_FRENCH_SAMPLES[0].referenceText;
  let sourceName = PRESET_FRENCH_SAMPLES[0].title;
  let isProcessingFile = false;
  let loadError: string | null = null;

  onMount(async () => {
    // Select initial sample preset
    await selectPreset(PRESET_FRENCH_SAMPLES[0]);
  });

  async function selectPreset(sample: SampleAudio) {
    selectedPresetId = sample.id;
    sourceName = sample.title;
    isProcessingFile = true;
    loadError = null;
    try {
      const { audioData, durationSec } = await sample.load();
      currentAudioData = audioData;
      audioDurationSec = durationSec;
      referenceText = sample.referenceText;
      audioUrl = sample.audioUrl ?? null;

      dispatch('audioSelect', {
        audioData,
        durationSec,
        referenceText,
        sourceName
      });
    } catch (err: any) {
      loadError = `Could not load "${sample.title}": ${err?.message ?? err}`;
      currentAudioData = null;
    } finally {
      isProcessingFile = false;
    }
  }

  async function startRecording() {
    try {
      recorder = new AudioRecorder();
      await recorder.start();
      isRecording = true;
      recordTime = 0;
      recordInterval = setInterval(() => {
        recordTime++;
      }, 1000);
    } catch (err) {
      alert('Could not access microphone: ' + err);
    }
  }

  async function stopRecording() {
    if (!recorder || !isRecording) return;
    clearInterval(recordInterval);
    isRecording = false;

    const { blob, url } = await recorder.stop();
    audioUrl = url;
    sourceName = `Live Mic Recording (${recordTime}s)`;
    selectedPresetId = '';

    const resampled = await resampleAudioTo16kHz(blob);
    currentAudioData = resampled.audioData;
    audioDurationSec = resampled.durationSec;

    // New audio has no ground truth. Carrying the previous clip's reference
    // over would score this recording against a transcript of something else.
    referenceText = '';

    dispatch('audioSelect', {
      audioData: resampled.audioData,
      durationSec: resampled.durationSec,
      referenceText,
      sourceName
    });
  }

  async function handleFileUpload(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    await processFile(file);
  }

  async function handleDrop(event: DragEvent) {
    event.preventDefault();
    if (event.dataTransfer?.files && event.dataTransfer.files.length > 0) {
      await processFile(event.dataTransfer.files[0]);
    }
  }

  async function processFile(file: File) {
    isProcessingFile = true;
    loadError = null;
    try {
      sourceName = file.name;
      audioUrl = URL.createObjectURL(file);
      selectedPresetId = '';
      const resampled = await resampleAudioTo16kHz(file);
      currentAudioData = resampled.audioData;
      audioDurationSec = resampled.durationSec;

      // An uploaded clip has no ground truth until the user pastes one in.
      referenceText = '';

      dispatch('audioSelect', {
        audioData: resampled.audioData,
        durationSec: resampled.durationSec,
        referenceText,
        sourceName
      });
    } catch (err: any) {
      loadError = 'Failed to read audio file: ' + (err?.message ?? err);
      currentAudioData = null;
    } finally {
      isProcessingFile = false;
    }
  }
</script>

<section class="glass-panel input-section">
  <div class="section-header">
    <div class="title-group">
      <h2>1. Select or Record Audio</h2>
      <span class="info-tag">16kHz Mono Resampled</span>
    </div>

    <div class="tabs">
      <button 
        class="tab-btn {activeTab === 'preset' ? 'active' : ''}" 
        on:click={() => activeTab = 'preset'}
      >
        🇫🇷 Sample Clips
      </button>
      <button 
        class="tab-btn {activeTab === 'record' ? 'active' : ''}" 
        on:click={() => activeTab = 'record'}
      >
        🎙️ Record Mic
      </button>
      <button 
        class="tab-btn {activeTab === 'upload' ? 'active' : ''}" 
        on:click={() => activeTab = 'upload'}
      >
        📁 Upload Audio
      </button>
    </div>
  </div>

  <div class="tab-content">
    {#if activeTab === 'preset'}
      <div class="preset-grid">
        {#each PRESET_FRENCH_SAMPLES as sample}
          <button 
            class="preset-card {selectedPresetId === sample.id ? 'selected' : ''}"
            on:click={() => selectPreset(sample)}
          >
            <div class="preset-top">
              <span class="category-badge">{sample.category}</span>
              <span class="preset-title">{sample.title}</span>
            </div>
            <p class="preset-desc">{sample.description}</p>
          </button>
        {/each}
      </div>
    {:else if activeTab === 'record'}
      <div class="record-box">
        {#if !isRecording}
          <button class="record-btn start" on:click={startRecording}>
            <div class="mic-circle">🎙️</div>
            <span>Click to Start Recording</span>
          </button>
        {:else}
          <button class="record-btn stop pulsing" on:click={stopRecording}>
            <div class="mic-circle red">⏹️</div>
            <span>Recording... ({recordTime}s) - Click to Stop</span>
          </button>
        {/if}
      </div>
    {:else if activeTab === 'upload'}
      <div 
        class="drop-zone"
        role="region"
        aria-label="Audio file upload zone"
        on:dragover|preventDefault
        on:drop={handleDrop}
      >
        <div class="drop-icon">📤</div>
        <p class="drop-text">Drag & drop your French audio file here, or click to browse</p>
        <p class="drop-hint">Supports WAV, MP3, M4A, OGG, WEBM</p>
        <input 
          type="file" 
          accept="audio/*" 
          on:change={handleFileUpload} 
          class="file-input" 
        />
      </div>
    {/if}
  </div>

  {#if loadError}
    <p class="load-error">{loadError}</p>
  {:else if isProcessingFile}
    <p class="load-status">Decoding audio to 16kHz mono...</p>
  {/if}

  {#if audioUrl}
    <div class="audio-preview-bar">
      <span class="audio-label">🔊 {sourceName} ({audioDurationSec.toFixed(1)}s)</span>
      <audio controls src={audioUrl} class="audio-player"></audio>
    </div>
  {/if}
</section>

<style>
  .input-section {
    padding: 24px;
    margin-bottom: 24px;
  }

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 16px;
    margin-bottom: 20px;
  }

  .title-group {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  h2 {
    font-size: 1.15rem;
    font-weight: 700;
    color: var(--text-primary);
  }

  .info-tag {
    font-size: 0.75rem;
    color: var(--accent-indigo);
    background: rgba(99, 102, 241, 0.12);
    padding: 2px 8px;
    border-radius: 6px;
  }

  .tabs {
    display: flex;
    background: rgba(0, 0, 0, 0.3);
    padding: 4px;
    border-radius: 10px;
    gap: 4px;
  }

  .tab-btn {
    background: transparent;
    border: none;
    color: var(--text-secondary);
    padding: 8px 14px;
    border-radius: 8px;
    font-weight: 600;
    font-size: 0.85rem;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .tab-btn.active {
    background: var(--bg-surface-elevated);
    color: var(--text-primary);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
  }

  .preset-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 12px;
  }

  .preset-card {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid var(--border-subtle);
    border-radius: 12px;
    padding: 14px;
    text-align: left;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .preset-card:hover {
    border-color: rgba(99, 102, 241, 0.4);
    background: rgba(99, 102, 241, 0.05);
  }

  .preset-card.selected {
    border-color: var(--accent-indigo);
    background: rgba(99, 102, 241, 0.12);
    box-shadow: 0 0 15px rgba(99, 102, 241, 0.2);
  }

  .preset-top {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 8px;
  }

  .category-badge {
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    color: var(--accent-cyan);
  }

  .preset-title {
    font-weight: 700;
    font-size: 0.92rem;
    color: var(--text-primary);
  }

  .preset-desc {
    font-size: 0.8rem;
    color: var(--text-secondary);
    font-style: italic;
    line-height: 1.3;
  }

  .record-box {
    display: flex;
    justify-content: center;
    padding: 30px;
  }

  .record-btn {
    background: rgba(99, 102, 241, 0.1);
    border: 2px dashed rgba(99, 102, 241, 0.4);
    border-radius: 16px;
    padding: 24px 40px;
    color: var(--text-primary);
    font-weight: 700;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    transition: all 0.2s ease;
  }

  .record-btn:hover {
    background: rgba(99, 102, 241, 0.2);
    border-color: var(--accent-indigo);
  }

  .record-btn.stop {
    background: rgba(244, 63, 94, 0.15);
    border-color: var(--accent-rose);
  }

  .mic-circle {
    font-size: 2rem;
  }

  .pulsing {
    animation: pulse 1.5s infinite;
  }

  @keyframes pulse {
    0% { box-shadow: 0 0 0 0 rgba(244, 63, 94, 0.4); }
    70% { box-shadow: 0 0 0 15px rgba(244, 63, 94, 0); }
    100% { box-shadow: 0 0 0 0 rgba(244, 63, 94, 0); }
  }

  .drop-zone {
    position: relative;
    border: 2px dashed var(--border-subtle);
    border-radius: 14px;
    padding: 36px 20px;
    text-align: center;
    background: rgba(255, 255, 255, 0.02);
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .drop-zone:hover {
    border-color: var(--accent-indigo);
    background: rgba(99, 102, 241, 0.05);
  }

  .drop-icon {
    font-size: 2.2rem;
    margin-bottom: 10px;
  }

  .drop-text {
    font-weight: 600;
    color: var(--text-primary);
    font-size: 0.95rem;
  }

  .drop-hint {
    font-size: 0.8rem;
    color: var(--text-muted);
    margin-top: 4px;
  }

  .file-input {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    cursor: pointer;
  }

  .audio-preview-bar {
    margin-top: 18px;
    padding: 12px 16px;
    background: rgba(0, 0, 0, 0.4);
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 12px;
  }

  .audio-label {
    font-size: 0.88rem;
    font-weight: 600;
    color: var(--accent-cyan);
  }

  .audio-player {
    height: 36px;
    border-radius: 8px;
  }

  .load-error,
  .load-status {
    margin-top: 14px;
    font-size: 0.85rem;
    font-weight: 600;
  }

  .load-error {
    color: var(--accent-rose);
  }

  .load-status {
    color: var(--text-secondary);
  }
</style>
