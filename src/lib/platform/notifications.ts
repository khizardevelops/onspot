// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * System notifications, when the runtime has them and the learner allowed
 * them. The apps are often open while the learner is busy elsewhere, so a
 * reminder or a finished download can reach them without a service worker.
 * Every call is best-effort: an unsupported webview (Android's, some Linux
 * builds) simply gets the app's own in-page notice instead.
 */
import { isAppleTouchDevice } from './pwa.js';

/** True when the runtime has a notification path onspot can actually use. */
export function notificationsSupported(): boolean {
	// An iOS home-screen app only receives system notifications through Web
	// Push, which needs a server onspot does not have. Do not promise the
	// system part in Settings; the in-app banner is the honest signal there.
	if (isAppleTouchDevice()) return false;

	return typeof globalThis.Notification !== 'undefined';
}

/** The current permission, or 'unsupported' where there is no Notification API. */
export function notificationPermission(): NotificationPermission | 'unsupported' {
	if (!notificationsSupported()) return 'unsupported';
	return Notification.permission;
}

/**
 * Asks for notification permission. Call it inside a user gesture (a switch
 * the learner just tapped); browsers ignore requests outside one.
 *
 * @returns The permission afterwards, or 'unsupported'.
 */
export async function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
	if (!notificationsSupported()) return 'unsupported';
	if (Notification.permission !== 'default') return Notification.permission;

	try {
		return await Notification.requestPermission();
	} catch {
		// Older webviews reject instead of returning 'denied'.
		return Notification.permission;
	}
}

/**
 * Shows a system notification when the learner has allowed them. Never asks
 * for permission and never throws: a message that cannot be shown is not worth
 * interrupting the work that produced it.
 *
 * @param title First line, kept short.
 * @param body The detail under it.
 * @returns True when a notification was shown.
 */
export function notify(title: string, body: string): boolean {
	if (notificationPermission() !== 'granted') return false;

	try {
		new Notification(title, { body });
		return true;
	} catch {
		// Some webviews expose the API but cannot construct a notification.
		return false;
	}
}
