<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

<script lang="ts">
	import AppHeader from '#lib/components/AppHeader.svelte';
	import { onMount } from 'svelte';

	let heroCard = $state<HTMLElement | null>(null);
	let scroller = $state<HTMLElement | null>(null);
	let canTilt = false;

	function handlePointerMove(event: PointerEvent): void {
		if (!canTilt || !heroCard) return;

		const rect = heroCard.getBoundingClientRect();
		const x = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
		const y = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
		heroCard.style.setProperty('--tilt-x', x.toFixed(3));
		heroCard.style.setProperty('--tilt-y', y.toFixed(3));
	}

	function handlePointerLeave(): void {
		if (!heroCard) return;
		heroCard.style.setProperty('--tilt-x', '0');
		heroCard.style.setProperty('--tilt-y', '0');
	}

	onMount(() => {
		canTilt =
			window.matchMedia('(hover: hover)').matches &&
			!window.matchMedia('(prefers-reduced-motion: reduce)').matches;

		if (!scroller) return;
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

		const items = Array.from(scroller.querySelectorAll<HTMLElement>('[data-reveal]'));
		if (!items.length) return;

		const scrollerTop = scroller.getBoundingClientRect().top;
		const visibleHeight = scroller.clientHeight;
		const inView = items.filter((item) => {
			const rect = item.getBoundingClientRect();
			return rect.top < scrollerTop + visibleHeight * 0.95 && rect.bottom > scrollerTop;
		});

		// Mark what is already visible before hiding anything, then let the
		// observer bring the rest in as it scrolls into the page.
		for (const item of inView) item.classList.add('is-revealed', 'no-transition');
		scroller.classList.add('reveal-ready');

		requestAnimationFrame(() => {
			for (const item of inView) item.classList.remove('no-transition');
		});

		if (!('IntersectionObserver' in window)) {
			for (const item of items) item.classList.add('is-revealed');
			return;
		}

		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (!entry.isIntersecting) continue;
					(entry.target as HTMLElement).classList.add('is-revealed');
					observer.unobserve(entry.target);
				}
			},
			{
				root: scroller,
				rootMargin: '0px 0px -2% 0px',
				threshold: 0.05
			}
		);

		for (const item of items) {
			if (!item.classList.contains('is-revealed')) observer.observe(item);
		}

		return () => observer.disconnect();
	});
</script>

<svelte:head>
	<title>About onspot</title>
	<meta
		name="description"
		content="onspot is a quiet place to practise speaking on the spot. One prompt, up to a minute of talking, and teacher-style feedback on every take."
	/>
</svelte:head>

