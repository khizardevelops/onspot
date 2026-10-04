<script lang="ts">
	import { NeoNotificationProvider, NeoNotificationStack } from '@dvcol/neo-svelte/floating/notification';
	import { toasts } from '#lib/stores/toast.js';

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

<!--
	neo 1.2.0's stack calls `context.unregister()` on destroy without checking
	that a provider exists, so unmounting it bare (HMR, app teardown) threw.
	The provider only supplies that context; its own default stack is off.
-->
<NeoNotificationProvider stack={false}>
	<!-- Expanded: a collapsed stack tucked an older (often longer, more important) message half-hidden behind the newest. -->
	<NeoNotificationStack bind:this={stack} placement="bottom" expand elevation={2} rounded close={false} />
</NeoNotificationProvider>

<style>
	:global(.neo-notification-stack) {
		z-index: 130;
	}
	/* Clear the composer's bottom edge and, on phones, the Feedback strip (neo adds its own gap). */
	:global(.neo-notification-stack.neo-notification-stack.neo-notification-stack[data-placement='bottom']) {
		bottom: 48px;
	}
	@media (min-width: 641px) {
		:global(.neo-notification-stack.neo-notification-stack.neo-notification-stack[data-placement='bottom']) {
			bottom: 16px;
		}
	}
</style>
