<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

<script lang="ts">
	/**
	 * A dismissible first-visit card on an iPhone or iPad in a browser tab. The
	 * permanent version of the same steps lives in Settings → iPhone and iPad,
	 * so a dismissal never loses the instructions.
	 */
	import { page } from '$app/state';
	import { pageHref } from '#lib/pages.js';
	import {
		dismissIosInstall,
		iosBrowserName,
		iosInstallDismissed,
		isIosBrowser
	} from '#lib/platform/pwa.js';
	import { NeoButton } from '@dvcol/neo-svelte/buttons';
	import { Share, X } from '@lucide/svelte';

	const ios = isIosBrowser();
	const browser = iosBrowserName();
	let dismissed = $state(iosInstallDismissed());
	const showing = $derived(
		ios &&
			!dismissed &&
			!page.url.pathname.startsWith(pageHref('/welcome')) &&
			// Settings keeps the full instructions permanently, so the overlay would only cover them.
			!page.url.pathname.startsWith(pageHref('/settings'))
	);

	function putAway(): void {
		dismissIosInstall();
		dismissed = true;
	}
</script>

{#if showing}
	<div class="install-card" role="status" aria-labelledby="pwa-install-title">
		<span class="install-icon" aria-hidden="true"><Share size={18} /></span>
		<div class="install-body">
			<p id="pwa-install-title" class="install-title">Install onspot on this iPhone or iPad</p>
			<ol class="install-steps">
				<li>Tap <strong>Share</strong> in {browser}.</li>
				<li>Choose <strong>Add to Home Screen</strong>.</li>
				<li>Open onspot from the home screen.</li>
			</ol>
			<p class="install-note">
				Installed, onspot opens full screen and keeps its storage. Safari can clear website
				data after about a week; install first, or export and restore.
			</p>
			<p class="install-note">
				Cloud speech is the lightest option on iPhone; on-device models stay available in
				Settings.
			</p>
		</div>
		<NeoButton text rounded class="install-close" aria-label="Dismiss install instructions" title="Not now" onclick={putAway}>
			{#snippet icon()}<X size={16} />{/snippet}
		</NeoButton>
	</div>
{/if}

<style>
	.install-card {
		position: fixed;
		inset-inline: 12px;
		bottom: calc(64px + env(safe-area-inset-bottom));
		z-index: 105;
		display: flex;
		align-items: flex-start;
		gap: 10px;
		max-width: 34rem;
		margin-inline: auto;
		padding: 12px 10px 12px 12px;
		border: 1px solid var(--sheet-line);
		border-radius: 16px;
		background: var(--card);
		box-shadow: var(--sheet-highlight), var(--shadow-float);
	}
	.install-icon {
		display: grid;
		flex: 0 0 auto;
		width: 36px;
		height: 36px;
		place-items: center;
		border-radius: 11px;
		background: var(--brand-soft);
		color: var(--brand);
	}
	.install-body {
		display: grid;
		min-width: 0;
		gap: 4px;
	}
	.install-title {
		font-size: 0.875rem;
		font-weight: 650;
		line-height: 1.3;
	}
	.install-steps {
		display: grid;
		gap: 1px;
		margin: 0;
		padding-left: 1.1rem;
		color: var(--muted-foreground);
		font-size: 0.75rem;
		line-height: 1.45;
	}
	.install-steps strong {
		color: var(--foreground);
	}
	.install-note {
		color: var(--muted-foreground);
		font-size: 0.6875rem;
		line-height: 1.45;
	}
	:global(.neo-button.install-close) {
		flex: 0 0 auto;
	}
	@media (min-width: 641px) {
		.install-card {
			inset-inline: 16px;
			bottom: 16px;
		}
	}
</style>
