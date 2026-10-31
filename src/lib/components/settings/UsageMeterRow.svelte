<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

<script lang="ts">
	/**
	 * One limit of one service: what is left, a gauge that empties as it is
	 * used, and where the figures came from.
	 */
	import type { UsageMeter } from '#lib/usage/monitor.js';
	import { formatAgo, formatPortion, formatReset } from '#lib/usage/format.js';
	import { NeoProgressBar } from '@dvcol/neo-svelte/progress';

	interface Props {
		meter: UsageMeter;
		/** Provider name, for "Live from Groq". */
		provider: string;
		now: number;
	}

	let { meter, provider, now }: Props = $props();

	/** Below these shares left, the gauge turns amber, then red. */
	const LOW_SHARE = 0.25;
	const CRITICAL_SHARE = 0.1;

	const remaining = $derived(Math.max(0, meter.limit - meter.used));
	const remainingShare = $derived(meter.limit > 0 ? remaining / meter.limit : 0);
	const portion = $derived(formatPortion(remaining, meter.limit, meter.unit));

	const gaugeColor = $derived.by(() => {
		if (remainingShare < CRITICAL_SHARE) return 'var(--error)';
		if (remainingShare < LOW_SHARE) return 'var(--warn)';
		return 'var(--good)';
	});

	/**
	 * Where the figures came from, when it is not the device's own count: the
	 * service's note already explains counting, so repeating it under every
	 * meter would only bury the readings that come from the provider.
	 */
	const provenance = $derived.by(() => {
		const seen = meter.observedAt ? `, ${formatAgo(meter.observedAt, now)}` : '';
		if (meter.usedSource === 'account') return `From your ${provider} account${seen}`;
		if (meter.usedSource === 'live') return `Live from ${provider}${seen}`;
		if (meter.usedSource === 'reported') return `Reported by ${provider} when it refused a call${seen}`;
		return meter.limitSource === 'reported' ? `Limit reported by ${provider}` : null;
	});

	const timing = $derived(
		meter.resetsAt && meter.used > 0 ? `refills ${formatReset(meter.resetsAt, now)}` : meter.span
	);
	const detail = $derived(provenance ? `${provenance} · ${timing}` : timing);
</script>

<div class="usage-meter">
	<div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
		<p class="text-sm font-medium">{meter.label}</p>
		<p class="text-sm text-muted-foreground tabular-nums">
			<span class="font-semibold text-foreground">{portion.part}</span>
			{portion.ofWhole} left
		</p>
	</div>
	<NeoProgressBar
		value={remainingShare * 100}
		rounded
		height="6px"
		color={gaugeColor}
		aria-label={`${meter.label}: ${portion.part} ${portion.ofWhole} left`}
	/>
	<p class="usage-provenance">{detail}</p>
</div>

<style>
	.usage-meter {
		display: grid;
		gap: 0.375rem;
	}
	/* Small secondary text on the frosted card: the darker mix keeps it above 4.5:1 (see decisions.md). */
	.usage-provenance {
		font-size: 0.75rem;
		line-height: 1.4;
		color: color-mix(in srgb, var(--foreground) 62%, var(--muted-foreground));
	}
</style>
