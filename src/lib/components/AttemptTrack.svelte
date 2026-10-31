<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

<script lang="ts">
	/**
	 * One spoken track of an attempt card (what you said, the correct version,
	 * the explanation): a play button and a label above the text it reads.
	 */
	import type { Snippet } from 'svelte';
	import { quickTooltip } from '#lib/neo.js';
	import { NeoButton } from '@dvcol/neo-svelte/buttons';
	import { NeoTooltip } from '@dvcol/neo-svelte/floating/tooltips';
	import { Loader2, Pause, Volume2 } from '@lucide/svelte';

	interface Props {
		/** Visible label, e.g. "You said". */
		label: string;
		/** What the play button plays, for its accessible name, e.g. "what you said". */
		audioName: string;
		playing: boolean;
		loading: boolean;
		/**
		 * Why this track has no audio right now, or null when it has. The button
		 * stays clickable so a tap explains the reason instead of doing nothing.
		 */
		unavailableReason?: string | null;
		onToggle: () => void;
		/** Optional status next to the label, e.g. a "Correct" pill. */
		badge?: Snippet;
		children: Snippet;
	}

	let { label, audioName, playing, loading, unavailableReason = null, onToggle, badge, children }: Props = $props();

	const buttonLabel = $derived.by(() => {
		if (unavailableReason) return `Play ${audioName} (unavailable: ${unavailableReason})`;
		if (loading) return `Preparing ${audioName}`;
		return playing ? `Pause ${audioName}` : `Play ${audioName}`;
	});

	const tooltipText = $derived(unavailableReason ?? (playing ? 'Pause' : `Play ${audioName}`));
</script>

<div class="attempt-track min-w-0">
	<div class="flex min-h-7 items-center gap-1.5">
		<NeoTooltip tooltip={tooltipText} {...quickTooltip}>
			<NeoButton
				text
				rounded
				class="track-play {unavailableReason ? 'unavailable' : ''}"
				aria-label={buttonLabel}
				aria-disabled={unavailableReason ? 'true' : undefined}
				aria-busy={loading}
				onclick={onToggle}
			>
				{#snippet icon()}
					{#if loading}<Loader2 size={15} class="animate-spin" />{:else if playing}<Pause size={15} />{:else}<Volume2 size={15} />{/if}
				{/snippet}
			</NeoButton>
		</NeoTooltip>
		<p class="eyebrow">{label}</p>
		{@render badge?.()}
	</div>
	<div class="mt-0.5 min-w-0">
		{@render children()}
	</div>
</div>

<style>
	:global(.neo-button.track-play) {
		width: 28px;
		height: 28px;
		padding: 0;
		justify-content: center;
		color: var(--brand);
	}
	/* Unavailable audio is still explained on click, so it dims rather than disables. */
	:global(.neo-button.track-play.unavailable) { color: var(--muted-foreground); }
</style>
