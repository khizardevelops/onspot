<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

<script lang="ts">
	/**
	 * Settings → Learning → Interface scale: scales the whole app on this
	 * device. The slider moves in 5% steps; the keys and the reset cover
	 * precise changes and returning to 100%. Text size remains separate.
	 */
	import type { Component } from 'svelte';
	import { NeoRange, type NeoRangeProps } from '@dvcol/neo-svelte/inputs';
	import { NeoButton } from '@dvcol/neo-svelte/buttons';
	import {
		UI_ZOOM_MAX,
		UI_ZOOM_MIN,
		UI_ZOOM_STEP,
		resetUiZoom,
		setUiZoom,
		stepUiZoom,
		uiZoom,
		uiZoomIsDefault
	} from '#lib/stores/zoom.svelte.js';
	import SettingsSection from './SettingsSection.svelte';
	import { RotateCcw, ZoomIn, ZoomOut } from '@lucide/svelte';

	// neo-svelte 1.2.0 marks the validation `context` prop as required in NeoRange's types;
	// the component fills it itself.
	const Range = NeoRange as unknown as Component<Partial<NeoRangeProps>, object, 'value'>;

	const MIN_PERCENT = Math.round(UI_ZOOM_MIN * 100);
	const MAX_PERCENT = Math.round(UI_ZOOM_MAX * 100);
	const STEP_PERCENT = Math.round(UI_ZOOM_STEP * 100);

	const percent = $derived(Math.round(uiZoom() * 100));
	const atMin = $derived(uiZoom() <= UI_ZOOM_MIN + 0.0001);
	const atMax = $derived(uiZoom() >= UI_ZOOM_MAX - 0.0001);

	/** The range's own value, kept in sync with the store after the keys or a reset. */
	let sliderValue = $state(Math.round(uiZoom() * 100));
	$effect(() => {
		sliderValue = percent;
	});

	function updateFromSlider(next: number | number[]): void {
		const value = Array.isArray(next) ? next[0] : next;
		if (typeof value === 'number') setUiZoom(value / 100);
	}

	/**
	 * NeoRange's handle is a plain button named "Drag to set value"; expose it
	 * to assistive technology as the slider it is (arrow keys already step it).
	 */
	function nameHandle(node: HTMLElement, state: { value: number }) {
		const apply = () => {
			const handle = node.querySelector('.neo-range-handle');
			if (!handle) return;
			handle.setAttribute('role', 'slider');
			handle.setAttribute('aria-label', 'Interface scale');
			handle.setAttribute('aria-valuemin', String(MIN_PERCENT));
			handle.setAttribute('aria-valuemax', String(MAX_PERCENT));
			handle.setAttribute('aria-valuenow', String(state.value));
			handle.setAttribute('aria-valuetext', `${state.value}%`);
		};
		apply();
		return { update: apply };
	}
</script>

<SettingsSection id="interface-scale" title="Interface scale">
	<div class="interface-scale">
		<p class="scale-intro">
			Scale the whole app — text, cards, spacing and controls. Text size stays separate and
			can still be adjusted below.
		</p>

		<div class="scale-row">
			<NeoButton
				rounded
				elevation={1}
				class="scale-key scale-minus"
				aria-label="Smaller interface"
				title="Smaller"
				disabled={atMin}
				onclick={() => stepUiZoom(-1)}
			>
				{#snippet icon()}<ZoomOut size={16} />{/snippet}
			</NeoButton>

			<div class="scale-slider" use:nameHandle={{ value: percent }}>
				<Range
					min={MIN_PERCENT}
					max={MAX_PERCENT}
					step={STEP_PERCENT}
					tooltips={false}
					rounded
					color="var(--brand)"
					width="100%"
					bind:value={() => sliderValue, (next) => updateFromSlider(next)}
				/>
			</div>

			<span class="scale-value" aria-live="polite">{percent}%</span>

			<NeoButton
				rounded
				elevation={1}
				class="scale-key scale-plus"
				aria-label="Larger interface"
				title="Larger"
				disabled={atMax}
				onclick={() => stepUiZoom(1)}
			>
				{#snippet icon()}<ZoomIn size={16} />{/snippet}
			</NeoButton>
		</div>

		<div class="scale-footer">
			<span class="scale-note">Applies to this device. 100% is the default.</span>
			<NeoButton
				text
				rounded
				class="scale-reset"
				disabled={uiZoomIsDefault()}
				onclick={resetUiZoom}
			>
				{#snippet icon()}<RotateCcw size={14} />{/snippet}
				Reset to 100%
			</NeoButton>
		</div>
	</div>
</SettingsSection>

<style>
	.interface-scale {
		display: grid;
		min-width: 0;
		gap: 0.75rem;
		padding: 1rem 0 0.75rem;
	}
	.scale-intro {
		color: var(--muted-foreground);
		font-size: 0.8125rem;
		line-height: 1.5;
	}
	.scale-row {
		display: flex;
		align-items: center;
		min-width: 0;
		gap: 0.5rem;
	}
	.scale-row :global(.neo-button.scale-key) {
		flex: 0 0 auto;
		width: var(--touch-target, 36px);
		height: var(--touch-target, 36px);
		padding: 0;
		justify-content: center;
	}
	.scale-slider {
		flex: 1 1 0;
		min-width: 0;
	}
	/* NeoRange's default 20rem floor would push the value and keys off a phone. */
	.scale-slider :global(.neo-range-container) {
		min-width: 0;
		width: 100%;
		padding-inline: 0;
	}
	.scale-value {
		flex: 0 0 auto;
		min-width: 3.4rem;
		color: var(--brand);
		font-size: 0.875rem;
		font-variant-numeric: tabular-nums;
		font-weight: 700;
		text-align: right;
	}
	.scale-footer {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.scale-note {
		color: var(--muted-foreground);
		font-size: 0.75rem;
		line-height: 1.4;
	}
	.scale-footer :global(.neo-button.scale-reset) {
		gap: 0.375rem;
		color: var(--muted-foreground);
		font-size: 0.8125rem;
	}
	/* On a phone, give the track the full row instead of squeezing it between the keys. */
	@media (max-width: 640px) {
		.scale-row {
			flex-wrap: wrap;
		}
		.scale-row :global(.neo-button.scale-minus) {
			order: 1;
		}
		.scale-value {
			order: 2;
			margin-left: auto;
		}
		.scale-row :global(.neo-button.scale-plus) {
			order: 3;
		}
		.scale-slider {
			flex: 1 1 100%;
			order: 4;
			margin-top: 0.25rem;
		}
	}
</style>
