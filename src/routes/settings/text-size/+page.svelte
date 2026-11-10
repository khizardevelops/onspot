<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

<script lang="ts">
	/**
	 * Settings → Text size → live preview: the practice screen itself, with a
	 * sample session (a short and a long take in the studied language, with
	 * every text open and their corrections in Feedback), laid out exactly as a
	 * session is on this device. Tapping any text sizes it (`TextSizeEditor`);
	 * the sizes are the real ones, so Practice reads the same. The sample
	 * session is not live: nothing records, plays, asks a provider or touches
	 * the database.
	 */
	import PracticeScreen from '#lib/components/PracticeScreen.svelte';
	import TextSizeEditor from '#lib/components/textSize/TextSizeEditor.svelte';
	import { sampleSession } from '#lib/components/textSize/sampleSession.js';
	import { appSettings, settingsReady } from '#lib/stores/settings.js';
	import type { PracticeSession } from '#lib/stores/practiceSession.js';

	let session = $state<PracticeSession | null>(null);

	$effect(() => {
		if (!$settingsReady) return;
		session = sampleSession($appSettings.instructionLanguage, $appSettings.targetLanguage);
	});
</script>

<svelte:head><title>Text size · onspot</title></svelte:head>

<!-- `contents`: the screen lays out in the app's frame exactly as on Practice. -->
{#if session}
	<div class="text-size-canvas contents">
		<PracticeScreen {session} />
	</div>
	<TextSizeEditor />
{/if}
