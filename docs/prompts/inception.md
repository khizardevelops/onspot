You are a Senior Full-Stack & Desktop Systems Architect. You are tasked with building a desktop-first, privacy-focused, offline-capable French spontaneous speaking application licensed under AGPL-3.0. 

The app helps English speakers transition from knowing French vocabulary/grammar to speaking spontaneously by providing random speaking prompts, recording 30–60 seconds of spoken French, generating real-time transcription, analyzing errors using an LLM, and reading back correct phrasing.

---

### 1. CORE TECHNICAL ARCHITECTURE & STACK REQUIREMENTS

- **Framework**: SvelteKit configured with `@sveltejs/adapter-static` (`fallback: 'index.html'`) to generate a purely client-side Single Page Application (SPA).
- **Desktop Wrapper**: Tauri v2 (Rust backend) compiling to a native desktop application (.exe for Windows first, cross-platform ready).
- **Target Strategy**: 
  1. Desktop (.exe via Tauri v2)
  2. Web SPA (Static Browser app)
  3. Mobile (Tauri v2 iOS/Android in future iterations)
- **License**: AGPL-3.0 (Include license header and LICENSE file).

#### Storage Strategy (Hybrid Client-Side Database):
Abstract all database calls behind a unified interface `IDatabaseAdapter`:
- **Desktop Runtime (Tauri v2)**: Use Rust native SQLite via `@tauri-apps/plugin-sql` for maximum performance.
- **Web SPA Runtime (Browser)**: Fallback to `@sqlite.org/sqlite-wasm` utilizing the Origin Private File System (OPFS) backend running inside a dedicated Web Worker.

#### Audio Engine (STT & TTS):
- **Local STT**: `@huggingface/transformers` running `onnx-community/whisper-tiny` or `whisper-base` via WebGPU inside a Web Worker.
- **Local TTS**: `@realtimex/piper-tts-web` (Piper WASM with `fr_FR-upmc-medium` VITS voice model).
- **BYOK Cloud Fallback**: Support cloud transcription/TTS via Groq/OpenAI APIs.

#### Integrations (Phase 1):
- **BYOK (Bring-Your-Own-Key) LLMs**:
  1. Groq API (`llama-3.3-70b-versatile` & `whisper-large-v3-turbo`)
  2. DeepSeek API (`deepseek-chat` / `deepseek-reasoner`)
- **BYOC (Bring-Your-Own-Cloud) Sync**:
  1. Google Drive REST API (OAuth 2.0 PKCE client-side flow)
  2. Generic WebDAV client (`webdav` npm package for Nextcloud/ownCloud/pCloud)
  3. Local `.sqlite` File Export & Import utility.

---

### 2. ARCHITECTURE & FOLDER STRUCTURE

Structure the project to enforce strict separation of concerns:

---

``` txt
├── src-tauri/                 # Tauri v2 Rust project configuration
├── src/
│   ├── lib/
│   │   ├── adapters/          # Interface implementations
│   │   │   ├── db/            # Database Abstraction (Tauri SQL vs SQLite WASM)
│   │   │   ├── llm/           # LLM Providers (Groq, DeepSeek)
│   │   │   ├── stt/           # STT (Transformers.js Whisper vs Groq Whisper API)
│   │   │   ├── tts/           # TTS (Piper WASM vs Web Speech API vs OpenAI TTS)
│   │   │   └── sync/          # BYOC Sync (Google Drive, WebDAV, Local Export)
│   │   ├── components/        # Svelte UI Components
│   │   ├── stores/            # Svelte State Management (Keys, User Settings, Session)
│   │   ├── workers/           # Web Workers for SQLite OPFS and Whisper WebGPU
│   │   └── utils/             # Helper tools and types
│   ├── routes/                # SvelteKit File-based routing (SPA mode)
│   └── prototype/
│       └── app.html           # Reference layout and UX prototype specs
├── svelte.config.js           # Configured with @sveltejs/adapter-static
├── vite.config.ts             # Configured with COOP/COEP headers & Node polyfills
└── LICENSE                    # AGPL-3.0
```

