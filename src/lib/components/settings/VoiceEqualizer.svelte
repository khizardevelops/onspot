<script lang="ts">
	import type { Component } from 'svelte';
	import { NeoRange, type NeoRangeProps } from '@dvcol/neo-svelte/inputs';
	import { NeoDivider } from '@dvcol/neo-svelte/divider';
	import type { VoiceTuning } from '#lib/languages/index.js';
	import { tuningResponseDb, type TuningBand } from '#lib/utils/audioEffects.js';

	interface Props {
		tuning: VoiceTuning;
		/** Where the voice's profile places each band; faders sit at these frequencies. */
		bands: TuningBand[];
		/** The voice preview is playing; the panel lights up. */
		playing?: boolean;
		onchange: (key: keyof VoiceTuning, value: number) => void;
	}

	let { tuning, bands, playing = false, onchange }: Props = $props();
	// neo-svelte 1.2.0 marks the validation `context` prop as required in NeoRange's types;
	// the component fills it itself.
	const Range = NeoRange as unknown as Component<Partial<NeoRangeProps>, object, 'value'>;
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

	function update(key: keyof VoiceTuning, next: number): void {
		if (next !== tuning[key]) onchange(key, next);
	}

	/** Double-clicking a handle returns that band to 0 dB. */
	function resetOnHandle(event: MouseEvent, key: keyof VoiceTuning): void {
		if ((event.target as HTMLElement).closest('.neo-range-handle')) update(key, 0);
	}

	/**
	 * NeoRange's handle is a plain button named "Drag to set value"; expose it to
	 * assistive technology as the slider it is (arrow keys already step it).
	 */
	function nameHandle(node: HTMLElement, text: { label: string; value: number }) {
		const apply = ({ label, value }: { label: string; value: number }) => {
			const handle = node.querySelector('.neo-range-handle');
			if (!handle) return;
			handle.setAttribute('role', 'slider');
			handle.setAttribute('aria-label', label);
			handle.setAttribute('aria-valuemin', String(-RANGE));
			handle.setAttribute('aria-valuemax', String(RANGE));
			handle.setAttribute('aria-valuenow', String(value));
			handle.setAttribute('aria-valuetext', formatDb(value));
		};
		apply(text);
		return { update: apply };
	}
</script>

{#snippet fader(key: keyof VoiceTuning, label: string, detail: string)}
	{@const value = tuning[key]}
	<div class="eq-row">
		<span class="eq-name">
			<span class="name">{label}</span>
			<span class="hz">{detail}</span>
		</span>
		<div
			class="eq-fader"
			role="presentation"
			use:nameHandle={{ label: `${label} adjustment`, value }}
			ondblclick={(event) => resetOnHandle(event, key)}
		>
			<Range
				min={-RANGE}
				max={RANGE}
				step={1}
				ticks={[50]}
				tooltips={false}
				rounded
				color="var(--brand)"
				width="100%"
				bind:value={() => value, (next) => update(key, typeof next === 'number' ? next : next[0])}
			/>
		</div>
		<span class="eq-value" class:changed={value !== 0}>{formatDb(value)}</span>
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
				<!-- Each band's gain, marked where its fader acts on the curve. -->
				{#each bands as band (band.key)}
					<span
						class="eq-point"
						class:changed={tuning[band.key] !== 0}
						style="left: {xFor(band.frequency) * 100}%; top: {(yFor(tuning[band.key]) / VIEW_H) * 100}%"
						aria-hidden="true"
					></span>
				{/each}
			</div>
			<div class="eq-ticks" aria-hidden="true">
				{#each bands as band (band.key)}
					<span style="left: {xFor(band.frequency) * 100}%">{BAND_LABELS[band.key]}</span>
				{/each}
			</div>
		</div>
	</div>

	<div class="eq-faders">
		{#each bands as band (band.key)}
			{@render fader(band.key, BAND_LABELS[band.key], formatHz(band.frequency))}
		{/each}
		<div class="my-1"><NeoDivider /></div>
		{@render fader('volumeDb', 'Volume', 'Output')}
	</div>
</div>

<style>
	.eq {
		--eq-stage: 120px;
		position: relative;
		border: 1px solid var(--border);
		border-radius: 16px;
		background: color-mix(in srgb, var(--surface-2) 70%, var(--card));
		box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.04);
		padding: 16px 16px 12px 8px;
		transition:
			background-color 140ms cubic-bezier(0.4, 0, 0.2, 1),
			border-color 140ms cubic-bezier(0.4, 0, 0.2, 1),
			box-shadow 140ms cubic-bezier(0.4, 0, 0.2, 1);
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
		grid-template-columns: 30px minmax(0, 1fr);
	}

	/* dB axis sits beside the stage, aligned to its top/middle/bottom. */
	.eq-axis {
		position: relative;
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
		min-width: 0;
	}
	.eq-stage {
		position: relative;
		height: var(--eq-stage);
	}
	.eq-ticks {
		position: relative;
		height: 22px;
	}
	.eq-ticks span {
		position: absolute;
		top: 6px;
		translate: -50% 0;
		white-space: nowrap;
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--muted-foreground);
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
	.eq-point {
		position: absolute;
		width: 10px;
		height: 10px;
		translate: -50% -50%;
		border-radius: 50%;
		background: var(--card);
		border: 2px solid var(--border-strong);
		transition:
			top 160ms ease-out,
			border-color 200ms ease;
	}
	.eq-point.changed {
		border-color: var(--brand);
	}

	.eq-faders {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin-top: 10px;
		padding-left: 8px;
	}
	.eq-row {
		display: grid;
		grid-template-columns: 76px minmax(0, 1fr) 56px;
		align-items: center;
		gap: 8px;
	}
	.eq-name {
		display: flex;
		flex-direction: column;
		line-height: 1.2;
	}
	.eq-name .name {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--foreground);
	}
	.eq-name .hz {
		font-size: 0.75rem;
		color: var(--faint);
	}
	.eq-value {
		text-align: right;
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

	.eq-fader {
		min-width: 0;
		user-select: none;
	}
	/*
	 * A ±dB fader must read from its 0 dB detent, not from the left edge, so the
	 * NeoRange left fill is hidden and the rail paints the span between the
	 * centre and the handle instead. The one tick marks the detent.
	 */
	.eq-fader :global(.neo-range-container) {
		--neo-range-checked-background: transparent;
		min-width: 0;
		width: 100%;
		padding-inline: 0;
	}
	.eq-fader :global(.neo-range-slider .neo-range-rail) {
		background-image: linear-gradient(
			to right,
			transparent min(50%, var(--neo-range-progress)),
			color-mix(in srgb, var(--brand) 45%, transparent) min(50%, var(--neo-range-progress)),
			color-mix(in srgb, var(--brand) 45%, transparent) max(50%, var(--neo-range-progress)),
			transparent max(50%, var(--neo-range-progress))
		);
	}
	.eq-fader :global(.neo-range-tick-mark) {
		width: 2px;
		height: 10px;
		border-radius: 1px;
		background-color: var(--border-strong);
	}
	.eq.playing .eq-fader :global(.neo-range-handle) {
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
			--eq-stage: 100px;
			padding-right: 10px;
		}
		.eq-body {
			grid-template-columns: 22px minmax(0, 1fr);
		}
		.eq-row {
			grid-template-columns: 58px minmax(0, 1fr) 48px;
		}
		.eq-name .hz {
			display: none;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.eq,
		.eq-point {
			transition-duration: 1ms;
		}
		.eq.playing .eq-graph .area {
			animation: none;
		}
	}
</style>
