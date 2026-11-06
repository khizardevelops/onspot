// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The first-run setup guide. Its state is device-local, like the API keys:
 * finishing or skipping it stops the automatic redirect, and Settings can
 * always reopen the page by hand.
 */
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

/** True until the guide has been finished or skipped. */
export function shouldOfferOnboarding(): boolean {
	return onboardingStatus() === null;
}
