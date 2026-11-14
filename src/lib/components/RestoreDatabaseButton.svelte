<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

<script lang="ts">
	import { AlertTriangle, Loader2, Upload } from '@lucide/svelte';
	import { NeoButton } from '@dvcol/neo-svelte/buttons';
	import { NeoDialog } from '@dvcol/neo-svelte/floating/dialog';
	import { quickDialog } from '#lib/neo.js';
	import { toast } from '#lib/stores/toast.js';
	import { importSqliteBackup, type SqliteRestoreResult } from '#lib/utils/export.js';
	import { initSettings } from '#lib/stores/settings.js';
	import { hydrateLatestSession } from '#lib/stores/practice.js';
	import { useCore } from '#lib/core-client/backend.js';
	import {
		restoreCancelCore,
		restoreConfirmCore,
		restorePickCore
	} from '#lib/core-client/export.js';
	import { closeOnBack } from '#lib/platform/backButton.svelte.js';

	interface Props {
		/** Button text. */
		label?: string;
		/** Runs after a confirmed backup has replaced the database. */
		onrestored?: (result: SqliteRestoreResult) => void | Promise<void>;
	}

	let { label = 'Restore .sqlite', onrestored }: Props = $props();

	const coreRestore = useCore('export');

	let input = $state<HTMLInputElement | null>(null);
	let pending = $state<File | null>(null);
	let pendingName = $state<string | null>(null);
	let corePending = $state(false);
	let confirmOpen = $state(false);
	let restoring = $state(false);
	closeOnBack(() => confirmOpen, () => cancelRestore());

	function announce(result: SqliteRestoreResult): void {
		const sessions = `${result.sessions} session${result.sessions === 1 ? '' : 's'}`;
		const attempts = `${result.attempts} take${result.attempts === 1 ? '' : 's'}`;
		toast(`Restored ${sessions} and ${attempts}.`);
	}

	async function beginRestore(): Promise<void> {
		if (!coreRestore) {
			input?.click();
			return;
		}

		try {
			const { fileName } = await restorePickCore();
			if (!fileName) return;
			pendingName = fileName;
			corePending = true;
			confirmOpen = true;
		} catch (error) {
			toast(error instanceof Error ? error.message : 'Restore failed', 15000);
		}
	}

	function cancelRestore(): void {
		if (corePending) void restoreCancelCore().catch(() => undefined);
		confirmOpen = false;
		pending = null;
		pendingName = null;
		corePending = false;
	}

	function stage(event: Event): void {
		const element = event.currentTarget as HTMLInputElement;
		const file = element.files?.[0] ?? null;
		element.value = '';
		if (!file || restoring) return;
		pending = file;
		confirmOpen = true;
	}

	async function restore(): Promise<void> {
		const file = pending;
		if (!file && !corePending) return;
		// Close the confirm up front so a slow or failed import never leaves
		// the modal trapping the learner.
		confirmOpen = false;
		restoring = true;
		try {
			if (corePending) {
				const result = await restoreConfirmCore();
				// The restored settings and newest session must replace the in-memory
				// copies; the core command deliberately stops before the driver reload.
				await initSettings();
				await hydrateLatestSession();
				announce(result);
				await onrestored?.(result);
			} else if (file) {
				const result = await importSqliteBackup(file);
				announce(result);
				await onrestored?.(result);
			}
		} catch (error) {
			// Failures carry advice (storage full, what to free): give time to read it.
			toast(error instanceof Error ? error.message : 'Restore failed', 15000);
		} finally {
			restoring = false;
			pending = null;
			pendingName = null;
			corePending = false;
		}
	}
</script>

<input
	bind:this={input}
	class="sr-only"
	type="file"
	accept=".sqlite,application/vnd.sqlite3,application/x-sqlite3,application/octet-stream"
	onchange={stage}
/>
<NeoButton class="restore-db-button" rounded elevation={2} onclick={() => void beginRestore()} disabled={restoring}>
	{#snippet icon()}
		{#if restoring}<Loader2 class="size-4 animate-spin" />{:else}<Upload class="size-4" />{/if}
	{/snippet}
	{restoring ? 'Restoring…' : label}
</NeoButton>

<!-- Portalled: a frosted (backdrop-filter) ancestor would otherwise trap the fixed dialog. -->
<NeoDialog
	{...quickDialog}
	bind:open={confirmOpen}
	portal
	filled
	backdrop
	rounded
	elevation={3}
	width={{ max: 'min(30rem, calc(var(--ui-vw) - 2rem))' }}
	aria-labelledby="restore-db-title"
	aria-describedby="restore-db-description"
>
	<div class="restore-db-confirm flex flex-col gap-3 p-1">
		<div class="flex items-center gap-2.5">
			<span class="grid size-9 shrink-0 place-items-center rounded-xl bg-[var(--error-soft)] text-[var(--error)]">
				<AlertTriangle class="size-4" />
			</span>
			<h2 id="restore-db-title" class="text-base font-semibold">Replace this device's database?</h2>
		</div>
		<p id="restore-db-description" class="text-sm leading-relaxed text-muted-foreground">
			{pending?.name ?? pendingName ?? 'This backup'} replaces everything currently on this device (sessions,
			recordings and settings) with the backup's contents. Export a copy first if you need the
			current data. API keys and downloaded models are not part of a backup.
		</p>
		<div class="mt-1 flex flex-wrap justify-end gap-2">
			<NeoButton rounded elevation={2} onclick={cancelRestore}>Keep current data</NeoButton>
			<NeoButton rounded elevation={2} color="error" tinted onclick={() => void restore()}>Replace database</NeoButton>
		</div>
	</div>
</NeoDialog>
