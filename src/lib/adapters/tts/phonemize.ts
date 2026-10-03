/**
 * French grapheme-to-phoneme via piper_phonemize (eSpeak NG compiled to WASM).
 *
 * The obvious choice, `phonemizer`, ships an English-only eSpeak build:
 *
 *   Invalid language identifier: "fr". Should be one of: en, en-029, en-gb, ...
 *
 * That single limitation is why Kokoro is English-only in the browser, and it
 * blocked Piper too. `@diffusionstudio/piper-wasm` carries the full
 * espeak-ng-data (18MB, every language), so it is the only French G2P that
 * works client-side here.
 *
 * It returns `phoneme_ids` already mapped through the voice's vocabulary, so
 * the `phoneme_id_map` in each Piper config does not need to be applied by hand.
 */
const WASM_BASE = '/piper-wasm/';

type PiperFactory = (options: {
  print: (line: string) => void;
  printErr: (message: string) => void;
  locateFile: (url: string) => string;
}) => Promise<{ callMain(args: string[]): number }>;

let modulePromise: Promise<PiperFactory> | null = null;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const el = document.createElement('script');
    el.src = src;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(el);
  });
}

async function getFactory(): Promise<PiperFactory> {
  if (!modulePromise) {
    if (typeof document === 'undefined') {
      // In the local-TTS worker, let Vite wrap the package's CommonJS export.
      // This keeps both eSpeak and ONNX inference off the UI thread.
      modulePromise = import('@diffusionstudio/piper-wasm').then(
        (module) => module.default as PiperFactory
      );
    } else {
      modulePromise = loadScript(WASM_BASE + 'piper_phonemize.js').then(
        () => (window as unknown as { createPiperPhonemize: PiperFactory }).createPiperPhonemize
      );
    }
  }
  return modulePromise;
}

/**
 * Converts text to Piper phoneme ids for a given eSpeak voice (e.g. 'fr').
 *
 * A fresh module instance per call: piper_phonemize is a one-shot CLI program,
 * and `callMain` cannot be invoked twice on the same instance.
 */
export async function phonemize(text: string, espeakVoice: string): Promise<number[]> {
  const createPiperPhonemize = await getFactory();

  return new Promise<number[]>((resolve, reject) => {
    let settled = false;
    createPiperPhonemize({
      print: (line: string) => {
        if (settled) return;
        try {
          settled = true;
          resolve(JSON.parse(line).phoneme_ids);
        } catch (err) {
          reject(new Error(`Unexpected phonemizer output: ${line.slice(0, 120)}`));
        }
      },
      printErr: (message: string) => {
        if (!settled) { settled = true; reject(new Error(message)); }
      },
      locateFile: (url: string) => WASM_BASE + url.split('/').pop(),
    })
      .then((mod: any) => {
        // The input is a JSON *array* of segments; a bare object aborts the
        // module with an opaque emscripten exception pointer.
        mod.callMain([
          '-l', espeakVoice,
          '--input', JSON.stringify([{ text: text.trim() }]),
          '--espeak_data', '/espeak-ng-data',
        ]);
        // `print` runs synchronously inside callMain. If the program exited
        // without printing (or printing only to a swallowed stream), settle now:
        // the TTS worker serializes requests, so a promise left pending here
        // would wedge every later read-back until reload.
        if (!settled) {
          settled = true;
          reject(new Error('The phonemizer produced no output.'));
        }
      })
      .catch(reject);
  });
}
