<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

<script lang="ts">
	/**
	 * The permanent copy of the iPhone/iPad install steps. The first-visit card
	 * can be dismissed; this section cannot, so the instructions are always
	 * reopenable from Settings.
	 */
	import {
		iosBrowserName,
		isAppleTouchDevice,
		isStandalone
	} from '#lib/platform/pwa.js';
	import SettingsSection from './SettingsSection.svelte';
	import { NeoPill } from '@dvcol/neo-svelte/pill';
	import { Check, Share } from '@lucide/svelte';

	const apple = isAppleTouchDevice();
	const installed = isStandalone();
	const browser = iosBrowserName();
</script>

{#if apple}
	<SettingsSection id="ios-install" title="iPhone and iPad">
		<div class="ios-install">
			<div class="ios-heading">
				<span class="ios-icon" aria-hidden="true"><Share size={17} /></span>
				<div class="min-w-0 flex-1">
					<p class="ios-title">
						{installed ? 'onspot is installed on this device' : 'Install onspot from ' + browser}
					</p>
					{#if installed}
						<NeoPill size="small" rounded tinted color="success" class="ios-pill">
							{#snippet icon()}<Check size={11} />{/snippet}
							Installed
						</NeoPill>
					{:else}
						<p class="ios-note">It opens full screen and keeps its own storage.</p>
					{/if}
				</div>
			</div>

			{#if !installed}
				<ol class="ios-steps">
					<li>Tap <strong>Share</strong> in {browser}.</li>
					<li>Choose <strong>Add to Home Screen</strong>.</li>
					<li>Open onspot from the home screen.</li>
				</ol>
			{/if}

			<p class="ios-note">
				A website's storage can be cleared by Safari after about a week without use. The
				installed app keeps it, and opening it from the home screen is the reliable way to
				come back. What you do in Safari does not carry into the installed app, so install
				first or export and restore.
			</p>
			<p class="ios-note">
				Cloud speech is the lightest option on an iPhone. On-device Whisper is still offered,
				but it needs about 2 GB of memory and iOS may close the app; the on-device voice is
				much smaller and can be downloaded on its own.
			</p>
		</div>
	</SettingsSection>
{/if}

<style>
	.ios-install {
		display: grid;
		gap: 0.6rem;
		padding: 1rem 0 0.75rem;
	}
	.ios-heading {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}
	.ios-icon {
		display: grid;
		flex: 0 0 auto;
		width: 36px;
		height: 36px;
		place-items: center;
		border-radius: 10px;
		background: var(--brand-soft);
		color: var(--brand);
	}
	.ios-title {
		font-size: 0.875rem;
		font-weight: 650;
		line-height: 1.3;
	}
	:global(.neo-pill.ios-pill) {
		margin-top: 0.3rem;
	}
	.ios-steps {
		display: grid;
		gap: 2px;
		margin: 0;
		padding-left: 1.2rem;
		color: var(--muted-foreground);
		font-size: 0.8125rem;
		line-height: 1.5;
	}
	.ios-steps strong {
		color: var(--foreground);
	}
	.ios-note {
		color: var(--muted-foreground);
		font-size: 0.75rem;
		line-height: 1.55;
	}
</style>
