<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { initSettings } from '$lib/stores/settings';
	import { initPractice, newSession } from '$lib/stores/practice';
	import Toasts from '$lib/components/Toasts.svelte';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { BarChart3, History, Mic, Moon, Plus, Settings2, Sun } from '@lucide/svelte';

	let { children } = $props();
	let theme = $state<'light' | 'dark'>('light');

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
		void initSettings();
		void initPractice();
	});
</script>

<Tooltip.Provider delayDuration={350}>
	<div class="app-shell grid h-screen grid-cols-[68px_1fr] bg-background text-foreground">
		<aside class="app-rail relative z-50 flex flex-col items-center gap-1 border-r py-3">
			<div class="brand-mark mb-3 grid size-10 place-items-center rounded-[15px] text-base font-semibold text-white shadow-lg" aria-label="onspot">o</div>

			<Tooltip.Root>
				<Tooltip.Trigger aria-label="New session" class="rail-action mb-1 grid size-10 place-items-center rounded-[14px] text-muted-foreground" onclick={startNewSession}>
					<Plus size={19} strokeWidth={1.8} />
				</Tooltip.Trigger>
				<Tooltip.Content side="right">New session</Tooltip.Content>
			</Tooltip.Root>

			<nav class="rail-nav flex flex-col items-center gap-1" aria-label="Primary navigation">
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
									class="rail-action relative grid size-10 place-items-center rounded-[14px] {active ? 'active text-[var(--brand)]' : 'text-muted-foreground'}"
								>
									<Icon size={19} strokeWidth={active ? 2 : 1.75} />
									{#if active}<span class="active-indicator absolute -right-[15px] h-5 w-[3px] rounded-l-full bg-[var(--brand)]" transition:fly={{ x: 4, duration: 260 }}></span>{/if}
								</a>
							{/snippet}
						</Tooltip.Trigger>
						<Tooltip.Content side="right">{item.label}</Tooltip.Content>
					</Tooltip.Root>
				{/each}
			</nav>

			<div class="flex-1"></div>

			<Tooltip.Root>
				<Tooltip.Trigger aria-label="Toggle theme" class="rail-action grid size-10 place-items-center rounded-[14px] text-muted-foreground" onclick={toggleTheme}>
					{#key theme}
						<span in:fade={{ duration: 180 }} out:fade={{ duration: 100 }}>
							{#if theme === 'dark'}<Sun size={19} strokeWidth={1.75} />{:else}<Moon size={19} strokeWidth={1.75} />{/if}
						</span>
					{/key}
				</Tooltip.Trigger>
				<Tooltip.Content side="right">{theme === 'dark' ? 'Light appearance' : 'Dark appearance'}</Tooltip.Content>
			</Tooltip.Root>
		</aside>

		<main class="min-w-0 overflow-hidden">
			{#key page.url.pathname}
				<div class="h-full" in:fly={{ y: 5, duration: 280, opacity: 0 }} out:fade={{ duration: 120 }}>
					{@render children()}
				</div>
			{/key}
		</main>
	</div>
</Tooltip.Provider>

<Toasts />

<style>
	.app-rail {
		background:
			linear-gradient(180deg, color-mix(in srgb, var(--rail-bg) 88%, transparent), color-mix(in srgb, var(--background) 82%, transparent)),
			var(--rail-bg);
		backdrop-filter: blur(20px) saturate(140%);
	}
	.brand-mark { background: linear-gradient(145deg, var(--brand), var(--brand-2) 62%, var(--brand-3)); }
	.rail-action { transition: color 180ms ease, background-color 180ms ease, transform 220ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 220ms ease; }
	.rail-action:hover { color: var(--foreground); background: var(--surface-2); transform: translateY(-1px) scale(1.03); }
	.rail-action.active { background: var(--brand-soft); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--brand) 14%, transparent); }
	@media (max-width: 640px) {
		.app-shell {
			grid-template-columns: minmax(0, 1fr);
			grid-template-rows: minmax(0, 1fr) 60px;
		}
		.app-rail {
			grid-row: 2;
			flex-direction: row;
			gap: 2px;
			border-top: 1px solid var(--border);
			border-right: 0;
			padding: 8px 10px;
		}
		.app-rail :global(.brand-mark) { display: none; }
		.rail-nav { flex-direction: row; gap: 2px; }
		:global(.active-indicator) {
			right: auto;
			bottom: -8px;
			width: 20px;
			height: 3px;
			border-radius: 999px 999px 0 0;
		}
		.app-shell > main { grid-row: 1; }
	}
	@media (prefers-reduced-motion: reduce) { .rail-action { transition-duration: 1ms; } .rail-action:hover { transform: none; } }
</style>
