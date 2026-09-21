<script lang="ts">
	import * as Tabs from '$lib/components/ui/tabs';

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

	const activeIndex = $derived(Math.max(0, options.findIndex((option) => option.value === value)));
</script>

<Tabs.Root {value} onValueChange={onValueChange} aria-label={ariaLabel}>
	<Tabs.List
		class={`paper-segmented paper-grain ${className}`}
		data-size={size}
		data-locked={disabled ? '' : undefined}
		style={`--paper-segment-count: ${options.length}`}
	>
		<!-- The texture belongs to this moving layer and scrolls with it: no fixed-background repaint/snap. -->
		<span
			class="paper-segmented-knob"
			style:translate={`${activeIndex * 100}% 0`}
			data-tone={options[activeIndex]?.tone ?? 'neutral'}
			aria-hidden="true"
		></span>
		{#each options as option (option.value)}
			<Tabs.Trigger
				value={option.value}
				disabled={disabled}
				class="paper-segmented-option"
				data-tone={option.tone ?? 'neutral'}
			>
				{option.label}
			</Tabs.Trigger>
		{/each}
	</Tabs.List>
</Tabs.Root>
