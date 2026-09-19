<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { initSettings, appSettings, settingsReady } from '$lib/stores/settings';
	import { initPractice, newSession } from '$lib/stores/practice';
	import Toasts from '$lib/components/Toasts.svelte';
	import LanguagePicker from '$lib/components/LanguagePicker.svelte';
	import LanguageDownloadBar from '$lib/components/LanguageDownloadBar.svelte';
	import PaperTexture from '$lib/components/PaperTexture.svelte';
	import type { PaperTextureParams } from '@paper-design/shaders';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { BarChart3, History, Mic, Moon, Plus, Settings2, Sun } from '@lucide/svelte';

	let { children } = $props();
	let theme = $state<'light' | 'dark'>('light');

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
		void initSettings().then(() => {
			// Practice needs the persisted language, so it waits for settings.
			// The language-data status re-checks itself in its store subscription.
			void initPractice();
		});
	});
</script>

<PaperTexture class="paper-page" params={paper.page} publishAs="--paper-page" />

<Tooltip.Provider delayDuration={350}>
	<div class="app-shell relative z-[1] grid h-screen grid-cols-[56px_1fr] text-foreground">
		<aside class="app-rail relative z-[1] flex flex-col items-center gap-1 py-3 pr-1.5">
			<PaperTexture class="paper-rail" params={paper.rail} />
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
	@media (max-width: 640px) {
		.app-shell {
			grid-template-columns: minmax(0, 1fr);
			grid-template-rows: minmax(0, 1fr) 60px;
		}
		.app-rail {
			grid-row: 2;
			flex-direction: row;
			gap: 2px;
			padding: 8px 10px;
		}
		/* On phones the rail is the bottom bar; the page sheet rests on it from above. */
		.page-sheet {
			margin-left: 0;
			margin-bottom: -6px;
			border-radius: 0 0 18px 18px;
			box-shadow: 0 12px 24px -14px rgba(70, 55, 30, 0.4);
		}
		.app-rail :global(.brand-mark) { display: none; }
		.rail-nav { flex-direction: row; gap: 10px; }
		.app-shell > main { grid-row: 1; }
	}
	@media (prefers-reduced-motion: reduce) { :global(.rail-action) { transition-duration: 1ms; } }
</style>
