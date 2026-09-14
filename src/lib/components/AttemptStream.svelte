<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { practice, setActiveAttempt } from '$lib/stores/practice';
	import AttemptCard from './AttemptCard.svelte';

	interface Props {
		activeCorrectionId?: string | null;
		onSelectCorrection?: (attemptId: string, correctionId: string) => void;
	}

	let { activeCorrectionId = null, onSelectCorrection }: Props = $props();

	const attempts = $derived($practice.attempts);

	const ARRIVAL_DURATION_MS = 1050;
	const CARD_SELECT_DURATION_MS = 650;

	let container: HTMLDivElement;
	let spacerHeight = $state(0);
	let initialized = $state(false);
	let knownSessionId = $state<string | null>(null);
	let knownLastAttemptId = $state<string | null>(null);
	let scrollRafId = 0;
	let scrollTargetId: string | null = null;
	let resizeObserver: ResizeObserver | null = null;
	let fallbackRafId = 0;
	let nativeTimeline = true;
	let reducedMotion = false;
	let reducedMotionQuery: MediaQueryList | null = null;

	/**
	 * Sizes the floor spacer so the newest card settles at the top of the viewport
	 * when scrolled to the end. Scrolling is deliberately visual only; selecting an
	 * attempt requires a click or a newly-created attempt.
	 */
	function measure() {
		if (!container) return;
		const cards = [...container.querySelectorAll<HTMLElement>('[data-attempt-id]')];
		if (cards.length === 0) {
			spacerHeight = 0;
			return;
		}
		spacerHeight = Math.max(0, container.clientHeight - cards[cards.length - 1].offsetHeight - 24);
	}

	function observeCards() {
		if (!resizeObserver || !container) return;
		resizeObserver.disconnect();
		resizeObserver.observe(container);
		// The spacer depends only on the viewport and newest card. Observing every
		// historical card made every disclosure change fan out through one shared
		// observer for no benefit.
		const last = [...container.querySelectorAll<HTMLElement>('[data-attempt-id]')].at(-1);
		if (last) resizeObserver.observe(last);
	}

	function cancelAnimatedScroll() {
		if (scrollRafId) cancelAnimationFrame(scrollRafId);
		scrollRafId = 0;
		scrollTargetId = null;
	}

	function easeInOutCubic(progress: number): number {
		return progress < 0.5
			? 4 * progress * progress * progress
			: 1 - Math.pow(-2 * progress + 2, 3) / 2;
	}

	/**
	 * Scrolls at a known pace instead of relying on the browser's unspecified
	 * `behavior: smooth` timing. This is what visibly carries a newly-added card
	 * up from below the viewport rather than snapping it into its resting place.
	 */
	function animateTo(top: number, attemptId: string, duration: number) {
		if (!container) return;
		cancelAnimatedScroll();

		const from = container.scrollTop;
		const limit = Math.max(0, container.scrollHeight - container.clientHeight);
		const to = Math.max(0, Math.min(top, limit));
		const distance = to - from;
		if (Math.abs(distance) < 1 || matchMedia('(prefers-reduced-motion: reduce)').matches) {
			container.scrollTop = to;
			setActiveAttempt(attemptId);
			measure();
			return;
		}

		const startedAt = performance.now();
		scrollTargetId = attemptId;
		const step = (now: number) => {
			const progress = Math.min(1, (now - startedAt) / duration);
			container.scrollTop = from + distance * easeInOutCubic(progress);
			if (progress < 1) {
				scrollRafId = requestAnimationFrame(step);
				return;
			}

			scrollRafId = 0;
			const targetId = scrollTargetId;
			scrollTargetId = null;
			if (targetId) setActiveAttempt(targetId);
			measure();
		};
		scrollRafId = requestAnimationFrame(step);
	}

	function animateArrival(card: HTMLElement) {
		if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		const surface = card.querySelector<HTMLElement>(':scope > [data-card-surface]');
		if (!surface) return;
		const distance = Math.max(
			56,
			Math.min(120, Math.round((container.clientHeight - card.offsetHeight) * 0.3))
		);
		surface.animate(
			[
				{ transform: `translateY(${distance}px) scale(0.985)`, opacity: 0.55 },
				{ transform: 'translateY(0) scale(1)', opacity: 1 }
			],
			{
				duration: ARRIVAL_DURATION_MS,
				easing: 'cubic-bezier(0.22, 1, 0.36, 1)'
			}
		);
	}

	/** Lightweight fallback for webviews without CSS view timelines. */
	function updateFallbackConveyor() {
		fallbackRafId = 0;
		if (nativeTimeline || !container) return;
		if (reducedMotion) {
			for (const card of container.querySelectorAll<HTMLElement>('[data-attempt-id]')) {
				card.style.removeProperty('transform');
				card.style.removeProperty('opacity');
			}
			return;
		}
		for (const card of container.querySelectorAll<HTMLElement>('[data-attempt-id]')) {
			const relativeTop = card.offsetTop - container.scrollTop;
			const progress = Math.max(0, Math.min(1, -relativeTop / 170));
			if (progress === 0) {
				card.style.removeProperty('transform');
				card.style.removeProperty('opacity');
				continue;
			}
			const eased = 1 - Math.pow(1 - progress, 2);
			card.style.transform = `perspective(900px) translate3d(0, ${-48 * eased}px, 0) rotateX(${58 * eased}deg) scale(${1 - 0.08 * eased})`;
			card.style.opacity = String(1 - 0.94 * eased);
		}
	}

	function scheduleFallbackConveyor() {
		if (nativeTimeline || reducedMotion || fallbackRafId) return;
		fallbackRafId = requestAnimationFrame(updateFallbackConveyor);
	}

	async function settleAttempt(attemptId: string, animate: boolean) {
		if (!container) return;
		await tick();
		observeCards();
		measure();
		// The floor spacer changes the scroll range, so wait for that layout before
		// calculating the card's final position.
		await tick();
		const el = container.querySelector<HTMLElement>(`[data-attempt-id="${attemptId}"]`);
		if (!el) return;

		if (animate) {
			animateArrival(el);
			animateTo(el.offsetTop, attemptId, ARRIVAL_DURATION_MS);
		} else {
			cancelAnimatedScroll();
			container.scrollTop = el.offsetTop;
			setActiveAttempt(attemptId);
			measure();
		}
	}

	/** Clicking a card selects it and lifts it to the top, pushing the rest away. */
	function selectCard(event: MouseEvent, id: string) {
		const target = event.target as HTMLElement;
		if (target.closest('button, select, a, input, textarea')) return;
		if (id !== $practice.activeAttemptId) setActiveAttempt(id);
		const el = container?.querySelector<HTMLElement>(`[data-attempt-id="${id}"]`);
		if (el) animateTo(el.offsetTop, id, CARD_SELECT_DURATION_MS);
	}

	onMount(() => {
		nativeTimeline = CSS.supports('animation-timeline: view()');
		reducedMotionQuery = matchMedia('(prefers-reduced-motion: reduce)');
		reducedMotion = reducedMotionQuery.matches;
		const handleMotionPreference = (event: MediaQueryListEvent) => {
			reducedMotion = event.matches;
			updateFallbackConveyor();
		};
		reducedMotionQuery.addEventListener('change', handleMotionPreference);
		resizeObserver = new ResizeObserver(measure);
		observeCards();
		knownSessionId = $practice.sessionId;
		knownLastAttemptId = attempts.at(-1)?.id ?? null;
		const latestId = knownLastAttemptId;
		if (latestId) void settleAttempt(latestId, false).then(() => (initialized = true));
		else initialized = true;
		return () => {
			reducedMotionQuery?.removeEventListener('change', handleMotionPreference);
			resizeObserver?.disconnect();
			cancelAnimatedScroll();
			if (fallbackRafId) cancelAnimationFrame(fallbackRafId);
		};
	});

	$effect(() => {
		const sessionId = $practice.sessionId;
		const lastAttemptId = attempts.at(-1)?.id ?? null;
		if (!initialized) return;

		if (sessionId !== knownSessionId) {
			knownSessionId = sessionId;
			knownLastAttemptId = lastAttemptId;
			if (lastAttemptId) void settleAttempt(lastAttemptId, false);
			return;
		}

		if (lastAttemptId && lastAttemptId !== knownLastAttemptId) {
			knownLastAttemptId = lastAttemptId;
			void settleAttempt(lastAttemptId, true);
		} else {
			knownLastAttemptId = lastAttemptId;
		}
	});
