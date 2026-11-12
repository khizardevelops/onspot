// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Typed access to the `practice.*` command catalog (P3).
 *
 * The practice store is the only caller; components keep their existing API.
 */

import type {
	AcceptedResponse,
	ChangedResponse,
	OpenResponse,
	PracticeConfig,
	PracticeResponse,
	PracticeSnapshot,
	PromptView,
	ResumeResponse
} from './types.gen';
import type { CoreClient } from './transport.js';

export interface PracticeApi {
	configure(config: PracticeConfig): Promise<PracticeResponse>;
	snapshot(): Promise<PracticeResponse>;
	newSession(): Promise<PracticeResponse>;
	setPrompt(prompt: PromptView): Promise<PracticeResponse>;
	nextPrompt(candidates: PromptView[], englishFallback: boolean): Promise<PracticeResponse>;
	startRecording(): Promise<PracticeResponse>;
	stopAndAnalyze(): Promise<PracticeResponse>;
	cancelRecording(): Promise<PracticeResponse>;
	tick(): Promise<PracticeResponse>;
	setActiveAttempt(attemptId: string | null): Promise<PracticeResponse>;
	clearError(): Promise<PracticeResponse>;
	resumeLastSession(): Promise<ResumeResponse>;
	openSession(sessionId: string): Promise<OpenResponse>;
	renameSession(sessionId: string, title: string): Promise<ChangedResponse>;
	deleteSession(sessionId: string): Promise<ChangedResponse>;
	speakTrack(attemptId: string, kind: string): Promise<AcceptedResponse>;
	playSegment(attemptId: string, text: string, index: number): Promise<AcceptedResponse>;
	speakText(text: string): Promise<AcceptedResponse>;
	playRecording(attemptId: string): Promise<AcceptedResponse>;
	setAttemptVoice(attemptId: string, voice: string): Promise<PracticeResponse>;
}

/** Shape of one `practice_state_changed` snapshot te the store receives. */
export type { PracticeSnapshot };

/**
 * Wraps a bridge client in the practice command names.
 *
 * @param client The shared core client, already initialised.
 */
export function practiceApi(client: CoreClient): PracticeApi {
	const command = <T>(name: string, payload?: unknown) =>
		client.command<T>(`practice.${name}`, payload);

	return {
		configure: (config) => command<PracticeResponse>('configure', { config }),
		snapshot: () => command<PracticeResponse>('snapshot'),
		newSession: () => command<PracticeResponse>('new_session'),
		setPrompt: (prompt) => command<PracticeResponse>('set_prompt', { prompt }),
		nextPrompt: (candidates, englishFallback) =>
			command<PracticeResponse>('next_prompt', { candidates, englishFallback }),
		startRecording: () => command<PracticeResponse>('start_recording'),
		stopAndAnalyze: () => command<PracticeResponse>('stop_and_analyze'),
		cancelRecording: () => command<PracticeResponse>('cancel_recording'),
		tick: () => command<PracticeResponse>('tick'),
		setActiveAttempt: (attemptId) =>
			command<PracticeResponse>('set_active_attempt', { attemptId }),
		clearError: () => command<PracticeResponse>('clear_error'),
		resumeLastSession: () => command<ResumeResponse>('resume_last_session'),
		openSession: (sessionId) => command<OpenResponse>('open_session', { sessionId }),
		renameSession: (sessionId, title) =>
			command<ChangedResponse>('rename_session', { sessionId, title }),
		deleteSession: (sessionId) => command<ChangedResponse>('delete_session', { sessionId }),
		speakTrack: (attemptId, kind) => command<AcceptedResponse>('speak_track', { attemptId, kind }),
		playSegment: (attemptId, text, index) =>
			command<AcceptedResponse>('play_segment', { attemptId, text, index }),
		speakText: (text) => command<AcceptedResponse>('speak_text', { text }),
		playRecording: (attemptId) =>
			command<AcceptedResponse>('play_recording', { attemptId }),
		setAttemptVoice: (attemptId, voice) =>
			command<PracticeResponse>('set_attempt_voice', { attemptId, voice })
	};
}
