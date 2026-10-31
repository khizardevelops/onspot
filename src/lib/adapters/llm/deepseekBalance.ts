// SPDX-License-Identifier: AGPL-3.0-or-later

import { fetchWithTimeout } from './client';

/**
 * DeepSeek bills per token from a prepaid balance and does not rate-limit, so
 * the balance is the whole story: `GET /user/balance`, per account.
 */
const BALANCE_URL = 'https://api.deepseek.com/user/balance';
const REQUEST_TIMEOUT_MS = 20_000;

export interface DeepSeekBalance {
	currency: string;
	/** Everything spendable: granted plus topped up. */
	total: number;
	/** Promotional credit, spent first. */
	granted: number;
	toppedUp: number;
}

export interface DeepSeekAccount {
	/** False when the balance cannot pay for another call. */
	isAvailable: boolean;
	balances: DeepSeekBalance[];
}

interface BalanceResponse {
	is_available?: unknown;
	balance_infos?: Array<{
		currency?: unknown;
		total_balance?: unknown;
		granted_balance?: unknown;
		topped_up_balance?: unknown;
	}>;
}

/** DeepSeek sends amounts as decimal strings ("110.00"). */
function amount(value: unknown): number {
	const parsed = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Reads the DeepSeek account balance.
 *
 * @param apiKey The learner's DeepSeek key.
 * @returns Whether the account can pay for calls, and the balance per currency.
 * @throws With a readable message when the key is refused or the request fails.
 */
export async function fetchDeepSeekBalance(apiKey: string): Promise<DeepSeekAccount> {
	const key = apiKey.trim();
	if (!key) throw new Error('Add a DeepSeek API key first.');

	const response = await fetchWithTimeout(
		BALANCE_URL,
		{ headers: { Authorization: `Bearer ${key}` } },
		{ timeoutMs: REQUEST_TIMEOUT_MS }
	);
	if (response.status === 401) throw new Error('DeepSeek refused the API key.');
	if (!response.ok) throw new Error(`DeepSeek balance could not be read (HTTP ${response.status}).`);

	const data = (await response.json()) as BalanceResponse;
	const balances = (data.balance_infos ?? []).map((info) => ({
		currency: typeof info.currency === 'string' ? info.currency : '',
		total: amount(info.total_balance),
		granted: amount(info.granted_balance),
		toppedUp: amount(info.topped_up_balance)
	}));

	return { isAvailable: data.is_available === true, balances };
}