---

### 3. STEP-BY-STEP IMPLEMENTATION ROADMAP

#### Phase 1: Project Setup & Adapter Foundation
1. **Initialize Project**: Set up SvelteKit with Tailwind CSS and Tauri v2. Configure `@sveltejs/adapter-static` with static SPA mode.
2. **Vite Headers**: Ensure Vite server sets `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` headers to support SQLite WASM (OPFS) and WebGPU `SharedArrayBuffer`.
3. **Database Layer**:
   - Write `IDatabaseAdapter` TypeScript interface defining CRUD methods for prompts, recorded sessions, user settings, and cloud sync metadata.
   - Implement `TauriSqlAdapter` using `@tauri-apps/plugin-sql`.
   - Implement `OpfsSqliteAdapter` using `@sqlite.org/sqlite-wasm` inside a Web Worker.
   - Build a factory module `getDatabaseAdapter()` that detects `window.__TAURI_INTERNALS__` and returns the appropriate implementation.

#### Phase 2: Core Speech & AI Pipeline
1. **Microphone & Audio Capture**: Build an audio recording component using Web MediaRecorder API that outputs standard WAV/WebM blobs.
2. **STT Pipeline**:
   - Implement local STT worker running `@huggingface/transformers` Whisper model via WebGPU.
   - Implement Groq Whisper API adapter for fast cloud transcription when API key is present.
3. **LLM Evaluation Engine**:
   - Implement a generic OpenAI-compatible REST client handling Groq and DeepSeek API calls.
   - Craft a system prompt instructing the LLM to analyze the user's transcript for:
     * Grammar corrections
     * Vocabulary enhancement
     * Suggested connectors (*du coup*, *en fait*, *ce pendant*, etc.)
     * Re-written natural speech version
   - Enforce structured JSON outputs from the LLM.
4. **TTS Feedback**: Connect `piper-tts-web` to read corrected French output back to the user with natural voice synthesis.

#### Phase 3: BYOC Cloud Sync Engine
1. **Google Drive Sync**: Implement client-side OAuth 2.0 flow to upload/download `.sqlite` database files to a designated `appDataFolder` or root folder on Google Drive.
2. **WebDAV Sync**: Implement WebDAV client using the `webdav` npm module for custom URL/username/password configs.
3. **Local Backup**: Implement simple manual `.sqlite` export and import routines.

#### Phase 4: UI & UX Integration
1. Review `prototype/app.html` to align all visual components, color palettes, and component hierarchy with the provided prototype design.
2. Create key views:
   - **Practice Mode**: Prompt generation, 60-second timer, live microphone wave visualization, real-time transcription, and instant AI evaluation breakdown.
   - **History/Analytics Mode**: Review previous sessions, re-listen to audio, inspect grammar improvements over time.
   - **Settings Mode**: Input API keys (Groq, DeepSeek), select STT/TTS modes, and configure BYOC cloud sync parameters.

Use Tailwind CSS v4 + shadcn-svelte luma for the component library

---

### 4. KEY CONSTRAINTS & CODE QUALITY REQUIREMENTS

- **Zero Third-Party Hosting Dependencies**: Everything except external BYOK API endpoints must execute on the client device.
- **Strict Error Handling**: Gracefully handle missing microphone permissions, missing API keys, or WebGPU missing hardware support by providing clear fallback UI prompts.
- **Worker Isolation**: Do not block the UI thread during database syncs, audio conversion, or local model execution. Run all heavy workloads inside Web Workers.
- **Strict Type Safety**: Write strict TypeScript interfaces for database models, API payloads, and app configurations.

Begin by scaffolding the SvelteKit + Tauri v2 project structure and setting up the database abstraction layer (`IDatabaseAdapter`).

