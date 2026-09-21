<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { initSettings, appSettings, settingsReady } from '$lib/stores/settings';
	import { initPractice, newSession } from '$lib/stores/practice';
	import { toast } from '$lib/stores/toast';
	import Toasts from '$lib/components/Toasts.svelte';
	import LanguagePicker from '$lib/components/LanguagePicker.svelte';
	import LanguageDownloadBar from '$lib/components/LanguageDownloadBar.svelte';
	import PaperTexture from '$lib/components/PaperTexture.svelte';
	import type { PaperTextureParams } from '@paper-design/shaders';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { BarChart3, History, Menu, Mic, Moon, Plus, Settings2, Sun } from '@lucide/svelte';

	let { children } = $props();
	let theme = $state<'light' | 'dark'>('light');
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

	onMount(() => {
		let stored: string | null = null;
		try {
			stored = localStorage.getItem('onspot.theme');
		} catch {
			// Storage may be disabled.
		}
		const initial =
			stored === 'dark' || stored === 'light'
				? stored
				: matchMedia('(prefers-color-scheme: dark)').matches
					? 'dark'
					: 'light';
		applyTheme(initial);
		void initSettings()
			.then(() => {
				// Practice needs the persisted language, so it waits for settings.
				// The language-data status re-checks itself in its store subscription.
				return initPractice();
			})
			.catch((error) => {
				console.error('[startup] saved data could not be loaded', error);
				toast('Saved data could not be loaded. History has details and a retry action.', 6000);
			});
	});
</script>

<PaperTexture class="paper-page" params={paper.page} preloadParams={PAGE_PAPERS} publishAs="--paper-page" />

