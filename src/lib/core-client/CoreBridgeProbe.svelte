<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

<script lang="ts">
	/**
	 * Development readout for P1: boots the core through the running transport,
	 * sends `core.ping` and keeps the last three events. Mounted by the root
	 * layout only in dev builds; `bun run build` contains none of it.
	 */
	import { onMount } from 'svelte';
	import { getCoreClient } from './client';
	import type { InitResponse, PingResponse, UiEvent } from './types.gen';

	let transport = $state('starting…');
	let init = $state<InitResponse | null>(null);
	let ping = $state<PingResponse | null>(null);
	let events = $state<UiEvent[]>([]);
	let failure = $state<string | null>(null);

	onMount(() => {
		let unsubscribe: (() => void) | null = null;

		void (async () => {
			try {
				const client = await getCoreClient();
				transport = client.transport;
				unsubscribe = client.subscribe((event) => {
					events = [...events, event].slice(-3);
				});
				ping = await client.ping({ note: 'dev probe' });
				init = {
					appVersion: ping.appVersion,
					bridgeVersion: ping.bridgeVersion,
					sequence: ping.sequence
				};
			} catch (error) {
				failure = error instanceof Error ? error.message : String(error);
			}
		})();

		return () => unsubscribe?.();
	});
</script>

<aside class="core-probe" data-testid="core-bridge-probe">
	<strong>core bridge · {transport}</strong>
	<p data-testid="core-probe-backend">
		probe on core
	</p>
	{#if failure}
		<p class="failure" data-testid="core-probe-failure">{failure}</p>
	{:else if ping && init}
		<p data-testid="core-probe-init">
			init {init.bridgeVersion} · app {init.appVersion} · seq {init.sequence}
		</p>
		<p data-testid="core-probe-ping">
			ping {ping.bridgeVersion} · app {ping.appVersion} · seq {ping.sequence} · note {ping.note}
		</p>
		<p data-testid="core-probe-events">
			events {events.map((event) => event.event).join(' → ') || 'none'}
		</p>
	{:else}
		<p>pinging…</p>
	{/if}
</aside>

<style>
	.core-probe {
		position: fixed;
		left: 8px;
		bottom: 8px;
		z-index: 60;
		max-width: min(92vw, 26rem);
		padding: 6px 8px;
		border: 1px solid var(--sheet-line);
		border-radius: 6px;
		background: var(--card);
		color: var(--muted-foreground);
		font-family: var(--font-mono);
		font-size: 10px;
		line-height: 1.45;
		pointer-events: none;
	}
	.core-probe strong {
		color: var(--foreground);
		font-weight: 600;
	}
	.core-probe p {
		margin: 0;
		overflow-wrap: anywhere;
	}
	.failure {
		color: var(--error);
	}
</style>
