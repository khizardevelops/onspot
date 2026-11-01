// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The attempt stack: takes are index cards dropped, one on top of another,
 * from a slot under the session header, so the newest take is on top.
 * Scrolling digs through the pile. Every card after the first owns one
 * stage-height of scroll: scrolling down lifts the top card up into the slot
 * and uncovers the older card beneath it (which comes back crisp from its
 * buried pose: pushed down, shrunk, darkened and blurred); scrolling up drops
 * the newer cards back on.
 *
 * Scrolling down therefore moves the cards up, the same way it moves the text
 * inside a long card: one direction for both.
 *
 * This module is only the math: where a scroll position puts the stack, how
 * each card is posed for it, and where to scroll to bring a card to the top.
 * `AttemptStream.svelte` applies it.
 */

/** Where the scroll position puts the stack. */
export interface StackPosition {
	/** Continuous position in cards: 2.5 is halfway from the third card to the fourth. */
	position: number;
	/** The card being covered, or resting on top when `fraction` is 0. */
	activeIndex: number;
	/** How far the next card has dropped onto the active one, 0 to 1. */
	fraction: number;
	/** The card nearest the top: the one the learner is reading. */
	closestIndex: number;
}

/** How one card is posed for a stack position. */
export interface CardPose {
	transform: string;
	filter: string;
	opacity: number;
	boxShadow: string;
	zIndex: number;
	/** Out of sight (behind the header, or deep in the pile): not painted at all. */
	hidden: boolean;
}

/**
 * The active card stays crisp while the incoming card starts covering it; it
 * only starts sinking once the drop is this far along.
 */
const BURY_DELAY = 0.35;

/** A buried card, fully sunk into the pile. */
const BURIED = { dropPercent: 20, scale: 0.92, blurPx: 8, brightness: 0.8, opacity: 0.5 } as const;

/** Where a card waits, behind the header, before it drops (a share of its own height). */
const WAITING_DROP_PERCENT = -150;

/**
 * Buried cards share one pose, so a deep card only shows where it is taller
 * than the ones on top of it. Past this depth cards fade out over one more
 * card and stop being painted, so a long session does not composite dozens
 * of blurred layers.
 */
const BURIED_CARDS_SHOWN = 3;

/**
 * Cards are dropped slightly askew, like real ones; the tilt repeats every
 * four cards. Kept within ±0.4°: more made single cards look crooked. The
 * stage scales it with `--card-tilt` (phones set 0: their cards span the
 * screen, where a tilt would show the desk down one edge).
 */
const CARD_TILTS_DEG = [-0.3, 0.35, -0.2, 0.4] as const;

/** The z-index of the first card; each later card lies on the one before it. */
const BASE_Z_INDEX = 10;

/**
 * Card shadows, in the theme's shadow ink (`--stack-shadow-ink`, an RGB triple).
 * A resting card lies flat; a dropping card hovers above the pile.
 */
const RESTING_SHADOW = shadow(4, 15, 0.02);
const DROPPING_SHADOW = shadow(15, 35, 0.1);

function shadow(offsetPx: number, blurPx: number, alpha: number): string {
	return `0 ${offsetPx}px ${blurPx}px rgb(var(--stack-shadow-ink) / ${alpha})`;
}

function clamp01(value: number): number {
	return Math.max(0, Math.min(1, value));
}

/**
 * Reads the stack position from the scroll position.
 *
 * @param scrollTop The stage's scroll offset.
 * @param scrollRange How far the stage scrolls (`scrollHeight - clientHeight`).
 * @param count How many cards are in the stack.
 */
export function stackPosition(scrollTop: number, scrollRange: number, count: number): StackPosition {
	const totalTransitions = Math.max(0, count - 1);
	// The top of the scroll is the newest card; scrolling down goes back through older ones.
	const scrolledDown = scrollRange > 0 ? clamp01(scrollTop / scrollRange) : 0;
	const scrollProgress = 1 - scrolledDown;

	const position = scrollProgress * totalTransitions;
	const activeIndex = Math.floor(position);
	const fraction = clamp01(position - activeIndex);

	return { position, activeIndex, fraction, closestIndex: Math.round(position) };
}

/**
 * The stack resting with one card on top and nothing dropping.
 *
 * @param index The card on top.
 */
export function restingOn(index: number): StackPosition {
	return { position: index, activeIndex: index, fraction: 0, closestIndex: index };
}

/**
 * Poses one card for a stack position.
 *
 * @param index The card's place in the stack, oldest first.
 * @param stack The current stack position.
 */