<Tooltip.Provider delayDuration={350}>
	<div class="app-shell relative z-[1] grid h-screen grid-cols-[56px_1fr] text-foreground">
		<aside class="app-rail relative z-[1] flex flex-col items-center gap-1 py-3 pr-1.5">
			<PaperTexture class="paper-rail" params={paper.rail} preloadParams={RAIL_PAPERS} />
			<div class="brand-mark mb-3 grid size-9 place-items-center rounded-[13px] text-sm font-semibold text-white shadow-lg" aria-label="onspot">o</div>

			<Tooltip.Root>
				<Tooltip.Trigger aria-label="New session" class="rail-action paper-grain mb-3 grid size-10 place-items-center rounded-[14px]" onclick={startNewSession}>
					<Plus size={19} strokeWidth={1.8} />
				</Tooltip.Trigger>
				<Tooltip.Content side="right">New session</Tooltip.Content>
			</Tooltip.Root>

			<nav class="rail-nav flex flex-col items-center gap-2.5" aria-label="Primary navigation">
				{#each nav as item (item.href)}
					{@const Icon = item.icon}
					{@const active = page.url.pathname === item.href}
					<Tooltip.Root>
						<Tooltip.Trigger>
							{#snippet child({ props })}
								<a
									{...props}
									href={item.href}
									aria-label={item.label}
									class="rail-action paper-grain relative grid size-10 place-items-center rounded-[14px] {active ? 'active' : ''}"
								>
									<Icon size={19} strokeWidth={active ? 2 : 1.75} />
								</a>
							{/snippet}
						</Tooltip.Trigger>
						<Tooltip.Content side="right">{item.label}</Tooltip.Content>
					</Tooltip.Root>
				{/each}
			</nav>

			<div class="flex-1"></div>

			<Tooltip.Root>
				<Tooltip.Trigger aria-label="Toggle theme" class="rail-action paper-grain grid size-10 place-items-center rounded-[14px]" onclick={toggleTheme}>
					{#key theme}
						<span in:fade={{ duration: 180 }} out:fade={{ duration: 100 }}>
							{#if theme === 'dark'}<Sun size={19} strokeWidth={1.75} />{:else}<Moon size={19} strokeWidth={1.75} />{/if}
						</span>
					{/key}
				</Tooltip.Trigger>
				<Tooltip.Content side="right">{theme === 'dark' ? 'Light appearance' : 'Dark appearance'}</Tooltip.Content>
			</Tooltip.Root>
		</aside>

		<main class="page-sheet paper-surface min-w-0 overflow-hidden">
			{#key page.url.pathname}
				<div class="h-full" in:fly={{ y: 5, duration: 280, opacity: 0 }} out:fade={{ duration: 120 }}>
					{@render children()}
				</div>
			{/key}
		</main>

		<!-- Phone navigation is intentionally disclosed: it does not steal 60px from content. -->
		<div class="mobile-menu">
			<DropdownMenu.Root bind:open={mobileMenuOpen}>
				<DropdownMenu.Trigger
					class="mobile-menu-trigger paper-grain grid size-11 place-items-center rounded-[14px]"
					aria-label="Open navigation menu"
					aria-expanded={mobileMenuOpen}
				>
					<Menu size={20} strokeWidth={1.8} />
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="end" sideOffset={8} class="mobile-menu-content w-56 p-1.5">
					<DropdownMenu.Label>onspot</DropdownMenu.Label>
					<DropdownMenu.Item class="min-h-11" onSelect={startNewSession}>
						<Plus /> New session
					</DropdownMenu.Item>
					<DropdownMenu.Separator />
					{#each nav as item (item.href)}
						{@const Icon = item.icon}
						<DropdownMenu.Item
							class="min-h-11"
							data-current={page.url.pathname === item.href ? '' : undefined}
							onSelect={() => void goto(item.href)}
						>
							<Icon strokeWidth={page.url.pathname === item.href ? 2 : 1.75} /> {item.label}
						</DropdownMenu.Item>
					{/each}
					<DropdownMenu.Separator />
					<DropdownMenu.Item class="min-h-11" onSelect={toggleTheme}>
						{#if theme === 'dark'}<Sun /> Light appearance{:else}<Moon /> Dark appearance{/if}
					</DropdownMenu.Item>
				</DropdownMenu.Content>
			</DropdownMenu.Root>
		</div>
	</div>
</Tooltip.Provider>

<Toasts />
<LanguageDownloadBar />

{#if $settingsReady && !$appSettings.targetLanguage}
	<LanguagePicker />
{/if}

<style>
	/* The page and rail textures are WebGL canvases; the plain colours show until they render. */
	:global(.paper-page) {
		position: fixed;
		inset: 0;
		z-index: 0;
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
	 * Rail keys sit in wells pressed into the rail (sea-glass stock, debossed).
	 * The current page is the one key that stands up: a raised teal key like the
	 * Exam / Casual knob. Pressing any key sinks it.
	 */
	:global(.rail-action) {
		background-color: var(--control);
		color: var(--on-control);
		box-shadow: var(--paper-deboss);
		transition:
			color 180ms ease,
			background-color 180ms ease,
			box-shadow 200ms ease,
			transform 200ms cubic-bezier(0.22, 1, 0.36, 1);
	}
	:global(.rail-action:hover) {
		background-color: var(--control-hover);
	}
	:global(.rail-action.active) {
		background-color: var(--primary);
		color: var(--primary-foreground);
		box-shadow: var(--paper-emboss-hover), 0 4px 10px -4px color-mix(in srgb, var(--primary) 55%, transparent);
		transform: translateY(-1px);
	}
	:global(.rail-action:active),
	:global(.rail-action.active:active) {
		box-shadow: var(--paper-deboss);
		transform: translateY(0) scale(0.97);
	}
	:global(.rail-action:focus-visible) {
		outline: 2px solid color-mix(in srgb, var(--ring) 60%, transparent);
		outline-offset: 2px;
	}
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
		:global(.mobile-menu-trigger) {
			border: 1px solid var(--control-line);
			background-color: var(--control);
			color: var(--on-control);
			box-shadow: var(--paper-emboss);
		}
		:global(.mobile-menu-trigger[aria-expanded='true']) { box-shadow: var(--paper-deboss); }
		:global(.mobile-menu-content [data-current]) {
			background: var(--brand-soft);
			color: var(--brand);
			font-weight: 600;
		}
		/* Practice is the only page with a top-row control: keep it compact and
		   reserve horizontal, never vertical, room for the floating menu. */
		:global(.session-header) {
			min-height: 52px;
			padding: 8px 62px 8px 14px;
			gap: 8px;
		}
		:global(.session-header .paper-segmented) { height: 36px; }
		:global(.session-header .paper-segmented-option) { padding-inline: 9px; }
	}
	@media (prefers-reduced-motion: reduce) { :global(.rail-action) { transition-duration: 1ms; } }
</style>
