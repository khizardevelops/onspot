<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

<script lang="ts">
	import { onMount } from 'svelte';
	import { pageHref } from '#lib/pages.js';
	import { goto } from '$app/navigation';
	import { hydrateLatestSession } from '#lib/stores/practice.js';
	import { appSettings, setSetting } from '#lib/stores/settings.js';
	import {
		flushPromptSubmissions,
		pendingPromptSubmissions,
		promptSubmissionsAvailable,
		refreshPendingPromptSubmissions
	} from '#lib/practice/promptSubmissions.js';
	import { toast } from '#lib/stores/toast.js';
	import { exportDatabaseFile, importLegacyJsonBackup } from '#lib/utils/export.js';
	import SettingsSection from '#lib/components/settings/SettingsSection.svelte';
	import SettingRow from '#lib/components/settings/SettingRow.svelte';
	import RestoreDatabaseButton from '#lib/components/RestoreDatabaseButton.svelte';
	import SyncSection from '#lib/components/SyncSection.svelte';
	import { NeoButton } from '@dvcol/neo-svelte/buttons';
	import { NeoPill } from '@dvcol/neo-svelte/pill';
	import { CloudUpload, Download, ExternalLink, HardDrive, Upload } from '@lucide/svelte';

	const contributionsEnabled = $derived($appSettings.promptContributions);
	const contributionsHint = $derived(
		`On by default. Generated speaking prompts are sent to the shared prompt database so more can be reviewed for everyone. Only the prompt, its languages, level and mode are sent — never recordings, transcripts, corrections, keys or a device id. Turn this off to stop sharing; prompts generated while it is off stay on this device. ${contributionsEnabled ? `${$pendingPromptSubmissions} waiting.` : 'Nothing is being sent.'}`
	);

	let exporting = $state(false);
	let restoring = $state(false);
	let restoreInput = $state<HTMLInputElement | null>(null);

	onMount(() => {
		// Read the queue when Settings opens, so the hint shows what will be sent.
		void refreshPendingPromptSubmissions();
	});

	function toggleContributions(): void {
		const next = !$appSettings.promptContributions;
		setSetting('promptContributions', next);
		// Re-enabling drains the outbox, but does not backfill prompts generated
		// while sharing was off: those were deliberately kept local.
		if (next) void flushPromptSubmissions();
	}

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
	{#if promptSubmissionsAvailable}
		<SettingRow
			label="Share generated prompts"
			hint={contributionsHint}
		>
			<NeoButton
				toggle
				checked={contributionsEnabled}
				aria-pressed={contributionsEnabled}
				rounded
				class="reminder-toggle {contributionsEnabled ? 'is-selected' : ''}"
				onclick={toggleContributions}
			>
				{#snippet icon()}<CloudUpload size={15} />{/snippet}
				{contributionsEnabled ? 'On' : 'Off'}
			</NeoButton>
		</SettingRow>
	{/if}
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
