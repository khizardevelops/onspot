<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

<script lang="ts">
	/**
	 * A new production build is waiting in the service worker. It never takes
	 * over by itself: the learner decides when to reload, so an update cannot
	 * interrupt a take or a feedback request.
	 */
	import { applyPwaUpdate, pwaUpdateReady } from '#lib/platform/pwa.js';
	import { NeoButton } from '@dvcol/neo-svelte/buttons';
	import { RefreshCw } from '@lucide/svelte';
</script>

{#if $pwaUpdateReady}
	<div class="pwa-update" role="status">
		<span class="pwa-update-icon" aria-hidden="true"><RefreshCw size={16} /></span>
		<p class="min-w-0 flex-1 text-sm leading-snug">
			A new version of onspot is ready.
		</p>
		<div class="flex shrink-0 items-center gap-1.5">
			<NeoButton text rounded onclick={() => pwaUpdateReady.set(false)}>Later</NeoButton>
			<NeoButton color="primary" rounded onclick={() => void applyPwaUpdate()}>Reload</NeoButton>
		</div>
	</div>
{/if}

<style>
	.pwa-update {
		position: fixed;
		right: 12px;
		/* Clear the phone bar and the language-download dock. */
		bottom: calc(172px + env(safe-area-inset-bottom));
		z-index: 120;
		display: flex;
		align-items: center;
		gap: 10px;
		width: min(34rem, calc(100vw - 24px));
		padding: 10px 12px;
		border: 1px solid var(--sheet-line);
		border-radius: 14px;
		background: var(--card);
		box-shadow: var(--sheet-highlight), var(--shadow-float);
	}
	.pwa-update-icon {
		display: grid;
		flex: 0 0 auto;
		width: 32px;
		height: 32px;
		place-items: center;
		border-radius: 10px;
		background: var(--brand-soft);
		color: var(--brand);
	}
	@media (min-width: 641px) {
		.pwa-update {
			right: 16px;
			/* Clear the desktop download dock. */
			bottom: 96px;
		}
	}
</style>
