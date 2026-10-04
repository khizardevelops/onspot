import type { LocalSttEngine } from './LocalSttEngine';
import { transformersEngine } from './transformers/transformersEngine';

/**
 * The on-device STT engine for this build. This is the only place that
 * decides; the native whisper.cpp engine for the desktop and Android apps
 * will be chosen here by runtime.
 */
export function localSttEngine(): LocalSttEngine {
	return transformersEngine;
}
