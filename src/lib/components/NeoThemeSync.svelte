<script lang="ts">
	import { untrack } from 'svelte';
	import { useNeoThemeContext } from '@dvcol/neo-svelte/providers';

	/*
	 * Applies the app theme to neo-svelte without touching NeoThemeProvider's
	 * props. In 1.2.0 a changed provider prop re-runs its setup effect, whose
	 * cleanup `destroy()`s the theme (ready = false): the provider unmounts the
	 * whole app mid-view-transition and crashes on teardown. `update()` just
	 * re-applies the attributes.
	 */
	let { theme }: { theme: 'light' | 'dark' } = $props();
	const context = useNeoThemeContext();

	$effect(() => {
		const next = theme;
		untrack(() => context.update({ theme: next }));
	});
</script>
