<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

<script lang="ts">
	/**
	 * An honest summary of the coach's scope: what the feedback teaches and
	 * what it deliberately does not measure. Placed in Settings so a learner
	 * knows why a take is judged on words rather than on their voice.
	 */
	import SettingsSection from './SettingsSection.svelte';
	import { Check, X } from '@lucide/svelte';

	const HELPS = [
		'Speaking spontaneously, without translating every sentence in your head',
		'Grammar in the sentences you actually say',
		'Vocabulary that fits the topic',
		'Register — formal for an exam, natural for a conversation'
	];

	const DOES_NOT = [
		'Your accent, or how close it sounds to a native speaker',
		'Pronunciation scoring, sound by sound',
		'Exam certification — only an exam board can award that'
	];
</script>

<SettingsSection id="what-onspot-does" title="What onspot can and cannot improve">
	<div class="scope">
		<p class="scope-intro">
			onspot coaches what you say, not how your voice sounds. Each take is judged on its words:
			the grammar, the vocabulary and the register of the sentence you produced.
		</p>

		<div class="scope-groups">
			<section class="scope-group" aria-labelledby="scope-helps">
				<h3 id="scope-helps" class="scope-heading">
					<span class="scope-mark helps" aria-hidden="true"><Check size={13} /></span>
					It helps with
				</h3>
				<ul class="scope-list">
					{#each HELPS as item (item)}
						<li><span class="scope-icon helps" aria-hidden="true"><Check size={13} /></span>{item}</li>
					{/each}
				</ul>
			</section>

			<section class="scope-group" aria-labelledby="scope-does-not">
				<h3 id="scope-does-not" class="scope-heading">
					<span class="scope-mark does-not" aria-hidden="true"><X size={13} /></span>
					It does not
				</h3>
				<ul class="scope-list">
					{#each DOES_NOT as item (item)}
						<li><span class="scope-icon does-not" aria-hidden="true"><X size={13} /></span>{item}</li>
					{/each}
				</ul>
			</section>
		</div>

		<p class="scope-note">
			Accent and pronunciation need a different kind of audio analysis, so onspot leaves them
			out rather than guessing. Use it to become more fluent and more accurate, then let a
			teacher or an exam board judge the sound.
		</p>
	</div>
</SettingsSection>

<style>
	.scope {
		display: grid;
		gap: 0.875rem;
		padding: 1rem 0 0.875rem;
	}
	.scope-intro,
	.scope-note {
		color: var(--muted-foreground);
		font-size: 0.8125rem;
		line-height: 1.55;
	}
	.scope-note {
		padding-top: 0.875rem;
		border-top: 1px solid var(--border);
	}
	.scope-groups {
		display: grid;
		gap: 0.75rem;
	}
	@media (min-width: 560px) {
		.scope-groups {
			grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
			align-items: start;
		}
	}
	.scope-group {
		padding: 0.75rem 0.875rem;
		border: 1px solid var(--border);
		border-radius: 12px;
		background: color-mix(in srgb, var(--surface-2) 55%, transparent);
	}
	.scope-heading {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin-bottom: 0.5rem;
		font-size: 0.75rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}
	.scope-mark {
		display: grid;
		width: 20px;
		height: 20px;
		place-items: center;
		border-radius: 999px;
	}
	.scope-mark.helps {
		background: color-mix(in srgb, var(--good) 16%, transparent);
		color: var(--good);
	}
	.scope-mark.does-not {
		background: color-mix(in srgb, var(--muted-foreground) 14%, transparent);
		color: var(--muted-foreground);
	}
	.scope-list {
		display: grid;
		gap: 0.35rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.scope-list li {
		display: grid;
		grid-template-columns: 16px minmax(0, 1fr);
		align-items: start;
		gap: 0.4rem;
		color: var(--foreground);
		font-size: 0.8125rem;
		line-height: 1.45;
	}
	.scope-icon {
		display: grid;
		margin-top: 0.1rem;
		place-items: center;
	}
	.scope-icon.helps {
		color: var(--good);
	}
	.scope-icon.does-not {
		color: var(--muted-foreground);
	}
</style>
