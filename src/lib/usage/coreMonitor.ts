// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The usage monitor through the Rust core (P6). Keys and account probes stay in
 * the driver; the bridge receives resolved settings, meter data and account
 * readings, never credentials.
 */

import { derived, get, readable, writable } from 'svelte/store';
import { appSettings, settingsReady } from '#lib/stores/settings.js';
import { deepseekApiKey, elevenLabsApiKey, groqApiKey, openaiApiKey } from '#lib/stores/secrets.js';
import { resolveLlmEndpoint } from '#lib/stores/llm.js';
import { ttsApiOptions } from '#lib/stores/ttsConfig.js';
import { isTauri } from '#lib/platform/runtime.js';
import { getModelOptions } from '#lib/adapters/llm/index.js';
import { fetchElevenLabsSubscription } from '#lib/speech/tts/cloud/elevenLabsAccount.js';
import { fetchDeepSeekBalance } from '#lib/adapters/llm/deepseekBalance.js';
import { getCoreClient } from '#lib/core-client/client.js';
import { keyIdOf, usageLedger } from './ledger.js';
import type { ServiceUsage, UsageWarning } from './types.js';

interface AccountReading<T> {
	keyId: string;
	data: T | null;
	error: string | null;
	loading: boolean;
	fetchedAt: number | null;
}

const ACCOUNT_REFRESH_AFTER_MS = 5 * 60_000;

let elevenlabs: AccountReading<Awaited<ReturnType<typeof fetchElevenLabsSubscription>>> | null = null;
let deepseek: AccountReading<Awaited<ReturnType<typeof fetchDeepSeekBalance>>> | null = null;
let accountKeySignature = '';
let loadingCount = 0;

const services = writable<ServiceUsage[]>([]);
const readAt = writable<number | null>(null);
const loading = writable(false);

function hostOf(url: string): string {
	try {
		return new URL(url).host;
	} catch {
		return url;
	}
}

async function readAccount<T>(
	apiKey: string,
	current: AccountReading<T> | null,
	fetcher: (key: string) => Promise<T>,
	force: boolean,
	assign: (reading: AccountReading<T>) => void
): Promise<void> {
	const keyId = keyIdOf(apiKey);
	const now = Date.now();
	if (!force && current?.keyId === keyId && !current.loading && current.fetchedAt !== null && now - current.fetchedAt < ACCOUNT_REFRESH_AFTER_MS) return;
	const kept = current?.keyId === keyId ? current.data : null;
	assign({ keyId, data: kept, error: null, loading: true, fetchedAt: current?.fetchedAt ?? null });
	loadingCount += 1;
	loading.set(true);
	try {
		assign({ keyId, data: await fetcher(apiKey), error: null, loading: false, fetchedAt: Date.now() });
	} catch (error) {
		assign({ keyId, data: kept, error: error instanceof Error ? error.message : String(error), loading: false, fetchedAt: Date.now() });
	} finally {
		loadingCount -= 1;
		loading.set(loadingCount > 0);
		await recompute();
	}
}

/** Re-reads the account APIs in use. */
export async function refreshAccountUsage(force = false): Promise<void> {
	const settings = get(appSettings);
	if (!get(settingsReady)) return;
	const elevenKey = get(elevenLabsApiKey).trim();
	const deepKey = get(deepseekApiKey).trim();
	const reads: Promise<void>[] = [];
	if (settings.ttsMode === 'cloud' && settings.ttsCloudProvider === 'elevenlabs' && elevenKey) {
		reads.push(readAccount(elevenKey, elevenlabs, fetchElevenLabsSubscription, force, (reading) => (elevenlabs = reading)));
	}
	if (settings.correctionMode === 'cloud' && settings.llmProvider === 'deepseek' && deepKey) {
		reads.push(readAccount(deepKey, deepseek, fetchDeepSeekBalance, force, (reading) => (deepseek = reading)));
	}
	await Promise.all(reads);
}

async function recompute(): Promise<void> {
	const settings = get(appSettings);
	if (!get(settingsReady)) return;
	const ready = get(settingsReady);
	const endpoint = resolveLlmEndpoint(settings);
	const tts = ttsApiOptions(settings);
	const groqKey = get(groqApiKey).trim();
	const labels = Object.fromEntries(getModelOptions('groq').map((option) => [option.id, option.label]));
	const input = {
		sttMode: settings.sttMode,
		correctionMode: settings.correctionMode,
		llmProvider: settings.llmProvider,
		llmHost: hostOf(endpoint.baseUrl),
		llmModel: endpoint.model,
		llmFallbackModels: [...(endpoint.fallbackModels ?? [])],
		llmKeyId: keyIdOf(endpoint.apiKey),
		ttsMode: settings.ttsMode,
		ttsCloudProvider: settings.ttsCloudProvider,
		ttsHost: hostOf(tts.apiBaseUrl),
		ttsModel: tts.apiModel,
		ttsKeyId: keyIdOf(tts.apiKey ?? ''),
		groqKeyId: keyIdOf(groqKey),
		deepseekKeyId: keyIdOf(get(deepseekApiKey)),
		elevenlabsKeyId: keyIdOf(get(elevenLabsApiKey)),
		isTauri: isTauri(),
		now: Date.now(),
		ledger: get(usageLedger),
		elevenlabs: ready ? elevenlabs : null,
		deepseek: ready ? deepseek : null,
		groqModels: getModelOptions('groq').map((option) => option.id),
		labels
	};

	try {
		const client = await getCoreClient();
		const snapshot = await client.command<{ services: ServiceUsage[]; warnings: UsageWarning[]; accountsReadAt: number | null }>('usage.snapshot', { input });
		services.set(snapshot.services);
		readAt.set(snapshot.accountsReadAt);
	} catch {
		// Keep the last readable snapshot; the Settings page also shows the core error.
	}
}

const clock = readable(Date.now(), (set) => {
	const timer = setInterval(() => set(Date.now()), 15_000);
	return () => clearInterval(timer);
});

/** Starts the core-backed monitor; only called when the usage feature is on. */
export function startCoreMonitor(): void {
	let signature = '';
	derived(
		[settingsReady, appSettings, groqApiKey, deepseekApiKey, elevenLabsApiKey, openaiApiKey, usageLedger, clock],
		(values) => values
	).subscribe(([ready, settings, groqKey, deepKey, elevenKey, openaiKey]) => {
		const next = `${ready}|${keyIdOf(groqKey)}|${keyIdOf(deepKey)}|${keyIdOf(elevenKey)}|${keyIdOf(openaiKey)}|${settings.ttsCloudProvider}|${settings.llmProvider}`;
		const keysChanged = next !== signature;
		signature = next;
		if (keysChanged && accountKeySignature !== `${keyIdOf(elevenKey)}|${keyIdOf(deepKey)}`) {
			accountKeySignature = `${keyIdOf(elevenKey)}|${keyIdOf(deepKey)}`;
			void refreshAccountUsage();
		}
		void recompute();
	});
}

/** Usage of every step in the current setup. */
export const coreUsageServices = services;

/** Usage problems worth telling the learner before the next take. */
export const coreUsageWarnings = derived(services, (list) =>
	list.flatMap((service) => service.warnings).sort((first, second) => (first.level === second.level ? 0 : first.level === 'error' ? -1 : 1))
);

/** The current time, re-read so rolling windows age. */
export const coreUsageClock = clock;

/** When the account APIs were last read. */
export const coreAccountsReadAt = readAt;

/** True while an account API is being read. */
export const coreAccountsLoading = loading;
