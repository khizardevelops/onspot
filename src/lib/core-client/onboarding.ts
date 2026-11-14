// SPDX-License-Identifier: AGPL-3.0-or-later

/** First-run guide decision through the Rust core (P7). */

import { getCoreClient } from './client.js';

export interface OnboardingDecision {
	status: 'done' | 'skipped' | null;
	shouldOffer: boolean;
}

/**
 * Asks the core whether the setup guide should open for a stored value.
 *
 * @param stored The device's `onspot.onboarding.v1` value, if any.
 * @returns The parsed status and the redirect decision.
 */
export async function onboardingDecisionCore(stored: string | null): Promise<OnboardingDecision> {
	const client = await getCoreClient();
	return client.command<OnboardingDecision>('onboarding.decide', { stored });
}
