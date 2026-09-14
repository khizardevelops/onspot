<script lang="ts">
  import { onMount } from 'svelte';
  import confetti from 'canvas-confetti';
  import type { TranscriptionResult } from '../types';
  import { computeWordDiff } from '../utils/metrics';

  export let results: TranscriptionResult[] = [];
  export let referenceText = '';

  onMount(() => {
    if (results.length > 0) {
      try {
        confetti({
          particleCount: 50,
          spread: 60,
          origin: { y: 0.8 }
        });
      } catch (e) {}
    }
  });

  function getRtfColor(rtf: number): string {
    if (rtf <= 0.2) return 'var(--accent-emerald)'; // Extremely fast (<0.2x)
    if (rtf <= 0.5) return 'var(--accent-cyan)';    // Fast
    if (rtf <= 1.0) return 'var(--accent-amber)';   // Real-time
    return 'var(--accent-rose)';                    // Slow (>1.0x)
  }

  function getWerColor(wer?: number): string {
    if (wer === undefined) return 'var(--text-muted)';
    if (wer <= 15) return 'var(--accent-emerald)';
    if (wer <= 30) return 'var(--accent-cyan)';
    if (wer <= 50) return 'var(--accent-amber)';
    return 'var(--accent-rose)';
  }

  function copyText(text: string) {
    navigator.clipboard.writeText(text);
    alert('Transcription copied to clipboard!');
  }
</script>

<section class="glass-panel results-section">
  <div class="section-header">
    <h2>4. Benchmark & Transcription Results</h2>
    <span class="info-badge">{results.length} Model{results.length > 1 ? 's' : ''} Evaluated</span>
  </div>

  <div class="results-grid {results.length === 1 ? 'single-col' : ''}">
    {#each results as result (result.id)}
      <div class="result-card glass-panel">
        <div class="result-card-header">
          <div class="model-title-group">
            <h3>{result.modelName}</h3>
          </div>
          <button class="copy-btn" on:click={() => copyText(result.text)} title="Copy transcription">
            📋 Copy
          </button>
        </div>

        <div class="metrics-row">
          <div class="metric-card">
            <span class="metric-label">Execution Time</span>
            <span class="metric-value">{result.executionTimeMs} ms</span>
            <span class="metric-sub">Audio: {result.audioDurationSec}s</span>
          </div>

          <div class="metric-card">
            <span class="metric-label">Real-Time Factor (RTF)</span>
            <span class="metric-value" style="color: {getRtfColor(result.realTimeFactor)}">
              {result.realTimeFactor.toFixed(2)}x
            </span>
            <span class="metric-sub">
              {result.realTimeFactor > 0 ? `${(1 / result.realTimeFactor).toFixed(1)}x faster than audio` : 'N/A'}
            </span>
          </div>

          {#if result.wer !== undefined}
            <div class="metric-card">
              <span class="metric-label">Word Error Rate (WER)</span>
              <span class="metric-value" style="color: {getWerColor(result.wer)}">
                {result.wer}%
              </span>
              <span class="metric-sub">Lower is better</span>
            </div>
          {/if}

          {#if result.cer !== undefined}
            <div class="metric-card">
              <span class="metric-label">Char Error Rate (CER)</span>
              <span class="metric-value" style="color: {getWerColor(result.cer)}">
                {result.cer}%
              </span>
              <span class="metric-sub">Character level</span>
            </div>
          {/if}
        </div>

        <div class="transcription-box">
          <span class="box-title">Transcription Output:</span>
          <p class="transcription-text">{result.text}</p>
        </div>

        {#if referenceText.trim()}
          <div class="diff-box">
            <span class="box-title">Word-level Diff vs Reference:</span>
            <div class="diff-content">
              {#each computeWordDiff(referenceText, result.text) as segment}
                {#if segment.added}
                  <span class="diff-tag added" title="Extra word in hypothesis">+{segment.value}</span>
                {:else if segment.removed}
                  <span class="diff-tag removed" title="Missing from reference">-{segment.value}</span>
                {:else}
                  <span class="diff-tag match">{segment.value}</span>
                {/if}
              {/each}
            </div>
          </div>
        {/if}
      </div>
    {/each}
  </div>
</section>

<style>
  .results-section {
    padding: 24px;
    margin-bottom: 24px;
  }

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
  }

  h2 {
    font-size: 1.15rem;
    font-weight: 700;
    color: var(--text-primary);
  }

  .info-badge {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--accent-cyan);
    background: rgba(6, 182, 212, 0.15);
    padding: 4px 10px;
    border-radius: 6px;
  }

  .results-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
    gap: 20px;
  }

  .results-grid.single-col {
    grid-template-columns: 1fr;
  }

  .result-card {
    padding: 20px;
    background: rgba(18, 21, 38, 0.8);
    border: 1px solid var(--border-subtle);
  }

  .result-card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
  }

  .model-title-group {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  h3 {
    font-size: 1.05rem;
    font-weight: 700;
    color: var(--text-primary);
  }

  .copy-btn {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid var(--border-subtle);
    color: var(--text-secondary);
    padding: 4px 10px;
    border-radius: 6px;
    font-size: 0.78rem;
    cursor: pointer;
  }
  .copy-btn:hover {
    color: var(--text-primary);
    border-color: var(--accent-indigo);
  }

  .metrics-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
    gap: 10px;
    margin-bottom: 16px;
  }

  .metric-card {
    background: rgba(0, 0, 0, 0.3);
    padding: 10px 12px;
    border-radius: 10px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .metric-label {
    font-size: 0.7rem;
    color: var(--text-muted);
    font-weight: 600;
  }

  .metric-value {
    font-size: 1.1rem;
    font-weight: 800;
    font-family: var(--font-mono);
    color: var(--text-primary);
  }

  .metric-sub {
    font-size: 0.68rem;
    color: var(--text-secondary);
  }

  .transcription-box {
    background: rgba(0, 0, 0, 0.4);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 10px;
    padding: 14px;
    margin-bottom: 14px;
  }

  .box-title {
    font-size: 0.76rem;
    font-weight: 700;
    color: var(--text-muted);
    text-transform: uppercase;
    display: block;
    margin-bottom: 6px;
  }

  .transcription-text {
    font-size: 0.95rem;
    color: var(--text-primary);
    line-height: 1.5;
  }

  .diff-box {
    background: rgba(0, 0, 0, 0.25);
    border: 1px dashed rgba(255, 255, 255, 0.08);
    border-radius: 10px;
    padding: 12px;
  }

  .diff-content {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 6px;
    font-family: var(--font-mono);
    font-size: 0.85rem;
  }

  .diff-tag.match {
    color: var(--text-secondary);
  }

  .diff-tag.added {
    background: rgba(244, 63, 94, 0.2);
    color: #fca5a5;
    padding: 1px 4px;
    border-radius: 4px;
    text-decoration: line-through;
  }

  .diff-tag.removed {
    background: rgba(16, 185, 129, 0.2);
    color: #6ee7b7;
    padding: 1px 4px;
    border-radius: 4px;
  }
</style>
