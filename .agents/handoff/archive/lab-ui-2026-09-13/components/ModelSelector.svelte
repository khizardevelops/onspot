<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import { sttRegistry } from '../adapters/registry';
  import type { ModelConfig } from '../types';
  import AddCustomModelModal from './AddCustomModelModal.svelte';

  const dispatch = createEventDispatcher<{
    selectionChange: { selectedIds: string[] };
  }>();

  let models: ModelConfig[] = [];
  // Nothing is selected by default. This is a comparison tool, so pre-picking
  // a model would put a thumb on the scale before the user chooses.
  let selectedIds: string[] = [];
  let showCustomModal = false;

  function refreshModels() {
    models = sttRegistry.getAllConfigs();
  }

  /**
   * Re-read adapter state from the registry. Callable by the parent, because a
   * benchmark run loads models without going through this component.
   */
  export function refresh() {
    refreshModels();
  }

  onMount(() => {
    refreshModels();
    dispatch('selectionChange', { selectedIds });
  });

  function toggleSelect(id: string) {
    if (selectedIds.includes(id)) {
      selectedIds = selectedIds.filter(m => m !== id);
    } else {
      selectedIds = [...selectedIds, id];
    }
    dispatch('selectionChange', { selectedIds });
  }

  async function loadModel(id: string) {
    try {
      refreshModels();
      await sttRegistry.loadModel(id, () => {
        refreshModels();
      });
      refreshModels();
    } catch (err: any) {
      refreshModels();
    }
  }

  function handleModelAdded(e: CustomEvent<{ id: string }>) {
    refreshModels();
    toggleSelect(e.detail.id);
  }

  function removeCustomModel(id: string) {
    sttRegistry.removeAdapter(id);
    selectedIds = selectedIds.filter(m => m !== id);
    refreshModels();
    dispatch('selectionChange', { selectedIds });
  }
</script>

