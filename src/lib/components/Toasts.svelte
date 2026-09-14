<script lang="ts">
	import { toasts } from '$lib/stores/toast';
</script>

<div class="pointer-events-none fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
	{#each $toasts as item (item.id)}
		<div
			class="rounded-lg bg-foreground px-4 py-2.5 text-sm font-medium text-background shadow-lg"
		>
			{item.message}
		</div>
	{/each}
</div>
