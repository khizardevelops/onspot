export interface FitTextOptions {
	/** Smallest font size in px; below this the block grows taller instead. */
	min: number;
	/** Largest font size in px, used for short text. */
	max: number;
	/** Height in px the text should fill before the block has to grow. */
	targetHeight: number;
	/** Average glyph advance in em (spaces included) for the font. */
	advance: number;
	/** Line height as a multiple of the font size. */
	lineHeight: number;
}

/**
 * Font size that lets `chars` characters fill about `targetHeight` at `width`,
 * clamped to [min, max] and rounded to half pixels.
 *
 * Area model: at size s a line holds width / (s · advance) characters and is
 * s · lineHeight tall, so the text needs chars · s² · advance · lineHeight of
 * area. Solving for s against width × targetHeight needs no DOM measurement,
 * so many cards can size themselves without layout thrash.
 */
export function fitFontSize(chars: number, width: number, options: FitTextOptions): number {
	const { min, max, targetHeight, advance, lineHeight } = options;
	if (chars <= 0 || width <= 0) return max;
	// Word wrapping leaves ragged line ends; ~8% of each line goes unused.
	const perCharArea = advance * lineHeight * 1.08;
	const size = Math.sqrt((width * targetHeight) / (chars * perCharArea));
	return Math.round(Math.min(max, Math.max(min, size)) * 2) / 2;
}