<div class="about-shell flex h-full flex-col">
	<AppHeader title="About" />

	<div class="about-page min-h-0 flex-1 overflow-y-auto" bind:this={scroller}>
		<div class="about-inner">
			<div data-reveal>	<section
						class="hero-card"
						aria-labelledby="about-title"
						bind:this={heroCard}
						onpointermove={handlePointerMove}
					onpointerleave={handlePointerLeave}
				>
					<span class="tape tape--tl" aria-hidden="true"></span>
					<span class="tape tape--tr" aria-hidden="true"></span>
					<span class="stamp" aria-hidden="true">ON THE SPOT</span>

					<div class="hero-head">
						<div class="hero-copy">
							<p class="eyebrow">The short version</p>
							<h1 class="hero-title" id="about-title">About <span class="mark">onspot</span></h1>
							<p class="hero-tagline">
								A quiet place to practise speaking on the spot. One prompt, up to a minute of
								talking, and teacher-style feedback on every take. No feeds, no streaks, no noise.
							</p>

							<nav class="hero-links" aria-label="About links">
								<a
									class="text-link"
									href="https://github.com/khizardevelops/onspot/releases/latest"
									target="_blank"
									rel="noopener noreferrer"
								>
									Download the app
									<svg viewBox="0 0 16 16" aria-hidden="true">
										<path
											d="M3 8h9M9 4.5 12.5 8 9 11.5"
											fill="none"
											stroke="currentColor"
											stroke-width="1.6"
											stroke-linecap="round"
											stroke-linejoin="round"
										/>
									</svg>
								</a>
								<span class="link-dot" aria-hidden="true"></span>
								<a
									class="text-link"
									href="https://github.com/khizardevelops/onspot"
									target="_blank"
									rel="noopener noreferrer"
								>
									Source on GitHub
								</a>
								<span class="link-dot" aria-hidden="true"></span>
								<a
									class="text-link"
									href="https://github.com/khizardevelops/onspot/issues"
									target="_blank"
									rel="noopener noreferrer"
								>
									Report an issue
								</a>
							</nav>
						</div>

						<div class="hero-logo" aria-hidden="true">
							<svg viewBox="0 0 100 100" focusable="false">
								<path
									d="M32 23 L14 71 C13.5 73.2 30 75 50 75 C70 75 86.5 73.2 86 71 L68 23 Z"
									fill="currentColor"
									opacity="0.16"
								/>
								<ellipse cx="50" cy="72" rx="36" ry="5.5" fill="currentColor" opacity="0.16" />
								<ellipse cx="50" cy="23" rx="18" ry="2.8" fill="currentColor" />
								<rect x="28" y="50" width="4.5" height="14" rx="2.25" fill="currentColor" />
								<rect x="38" y="45.5" width="4.5" height="18.5" rx="2.25" fill="currentColor" />
								<rect x="48" y="39" width="4.5" height="25" rx="2.25" fill="currentColor" />
								<rect x="58" y="45.5" width="4.5" height="18.5" rx="2.25" fill="currentColor" />
								<rect x="68" y="50" width="4.5" height="14" rx="2.25" fill="currentColor" />
							</svg>
						</div>

						<div class="github-card-wrap">
						<a
							class="github-card"
							href="https://github.com/khizardevelops/onspot"
							target="_blank"
							rel="noopener noreferrer"
						>
							<span class="github-fillet github-fillet--tl" aria-hidden="true"></span>
							<span class="github-fillet github-fillet--tr" aria-hidden="true"></span>
							<span class="github-fillet github-fillet--bl" aria-hidden="true"></span>
							<span class="github-fillet github-fillet--br" aria-hidden="true"></span>

							<span class="github-glow" aria-hidden="true"></span>
							<span class="github-glow github-glow--edge" aria-hidden="true"></span>

							<span class="github-shine" aria-hidden="true"></span>
							<span class="github-stamp" aria-hidden="true"> public </span>

							<span class="github-chip" aria-hidden="true">
								<svg viewBox="0 0 24 24">
									<path
										d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"
									fill="currentColor"
								/>
							</svg>
							</span>

							<span class="github-body">
								<span class="github-name">onspot on GitHub</span>
								<span class="github-desc">
									Source code, issues, and how it's built. Free and open source under
									AGPL-3.0-or-later.
								</span>
								<span class="github-meta" aria-hidden="true">
									public repo · AGPL-3.0-or-later
								</span>
							</span>

							<span class="github-cta" aria-hidden="true">
								<svg viewBox="0 0 16 16">
									<path
										d="M4 12 12 4M5.5 4H12v6.5"
										fill="none"
										stroke="currentColor"
										stroke-width="1.8"
										stroke-linecap="round"
										stroke-linejoin="round"
									/>
								</svg>
							</span>
						</a>
					</div>
				</section>
			</div>

			<div class="about-flow">
				<div class="sheet-row">
					<section class="paper-sheet" data-reveal style="--reveal-delay: 40ms">
						<header class="sheet-head">
							<span class="sheet-no" aria-hidden="true">01</span>
							<h2 class="sheet-title">Why onspot</h2>
						</header>
						<p class="body">
							Most apps teach you to recognise a language. You can answer the questions, then
							freeze when someone actually talks to you. That gap closes only one way: talking,
							making mistakes, and being corrected. onspot is built around that loop.
						</p>
						<p class="body">
							The prompt is a springboard, not a script. Never been to Paris? Invent a trip. The
							grammar you need to build a story under a timer is the same language real
							conversation demands.
						</p>
					</section>

					<section class="paper-sheet" data-reveal style="--reveal-delay: 90ms">
						<header class="sheet-head">
							<span class="sheet-no" aria-hidden="true">02</span>
							<h2 class="sheet-title">How it works</h2>
						</header>
						<ol class="steps">
							<li class="step-item">
								<span class="step-text">
									<strong>Pick a prompt.</strong>
									<span>Choose a topic and a mode: Exam, Casual or Free Flow.</span>
								</span>
							</li>
							<li class="step-item">
								<span class="step-text">
									<strong>Speak on the spot.</strong>
									<span>
										Talk for up to a minute. Invent a story if you like. Transcribe on your
										device, or send the take to the cloud speech provider you choose.
									</span>
								</span>
							</li>
							<li class="step-item">
								<span class="step-text">
									<strong>Get marked.</strong>
									<span>
										Your transcript — never your recording — goes to the language model you
										choose. You get corrections, explanations, and the fixed version read
										aloud.
									</span>
								</span>
							</li>
							<li class="step-item">
								<span class="step-text">
									<strong>Retake.</strong>
									<span>
										Each take lands in your timeline, so you can compare attempts side by
										side.
									</span>
								</span>
							</li>
						</ol>
					</section>
				</div>

				<section class="paper-sheet paper-sheet--wide" data-reveal style="--reveal-delay: 40ms">
					<header class="sheet-head">
						<span class="sheet-no" aria-hidden="true">03</span>
						<h2 class="sheet-title">What it is and what it isn't</h2>
					</header>

					<div class="scope-grid">
						<article class="scope-card scope-card--helps">
							<span class="tape tape--scope" aria-hidden="true"></span>
							<h3 class="scope-title">
								<span class="scope-badge scope-badge--yes" aria-hidden="true">
									<svg viewBox="0 0 16 16">
										<path
											d="M3.5 8.5l3 3 6-7"
											fill="none"
											stroke="currentColor"
											stroke-width="2"
											stroke-linecap="round"
											stroke-linejoin="round"
										/>
									</svg>
								</span>
								Helps with
							</h3>
							<ul class="scope-list">
								<li>Speaking on the spot, without freezing</li>
								<li>Feedback linked to the words you actually said</li>
								<li>Plain-language explanations, not just a score</li>
								<li>Seeing your recurring mistakes over time</li>
							</ul>
						</article>

						<article class="scope-card scope-card--not">
							<span class="tape tape--scope" aria-hidden="true"></span>
							<h3 class="scope-title">
								<span class="scope-badge scope-badge--no" aria-hidden="true">
									<svg viewBox="0 0 16 16">
										<path
											d="M4 8h8"
											fill="none"
											stroke="currentColor"
											stroke-width="2"
											stroke-linecap="round"
										/>
									</svg>
								</span>
								Doesn't try to
							</h3>
							<ul class="scope-list">
								<li>Replace a teacher or a textbook</li>
								<li>Require an account or a subscription</li>
								<li>Send your practice history to us</li>
								<li>Track you or sell your data</li>
								<li>Gamify your practice</li>
							</ul>
						</article>
					</div>

					<div class="notes">
						<p class="note">
							<span class="note-tag">Scope</span>
							Keeping onspot small is deliberate. If something doesn't fit the scope above, it
							probably won't be added.
						</p>
						<p class="note">
							<span class="note-tag">Privacy</span>
							Generated speaking prompts are shared with a small prompt database by default;
							Settings → Data turns that off. Your practice history stays in this device's
							database, and a take's transcript goes only to the model you choose. A recording
							reaches a speech provider only if you pick cloud speech-to-text.
						</p>
					</div>
				</section>

				<div data-reveal style="--reveal-delay: 100ms">
					<footer class="colophon">
						<span class="colophon-rule" aria-hidden="true"></span>
						<p>Paper, tape, and a little patience. Built by hand.</p>
					</footer>
				</div>
			</div>
		</div>
	</div>
