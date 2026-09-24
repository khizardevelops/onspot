<script lang="ts">
	import { NeoNotificationStack } from '@dvcol/neo-svelte/floating/notification';
	import { toasts } from '$lib/stores/toast';

	/*
	 * The toast store stays the app-wide API; each new message is handed to neo's
	 * notification stack, which owns display, stacking, hover-pause and dismissal.
	 */
	let stack = $state<ReturnType<typeof NeoNotificationStack>>();
	let lastId = 0;

	$effect(() => {
		if (!stack) return;
		for (const item of $toasts) {
			if (item.id <= lastId) continue;
			lastId = item.id;
			stack.add({ content: item.message, duration: item.durationMs });
		}
	});
</script>

<NeoNotificationStack bind:this={stack} placement="bottom" elevation={2} rounded close={false} />

<style>
	:global(.neo-notification-stack) {
		z-index: 130;
	}
</style>
