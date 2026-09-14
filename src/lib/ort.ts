/**
 * ONNX Runtime for the Piper TTS adapter.
 *
 * Deliberately does NOT register itself as `globalThis[Symbol.for('onnxruntime')]`.
 * Transformers.js will adopt a pre-registered runtime, but the branch that does
 * so never populates its internal `supportedDevices` list, so every model load
 * then fails with:
 *
 *   Unsupported device: "wasm". Should be one of: .
 *
 * Sharing one runtime would have been tidier; it simply does not work with
 * transformers.js v4. Piper therefore uses this instance and Transformers.js
 * keeps its own. Verified in-browser that both coexist in one page.
 */
import * as ort from 'onnxruntime-web';

export { ort };
