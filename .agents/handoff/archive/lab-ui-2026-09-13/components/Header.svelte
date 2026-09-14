<script lang="ts">
  import { onMount } from 'svelte';
  import { detectDevice } from '../adapters/engine';

  // Report the backend that will actually run, not merely what the browser
  // could support. `'gpu' in navigator` was reported as "WebGPU Ready" while
  // every model was in fact executing on WASM.
  let device: string | null = null;

  onMount(async () => {
    device = await detectDevice();
  });
</script>

<header class="glass-panel header-container">
  <div class="header-content">
    <div class="brand">
      <div class="logo-icon">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/>
          <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
          <line x1="12" y1="19" x2="12" y2="22"/>
        </svg>
      </div>
      <div>
        <div class="title-row">
          <h1>French Speech-to-Text Benchmarking Lab</h1>
          <span class="flag-icon">🇫🇷</span>
        </div>
        <p class="subtitle">
          In-browser evaluation & expandable adapter architecture for French ASR models
        </p>
      </div>
    </div>

    <div class="tech-stack-badges">
      <span class="badge badge-emerald">
        {#if device === 'webgpu'}
          ⚡ WebGPU
        {:else if device === 'wasm'}
          ⚙️ WebAssembly
        {:else}
          ⚙️ Detecting backend...
        {/if}
      </span>
    </div>
  </div>
</header>

<style>
  .header-container {
    padding: 20px 28px;
    margin-bottom: 24px;
  }

  .header-content {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 16px;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .logo-icon {
    width: 48px;
    height: 48px;
    border-radius: 14px;
    background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    box-shadow: 0 4px 14px rgba(99, 102, 241, 0.4);
  }

  .title-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  h1 {
    font-size: 1.4rem;
    font-weight: 800;
    letter-spacing: -0.02em;
    background: linear-gradient(135deg, #ffffff 0%, #cbd5e1 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }

  .flag-icon {
    font-size: 1.3rem;
  }

  .subtitle {
    color: var(--text-secondary);
    font-size: 0.88rem;
    margin-top: 2px;
  }

  .tech-stack-badges {
    display: flex;
    align-items: center;
    gap: 10px;
  }
</style>
