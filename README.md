# onspot

Learn to speak French **on the spot**.

onspot helps English speakers move from *knowing* French vocabulary and grammar to *speaking*
spontaneously. It gives you a prompt, records 30–60 seconds of spoken French, transcribes it,
analyses your mistakes with an LLM, and reads the corrected phrasing back to you.

Desktop-first, privacy-focused, and offline-capable: the local speech stack runs entirely on your
device. Cloud providers are optional and BYOK.

## Stack

- **SvelteKit** with `@sveltejs/adapter-static` — a pure client-side SPA.
- **Tauri v2** for the desktop app (Windows first, cross-platform ready).
- **Tailwind CSS v4** + **shadcn-svelte**.
- **Local speech**: `@huggingface/transformers` (`whisper-small` q4, WASM) for STT, Piper for TTS.
- **Database**: native SQLite on desktop (`@tauri-apps/plugin-sql`), `@sqlite.org/sqlite-wasm`
  over OPFS in a Web Worker on the web — behind one `IDatabaseAdapter`.
- **Cloud (BYOK)**: Groq / DeepSeek LLMs, Groq Whisper, OpenAI TTS.

## Getting started

```sh
npm install
# Restore the gitignored French G2P assets (18 MB):
mkdir -p static/piper-wasm
cp node_modules/@diffusionstudio/piper-wasm/build/piper_phonemize.{js,wasm,data} static/piper-wasm/

npm run dev        # web SPA at http://localhost:5173
npm run tauri dev  # desktop app
```

See `.agents/handoff/references/commands.md` for the full command and environment reference.

## Why these models

The speech models were chosen by measurement, in this repository, before the product was built.
The verdicts and their evidence are in [`docs/approved-tech.md`](./docs/approved-tech.md);
the methodology is in [`docs/plan.md`](./docs/plan.md).

## License

AGPL-3.0-or-later. See [`LICENSE`](./LICENSE).
