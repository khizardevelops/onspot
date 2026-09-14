<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { sttRegistry } from '../adapters/registry';
  import { calculateWER, calculateCER } from '../utils/metrics';
  import type { TranscriptionResult } from '../types';

  export let selectedModelIds: string[] = [];
  export let audioData: Float32Array | null = null;
  export let audioDurationSec = 0;
  export let referenceText = '';
  export let sourceName = '';

  const dispatch = createEventDispatcher<{
    resultsReady: { results: TranscriptionResult[]; referenceText: string };
  }>();

  let isRunning = false;
  let currentModelRunning = '';
  let statusMessage = '';

  async function startBenchmark() {
    if (!audioData || audioData.length === 0) {
      alert('Please select or record an audio clip first.');
      return;
    }
    if (selectedModelIds.length === 0) {
      alert('Please select at least one model to benchmark.');
      return;
    }

    isRunning = true;
    const finalResults: TranscriptionResult[] = [];

    for (let i = 0; i < selectedModelIds.length; i++) {
      const modelId = selectedModelIds[i];
      const config = sttRegistry.getAdapter(modelId)?.config;
      currentModelRunning = config?.name || modelId;
      statusMessage = `Running ${currentModelRunning} (${i + 1}/${selectedModelIds.length})...`;

      try {
        const result = await sttRegistry.runTranscription(modelId, audioData);
        
        // Calculate WER / CER if reference text is provided
        if (referenceText.trim()) {
          result.wer = calculateWER(referenceText, result.text);
          result.cer = calculateCER(referenceText, result.text);
        }

        finalResults.push(result);
      } catch (err: any) {
        console.error(`Error with ${modelId}:`, err);
        finalResults.push({
          id: `err-${Date.now()}`,
          modelId,
          modelName: config?.name || modelId,
          text: `[Error: ${err?.message || err}]`,
          executionTimeMs: 0,
          audioDurationSec,
          realTimeFactor: 0,
          timestamp: new Date().toLocaleTimeString()
        });
      }
    }

    isRunning = false;
    currentModelRunning = '';
    statusMessage = '';

    dispatch('resultsReady', {
      results: finalResults,
      referenceText: referenceText.trim()
    });
  }
</script>

<section class="glass-panel runner-section">
  <div class="runner-content">
    <div class="reference-box">
      <div class="ref-header">
        <label for="refText">3. Reference Ground Truth Text (Optional for WER/CER)</label>
        <span class="word-count">{referenceText.trim() ? referenceText.trim().split(/\s+/).length : 0} words</span>
      </div>
      <textarea 
        id="refText"
        rows="2"
        placeholder="Enter expected French text to calculate Word Error Rate (WER) and Character Error Rate (CER)..."
        bind:value={referenceText}
      ></textarea>
    </div>

    <div class="runner-action">
      <button 
        class="glass-button glass-button-primary run-btn"
        disabled={isRunning || !audioData || selectedModelIds.length === 0}
        on:click={startBenchmark}
      >
        {#if isRunning}
          <span class="spinner">🌀</span>
          <span>{statusMessage}</span>
        {:else if selectedModelIds.length === 0}
          <span>⚡ Select a model to benchmark</span>
        {:else}
          <span>⚡ Run Benchmark on {selectedModelIds.length} Model{selectedModelIds.length === 1 ? '' : 's'}</span>
        {/if}
      </button>

      {#if !audioData}
        <span class="warning-hint">⚠️ Please select or record audio above first</span>
      {:else}
        <span class="audio-info-hint">Ready to evaluate {sourceName} ({audioDurationSec.toFixed(1)}s)</span>
      {/if}
    </div>
  </div>
</section>

<style>
  .runner-section {
    padding: 24px;
    margin-bottom: 24px;
  }

  .runner-content {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .reference-box {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .ref-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  label {
    font-size: 0.95rem;
    font-weight: 700;
    color: var(--text-primary);
  }

  .word-count {
    font-size: 0.78rem;
    color: var(--text-muted);
  }

  textarea {
    background: rgba(0, 0, 0, 0.4);
    border: 1px solid var(--border-subtle);
    border-radius: 10px;
    padding: 12px 14px;
    color: var(--text-primary);
    font-family: var(--font-sans);
    font-size: 0.9rem;
    resize: vertical;
    line-height: 1.4;
  }

  textarea:focus {
    outline: none;
    border-color: var(--accent-indigo);
  }

  .runner-action {
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
  }

  .run-btn {
    padding: 14px 28px;
    font-size: 1rem;
    border-radius: 12px;
  }

  .warning-hint {
    font-size: 0.85rem;
    color: var(--accent-amber);
  }

  .audio-info-hint {
    font-size: 0.85rem;
    color: var(--accent-emerald);
  }

  .spinner {
    display: inline-block;
    animation: spin 1s infinite linear;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
</style>
