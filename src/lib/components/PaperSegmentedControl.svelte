<script lang="ts">
	import { NeoTab, NeoTabs } from '@dvcol/neo-svelte/nav';

	export interface PaperSegmentOption {
		value: string;
		label: string;
		/** Semantic tint for the selected option; neutral is the default. */
		tone?: 'brand' | 'error' | 'neutral';
	}

	interface Props {
		value: string;
		options: readonly PaperSegmentOption[];
		ariaLabel: string;
		disabled?: boolean;
		size?: 'sm' | 'md' | 'lg';
		class?: string;
		onValueChange?: (value: string) => void;
	}

	let {
		value,
		options,
		ariaLabel,
		disabled = false,
		size = 'md',
		class: className = '',
		onValueChange
	}: Props = $props();

	const TONE_COLOR = { brand: 'primary', error: 'error', neutral: undefined } as const;
	const activeTone = $derived(options.find((option) => option.value === value)?.tone ?? 'neutral');
</script>

<!-- neo tabs: a pressed track with a raised key that slides to the selected option. -->
<!-- Exam red / Casual teal is this control's own selection colour (custom-selection opts out of the accent border). -->
<div class="segmented custom-selection {className}" data-size={size} data-tone={activeTone} data-locked={disabled ? '' : undefined}>
	<NeoTabs
		active={value}
		onchange={(tabId) => {
			if (tabId !== undefined && tabId !== value) onValueChange?.(String(tabId));
		}}
		{disabled}
		dim={false}
		pressed
		rounded
		aria-label={ariaLabel}
	>
		{#each options as option (option.value)}
			<NeoTab
				tabId={option.value}
				class="segmented-option"
				color={option.value === value ? TONE_COLOR[option.tone ?? 'neutral'] : undefined}
			>
				{option.label}
			</NeoTab>
		{/each}
	</NeoTabs>
</div>

<style>
	.segmented {
		display: inline-flex;
		/* A locked session is disabled, but its mode must stay legible; dimming is done by opacity. */
		--neo-text-color-disabled: currentcolor;
		--neo-dark-text-color-disabled: currentcolor;
		--neo-shadow-margin: 0;
		--segment-height: 40px;
	}
	.segmented[data-size='sm'] { --segment-height: 32px; }
	.segmented[data-size='lg'] { --segment-height: 48px; }
	.segmented :global(.neo-tabs-group) {
		height: var(--segment-height);
		padding: 3px;
		gap: 2px;
	}
	.segmented :global(.neo-tab .neo-button.segmented-option) {
		height: 100%;
		min-height: 0;
		padding: 0 12px;
		font-size: 0.75rem;
		font-weight: 600;
	}
	/* The selected key carries the mode's semantic tint and a soft halo. */
	.segmented[data-tone='error'] :global(.neo-tab.neo-active .neo-button.segmented-option) {
		background-color: color-mix(in srgb, var(--error) 12%, transparent);
		box-shadow: 0 0 8px 1px color-mix(in srgb, var(--error) 35%, transparent) !important;
	}
	.segmented[data-tone='brand'] :global(.neo-tab.neo-active .neo-button.segmented-option) {
		background-color: color-mix(in srgb, var(--brand) 12%, transparent);
		box-shadow: 0 0 8px 1px color-mix(in srgb, var(--brand) 35%, transparent) !important;
	}
	.segmented[data-locked] :global(.neo-button.segmented-option) { cursor: not-allowed; }
	.segmented[data-locked] :global(.neo-tab:not(.neo-active)) { opacity: 0.7; }
	/* Neo greys a disabled group; a locked session keeps its selected mode legible. */
	.segmented[data-locked] :global(.neo-tab.neo-active .neo-button.segmented-option) { opacity: 1; }
	@media (max-width: 640px) {
		.segmented { --segment-height: 36px; }
		.segmented :global(.neo-tab .neo-button.segmented-option) { padding-inline: 9px; }
	}
	@media (pointer: coarse) {
		/* A fingertip-sized key inside the track. */
		.segmented { --segment-height: 44px; }
	}
</style>
