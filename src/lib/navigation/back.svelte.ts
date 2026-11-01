// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Going back, the same way from the header's Back button and Android's
 * system Back.
 *
 * Back first closes the topmost open thing (a sheet, a menu, a dialog, an
 * open Insights pattern: anything registered with `closeOnBack`), then
 * returns to the previous onspot page. With no onspot page behind this one
 * (the app opened here, a deep link, or a reload) it goes to Practice and
 * replaces this page, so Back on Practice then leaves the app rather than
 * coming back here.
 */
import { afterNavigate, goto } from '$app/navigation';
import { page } from '$app/state';
import { pageHref } from '#lib/pages.js';
import { closeOnBack, closeTopmost } from '#lib/platform/backButton.svelte.js';

/**
 * How many onspot pages are behind the current one in the history. The
 * browser does not say, so it is counted from navigations since the app
 * loaded; a reload starts again at 0.
 */
let pagesBehind = $state(0);
/** Set while going to Practice in place of this page, which adds no history entry. */
let replacingPage = false;

/** Whether the page showing is Practice, which has nothing to go back to. */
export function onPractice(): boolean {
	return page.url.pathname === pageHref('/');
}

/**
 * Counts the pages behind this one and, where there are none, makes Android
 * Back go to Practice instead of leaving the app. Call once, during the root
 * layout's initialisation.
 */
export function trackPageHistory(): void {
	afterNavigate((navigation) => {
		if (navigation.type === 'enter') {
			pagesBehind = 0;
		} else if (navigation.type === 'popstate') {
			pagesBehind = Math.max(0, pagesBehind + (navigation.delta ?? 0));
		} else if (replacingPage) {
			replacingPage = false;
		} else if (navigation.from?.url.href !== navigation.to?.url.href) {
			// A link to the page already showing replaces its entry instead.
			pagesBehind += 1;
		}
	});

	closeOnBack(() => !onPractice() && pagesBehind === 0, goToPractice);
}

/** What the header's Back button does: exactly what Android Back does. */
export function goBack(): void {
	if (closeTopmost()) return;
	history.back();
}

function goToPractice(): void {
	replacingPage = true;
	void goto(pageHref('/'), { replaceState: true });
}
