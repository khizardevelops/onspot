<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

<script lang="ts">
	import { pageHref } from '#lib/pages.js';
	/**
	 * The bar across the top of every page: onspot's navigation on the left
	 * (new session, the four sections, light or dark), then the page's own title
	 * and controls. It replaced the vertical navigation rail, which took a strip
	 * off the side of every screen. On phones the navigation folds into one menu
	 * at the end of the bar.
	 *
	 * Each page renders its own bar, so Practice can keep it above the attempt
	 * stack only and leave the Feedback panel its full height. Practice also
	 * puts its prompt and recording controls in it: there is no bottom bar.
	 * Whenever the bar is narrow (phones, or a window shared with the Feedback
	 * panel), the navigation folds into one menu so the page keeps the room.
	 * On phones the bar sits at the bottom of the screen, under the thumb.
	 *
	 * Every page but Practice starts its heading with a Back button: the
	 * previous onspot page, or Practice when there is none (see
	 * `navigation/back.svelte.ts`; Android's Back does the same).
	 *
	 * A page can give the bar a second row (`below`; Practice on phones: the
	 * prompt above, every button below). The navigation menu then starts that
	 * row, so the first row is the heading alone.
	 */
	import type { Snippet } from 'svelte';
	import { fade } from 'svelte/transition';
	import { goto } from '$app/navigation';
	import { asset } from '$app/paths';
	import { page } from '$app/state';
	import { quickTooltip } from '#lib/neo.js';
	import { goBack, onPractice } from '#lib/navigation/back.svelte.js';
	import { newSession } from '#lib/stores/practice.js';
	import { theme, toggleTheme } from '#lib/stores/theme.svelte.js';
	import PopMenu from '#lib/components/PopMenu.svelte';
	import { NeoButton } from '@dvcol/neo-svelte/buttons';
	import type { NeoMenuItem, NeoMenuProps } from '@dvcol/neo-svelte/floating/menu';
	import { NeoTooltip } from '@dvcol/neo-svelte/floating/tooltips';
	import { ArrowLeft, BarChart3, History, Menu, Mic, Moon, Plus, Settings2, Sun } from '@lucide/svelte';

	interface Props {
		/** The page's name, shown as its heading. */
		title?: string;
		/** Richer heading content instead of `title` (Practice: the session's name, language and level). */
		heading?: Snippet;
		/** The page's own controls, at the end of the bar. */
		actions?: Snippet;
		/** A second row inside the same bar, full width, after the navigation menu (Practice on phones: its buttons). */
		below?: Snippet;
		/** The bar's element (Practice on phones pulls Feedback up from it). */
		element?: HTMLElement;
		/**
		 * The bar of Settings → Text size's live preview, a copy of Practice's:
		 * no Back key (Practice has none), and its navigation looks the same but
		 * is inert, so it cannot leave the preview (its own Done does).
		 */
		preview?: boolean;
	}

	let { title = '', heading, actions, below, element = $bindable(), preview = false }: Props = $props();

	const SECTIONS = [
		{ href: pageHref('/'), label: 'Practice', icon: Mic },
		{ href: pageHref('/history'), label: 'History', icon: History },
		{ href: pageHref('/insights'), label: 'Insights', icon: BarChart3 },
		{ href: pageHref('/settings'), label: 'Settings', icon: Settings2 }
	];

	const themeLabel = $derived(theme.current === 'dark' ? 'Light appearance' : 'Dark appearance');

	let menuOpen = $state(false);

	function startNewSession(): void {
		newSession();
		void goto(pageHref('/'));
	}

	const menuIcons: Record<string, typeof Mic> = {
		new: Plus,
		...Object.fromEntries(SECTIONS.map((section) => [section.href, section.icon]))
	};

	const menuItems = $derived<NeoMenuItem[]>([
		{ value: 'new', label: 'New session', before: menuIcon, divider: { bottom: true } },
		...SECTIONS.map((section, index) => ({
			value: section.href,
			label: section.label,
			before: menuIcon,
			color: page.url.pathname === section.href ? 'primary' : undefined,
			divider: index === SECTIONS.length - 1 ? { bottom: true } : undefined
		})),
		{ value: 'theme', label: themeLabel, before: menuIcon }
	]);

	function onMenuSelect(item: NeoMenuItem): void {
		if (item.value === 'new') startNewSession();
		else if (item.value === 'theme') toggleTheme();
		else void goto(String(item.value));
	}