<section class="glass-panel models-section">
  <div class="section-header">
    <div class="title-group">
      <h2>2. Select Models to Benchmark</h2>
      <span class="info-tag">{selectedIds.length} Selected</span>
    </div>

    <button class="glass-button glass-button-sm" on:click={() => showCustomModal = true}>
      ➕ Add Custom Model
    </button>
  </div>

  <div class="models-grid">
    {#each models as model (model.id)}
      <div 
        class="model-card {selectedIds.includes(model.id) ? 'selected' : ''}"
        role="button"
        tabindex="0"
        on:click={() => toggleSelect(model.id)}
        on:keydown={(e) => (e.key === 'Enter' || e.key === ' ') && toggleSelect(model.id)}
      >
        <div class="card-header">
          <div class="checkbox-container">
            <input 
              type="checkbox" 
              checked={selectedIds.includes(model.id)} 
              on:change={() => toggleSelect(model.id)}
            />
            <span class="model-name">{model.name}</span>
          </div>

          {#if model.isCustom}
            <button 
              class="delete-btn" 
              title="Remove custom model"
              on:click|stopPropagation={() => removeCustomModel(model.id)}
            >
              🗑️
            </button>
          {/if}
        </div>

        <p class="model-desc">{model.description}</p>

        <div class="model-meta">
          <span class="meta-item">📦 {model.quantizedSize}</span>
          <span class="meta-item">🧠 {model.parameterCount}</span>
          <span class="meta-item">⚡ {model.provider}</span>
        </div>

        <div class="card-footer">
          {#if model.status === 'ready'}
            <span class="status-badge ready">
              ✓ Ready{model.device ? ` · ${model.device} / ${model.resolvedDtype}` : ''}
            </span>
          {:else if model.status === 'loading'}
            <div class="loading-state">
              <span class="status-badge loading">
                ⏳ {model.progress?.progress || 0}% - {model.progress?.status || 'Loading...'}
              </span>
              <div class="progress-bar-bg">
                <div
                  class="progress-bar-fill"
                  class:working={(model.progress?.progress || 0) >= 99}
                  style="width: {model.progress?.progress || 0}%"
                ></div>
              </div>
            </div>
          {:else if model.status === 'error'}
            <span class="status-badge error">⚠️ {model.error || 'Error'}</span>
            <button 
              class="load-btn"
              on:click|stopPropagation={() => loadModel(model.id)}
            >
              Retry
            </button>
          {:else}
            <span class="status-badge unloaded">💤 Unloaded</span>
            <button 
              class="load-btn"
              on:click|stopPropagation={() => loadModel(model.id)}
            >
              Pre-load
            </button>
          {/if}
        </div>
      </div>
    {/each}
  </div>
</section>

{#if showCustomModal}
  <AddCustomModelModal 
    on:close={() => showCustomModal = false}
    on:modelAdded={handleModelAdded}
  />
{/if}

<style>
  .models-section {
    padding: 24px;
    margin-bottom: 24px;
  }

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
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

  .info-tag {
    font-size: 0.75rem;
    color: var(--accent-indigo);
    background: rgba(99, 102, 241, 0.12);
    padding: 2px 8px;
    border-radius: 6px;
  }

  .glass-button-sm {
    padding: 6px 12px;
    font-size: 0.82rem;
  }

  .models-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 16px;
  }

  .model-card {
    position: relative;
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid var(--border-subtle);
    border-radius: 14px;
    padding: 18px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    cursor: pointer;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .model-card:hover {
    border-color: rgba(99, 102, 241, 0.35);
    transform: translateY(-2px);
  }

  .model-card.selected {
    border-color: var(--accent-indigo);
    background: rgba(99, 102, 241, 0.08);
    box-shadow: 0 4px 20px rgba(99, 102, 241, 0.15);
  }

  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
  }

  .checkbox-container {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  input[type="checkbox"] {
    width: 16px;
    height: 16px;
    accent-color: var(--accent-indigo);
    cursor: pointer;
  }

  .model-name {
    font-weight: 700;
    font-size: 0.98rem;
    color: var(--text-primary);
  }

  .delete-btn {
    background: transparent;
    border: none;
    cursor: pointer;
    font-size: 0.9rem;
    opacity: 0.6;
  }
  .delete-btn:hover {
    opacity: 1;
  }

  .model-desc {
    font-size: 0.82rem;
    color: var(--text-secondary);
    line-height: 1.35;
    margin-bottom: 14px;
    min-height: 38px;
  }

  .model-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 14px;
  }

  .meta-item {
    font-size: 0.73rem;
    color: var(--text-muted);
    background: rgba(0, 0, 0, 0.3);
    padding: 2px 8px;
    border-radius: 4px;
  }

  .card-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-top: 10px;
    border-top: 1px solid rgba(255, 255, 255, 0.05);
  }

  .status-badge {
    font-size: 0.76rem;
    font-weight: 600;
  }

  .status-badge.ready { color: var(--accent-emerald); }
  .status-badge.loading { color: var(--accent-amber); }
  .status-badge.error { color: var(--accent-rose); }
  .status-badge.unloaded { color: var(--text-muted); }

  .load-btn {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid var(--border-subtle);
    color: var(--text-primary);
    padding: 4px 10px;
    border-radius: 6px;
    font-size: 0.78rem;
    font-weight: 600;
    cursor: pointer;
  }

  .load-btn:hover {
    background: rgba(99, 102, 241, 0.2);
    border-color: var(--accent-indigo);
  }

  .loading-state {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .progress-bar-bg {
    width: 100%;
    height: 4px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 2px;
    overflow: hidden;
  }

  .progress-bar-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--accent-indigo), var(--accent-violet));
    transition: width 0.2s ease;
  }

  /*
   * Building the ONNX session happens after the last byte arrives and reports
   * no progress events. It is quick (~2s even for whisper-base), but it runs on
   * a blocked main thread, so only a compositor-driven CSS animation can move
   * during it. Keeps the last percent from reading as a hang.
   */
  .progress-bar-fill.working {
    background: linear-gradient(
      90deg,
      var(--accent-indigo),
      var(--accent-violet),
      var(--accent-indigo)
    );
    background-size: 200% 100%;
    animation: progress-working 1.2s linear infinite;
  }

  @keyframes progress-working {
    from { background-position: 200% 0; }
    to { background-position: 0 0; }
  }
</style>
