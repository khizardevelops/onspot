<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import { cancelLanguageDownload, languageData } from '$lib/stores/languageData';
	import { getLanguage } from '$lib/languages';
	import { NeoButton } from '@dvcol/neo-svelte/buttons';
	import { NeoProgressBar } from '@dvcol/neo-svelte/progress';
	import { Loader2, X } from '@lucide/svelte';

	const language = $derived(getLanguage($languageData.languageId));
	const show = $derived($languageData.status === 'downloading');
</script>

{#if show}
	<div
		class="download-dock pointer-events-none fixed inset-x-0 bottom-[68px] z-[110] flex justify-center px-3 sm:bottom-5 sm:px-6"
		in:fly={{ y: 12, duration: 160 }}
		out:fade={{ duration: 100 }}
	>
		<!-- Opaque, not a frosted sheet: page content scrolling underneath must never show through. -->
		<div class="download-card pointer-events-auto" role="group" aria-label="Language data download">
			<div class="download-icon" aria-hidden="true">
				<Loader2 class="size-4 animate-spin" />
			</div>
			<div class="download-body">
				<div class="flex items-baseline justify-between gap-3">
					<span class="truncate text-sm font-medium" role="status">Downloading {language?.name ?? 'language'} data</span>
					<span class="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
						{Math.round($languageData.progress)}%
					</span>
				</div>
				<NeoProgressBar
					class="download-progress"
					value={$languageData.progress}
					min={0}
					max={100}
					rounded
					color="linear-gradient(90deg, var(--brand), var(--brand-2))"
					aria-label="Language data download progress"
				/>
				<p class="truncate text-xs text-muted-foreground">
					{$languageData.statusText || 'Fetching model files…'}
				</p>
			</div>
			<NeoButton
				class="download-cancel"
				text
				rounded
				aria-label="Cancel language data download"
				title="Cancel download"
				onclick={cancelLanguageDownload}
			>
				{#snippet icon()}<X class="size-4" />{/snippet}
			</NeoButton>
		</div>
	</div>
{/if}

<style>
	.download-card {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: center;
		column-gap: 14px;
		width: 100%;
		max-width: 36rem;
		padding: 14px 12px 14px 14px;
		border: 1px solid var(--sheet-line);
		border-radius: 18px;
		background-color: var(--card);
		box-shadow: var(--sheet-highlight), var(--shadow-float);
	}
	.download-icon {
		display: grid;
		place-items: center;
		width: 40px;
		height: 40px;
		border-radius: 12px;
		background: var(--brand-soft);
		color: var(--brand);
	}
	.download-body {
		display: flex;
		flex-direction: column;
		gap: 8px;
		min-width: 0;
	}
	/*
	 * A slim recessed channel. `class` lands on the inner track, so the
	 * wrapper (which carries neo's margin and raised shadow) is styled here.
	 */
	.download-card .download-body :global(.neo-progress-bar.neo-track) {
		margin: 0;
		height: 6px;
		border: 0;
		border-radius: 999px;
		background-color: var(--well);
		box-shadow: inset 1px 1px 2px var(--shade-dark), inset -1px -1px 1px var(--shade-light);
		overflow: hidden;
	}
	.download-card .download-body :global(.neo-progress.download-progress) {
		height: 100%;
		border-radius: inherit;
		box-shadow: none;
	}
	.download-card :global(.neo-button.download-cancel) {
		width: 36px;
		height: 36px;
		padding: 0;
		justify-content: center;
		color: var(--muted-foreground);
	}
	.download-card :global(.neo-button.download-cancel:hover) { color: var(--foreground); }
	@media (min-width: 640px) {
		.download-card { padding: 16px 14px 16px 16px; column-gap: 16px; }
	}
</style>
