<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import AppHeader from '#lib/components/AppHeader.svelte';
	import { longTakesSession } from '#lib/dev/longTakes.js';
	import { openSession } from '#lib/stores/practice.js';
	import { pageHref } from '#lib/pages.js';

	/*
	 * Development tool: opens a session with two simulated long takes (3 and 5
	 * minutes of French, with mistakes) to see how cards cope with long text.
	 * The first visit adds it beside the learner's own sessions; later visits
	 * open the same one. Delete it from History when done.
	 */
	let error = $state<string | null>(null);

	onMount(async () => {
		if (!import.meta.env.DEV) return;
		try {
			await openSession(await longTakesSession());
			await goto(pageHref('/'));
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		}
	});
</script>

<div class="flex h-full flex-col">
	<AppHeader title="Long takes" />
	<main class="mx-auto flex w-full max-w-xl flex-col gap-4 p-6">
		{#if !import.meta.env.DEV}
			<p class="text-sm text-muted-foreground">This page is for development builds only.</p>
		{:else if error}
			<p class="text-sm text-[var(--error)]" role="alert">Could not open the simulated long takes: {error}</p>
		{:else}
			<p class="text-sm text-muted-foreground">Opening the simulated long takes (3 and 5 minutes of French)…</p>
		{/if}
	</main>
</div>
