// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The first-run setup guide. Its state is device-local, like the API keys:
 * finishing or skipping it stops the automatic redirect, and Settings can
 * always reopen the page by hand.
 */
import { useCore } from '#lib/core-client/backend.js';
import { onboardingDecisionCore } from '#lib/core-client/onboarding.js';

export type OnboardingStatus = 'done' | 'skipped' | null;

const STORAGE_KEY = 'onspot.onboarding.v1';

/** Whether the guide has been finished or put off on this device. */
export function onboardingStatus(): OnboardingStatus {
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		return stored === 'done' || stored === 'skipped' ? stored : null;
	} catch {
		return null;
	}
}

function store(status: Exclude<OnboardingStatus, null>): void {
	try {
		localStorage.setItem(STORAGE_KEY, status);
	} catch {
		// The guide still works for this visit; it may reopen next launch.
	}
}

/** Records that the learner completed the guide. */
export function markOnboardingDone(): void {
	store('done');
}

/** Records that the learner chose to set things up later. */
export function markOnboardingSkipped(): void {
	store('skipped');
}

/** Reads and parses the stored status through the core when it is enabled. */
export async function onboardingStatusCore(): Promise<OnboardingStatus> {
	let stored: string | null = null;
	try {
		stored = localStorage.getItem(STORAGE_KEY);
	} catch {
		stored = null;
	}
	if (useCore('onboarding')) return (await onboardingDecisionCore(stored)).status;
	return onboardingStatus();
}

/** True until the guide has been finished or skipped. */
export async function shouldOfferOnboarding(): Promise<boolean> {
	if (useCore('onboarding')) {
		let stored: string | null = null;
		try {
			stored = localStorage.getItem(STORAGE_KEY);
		} catch {
			stored = null;
		}
		return (await onboardingDecisionCore(stored)).shouldOffer;
	}
	return onboardingStatus() === null;
}
