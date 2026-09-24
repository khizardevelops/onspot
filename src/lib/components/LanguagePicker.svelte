<script lang="ts">
	import { NeoButton } from '@dvcol/neo-svelte/buttons';
	import { NeoDialog } from '@dvcol/neo-svelte/floating/dialog';
	import { OFFERED_LANGUAGES, DEFAULT_LANGUAGE_ID, isCandidate } from '$lib/languages';
	import { setTargetLanguage } from '$lib/stores/practice';
	import { Check } from '@lucide/svelte';

	let selected = $state(DEFAULT_LANGUAGE_ID);
	let saving = $state(false);
	// A required first-run choice: the dialog cannot be dismissed, only answered.
	let open = $state(true);

	async function confirm(): Promise<void> {
		if (saving) return;
		saving = true;
		try {
			await setTargetLanguage(selected);
		} finally {
			saving = false;
		}
	}
</script>

<NeoDialog
	bind:open
	modal
	closedby="none"
	rounded
	elevation={3}
	width={{ max: 'min(28rem, calc(100vw - 2rem))' }}
	padding="0"
	aria-label="Choose the language you want to study"
	class="language-gate"
>
	<div class="p-6 sm:p-8">
		<div class="brand-orb grid size-12 place-items-center rounded-2xl text-lg font-semibold text-white shadow-lg" aria-hidden="true">o</div>
		<h1 class="mt-5 font-serif text-2xl font-medium">What do you want to study?</h1>
		<p class="mt-2 text-sm leading-relaxed text-muted-foreground">
			You can switch languages later in Settings. Model downloads only start when you ask, so a
			mis-click costs nothing.
		</p>

		<div class="mt-5 flex flex-col gap-2.5" role="radiogroup" aria-label="Supported languages">
			{#each OFFERED_LANGUAGES as language (language.id)}
				{@const active = selected === language.id}
				<NeoButton
					class="language-option"
					role="radio"
					aria-checked={active}
					rounded
					elevation={active ? -2 : 2}
					hover={active ? 0 : -1}
					color={active ? 'primary' : undefined}
					onclick={() => (selected = language.id)}
				>
					<span class="min-w-0 flex-1 text-left">
						<span class="block text-sm font-semibold">{language.name}</span>
						<span class="block text-xs text-muted-foreground">
							{language.nativeName}{#if isCandidate(language)} · candidate, not yet approved{/if}
						</span>
					</span>
					{#if active}
						<span class="grid size-6 place-items-center rounded-full bg-[var(--brand)] text-white">
							<Check class="size-3.5" />
						</span>
					{/if}
				</NeoButton>
			{/each}
		</div>

		<p class="mt-4 text-xs leading-relaxed text-muted-foreground">
			Speech recognition and voice models download from the internet on your device. Nothing is
			bundled with the app.
		</p>

		<NeoButton class="confirm-button mt-5" rounded elevation={3} tinted color="primary" loading={saving} disabled={saving} onclick={() => void confirm()}>
			{saving ? 'Saving…' : 'Continue'}
		</NeoButton>
	</div>
</NeoDialog>

<style>
	.brand-orb {
		background: linear-gradient(145deg, var(--brand), var(--brand-2) 62%, var(--brand-3));
	}
	:global(.neo-button.language-option) {
		width: 100%;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
		justify-content: flex-start;
	}
	:global(.neo-button.confirm-button) {
		width: 100%;
		height: 2.75rem;
		justify-content: center;
		font-weight: 600;
	}
</style>
