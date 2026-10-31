<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

<script lang="ts">
	import { AlertTriangle, Check, Cloud, CloudUpload, LogOut, RefreshCw } from '@lucide/svelte';
	import { NeoButton } from '@dvcol/neo-svelte/buttons';
	import { NeoInput } from '@dvcol/neo-svelte/inputs';
	import { NeoPill } from '@dvcol/neo-svelte/pill';
	import { getDatabaseAdapter } from '#lib/adapters/db/index.js';
	import {
		createSyncProvider,
		syncNow,
		type SyncChoice,
		type SyncComparison
	} from '#lib/adapters/sync/index.js';
	import { currentRuntime } from '#lib/platform/runtime.js';
	import { webdavPassword, webdavUsername } from '#lib/stores/secrets.js';
	import { appSettings, setSetting } from '#lib/stores/settings.js';
	import { toast } from '#lib/stores/toast.js';
	import SettingsSection from '#lib/components/settings/SettingsSection.svelte';
	import SettingRow from '#lib/components/settings/SettingRow.svelte';
	import SettingSelect from '#lib/components/settings/SettingSelect.svelte';
	import SecretInput from '#lib/components/settings/SecretInput.svelte';
	import SyncConflictDialog from '#lib/components/SyncConflictDialog.svelte';

	const INPUT_CLASS = 'w-full @md/field-group:w-72';

	const providerId = $derived($appSettings.syncProvider);
	const runtime = $derived(currentRuntime());
	const isMobileApp = $derived(runtime === 'android' || runtime === 'ios');
	const providerOptions = $derived.by(() => {
		const options = [
			{ value: 'off', label: 'Off', description: 'Manual .sqlite export and restore only.' },
			{
				value: 'google-drive',
				label: isMobileApp ? 'Google Drive (not available here yet)' : 'Google Drive',
				description: isMobileApp
					? 'Use WebDAV in the mobile builds for now.'
					: 'App-private folder. The backup is hidden from the normal Drive listing.'
			},
			{
				value: 'webdav',
				label: 'WebDAV',
				description: 'Nextcloud, ownCloud, pCloud and other WebDAV servers.'
			}
		];

		return options;
	});

	let busy = $state(false);
	let accountLabel = $state<string | null>(null);
	let lastSyncedAt = $state<string | null>(null);
	let status = $state('');
	let errorMessage = $state('');
	let conflictOpen = $state(false);
	let comparison = $state<SyncComparison | null>(null);

	$effect(() => {
		// Re-read the device-local authorization and bookkeeping when the destination changes.
		providerId;
		void refreshAccount();
	});

	async function refreshAccount(): Promise<void> {
		const provider = createSyncProvider(providerId);

		accountLabel = provider?.getAccount()?.label ?? null;

		if (!provider) {
			lastSyncedAt = null;
			return;
		}

		try {
			const database = await getDatabaseAdapter();
			const metadata = await database.getSyncMetadata(provider.id);
			lastSyncedAt = metadata?.lastSyncedAt ?? null;
		} catch {
			lastSyncedAt = null;
		}
	}

	function messageOf(error: unknown): string {
		return error instanceof Error ? error.message : String(error);
	}

	function formatWhen(value: string | null): string {
		if (!value) return 'Never';

		return new Intl.DateTimeFormat(undefined, {
			dateStyle: 'medium',
			timeStyle: 'short'
		}).format(new Date(value));
	}

	async function changeProvider(value: string): Promise<void> {
		setSetting('syncProvider', value as 'off' | 'google-drive' | 'webdav');
		status = '';
		errorMessage = '';
		accountLabel = null;
		lastSyncedAt = null;
	}

	async function connect(): Promise<void> {
		const provider = createSyncProvider($appSettings.syncProvider);
		if (!provider) return;

		busy = true;
		status = 'Connecting…';
		errorMessage = '';

		try {
			const account = await provider.connect();
			accountLabel = account.label;
			status = '';
			toast(`Connected to ${account.label}.`);
		} catch (error) {
			status = '';
			errorMessage = messageOf(error);
		} finally {
			busy = false;
			await refreshAccount().catch(() => undefined);
		}
	}

	async function disconnect(): Promise<void> {
		const provider = createSyncProvider($appSettings.syncProvider);
		if (!provider) return;

		busy = true;
		errorMessage = '';

		try {
			await provider.disconnect();
			accountLabel = null;
			lastSyncedAt = null;
			toast('Disconnected. The cloud backup was not changed.');
		} catch (error) {
			errorMessage = messageOf(error);
		} finally {
			busy = false;
			await refreshAccount().catch(() => undefined);
		}
	}

	async function runSync(choice?: SyncChoice): Promise<void> {
		const provider = createSyncProvider($appSettings.syncProvider);
		if (!provider) return;

		busy = true;
		status = 'Preparing…';
		errorMessage = '';

		try {
			const result = await syncNow(provider, choice, (message) => (status = message));

			if (result.decision === 'needs-choice') {
				comparison = result.comparison;
				conflictOpen = true;
				status = '';
				return;
			}

			status = '';

			if (result.decision === 'upload') toast('Backup uploaded to the cloud.');
			else if (result.decision === 'download') toast('Cloud backup restored.');
			else toast('This device and the cloud backup are already in sync.');
		} catch (error) {
			status = '';
			errorMessage = messageOf(error);
		} finally {
			busy = false;
			// A failed token or a replaced database can change what is connected.
			await refreshAccount().catch(() => undefined);
		}
	}

	async function choose(choice: SyncChoice): Promise<void> {
		await runSync(choice);
	}
</script>

