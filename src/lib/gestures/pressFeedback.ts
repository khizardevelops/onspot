// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A neo button shows it is pressed the moment a finger comes down on it and
 * lets go the moment the finger lifts, as native controls do.
 *
 * neo-svelte draws a pressed button for `:active` or its `neo-pressed` class.
 * On a touch screen the browser applies `:active` only after its show-press
 * delay (Android's tap timeout, about 100 ms) or once the tap is over, and
 * neo adds `neo-pressed` after the click and keeps it 150 ms. Measured: under
 * a finger held for 250 ms the button looked pressed only from 300 to 433 ms,
 * after the finger had lifted.
 *
 * So `neo-pressed` goes on at `pointerdown` (finger or pen; a mouse already
 * gets `:active` at once) and comes off when the finger lifts, moves past the
 * touch slop (the touch has become a scroll or a swipe) or is cancelled. After
 * a click, neo's own 150 ms of `neo-pressed` is taken off too, for every
 * pointer, unless the button is a toggle, whose `neo-pressed` means "on".
 */
import { TOUCH_SLOP_PX } from './touch';

/** neo buttons that can be pressed now. */
const PRESSABLE_SELECTOR = '.neo-button:not(:disabled, [aria-disabled="true"], .neo-loading, .neo-readonly)';
/** neo's pressed look, by class (the same rules as `:active`). */
const PRESSED_CLASS = 'neo-pressed';
/** A toggle's `neo-pressed` is its "on" state, not a press. */
const TOGGLE_CLASS = 'neo-toggle';

interface Press {
	button: HTMLElement;
	pointerId: number;
	startX: number;
	startY: number;
}

/**
 * Starts showing presses on every neo button in the page.
 *
 * @returns Stops it.
 */
export function showPressesImmediately(): () => void {
	let press: Press | null = null;

	const release = () => {
		press?.button.classList.remove(PRESSED_CLASS);
		press = null;
	};

	const onPointerDown = (event: PointerEvent) => {
		release();
		if (event.pointerType === 'mouse' || !event.isPrimary || !(event.target instanceof Element)) return;
		const button = event.target.closest<HTMLElement>(PRESSABLE_SELECTOR);
		// Already pressed (a toggle that is on): it is not ours to take off later.
		if (!button || button.classList.contains(PRESSED_CLASS)) return;

		button.classList.add(PRESSED_CLASS);
		press = { button, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY };
	};

	const onPointerMove = (event: PointerEvent) => {
		if (!press || event.pointerId !== press.pointerId) return;
		if (Math.hypot(event.clientX - press.startX, event.clientY - press.startY) > TOUCH_SLOP_PX) release();
	};

	const onPointerEnd = (event: PointerEvent) => {
		if (press && event.pointerId === press.pointerId) release();
	};

	/** neo keeps a clicked button pressed for 150 ms; native controls let go on release. */
	const onClick = (event: MouseEvent) => {
		if (!(event.target instanceof Element)) return;
		const button = event.target.closest<HTMLElement>('.neo-button');
		if (!button || button.classList.contains(TOGGLE_CLASS)) return;
		// After the click's own handlers and the component's update, which adds the class.
		setTimeout(() => {
			if (!button.matches(':active') && press?.button !== button) button.classList.remove(PRESSED_CLASS);
		});
	};

	const listening = { capture: true, passive: true } as const;
	document.addEventListener('pointerdown', onPointerDown, listening);
	document.addEventListener('pointermove', onPointerMove, listening);
	document.addEventListener('pointerup', onPointerEnd, listening);
	document.addEventListener('pointercancel', onPointerEnd, listening);
	document.addEventListener('click', onClick, listening);

	return () => {
		release();
		document.removeEventListener('pointerdown', onPointerDown, listening);
		document.removeEventListener('pointermove', onPointerMove, listening);
		document.removeEventListener('pointerup', onPointerEnd, listening);
		document.removeEventListener('pointercancel', onPointerEnd, listening);
		document.removeEventListener('click', onClick, listening);
	};
}
