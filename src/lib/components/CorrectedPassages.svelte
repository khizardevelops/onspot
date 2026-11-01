<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

<script lang="ts">
	/**
	 * "Did you mean to say?" shown as only the corrected parts of the take: a
	 * numbered list of the passages of the correct version that hold a fix,
	 * each in its sentence or clause (see `utils/correctedPassages.ts`).
	 *
	 * Every passage is the same `Transcript` over the whole correct version,
	 * showing only its excerpt, so word indexes stay those of the whole text:
	 * hover meanings and selections share the whole text's meanings, and a
	 * selection stays inside the passage it started in.
	 *
	 * Without the change marks (`changedWords`, `removedBefore`,
	 * `replacedBefore`) the passages read as the clean correct version.
	 */
	import type { TextGlosses } from '#lib/adapters/db/index.js';
	import type { Passage } from '#lib/utils/correctedPassages.js';
	import Transcript from './Transcript.svelte';

	interface Props {
		/** The whole correct version. */
		text: string;
		passages: Passage[];
		changedWords?: ReadonlySet<number>;
		removedBefore?: ReadonlyMap<number, string>;
		replacedBefore?: ReadonlyMap<number, string>;
		/** Word meanings of the whole correct version, as `Transcript` takes them. */
		glosses: TextGlosses | null;
		requestGlosses: (wordIndex: number) => Promise<void>;
		requestPhrase: (start: number, end: number, phrase: string) => Promise<string>;
		/** Reads selected words aloud, as `Transcript` takes it. */
		speak?: (words: string) => void;
		class?: string;
	}

	let {
		text,
		passages,
		changedWords,
		removedBefore,
		replacedBefore,
		glosses,
		requestGlosses,
		requestPhrase,
		speak,
		class: className = ''
	}: Props = $props();
</script>

<ol class="corrected-passages" aria-label="The corrected parts of your take">
	{#each passages as passage (passage.start)}
		<li class="passage">
			<Transcript
				{text}
				excerpt={passage}
				{changedWords}
				{removedBefore}
				{replacedBefore}
				{glosses}
				{requestGlosses}
				{requestPhrase}
				{speak}
				class={className}
			/>
		</li>
	{/each}
</ol>

<style>
	/*
	 * Numbers hang in the margin, so every passage starts on the same line and
	 * a wrapped line continues under its first word, not under the number.
	 */
	.corrected-passages {
		display: grid;
		gap: 0.125em;
		margin: 0;
		padding: 0 0 0 1.9em;
		list-style: decimal outside;
	}
	.passage {
		overflow-wrap: break-word;
		text-wrap: pretty;
	}

	/* In the card's quiet ink and the UI face, so a number never reads as part of what to say. */
	.passage::marker {
		color: var(--faint);
		font-family: var(--font-sans);
		font-size: 0.8em;
		font-variant-numeric: tabular-nums;
	}
</style>
