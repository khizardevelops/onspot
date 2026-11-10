<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

<script lang="ts">
	/**
	 * Tells the learner when a selected language is one their configured speech
	 * engines cannot handle (`languageSupportIssues`): which engine, which
	 * language, and what to choose instead. Nothing shows when all is well.
	 */
	import { AlertTriangle } from '@lucide/svelte';
	import { appSettings } from '#lib/stores/settings.js';
	import { languageSupportIssues, type LanguageSupportStep } from '#lib/languages/support.js';

	interface Props {
		/** Only these steps' problems; all of them when absent. */
		steps?: readonly LanguageSupportStep[];
	}

	let { steps }: Props = $props();

	const issues = $derived(
		languageSupportIssues($appSettings).filter((issue) => !steps || steps.includes(issue.step))
	);
</script>

{#if issues.length > 0}
	<div class="language-support" role="status">
		<AlertTriangle class="size-4 shrink-0" aria-hidden="true" />
		<ul>
			{#each issues as issue (issue.message)}
				<li>{issue.message}</li>
			{/each}
		</ul>
	</div>
{/if}

<style>
	.language-support {
		display: flex;
		align-items: flex-start;
		gap: 0.625rem;
		margin: 0.75rem 0;
		padding: 0.75rem 0.875rem;
		border: 1px solid color-mix(in srgb, var(--warn) 45%, transparent);
		border-radius: 12px;
		background: color-mix(in srgb, var(--warn) 10%, transparent);
		color: var(--foreground);
		font-size: 0.8125rem;
		line-height: 1.45;
	}
	.language-support :global(svg) {
		margin-top: 0.125rem;
		color: var(--warn);
	}
	ul {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
</style>
