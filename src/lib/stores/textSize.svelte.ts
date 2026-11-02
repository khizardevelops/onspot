// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * How large each part of the practice page reads, set in Settings → Learning
 * → Text size, separately for each state the page has:
 *
 * - **Device**: the page has three layouts (phone up to 640 px, tablet up to
 *   1023 px, desktop), so a phone and a desktop window each keep their own
 *   sizes, and a resized window switches live.
 * - **Take length**: a take's own text fits itself to the take, large for a
 *   sentence and down to a 15 px floor for minutes of speech (see
 *   `AttemptCard`). A take at that floor is a *long take*; any other is a
 *   *short take*. The take's own parts (what you said, the correct version,
 *   the explanation, the follow-up, the translation and its words) keep a
 *   size for each. The prompt and the Feedback cards are not part of a take,
 *   so they have one size per device.
 *
 * Like the theme, the sizes belong to this browser, not the synced settings,
 * and they are applied when this module loads, before the first render.
 *
 * How they reach the page: each size is a custom property on the root
 * element (`--ts-phone-long-said`, written only when the learner changes
 * it), and a stylesheet this module adds picks the device's sizes by media
 * query and the take length's by the card's `data-take-length`, ending in one
 * property per part that its stylesheet multiplies its size by:
 * `font-size: calc(0.9375rem * var(--text-scale-explanation, 1))`. The root
 * only changes when the learner changes a size, so the many words of the
 * takes are not restyled otherwise. Arithmetic that needs the number itself
 * (how tall a folded section's first lines are) reads `textScaleFor`.
 */

/** A part of the page whose text size the learner sets on its own. */
export type TextSectionId =
	| 'prompt'
	| 'said'
	| 'corrected'
	| 'explanation'
	| 'followUp'
	| 'translation'
	| 'words'
	| 'feedback';

export interface TextSection {
	id: TextSectionId;
	/** Its name, as the page labels it. */
	label: string;
	/** What it is, in a few words. */
	detail: string;
	/** The custom property its stylesheet reads, without `--text-scale-`. */
	cssName: string;
	/** Part of the take itself, so its size can differ between short and long takes. */
	followsTakeLength: boolean;
}

/** In the order they appear on the page. */
export const TEXT_SECTIONS: readonly TextSection[] = [
	{ id: 'prompt', label: 'Prompt', detail: 'The topic you talk about, in the bar.', cssName: 'prompt', followsTakeLength: false },
	{ id: 'said', label: 'You said', detail: 'Your take, as it was heard.', cssName: 'said', followsTakeLength: true },
	{ id: 'corrected', label: 'Did you mean to say?', detail: 'The correct version of your take.', cssName: 'corrected', followsTakeLength: true },
	{ id: 'explanation', label: 'Explanation', detail: "The teacher's notes.", cssName: 'explanation', followsTakeLength: true },
	{ id: 'followUp', label: 'Follow-up', detail: 'The next question, and its translation.', cssName: 'follow-up', followsTakeLength: true },
	{ id: 'translation', label: 'Translation', detail: 'The sticky note with the translations.', cssName: 'translation', followsTakeLength: true },
	{ id: 'words', label: 'Each word', detail: "The translation's word list.", cssName: 'words', followsTakeLength: true },
	{ id: 'feedback', label: 'Feedback', detail: 'The correction cards in the Feedback panel.', cssName: 'feedback', followsTakeLength: false }
];

/** One of the page's three layouts. */
export type TextDevice = 'phone' | 'tablet' | 'desktop';

export interface TextDeviceLayout {
	id: TextDevice;
	label: string;
	/** When the page uses this layout (keep in step with the practice screen and AppHeader). */
	query: string;
}

export const TEXT_DEVICES: readonly TextDeviceLayout[] = [
	{ id: 'phone', label: 'Phone', query: '(max-width: 640px)' },
	{ id: 'tablet', label: 'Tablet', query: '(min-width: 641px) and (max-width: 1023px)' },
	{ id: 'desktop', label: 'Desktop', query: '(min-width: 1024px)' }
];

/** Whether a take is at the size floor its text fits down to (see the module comment). */
export type TakeLength = 'short' | 'long';

export const TAKE_LENGTHS: readonly { id: TakeLength; label: string; detail: string }[] = [
	{ id: 'short', label: 'Short take', detail: 'A sentence or two: the text reads large.' },
	{ id: 'long', label: 'Long take', detail: 'Minutes of speech: the text is at its smallest.' }
];

/** Which page state a size is for. */
export interface TextVariant {
	device: TextDevice;
	length: TakeLength;
}

/** The sizes the slider and A− / A+ move between, as multiples of each part's own size. */
export const TEXT_SCALE_MIN = 0.85;
export const TEXT_SCALE_MAX = 1.6;
export const TEXT_SCALE_STEP = 0.05;
export const DEFAULT_TEXT_SCALE = 1;

const STORAGE_KEY = 'onspot.text-size.v2';
/** Before sizes were kept per device and take length: one size per part. */
const LEGACY_STORAGE_KEY = 'onspot.text-size';
/** Legacy parts that were split in two: the second takes the first's size. */
const LEGACY_SPLITS: Partial<Record<TextSectionId, TextSectionId>> = { explanation: 'followUp', translation: 'words' };

/** The stored sizes by `scaleKey`; only those other than 100% are kept. */
type TextScales = Partial<Record<string, number>>;

function sectionOf(id: TextSectionId): TextSection {
	return TEXT_SECTIONS.find((section) => section.id === id) ?? TEXT_SECTIONS[0];
}

/** Where one size is kept: `phone-long-said` for the take's own parts, `phone-prompt` for the others. */
function scaleKey(id: TextSectionId, variant: TextVariant): string {
	const section = sectionOf(id);
	return section.followsTakeLength ? `${variant.device}-${variant.length}-${section.cssName}` : `${variant.device}-${section.cssName}`;
}

/** Every key a size can be kept under, so stored values can be checked against them. */
function allScaleKeys(): Set<string> {
	const keys = new Set<string>();
	for (const section of TEXT_SECTIONS)
		for (const device of TEXT_DEVICES)
			for (const length of TAKE_LENGTHS) keys.add(scaleKey(section.id, { device: device.id, length: length.id }));
	return keys;
}

/** A scale snapped to the slider's steps and clamped to its range. */
function snapScale(scale: number): number {
	const clamped = Math.min(TEXT_SCALE_MAX, Math.max(TEXT_SCALE_MIN, scale));
	// Through whole steps, so 1.1 stays 1.1 rather than 1.1000000000000001.
	const stepsPerUnit = Math.round(1 / TEXT_SCALE_STEP);
	return Math.round(clamped * stepsPerUnit) / stepsPerUnit;
}

function sameScale(a: number, b: number): boolean {
	return Math.abs(a - b) < TEXT_SCALE_STEP / 2;
}

/** Known keys with finite scales, snapped; anything else is dropped. */
function sanitizeScales(value: unknown): TextScales {
	if (!value || typeof value !== 'object') return {};
	const known = allScaleKeys();
	const scales: TextScales = {};
	for (const [key, scale] of Object.entries(value as Record<string, unknown>)) {
		if (!known.has(key) || typeof scale !== 'number' || !Number.isFinite(scale)) continue;
		const snapped = snapScale(scale);
		if (!sameScale(snapped, DEFAULT_TEXT_SCALE)) scales[key] = snapped;
	}
	return scales;
}

/** One size per part (the first version) becomes that size for every device and take length. */
function migrateLegacyScales(legacy: unknown): TextScales {
	if (!legacy || typeof legacy !== 'object') return {};
	const expanded: Record<string, number> = {};
	for (const [id, scale] of Object.entries(legacy as Record<string, unknown>)) {
		if (typeof scale !== 'number') continue;
		const ids = [id as TextSectionId, ...(LEGACY_SPLITS[id as TextSectionId] ? [LEGACY_SPLITS[id as TextSectionId]!] : [])];
		for (const sectionId of ids)
			for (const device of TEXT_DEVICES)
				for (const length of TAKE_LENGTHS) expanded[scaleKey(sectionId, { device: device.id, length: length.id })] = scale;
	}
	return sanitizeScales(expanded);
}

function storedScales(): TextScales {
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (stored) return sanitizeScales(JSON.parse(stored));

		const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
		if (!legacy) return {};
		const migrated = migrateLegacyScales(JSON.parse(legacy));
		localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
		localStorage.removeItem(LEGACY_STORAGE_KEY);
		return migrated;
	} catch {
		// Storage may be disabled, or the value malformed: every part at 100%.
		return {};
	}
}