</script>

{#snippet menuIcon({ item }: { item: { value: unknown } })}
	{@const Icon = item.value === 'theme' ? (theme.current === 'dark' ? Sun : Moon) : menuIcons[String(item.value)]}
	<Icon size={17} strokeWidth={1.8} />
{/snippet}

<!-- A narrow bar: the navigation is one menu, so the bar keeps its room for the page. -->
{#snippet navigationMenu(placement: NeoMenuProps['placement'])}
	<div class="app-menu shrink-0" inert={preview}>
		<PopMenu items={menuItems} bind:open={menuOpen} {placement} onSelect={onMenuSelect} rounded>
			<NeoButton class="menu-trigger" aria-label="Open navigation menu" aria-expanded={menuOpen} rounded elevation={2}>
				{#snippet icon()}<Menu size={18} strokeWidth={1.8} />{/snippet}
			</NeoButton>
		</PopMenu>
	</div>
{/snippet}

<header class="app-header paper-surface relative z-20 border-b" bind:this={element}>
	<div class="app-header-row">
		<nav class="app-nav flex shrink-0 items-center gap-1.5" aria-label="Primary navigation" inert={preview}>
			<!-- The app icon cropped to its tile (brand-assets/app-icon-tile.svg), as the favicon. -->
			<img class="mr-1 size-9 shrink-0" src={asset('app-icon.svg')} alt="onspot" width="36" height="36" />

			<NeoTooltip tooltip="New session" placement="bottom" {...quickTooltip}>
				<NeoButton aria-label="New session" class="nav-key" rounded elevation={2} onclick={startNewSession}>
					{#snippet icon()}<Plus size={16} strokeWidth={1.8} />{/snippet}
				</NeoButton>
			</NeoTooltip>

			{#each SECTIONS as section (section.href)}
				{@const Icon = section.icon}
				{@const current = page.url.pathname === section.href}
				<NeoTooltip tooltip={section.label} placement="bottom" {...quickTooltip}>
					<NeoButton
						href={section.href}
						aria-label={section.label}
						aria-current={current ? 'page' : undefined}
						class="nav-key {current ? 'current' : ''}"
						rounded
						elevation={current ? -2 : 2}
						hover={current ? 0 : -1}
						color={current ? 'primary' : undefined}
					>
						{#snippet icon()}<Icon size={16} strokeWidth={current ? 2 : 1.75} />{/snippet}
					</NeoButton>
				</NeoTooltip>
			{/each}

			<NeoTooltip tooltip={themeLabel} placement="bottom" {...quickTooltip}>
				<NeoButton aria-label={`Switch to ${themeLabel.toLowerCase()}`} class="nav-key" rounded elevation={2} onclick={toggleTheme}>
					{#snippet icon()}
						{#key theme.current}
							<span class="grid place-items-center" in:fade={{ duration: 90 }}>
								{#if theme.current === 'dark'}<Sun size={16} strokeWidth={1.75} />{:else}<Moon size={16} strokeWidth={1.75} />{/if}
							</span>
						{/key}
					{/snippet}
				</NeoButton>
			</NeoTooltip>
		</nav>

		<span class="nav-divider shrink-0" aria-hidden="true"></span>

		{#if !onPractice() && !preview}
			<NeoTooltip tooltip="Back" placement="bottom" {...quickTooltip}>
				<NeoButton aria-label="Back" class="back-key" rounded elevation={2} onclick={goBack}>
					{#snippet icon()}<ArrowLeft size={16} strokeWidth={1.8} />{/snippet}
				</NeoButton>
			</NeoTooltip>
		{/if}

		<div class="min-w-0 flex-1">
			{#if heading}
				{@render heading()}
			{:else}
				<h1 class="truncate text-base leading-tight font-semibold tracking-[-0.02em]">{title}</h1>
			{/if}
	</div>

	{#if actions}
		<div class="flex shrink-0 items-center gap-1.5">{@render actions()}</div>
	{/if}

	{#if !below}{@render navigationMenu('bottom-end')}{/if}
	</div>

	{#if below}
		<div class="app-header-below">
			{@render navigationMenu('top-start')}
			{@render below()}
		</div>
	{/if}
</header>

<style>
	/* Compact: the bar takes as little height as its keys need. */
	.app-header {
		container: app-header / inline-size;
		padding: 0.375rem var(--page-gutter);
		/* Cut from the same paper as the page; a highlight on its lower edge. */
		box-shadow: 0 1px 0 color-mix(in srgb, white 40%, transparent);
	}
	:global([data-theme='dark']) .app-header {
		box-shadow: 0 1px 0 rgba(255, 255, 255, 0.03);
	}

	.app-header-row {
		display: flex;
		align-items: center;
		gap: 0.875rem;
		min-height: 36px;
	}
	.app-header-below {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		min-height: 32px;
		margin-top: 0.125rem;
	}

	.nav-divider {
		width: 1px;
		height: 22px;
		background: var(--border);
	}

	/*
	 * Navigation keys are neo buttons: raised keys on the paper, the current
	 * section pressed in and tinted primary. Only their footprint and ink are
	 * set here; relief and states come from neo-svelte.
	 */
	.app-nav :global(.neo-button.nav-key) {
		width: 32px;
		height: 32px;
		padding: 0;
		justify-content: center;
		/* Neutral ink, so the accent marks only the current section. */
		color: var(--muted-foreground);
	}
	/* Pointers that hover only: a tapped key would keep the look until the next tap. */
	@media (hover: hover) {
		.app-nav :global(.neo-button.nav-key:hover) {
			color: var(--foreground);
		}
	}
	/* neo recolours a key's content on hover/press; the current section stays accent throughout. */
	.app-nav :global(.neo-button.nav-key.current),
	.app-nav :global(.neo-button.nav-key.current:hover) {
		color: var(--primary);
		--neo-btn-text-color: var(--primary);
		--neo-text-color-hover: var(--primary);
		--neo-text-color-active: var(--primary);
		--neo-text-color-hover-active: var(--primary);
	}
	.app-nav :global(.neo-button.nav-key.current *) {
		color: var(--primary);
	}

	/* Back is a key like the navigation's, before the page's heading. */
	.app-header-row :global(.neo-button.back-key) {
		flex-shrink: 0;
		width: 32px;
		height: 32px;
		padding: 0;
		justify-content: center;
		color: var(--muted-foreground);
	}
	@media (hover: hover) {
		.app-header-row :global(.neo-button.back-key:hover) {
			color: var(--foreground);
		}
	}

	.app-menu {
		display: none;
	}
	.app-menu :global(.neo-button.menu-trigger) {
		width: 34px;
		height: 34px;
		padding: 0;
		justify-content: center;
		color: var(--muted-foreground);
	}

	/* A narrow bar: the page gets the room; the navigation is the menu at its end. */
	@container app-header (width < 900px) {
		.app-header-row {
			gap: 0.5rem;
		}
		.app-nav,
		.nav-divider {
			display: none;
		}
		.app-menu {
			display: block;
		}
	}
	/*
	 * Phones: the bar is at the bottom, under the thumb (pages lay out as a
	 * flex column, so `order` moves it there), clear of the gesture area, its
	 * edge and shadow on top.
	 */
	@media (max-width: 640px) {
		.app-header {
			order: 99;
			padding: 0.25rem var(--page-gutter) calc(0.25rem + env(safe-area-inset-bottom));
			border-top: 1px solid var(--border);
			border-bottom-width: 0;
			box-shadow:
				0 -1px 0 color-mix(in srgb, white 40%, transparent),
				0 -8px 18px -10px rgb(60 50 35 / 0.25);
		}
		:global([data-theme='dark']) .app-header {
			box-shadow: 0 -8px 18px -10px rgb(0 0 0 / 0.6);
		}
		.app-header-row {
			gap: 0.375rem;
		}
	}
</style>
