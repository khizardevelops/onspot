<script lang="ts">
	import { NeoMenu } from '@dvcol/neo-svelte/floating/menu';
	import type { NeoMenuProps } from '@dvcol/neo-svelte/floating/menu';
	import { onScreen, quickMenu, quickSubmenu } from '$lib/neo';
	import { closeOnBack } from '$lib/platform/backButton.svelte';

	/*
	 * NeoMenu that opens on click, immediately. neo-svelte 1.2.0's tooltip
	 * ignores the "click" open reason (it only sets `open` for hover/focus), so
	 * its menus could only open after the 500ms hover delay. The trigger calls
	 * the `toggle()` the tooltip attaches to its trigger element, which keeps
	 * NeoMenu's internal state in charge: outside press, Escape and selecting
	 * an item still close it. `open` is a read-only mirror for callers.
	 */
	let { open = $bindable(false), triggerRef = $bindable(), children: content, menuProps, ...rest }: NeoMenuProps = $props();

	type Toggleable = HTMLElement & { toggle?: (open?: boolean) => boolean };

	// Android Back closes an open menu instead of leaving the page.
	closeOnBack(() => open, () => (triggerRef as Toggleable | undefined)?.toggle?.(false));

	/** Submenus open on hover and stay on screen too. */
	const submenuProps = $derived({
		...menuProps,
		tooltipProps: { ...quickSubmenu, ...menuProps?.tooltipProps }
	} as NeoMenuProps['menuProps']);
</script>

<NeoMenu {...quickMenu} options={onScreen} {...rest} menuProps={submenuProps} bind:open bind:triggerRef>
	{#snippet children(context, toggle)}
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<span class="contents" onclick={() => (triggerRef as Toggleable | undefined)?.toggle?.()}>
			{@render content?.(context, toggle)}
		</span>
	{/snippet}
</NeoMenu>
