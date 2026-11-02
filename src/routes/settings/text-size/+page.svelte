<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

<script lang="ts">
	/**
	 * Settings → Text size → live preview: the practice screen itself, with a
	 * sample session (a short and a long French take with every text open,
	 * and their corrections in Feedback), laid out exactly as a session is on
	 * this device. Tapping any text sizes it (`TextSizeEditor`); the sizes are
	 * the real ones, so Practice reads the same. The sample session is not
	 * live: nothing records, plays, asks a provider or touches the database.
	 */
	import { get } from 'svelte/store';
	import PracticeScreen from '#lib/components/PracticeScreen.svelte';
	import TextSizeEditor from '#lib/components/textSize/TextSizeEditor.svelte';
	import { sampleSession } from '#lib/components/textSize/sampleSession.js';
	import { appSettings } from '#lib/stores/settings.js';

	const session = sampleSession(get(appSettings).instructionLanguage);
</script>

<svelte:head><title>Text size · onspot</title></svelte:head>

<!-- `contents`: the screen lays out in the app's frame exactly as on Practice. -->
<div class="text-size-canvas contents">
	<PracticeScreen {session} />
</div>
<TextSizeEditor />
