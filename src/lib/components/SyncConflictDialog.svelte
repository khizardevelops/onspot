<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

<script lang="ts">
	import { AlertTriangle, CloudDownload, CloudUpload } from '@lucide/svelte';
	import { NeoButton } from '@dvcol/neo-svelte/buttons';
	import { NeoDialog } from '@dvcol/neo-svelte/floating/dialog';
	import { closeOnBack } from '#lib/platform/backButton.svelte.js';
	import type { SyncChoice, SyncComparison } from '#lib/adapters/sync/index.js';

	interface Props {
		open: boolean;
		comparison: SyncComparison | null;
		choosing: boolean;
		/** Runs with the learner's choice; the dialog is already closed. */
		onchoose: (choice: SyncChoice) => void | Promise<void>;
	}

	let { open = $bindable(), comparison, choosing, onchoose }: Props = $props();

	const isFirstSync = $derived(!comparison?.lastSyncedAt);
	const hasLocalChanges = $derived(Boolean(comparison?.hasLocalChanges));
	const title = $derived(
		isFirstSync
			? 'Cloud backup found'
			: hasLocalChanges
				? 'Both copies changed'
				: 'The cloud copy changed'
	);
	const description = $derived(
		isFirstSync
			? 'This device has never synced with this cloud backup. Choose which copy to keep; the other side will be overwritten.'
			: hasLocalChanges
				? 'This device and the cloud backup were both edited since the last sync. Choose which copy to keep; the other side will be overwritten.'
				: 'The cloud backup was edited since the last sync. Keep this device’s copy or use the cloud copy.'
	);

	closeOnBack(
		() => open,
		() => (open = false)
	);

	function formatWhen(value: string | null): string {
		if (!value) return 'never';

		return new Intl.DateTimeFormat(undefined, {
			dateStyle: 'medium',
			timeStyle: 'short'
		}).format(new Date(value));
	}

	function formatSize(bytes: number | null): string {
		if (bytes === null) return 'unknown size';

		return `${(bytes / 1e6).toFixed(1)} MB`;
	}

	function choose(choice: SyncChoice): void {
		// Close first: a slow download must never leave a modal trapping the app.
		open = false;
		void onchoose(choice);
	}
</script>

<!-- Portalled: a frosted ancestor would otherwise trap the fixed dialog. -->
<NeoDialog
	bind:open
	portal
	filled
	backdrop
	rounded
	elevation={3}
	width={{ max: 'min(32rem, calc(100vw - 2rem))' }}
	aria-labelledby="sync-conflict-title"
	aria-describedby="sync-conflict-description"
>
	<div class="sync-conflict flex flex-col gap-3 p-1">
		<div class="flex items-center gap-2.5">
			<span
				class="grid size-9 shrink-0 place-items-center rounded-xl bg-[var(--warn-soft)] text-[var(--warn)]"
			>
				<AlertTriangle class="size-4" />
			</span>
			<h2 id="sync-conflict-title" class="text-base font-semibold">{title}</h2>
		</div>

		<p id="sync-conflict-description" class="text-sm leading-relaxed text-muted-foreground">
			{description}
		</p>

		<div class="grid gap-2 text-xs sm:grid-cols-2">
			<div class="rounded-xl border p-3">
				<p class="font-medium">This device</p>
				<p class="mt-1 text-muted-foreground">
					{comparison?.localSize === null
						? 'Stored on this device'
						: formatSize(comparison?.localSize ?? null)}
				</p>
				<p class="mt-0.5 text-muted-foreground">
					Last sync: {formatWhen(comparison?.lastSyncedAt ?? null)}
				</p>
			</div>
			<div class="rounded-xl border p-3">
				<p class="font-medium">Cloud backup</p>
				<p class="mt-1 text-muted-foreground">
					{formatSize(comparison?.remote?.size ?? null)}
				</p>
				<p class="mt-0.5 text-muted-foreground">
					Modified: {formatWhen(comparison?.remote?.modifiedAt ?? null)}
				</p>
			</div>
		</div>

		<p class="text-xs leading-relaxed text-[var(--warn)]">
			Using the cloud copy replaces every session, recording and setting on this device.
		</p>

		<div class="mt-1 flex flex-wrap justify-end gap-2">
			<NeoButton rounded elevation={2} onclick={() => (open = false)} disabled={choosing}>
				Cancel
			</NeoButton>
			<NeoButton
				rounded
				elevation={2}
				onclick={() => choose('upload')}
				disabled={choosing}
				loading={choosing}
			>
				{#snippet icon()}<CloudUpload class="size-4" />{/snippet}
				Keep this device
			</NeoButton>
			<NeoButton
				rounded
				elevation={2}
				color="error"
				tinted
				onclick={() => choose('download')}
				disabled={choosing}
			>
				{#snippet icon()}<CloudDownload class="size-4" />{/snippet}
				Use cloud copy
			</NeoButton>
		</div>
	</div>
</NeoDialog>
