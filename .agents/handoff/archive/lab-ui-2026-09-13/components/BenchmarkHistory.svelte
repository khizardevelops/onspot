<script lang="ts">
  import type { TranscriptionResult } from '../types';

  export let history: TranscriptionResult[] = [];

  function exportCSV() {
    if (history.length === 0) return;
    const headers = ['Model Name', 'Execution Time (ms)', 'Audio Duration (s)', 'RTF', 'WER (%)', 'Timestamp', 'Transcription'];
    const rows = history.map(r => [
      `"${r.modelName}"`,
      r.executionTimeMs,
      r.audioDurationSec,
      r.realTimeFactor,
      r.wer !== undefined ? r.wer : 'N/A',
      `"${r.timestamp}"`,
      `"${r.text.replace(/"/g, '""')}"`
    ]);

    const csvContent = [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `stt-benchmark-results-${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function clearHistory() {
    history = [];
  }
</script>

{#if history.length > 0}
  <section class="glass-panel history-section">
    <div class="section-header">
      <div class="title-group">
        <h2>📊 Benchmark History Log</h2>
        <span class="count-badge">{history.length} Run{history.length > 1 ? 's' : ''}</span>
      </div>

      <div class="actions">
        <button class="glass-button glass-button-sm" on:click={exportCSV}>
          📥 Export CSV
        </button>
        <button class="clear-btn" on:click={clearHistory} title="Clear log">
          🗑️ Clear
        </button>
      </div>
    </div>

    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Model</th>
            <th>Latency (ms)</th>
            <th>Audio Dur</th>
            <th>RTF</th>
            <th>WER</th>
            <th>Transcription Output</th>
          </tr>
        </thead>
        <tbody>
          {#each history as run (run.id)}
            <tr>
              <td class="time-col">{run.timestamp}</td>
              <td class="model-col">{run.modelName}</td>
              <td class="mono">{run.executionTimeMs} ms</td>
              <td class="mono">{run.audioDurationSec}s</td>
              <td class="mono bold">{run.realTimeFactor.toFixed(2)}x</td>
              <td class="mono">{run.wer !== undefined ? `${run.wer}%` : '-'}</td>
              <td class="text-col">{run.text}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>
{/if}

<style>
  .history-section {
    padding: 24px;
    margin-bottom: 30px;
  }

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
    flex-wrap: wrap;
    gap: 12px;
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

  .count-badge {
    font-size: 0.75rem;
    color: var(--accent-violet);
    background: rgba(139, 92, 246, 0.15);
    padding: 2px 8px;
    border-radius: 6px;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .glass-button-sm {
    padding: 6px 12px;
    font-size: 0.8rem;
  }

  .clear-btn {
    background: transparent;
    border: none;
    cursor: pointer;
    font-size: 0.9rem;
    color: var(--text-muted);
  }
  .clear-btn:hover {
    color: var(--accent-rose);
  }

  .table-container {
    overflow-x: auto;
    border: 1px solid var(--border-subtle);
    border-radius: 10px;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.85rem;
    text-align: left;
  }

  th {
    background: rgba(0, 0, 0, 0.4);
    padding: 10px 14px;
    color: var(--text-secondary);
    font-weight: 600;
    border-bottom: 1px solid var(--border-subtle);
  }

  td {
    padding: 10px 14px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    color: var(--text-primary);
  }

  tr:hover td {
    background: rgba(255, 255, 255, 0.02);
  }

  .time-col { color: var(--text-muted); font-size: 0.78rem; }
  .model-col { font-weight: 700; }
  .mono { font-family: var(--font-mono); }
  .bold { font-weight: 700; color: var(--accent-cyan); }
  .text-col { max-width: 320px; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; }
</style>
