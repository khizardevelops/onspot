<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { get } from 'svelte/store';
	import { SvelteSet } from 'svelte/reactivity';
	import { practiceSession } from '#lib/stores/practiceSession.js';
	import AttemptCard from './AttemptCard.svelte';
	import PaperTimeline, { type TimelineEntry } from './PaperTimeline.svelte';
	import {
		cardPose,
		isWithinReach,
		lockedCard,
		restingOn,
		restsOn,
		scrollTopForCard,
		stackPosition,
		type StackPosition
	} from './cardStack';

	/**
	 * The session's takes as a stack of index cards (see `cardStack.ts` for the
	 * math). The stage scrolls through a track one stage-height per card while
	 * a sticky deck holds the pile in place, newest take on top: scrolling down
	 * lifts the top card away to uncover older takes, scrolling up drops the
	 * newer ones back (cards move the way the text inside a long card does). When scrolling
	 * stops, the stack locks onto a card, so it never rests half-dropped. The
	 * card on top is the selected take, so the Feedback panel always describes
	 * the card being read. A paper timeline on the right is the session's
	 * mini-map.
	 *
	 * Takes run up to five minutes, so a card can be taller than the stage: it
	 * is capped to the stage and, while it rests on top, scrolls inside itself;
	 * the stack only moves on once the card has been read to its end.
	 *
	 * Only the cards within reach of the top of the pile are built with the
	 * page; the rest, out of sight deeper down, are built one per idle moment
	 * after it has shown (see `builtCards`), so opening a long session does not
	 * wait for every take in it.
	 */

	interface Props {
		activeCorrectionId?: string | null;
		onSelectCorrection?: (attemptId: string, correctionId: string) => void;
		/** The paper timeline is open; on phones only a button in the top bar opens it. */
		timelineOpen?: boolean;
	}

	let { activeCorrectionId = null, onSelectCorrection, timelineOpen = $bindable(false) }: Props = $props();

	/** The session the screen shows: the learner's own, or the text-size preview's sample. */
	const session = practiceSession();
	const practice = session.state;

	const attempts = $derived($practice.attempts);

	/** A new take drops onto the pile at a known pace (native smooth scrolling has none). */
	const ARRIVAL_DURATION_MS = 1050;
	/**
	 * Where the browser reports the end of a scroll, momentum included
	 * (`scrollend`), the stack locks onto a card right then. Elsewhere scrolling
	 * has stopped when no scroll event came for `SETTLE_DELAY_MS`; that wait
	 * showed as a pause before the glide to the card (a 75 ms gap after every
	 * fling on a phone).
	 */
	const REPORTS_SCROLL_END = typeof window !== 'undefined' && 'onscrollend' in window;
	const SETTLE_DELAY_MS = 120;
	/*
	 * Jumping to a card (timeline, a click on the pile) and locking onto one
	 * use the stack's own timed scroll, not the browser's smooth scrolling,
	 * whose long ease-out crawled the last few pixels. Quick for a neighbour, a
	 * little longer across many cards, and never longer than the cap.
	 */
	const MOVE_BASE_MS = 240;
	const MOVE_PER_CARD_MS = 45;
	const MOVE_MAX_MS = 650;
	/** The newest card rests at the very top of the scroll (see `stackPosition`). */
	const NEWEST_SCROLL_TOP = 0;
	/** Out-of-sight cards are built when the browser is idle, waiting at most this long for it. */
	const IDLE_TIMEOUT_MS = 1000;
	/** Where there is no idle callback, the next card is built after this pause instead. */
	const IDLE_FALLBACK_DELAY_MS = 50;

	let stage = $state<HTMLDivElement | null>(null);
	/** The stack starts on the newest take, so the cards around it are the ones built first. */
	let stack = $state<StackPosition>(restingOn(Math.max(0, get(practice).attempts.length - 1)));
	/** The card the stack last locked onto: where a scroll gesture started. */
	let restedOn = 0;
	/** A finger or mouse button is on the stage: the stack must not move under it. */
	let pressing = false;
	let initialized = false;
	let knownSessionId: string | null = null;
	let knownLastAttemptId: string | null = null;
	let frameRequested = false;
	let settleTimer: ReturnType<typeof setTimeout> | null = null;
	let scrollRafId = 0;
	let scrollTargetId: string | null = null;
	let reducedMotion = false;

	const poses = $derived(attempts.map((_, index) => cardPose(index, stack)));

	// ------------------------------------------------------------ Building the cards

	/** Takes whose card has been built; a built card stays built. */
	const builtCards = new SvelteSet<string>();
	let idleBuild: number | ReturnType<typeof setTimeout> | null = null;

	/** Runs `callback` when the browser is idle (WebKitGTK has no requestIdleCallback; a short timer stands in). */
	function whenIdle(callback: () => void): number | ReturnType<typeof setTimeout> {
		if (typeof requestIdleCallback === 'function') return requestIdleCallback(callback, { timeout: IDLE_TIMEOUT_MS });
		return setTimeout(callback, IDLE_FALLBACK_DELAY_MS);
	}

	/** Stops building the remaining cards (the stack is going away). */
	function cancelIdleBuild() {
		if (idleBuild === null) return;
		if (typeof cancelIdleCallback === 'function') cancelIdleCallback(idleBuild as number);
		else clearTimeout(idleBuild);
		idleBuild = null;
	}

	/** The take whose card is not built yet that is nearest the top of the pile. */
	function nearestUnbuiltCard(): string | undefined {
		let nearest: { id: string; distance: number } | undefined;
		attempts.forEach((attempt, index) => {
			if (builtCards.has(attempt.id)) return;
			const distance = Math.abs(index - stack.closestIndex);
			if (!nearest || distance < nearest.distance) nearest = { id: attempt.id, distance };
		});
		return nearest?.id;
	}

	/** Builds the cards still missing, one per idle moment, nearest the top first. */
	function buildRemainingCardsWhenIdle() {
		if (idleBuild !== null) return;
		idleBuild = whenIdle(() => {
			idleBuild = null;
			const next = nearestUnbuiltCard();
			if (next === undefined) return;
			builtCards.add(next);
			buildRemainingCardsWhenIdle();
		});
	}

	// Cards coming within reach are built at once (and stay built).
	$effect(() => {
		attempts.forEach((attempt, index) => {
			if (isWithinReach(index, stack)) builtCards.add(attempt.id);
		});
	});

	const timelineEntries = $derived<TimelineEntry[]>(
		attempts.map((attempt, index) => ({ id: attempt.id, take: index + 1, text: attempt.transcript }))
	);

	function scrollRange(): number {
		return stage ? Math.max(0, stage.scrollHeight - stage.clientHeight) : 0;
	}

	function currentPosition(): StackPosition {
		return stackPosition(stage?.scrollTop ?? 0, scrollRange(), attempts.length);
	}

	// ------------------------------------------------------------ Following the scroll

	/** Poses the cards for the current scroll position, once per frame. */
	function updateStack() {
		frameRequested = false;
		if (!stage) return;

		const position = currentPosition();
		// Reduced motion: cards change places at the halfway point instead of sliding and blurring.
		stack = reducedMotion ? restingOn(position.closestIndex) : position;
	}

	function onStageScroll() {
		if (!frameRequested) {
			frameRequested = true;
			requestAnimationFrame(updateStack);
		}
		if (!REPORTS_SCROLL_END) scheduleSettle();
	}

	/** The scroll is over, momentum included: lock onto a card now (see `REPORTS_SCROLL_END`). */
	function onStageScrollEnd() {
		if (settleTimer) clearTimeout(settleTimer);
		// The last scroll event's frame may not have posed the cards yet.
		updateStack();
		settleStack();
	}

	function scheduleSettle() {
		if (settleTimer) clearTimeout(settleTimer);
		settleTimer = setTimeout(settleStack, SETTLE_DELAY_MS);
	}

	/**
	 * Scrolling stopped: finish the drop the learner started (or undo a nudge),
	 * then select the card on top.
	 */
	function settleStack() {
		settleTimer = null;
		// An animated scroll lands on its own card; a held finger or button is still scrolling.
		if (!stage || scrollRafId || pressing || attempts.length === 0) return;

		const count = attempts.length;
		const position = currentPosition().position;
		const card = lockedCard(position, restedOn, count);
		const top = scrollTopForCard(card, count, scrollRange());
		if (Math.abs(stage.scrollTop - top) >= 1) {
			animateTo(card, moveDuration(card - position));
			return;
		}

		restedOn = card;
		const attempt = attempts[card];
		if (attempt && attempt.id !== $practice.activeAttemptId) session.setActiveAttempt(attempt.id);
	}

	/** A finger or the mouse came off the stage: the stack can settle now. */
	function release() {
		if (!pressing) return;
		pressing = false;
		scheduleSettle();
	}

	/**
	 * Every card owns one stage-height of scroll, so resizing the stage moves
	 * the scroll offset of every card; this keeps the same card on top.
	 */
	function keepStackPosition() {
		// An animated scroll recomputes its offset every frame and absorbs the resize itself.
		if (!stage || attempts.length < 2 || scrollRafId) return;

		stage.scrollTop = scrollTopForCard(stack.closestIndex, attempts.length, scrollRange());
		updateStack();
	}

	// ------------------------------------------------------------ Moving the stack

	function cancelAnimatedScroll() {
		if (scrollRafId) cancelAnimationFrame(scrollRafId);
		scrollRafId = 0;
		scrollTargetId = null;
	}

	function easeInOutCubic(progress: number): number {
		return progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;
	}

	/**
	 * Scrolls to a card at a known pace and selects it when it lands. Wheel,
	 * touch or pointer input cancels it at once (the stack then settles where
	 * the learner took over).
	 *
	 * It moves through stack positions, not pixels: a take lands while the
	 * composer changes height, and a pixel target would go stale as the stage
	 * resizes under it.
	 */
	function animateTo(index: number, duration: number) {
		const attempt = attempts[index];
		if (!stage || !attempt) return;
		cancelAnimatedScroll();

		const from = currentPosition().position;
		const distance = index - from;
		const offsetFor = (position: number) => scrollTopForCard(position, attempts.length, scrollRange());
		const land = () => {
			restedOn = index;
			session.setActiveAttempt(attempt.id);
		};
		if (Math.abs(distance) < 0.001 || reducedMotion) {
			stage.scrollTop = offsetFor(index);
			land();
			return;
		}

		const startedAt = performance.now();
		scrollTargetId = attempt.id;
		const step = (now: number) => {
			if (!stage) return;
			const progress = Math.min(1, (now - startedAt) / duration);
			stage.scrollTop = offsetFor(from + distance * easeInOutCubic(progress));
			if (progress < 1) {
				scrollRafId = requestAnimationFrame(step);
				return;
			}

			scrollRafId = 0;
			if (scrollTargetId === attempt.id) land();
			scrollTargetId = null;
		};
		scrollRafId = requestAnimationFrame(step);
	}

	/** Brings a card to the top of the stack (timeline, or a click on a card in the pile). */
	function jumpToCard(index: number) {
		if (!stage || !attempts[index]) return;
		animateTo(index, moveDuration(index - currentPosition().position));
	}

	/** How long a move across `cards` cards (fractional, either direction) takes. */
	function moveDuration(cards: number): number {
		return Math.min(MOVE_MAX_MS, MOVE_BASE_MS + MOVE_PER_CARD_MS * Math.abs(cards));
	}

	/** Scrolls the stage back to the newest card, if another session had left it lower (one frame later, once laid out). */
	function scrollToNewest() {
		if (stage && stage.scrollTop !== NEWEST_SCROLL_TOP) stage.scrollTop = NEWEST_SCROLL_TOP;
	}

	/**
	 * Puts the newest take on top: dropped onto the pile when it was just
	 * recorded, at once when a session opens.
	 */
	async function showNewest(drop: boolean) {
		await tick();
		const newestIndex = attempts.length - 1;
		if (!stage || newestIndex < 0) return;

		if (!drop || newestIndex === 0) {
			cancelAnimatedScroll();
			// The newest card rests at the top of the scroll, so nothing here has to be measured:
			// reading the stage's size now would force a layout of every card while the page is still being built.
			stack = restingOn(newestIndex);
			restedOn = newestIndex;
			session.setActiveAttempt(attempts[newestIndex].id);
			requestAnimationFrame(scrollToNewest);
			return;
		}

		// The newest take's offset is the top of the scroll, so the grown track already "shows" it;
		// put the previous newest back on top (also when reading an older take), then drop the new one on it.
		stage.scrollTop = scrollTopForCard(newestIndex - 1, attempts.length, scrollRange());
		animateTo(newestIndex, ARRIVAL_DURATION_MS);
	}

	/** Clicking a card in the pile brings it to the top. */
	function selectCard(event: MouseEvent, index: number) {
		const target = event.target as HTMLElement;
		if (target.closest('button, select, a, input, textarea')) return;
		// Selecting words to translate them ends with a click on the card; it must not move the stack.
		const selection = getSelection();
		const selectingText =
			selection && !selection.isCollapsed && (event.currentTarget as HTMLElement).contains(selection.anchorNode);
		if (selectingText) return;

		jumpToCard(index);
	}

	/** Any input on the stage takes over from an animated scroll. */
	function takeOver(press: boolean) {
		cancelAnimatedScroll();
		if (press) pressing = true;
	}

	onMount(() => {
		const reducedMotionQuery = matchMedia('(prefers-reduced-motion: reduce)');
		reducedMotion = reducedMotionQuery.matches;
		const handleMotionPreference = (event: MediaQueryListEvent) => {
			reducedMotion = event.matches;
			updateStack();
		};
		reducedMotionQuery.addEventListener('change', handleMotionPreference);

		const resizeObserver = new ResizeObserver(keepStackPosition);
		if (stage) resizeObserver.observe(stage);

		// A press can end anywhere, not only over the stage.
		const releaseEvents = ['pointerup', 'pointercancel', 'touchend', 'touchcancel'] as const;
		for (const type of releaseEvents) window.addEventListener(type, release);

		knownSessionId = $practice.sessionId;
		knownLastAttemptId = attempts.at(-1)?.id ?? null;
		void showNewest(false).then(() => {
			initialized = true;
			buildRemainingCardsWhenIdle();
		});

		return () => {
			reducedMotionQuery.removeEventListener('change', handleMotionPreference);
			resizeObserver.disconnect();
			for (const type of releaseEvents) window.removeEventListener(type, release);
			cancelAnimatedScroll();
			cancelIdleBuild();
			if (settleTimer) clearTimeout(settleTimer);
		};
	});

	// Before the cards render: another session's cards are built around its newest take, not around the old position.
	$effect.pre(() => {
		const sessionId = $practice.sessionId;
		const lastAttemptId = attempts.at(-1)?.id ?? null;
		if (!initialized) return;

		if (sessionId !== knownSessionId) {
			knownSessionId = sessionId;
			knownLastAttemptId = lastAttemptId;
			builtCards.clear();
			stack = restingOn(Math.max(0, attempts.length - 1));
			void showNewest(false).then(buildRemainingCardsWhenIdle);
			return;
		}

		if (lastAttemptId && lastAttemptId !== knownLastAttemptId) {
			knownLastAttemptId = lastAttemptId;
			void showNewest(true);
		} else {
			knownLastAttemptId = lastAttemptId;
		}
	});
