<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { pageHref } from '#lib/pages.js';
	import { initSettings, appSettings, settingsReady } from '#lib/stores/settings.js';
	import { initPractice } from '#lib/stores/practice.js';
	import { llmConfigured } from '#lib/stores/llm.js';
	import { initReminders } from '#lib/stores/reminders.js';
	import { shouldOfferOnboarding } from '#lib/onboarding.js';
	import { registerPwa } from '#lib/platform/pwa.js';
	import { applyTheme, theme } from '#lib/stores/theme.svelte.js';
	// Applies the learner's text sizes (Settings → Text size) before the first render.
	import '#lib/stores/textSize.svelte.js';
	import { toast } from '#lib/stores/toast.js';
	import Toasts from '#lib/components/Toasts.svelte';
	import LanguagePicker from '#lib/components/LanguagePicker.svelte';
	import PermissionsPrompt from '#lib/components/PermissionsPrompt.svelte';
	import LanguageDownloadBar from '#lib/components/LanguageDownloadBar.svelte';
	import PwaInstallPrompt from '#lib/components/PwaInstallPrompt.svelte';
	import PwaUpdate from '#lib/components/PwaUpdate.svelte';
	import PaperTexture from '#lib/components/PaperTexture.svelte';
	import NeoThemeSync from '#lib/components/NeoThemeSync.svelte';
	import WindowBar from '#lib/components/WindowBar.svelte';
	import { currentRuntime } from '#lib/platform/runtime.js';
	import { trackPageHistory } from '#lib/navigation/back.svelte.js';
	import { showPressesImmediately } from '#lib/gestures/pressFeedback.js';
	import type { PaperTextureParams } from '@paper-design/shaders';
	import { NeoThemeProvider } from '@dvcol/neo-svelte/providers';

	let { children } = $props();
	/* Resolved before the first render: NeoThemeProvider must start on the right theme (see NeoThemeSync). */
	const initialTheme = theme.current;
	/* The desktop app draws its own title bar; the browser and the phone apps have none. */
	const hasWindowBar = currentRuntime() === 'desktop';
	/* Back (the header's and Android's) returns to the previous onspot page, or to Practice when there is none. */
	trackPageHistory();

	/*
	 * Paper Shaders' paper texture, tuned to gently crumpled paper: soft crumple
	 * and wrinkle facets, almost no grain or fibre, no speckles. Colours sit on
	 * the theme's --background; dark mode lightens the facets instead.
	 */
	const COVER: PaperTextureParams = { fit: 'cover', scale: 1 };
	const PAGE_PAPER: PaperTextureParams = {
		...COVER,
		roughness: 0.1,
		roughnessSize: 0.6,
		fiber: 0.1,
		fiberSize: 0.3,
		// No folds: straight creases would run across the whole window.
		folds: 0,
		wrinkles: 0.4,
		wrinkleSize: 0.6,
		crumples: 0.6,
		crumpleCount: 7,
		drops: 0,
		seed: 12
	};
	const PAGE: Record<'light' | 'dark', PaperTextureParams> = {
		light: { ...PAGE_PAPER, colorBack: '#efeae0', colorPaper: '#f2ede3', colorShadow: '#c2b7a2' },
		/*
		 * Dark paper stays genuinely dark. The old shadow colour (#3d3830)
		 * lifted the rendered page to about #2c2823, within a step of the cards;
		 * the paper now lands near #1b1815, so every surface above it has room
		 * to read as a separate plane.
		 */
		dark: { ...PAGE_PAPER, colorBack: '#12110f', colorPaper: '#141210', colorShadow: '#26231f' }
	};
	/*
	 * Card stock for neo components (--paper-key): fine fibre and tooth, no
	 * crumples, so keys and wells read as a different paper from the page.
	 * It is blended over the component colour (multiply in light, screen in
	 * dark), so light mode is near-white and dark mode near-black.
	 */
	const KEY_PAPER: PaperTextureParams = {
		...COVER,
		roughness: 0.22,
		roughnessSize: 0.35,
		fiber: 0.35,
		fiberSize: 0.22,
		folds: 0,
		wrinkles: 0.12,
		wrinkleSize: 0.3,
		crumples: 0,
		drops: 0,
		seed: 41
	};
	const KEY: Record<'light' | 'dark', PaperTextureParams> = {
		light: { ...KEY_PAPER, colorBack: '#ffffff', colorPaper: '#ffffff', colorShadow: '#e2d9c8' },
		dark: { ...KEY_PAPER, colorBack: '#000000', colorPaper: '#000000', colorShadow: '#211d18' }
	};
	const PAGE_PAPERS = [PAGE.light, PAGE.dark];

	/**
	 * First run: send a learner with no usable LLM to the setup guide. Skipping
	 * or finishing the guide stops this; Settings can always reopen it.
	 */
	function offerOnboarding(): void {
		if (page.url.pathname === pageHref('/welcome')) return;
		if (!shouldOfferOnboarding()) return;
		if (get(llmConfigured)) return;
		void goto(pageHref('/welcome'));
	}

	onMount(() => {
		applyTheme(initialTheme);
		// Production web builds only; the module skips dev and the Tauri apps.
		void registerPwa();
		void initSettings()
			.then(() => {
				// Reminders follow the saved preference; start them before Practice so
				// its bar can show a due nudge as soon as the page appears.
				initReminders();
				// Practice needs the persisted language, so it waits for settings.
				// The language-data status re-checks itself in its store subscription.
				return initPractice();
			})
			.then(() => offerOnboarding())
			.catch((error) => {
				console.error('[startup] saved data could not be loaded', error);
				const message = error instanceof Error ? error.message : '';
				// A lock held by another tab is the learner's to fix, so say exactly that.
				toast(
					/another tab/.test(message)
						? message
						: 'Saved data could not be loaded. History has details and a retry action.',
					10000
				);
				// Practice keeps the reason on screen after the toast has gone.
				void initPractice().catch(() => undefined);
			});
	});

	// A finger shows a press on any neo button at once, and lets go at once.
	onMount(showPressesImmediately);
