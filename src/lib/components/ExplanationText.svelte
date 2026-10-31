<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

<script lang="ts">
	/**
	 * The spoken explanation as text, with its learner highlights (the mistake
	 * as said, the correct form, keywords worth remembering), then the follow-up
	 * question. The question's translation stays hidden until the learner asks
	 * for it, so they try to understand it in the target language first.
	 * Highlighted spans are in the target language, so they carry its `lang` and
	 * the serif face the app uses for target-language text.
	 */
	import { quickCollapse } from '#lib/neo.js';
	import { separateFollowUp, type FollowUp } from '#lib/adapters/llm/index.js';
	import { NeoButton } from '@dvcol/neo-svelte/buttons';
	import { NeoCollapse } from '@dvcol/neo-svelte/collapse';
	import { Loader2, Pause, Volume2 } from '@lucide/svelte';

	/** Playback of the follow-up question on its own, so it can be heard again without the whole explanation. */
	interface FollowUpAudio {
		playing: boolean;
		loading: boolean;
		onToggle: () => void;
	}

	interface Props {
		/** Explanation markup (see `adapters/llm/explanation.ts`). */
		markup: string;
		/** The follow-up question and its translation; older takes carry the question in `markup`. */
		followUp: FollowUp | null;
		/** BCP 47 locale of the target language, e.g. `fr`. */
		targetLocale: string;
		/** Name of the language of instruction, e.g. `English`, for the reveal button. */
		instructionLanguage: string;
		followUpAudio?: FollowUpAudio;
		class?: string;
	}

	let { markup, followUp, targetLocale, instructionLanguage, followUpAudio, class: className = '' }: Props = $props();

	const followUpButtonLabel = $derived.by(() => {
		if (followUpAudio?.loading) return 'Preparing the follow-up question';
		return followUpAudio?.playing ? 'Pause the follow-up question' : 'Play the follow-up question';
	});

	const explanation = $derived(separateFollowUp(markup));
	const question = $derived(followUp?.question || explanation.askedQuestion);
	const translation = $derived(followUp?.translation ?? '');

	let showTranslation = $state(false);
</script>

