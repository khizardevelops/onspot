<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

<script lang="ts">
	/**
	 * The way back into the first-run guide. The guide is also opened
	 * automatically on a device with no usable LLM, but a learner who skipped it
	 * needs a deliberate way back without hunting through the key fields.
	 */
	import { pageHref } from '#lib/pages.js';
	import SettingsSection from './SettingsSection.svelte';
	import SettingRow from './SettingRow.svelte';
	import { NeoButton } from '@dvcol/neo-svelte/buttons';
	import { Compass } from '@lucide/svelte';
</script>

<SettingsSection id="setup" title="Getting started">
	<SettingRow
		label="Setup guide"
		hint="Walk through the coach key and the voice choice again, with links to create each key."
	>
		<NeoButton href={pageHref('/welcome')} rounded>
			{#snippet icon()}<Compass class="size-4" />{/snippet}
			Open setup guide
		</NeoButton>
	</SettingRow>
</SettingsSection>
