<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { initSettings } from '$lib/stores/settings';
	import { initPractice, newSession } from '$lib/stores/practice';
	import Toasts from '$lib/components/Toasts.svelte';
	import { BarChart3, History, Mic, Moon, Plus, Settings2, Sun } from '@lucide/svelte';

	let { children } = $props();
	let theme = $state<'light' | 'dark'>('light');

	const nav = [
		{ href: '/', label: 'Practice', icon: Mic },
		{ href: '/history/', label: 'History', icon: History },
		{ href: '/insights/', label: 'Insights', icon: BarChart3 },
		{ href: '/settings/', label: 'Settings', icon: Settings2 }
	];

	function applyTheme(next: 'light' | 'dark') {
		theme = next;
		document.documentElement.setAttribute('data-theme', next);
		try {
			localStorage.setItem('onspot.theme', next);
		} catch {
			// storage disabled
		}
	}

	function startNewSession() {
		newSession();
		void goto('/');
	}

	onMount(() => {
		let stored: string | null = null;
		try {
			stored = localStorage.getItem('onspot.theme');
		} catch {
			// storage disabled
		}
		const initial =
			stored === 'dark' || stored === 'light'
				? stored
				: window.matchMedia('(prefers-color-scheme: dark)').matches
					? 'dark'
					: 'light';
		applyTheme(initial);
		void initSettings();
		void initPractice();
	});
</script>

<div class="grid h-screen grid-cols-[60px_1fr] bg-background text-foreground">
	<aside class="flex flex-col items-center gap-1 border-r py-3.5" style="background: var(--rail-bg)">
		<div
			class="mb-3 grid h-8 w-8 place-items-center rounded-lg font-serif text-base font-semibold text-white"
			style="background: var(--brand)"
		>
			o
		</div>

		<button
			type="button"
			title="New session"
			aria-label="New session"
			class="grid h-[38px] w-[38px] place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-[var(--surface-2)] hover:text-foreground"
			onclick={startNewSession}
		>
			<Plus size={19} strokeWidth={1.75} />
		</button>

		{#each nav as item (item.href)}
			{@const Icon = item.icon}
			{@const active = page.url.pathname === item.href}
			<a
				href={item.href}
				title={item.label}
				aria-label={item.label}
				class="grid h-[38px] w-[38px] place-items-center rounded-lg transition-colors {active
					? 'text-[var(--brand)]'
					: 'text-muted-foreground hover:bg-[var(--surface-2)] hover:text-foreground'}"
				style={active ? 'background: var(--brand-soft)' : ''}
			>
				<Icon size={19} strokeWidth={1.75} />
			</a>
		{/each}

		<div class="flex-1"></div>

		<button
			type="button"
			title="Theme"
			aria-label="Toggle theme"
			class="grid h-[38px] w-[38px] place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-[var(--surface-2)] hover:text-foreground"
			onclick={() => applyTheme(theme === 'dark' ? 'light' : 'dark')}
		>
			{#if theme === 'dark'}<Sun size={19} strokeWidth={1.75} />{:else}<Moon
					size={19}
					strokeWidth={1.75}
				/>{/if}
		</button>
	</aside>

	<main class="min-w-0 overflow-hidden">
		{@render children()}
	</main>
</div>

<Toasts />
