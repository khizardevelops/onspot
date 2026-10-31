// SPDX-License-Identifier: AGPL-3.0-or-later

import { fetchWithTimeout } from '#lib/adapters/llm/client.js';
import { fetchElevenLabsSubscription } from './elevenLabsAccount';

const VOICES_URL = 'https://api.elevenlabs.io/v2/voices?page_size=100';
const REQUEST_TIMEOUT_MS = 20_000;

/** The plan name ElevenLabs reports for accounts without a subscription. */
const FREE_TIER = 'free';

/**
 * Premade voice used until the learner picks one. Premade voices are served to
 * every account on every plan; "Alice – Clear, Engaging Educator" suits a coach.
 */
export const DEFAULT_ELEVENLABS_VOICE_ID = 'Xb7hH8MSUJpSbSDYk0k2';
export const DEFAULT_ELEVENLABS_VOICE_NAME = 'Alice';

/**
 * The previous default, once the premade "Rachel". ElevenLabs moved it to the
 * Voice Library, where the id now names a different voice that the free plan
 * cannot use through the API (HTTP 402 `paid_plan_required`; checked
 * 2026-10-30). A stored copy of it is replaced with the current default.
 */
export const RETIRED_DEFAULT_ELEVENLABS_VOICE_ID = '21m00Tcm4TlvDq8ikWAM';

export interface ElevenLabsVoice {
	id: string;
	name: string;
	description: string;
	/** Added from the Voice Library; the API serves these on paid plans only. */
	fromLibrary: boolean;
}

/**
 * Whether this key may speak with Voice Library voices:
 *   allowed    the plan is known to be paid
 *   free-plan  the plan is known to be free
 *   refused    ElevenLabs already refused a library voice for this key (HTTP 402)
 *   unknown    the key cannot read its plan (restricted to text-to-speech)
 */
export type LibraryAccess = 'allowed' | 'free-plan' | 'refused' | 'unknown';

export interface ElevenLabsVoiceList {
	/** Voices this key can speak with. */
	voices: ElevenLabsVoice[];
	/** Voice Library voices left out because the key may not be able to use them. */
	hiddenLibraryVoices: number;
	libraryAccess: LibraryAccess;
}

export interface ListVoicesOptions {
	/** ElevenLabs has refused a library voice for this key before. */
	libraryRefused?: boolean;
}

interface VoicesResponse {
	voices?: Array<{
		voice_id?: string;
		name?: string;
		description?: string;
		labels?: Record<string, string>;
		/** Present on voices added from the Voice Library (`status: "copied"`). */
		sharing?: { status?: string; original_voice_id?: string } | null;
	}>;
}

async function fetchAccountVoices(key: string): Promise<ElevenLabsVoice[]> {
	const response = await fetchWithTimeout(
		VOICES_URL,
		{ headers: { 'xi-api-key': key } },
		{ timeoutMs: REQUEST_TIMEOUT_MS }
	);

	if (!response.ok) {
		const detail = await response.text().catch(() => '');
		throw new Error(
			`ElevenLabs voices failed (HTTP ${response.status})${detail ? `: ${detail.slice(0, 300)}` : ''}`
		);
	}

	const data = (await response.json()) as VoicesResponse;
	const namedVoices = (data.voices ?? []).filter((voice) => voice.voice_id && voice.name);

	return namedVoices.map((voice) => {
		const fromLibrary = voice.sharing?.status === 'copied' || Boolean(voice.sharing?.original_voice_id);
		const details = [
			voice.labels?.language,
			voice.labels?.accent,
			voice.labels?.gender,
			voice.labels?.age,
			voice.labels?.use_case,
			voice.description
		];

		return {
			id: voice.voice_id as string,
			name: voice.name as string,
			description: details.filter(Boolean).join(' · '),
			fromLibrary
		};
	});
}

/**
 * The account's plan name, or null when the key may not read it (a key
 * restricted to text-to-speech is refused `user_read`).
 */
async function fetchPlanTier(key: string): Promise<string | null> {
	try {
		const subscription = await fetchElevenLabsSubscription(key);
		return subscription.tier;
	} catch (error) {
		console.warn('[tts] could not read the ElevenLabs plan', error);
		return null;
	}
}

function libraryAccessOf(tier: string | null, libraryRefused: boolean): LibraryAccess {
	if (libraryRefused) return 'refused';
	if (tier === null) return 'unknown';
	return tier === FREE_TIER ? 'free-plan' : 'allowed';
}

/**
 * Lists the ElevenLabs voices this key can speak with, for the Settings voice
 * picker.
 *
 * The free plan cannot use Voice Library voices through the API (HTTP 402),
 * and the voice list does not say which plan a voice needs
 * (`available_for_tiers` comes back empty). So the plan is read separately,
 * and library voices are listed only when it is known to be paid: a key that
 * cannot read its plan, or that ElevenLabs already refused, gets premade and
 * owned voices only. Showing a voice that then fails is worse than hiding one.
 *
 * @param apiKey The learner's ElevenLabs key.
 * @param options What is already known about this key.
 * @returns The usable voices with whatever accent/language labels the account
 *   exposes, how many library voices were hidden, and why.
 */
export async function listElevenLabsVoices(
	apiKey: string,
	options: ListVoicesOptions = {}
): Promise<ElevenLabsVoiceList> {
	const key = apiKey.trim();
	if (!key) throw new Error('Add an ElevenLabs API key first.');

	const [accountVoices, tier] = await Promise.all([fetchAccountVoices(key), fetchPlanTier(key)]);
	const libraryAccess = libraryAccessOf(tier, options.libraryRefused ?? false);

	const voices =
		libraryAccess === 'allowed' ? accountVoices : accountVoices.filter((voice) => !voice.fromLibrary);
	return { voices, hiddenLibraryVoices: accountVoices.length - voices.length, libraryAccess };
}
