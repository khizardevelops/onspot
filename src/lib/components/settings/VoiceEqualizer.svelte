<script lang="ts">
	import { Slider } from '$lib/components/ui/slider';
	import type { VoiceTuning } from '$lib/languages';
	import { tuningResponseDb, type TuningBand } from '$lib/utils/audioEffects';

	interface Props {
		tuning: VoiceTuning;
		/** Where the voice's profile places each band; faders sit at these frequencies. */
		bands: TuningBand[];
		/** The voice preview is playing; the panel lights up. */
		playing?: boolean;
		onchange: (key: keyof VoiceTuning, value: number) => void;
	}

	let { tuning, bands, playing = false, onchange }: Props = $props();
	const uid = $props.id();
	const gradientId = `eq-area-${uid}`;

	/** Fader travel in dB, matching `sanitizeTunings`. */
	const RANGE = 12;
	/**
	 * Plotted speech band. Narrow enough that the presence and treble faders
	 * keep their labels apart at phone width; Piper renders at 22.05 kHz.
	 */
	const F_MIN = 100;
	const F_MAX = 8000;
	const SAMPLES = 120;
	const VIEW_W = 1000;
	const VIEW_H = 240;
	const GRID_DB = [12, 6, -6, -12];
	const GRID_HZ = [200, 500, 1000, 2000, 5000];

	const BAND_LABELS: Record<TuningBand['key'], string> = {
		bassDb: 'Bass',
		bodyDb: 'Body',
		presenceDb: 'Presence',
		trebleDb: 'Treble'
	};

	const frequencies = Float32Array.from(
		{ length: SAMPLES },
		(_, index) => F_MIN * Math.pow(F_MAX / F_MIN, index / (SAMPLES - 1))
	);

	/** 0–1 position of a frequency on the log axis. */
	function xFor(frequency: number): number {
		return Math.log(frequency / F_MIN) / Math.log(F_MAX / F_MIN);
	}

	/** ±RANGE fills the plot exactly, so a peaking band's crest meets its thumb. */
	function yFor(db: number): number {
		const clamped = Math.max(-RANGE * 1.4, Math.min(RANGE * 1.4, db));
		return (VIEW_H / 2) * (1 - clamped / RANGE);
	}

	const curve = $derived.by(() => {
		const response = tuningResponseDb(bands, tuning, frequencies);
		const line = Array.from(response, (db, index) => {
			const x = (index / (SAMPLES - 1)) * VIEW_W;
			return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${yFor(db).toFixed(1)}`;
		}).join(' ');
		return { line, area: `${line} L${VIEW_W},${VIEW_H / 2} L0,${VIEW_H / 2} Z` };
	});

	function formatDb(value: number): string {
		if (value === 0) return '0 dB';
		return `${value > 0 ? '+' : '−'}${Math.abs(value)} dB`;
	}

	function formatHz(frequency: number): string {
		return frequency >= 1000 ? `${+(frequency / 1000).toFixed(1)} kHz` : `${frequency} Hz`;
	}

	/** Bipolar fill from the 0 dB detent to the thumb. */
	function fillStyle(value: number): string {
		const position = ((value + RANGE) / (RANGE * 2)) * 100;
		return value >= 0
			? `bottom: 50%; height: ${position - 50}%`
			: `bottom: ${position}%; height: ${50 - position}%`;
	}

	function update(key: keyof VoiceTuning, next: number): void {
		if (next !== tuning[key]) onchange(key, next);
	}

	/** Double-clicking a thumb returns that band to 0 dB. */
	function resetOnThumb(event: MouseEvent, key: keyof VoiceTuning): void {
		if ((event.target as HTMLElement).closest('[data-slot="slider-thumb"]')) update(key, 0);
	}

	/**
	 * shadcn's Slider keeps its thumb internal, so name it here for assistive
	 * technology: the thumb is the element with `role="slider"`.
	 */
	function nameThumb(node: HTMLElement, text: { label: string; value: string }) {
		const apply = ({ label, value }: { label: string; value: string }) => {
			const thumb = node.querySelector('[role="slider"]');
			thumb?.setAttribute('aria-label', label);
			thumb?.setAttribute('aria-valuetext', value);
		};
		apply(text);
		return { update: apply };
	}
</script>

{#snippet fader(key: keyof VoiceTuning, label: string)}
	{@const value = tuning[key]}
	<div
		class="eq-fader"
		role="presentation"
		use:nameThumb={{ label: `${label} adjustment`, value: `${value > 0 ? '+' : ''}${value} dB` }}
		ondblclick={(event) => resetOnThumb(event, key)}
	>
		<Slider
			type="single"
			orientation="vertical"
			thumbPositioning="exact"
			min={-RANGE}
			max={RANGE}
			step={1}
			{value}
			onValueChange={(next: number) => update(key, next)}
			class="cursor-ns-resize data-[orientation=vertical]:min-h-0 data-[orientation=vertical]:w-full"
		/>
		<span class="eq-detent" aria-hidden="true"></span>
		<span class="eq-fill" style={fillStyle(value)} aria-hidden="true"></span>
	</div>
{/snippet}

<div class="eq" class:playing>
	<div class="eq-body">
		<div class="eq-axis" aria-hidden="true">
			<span style="top: 0">+{RANGE}</span>
			<span style="top: 50%">0</span>
			<span style="top: 100%">−{RANGE}</span>
		</div>

		<div class="eq-plot">
			<div class="eq-row eq-values" aria-hidden="true">
				{#each bands as band (band.key)}
					<span
						class="eq-value"
						class:changed={tuning[band.key] !== 0}
						style="left: {xFor(band.frequency) * 100}%">{formatDb(tuning[band.key])}</span
					>
				{/each}
			</div>

			<div class="eq-stage">
				<svg
					class="eq-graph"
					viewBox="0 0 {VIEW_W} {VIEW_H}"
					preserveAspectRatio="none"
					aria-hidden="true"
				>
					<defs>
						<linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
							<stop offset="0%" stop-color="var(--brand)" stop-opacity="0.32" />
							<stop offset="50%" stop-color="var(--brand)" stop-opacity="0.04" />
							<stop offset="100%" stop-color="var(--brand)" stop-opacity="0.32" />
						</linearGradient>
					</defs>
					{#each GRID_HZ as frequency (frequency)}
						<line
							class="grid"
							x1={xFor(frequency) * VIEW_W}
							x2={xFor(frequency) * VIEW_W}
							y1="0"
							y2={VIEW_H}
						/>
					{/each}
					{#each GRID_DB as db (db)}
						<line class="grid" x1="0" x2={VIEW_W} y1={yFor(db)} y2={yFor(db)} />
					{/each}
					<line class="zero" x1="0" x2={VIEW_W} y1={VIEW_H / 2} y2={VIEW_H / 2} />
					<path class="area" d={curve.area} fill="url(#{gradientId})" />
					<path class="line" d={curve.line} />
				</svg>

				{#each bands as band (band.key)}
					<div class="eq-column" style="left: {xFor(band.frequency) * 100}%">
						{@render fader(band.key, BAND_LABELS[band.key])}
					</div>
				{/each}
			</div>

			<div class="eq-row eq-labels">
				{#each bands as band (band.key)}
					<span class="eq-label" style="left: {xFor(band.frequency) * 100}%">
						<span class="name">{BAND_LABELS[band.key]}</span>
						<span class="hz">{formatHz(band.frequency)}</span>
					</span>
				{/each}
			</div>
		</div>

		<div class="eq-output">
			<div class="eq-row eq-values" aria-hidden="true">
				<span class="eq-value" class:changed={tuning.volumeDb !== 0} style="left: 50%"
					>{formatDb(tuning.volumeDb)}</span
				>
			</div>
			<div class="eq-stage">
				<div class="eq-column" style="left: 50%">{@render fader('volumeDb', 'Volume')}</div>
			</div>
			<div class="eq-row eq-labels">
				<span class="eq-label" style="left: 50%">
					<span class="name">Volume</span>
					<span class="hz">Output</span>
				</span>
			</div>
		</div>
	</div>
</div>

<style>
	.eq {
		--eq-stage: 148px;
		--eq-thumb: 18px;
		position: relative;
		border: 1px solid var(--border);
		border-radius: 16px;
		background: color-mix(in srgb, var(--surface-2) 70%, var(--card));
		box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.04);
		padding: 18px 16px 14px 8px;
		transition:
			background-color 400ms cubic-bezier(0.4, 0, 0.2, 1),
			border-color 400ms cubic-bezier(0.4, 0, 0.2, 1),
			box-shadow 400ms cubic-bezier(0.4, 0, 0.2, 1);
	}
	.eq.playing {
		background: color-mix(in srgb, var(--brand) 7%, var(--card));
		border-color: color-mix(in srgb, var(--brand) 32%, transparent);
		box-shadow:
			inset 0 1px 6px color-mix(in srgb, var(--brand) 8%, transparent),
			0 0 0 3px color-mix(in srgb, var(--brand) 8%, transparent);
	}

	.eq-body {
		display: grid;
		grid-template-columns: 30px minmax(0, 1fr) 1px 64px;
		column-gap: 0;
	}
	.eq-body::after {
		content: '';
		grid-column: 3;
		grid-row: 1;
		margin: 26px 0 36px;
		background: var(--border);
	}

	/* dB axis sits beside the stage, aligned to its top/middle/bottom. */
	.eq-axis {
		position: relative;
		grid-column: 1;
		grid-row: 1;
		margin-top: 26px;
		height: var(--eq-stage);
		font-family: var(--font-mono);
		font-size: 0.75rem;
		color: var(--faint);
	}
	.eq-axis span {
		position: absolute;
		right: 6px;
		translate: 0 -50%;
		line-height: 1;
	}

	.eq-plot {
		grid-column: 2;
		grid-row: 1;
		min-width: 0;
	}
	.eq-output {
		grid-column: 4;
		grid-row: 1;
	}

	.eq-row {
		position: relative;
	}
	.eq-values {
		height: 26px;
	}
	.eq-labels {
		height: 36px;
	}

	.eq-value {
		position: absolute;
		top: 0;
		translate: -50% 0;
		white-space: nowrap;
		font-family: var(--font-mono);
		font-size: 0.75rem;
		font-weight: 500;
		font-variant-numeric: tabular-nums;
		color: var(--muted-foreground);
		transition: color 200ms ease;
	}
	.eq-value.changed {
		color: var(--brand);
	}

	.eq-label {
		position: absolute;
		top: 10px;
		translate: -50% 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		white-space: nowrap;
		line-height: 1.2;
	}
	.eq-label .name {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--foreground);
	}
	.eq-label .hz {
		font-size: 0.75rem;
		color: var(--faint);
	}

	.eq-stage {
		position: relative;
		height: var(--eq-stage);
	}

	.eq-graph {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		overflow: visible;
		pointer-events: none;
	}
	.eq-graph .grid {
		stroke: var(--border);
		stroke-width: 1;
		stroke-dasharray: 2 4;
		vector-effect: non-scaling-stroke;
	}
	.eq-graph .zero {
		stroke: var(--border-strong);
		stroke-width: 1;
		vector-effect: non-scaling-stroke;
	}
	.eq-graph .line {
		fill: none;
		stroke: var(--brand);
		stroke-width: 2.5;
		stroke-linecap: round;
		stroke-linejoin: round;
		vector-effect: non-scaling-stroke;
	}
	.eq-graph .area {
		transition: opacity 400ms ease;
	}
	.eq.playing .eq-graph .area {
		animation: eq-breathe 2.4s ease-in-out infinite;
	}

	/* A fader column is a 44px hit target centred on its frequency. */
	.eq-column {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 44px;
		translate: -50% 0;
	}
	.eq-fader {
		position: relative;
		height: 100%;
		user-select: none;
	}

	/*
	 * shadcn Slider parts. Its range fills from the bottom, which misreads a
	 * ±dB fader, so the range is hidden and `.eq-fill` draws from the 0 dB detent.
	 */
	.eq-fader :global([data-slot='slider-track']) {
		background: color-mix(in srgb, var(--foreground) 9%, transparent);
	}
	.eq-fader :global([data-slot='slider-range']) {
		background: transparent;
	}
	.eq-detent,
	.eq-fill {
		position: absolute;
		left: 50%;
		z-index: 1;
		border-radius: 999px;
		pointer-events: none;
	}
	.eq-detent {
		top: 50%;
		width: 14px;
		height: 2px;
		translate: -50% -50%;
		background: var(--border-strong);
	}
	.eq-fill {
		width: 4px;
		translate: -50% 0;
		background: var(--brand);
		opacity: 0.55;
	}

	.eq-fader :global([data-slot='slider-thumb']) {
		z-index: 2;
		width: var(--eq-thumb);
		height: var(--eq-thumb);
		background: var(--card);
		border: 2px solid var(--brand);
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.16);
		cursor: grab;
		transition:
			transform 200ms cubic-bezier(0.22, 1, 0.36, 1),
			background-color 200ms ease,
			box-shadow 200ms ease;
	}
	.eq-fader :global([data-slot='slider-thumb']:hover) {
		transform: scale(1.12);
	}
	.eq-fader :global([data-slot='slider-thumb'][data-active]) {
		cursor: grabbing;
		transform: scale(1.18);
		box-shadow:
			0 2px 8px rgba(0, 0, 0, 0.2),
			0 0 0 6px var(--brand-soft);
	}
	.eq-fader :global([data-slot='slider-thumb']:focus-visible) {
		box-shadow:
			0 2px 6px rgba(0, 0, 0, 0.16),
			0 0 0 4px color-mix(in srgb, var(--ring) 45%, transparent);
	}
	.eq.playing .eq-fader :global([data-slot='slider-thumb']) {
		background: var(--brand);
		box-shadow: 0 0 12px color-mix(in srgb, var(--brand) 55%, transparent);
	}

	@keyframes eq-breathe {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.55;
		}
	}

	@media (max-width: 520px) {
		.eq {
			--eq-stage: 128px;
			padding-right: 8px;
		}
		.eq-body {
			grid-template-columns: 22px minmax(0, 1fr) 1px 48px;
		}
		.eq-label .hz {
			display: none;
		}
		.eq-labels {
			height: 28px;
		}
		.eq-body::after {
			margin-bottom: 28px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.eq,
		.eq-fader :global([data-slot='slider-thumb']) {
			transition-duration: 1ms;
		}
		.eq.playing .eq-graph .area {
			animation: none;
		}
	}
</style>
