<script lang="ts">
	import { onMount } from 'svelte';
	import { Check, HardDrive, Mic, X } from '@lucide/svelte';
	import { NeoButton } from '@dvcol/neo-svelte/buttons';
	import { NeoDialog } from '@dvcol/neo-svelte/floating/dialog';
	import { toast } from '$lib/stores/toast';

	/*
	 * Asks for the browser permissions onspot relies on, up front and in one
	 * place, instead of mid-task:
	 *   storage     persistent storage, so the browser never evicts the database
	 *               and (Firefox) the site is not held to the shared per-site
	 *               allowance that made `.sqlite` restores fail
	 *   microphone  recording takes
	 * Browsers only show these prompts in response to a click, so the dialog's
	 * Allow button requests both. It appears only while something is missing,
	 * and "Not now" hides it until the next launch.
	 *
	 * Storage is only asked where the browser prompts for it (Firefox family);
	 * Chromium decides persistence silently, so asking there cannot help and
	 * would nag. Firefox often grants the microphone for the visit only and
	 * keeps reporting "prompt", so a working grant is remembered here.
	 */
	type State = 'granted' | 'denied' | 'prompt' | 'unsupported';

	const LATER_KEY = 'onspot.permissions.later';
	const MIC_KEY = 'onspot.permissions.microphone';
	const firefox = typeof navigator !== 'undefined' && /firefox/i.test(navigator.userAgent);
	const tauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

	let open = $state(false);
	let asking = $state(false);
	let storage = $state<State>('unsupported');
	let microphone = $state<State>('unsupported');

	const missing = $derived(
		[storage, microphone].some((state) => state === 'prompt' || state === 'denied')
	);

	async function storageState(): Promise<State> {
		if (tauri || !firefox || !navigator.storage?.persist) return 'unsupported';
		try {
			return (await navigator.storage.persisted()) ? 'granted' : 'prompt';
		} catch {
			return 'unsupported';
		}
	}

	async function microphoneState(): Promise<State> {
		if (!navigator.mediaDevices?.getUserMedia) return 'unsupported';
		let state: State = 'prompt';
		try {
			const status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
			state = status.state as State;
		} catch {
			// No Permissions API entry for the microphone: it has to be asked to be known.
		}
		if (state === 'prompt' && remembered(MIC_KEY)) return 'granted';
		return state;
	}

	function remembered(key: string): boolean {
		try {
			return localStorage.getItem(key) === 'granted';
		} catch {
			return false;
		}
	}

	function remember(key: string): void {
		try {
			localStorage.setItem(key, 'granted');
		} catch {
			// Storage may be disabled; the prompt may then reappear next launch.
		}
	}

	async function refresh(): Promise<void> {
		[storage, microphone] = await Promise.all([storageState(), microphoneState()]);
	}

	async function allow(): Promise<void> {
		asking = true;
		// Both requests start inside the click, while it still counts as user activation.
		const persisting =
			storage === 'prompt' ? navigator.storage.persist().catch(() => false) : Promise.resolve(true);
		const recording =
			microphone === 'prompt'
				? navigator.mediaDevices
						.getUserMedia({ audio: true })
						.then((stream) => {
							stream.getTracks().forEach((track) => track.stop());
							return true;
						})
						.catch(() => false)
				: Promise.resolve(true);
		const [persisted, heard] = await Promise.all([persisting, recording]);
		if (storage === 'prompt') storage = persisted ? 'granted' : 'denied';
		if (microphone === 'prompt') microphone = heard ? 'granted' : 'denied';
		if (heard && microphone === 'granted') remember(MIC_KEY);
		asking = false;
		open = false;
		const refused = [
			storage === 'denied' ? 'persistent storage' : null,
			microphone === 'denied' ? 'the microphone' : null
		].filter(Boolean);
		if (refused.length) {
			toast(
				`Not allowed: ${refused.join(' and ')}. You can change this in the site permissions (the icon in the address bar), then reload.`,
				10000
			);
		}
	}

	function later(): void {
		try {
			sessionStorage.setItem(LATER_KEY, '1');
		} catch {
			// Storage may be disabled; the dialog simply closes.
		}
		open = false;
	}

	onMount(() => {
		let deferred = false;
		try {
			deferred = sessionStorage.getItem(LATER_KEY) === '1';
		} catch {
			// Treat as not deferred.
		}
		if (deferred) return;
		void refresh().then(() => {
			open = missing;
		});
	});
</script>

{#snippet row(Icon: typeof Mic, title: string, detail: string, state: State)}
	{#if state !== 'unsupported'}
		<li class="flex items-start gap-3">
			<span class="grid size-9 shrink-0 place-items-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">
				<Icon class="size-4" />
			</span>
			<div class="min-w-0 flex-1">
				<p class="text-sm font-medium">{title}</p>
				<p class="text-xs leading-relaxed text-muted-foreground">{detail}</p>
				{#if state === 'denied'}
					<p class="mt-1 text-xs text-[var(--error)]">
						Blocked. Allow it from the site permissions in your browser's address bar, then reload.
					</p>
				{/if}
			</div>
			{#if state === 'granted'}
				<Check class="mt-2 size-4 shrink-0 text-[var(--good)]" aria-label="Allowed" />
			{:else if state === 'denied'}
				<X class="mt-2 size-4 shrink-0 text-[var(--error)]" aria-label="Blocked" />
			{/if}
		</li>
	{/if}
{/snippet}

<NeoDialog
	bind:open
	portal
	filled
	backdrop
	rounded
	elevation={3}
	closedby="none"
	width={{ max: 'min(30rem, calc(100vw - 2rem))' }}
	aria-labelledby="permissions-title"
>
	<div class="flex flex-col gap-4 p-1">
		<div>
			<h2 id="permissions-title" class="text-base font-semibold">Two permissions before you start</h2>
			<p class="mt-1 text-sm leading-relaxed text-muted-foreground">
				Your browser will ask for each. Nothing leaves this device.
			</p>
		</div>
		<ul class="flex flex-col gap-3">
			{@render row(
				HardDrive,
				'Keep your data on this device',
				'Persistent storage stops the browser clearing your sessions and gives backups room to restore.',
				storage
			)}
			{@render row(Mic, 'Use the microphone', 'Needed to record your spoken answers.', microphone)}
		</ul>
		<div class="flex flex-wrap justify-end gap-2">
			<NeoButton rounded elevation={2} onclick={later}>Not now</NeoButton>
			<NeoButton
				rounded
				elevation={2}
				color="primary"
				tinted
				loading={asking}
				onclick={() => void allow()}
			>
				Allow
			</NeoButton>
		</div>
	</div>
</NeoDialog>
