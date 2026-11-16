<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

<script lang="ts">
	import { onMount, type Component } from 'svelte';
	import AppHeader from '#lib/components/AppHeader.svelte';

	/*
	 * Development tool: the Rust migration (including the schema-9 fixture through an in-memory SQLite), settings and history through the SQL host, and the secret-leak regression.
	 * Loaded only in a dev build; `bun run build` drops the import, so the
	 * check never ships.
	 */
	let Check = $state<Component | null>(null);

	onMount(() => {
		if (!import.meta.env.DEV) return;
		void import('./StorageCheck.svelte').then((module) => {
			Check = module.default;
		});
	});
</script>

<div class="flex h-full flex-col">
	<AppHeader title="Storage check" />
	<main class="mx-auto flex w-full max-w-xl flex-col gap-4 p-6">
		{#if !import.meta.env.DEV}
			<p class="text-sm text-muted-foreground">This page is for development builds only.</p>
		{:else if Check}
			<Check />
		{/if}
	</main>
</div>