</script>

<div class="relative h-full" role="group" aria-label="Attempt history">
	<div
		class="attempt-scroll h-full overflow-x-hidden overflow-y-auto px-4 py-5 sm:px-7 sm:py-6"
		role="region"
		aria-label="Attempts"
		bind:this={container}
		onwheel={() => cancelAnimatedScroll()}
		onpointerdown={() => cancelAnimatedScroll()}
		ontouchstart={() => cancelAnimatedScroll()}
		onscroll={scheduleFallbackConveyor}
	>
		<div class="relative min-w-0">
			{#each attempts as attempt, index (attempt.id)}
				<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
				<div
					data-attempt-id={attempt.id}
					class="attempt-slot mb-4 min-w-0 cursor-pointer rounded-[22px] outline-none focus-visible:ring-3 focus-visible:ring-[var(--brand)]/45"
					role="button"
					tabindex="0"
					aria-label="Attempt {index + 1}, select and bring to the top"
					onclick={(event) => selectCard(event, attempt.id)}
					onkeydown={(event) => {
						if (event.key === 'Enter' || event.key === ' ') {
							event.preventDefault();
							selectCard(event as unknown as MouseEvent, attempt.id);
						}
					}}
				>
					<AttemptCard
						{attempt}
						index={index + 1}
						active={attempt.id === $practice.activeAttemptId}
						{activeCorrectionId}
						{onSelectCorrection}
					/>
				</div>
			{/each}
			<!-- Floor space so the newest card settles at the top of the viewport. -->
			<div style="height: {spacerHeight}px"></div>
		</div>
	</div>
	<div class="conveyor-lip pointer-events-none absolute inset-x-0 top-0 z-10 h-5"></div>
</div>

<style>
	/*
	 * Scroll-driven conveyor. The animation is driven by the scroll position on
	 * the compositor (no JS per frame), so cards lift/settle smoothly instead of
	 * jumping. Cards fully in view are flat; they curve only while exiting the
	 * top, and reverse smoothly when scrolled back down.
	 */
	@supports (animation-timeline: view()) {
		.attempt-slot {
			animation: conveyor-exit linear both;
			animation-timeline: view();
			animation-range: exit 0% exit 100%;
			transform-origin: top center;
			backface-visibility: hidden;
		}
	}

	.attempt-scroll {
		perspective: 1050px;
		overscroll-behavior: contain;
		scrollbar-gutter: stable;
	}

	.attempt-slot {
		content-visibility: auto;
		contain-intrinsic-size: auto 240px;
		transform-origin: top center;
	}

	@keyframes conveyor-exit {
		from {
			transform: perspective(1100px) translateY(0) rotateX(0deg) scale(1);
			opacity: 1;
		}
		55% {
			transform: perspective(950px) translate3d(0, -10px, 0) rotateX(13deg) scale(0.992);
			opacity: 0.82;
		}
		to {
			transform: perspective(950px) translate3d(0, -48px, 0) rotateX(58deg) scale(0.92);
			opacity: 0.06;
		}
	}

	.conveyor-lip {
		background: linear-gradient(
			to bottom,
			color-mix(in srgb, var(--background) 96%, transparent) 0%,
			color-mix(in srgb, var(--background) 76%, transparent) 58%,
			transparent 100%
		);
	}

	/* Respect the user's motion preference: no conveyor, no lip. */
	@media (prefers-reduced-motion: reduce) {
		.attempt-slot {
			animation: none !important;
		}
		.conveyor-lip {
			display: none;
		}
	}
</style>