/* ------------------------------------------------------------------ Applying them to the page */

/** The root property one stored size is written to. */
function storedProperty(key: string): string {
	return `--ts-${key}`;
}

/** The property a part's stylesheet multiplies its size by. */
function textScaleProperty(id: TextSectionId): string {
	return `--text-scale-${sectionOf(id).cssName}`;
}

/** The device's size for a take part at a take length, picked by the layout's media query. */
function deviceTakeProperty(id: TextSectionId, length: TakeLength): string {
	return `--ts-${length}-${sectionOf(id).cssName}`;
}

/**
 * The stylesheet that turns the stored sizes into each part's
 * `--text-scale-…`: per layout, the device's sizes on the root; per take, its
 * length's (the card carries `data-take-length`).
 */
function scaleStylesheet(): string {
	const takeSections = TEXT_SECTIONS.filter((section) => section.followsTakeLength);
	const pageSections = TEXT_SECTIONS.filter((section) => !section.followsTakeLength);

	const deviceRules = TEXT_DEVICES.map((device) => {
		const declarations = [
			...pageSections.map(
				(section) => `${textScaleProperty(section.id)}: var(${storedProperty(scaleKey(section.id, { device: device.id, length: 'short' }))}, 1);`
			),
			...takeSections.flatMap((section) =>
				TAKE_LENGTHS.map(
					(length) =>
						`${deviceTakeProperty(section.id, length.id)}: var(${storedProperty(scaleKey(section.id, { device: device.id, length: length.id }))}, 1);`
				)
			)
		];
		return `@media ${device.query} { :root { ${declarations.join(' ')} } }`;
	});

	const lengthRules = TAKE_LENGTHS.map((length) => {
		const declarations = takeSections.map(
			(section) => `${textScaleProperty(section.id)}: var(${deviceTakeProperty(section.id, length.id)}, 1);`
		);
		return `[data-take-length='${length.id}'] { ${declarations.join(' ')} }`;
	});

	return [...deviceRules, ...lengthRules].join('\n');
}

