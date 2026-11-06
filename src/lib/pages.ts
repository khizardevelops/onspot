// SPDX-License-Identifier: AGPL-3.0-or-later

import { resolve } from '$app/paths';

/**
 * The app's pages (`/settings/text-size` is Text size's live preview, opened
 * from Settings; `/welcome` is the setup guide).
 */
export type Page = '/' | '/history' | '/insights' | '/settings' | '/settings/text-size' | '/welcome';

/**
 * A page's URL: under the app's base path (e.g. `/onspot` on GitHub Pages),
 * with the trailing slash its routes use (`trailingSlash: 'always'`), so a
 * link never takes a redirect and matches `page.url.pathname` exactly.
 */
export function pageHref(page: Page): string {
	return page === '/' ? resolve('/') : `${resolve(page)}/`;
}
