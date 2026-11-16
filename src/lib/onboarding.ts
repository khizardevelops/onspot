// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The first-run setup guide. Its state is device-local, like the API keys:
 * finishing or skipping it stops the automatic redirect, and Settings can
 * always reopen the page by hand.
 */
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

function storedDecision(): string | null {
	try {
		return localStorage.getItem(STORAGE_KEY);
	} catch {
		return null;
	}
}

/** Reads and parses the stored status through the core. */
export async function onboardingStatusCore(): Promise<OnboardingStatus> {
	return (await onboardingDecisionCore(storedDecision())).status;
}

/** True until the guide has been finished or skipped. */
export async function shouldOfferOnboarding(): Promise<boolean> {
	return (await onboardingDecisionCore(storedDecision())).shouldOffer;
}
