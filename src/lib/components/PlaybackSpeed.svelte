<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

<script lang="ts">
	/**
	 * Playback speed as one button. It shows the speed, and a press steps to the
	 * next one: slow, normal, fast, then slow again. Three ticks under the number
	 * show where the speed sits in that cycle, so nothing needs opening to see
	 * it. The arrow keys and, on desktop, the mouse wheel step faster or slower
	 * without going round. A speed other than normal is tinted, so a changed
	 * speed stands out.
	 */
	import { prefersReducedMotion } from 'svelte/motion';
	import { fly } from 'svelte/transition';
	import { audioPlayer, setRate } from '#lib/stores/audio.js';

	/** Slow, normal and fast, in the order a press steps through them. */
	const PLAYBACK_SPEEDS = [0.75, 1, 1.25] as const;
	const NORMAL_SPEED = 1;
	/** How far the number rolls in or out when it changes. */
	const ROLL_DISTANCE_PX = 8;
	const ROLL_DURATION_MS = 170;
	/** Wheel travel for one step: a mouse wheel's notch, or a short trackpad swipe. */
	const WHEEL_PIXELS_PER_STEP = 40;
	/** A wheel that reports lines (Firefox's mouse wheel) moves about this many pixels per line. */
	const WHEEL_PIXELS_PER_LINE = 40;

	/** Faster (1) or slower (-1). */
	type SpeedStep = 1 | -1;

	const speedIndex = $derived(indexOfSpeed($audioPlayer.rate));
	const speed = $derived(PLAYBACK_SPEEDS[speedIndex]);
	const nextSpeed = $derived(PLAYBACK_SPEEDS[(speedIndex + 1) % PLAYBACK_SPEEDS.length]);
	const changed = $derived(speed !== NORMAL_SPEED);
	/** Which way the speed last went: the number rolls up when it gets faster, down when slower. */
	let rollDirection = $state<SpeedStep>(1);
	const roll = $derived({
		y: ROLL_DISTANCE_PX,
		duration: prefersReducedMotion.current ? 0 : ROLL_DURATION_MS
	});
	/** Wheel travel not yet turned into a step. */
	let pendingWheelPixels = 0;

	function indexOfSpeed(rate: number): number {
		const index = PLAYBACK_SPEEDS.findIndex((option) => option === rate);
		return index === -1 ? PLAYBACK_SPEEDS.indexOf(NORMAL_SPEED) : index;
	}

	function speedLabel(rate: number): string {
		return `${rate}×`;
	}

	function changeSpeed(next: number): void {
		if (next === speed) return;
		rollDirection = next > speed ? 1 : -1;
		setRate(next);
	}

	/** A press: the next speed, back to the slowest after the fastest. */
	function cycleSpeed(): void {
		changeSpeed(nextSpeed);
	}

	/** The arrow keys and the wheel: one speed faster or slower, stopping at either end. */
	function stepSpeed(step: SpeedStep): void {
		const index = Math.min(PLAYBACK_SPEEDS.length - 1, Math.max(0, speedIndex + step));
		changeSpeed(PLAYBACK_SPEEDS[index]);
	}

	function onKeydown(event: KeyboardEvent): void {
		const step: SpeedStep | null =
			event.key === 'ArrowUp' || event.key === 'ArrowRight'
				? 1
				: event.key === 'ArrowDown' || event.key === 'ArrowLeft'
					? -1
					: null;
		if (step === null) return;
		// The page would scroll otherwise.
		event.preventDefault();
		stepSpeed(step);
	}

	/** Wheel up is faster. The page does not scroll while the pointer is on the button. */
	function onWheel(event: WheelEvent): void {
		event.preventDefault();
		const pixels = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * WHEEL_PIXELS_PER_LINE : event.deltaY;
		pendingWheelPixels += pixels;
		if (Math.abs(pendingWheelPixels) < WHEEL_PIXELS_PER_STEP) return;
		stepSpeed(pendingWheelPixels < 0 ? 1 : -1);
		pendingWheelPixels = 0;
	}
</script>

<button
	type="button"
	class="speed-button relative grid h-7 w-10 shrink-0 place-items-center content-center gap-[3px] rounded border border-transparent {changed
		? 'bg-[var(--brand-soft)] text-[var(--brand)]'
		: 'text-muted-foreground hover:bg-[var(--surface-2)]'}"
	aria-label="Playback speed {speedLabel(speed)}, press for {speedLabel(nextSpeed)}"
	title="Playback speed {speedLabel(speed)}. Click for {speedLabel(nextSpeed)}; the arrow keys or the wheel step faster or slower."
	onclick={cycleSpeed}
	onkeydown={onKeydown}
	onwheel={onWheel}
	onpointerleave={() => (pendingWheelPixels = 0)}
>
	<!-- Old and new number share one cell while they roll past each other; the cell clips them. -->
	<span class="speed-value grid overflow-hidden text-[11px] leading-3 font-medium tabular-nums">
		{#key speed}
			<span
				class="speed-number"
				in:fly={{ ...roll, y: rollDirection * roll.y }}
				out:fly={{ ...roll, y: -rollDirection * roll.y }}
			>
				{speedLabel(speed)}
			</span>
		{/key}
	</span>
	<span class="flex items-center gap-[3px]" aria-hidden="true">
		{#each PLAYBACK_SPEEDS as option, index (option)}
			<span class="speed-tick" class:current={index === speedIndex}></span>
		{/each}
	</span>
</button>

<style>
	.speed-number {
		grid-area: 1 / 1;
		justify-self: center;
	}
	.speed-tick {
		width: 3px;
		height: 3px;
		border-radius: 999px;
		background: currentColor;
		opacity: 0.3;
		transition:
			opacity 160ms ease,
			background-color 160ms ease;
	}
	.speed-tick.current {
		background: var(--brand);
		opacity: 1;
	}
	/* Fingers get a 36 px tall target; the button itself stays as compact as its neighbours. */
	@media (pointer: coarse) {
		.speed-button::before {
			content: '';
			position: absolute;
			inset: -4px -2px;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.speed-tick {
			transition: none;
		}
	}
</style>
