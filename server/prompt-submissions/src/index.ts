// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Shared prompt database ingest.
 *
 * Accepts a small batch of generated prompts from onspot while sharing is
 * enabled (on by default, opt-out in Settings), validates every field, and
 * stores each new prompt once (deduplicated by a hash of its content).
 * Nothing personal is collected: no IP address, account, device id or
 * transcript. The client sends `consent: true` only while sharing is enabled.
 */

/** The parts of D1 this Worker uses; kept local so the service has no build step. */
export interface D1RunResult {
	meta: { changes: number };
}

export interface D1PreparedStatement {
	bind(...values: unknown[]): D1PreparedStatement;
	run(): Promise<D1RunResult>;
}

export interface D1Database {
	prepare(query: string): D1PreparedStatement;
}

export interface Env {
	DB: D1Database;
}

const MAX_BATCH = 20;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_TITLE_CHARS = 80;
const MAX_TEXT_CHARS = 300;
const LEVELS = new Set(['A2', 'B1', 'B2', 'C1']);
const MODES = new Set(['exam', 'casual', 'freeflow']);
const LANGUAGE_CODE = /^[a-z]{2}$/;

const CORS_HEADERS: Record<string, string> = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type',
	'Access-Control-Max-Age': '86400'
};

interface IncomingPrompt {
	id?: unknown;
	title?: unknown;
	text?: unknown;
	instructionLanguage?: unknown;
	targetLanguage?: unknown;
	level?: unknown;
	mode?: unknown;
	createdAt?: unknown;
}

interface ValidPrompt {
	id: string;
	title: string;
	text: string;
	instructionLanguage: string;
	targetLanguage: string;
	level: string;
	mode: string;
	createdAt: string;
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		if (request.method === 'OPTIONS') {
			return new Response(null, { status: 204, headers: CORS_HEADERS });
		}
		if (request.method === 'GET' && url.pathname === '/health') {
			return json({ ok: true });
		}
		if (request.method !== 'POST') {
			return json({ error: 'Method not allowed.' }, 405);
		}

		const declaredLength = Number(request.headers.get('content-length') ?? 0);
		if (declaredLength > MAX_BODY_BYTES) {
			return json({ error: 'Batch too large.' }, 413);
		}

		let body: { consent?: unknown; prompts?: unknown };
		try {
			body = (await request.json()) as { consent?: unknown; prompts?: unknown };
		} catch {
			return json({ error: 'Invalid JSON.' }, 400);
		}

		if (body.consent !== true) {
			return json({ error: 'Contribution consent is required.' }, 422);
		}
		if (!Array.isArray(body.prompts) || body.prompts.length === 0) {
			return json({ error: 'No prompts supplied.' }, 400);
		}
		if (body.prompts.length > MAX_BATCH) {
			return json({ error: `At most ${MAX_BATCH} prompts per batch.` }, 413);
		}

		const valid: ValidPrompt[] = [];
		for (const raw of body.prompts) {
			try {
				valid.push(validatePrompt(raw));
			} catch (error) {
				return json(
					{ error: error instanceof Error ? error.message : 'Invalid prompt.' },
					422
				);
			}
		}

		let duplicates = 0;
		let accepted = 0;
		const receivedAt = new Date().toISOString();
		for (const prompt of valid) {
			const hash = await contentHash(prompt);
			const result = await env.DB.prepare(
				`INSERT INTO prompt_submissions
				 (id, content_hash, title, text, instruction_language, target_language, level, mode,
				  prompt_created_at, received_at, status)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
				 ON CONFLICT(content_hash) DO NOTHING`
			)
				.bind(
					crypto.randomUUID(),
					hash,
					prompt.title,
					prompt.text,
					prompt.instructionLanguage,
					prompt.targetLanguage,
					prompt.level,
					prompt.mode,
					prompt.createdAt,
					receivedAt
				)
				.run();

			if (result.meta.changes > 0) accepted += 1;
			else duplicates += 1;
		}

		return json({ accepted, duplicates });
	}
};

function validatePrompt(raw: unknown): ValidPrompt {
	const prompt = (raw ?? {}) as IncomingPrompt;
	const id = typeof prompt.id === 'string' ? prompt.id.trim() : '';
	const title = typeof prompt.title === 'string' ? prompt.title.trim() : '';
	const text = typeof prompt.text === 'string' ? prompt.text.trim() : '';
	const instructionLanguage = normalizeLanguage(prompt.instructionLanguage);
	const targetLanguage = normalizeLanguage(prompt.targetLanguage);
	const level = typeof prompt.level === 'string' ? prompt.level : '';
	const mode = typeof prompt.mode === 'string' ? prompt.mode : '';
	const createdAt =
		typeof prompt.createdAt === 'string' && Number.isFinite(Date.parse(prompt.createdAt))
			? new Date(prompt.createdAt).toISOString()
			: null;

	if (!id || id.length > 100) throw new Error('Each prompt needs an id.');
	if (!title || title.length > MAX_TITLE_CHARS) throw new Error('Prompt title is empty or too long.');
	if (!text || text.length > MAX_TEXT_CHARS) throw new Error('Prompt text is empty or too long.');
	if (!instructionLanguage || !targetLanguage) throw new Error('Each prompt needs both languages.');
	if (!LEVELS.has(level)) throw new Error('Unknown level.');
	if (!MODES.has(mode)) throw new Error('Unknown mode.');
	if (!createdAt) throw new Error('Prompt creation time is invalid.');

	return { id, title, text, instructionLanguage, targetLanguage, level, mode, createdAt };
}

function normalizeLanguage(value: unknown): string | null {
	const code = typeof value === 'string' ? value.trim().toLowerCase() : '';
	return LANGUAGE_CODE.test(code) ? code : null;
}

/** A stable fingerprint of what the prompt says, independent of when it was generated. */
async function contentHash(prompt: ValidPrompt): Promise<string> {
	const bytes = new TextEncoder().encode(
		[prompt.instructionLanguage, prompt.targetLanguage, prompt.title, prompt.text].join('\n')
	);
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function json(body: unknown, status = 200): Response {
	return Response.json(body, { status, headers: CORS_HEADERS });
}
