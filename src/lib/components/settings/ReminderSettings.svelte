<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

<script lang="ts">
	/**
	 * Settings → Learning → Practice reminders. Off by default: a nudge is a
	 * preference, not a default the app imposes. Frequency is about a day or a
	 * few days; the reminder itself is checked when the app opens, returns to
	 * view, or while it stays open (see `stores/reminders.ts`).
	 */
	import { appSettings, setSetting } from '#lib/stores/settings.js';
	import { refreshReminders } from '#lib/stores/reminders.js';
	import {
		notificationsSupported,
		requestNotificationPermission
	} from '#lib/platform/notifications.js';
	import SettingsSection from './SettingsSection.svelte';
	import SettingRow from './SettingRow.svelte';
	import SettingSelect from './SettingSelect.svelte';
	import { NeoButton } from '@dvcol/neo-svelte/buttons';
	import { Bell, BellOff } from '@lucide/svelte';

	const enabled = $derived($appSettings.practiceReminders);
	const hint = $derived(
		notificationsSupported()
			? 'A gentle nudge when you have not practised for a while. It appears when you open onspot, and your device can show it while the app is in the background.'
			: 'A gentle nudge when you have not practised for a while. It appears in onspot when you open it.'
	);

	async function toggleReminders(): Promise<void> {
		const next = !$appSettings.practiceReminders;
		// Ask inside this tap: browsers ignore permission requests without one.
		if (next) await requestNotificationPermission();
		setSetting('practiceReminders', next);
		await refreshReminders();
	}
</script>

<SettingsSection id="reminders" title="Practice reminders">
	<SettingRow label="Remind me to practise" hint={hint}>
		<NeoButton
			toggle
			checked={enabled}
			aria-pressed={enabled}
			rounded
			class="reminder-toggle {enabled ? 'is-selected' : ''}"
			onclick={() => void toggleReminders()}
		>
			{#snippet icon()}
				{#if enabled}<Bell size={15} />{:else}<BellOff size={15} />{/if}
			{/snippet}
			{enabled ? 'On' : 'Off'}
		</NeoButton>
	</SettingRow>

	<SettingRow
		label="How often"
		for="reminderFrequency"
		hint="Frequent is about once a day; infrequent is about every three days."
	>
		<SettingSelect
			id="reminderFrequency"
			label="Reminder frequency"
			options={[
				{ value: 'frequent', label: 'Frequent · about daily' },
				{ value: 'infrequent', label: 'Infrequent · every few days' }
			]}
			value={$appSettings.reminderFrequency}
			onchange={(value) => {
				setSetting('reminderFrequency', value as 'frequent' | 'infrequent');
				void refreshReminders();
			}}
		/>
	</SettingRow>
</SettingsSection>

<style>
	:global(.neo-button.reminder-toggle) {
		gap: 0.4rem;
		min-width: 5.25rem;
		justify-content: center;
	}
</style>
