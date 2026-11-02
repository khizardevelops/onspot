// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The session a Practice screen shows. On the Practice page it is the
 * learner's own, the practice store; Settings → Text size's live preview
 * shows a sample session on the same screen. A sample session is not live:
 * the screen and the cards in it look and lay out the same, but nothing
 * records, plays, asks a provider or writes the database.
 *
 * `PracticeScreen` provides the session to everything below it, which reads
 * it with `practiceSession()` instead of importing the store.
 */
import { getContext, setContext } from 'svelte';
import type { Readable } from 'svelte/store';
import { practice, setActiveAttempt, type PracticeState } from './practice';

export interface PracticeSession {
	/** Its state: the takes, the take on top, the prompt, the phase… */
	state: Readable<PracticeState>;
	/** False for a sample session, which does no real work (see the module comment). */
	live: boolean;
	/** Puts a take on top (scrolling the stack to it does this). */
	setActiveAttempt(id: string): void;
}

/** The learner's own session: the practice store. */
export const LEARNER_SESSION: PracticeSession = { state: practice, live: true, setActiveAttempt };

const SESSION_KEY = Symbol('practice-session');

/** Makes `session` the one the component calling this, and everything below it, shows. */
export function providePracticeSession(session: PracticeSession): void {
	setContext(SESSION_KEY, session);
}

/** The session the screen shows (the learner's own outside a `PracticeScreen`). Call during component initialisation. */
export function practiceSession(): PracticeSession {
	return getContext<PracticeSession | undefined>(SESSION_KEY) ?? LEARNER_SESSION;
}
