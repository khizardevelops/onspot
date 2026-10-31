// SPDX-License-Identifier: AGPL-3.0-or-later

/** How usage numbers read on screen. Everything goes through `Intl`, so it follows the learner's locale. */

export type UsageUnit = 'requests' | 'tokens' | 'seconds' | 'characters';

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3_600;

const integer = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const calendarDay = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });

const UNIT_NAMES: Record<Exclude<UsageUnit, 'seconds'>, [singular: string, plural: string]> = {
	requests: ['request', 'requests'],
	tokens: ['token', 'tokens'],
	characters: ['character', 'characters']
};

/**
 * A whole number with grouping, e.g. 196 400.
 *
 * @param value Any number; rounded down.
 */
export function formatCount(value: number): string {
	return integer.format(Math.floor(value));
}

/**
 * A short count for tight spaces, e.g. 196K.
 *
 * @param value Any number.
 */
export function formatCompact(value: number): string {
	return compact.format(value);
}

/**
 * A duration in hours and minutes, e.g. "7 h 58 min" or "45 s".
 *
 * @param seconds Length in seconds.
 */
export function formatDuration(seconds: number): string {
	const whole = Math.max(0, Math.floor(seconds));
	if (whole < SECONDS_PER_MINUTE) return `${whole} s`;

	const hours = Math.floor(whole / SECONDS_PER_HOUR);
	const minutes = Math.floor((whole % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
	if (hours === 0) return `${minutes} min`;
	return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}

/**
 * A quantity with its unit, e.g. "8,000 tokens" or "2 h 0 min" for seconds.
 *
 * @param value The amount.
 * @param unit What it counts.
 */
export function formatQuantity(value: number, unit: UsageUnit): string {
	if (unit === 'seconds') return formatDuration(value);

	const [singular, plural] = UNIT_NAMES[unit];
	const rounded = Math.floor(value);
	return `${formatCount(rounded)} ${rounded === 1 ? singular : plural}`;
}

/**
 * A part of a whole, split so the part can be emphasised: "196,400" and
 * "of 200,000 tokens", or "7 h 58 min" and "of 8 h" for audio.
 *
 * @param part The amount to emphasise, e.g. what is left.
 * @param whole The limit.
 * @param unit What both count.
 */
export function formatPortion(part: number, whole: number, unit: UsageUnit): { part: string; ofWhole: string } {
	if (unit === 'seconds') return { part: formatDuration(part), ofWhole: `of ${formatDuration(whole)}` };

	const [, plural] = UNIT_NAMES[unit];
	return { part: formatCount(part), ofWhole: `of ${formatCount(whole)} ${plural}` };
}

/**
 * How long ago something happened, e.g. "2 minutes ago" or "just now".
 *
 * @param timestamp When it happened (ms since epoch).
 * @param now The current time (ms since epoch).
 */
export function formatAgo(timestamp: number, now: number): string {
	const seconds = Math.round((timestamp - now) / 1_000);
	if (Math.abs(seconds) < SECONDS_PER_MINUTE) return 'just now';

	const minutes = Math.round(seconds / SECONDS_PER_MINUTE);
	if (Math.abs(minutes) < 60) return relative.format(minutes, 'minute');

	return relative.format(Math.round(minutes / 60), 'hour');
}

/**
 * When a limit starts over: a relative time within a day, a date beyond it.
 *
 * @param timestamp The reset time (ms since epoch).
 * @param now The current time (ms since epoch).
 */
export function formatReset(timestamp: number, now: number): string {
	const untilReset = timestamp - now;
	if (untilReset <= 0) return 'now';
	if (untilReset < 24 * SECONDS_PER_HOUR * 1_000) return `in ${formatDuration(untilReset / 1_000)}`;
	return `on ${calendarDay.format(timestamp)}`;
}