function installScaleStylesheet(): void {
	const style = document.createElement('style');
	style.dataset.onspot = 'text-size';
	style.textContent = scaleStylesheet();
	document.head.append(style);
}

/** Writes the stored sizes onto the root element; one at 100% falls back to the stylesheet's 1. */
function applyScales(next: TextScales): void {
	const root = document.documentElement;
	for (const key of allScaleKeys()) {
		const scale = next[key];
		if (scale === undefined) root.style.removeProperty(storedProperty(key));
		else root.style.setProperty(storedProperty(key), String(scale));
	}
}

let scales = $state<TextScales>(storedScales());
installScaleStylesheet();
applyScales(scales);

function saveScales(next: TextScales): void {
	scales = next;
	applyScales(next);
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
	} catch {
		// Storage may be disabled; the sizes still apply until the page reloads.
	}
}

/* ------------------------------------------------------------------ The layout this window is in */

function deviceNow(): TextDevice {
	return TEXT_DEVICES.find((device) => matchMedia(device.query).matches)?.id ?? 'desktop';
}

let currentDevice = $state<TextDevice>(deviceNow());
for (const device of TEXT_DEVICES) matchMedia(device.query).addEventListener('change', () => (currentDevice = deviceNow()));

/** The layout this window is in now. Reactive. */
export function currentTextDevice(): TextDevice {
	return currentDevice;
}

/* ------------------------------------------------------------------ Reading and changing them */

/** A part's scale in one page state (1 = its own size). Reactive inside components and `$derived`. */
export function textScaleFor(id: TextSectionId, variant: TextVariant): number {
	return scales[scaleKey(id, variant)] ?? DEFAULT_TEXT_SCALE;
}

/** Sets a part's scale in one page state (snapped to the slider's steps). */
export function setTextScale(id: TextSectionId, variant: TextVariant, scale: number): void {
	const key = scaleKey(id, variant);
	const snapped = snapScale(scale);
	const updated = { ...scales };
	if (sameScale(snapped, DEFAULT_TEXT_SCALE)) delete updated[key];
	else updated[key] = snapped;
	saveScales(updated);
}

/** Moves a part one step larger (+1) or smaller (−1) in one page state. */
export function stepTextScale(id: TextSectionId, variant: TextVariant, direction: 1 | -1): void {
	setTextScale(id, variant, textScaleFor(id, variant) + direction * TEXT_SCALE_STEP);
}

/** True while every part reads at its own size everywhere. Reactive. */
export function textScalesAreDefault(): boolean {
	return Object.keys(scales).length === 0;
}

/** A size that is not 100%: which part, where, and how large. */
export interface ChangedTextSize {
	section: TextSection;
	device: TextDevice;
	/** The take length, for the take's own parts; null for the prompt and the Feedback cards. */
	length: TakeLength | null;
	scale: number;
}

/** Every size the learner changed, by layout, then in the page's order. Reactive. */
export function changedTextSizes(): ChangedTextSize[] {
	const changed: ChangedTextSize[] = [];
	for (const device of TEXT_DEVICES) {
		for (const section of TEXT_SECTIONS) {
			const lengths: (TakeLength | null)[] = section.followsTakeLength ? TAKE_LENGTHS.map((length) => length.id) : [null];
			for (const length of lengths) {
				const scale = textScaleFor(section.id, { device: device.id, length: length ?? 'short' });
				if (!sameScale(scale, DEFAULT_TEXT_SCALE)) changed.push({ section, device: device.id, length, scale });
			}
		}
	}
	return changed;
}

/** Every part back to its own size in one layout, for short and long takes. */
export function resetTextDevice(device: TextDevice): void {
	const updated = { ...scales };
	for (const section of TEXT_SECTIONS)
		for (const length of TAKE_LENGTHS) delete updated[scaleKey(section.id, { device, length: length.id })];
	saveScales(updated);
}

/** Every part back to its own size, everywhere. */
export function resetTextScales(): void {
	saveScales({});
}
