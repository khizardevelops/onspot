<script lang="ts">
	import { quickTooltip } from '$lib/neo';
	import '../app.css';
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { initSettings, appSettings, settingsReady } from '$lib/stores/settings';
	import { initPractice, newSession } from '$lib/stores/practice';
	import { toast } from '$lib/stores/toast';
	import Toasts from '$lib/components/Toasts.svelte';
	import LanguagePicker from '$lib/components/LanguagePicker.svelte';
	import PermissionsPrompt from '$lib/components/PermissionsPrompt.svelte';
	import LanguageDownloadBar from '$lib/components/LanguageDownloadBar.svelte';
	import PaperTexture from '$lib/components/PaperTexture.svelte';
	import NeoThemeSync from '$lib/components/NeoThemeSync.svelte';
	import type { PaperTextureParams } from '@paper-design/shaders';
	import { NeoButton } from '@dvcol/neo-svelte/buttons';
	import type { NeoMenuItem } from '@dvcol/neo-svelte/floating/menu';
	import PopMenu from '$lib/components/PopMenu.svelte';
	import { NeoTooltip } from '@dvcol/neo-svelte/floating/tooltips';
	import { NeoThemeProvider } from '@dvcol/neo-svelte/providers';
	import { BarChart3, History, Menu, Mic, Moon, Plus, Settings2, Sun } from '@lucide/svelte';

	let { children } = $props();
	/* Resolved before the first render: NeoThemeProvider must start on the right theme (see NeoThemeSync). */
	function storedTheme(): 'light' | 'dark' {
		let stored: string | null = null;
		try {
			stored = localStorage.getItem('onspot.theme');
		} catch {
			// Storage may be disabled.
		}
		if (stored === 'dark' || stored === 'light') return stored;
		return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
	}
	const initialTheme = storedTheme();
	let theme = $state<'light' | 'dark'>(initialTheme);
	document.documentElement.setAttribute('data-theme', initialTheme);
	let mobileMenuOpen = $state(false);

	/*
	 * Paper Shaders' paper texture, tuned to gently crumpled paper: soft crumple
	 * and wrinkle facets, almost no grain or fibre, no speckles. The rail uses
	 * smaller, denser facets so it reads as a separate sheet. Colours sit on the
	 * theme's --background / --rail-bg; dark mode lightens the facets instead.
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
	const RAIL_PAPER: PaperTextureParams = {
		...COVER,
		roughness: 0.12,
		roughnessSize: 0.6,
		fiber: 0.1,
		fiberSize: 0.3,
		folds: 0,
		wrinkles: 0.45,
		wrinkleSize: 0.45,
		crumples: 0.5,
		crumpleCount: 6,
		drops: 0,
		seed: 27
	};
	const PAPER: Record<'light' | 'dark', { page: PaperTextureParams; rail: PaperTextureParams }> = {
		light: {
			page: { ...PAGE_PAPER, colorBack: '#efeae0', colorPaper: '#f2ede3', colorShadow: '#c2b7a2' },
			rail: { ...RAIL_PAPER, colorBack: '#e3dbcb', colorPaper: '#e5ddcd', colorShadow: '#b1a58e' }
		},
		dark: {
			page: { ...PAGE_PAPER, colorBack: '#151412', colorPaper: '#171613', colorShadow: '#3d3830' },
			rail: { ...RAIL_PAPER, colorBack: '#0f0e0d', colorPaper: '#11100e', colorShadow: '#302b25' }
		}
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
		dark: { ...KEY_PAPER, colorBack: '#000000', colorPaper: '#000000', colorShadow: '#28241f' }
	};
	const PAGE_PAPERS = [PAPER.light.page, PAPER.dark.page];
	const RAIL_PAPERS = [PAPER.light.rail, PAPER.dark.rail];
	const paper = $derived(PAPER[theme]);

	const nav = [
		{ href: '/', label: 'Practice', icon: Mic },
		{ href: '/history/', label: 'History', icon: History },
		{ href: '/insights/', label: 'Insights', icon: BarChart3 },
		{ href: '/settings/', label: 'Settings', icon: Settings2 }
	];

	function applyTheme(next: 'light' | 'dark'): void {
		theme = next;
		document.documentElement.setAttribute('data-theme', next);
		try {
			localStorage.setItem('onspot.theme', next);
		} catch {
			// Storage may be disabled.
		}
	}

	function toggleTheme(): void {
		const next = theme === 'dark' ? 'light' : 'dark';
		const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
		const doc = document as Document & {
			startViewTransition?: (update: () => void) => { finished: Promise<void> };
		};
		if (!reduced && doc.startViewTransition) doc.startViewTransition(() => applyTheme(next));
		else applyTheme(next);
	}

	function startNewSession(): void {
		newSession();
		void goto('/');
	}

	const menuIcons: Record<string, typeof Mic> = { new: Plus, ...Object.fromEntries(nav.map((n) => [n.href, n.icon])) };
	const mobileItems = $derived<NeoMenuItem[]>([
		{ value: 'new', label: 'New session', before: menuIcon, divider: { bottom: true } },
		...nav.map((item, i) => ({
			value: item.href,
			label: item.label,
			before: menuIcon,
			color: page.url.pathname === item.href ? 'primary' : undefined,
			divider: i === nav.length - 1 ? { bottom: true } : undefined
		})),
		{ value: 'theme', label: theme === 'dark' ? 'Light appearance' : 'Dark appearance', before: menuIcon }
	]);

	function onMobileSelect(item: NeoMenuItem): void {
		if (item.value === 'new') startNewSession();
		else if (item.value === 'theme') toggleTheme();
		else void goto(String(item.value));
	}

	onMount(() => {
		applyTheme(initialTheme);
		void initSettings()
			.then(() => {
				// Practice needs the persisted language, so it waits for settings.
				// The language-data status re-checks itself in its store subscription.
				return initPractice();
			})
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
</script>

<PaperTexture class="paper-page" params={paper.page} preloadParams={PAGE_PAPERS} publishAs="--paper-page" />
<PaperTexture class="paper-key" params={KEY[theme]} preloadParams={[KEY.light, KEY.dark]} publishAs="--paper-key" />

{#snippet menuIcon({ item }: { item: { value: unknown } })}
	{@const Icon = item.value === 'theme' ? (theme === 'dark' ? Sun : Moon) : menuIcons[String(item.value)]}
	<Icon size={17} strokeWidth={1.8} />
{/snippet}

<!-- The provider's props must never change after mount; NeoThemeSync applies theme switches. -->
<NeoThemeProvider theme={initialTheme} remember={false} reset={false}>
	<NeoThemeSync {theme} />
	<div class="app-shell relative z-[1] grid h-dvh grid-cols-[56px_1fr] text-foreground">
		<aside class="app-rail relative z-[1] flex flex-col items-center gap-1 py-3 pr-1.5">
			<PaperTexture class="paper-rail" params={paper.rail} preloadParams={RAIL_PAPERS} />
			<div class="brand-mark mb-3 grid size-9 place-items-center rounded-[13px] text-sm font-semibold text-white shadow-lg" role="img" aria-label="onspot">o</div>

			<NeoTooltip tooltip="New session" placement="right" {...quickTooltip}>
				<NeoButton aria-label="New session" class="rail-action mb-3" rounded elevation={2} onclick={startNewSession}>
					{#snippet icon()}<Plus size={19} strokeWidth={1.8} />{/snippet}
				</NeoButton>
			</NeoTooltip>

			<nav class="rail-nav flex flex-col items-center gap-2.5" aria-label="Primary navigation">
				{#each nav as item (item.href)}
					{@const Icon = item.icon}
					{@const active = page.url.pathname === item.href}
					<NeoTooltip tooltip={item.label} placement="right" {...quickTooltip}>
						<NeoButton
							href={item.href}
							aria-label={item.label}
							aria-current={active ? 'page' : undefined}
							class="rail-action {active ? 'active' : ''}"
							rounded
							elevation={active ? -2 : 2}
							hover={active ? 0 : -1}
							color={active ? 'primary' : undefined}
						>
							{#snippet icon()}<Icon size={19} strokeWidth={active ? 2 : 1.75} />{/snippet}
						</NeoButton>
					</NeoTooltip>
				{/each}
			</nav>

			<div class="flex-1"></div>

			<NeoTooltip tooltip={theme === 'dark' ? 'Light appearance' : 'Dark appearance'} placement="right" {...quickTooltip}>
				<NeoButton aria-label={theme === 'dark' ? 'Switch to light appearance' : 'Switch to dark appearance'} class="rail-action" rounded elevation={2} onclick={toggleTheme}>
					{#snippet icon()}
						{#key theme}
							<span class="grid place-items-center" in:fade={{ duration: 90 }}>
								{#if theme === 'dark'}<Sun size={19} strokeWidth={1.75} />{:else}<Moon size={19} strokeWidth={1.75} />{/if}
							</span>
						{/key}
					{/snippet}
				</NeoButton>
			</NeoTooltip>
		</aside>

		<main class="page-sheet paper-surface min-w-0 overflow-hidden">
			{#key page.url.pathname}
				<div class="h-full" in:fade={{ duration: 90 }}>
					{@render children()}
				</div>
			{/key}
		</main>

		<!-- Phone navigation is intentionally disclosed: it does not steal 60px from content. -->
		<div class="mobile-menu">
			<PopMenu
				items={mobileItems}
				bind:open={mobileMenuOpen}
				placement="bottom-end"
				onSelect={onMobileSelect}
				rounded
			>
				<NeoButton class="mobile-menu-trigger" aria-label="Open navigation menu" aria-expanded={mobileMenuOpen} rounded elevation={2}>
					{#snippet icon()}<Menu size={20} strokeWidth={1.8} />{/snippet}
				</NeoButton>
			</PopMenu>
		</div>
	</div>

	<Toasts />
	<LanguageDownloadBar />

	{#if $settingsReady && !$appSettings.targetLanguage}
		<LanguagePicker />
	{:else if $settingsReady && page.url.pathname === '/'}
		<!-- Only where it is needed: Practice records. History, Insights and Settings never ask. -->
		<PermissionsPrompt />
	{/if}
</NeoThemeProvider>

<style>
	/* The page and rail textures are WebGL canvases; the plain colours show until they render. */
	:global(.paper-page) {
		position: fixed;
		inset: 0;
		z-index: 0;
		pointer-events: none;
	}
	/* Only published as --paper-key; never painted itself. */
	:global(.paper-key) {
		position: fixed;
		inset: 0;
		z-index: -1;
		visibility: hidden;
		pointer-events: none;
	}
	:global(.paper-rail) {
		position: absolute;
		inset: 0;
		z-index: -1;
		pointer-events: none;
	}
	.app-rail {
		isolation: isolate;
		background: var(--rail-bg);
	}

	/*
	 * The rail is the desk and the page is a sheet laid on it: the page's left
	 * corners are rounded, it overlaps the rail slightly, and it casts a soft
	 * shadow back onto the rail. Nothing is drawn on the seam itself.
	 */
	.app-shell {
		background: var(--rail-bg);
	}
	.page-sheet {
		position: relative;
		z-index: 2;
		margin-left: -6px;
		border-radius: 18px 0 0 18px;
		box-shadow: var(--page-edge-shadow);
	}
	.brand-mark { background: linear-gradient(145deg, var(--brand), var(--brand-2) 62%, var(--brand-3)); }

	/*
	 * Rail keys are neo buttons: raised neumorphic keys on the rail, the current
	 * page pressed in and tinted primary. Only their footprint is set here; the
	 * relief and states come from neo-svelte.
	 */
	.app-rail :global(.neo-button.rail-action) {
		width: 40px;
		height: 40px;
		padding: 0;
		justify-content: center;
		/* Neutral ink, so the accent marks only the current section. */
		color: var(--muted-foreground);
	}
	.app-rail :global(.neo-button.rail-action:hover) { color: var(--foreground); }
	/* neo recolours a key's content on hover/press; the current section stays accent throughout. */
	.app-rail :global(.neo-button.rail-action.active),
	.app-rail :global(.neo-button.rail-action.active:hover) {
		color: var(--primary);
		--neo-btn-text-color: var(--primary);
		--neo-text-color-hover: var(--primary);
		--neo-text-color-active: var(--primary);
		--neo-text-color-hover-active: var(--primary);
	}
	.app-rail :global(.neo-button.rail-action.active *) { color: var(--primary); }
	.mobile-menu { display: none; }
	@media (max-width: 640px) {
		.app-shell {
			grid-template-columns: minmax(0, 1fr);
			grid-template-rows: minmax(0, 1fr);
		}
		/* Phone content gets the whole viewport; navigation is in the disclosed menu. */
		.app-rail { display: none; }
		.page-sheet {
			margin-left: 0;
			border-radius: 0;
			box-shadow: none;
		}
		.mobile-menu {
			display: block;
			position: fixed;
			top: 10px;
			right: 10px;
			z-index: 80;
		}
		.mobile-menu :global(.neo-button.mobile-menu-trigger) {
			width: 44px;
			height: 44px;
			padding: 0;
			justify-content: center;
			background-color: var(--background);
			color: var(--muted-foreground);
		}
		/* Practice is the only page with a top-row control: keep it compact and
		   reserve horizontal, never vertical, room for the floating menu. */
		:global(.session-header) {
			min-height: 52px;
			padding: 8px 62px 8px 14px;
			gap: 8px;
		}
	}
</style>
