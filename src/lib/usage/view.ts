// SPDX-License-Identifier: AGPL-3.0-or-later

/** The usage monitor runs through the Rust core; the host keeps account probes. */

import {
	coreAccountsLoading,
	coreAccountsReadAt,
	coreUsageClock,
	coreUsageServices,
	coreUsageWarnings,
	refreshAccountUsage,
	startCoreMonitor
} from './coreMonitor.js';

startCoreMonitor();

export const usageServicesStore = coreUsageServices;
export const usageWarningsStore = coreUsageWarnings;
export const usageClockStore = coreUsageClock;
export const accountsReadAtStore = coreAccountsReadAt;
export const accountsLoadingStore = coreAccountsLoading;
export const refreshAccountUsageFn = refreshAccountUsage;

export type { ModelUsage, ServiceUsage, UsageView } from './types.js';
