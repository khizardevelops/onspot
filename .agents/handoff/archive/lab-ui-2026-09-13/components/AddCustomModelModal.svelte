<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { sttRegistry } from '../adapters/registry';

  const dispatch = createEventDispatcher<{
    close: void;
    modelAdded: { id: string };
  }>();

  let repoId = '';
  let customName = '';
  let errorMsg = '';

  function handleAdd() {
    errorMsg = '';
    const cleanRepoId = repoId.trim();
    if (!cleanRepoId) {
      errorMsg = 'Please enter a valid Hugging Face repo ID (e.g. onnx-community/whisper-small)';
      return;
    }

    try {
      const adapter = sttRegistry.registerCustomModel(cleanRepoId, customName.trim() || cleanRepoId);
      dispatch('modelAdded', { id: adapter.config.id });
      dispatch('close');
    } catch (err: any) {
      errorMsg = err?.message || 'Failed to register model';
    }
  }
</script>

<div 
  class="modal-backdrop" 
  role="button" 
  tabindex="0"
  on:click={() => dispatch('close')}
  on:keydown={(e) => (e.key === 'Escape' || e.key === 'Enter') && dispatch('close')}
>
  <div 
    class="glass-panel modal-card" 
    role="dialog"
    aria-modal="true"
    on:click|stopPropagation
    on:keydown|stopPropagation
  >
    <div class="modal-header">
      <h3>➕ Add Custom Hugging Face ONNX Model</h3>
      <button class="close-btn" on:click={() => dispatch('close')}>✕</button>
    </div>

    <div class="modal-body">
      <p class="modal-desc">
        Enter any ONNX-exported speech recognition model repository from Hugging Face.
      </p>

      {#if errorMsg}
        <div class="error-banner">⚠️ {errorMsg}</div>
      {/if}

      <div class="form-group">
        <label for="repoId">Hugging Face Model Repo ID <span class="req">*</span></label>
        <input 
          id="repoId" 
          type="text" 
          placeholder="e.g. onnx-community/whisper-small or UsefulSensors/moonshine-tiny" 
          bind:value={repoId}
        />
        <span class="hint">Must contain ONNX weights compatible with Transformers.js</span>
      </div>

      <div class="form-group">
        <label for="customName">Display Name (Optional)</label>
        <input 
          id="customName" 
          type="text" 
          placeholder="e.g. My Custom French STT" 
          bind:value={customName}
        />
      </div>
    </div>

    <div class="modal-footer">
      <button class="glass-button" on:click={() => dispatch('close')}>Cancel</button>
      <button class="glass-button glass-button-primary" on:click={handleAdd}>Register Model</button>
    </div>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(6px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
    padding: 20px;
  }

  .modal-card {
    width: 100%;
    max-width: 520px;
    padding: 24px;
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
  }

  h3 {
    font-size: 1.1rem;
    font-weight: 700;
    color: var(--text-primary);
  }

  .close-btn {
    background: transparent;
    border: none;
    color: var(--text-secondary);
    font-size: 1.2rem;
    cursor: pointer;
  }

  .modal-desc {
    font-size: 0.88rem;
    color: var(--text-secondary);
    margin-bottom: 18px;
  }

  .error-banner {
    background: rgba(244, 63, 94, 0.15);
    border: 1px solid var(--accent-rose);
    color: #fca5a5;
    padding: 10px 14px;
    border-radius: 8px;
    font-size: 0.85rem;
    margin-bottom: 16px;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 16px;
  }

  label {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .req {
    color: var(--accent-rose);
  }

  input {
    background: rgba(0, 0, 0, 0.4);
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    padding: 10px 14px;
    color: var(--text-primary);
    font-family: var(--font-sans);
    font-size: 0.9rem;
  }

  input:focus {
    outline: none;
    border-color: var(--accent-indigo);
  }

  .hint {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 24px;
  }
</style>
