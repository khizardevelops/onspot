// SPDX-License-Identifier: AGPL-3.0-or-later

/** Chooses the usage-monitor implementation for this page load. */

import { useCore } from '#lib/core-client/backend.js';
import {
	accountsLoading,
	accountsReadAt,
	refreshAccountUsage,
	usageClock,
	usageServices,
	usageWarnings
} from './monitor.js';
import {
	startCoreMonitor,
	coreAccountsLoading,
	coreAccountsReadAt,
	coreUsageClock,
	coreUsageServices,
	coreUsageWarnings,
	refreshAccountUsage as refreshCoreAccountUsage
} from './coreMonitor.js';

const core = useCore('usage');
if (core) startCoreMonitor();

export const usageServicesStore = core ? coreUsageServices : usageServices;
export const usageWarningsStore = core ? coreUsageWarnings : usageWarnings;
export const usageClockStore = core ? coreUsageClock : usageClock;
export const accountsReadAtStore = core ? coreAccountsReadAt : accountsReadAt;
export const accountsLoadingStore = core ? coreAccountsLoading : accountsLoading;
export const refreshAccountUsageFn = core ? refreshCoreAccountUsage : refreshAccountUsage;

export type { ModelUsage, ServiceUsage, UsageView } from './monitor.js';