<SettingsSection id="cloud-sync" title="Cloud sync">
	<SettingRow
		label="Destination"
		for="syncProvider"
		hint="A whole-database backup in your own cloud account. Nothing passes through an onspot server."
	>
		<SettingSelect
			id="syncProvider"
			label="Cloud sync destination"
			options={providerOptions}
			value={$appSettings.syncProvider}
			onchange={(value) => void changeProvider(value)}
			class="@md/field-group:w-80"
		/>
	</SettingRow>

	{#if providerId === 'google-drive'}
		<SettingRow
			label="Google account"
			hint={isMobileApp
				? 'Google Drive sync is not available in the mobile builds yet.'
				: 'Only the app-private folder is requested. The backup never appears in your normal Drive listing.'}
		>
			<div class="flex flex-wrap items-center justify-end gap-2">
				{#if accountLabel}
					<NeoPill rounded elevation={-1} class="text-muted-foreground">
						{#snippet icon()}<Check class="size-3.5" />{/snippet}
						{accountLabel}
					</NeoPill>
					<NeoButton rounded class="small-button" onclick={disconnect} disabled={busy}>
						{#snippet icon()}<LogOut class="size-3.5" />{/snippet}
						Disconnect
					</NeoButton>
				{:else}
					<NeoButton rounded onclick={connect} loading={busy} disabled={isMobileApp}>
						{#snippet icon()}<Cloud class="size-4" />{/snippet}
						Connect
					</NeoButton>
				{/if}
			</div>
		</SettingRow>
	{:else if providerId === 'webdav'}
		<SettingRow
			label="Server URL"
			for="webdavUrl"
			hint="The collection URL, for example https://cloud.example.com/remote.php/dav/files/you"
		>
			<div class={INPUT_CLASS}>
				<NeoInput
					id="webdavUrl"
					rounded
					pressed
					elevation={-2}
					width="100%"
					placeholder="https://…"
					value={$appSettings.webdavUrl}
					oninput={(event: Event) =>
						setSetting('webdavUrl', (event.target as HTMLInputElement).value)}
				/>
			</div>
		</SettingRow>
		<SettingRow
			label="Backup path"
			for="webdavPath"
			hint="Where the snapshot is kept inside that collection."
		>
			<div class={INPUT_CLASS}>
				<NeoInput
					id="webdavPath"
					rounded
					pressed
					elevation={-2}
					width="100%"
					placeholder="/onspot/onspot.sqlite"
					value={$appSettings.webdavPath}
					oninput={(event: Event) =>
						setSetting('webdavPath', (event.target as HTMLInputElement).value)}
				/>
			</div>
		</SettingRow>
		<SettingRow label="Username" for="webdavUsername">
			<div class={INPUT_CLASS}>
				<NeoInput
					id="webdavUsername"
					rounded
					pressed
					elevation={-2}
					width="100%"
					autocomplete="username"
					value={$webdavUsername}
					oninput={(event: Event) => webdavUsername.set((event.target as HTMLInputElement).value)}
				/>
			</div>
		</SettingRow>
		<SettingRow label="Password" for="webdavPassword">
			<SecretInput
				id="webdavPassword"
				label="WebDAV password"
				placeholder="App password"
				bind:value={$webdavPassword}
			/>
		</SettingRow>
		<SettingRow
			label="Connection"
			hint={runtime === 'web'
				? 'The browser build needs the server to allow this origin (CORS); the desktop and mobile apps do not.'
				: 'The app connects directly. A browser build needs the server to allow this origin (CORS).'}
		>
			<div class="flex flex-wrap items-center justify-end gap-2">
				<NeoButton rounded onclick={connect} loading={busy}>
					{#snippet icon()}<Cloud class="size-4" />{/snippet}
					Test connection
				</NeoButton>
				{#if accountLabel}
					<NeoPill rounded elevation={-1} class="text-muted-foreground">
						{#snippet icon()}<Check class="size-3.5" />{/snippet}
						{accountLabel}
					</NeoPill>
					<NeoButton rounded class="small-button" onclick={disconnect} disabled={busy}>
						{#snippet icon()}<LogOut class="size-3.5" />{/snippet}
						Forget
					</NeoButton>
				{/if}
			</div>
		</SettingRow>
	{/if}

	{#if providerId !== 'off'}
		<SettingRow
			label="Sync now"
			hint="Compares this device with the cloud copy. Uploading is safe; using the cloud copy replaces local data and always asks first."
		>
			<div class="flex flex-wrap items-center justify-end gap-2">
				<span class="text-xs text-muted-foreground">Last sync: {formatWhen(lastSyncedAt)}</span>
				<NeoButton rounded onclick={() => void runSync()} loading={busy}>
					{#snippet icon()}<RefreshCw class="size-4" />{/snippet}
					Sync now
				</NeoButton>
			</div>
		</SettingRow>

		{#if status || errorMessage}
			<div class="border-border border-b py-3 text-xs last:border-b-0">
				{#if status}
					<p class="flex items-center gap-1.5 text-muted-foreground">
						<CloudUpload class="size-3.5 shrink-0" />
						{status}
					</p>
				{/if}
				{#if errorMessage}
					<p class="flex items-start gap-1.5 text-[var(--error)]">
						<AlertTriangle class="mt-0.5 size-3.5 shrink-0" />
						<span class="max-h-40 overflow-y-auto break-words whitespace-pre-wrap">
							{errorMessage}
						</span>
					</p>
				{/if}
			</div>
		{/if}
	{/if}
</SettingsSection>

<SyncConflictDialog
	bind:open={conflictOpen}
	{comparison}
	choosing={busy}
	onchoose={choose}
/>
