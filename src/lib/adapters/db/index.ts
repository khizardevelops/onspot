// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Stored-record types, and the browser's SQLite engine that the core runs on
 * in the web build. Nothing here reads or writes records: every query is the
 * core's (see `types.ts`).
 */

export * from './types';
export { openBrowserDatabase, type BrowserDatabase } from './browserDatabase';
