<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import { cancelLanguageDownload, languageData } from '$lib/stores/languageData';
	import { getLanguage } from '$lib/languages';
	import { Button } from '$lib/components/ui/button';
	import { Progress } from '$lib/components/ui/progress';
	import { Loader2, X } from '@lucide/svelte';

	const language = $derived(getLanguage($languageData.languageId));
	const show = $derived($languageData.status === 'downloading');
</script>

{#if show}
	<div
		class="download-dock pointer-events-none fixed inset-x-0 bottom-[68px] z-[110] flex justify-center px-3 sm:bottom-4 sm:px-6"
		in:fly={{ y: 12, duration: 260 }}
		out:fade={{ duration: 140 }}
	>
		<div class="pointer-events-auto w-full max-w-xl sheet rounded-2xl p-3 shadow-[var(--shadow-float)] backdrop-blur-xl sm:p-4" aria-live="polite">
			<div class="flex items-center gap-3">
				<div class="grid size-9 shrink-0 place-items-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">
					<Loader2 class="size-4 animate-spin" />
				</div>
				<div class="min-w-0 flex-1">
					<div class="flex items-center justify-between gap-3 text-xs">
						<span class="truncate font-medium">
							Downloading {language?.name ?? 'language'} data
						</span>
						<span class="shrink-0 font-mono text-muted-foreground tabular-nums">
							{Math.round($languageData.progress)}%
						</span>
					</div>
					<Progress
						value={$languageData.progress}
						class="mt-1.5 h-1.5 bg-[var(--surface-2)] [&>div]:bg-[linear-gradient(90deg,var(--brand),var(--brand-2))] [&>div]:duration-300"
					/>
					<p class="mt-1 truncate text-[11px] text-muted-foreground">
						{$languageData.statusText || 'Fetching model files…'}
					</p>
				</div>
				<Button
					size="icon-sm"
					variant="ghost"
					aria-label="Cancel language data download"
					title="Cancel download"
					onclick={cancelLanguageDownload}
				>
					<X class="size-4" />
				</Button>
			</div>
		</div>
	</div>
{/if}

<style>
	.download-dock {
		animation-duration: 260ms;
	}
	@media (prefers-reduced-motion: reduce) {
		.download-dock {
			animation-duration: 1ms;
		}
	}
</style>
