<script lang="ts">
	import {
		audioPlayer,
		seek,
		setRate,
		toggleLoop,
		togglePlay
	} from '$lib/stores/audio';
	import { Pause, Play, Repeat } from '@lucide/svelte';

	interface Props {
		attemptId: string;
	}

	let { attemptId }: Props = $props();

	const active = $derived($audioPlayer.track?.attemptId === attemptId);
	const rates = [0.75, 1, 1.25];

	const KIND_LABEL: Record<string, string> = {
		attempt: 'Corrected audio',
		recording: 'Your recording',
		correction: 'Correction audio',
		segment: 'Sentence'
	};

	function fmt(seconds: number): string {
		if (!Number.isFinite(seconds)) return '0:00';
		const mins = Math.floor(seconds / 60);
		const secs = Math.floor(seconds % 60);
		return `${mins}:${String(secs).padStart(2, '0')}`;
	}
</script>

{#if active && $audioPlayer.track}
	{@const track = $audioPlayer.track}
	<div
		class="flex flex-wrap items-center gap-x-3 gap-y-2 border-t pt-3"
		aria-live="polite"
	>
		<button
			type="button"
			aria-label={$audioPlayer.playing ? 'Pause' : 'Play'}
			class="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--brand)] text-white hover:bg-[var(--brand-hover)]"
			onclick={togglePlay}
		>
			{#if $audioPlayer.loading}
				<span class="size-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white"></span>
			{:else if $audioPlayer.playing}
				<Pause class="size-3.5" />
			{:else}
				<Play class="size-3.5" />
			{/if}
		</button>

		<span class="shrink-0 text-xs font-medium">
			{track.kind === 'segment' && track.segmentIndex !== undefined
				? `Sentence ${track.segmentIndex + 1}`
				: (KIND_LABEL[track.kind] ?? 'Audio')}
		</span>

		<input
			type="range"
			aria-label="Seek"
			class="h-1 min-w-24 flex-1 accent-[var(--brand)]"
			min="0"
			max={$audioPlayer.duration || 0}
			step="0.01"
			value={$audioPlayer.currentTime}
			disabled={!$audioPlayer.duration}
			oninput={(event) => seek(Number((event.target as HTMLInputElement).value))}
		/>
		<span class="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
			{fmt($audioPlayer.currentTime)} / {fmt($audioPlayer.duration)}
		</span>

		<div class="flex shrink-0 items-center gap-0.5">
			{#each rates as rate (rate)}
				<button
					type="button"
					aria-label="Playback speed {rate}x"
					aria-pressed={$audioPlayer.rate === rate}
					class="rounded px-1.5 py-0.5 text-[11px] font-medium {$audioPlayer.rate === rate
						? 'bg-[var(--brand-soft)] text-[var(--brand)]'
						: 'text-muted-foreground hover:bg-[var(--surface-2)]'}"
					onclick={() => setRate(rate)}
				>
					{rate}×
				</button>
			{/each}
			<button
				type="button"
				aria-label="Loop"
				aria-pressed={$audioPlayer.loop}
				class="grid size-7 place-items-center rounded {$audioPlayer.loop
					? 'bg-[var(--brand-soft)] text-[var(--brand)]'
					: 'text-muted-foreground hover:bg-[var(--surface-2)]'}"
				onclick={toggleLoop}
			>
				<Repeat class="size-3.5" />
			</button>
		</div>
	</div>
{/if}
