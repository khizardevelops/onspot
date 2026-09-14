/**
 * STT adapters and registry.
 *
 * The product's default is the local `whisper-small q4` card in the registry
 * (`whisper-small-fr-q4`). `GroqWhisperAdapter` is the BYOK cloud fallback.
 */
export * from './registry';
export { BaseSTTAdapter, type ISTTAdapter } from './BaseAdapter';
export { WhisperAdapter } from './WhisperAdapter';
export { WorkerWhisperAdapter } from './WorkerWhisperAdapter';
export { CustomHFAdapter } from './CustomHFAdapter';
export { GroqWhisperAdapter } from './GroqWhisperAdapter';
export * from './engine';
export * from './service';
