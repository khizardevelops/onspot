<script lang="ts">
  import Header from './lib/components/Header.svelte';
  import AudioInputSection from './lib/components/AudioInputSection.svelte';
  import ModelSelector from './lib/components/ModelSelector.svelte';
  import BenchmarkRunner from './lib/components/BenchmarkRunner.svelte';
  import ResultsDisplay from './lib/components/ResultsDisplay.svelte';
  import BenchmarkHistory from './lib/components/BenchmarkHistory.svelte';
  import TtsLab from './lib/components/TtsLab.svelte';
  import type { TranscriptionResult } from './lib/types';

  let selectedModelIds: string[] = [];
  let audioData: Float32Array | null = null;
  let audioDurationSec = 0;
  let referenceText = '';
  let sourceName = '';

  type Lab = 'stt' | 'tts';
  let lab: Lab = 'stt';

  let modelSelector: ModelSelector;
  let currentResults: TranscriptionResult[] = [];
  let history: TranscriptionResult[] = [];

  function handleAudioSelect(e: CustomEvent<{
    audioData: Float32Array;
    durationSec: number;
    referenceText?: string;
    sourceName: string;
  }>) {
    audioData = e.detail.audioData;
    audioDurationSec = e.detail.durationSec;
    sourceName = e.detail.sourceName;
    if (e.detail.referenceText !== undefined) {
      referenceText = e.detail.referenceText;
    }
  }

  function handleSelectionChange(e: CustomEvent<{ selectedIds: string[] }>) {
    selectedModelIds = e.detail.selectedIds;
  }

  function handleResultsReady(e: CustomEvent<{ results: TranscriptionResult[]; referenceText: string }>) {
    currentResults = e.detail.results;
    history = [...e.detail.results, ...history];
    // The run loaded models behind ModelSelector's back; sync its cards.
    modelSelector?.refresh();
  }
</script>

<main class="app-layout">
  <div class="container">
    <Header />

    <nav class="lab-tabs" aria-label="Lab">
      <button class="lab-tab {lab === 'stt' ? 'active' : ''}" on:click={() => (lab = 'stt')}>
        🎤 Speech-to-Text
      </button>
      <button class="lab-tab {lab === 'tts' ? 'active' : ''}" on:click={() => (lab = 'tts')}>
        🔊 Text-to-Speech
      </button>
    </nav>

    {#if lab === 'tts'}
      <TtsLab />
    {:else}

    <AudioInputSection 
      on:audioSelect={handleAudioSelect}
    />

    <ModelSelector 
      bind:this={modelSelector}
      on:selectionChange={handleSelectionChange}
    />

    <BenchmarkRunner 
      {selectedModelIds}
      {audioData}
      {audioDurationSec}
      bind:referenceText
      {sourceName}
      on:resultsReady={handleResultsReady}
    />

    {#if currentResults.length > 0}
      <ResultsDisplay 
        results={currentResults}
        {referenceText}
      />
    {/if}

    <BenchmarkHistory 
      {history}
    />
    {/if}
  </div>
</main>

<style>
  .app-layout {
    min-height: 100vh;
    padding: 28px 16px;
  }

  .container {
    max-width: 1100px;
    margin: 0 auto;
  }

  .lab-tabs {
    display: flex;
    gap: 4px;
    padding: 4px;
    margin-bottom: 24px;
    background: rgba(0, 0, 0, 0.3);
    border-radius: 12px;
    width: fit-content;
  }

  .lab-tab {
    background: transparent;
    border: none;
    color: var(--text-secondary);
    padding: 10px 20px;
    border-radius: 9px;
    font-weight: 700;
    font-size: 0.9rem;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .lab-tab.active {
    background: var(--bg-surface-elevated);
    color: var(--text-primary);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
  }
</style>
