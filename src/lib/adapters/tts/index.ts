/**
 * TTS adapters. Local Piper voices are registered in `registry.ts`; the BYOK
 * cloud fallback is `OpenAITtsAdapter`.
 */
export * from './registry';
export { BaseTTSAdapter, type ITTSAdapter } from './BaseTTSAdapter';
export { PiperAdapter } from './PiperAdapter';
export { OpenAITtsAdapter } from './OpenAITtsAdapter';
export { pcmToWavUrl } from './roundTrip';
export * from './service';
