<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

<script lang="ts">
	/**
	 * Settings → Learning → Text size: the way into the live preview (a
	 * session on the practice screen, where each text is sized by tapping it;
	 * see `routes/settings/text-size`), the sizes that differ from 100%, and
	 * the resets. The sizes belong to this device (`stores/textSize.svelte.ts`).
	 */
	import { goto } from '$app/navigation';
	import { pageHref } from '#lib/pages.js';
	import {
		TEXT_DEVICES,
		changedTextSizes,
		currentTextDevice,
		resetTextDevice,
		resetTextScales,
		textScalesAreDefault,
		type ChangedTextSize
	} from '#lib/stores/textSize.svelte.js';
	import SettingsSection from './SettingsSection.svelte';
	import { NeoButton } from '@dvcol/neo-svelte/buttons';
	import { RotateCcw, Type } from '@lucide/svelte';

	const device = $derived(currentTextDevice());
	const deviceLabel = $derived(TEXT_DEVICES.find((layout) => layout.id === device)?.label ?? '');
	const changed = $derived(changedTextSizes());
	/** The changed sizes, grouped by layout, this one first. */
	const changedByDevice = $derived(
		[...TEXT_DEVICES]
			.sort((a, b) => Number(b.id === device) - Number(a.id === device))
			.map((layout) => ({ layout, sizes: changed.filter((size) => size.device === layout.id) }))
			.filter((group) => group.sizes.length > 0)
	);
	const changedHere = $derived(changed.some((size) => size.device === device));

	function describe(size: ChangedTextSize): string {
		const where = size.length ? ` (${size.length} takes)` : '';
		return `${size.section.label} ${Math.round(size.scale * 100)}%${where}`;
	}
</script>

<SettingsSection id="text-size" title="Text size">
	<div class="text-size">
		<p class="text-size-intro">
			See a session on this screen with sample takes, and tap any text to make it larger or smaller. Phones,
			tablets and desktops keep their own sizes, and so do short and long takes.
		</p>

		<NeoButton rounded color="primary" elevation={2} class="open-preview" onclick={() => goto(pageHref('/settings/text-size'))}>
			{#snippet icon()}<Type size={16} />{/snippet}
			Open live preview
		</NeoButton>

		{#if changedByDevice.length === 0}
			<p class="text-size-summary">Every part reads at 100%.</p>
		{:else}
			<ul class="text-size-summary" aria-label="Sizes other than 100%">
				{#each changedByDevice as group (group.layout.id)}
					<li><span class="summary-device">{group.layout.label}</span> {group.sizes.map(describe).join(' · ')}</li>
				{/each}
			</ul>
		{/if}

		<div class="reset-row">
			<NeoButton text rounded class="reset-button" disabled={!changedHere} onclick={() => resetTextDevice(device)}>
				{#snippet icon()}<RotateCcw size={14} />{/snippet}
				Reset {deviceLabel.toLowerCase()} sizes
			</NeoButton>
			<NeoButton text rounded class="reset-button" disabled={textScalesAreDefault()} onclick={resetTextScales}>Reset all sizes</NeoButton>
		</div>
	</div>
</SettingsSection>

<style>
	.text-size {
		display: grid;
		justify-items: start;
		gap: 0.75rem;
		padding: 1rem 0 0.75rem;
	}
	.text-size-intro {
		color: var(--muted-foreground);
		font-size: 0.8125rem;
		line-height: 1.5;
	}
	.text-size :global(.neo-button.open-preview) {
		gap: 0.5rem;
		height: 40px;
		padding-inline: 1.125rem;
		font-weight: 600;
	}
	.text-size-summary {
		display: grid;
		gap: 0.25rem;
		margin: 0;
		padding: 0;
		color: var(--muted-foreground);
		font-size: 0.8125rem;
		line-height: 1.45;
		list-style: none;
	}
	.summary-device {
		margin-right: 0.25rem;
		color: var(--foreground);
		font-weight: 600;
	}
	.reset-row {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 0.5rem;
		justify-self: stretch;
	}
	.reset-row :global(.neo-button.reset-button) {
		gap: 0.375rem;
		color: var(--muted-foreground);
		font-size: 0.8125rem;
	}
</style>