<div class="min-w-0">
	{#if explanation.parts.length > 0}
		<p class="explanation-text {className}" dir="auto">
			{#each explanation.parts as part, position (position)}
				{#if part.highlight}<mark class="learner-highlight" data-highlight={part.highlight} lang={targetLocale}>{part.text}</mark>{:else}{part.text}{/if}
			{/each}
		</p>
	{/if}

	{#if question}
		<!-- Corner marks (⛶) frame the follow-up, setting it apart from the explanation above it. -->
		<div class="follow-up" class:after-explanation={explanation.parts.length > 0}>
			<div class="flex min-h-6 flex-wrap items-center justify-center gap-x-1.5 gap-y-1">
				<div class="flex items-center gap-1">
					{#if followUpAudio}
						<NeoButton
							text
							rounded
							class="track-play"
							aria-label={followUpButtonLabel}
							title={followUpButtonLabel}
							aria-busy={followUpAudio.loading}
							onclick={followUpAudio.onToggle}
						>
							{#snippet icon()}
								{#if followUpAudio.loading}<Loader2 size={15} class="animate-spin" />{:else if followUpAudio.playing}<Pause size={15} />{:else}<Volume2 size={15} />{/if}
							{/snippet}
						</NeoButton>
					{/if}
					<p class="follow-up-label">Follow-up</p>
				</div>
				<!-- Beside the label it belongs to, centred with it. -->
				{#if translation}
					<span class="follow-up-dot" aria-hidden="true">·</span>
					<button type="button" class="pencil-link" aria-expanded={showTranslation} onclick={() => (showTranslation = !showTranslation)}>
						{showTranslation ? `Hide ${instructionLanguage}` : `Show ${instructionLanguage}`}
					</button>
				{/if}
			</div>
			<p class="follow-up-question {className}" lang={targetLocale}>{question}</p>
			{#if translation}
				<NeoCollapse transition={quickCollapse} open={showTranslation}>
					<p class="follow-up-translation {className}" dir="auto">{translation}</p>
				</NeoCollapse>
			{/if}
		</div>
	{/if}
</div>

<style>
	/* Ink stays the foreground colour on every tint, so contrast never depends on the highlight. */
	.learner-highlight {
		padding: 0 0.2em;
		border-radius: 0.3em;
		background: transparent;
		color: var(--foreground);
		font-family: var(--font-serif);
		box-decoration-break: clone;
		-webkit-box-decoration-break: clone;
	}

	/* What the learner said wrongly, marked like a correction's original in the Feedback panel. */
	.learner-highlight[data-highlight='wrong'] {
		background: var(--error-soft);
		text-decoration: line-through;
		text-decoration-color: var(--error);
		text-decoration-thickness: 1.5px;
	}

	.learner-highlight[data-highlight='right'] {
		background: var(--good-soft);
		font-weight: 600;
	}

	.learner-highlight[data-highlight='key'] {
		background: var(--brand-soft);
		font-weight: 600;
	}

	/*
	 * The follow-up is the learner's next prompt: framed by four corner marks,
	 * like a viewfinder (⛶), joined by a faint dotted line, in the
	 * target-language face. Marks and dots are background lines, so they take
	 * no room; the dots stop short of the corners, which stay the accent.
	 * Everything inside is centred, like a prompt card.
	 */
	.follow-up {
		text-align: center;
		--mark: color-mix(in srgb, var(--brand) 60%, transparent);
		--mark-arm: 12px;
		--mark-stroke: 1.5px;
		--dot: color-mix(in srgb, var(--brand) 32%, transparent);
		--dot-gap: 4px;
		--dot-span: calc(100% - 2 * (var(--mark-arm) + var(--dot-gap)));
		--dots-across: repeating-linear-gradient(to right, var(--dot) 0 1.5px, transparent 1.5px 5px);
		--dots-down: repeating-linear-gradient(to bottom, var(--dot) 0 1.5px, transparent 1.5px 5px);
		padding: 0.5rem 0.75rem 0.625rem;
		background:
			var(--dots-across) top center / var(--dot-span) 1px,
			var(--dots-across) bottom center / var(--dot-span) 1px,
			var(--dots-down) left center / 1px var(--dot-span),
			var(--dots-down) right center / 1px var(--dot-span),
			linear-gradient(var(--mark), var(--mark)) top left / var(--mark-arm) var(--mark-stroke),
			linear-gradient(var(--mark), var(--mark)) top left / var(--mark-stroke) var(--mark-arm),
			linear-gradient(var(--mark), var(--mark)) top right / var(--mark-arm) var(--mark-stroke),
			linear-gradient(var(--mark), var(--mark)) top right / var(--mark-stroke) var(--mark-arm),
			linear-gradient(var(--mark), var(--mark)) bottom left / var(--mark-arm) var(--mark-stroke),
			linear-gradient(var(--mark), var(--mark)) bottom left / var(--mark-stroke) var(--mark-arm),
			linear-gradient(var(--mark), var(--mark)) bottom right / var(--mark-arm) var(--mark-stroke),
			linear-gradient(var(--mark), var(--mark)) bottom right / var(--mark-stroke) var(--mark-arm);
		background-repeat: no-repeat;
	}
	.follow-up.after-explanation {
		margin-top: 0.75rem;
	}
	.follow-up-dot {
		color: var(--faint);
	}
	.follow-up-label {
		font-size: 0.6875rem;
		font-weight: 600;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: color-mix(in srgb, var(--foreground) 62%, var(--muted-foreground));
	}
	.follow-up-question {
		font-family: var(--font-serif);
		font-style: italic;
		color: var(--foreground);
	}
	.follow-up-translation {
		padding-top: 0.25rem;
		color: color-mix(in srgb, var(--foreground) 62%, var(--muted-foreground));
	}
</style>
