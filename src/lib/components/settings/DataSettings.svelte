<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

<script lang="ts">
	import { pageHref } from '#lib/pages.js';
	import { goto } from '$app/navigation';
	import { hydrateLatestSession } from '#lib/stores/practice.js';
	import { toast } from '#lib/stores/toast.js';
	import { exportDatabaseFile, importLegacyJsonBackup } from '#lib/utils/export.js';
	import SettingsSection from '#lib/components/settings/SettingsSection.svelte';
	import SettingRow from '#lib/components/settings/SettingRow.svelte';
	import RestoreDatabaseButton from '#lib/components/RestoreDatabaseButton.svelte';
	import SyncSection from '#lib/components/SyncSection.svelte';
	import { NeoButton } from '@dvcol/neo-svelte/buttons';
	import { NeoPill } from '@dvcol/neo-svelte/pill';
	import { Download, ExternalLink, HardDrive, Upload } from '@lucide/svelte';

	let exporting = $state(false);
	let restoring = $state(false);
	let restoreInput = $state<HTMLInputElement | null>(null);

	async function exportData(): Promise<void> {
		exporting = true;
		try {
			if (await exportDatabaseFile()) toast('Database exported');
		} catch (error) {
			toast(error instanceof Error ? error.message : 'Export failed');
		} finally {
			exporting = false;
		}
	}

	async function restoreLegacyBackup(event: Event): Promise<void> {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file || restoring) return;

		restoring = true;
		try {
			const restored = await importLegacyJsonBackup(file);
			await hydrateLatestSession();
			toast(`Restored ${restored.sessions} sessions and ${restored.attempts} takes.`);
			await goto(pageHref('/history'));
		} catch (error) {
			toast(error instanceof Error ? error.message : 'Restore failed');
		} finally {
			restoring = false;
		}
	}
</script>

<SettingsSection id="storage" title="Storage">
	<SettingRow
		label="Database"
		hint="Sessions, attempts, corrections, recordings and cached voice audio are stored locally."
	>
		<NeoPill rounded elevation={-1} class="text-muted-foreground">
			{#snippet icon()}<HardDrive class="size-3.5" />{/snippet}
			On this device (SQLite)
		</NeoPill>
	</SettingRow>
	<SettingRow
		label="Export database"
		hint="One .sqlite file with everything: sessions, attempts, corrections, translations, prompts, settings, your recordings and every cached voice clip. API keys and downloaded models are not included."
	>
		<NeoButton rounded onclick={exportData} loading={exporting}>
			{#snippet icon()}<Download class="size-4" />{/snippet}
			{exporting ? 'Exporting…' : 'Export .sqlite'}
		</NeoButton>
	</SettingRow>
	<SettingRow
		label="Restore database"
		hint="Put an onspot .sqlite backup back on this device, for example after moving browsers or computers. It replaces everything local, so you will be asked to confirm."
	>
		<RestoreDatabaseButton onrestored={() => goto(pageHref('/history'))} />
	</SettingRow>
	<SettingRow
		label="Restore legacy backup"
		hint="Merge an older onspot .json export into this device. Existing unrelated sessions stay in place; you will then open History."
	>
		<input
			bind:this={restoreInput}
			class="sr-only"
			type="file"
			accept="application/json,.json"
			onchange={restoreLegacyBackup}
		/>
		<NeoButton rounded onclick={() => restoreInput?.click()} loading={restoring}>
			{#snippet icon()}<Upload class="size-4" />{/snippet}
			{restoring ? 'Restoring…' : 'Restore .json'}
		</NeoButton>
	</SettingRow>
	<SettingRow
		label="Interface lab"
		hint="A separate interactive copy of the UI with dummy data. Changes and experiments there never touch your sessions or settings."
	>
		<NeoButton href="/ui-sandbox/" rounded>
			{#snippet icon()}<ExternalLink class="size-4" />{/snippet}
			Open UI sandbox
		</NeoButton>
	</SettingRow>
</SettingsSection>

<SyncSection />
