<script lang="ts">
	import { APPROVED_LANGUAGES, DEFAULT_LANGUAGE_ID } from '$lib/languages';
	import { setTargetLanguage } from '$lib/stores/practice';
	import { Check, Loader2 } from '@lucide/svelte';

	let selected = $state(DEFAULT_LANGUAGE_ID);
	let saving = $state(false);

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

<div class="language-gate fixed inset-0 z-[120] grid place-items-center p-4" role="dialog" aria-modal="true" aria-label="Choose the language you want to study">
	<div class="w-full max-w-md sheet rounded-[26px] p-6 shadow-[var(--shadow-float)] sm:p-8">
		<div class="brand-orb grid size-12 place-items-center rounded-2xl text-lg font-semibold text-white shadow-lg" aria-hidden="true">o</div>
		<h1 class="mt-5 font-serif text-2xl font-medium">What do you want to study?</h1>
		<p class="mt-2 text-sm leading-relaxed text-muted-foreground">
			You can switch languages later in Settings. Model downloads only start when you ask, so a
			mis-click costs nothing.
		</p>

		<div class="mt-5 space-y-2" role="radiogroup" aria-label="Supported languages">
			{#each APPROVED_LANGUAGES as language (language.id)}
				<button
					type="button"
					role="radio"
					aria-checked={selected === language.id}
					class="language-option flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-all"
					class:selected={selected === language.id}
					onclick={() => (selected = language.id)}
				>
					<span class="min-w-0 flex-1">
						<span class="block text-sm font-semibold">{language.name}</span>
						<span class="block text-xs text-muted-foreground">{language.nativeName}</span>
					</span>
					{#if selected === language.id}
						<span class="grid size-6 place-items-center rounded-full bg-[var(--brand)] text-white">
							<Check class="size-3.5" />
						</span>
					{/if}
				</button>
			{/each}
		</div>

		<p class="mt-4 text-xs leading-relaxed text-muted-foreground">
			Speech recognition and voice models download from the internet on your device. Nothing is
			bundled with the app.
		</p>

		<button
			type="button"
			class="confirm-button mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-2xl text-sm font-semibold text-white shadow-lg transition-all hover:brightness-105 disabled:opacity-60"
			disabled={saving}
			onclick={() => void confirm()}
		>
			{#if saving}<Loader2 class="size-4 animate-spin" />{/if}
			{saving ? 'Saving…' : 'Continue'}
		</button>
	</div>
</div>

<style>
	.language-gate {
		background:
			radial-gradient(circle at 20% 10%, var(--brand-soft), transparent 45%),
			color-mix(in srgb, var(--background) 88%, transparent);
		backdrop-filter: blur(18px) saturate(140%);
	}
	.brand-orb {
		background: linear-gradient(145deg, var(--brand), var(--brand-2) 62%, var(--brand-3));
	}
	.confirm-button {
		background: linear-gradient(120deg, var(--brand), var(--brand-2));
	}
	.language-option:hover {
		background: var(--surface-2);
	}
	.language-option.selected {
		border-color: var(--brand);
		background: var(--brand-soft);
	}
	@media (prefers-reduced-motion: reduce) {
		.language-option,
		.confirm-button {
			transition-duration: 1ms;
		}
	}
</style>