</script>

<div class="attempt-stage relative h-full" role="group" aria-label="Attempt history">
	<div
		class="stack-stage h-full overflow-x-hidden overflow-y-auto"
		role="region"
		aria-label="Attempts"
		bind:this={stage}
		onscroll={onStageScroll}
		onscrollend={onStageScrollEnd}
		onwheel={() => takeOver(false)}
		onpointerdown={() => takeOver(true)}
		ontouchstart={() => takeOver(true)}
	>
		<div class="stack-track" style:--card-count={Math.max(1, attempts.length)}>
			<div class="sticky-deck">
				{#each attempts as attempt, index (attempt.id)}
					{@const pose = poses[index]}
					{@const onTop = index === stack.closestIndex}
					{@const built = builtCards.has(attempt.id) || isWithinReach(index, stack)}
					<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
					<div
						data-attempt-id={attempt.id}
						class="stack-card"
						class:on-top={onTop}
						class:out-of-sight={pose.hidden}
						role={onTop ? 'group' : 'button'}
						tabindex="-1"
						aria-label={onTop ? `Take ${index + 1}` : `Take ${index + 1}, bring to the top`}
						aria-current={attempt.id === $practice.activeAttemptId ? 'true' : undefined}
						style:transform={pose.transform}
						style:filter={pose.filter}
						style:opacity={pose.opacity}
						style:box-shadow={pose.boxShadow}
						style:z-index={pose.zIndex}
						onclick={(event) => selectCard(event, index)}
						onkeydown={(event) => {
							if (event.target !== event.currentTarget) return;
							if (event.key === 'Enter' || event.key === ' ') {
								event.preventDefault();
								jumpToCard(index);
							}
						}}
					>
						<!-- Masking tape holding the card down; it leans the other way on alternate cards. -->
						<span class="card-tape" class:leans-right={index % 2 === 1} aria-hidden="true"></span>
						<!-- Only the card on top can be read and used; the pile below just shows. -->
						<div class="stack-card-body" class:resting={restsOn(stack, index)} inert={!onTop}>
							{#if built}
								<AttemptCard
									{attempt}
									index={index + 1}
									active={attempt.id === $practice.activeAttemptId}
									{activeCorrectionId}
									{onSelectCorrection}
								/>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		</div>
	</div>

	<!-- The header's edge: the slot the cards drop out of. -->
	<div class="header-slot pointer-events-none absolute inset-x-0 top-0" aria-hidden="true"></div>

	{#if attempts.length > 0}
		<PaperTimeline entries={timelineEntries} position={stack.position} onJump={jumpToCard} bind:open={timelineOpen} />
	{/if}
</div>

<style>
	.attempt-stage {
		/* Where cards rest: below the header's slot, clear of the composer. */
		--card-gap: clamp(24px, 5vh, 44px);
		--card-floor: 16px;
		--stack-inset: var(--page-gutter);
		/* The paper timeline sits closer to the edge than the page margin (the sidebar, or the screen). */
		--timeline-margin: min(14px, var(--page-gutter));
		/* The collapsed paper timeline (36px, see PaperTimeline), its margin and some air. */
		--timeline-room: calc(var(--timeline-margin) + 36px + 16px);
		/* Card shadows are drawn in the paper's warm ink; black at night. */
		--stack-shadow-ink: 60 50 35;
		/* Index cards: nearly square corners, held down with masking tape. */
		--attempt-radius: 6px;
		--tape-color: rgb(230 220 190 / 0.68);
		container-type: inline-size;
	}
	:global([data-theme='dark']) .attempt-stage {
		--stack-shadow-ink: 0 0 0;
		--tape-color: rgb(200 185 150 / 0.3);
	}

	/* The paper timeline shows where the stack is, so the stage has no scrollbar. */
	.stack-stage {
		overscroll-behavior: contain;
		scrollbar-width: none;
	}
	.stack-stage::-webkit-scrollbar {
		display: none;
	}

	/* One stage-height of scroll per card. */
	.stack-track {
		position: relative;
		height: calc(var(--card-count) * 100%);
	}

	/* Holds the pile in place while the track scrolls past. */
	.sticky-deck {
		position: sticky;
		top: 0;
		height: calc(100% / var(--card-count));
		isolation: isolate;
	}

	/*
	 * One index card in the pile. The card's pose (drop, tilt, scale, blur,
	 * shadow) is set on it per frame from `cardStack.ts`; the paper itself is
	 * AttemptCard. The card is capped to the stage, and a longer take scrolls
	 * inside its body, which also clips it to the card's corners; the tape sits
	 * outside that clip.
	 */
	.stack-card {
		position: absolute;
		top: var(--card-gap);
		left: var(--stack-inset);
		/* Room for the collapsed paper timeline. */
		right: var(--timeline-room);
		display: flex;
		flex-direction: column;
		max-height: calc(100% - var(--card-gap) - var(--card-floor));
		border-radius: var(--attempt-radius);
		transform-origin: top center;
		will-change: transform, filter, opacity;
		cursor: pointer;
	}
	.stack-card.on-top {
		cursor: auto;
	}
	.stack-card.out-of-sight {
		visibility: hidden;
		will-change: auto;
	}
	.stack-card-body {
		min-height: 0;
		overflow: hidden;
		border-radius: inherit;
	}
	/* Only a card at rest scrolls inside itself; a moving card leaves the wheel to the stack. */
	.stack-card-body.resting {
		overflow-y: auto;
		scrollbar-width: thin;
	}

	/* Translucent crepe tape with torn ends, half on the card and half on the desk. */
	.card-tape {
		position: absolute;
		top: -11px;
		left: 50%;
		z-index: 1;
		width: 112px;
		height: 26px;
		background-color: var(--tape-color);
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.08);
		transform: translateX(-50%) rotate(-1.5deg);
		clip-path: polygon(
			2% 0%, 98% 2%, 96% 18%, 99% 34%, 97% 52%, 100% 70%, 97% 86%, 99% 100%,
			1% 98%, 3% 82%, 0% 66%, 2% 48%, 0% 32%, 3% 16%
		);
		pointer-events: none;
	}
	.card-tape.leans-right {
		transform: translateX(-50%) rotate(1.2deg);
	}

	.header-slot {
		z-index: 20;
		height: 1px;
		margin-top: -1px;
		box-shadow:
			0 10px 30px rgb(var(--stack-shadow-ink) / 0.06),
			0 1px 0 rgb(var(--stack-shadow-ink) / 0.06);
	}

	/*
	 * Phones: the cards span the screen edge to edge (their own padding keeps
	 * the text off it) and rest close under the bar. Square and untilted, so
	 * no desk shows down an edge; new cards dropping onto the pile are what
	 * tell them apart. The timeline opens from the bar instead.
	 */
	@media (max-width: 640px) {
		.stack-card {
			--card-gap: 16px;
			--stack-inset: env(safe-area-inset-left, 0px);
			--timeline-room: env(safe-area-inset-right, 0px);
			--attempt-radius: 0;
			--card-tilt: 0;
		}
	}
</style>
