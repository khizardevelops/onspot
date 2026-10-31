<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

<script lang="ts">
	/**
	 * Settings → Usage: how much of each cloud service's limit or credit is
	 * left, per model or per account as the provider counts it.
	 */
	import {
		accountsLoading,
		accountsReadAt,
		refreshAccountUsage,
		usageClock,
		usageServices,
		type ModelUsage,
		type ServiceUsage,
		type UsageView
	} from '#lib/usage/monitor.js';
	import { formatAgo } from '#lib/usage/format.js';
	import SettingsSection from '#lib/components/settings/SettingsSection.svelte';
	import UsageMeterRow from '#lib/components/settings/UsageMeterRow.svelte';
	import { NeoButton } from '@dvcol/neo-svelte/buttons';
	import { NeoPill } from '@dvcol/neo-svelte/pill';
	import { AlertTriangle, ExternalLink, Loader2, RefreshCw } from '@lucide/svelte';

	interface Props {
		/** True while the Usage tab is showing; account figures are re-read then. */
		visible: boolean;
	}

	let { visible }: Props = $props();

	const SCOPE_LABEL: Record<ServiceUsage['scope'], string> = {
		model: 'Per model',
		account: 'Per account',
		local: 'On your device'
	};

	const hasCloudService = $derived($usageServices.some((service) => service.scope !== 'local'));

	/**
	 * The model each per-model card shows, by capability. A card shows the model
	 * in use until the learner picks another, and goes back to the model in use
	 * whenever Settings switches to a different one.
	 */
	let pickedModels = $state<Record<string, string>>({});
	/** The model in use per capability when last seen; not reactive, only compared. */
	const lastInUse: Record<string, string> = {};

	function modelInUse(service: ServiceUsage): ModelUsage | undefined {
		return service.models.find((model) => model.inUse);
	}

	$effect(() => {
		for (const service of $usageServices) {
			const inUse = modelInUse(service)?.model ?? '';
			const previous = lastInUse[service.capability];
			if (previous !== undefined && previous !== inUse) delete pickedModels[service.capability];
			lastInUse[service.capability] = inUse;
		}
	});

	function shownModel(service: ServiceUsage): ModelUsage | null {
		if (service.models.length === 0) return null;

		const picked = service.models.find((model) => model.model === pickedModels[service.capability]);
		return picked ?? modelInUse(service) ?? service.models[0];
	}

	function pickModel(service: ServiceUsage, model: string): void {
		pickedModels[service.capability] = model;
	}

	$effect(() => {
		if (visible) void refreshAccountUsage();
	});
</script>

<SettingsSection id="usage" title="Usage and limits">
	<div class="flex flex-col gap-2 border-b py-3.5 @md/field-group:flex-row @md/field-group:items-center @md/field-group:justify-between">
		<p class="max-w-md text-xs leading-normal text-muted-foreground">
			What is left of each cloud service you use, counted the way the provider limits it.
			{#if $accountsReadAt}Account figures updated {formatAgo($accountsReadAt, $usageClock)}.{/if}
		</p>
		{#if hasCloudService}
			<NeoButton rounded class="small-button shrink-0" disabled={$accountsLoading} onclick={() => void refreshAccountUsage(true)}>
				{#snippet icon()}{#if $accountsLoading}<Loader2 size={14} class="animate-spin" />{:else}<RefreshCw size={14} />{/if}{/snippet}
				Refresh
			</NeoButton>
		{/if}
	</div>

	{#each $usageServices as service (service.capability)}
		{@const shown = shownModel(service)}
		{@const view: UsageView = shown ?? service}
		<article class="usage-service border-b py-4 last:border-b-0" aria-labelledby={`usage-${service.capability}`}>
			<div class="flex flex-wrap items-start justify-between gap-2">
				<div class="min-w-0">
					<p class="eyebrow">{service.capability}</p>
					<h3 id={`usage-${service.capability}`} class="mt-0.5 text-sm font-semibold break-words">
						{service.provider} <span class="font-normal text-muted-foreground">· {service.subject}</span>
					</h3>
				</div>
				<NeoPill size="small" rounded elevation={0} tinted class="scope-pill">{SCOPE_LABEL[service.scope]}</NeoPill>
			</div>

			{#if service.models.length > 1 && shown}
				<div class="mt-3 flex flex-wrap gap-1.5" role="group" aria-label={`${service.provider} models`}>
					{#each service.models as model (model.model)}
						<NeoButton
							rounded
							class="model-chip"
							aria-pressed={model.model === shown.model}
							title={model.model}
							onclick={() => pickModel(service, model.model)}
						>
							{model.label}
							{#if model.inUse}<span class="in-use-mark">In use</span>{/if}
						</NeoButton>
					{/each}
				</div>
			{/if}

			{#if shown}
				<p class="model-id mt-2.5 text-xs">
					<span class="font-mono">{shown.model}</span>{#if !shown.inUse}{' · not the model you use now'}{/if}
				</p>
			{/if}

			{#if service.loading}
				<p class="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 class="size-3.5 animate-spin" /> Reading usage…</p>
			{/if}

			{#if service.error}
				<p class="mt-3 flex items-start gap-1.5 text-xs text-[var(--error)]">
					<AlertTriangle class="mt-0.5 size-3.5 shrink-0" /><span class="break-words">{service.error}</span>
				</p>
			{/if}

			{#if view.meters.length > 0}
				<div class="mt-3 grid gap-3.5">
					{#each view.meters as meter (meter.label)}
						<UsageMeterRow {meter} provider={service.provider} now={$usageClock} />
					{/each}
				</div>
			{/if}

			{#if service.balance}
				<p class="mt-3 text-sm"><span class="font-semibold">{service.balance}</span></p>
			{/if}

			{#if view.estimate}
				<p class="usage-estimate mt-3 text-sm leading-relaxed">{view.estimate}</p>
			{/if}

			{#each view.notes as note (note)}
				<p class="usage-note mt-2 text-xs leading-normal">{note}</p>
			{/each}

			{#if service.dashboard}
				<a class="settings-link mt-2 inline-flex items-center gap-1 text-xs" href={service.dashboard.url} target="_blank" rel="noreferrer">
					{service.dashboard.label} <ExternalLink class="size-3" />
				</a>
			{/if}
		</article>
	{/each}
</SettingsSection>

<style>
	.usage-service,
	.border-b {
		border-color: var(--border);
	}
	/* neo's theme styles bare headings outside any layer; restore ours. */
	h3 {
		margin: 0.125rem 0 0;
		font-size: 0.875rem;
		line-height: 1.25rem;
	}
	.usage-estimate {
		color: var(--foreground);
	}
	/* Small secondary text on the frosted card: the darker mix keeps it above 4.5:1 (see decisions.md). */
	.usage-note {
		color: color-mix(in srgb, var(--foreground) 62%, var(--muted-foreground));
	}
	/* Model chips: compact, and the selected one takes the app's accent border via aria-pressed. */
	:global(.neo-button.model-chip) {
		height: 30px;
		gap: 6px;
		padding: 0 11px;
		font-size: 0.8125rem;
		font-weight: 500;
	}
	.in-use-mark {
		margin-left: 0.375rem;
		font-size: 0.625rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--brand);
	}
	.model-id {
		color: color-mix(in srgb, var(--foreground) 62%, var(--muted-foreground));
	}
	:global(.neo-pill.scope-pill) {
		height: 20px;
		padding: 0 8px;
		font-size: 0.6875rem;
		font-weight: 600;
	}
</style>
