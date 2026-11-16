// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The usage ledger lives in the core (`onspot-app::usage_ledger`), which
 * counts every LLM request itself. Cloud engines that still run in the driver
 * (Groq speech recognition, ElevenLabs and OpenAI-compatible speech) report
 * their calls here, so the usage monitor sees one record of the device.
 *
 * Only a hash of the key crosses the bridge (`keyIdOf`), never the key.
 */

import { hashText } from '#lib/utils/hash.js';
import { getCoreClient } from './client.js';

/** Calls made without a key (a local server) share one bucket. */
const NO_KEY = 'no-key';

/**
 * A short, non-reversible id for an API key, identical to the core's `key_id`.
 *
 * @param apiKey The key as entered; may be empty for a local server.
 * @returns A stable id for bookkeeping.
 */
export function keyIdOf(apiKey: string): string {
	const key = apiKey.trim();
	return key ? hashText(key) : NO_KEY;
}

/** The host part of a URL, as the ledger keys it. */
export function hostOf(url: string): string {
	try {
		return new URL(url).host;
	} catch {
		return url;
	}
}

/** One successful cloud call made by a driver-side engine. */
export interface CloudCall {
	/** The URL the call went to; only its host is kept. */
	url: string;
	apiKey: string;
	model: string;
	tokens?: number;
	reservedTokens?: number;
	audioSeconds?: number;
	characters?: number;
	/** The response headers, for the `x-ratelimit-*` budgets where readable. */
	headers?: Headers;
}

/** A refused cloud call (HTTP 413/429), for the limit its body may name. */
export interface CloudRefusal {
	url: string;
	apiKey: string;
	model: string;
	body: string;
}

/**
 * Records one successful cloud call in the core's ledger. Bookkeeping never
 * fails the call it describes, so a failure is only logged.
 */
export function recordCloudCall(call: CloudCall): void {
	const report = {
		host: hostOf(call.url),
		model: call.model,
		keyId: keyIdOf(call.apiKey),
		tokens: call.tokens ?? 0,
		reservedTokens: call.reservedTokens ?? 0,
		audioSeconds: call.audioSeconds ?? 0,
		characters: call.characters ?? 0,
		headers: call.headers ? Object.fromEntries(call.headers.entries()) : {}
	};
	void send('usage.record_call', { call: report });
}

/** Records the limit a refused cloud call names, if it names one. */
export function recordCloudRefusal(refusal: CloudRefusal): void {
	const report = {
		host: hostOf(refusal.url),
		model: refusal.model,
		keyId: keyIdOf(refusal.apiKey),
		body: refusal.body
	};
	void send('usage.record_refusal', { refusal: report });
}

async function send(command: string, payload: unknown): Promise<void> {
	try {
		const client = await getCoreClient();
		await client.command(command, payload);
	} catch (error) {
		console.warn('[usage] could not record a cloud call', error);
	}
}