</div>

<style>
	.about-page {
		--ink-soft: color-mix(in srgb, var(--foreground) 86%, transparent);
		--ink-faint: var(--muted-foreground);
		--font-mono: ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, monospace;
		--tape-base: #e7d9b8;
		--tape-brown: #b08a4f;
		--tape-a: color-mix(in srgb, var(--brand) 12%, var(--tape-base));
		--tape-b: color-mix(in srgb, var(--tape-brown) 20%, var(--tape-base));
		--tape-sheen: rgb(255 255 255 / 0.35);
		--tape-blend: multiply;
		--tape-shadow: 0 1px 2px rgb(60 45 20 / 0.1);
		--mark-tint: color-mix(in srgb, var(--brand) 22%, transparent);

		position: relative;
		min-height: 0;
		overflow-x: clip;
		overflow-y: auto;
		overscroll-behavior: contain;
		-webkit-overflow-scrolling: touch;
		scroll-behavior: smooth;
		padding-block: 2.25rem 4rem;
		color: var(--foreground);
	}

	:global([data-theme='dark']) .about-page {
		--tape-base: #4a4033;
		--tape-a: color-mix(in srgb, var(--brand) 20%, var(--tape-base));
		--tape-b: color-mix(in srgb, var(--warn) 18%, var(--tape-base));
		--tape-sheen: rgb(255 245 225 / 0.08);
		--tape-blend: soft-light;
		--tape-shadow: 0 1px 2px rgb(0 0 0 / 0.45);
		--mark-tint: color-mix(in srgb, var(--brand) 16%, transparent);
	}

	.about-inner {
		width: min(100%, 46rem);
		margin-inline: auto;
		padding-inline: clamp(1rem, 4vw, var(--page-gutter));
	}

	/*
	 * Large sheets are card stock, not raised keys: `--card` keeps them in the
	 * app's surface ladder, while the published key paper adds the same fine
	 * fibre as every other paper surface.
	 */
	.hero-card,
	.paper-sheet,
	.scope-card,
	.github-card-wrap,
	.github-card {
		background-image: var(--paper-key, none);
		background-position: center;
		background-size: cover;
		background-repeat: no-repeat;
		background-blend-mode: var(--key-blend);
		border: 1px solid var(--sheet-line);
	}

	.paper-sheet {
		background-color: var(--card);
		box-shadow: var(--sheet-highlight), var(--shadow-sheet);
	}

	:global([data-theme='dark']) .paper-sheet {
		background-color: var(--card);
	}

	/* ── Reveal ───────────────────────────────────────────────────── */
	:global(.reveal-ready [data-reveal]) {
		transition-property: opacity, transform;
		transition-duration: 460ms;
		transition-timing-function: cubic-bezier(0.2, 0, 0, 1);
		transition-delay: var(--reveal-delay, 0ms);
	}
	:global(.reveal-ready [data-reveal]:not(.is-revealed)) {
		opacity: 0;
		transform: translateY(14px);
	}
	:global(.reveal-ready [data-reveal].no-transition) {
		transition: none;
	}

	/* ── Hero ─────────────────────────────────────────────────────── */
	.hero-card {
		--tilt-x: 0;
		--tilt-y: 0;
		position: relative;
		padding: 2rem 1.9rem 1.9rem;
		border-radius: calc(var(--radius) + 2px);
		background-color: var(--card);
		box-shadow: var(--sheet-highlight), var(--shadow-sheet);
		transform:
			perspective(1200px)
			rotateX(calc(var(--tilt-y) * -2.5deg))
			rotateY(calc(var(--tilt-x) * 2.5deg))
			rotate(-0.5deg);
		transition: transform 260ms cubic-bezier(0.2, 0, 0, 1);
		will-change: transform;
	}

	.hero-card:hover .tape--tl {
		transform: translateY(-2px) rotate(-5deg);
	}
	.hero-card:hover .tape--tr {
		transform: translateY(-2px) rotate(4deg);
	}
	.hero-card:hover .stamp {
		transform: rotate(4deg) scale(1.03);
	}

	.hero-card {
		--tilt-x: 0;
		--tilt-y: 0;
		position: relative;
		padding: 2rem 1.9rem 1.9rem;
		border-radius: calc(var(--radius) + 2px);
		background-color: var(--card);
		box-shadow: var(--sheet-highlight), var(--shadow-sheet);
		transform:
			perspective(1200px)
			rotateX(calc(var(--tilt-y) * -2.5deg))
			rotateY(calc(var(--tilt-x) * 2.5deg))
			rotate(-0.5deg);
		transition: transform 260ms cubic-bezier(0.2, 0, 0, 1);
		will-change: transform;
	}

	.hero-card:hover .hero-logo {
		transform: rotate(-2deg) scale(1.03);
	}

	.hero-head {
		display: grid;
		grid-template-columns: 1fr auto;
		align-items: center;
		gap: 1.4rem 2rem;
	}

	.hero-logo {
		flex: none;
		width: 64px;
		height: 64px;
		border-radius: 50%;
		background-color: var(--key);
		background-image: var(--paper-key, none);
		background-size: cover;
		background-position: center;
		background-blend-mode: var(--key-blend);
		box-shadow:
			var(--neo-box-shadow-raised-2),
			inset 0 0 0 1px var(--key-line);
		color: var(--brand);
		transform: rotate(-4deg) scale(1.02);
		transition: transform 240ms cubic-bezier(0.2, 0, 0, 1), box-shadow 240ms cubic-bezier(0.2, 0, 0, 1);
	}

	.hero-logo svg {
		width: 38px;
		height: 38px;
	}

	.hero-copy {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.eyebrow {
		margin: 0;
		font: 600 0.6875rem/1 var(--font-mono);
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--ink-faint);
	}

	.hero-title {
		margin: 0;
		font-family: var(--font-serif);
		font-size: clamp(2.1rem, 1.5rem + 2.7vw, 3.1rem);
		font-weight: 600;
		line-height: 1.02;
		letter-spacing: -0.035em;
		text-wrap: balance;
	}

	.mark {
		white-space: nowrap;
		padding-inline: 0.06em;
		background: linear-gradient(
			100deg,
			transparent 58%,
			var(--mark-tint) 58% 96%,
			transparent 96%
		);
	}

	.hero-tagline {
		max-width: 34rem;
		margin: 0;
		font-family: var(--font-serif);
		font-size: 1rem;
		line-height: 1.68;
		color: var(--ink-soft);
		text-wrap: pretty;
	}

	.hero-links {
		margin-top: 0.25rem;
	}

	.text-link {
		margin-top: 0.4rem;
	}

	.text-link {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding-bottom: 1px;
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--brand);
		text-decoration: none;
		border-bottom: 1px solid color-mix(in srgb, var(--brand) 32%, transparent);
	}
	.text-link:hover {
		color: var(--brand-hover);
		border-color: currentColor;
	}
	.text-link svg {
		width: 11px;
		height: 11px;
		transition: transform 120ms ease;
	}
	.text-link:hover svg {
		transform: translateX(2px);
	}

	.link-dot {
		width: 3px;
		height: 3px;
		border-radius: 50%;
		background: var(--ink-faint);
	}

	/* ── Tape ─────────────────────────────────────────────────────── */
	.tape {
		position: absolute;
		z-index: 2;
		width: 92px;
		height: 26px;
		background-color: var(--tape-a);
		background-image:
			linear-gradient(180deg, var(--tape-sheen), transparent 45%, rgb(80 60 30 / 0.06)),
			url('../../lib/textures/tape-crepe.webp'),
			url('../../lib/textures/tape-grain.webp');
		background-position: center;
		background-size: auto, 160px 40px, 120px 120px;
		background-blend-mode: normal, var(--tape-blend), var(--tape-blend);
		box-shadow: var(--tape-shadow);
		clip-path: polygon(
			0 3px,
			4px 0,
			calc(100% - 3px) 0,
			100% 3px,
			100% calc(100% - 2px),
			calc(100% - 5px) 100%,
			4px 100%,
			0 calc(100% - 3px)
		);
		opacity: 0.9;
		pointer-events: none;
		transition: transform 200ms cubic-bezier(0.2, 0, 0, 1);
	}
	.tape--tl {
		top: -13px;
		left: 30px;
		transform: rotate(-4deg);
	}
	.tape--tr {
		top: -13px;
		right: 30px;
		background-color: var(--tape-b);
		transform: rotate(3.5deg);
	}

	.stamp {
		position: absolute;
		top: 1.1rem;
		right: 1.15rem;
		padding: 0.3rem 0.55rem 0.25rem;
		border: 2px solid color-mix(in srgb, var(--brand) 45%, transparent);
		border-radius: 4px;
		font: 700 0.625rem/1 var(--font-mono);
		letter-spacing: 0.16em;
		color: color-mix(in srgb, var(--brand) 72%, var(--foreground));
		opacity: 0.68;
		transform: rotate(6deg);
		pointer-events: none;
		transition: transform 200ms cubic-bezier(0.2, 0, 0, 1);
	}

	/* ── Flow + sheets ────────────────────────────────────────────── */
	.about-flow {
		margin-top: 2.6rem;
	}

	.sheet-row {
		display: grid;
		gap: 1.4rem;
	}

	.paper-sheet {
		position: relative;
		padding: 1.55rem 1.6rem 1.5rem 2.2rem;
		border-radius: var(--radius);
	}
	.paper-sheet--wide {
		margin-top: 1.4rem;
	}

	.paper-sheet::before {
		content: "";
		position: absolute;
		top: 1.15rem;
		bottom: 1.15rem;
		left: 1.05rem;
		width: 1px;
		background: color-mix(in srgb, var(--brand) 22%, transparent);
	}

	.sheet-head {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		margin-bottom: 0.85rem;
	}

	.sheet-no {
		flex: none;
		display: grid;
		place-items: center;
		width: 1.85rem;
		height: 1.85rem;
		border: 1.5px dashed color-mix(in srgb, var(--brand) 55%, transparent);
		border-radius: 50%;
		color: var(--brand);
		font: 700 0.65rem/1 var(--font-mono);
		letter-spacing: 0.02em;
		background: transparent;
		transform: rotate(-7deg);
		transition: transform 200ms cubic-bezier(0.2, 0, 0, 1);
	}
	.paper-sheet:hover .sheet-no {
		transform: rotate(0deg) scale(1.06);
		background: color-mix(in srgb, var(--brand) 10%, transparent);
	}

	.sheet-title {
		margin: 0;
		font-family: var(--font-serif);
		font-size: 1.2rem;
		font-weight: 600;
		line-height: 1.25;
		letter-spacing: -0.015em;
		color: var(--foreground);
		text-wrap: balance;
	}

	.body {
		max-width: 60ch;
		margin: 0 0 0.9rem;
		font-family: var(--font-serif);
		font-size: 0.9375rem;
		line-height: 1.72;
		color: var(--ink-soft);
		text-wrap: pretty;
	}
	.body:last-child {
		margin-bottom: 0;
	}

	/* ── Steps ────────────────────────────────────────────────────── */
	.steps {
		counter-reset: step;
		display: grid;
		gap: 0.85rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.step-item {
		counter-increment: step;
		display: flex;
		gap: 0.8rem;
		align-items: flex-start;
		transition: transform 160ms cubic-bezier(0.2, 0, 0, 1);
	}
	.step-item:hover {
		transform: translateX(3px);
	}
	.step-item:hover .step-text strong {
		color: var(--brand);
	}

	.step-item::before {
		content: counter(step, decimal-leading-zero);
		flex: none;
		width: 1.55rem;
		padding-block: 0.12rem;
		border-bottom: 1.5px solid color-mix(in srgb, var(--brand) 32%, transparent);
		color: var(--brand);
		font: 700 0.66rem/1.2 var(--font-mono);
		text-align: center;
	}

	.step-text {
		display: block;
		min-width: 0;
		font-family: var(--font-serif);
		font-size: 0.9375rem;
		line-height: 1.68;
		color: var(--ink-soft);
	}

	.step-text strong {
		display: block;
		font-weight: 600;
		color: var(--foreground);
	}

	/* ── Scope cards ──────────────────────────────────────────────── */
	.scope-grid {
		display: grid;
		gap: 1.15rem;
		margin-top: 0.4rem;
	}

	.scope-card {
		position: relative;
		padding: 1.35rem 1.2rem 1.1rem;
		border-radius: 10px;
		background-color: var(--key);
		box-shadow: var(--paper-emboss);
		transform: rotate(0.7deg);
		transition: transform 220ms cubic-bezier(0.2, 0, 0, 1);
	}
	.scope-card--not {
		transform: rotate(-0.6deg);
	}
	.scope-card--helps:hover {
		transform: rotate(0.2deg) translateY(-3px);
	}
	.scope-card--not:hover {
		transform: rotate(-0.15deg) translateY(-3px);
	}
	.scope-card:hover .tape--scope {
		transform: rotate(-1deg) translateY(-2px);
	}
	.scope-card--not:hover .tape--scope {
		transform: rotate(3.2deg) translateY(-2px);
	}

	.tape--scope {
		top: -9px;
		left: 50%;
		width: 58px;
		height: 18px;
		margin-left: -29px;
		background-size: auto, 120px 30px, 90px 90px;
		transform: rotate(-2deg);
	}
	.scope-card--not .tape--scope {
		background-color: var(--tape-b);
		transform: rotate(2.5deg);
	}

	.scope-title {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0 0 0.7rem;
		font-size: 0.75rem;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--foreground);
	}

	.scope-badge {
		display: grid;
		place-items: center;
		width: 1.25rem;
		height: 1.25rem;
		border-radius: 50%;
	}
	.scope-badge svg {
		width: 0.8rem;
		height: 0.8rem;
	}
	.scope-badge--yes {
		background: color-mix(in srgb, var(--good) 18%, transparent);
		color: var(--good);
	}
	.scope-badge--no {
		background: color-mix(in srgb, var(--foreground) 10%, transparent);
		color: var(--ink-faint);
	}

	.scope-list {
		margin: 0;
		padding: 0;
		list-style: none;
		background-image: repeating-linear-gradient(
			to bottom,
			transparent 0,
			transparent calc(1.55rem - 1px),
			color-mix(in srgb, var(--foreground) 7%, transparent) calc(1.55rem - 1px),
			color-mix(in srgb, var(--foreground) 7%, transparent) 1.55rem
		);
	}
	.scope-list li {
		position: relative;
		padding-left: 1.15rem;
		font-family: var(--font-serif);
		font-size: 0.875rem;
		line-height: 1.55rem;
		color: var(--ink-soft);
	}
	.scope-list li::before {
		content: "";
		position: absolute;
		top: 0.55rem;
		left: 0;
		width: 0.45rem;
		height: 0.45rem;
		border-radius: 50%;
		background: color-mix(in srgb, var(--good) 65%, transparent);
	}
	.scope-card--not .scope-list li::before {
		background: transparent;
		border: 1.5px solid color-mix(in srgb, var(--foreground) 30%, transparent);
	}

	/* ── Notes ────────────────────────────────────────────────────── */
	.notes {
		display: grid;
		gap: 0.65rem;
		margin-top: 1.15rem;
	}

	.note {
		display: flex;
		align-items: flex-start;
		gap: 0.6rem;
		max-width: 68ch;
		margin: 0;
		font-family: var(--font-serif);
		font-size: 0.8438rem;
		line-height: 1.6;
		color: var(--ink-faint);
	}
	.note-tag {
		flex: none;
		margin-top: 0.15rem;
		padding: 0.2rem 0.35rem;
		border: 1px solid color-mix(in srgb, var(--brand) 35%, transparent);
		border-radius: 3px;
		font: 700 0.6rem/1 var(--font-mono);
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--brand);
		transform: rotate(-2deg);
	}

	/* ── GitHub card ──────────────────────────────────────────────── */
	.github-card {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: stretch;
		margin: 2.2rem auto 0;
		max-width: 340px;
		width: 100%;
		padding: 1.3rem 1.4rem 1.4rem;
		border-radius: var(--radius);
		background: linear-gradient(
			135deg,
			color-mix(in srgb, var(--brand) 8%, var(--card)) 0%,
			color-mix(in srgb, var(--brand) 4%, var(--card)) 55%,
			color-mix(in srgb, var(--good) 5%, var(--card)) 100%
		);
		background-color: var(--card);
		border: 1px solid color-mix(in srgb, var(--brand) 35%, var(--sheet-line));
		box-shadow:
			var(--sheet-highlight),
			var(--shadow-sheet),
			0 0 0 1px color-mix(in srgb, var(--brand) 18%, transparent) inset,
			0 12px 30px -18px color-mix(in srgb, var(--brand) 50%, transparent);
		color: var(--foreground);
		text-decoration: none;
		transition: transform 260ms cubic-bezier(0.2, 0, 0, 1),
			box-shadow 260ms cubic-bezier(0.2, 0, 0, 1),
			border-color 260ms cubic-bezier(0.2, 0, 0, 1);
		overflow: hidden;
	}
	:global([data-theme='dark']) .github-card {
		background: linear-gradient(
			135deg,
			color-mix(in srgb, var(--brand) 14%, var(--card)) 0%,
			color-mix(in srgb, var(--brand) 8%, var(--card)) 55%,
			color-mix(in srgb, var(--good) 8%, var(--card)) 100%
		);
	}

	.github-card::before {
		content: "";
		position: absolute;
		inset: 0;
		border-radius: inherit;
		background: radial-gradient(
			ellipse 140% 80% at 80% -10%,
			color-mix(in srgb, var(--brand) 22%, transparent) 0%,
			transparent 60%
		);
		opacity: 0.6;
		pointer-events: none;
		transition: opacity 300ms ease;
	}

	.github-card:hover {
		transform: translateY(-4px);
		border-color: color-mix(in srgb, var(--brand) 55%, var(--sheet-line));
		box-shadow:
			var(--sheet-highlight),
			var(--shadow-sheet),
			0 0 0 1px color-mix(in srgb, var(--brand) 28%, transparent) inset,
			0 22px 40px -22px color-mix(in srgb, var(--brand) 60%, transparent),
			0 0 34px -10px color-mix(in srgb, var(--brand) 35%, transparent);
	}
	.github-card:hover::before {
		opacity: 1;
	}

	.github-fillet {
		position: absolute;
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: radial-gradient(
			circle at 40% 35%,
			color-mix(in srgb, var(--brand) 12%, transparent),
			transparent 70%
		);
		pointer-events: none;
		mix-blend-mode: overlay;
	}
	.github-fillet--tl { top: -2px; left: -2px; }
	.github-fillet--tr { top: -2px; right: -2px; background: radial-gradient(circle at 60% 35%, color-mix(in srgb, var(--good) 10%, transparent), transparent 70%); }
	.github-fillet--bl { bottom: -2px; left: -2px; background: radial-gradient(circle at 40% 65%, color-mix(in srgb, var(--good) 8%, transparent), transparent 70%); }
	.github-fillet--br { bottom: -2px; right: -2px; }

	.github-glow {
		position: absolute;
		opacity: 0;
		pointer-events: none;
		transition: opacity 380ms cubic-bezier(0.2, 0, 0, 1);
	}
	.github-glow--edge {
		inset: 0;
		border-radius: inherit;
		background: linear-gradient(
			160deg,
			color-mix(in srgb, var(--brand) 30%, transparent) 0%,
			transparent 55%,
			color-mix(in srgb, var(--good) 28%, transparent) 100%
		);
		mask: radial-gradient(
			ellipse 80% 60% at 50% 0%,
			black 30%,
			transparent 75%
		);
		-webkit-mask: radial-gradient(
			ellipse 80% 60% at 50% 0%,
			black 30%,
			transparent 75%
		);
	}
	.github-card:hover .github-glow,
	.github-card:hover .github-glow--edge {
		opacity: 1;
	}

	.github-shine {
		position: absolute;
		top: -60%;
		left: -30%;
		width: 70%;
		height: 180%;
		background: linear-gradient(
			180deg,
			rgb(255 255 255 / 0) 0%,
			rgb(255 255 255 / 0.5) 42%,
			rgb(255 255 255 / 0) 56%
		);
		transform: rotate(-22deg) skewX(-8deg);
		filter: blur(5px) saturate(1.2);
		opacity: 0;
		mix-blend-mode: overlay;
		pointer-events: none;
		transition: opacity 420ms cubic-bezier(0.2, 0, 0, 1);
	}
	.github-card:hover .github-shine {
		opacity: 1;
	}

	.github-stamp {
		position: absolute;
		top: 0.85rem;
		right: 1rem;
		margin-top: 0.1rem;
		padding: 0.2rem 0.5rem 0.16rem;
		border: 1.4px solid color-mix(in srgb, var(--brand) 38%, transparent);
		border-radius: 4px;
		font: 700 0.625rem/1 var(--font-mono);
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: color-mix(in srgb, var(--brand) 72%, var(--foreground));
		opacity: 0.55;
		transform: rotate(3deg);
		transition: opacity 220ms ease, transform 220ms ease, color 220ms ease;
		pointer-events: none;
	}
	.github-card:hover .github-stamp {
		opacity: 0.9;
		transform: rotate(0deg) scale(1.04);
		color: color-mix(in srgb, var(--brand) 90%, var(--foreground));
		border-color: color-mix(in srgb, var(--brand) 60%, transparent);
	}

	.github-chip {
		flex: none;
		display: grid;
		place-items: center;
		width: 2.6rem;
		height: 2.6rem;
		margin-bottom: 0.5rem;
		border-radius: 50%;
		background: radial-gradient(
			circle at 35% 25%,
			color-mix(in srgb, var(--brand) 16%, var(--ink-faint)),
			color-mix(in srgb, var(--foreground) 6%, transparent)
		);
		border: 1px solid color-mix(in srgb, var(--brand) 30%, transparent);
		color: var(--foreground);
		box-shadow: 0 2px 5px rgb(0 0 0 / 0.18), inset 0 0 0 1px color-mix(in srgb, var(--brand) 15%, transparent);
		transition: transform 260ms cubic-bezier(0.2, 0, 0, 1), box-shadow 260ms ease;
	}
	.github-chip svg {
		width: 1.25rem;
		height: 1.25rem;
	}
	.github-card:hover .github-chip {
		transform: scale(1.06) translateY(-1px);
		box-shadow: 0 6px 12px -6px rgb(0 0 0 / 0.3), inset 0 0 0 1px color-mix(in srgb, var(--brand) 22%, transparent);
	}

	.github-body {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}

	.github-name {
		font-size: 0.94rem;
		font-weight: 600;
		color: var(--foreground);
		letter-spacing: -0.01em;
	}

	.github-desc {
		font-size: 0.78rem;
		line-height: 1.5;
		color: var(--ink-faint);
		text-wrap: pretty;
	}

	.github-meta {
		margin-top: 0.35rem;
		padding-top: 0.35rem;
		border-top: 1px dashed color-mix(in srgb, var(--foreground) 14%, transparent);
		font: 600 0.66rem/1.4 var(--font-mono);
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: color-mix(in srgb, var(--good) 75%, var(--ink-faint));
	}

	.github-cta {
		flex: none;
		display: grid;
		place-items: center;
		width: 1.6rem;
		height: 1.6rem;
		margin-top: 0.7rem;
		border-radius: 50%;
		background: color-mix(in srgb, var(--brand) 10%, transparent);
		border: 1px solid color-mix(in srgb, var(--brand) 28%, transparent);
		color: color-mix(in srgb, var(--foreground) 70%, transparent);
		transition: transform 160ms ease, color 160ms ease, background 160ms ease, border-color 160ms ease;
	}
	.github-cta svg {
		width: 0.95rem;
		height: 0.95rem;
	}
	.github-card:hover .github-cta {
		color: var(--brand);
		background: color-mix(in srgb, var(--brand) 16%, transparent);
		border-color: color-mix(in srgb, var(--brand) 55%, transparent);
		transform: translate(1px, -1px);
	}

	.github-card-wrap {
		margin-block: 2.2rem auto;
	}

	@media (max-width: 640px) {
		.github-card-wrap,
		.github-card,
		.github-card:hover {
			max-width: none;
			width: 100%;
			transform: none;
		}
		.github-card-wrap {
			margin-block: 1.8rem auto;
		}
	}

	/* ── Colophon ─────────────────────────────────────────────────── */
	.colophon {
		display: flex;
		align-items: center;
		gap: 0.9rem;
		margin-top: 2.5rem;
		font: 500 0.72rem/1.5 var(--font-mono);
		letter-spacing: 0.02em;
		color: var(--ink-faint);
	}
	.colophon-rule {
		flex: 1;
		height: 1px;
		background: color-mix(in srgb, var(--foreground) 14%, transparent);
	}
	.colophon p {
		flex: none;
		margin: 0;
	}

	/* ── Focus ────────────────────────────────────────────────────── */
	.text-link:focus-visible,
	.repo-card:focus-visible,
	.github-card-wrap:focus-visible,
	.github-card:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 3px;
		border-radius: 4px;
	}

	/* ── Responsive ───────────────────────────────────────────────── */
	@media (min-width: 1024px) {
		.about-inner {
			width: min(100%, 64rem);
		}
		.sheet-row {
			grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.05fr);
			align-items: start;
		}
	}
	@media (min-width: 1280px) {
		.about-inner {
			width: min(100%, 68rem);
		}
	}

	@media (min-width: 560px) {
		.scope-grid {
			grid-template-columns: 1fr 1fr;
			align-items: start;
		}
	}

	@media (max-width: 640px) {
		.about-page {
			padding-block: 0 2.25rem;
			scroll-behavior: auto;
		}
		.hero-card {
			padding: 1.4rem 1rem 1.2rem;
			transform: rotate(-0.3deg);
		}
		.hero-card:hover {
			transform: rotate(-0.3deg);
		}
		.tape--tl {
			left: 14px;
		}
		.tape--tr {
			right: 16px;
		}
		.stamp {
			display: none;
		}
		.paper-sheet {
			padding: 1.2rem 1rem 1.1rem 1.5rem;
		}

		.paper-sheet::before {
			left: 0.55rem;
		}
		.sheet-no {
			width: 1.45rem;
			height: 1.45rem;
			font-size: 0.5rem;
		}
		.hero-title {
			font-size: clamp(1.7rem, 7vw, 2rem);
			letter-spacing: -0.03em;
			line-height: 1.05;
		}
		.hero-tagline {
			font-size: 0.86rem;
			margin-top: 0.6rem;
			line-height: 1.5;
		}
		.eyebrow {
			font-size: 0.6rem;
			margin-bottom: 0.4rem;
		}
		.hero-links {
			gap: 0.5rem;
			margin-top: 0.9rem;
		}
		.text-link,
		.github-name {
			font-size: 0.78rem;
		}
		.github-desc {
			font-size: 0.73rem;
			line-height: 1.45;
		}
		.github-chip {
			width: 2.2rem;
			height: 2.2rem;
			margin-bottom: 0.35rem;
		}
		.github-chip svg {
			width: 1.05rem;
			height: 1.05rem;
		}
		.github-stamp {
			top: 0.6rem;
			right: 0.7rem;
			font-size: 0.52rem;
			padding: 0.14rem 0.4rem 0.1rem;
		}
		.github-cta {
			width: 1.4rem;
			height: 1.4rem;
			margin-top: 0.5rem;
		}
		.github-cta svg {
			width: 0.8rem;
			height: 0.8rem;
		}
		.github-card {
			padding: 1.05rem 1.1rem 1.1rem;
		}
		.colophon {
			font-size: 0.66rem;
			gap: 0.7rem;
			margin-top: 1.6rem;
		}
		.github-card-wrap {
			margin-block: 1.3rem auto;
		}
		.link-dot {
			display: none;
		}
		.paper-sheet--wide {
			margin-top: 1.2rem;
		}
		.scope-card--helps,
		.scope-card--not,
		.repo-card,
		.repo-card:hover {
			transform: none;
		}
		.scope-card--helps:hover,
		.scope-card--not:hover {
			transform: translateY(-2px);
		}
		.github-card-wrap,
		.github-card,
		.github-card:hover {
			transform: none;
		}
		.colophon {
			align-items: flex-start;
		}
	}

	@media (max-width: 420px) {
		.link-dot {
			display: none;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.about-page {
			scroll-behavior: auto;
		}
		.hero-card,
		.hero-logo,			.tape,
			.stamp,
			.text-link svg,
			.step-item,
			.scope-card,
			.sheet-no,
			.repo-card,
			.repo-clip,
			.repo-cta,
			.github-card,
			.github-fillet,
			.github-glow,
			.github-glow--edge,
			.github-shine,
			.github-cta {
			transition: none;
		}
		.hero-card,
		.hero-card:hover {
			transform: rotate(-0.5deg);
		}
		.hero-card:hover .hero-logo {
			transform: rotate(-4deg);
		}
		.step-item:hover {
			transform: none;
		}
		.scope-card--helps,
		.scope-card--helps:hover {
			transform: rotate(0.7deg);
		}
		.scope-card--not,
		.scope-card--not:hover {
			transform: rotate(-0.6deg);
		}			.repo-card,
			.repo-card:hover {
			transform: rotate(0.3deg);
		}
		.github-card-wrap,
		.github-card,
		.github-card:hover {
			transform: none;
		}
	}
</style>