export function cardPose(index: number, stack: StackPosition): CardPose {
	const { activeIndex, fraction } = stack;
	const tilt = CARD_TILTS_DEG[index % CARD_TILTS_DEG.length];
	const zIndex = BASE_Z_INDEX + index;

	let dropPercent = 0;
	let scale = 1;
	let blurPx = 0;
	let brightness = 1;
	let opacity = 1;
	let boxShadow = RESTING_SHADOW;
	let hidden = false;

	if (index < activeIndex) {
		// Buried. The active card counts as depth 0 and sinks the pile as it is covered.
		const depth = activeIndex - index + fraction;
		dropPercent = BURIED.dropPercent;
		scale = BURIED.scale;
		blurPx = BURIED.blurPx;
		brightness = BURIED.brightness;
		opacity = BURIED.opacity * clamp01(BURIED_CARDS_SHOWN + 1 - depth);
		hidden = opacity === 0;
	} else if (index === activeIndex) {
		// Being covered: crisp until the bury delay, then sinking toward the buried pose.
		const buryProgress = fraction > BURY_DELAY ? (fraction - BURY_DELAY) / (1 - BURY_DELAY) : 0;
		dropPercent = buryProgress * BURIED.dropPercent;
		scale = 1 - buryProgress * (1 - BURIED.scale);
		blurPx = buryProgress * BURIED.blurPx;
		brightness = 1 - buryProgress * (1 - BURIED.brightness);
		boxShadow = shadow(10 - buryProgress * 5, 30 - buryProgress * 10, 0.08 - buryProgress * 0.04);
	} else if (index === activeIndex + 1) {
		// Dropping in from behind the header; always crisp.
		dropPercent = WAITING_DROP_PERCENT * (1 - fraction);
		boxShadow = DROPPING_SHADOW;
		hidden = fraction === 0;
	} else {
		// Waiting behind the header.
		dropPercent = WAITING_DROP_PERCENT;
		opacity = 0;
		hidden = true;
	}

	const sharp = blurPx === 0 && brightness === 1;
	return {
		transform: `translateY(${dropPercent}%) rotate(calc(${tilt}deg * var(--card-tilt, 1))) scale(${scale})`,
		filter: sharp ? 'none' : `blur(${blurPx}px) brightness(${brightness})`,
		opacity,
		boxShadow,
		zIndex,
		hidden
	};
}

/**
 * Moving the stack less than this share of a card from where it rested is a
 * nudge; more is a deliberate step on to the next card (one wheel notch).
 */
const STEP_INTENT = 0.1;

/** Within this share of a card the stack counts as resting on it (scroll offsets round to pixels). */
const RESTING_TOLERANCE = 0.01;

/**
 * The card the stack locks onto when scrolling stops. A deliberate move goes
 * on to the next card in its direction; a nudge falls back to the card it
 * rested on. So the stack never stays half-dropped.
 *
 * @param position Where scrolling stopped (`StackPosition.position`).
 * @param restedOn The card the stack last rested on.
 * @param count How many cards are in the stack.
 */
export function lockedCard(position: number, restedOn: number, count: number): number {
	const moved = position - restedOn;

	let card = restedOn;
	if (moved > STEP_INTENT) card = Math.ceil(position - STEP_INTENT);
	else if (moved < -STEP_INTENT) card = Math.floor(position + STEP_INTENT);

	return Math.max(0, Math.min(count - 1, card));
}

/**
 * True when a card is resting on top with nothing dropping onto it: only
 * then does a long card scroll inside itself, so a wheel never scrolls a card
 * that is still moving.
 */
export function restsOn(stack: StackPosition, index: number): boolean {
	return Math.abs(stack.position - index) < RESTING_TOLERANCE;
}

/**
 * True for the cards that show at this stack position and the ones a single
 * step of scrolling would bring into sight: the next card down the pile (it
 * starts fading in as soon as the top card lifts) and the one waiting above,
 * ready to drop back on. Cards outside this reach cannot be seen yet.
 *
 * @param index The card's place in the stack, oldest first.
 * @param stack The current stack position.
 */
export function isWithinReach(index: number, stack: StackPosition): boolean {
	const deepestReached = stack.closestIndex - (BURIED_CARDS_SHOWN + 1);
	const highestReached = stack.closestIndex + 1;
	return index >= deepestReached && index <= highestReached;
}

/**
 * The scroll offset that rests a card on top of the stack.
 *
 * @param index The card to show.
 * @param count How many cards are in the stack.
 * @param scrollRange How far the stage scrolls.
 */
export function scrollTopForCard(index: number, count: number, scrollRange: number): number {
	const totalTransitions = count - 1;
	if (totalTransitions <= 0) return 0;

	const targetProgress = index / totalTransitions;
	return (1 - targetProgress) * scrollRange;
}