</script>

<PaperTexture class="paper-page" params={PAGE[theme.current]} preloadParams={PAGE_PAPERS} publishAs="--paper-page" />
<PaperTexture class="paper-key" params={KEY[theme.current]} preloadParams={[KEY.light, KEY.dark]} publishAs="--paper-key" />

<!-- The provider's props must never change after mount; NeoThemeSync applies theme switches. -->
<NeoThemeProvider theme={initialTheme} remember={false} reset={false}>
	<NeoThemeSync theme={theme.current} />
	{#if hasWindowBar}
		<WindowBar />
	{/if}
	<!-- Navigation lives in each page's top bar (AppHeader); the page has the rest of the window. -->
	<main
		class="app-page paper-surface relative z-[1] h-dvh min-w-0 overflow-hidden text-foreground"
		class:under-window-bar={hasWindowBar}
	>
		{#key page.url.pathname}
			<div class="page-enter h-full">
				{@render children()}
			</div>
		{/key}
	</main>

	<Toasts />
	<LanguageDownloadBar />
	<PwaUpdate />
	<PwaInstallPrompt />

	{#if $settingsReady && !$appSettings.targetLanguage}
		<LanguagePicker />
	{:else if $settingsReady && page.url.pathname === '/'}
		<!-- Only where it is needed: Practice records. History, Insights and Settings never ask. -->
		<PermissionsPrompt />
	{/if}
</NeoThemeProvider>

<style>
	/* The page texture is a WebGL canvas; the plain colour shows until it renders. */
	:global(.paper-page) {
		position: fixed;
		inset: 0;
		z-index: 0;
		pointer-events: none;
	}
	main.under-window-bar {
		height: calc(100dvh - var(--window-bar-height));
	}
	/* The installed app draws under a translucent status bar on every width. */
	:global(main.app-page) {
		padding-top: env(safe-area-inset-top);
	}
	/*
	 * Each page fades in as it replaces the last. A CSS animation, not a Svelte
	 * transition: Svelte's fade reads the new page's computed opacity first,
	 * which forced a style pass over the whole page while it was being built.
	 */
	.page-enter {
		animation: page-enter 90ms linear;
	}
	@keyframes page-enter {
		from {
			opacity: 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.page-enter {
			animation: none;
		}
	}
	/* Only published as --paper-key; never painted itself. */
	:global(.paper-key) {
		position: fixed;
		inset: 0;
		z-index: -1;
		visibility: hidden;
		pointer-events: none;
	}
</style>
