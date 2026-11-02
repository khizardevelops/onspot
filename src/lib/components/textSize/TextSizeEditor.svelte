<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

<script lang="ts">
	/**
	 * Sizing text on Settings → Text size's live preview, over the practice
	 * screen (`.text-size-canvas`). A tap on any text selects that part: it
	 * wears a ring, and a small control floating over the screen makes it
	 * larger or smaller for the state it is in, this window's layout (phone,
	 * tablet, desktop, which follows the window as it is resized) and, for a
	 * take's own text, that take's length. The change applies at once, here
	 * and everywhere (`stores/textSize.svelte.ts`). The control's part menu
	 * reaches every part from the keyboard, and Done goes back to Settings.
	 *
	 * The ring is an outline on the part itself, so it moves with its card and
	 * nothing is redrawn as the takes scroll.
	 */
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { pageHref } from '#lib/pages.js';
	import { hasPageBehind } from '#lib/navigation/back.svelte.js';
	import { closeOnBack } from '#lib/platform/backButton.svelte.js';
	import {
		DEFAULT_TEXT_SCALE,
		TEXT_DEVICES,
		TEXT_SCALE_MAX,
		TEXT_SCALE_MIN,
		TEXT_SECTIONS,
		currentTextDevice,
		setTextScale,
		stepTextScale,
		textScaleFor,
		type TakeLength,
		type TextSectionId
	} from '#lib/stores/textSize.svelte.js';
	import PopMenu from '#lib/components/PopMenu.svelte';
	import { NeoButton } from '@dvcol/neo-svelte/buttons';
	import type { NeoMenuItem } from '@dvcol/neo-svelte/floating/menu';
	import { AArrowDown, AArrowUp, Check, ChevronDown, RotateCcw } from '@lucide/svelte';

	/** The screen being sized (the route wraps the practice screen in it). */
	const CANVAS_SELECTOR = '.text-size-canvas';
	/** The selected part carries this attribute; the ring is drawn from it. */
	const SELECTED_ATTRIBUTE = 'data-text-size-selected';
	/**
	 * Parts whose only taps would be the words' own (a correction's jump to
	 * Feedback): on the preview a tap there selects the part and nothing else.
	 */
	const TEXT_ONLY_SECTIONS: readonly TextSectionId[] = ['said', 'corrected'];

	/** The part being sized, the take length it is in, and the element tapped (none when chosen from the menu and not on screen). */
	interface Selection {
		section: TextSectionId;
		length: TakeLength;
		element: HTMLElement | null;
	}

	let selection = $state<Selection | null>(null);

	const device = $derived(currentTextDevice());
	const deviceLabel = $derived(TEXT_DEVICES.find((layout) => layout.id === device)?.label ?? '');
	const section = $derived(selection ? (TEXT_SECTIONS.find((candidate) => candidate.id === selection?.section) ?? null) : null);
	const variant = $derived({ device, length: selection?.length ?? topTakeLength() });
	const scale = $derived(selection ? textScaleFor(selection.section, variant) : DEFAULT_TEXT_SCALE);
	/**
	 * Which state the size is for, short enough for a phone ("Phone · long"),
	 * and in full. The prompt and the Feedback cards are not part of a take:
	 * just the layout.
	 */
	const scope = $derived(section?.followsTakeLength ? `${deviceLabel} · ${variant.length}` : deviceLabel);
	const scopeInFull = $derived(
		section?.followsTakeLength ? `${deviceLabel}, ${variant.length} takes` : `${deviceLabel}, every take`
	);

	function percent(value: number): string {
		return `${Math.round(value * 100)}%`;
	}

	/** The length of the take on top of the stack: a part not in a take is sized there. */
	function topTakeLength(): TakeLength {
		const card = document.querySelector<HTMLElement>(`${CANVAS_SELECTOR} .stack-card.on-top [data-take-length]`);
		return card?.dataset.takeLength === 'long' ? 'long' : 'short';
	}

	function lengthOf(element: Element): TakeLength {
		const card = element.closest<HTMLElement>('[data-take-length]');
		if (!card) return topTakeLength();
		return card.dataset.takeLength === 'long' ? 'long' : 'short';
	}

	function select(id: TextSectionId, element: HTMLElement | null): void {
		selection = { section: id, length: element ? lengthOf(element) : topTakeLength(), element };
	}

	/** A tap on a part selects it (taps on its controls, folding or opening, still do what they do). */
	function pickOnTap(event: MouseEvent): void {
		if (!(event.target instanceof Element) || !event.target.closest(CANVAS_SELECTOR)) return;
		const part = event.target.closest<HTMLElement>('[data-text-section]');
		if (!part) return;
		const id = part.dataset.textSection as TextSectionId;
		select(id, part);
		if (TEXT_ONLY_SECTIONS.includes(id)) {
			event.preventDefault();
			event.stopPropagation();
		}
	}

	/** From the menu: the part as it shows in the take on top, or wherever it shows; otherwise just its name. */
	function selectFromMenu(id: TextSectionId): void {
		const onScreen = [...document.querySelectorAll<HTMLElement>(`${CANVAS_SELECTOR} [data-text-section="${id}"]`)].filter(
			(element) => element.getClientRects().length > 0
		);
		const element = onScreen.find((candidate) => candidate.closest('.stack-card.on-top')) ?? onScreen[0] ?? null;
		select(id, element);
		element?.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
	}

	/** The ring: on the selected part only, for as long as it is selected. */
	$effect(() => {
		const element = selection?.element;
		if (!element) return;
		element.setAttribute(SELECTED_ATTRIBUTE, '');
		return () => element.removeAttribute(SELECTED_ATTRIBUTE);
	});

	onMount(() => {
		document.addEventListener('click', pickOnTap, true);
		const clearOnEscape = (event: KeyboardEvent) => {
			if (event.key === 'Escape' && selection) selection = null;
		};
		document.addEventListener('keydown', clearOnEscape);
		return () => {
			document.removeEventListener('click', pickOnTap, true);
			document.removeEventListener('keydown', clearOnEscape);
		};
	});

	/** Back to Settings: the page it came from, or Settings itself when the preview was opened directly. */
	function done(): void {
		if (hasPageBehind()) history.back();
		else void goto(`${pageHref('/settings')}#text-size`, { replaceState: true });
	}
	// Android Back does the same when there is no page behind (it would go to Practice otherwise).
	closeOnBack(() => !hasPageBehind(), done);

	const partItems = $derived<NeoMenuItem[]>(
		TEXT_SECTIONS.map((candidate) => ({ value: candidate.id, label: candidate.label, description: candidate.detail, after: partSize }))
	);
</script>

{#snippet partSize({ item }: { item: { value: unknown } })}
	{@const id = item.value as TextSectionId}
	{@const value = textScaleFor(id, variant)}
	<span class="menu-size" class:changed={value !== DEFAULT_TEXT_SCALE}>
		{percent(value)}
		<Check size={14} class={id === selection?.section ? 'text-[var(--primary)]' : 'invisible'} aria-hidden="true" />
	</span>
{/snippet}

<!-- One row: the part (and, under its name, the state it is sized for), its size, Done. -->
<div class="size-control" role="group" aria-label="Text size">
	<div class="control-part">
		<PopMenu items={partItems} placement="bottom-start" onSelect={(item) => selectFromMenu(item.value as TextSectionId)} rounded>
			<NeoButton
				rounded
				elevation={1}
				class="part-picker"
				aria-label={section ? `Part: ${section.label}, sized for ${scopeInFull}. Choose another part` : 'Choose a part to size'}
				title={section ? `${section.label}: sizes for ${scopeInFull}` : undefined}
			>
				<span class="part-text">
					<span class="part-name">{section?.label ?? 'Parts'}</span>
					{#if section}<span class="control-scope">{scope}</span>{/if}
				</span>
				<ChevronDown size={14} class="shrink-0" />
			</NeoButton>
		</PopMenu>
		{#if !section}<span class="control-hint">Tap any text to size it</span>{/if}
	</div>

	{#if section && selection}
		{@const selected = selection}
		<div class="control-size">
			<NeoButton
				class="size-key"
				rounded
				elevation={2}
				aria-label="Smaller"
				title="Smaller"
				disabled={scale <= TEXT_SCALE_MIN}
				onclick={() => stepTextScale(selected.section, variant, -1)}
			>
				{#snippet icon()}<AArrowDown size={17} />{/snippet}
			</NeoButton>
			<span class="size-value" class:changed={scale !== DEFAULT_TEXT_SCALE} aria-live="polite">{percent(scale)}</span>
			<NeoButton
				class="size-key"
				rounded
				elevation={2}
				aria-label="Larger"
				title="Larger"
				disabled={scale >= TEXT_SCALE_MAX}
				onclick={() => stepTextScale(selected.section, variant, 1)}
			>
				{#snippet icon()}<AArrowUp size={17} />{/snippet}
			</NeoButton>
			<NeoButton
				text
				rounded
				class="size-reset"
				aria-label={`Reset ${section.label} to 100%`}
				title="Back to 100%"
				disabled={scale === DEFAULT_TEXT_SCALE}
				onclick={() => setTextScale(selected.section, variant, DEFAULT_TEXT_SCALE)}
			>
				{#snippet icon()}<RotateCcw size={15} />{/snippet}
			</NeoButton>
		</div>
	{/if}

	<NeoButton rounded color="primary" class="control-done" onclick={done}>Done</NeoButton>
</div>

<style>
	/*
	 * The ring on the selected part, and a faint one under a mouse pointer.
	 * Outlines take no room and are drawn with the part, so nothing moves or
	 * is redrawn as the takes scroll.
	 */
	:global(.text-size-canvas [data-text-section]) {
		cursor: pointer;
	}
	@media (hover: hover) {
		:global(.text-size-canvas [data-text-section]:hover:not([data-text-size-selected])) {
			outline: 1.5px dashed color-mix(in srgb, var(--brand) 55%, transparent);
			outline-offset: 2px;
		}
	}
	:global(.text-size-canvas [data-text-size-selected]) {
		outline: 2px solid var(--brand);
		outline-offset: 2px;
	}

	/*
	 * The control floats over the screen in one row: at the top on phones (the
	 * bar is at the bottom there), under the bar on tablets, at the bottom left
	 * of the takes on desktop (Feedback is on the right). Over the Feedback
	 * sheet too.
	 */
	.size-control {
		position: fixed;
		top: calc(env(safe-area-inset-top) + 0.5rem);
		left: 50%;
		z-index: 80;
		display: flex;
		align-items: center;
		gap: 0.375rem;
		width: max-content;
		max-width: calc(100vw - 1rem);
		padding: 0.375rem;
		border: 1px solid var(--sheet-line, var(--border));
		border-radius: 999px;
		background: var(--card);
		box-shadow:
			0 12px 28px -10px rgb(60 45 20 / 0.35),
			0 2px 6px rgb(60 45 20 / 0.12);
		transform: translateX(-50%);
	}
	:global([data-theme='dark']) .size-control {
		box-shadow:
			0 14px 30px -10px rgb(0 0 0 / 0.7),
			0 2px 6px rgb(0 0 0 / 0.45);
	}
	@media (min-width: 641px) {
		.size-control {
			top: 4.25rem;
			gap: 0.5rem;
			padding: 0.375rem 0.5rem;
		}
	}
	@media (min-width: 1024px) {
		.size-control {
			top: auto;
			bottom: 1.25rem;
			left: 1.25rem;
			transform: none;
		}
	}

	.control-part {
		display: flex;
		flex: 1 1 auto;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
	}
	.control-part :global(.neo-tooltip-trigger) {
		min-width: 0;
	}
	.control-part :global(.neo-button.part-picker) {
		gap: 0.25rem;
		min-width: 0;
		max-width: 100%;
		height: 40px;
		padding-inline: 0.875rem 0.5rem;
	}
	/* The part's name, and under it the state it is sized for. */
	.part-text {
		display: grid;
		min-width: 0;
		text-align: left;
		line-height: 1.15;
	}
	.part-name {
		overflow: hidden;
		font-size: 0.8125rem;
		font-weight: 600;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.control-scope {
		overflow: hidden;
		color: var(--muted-foreground);
		font-size: 0.6875rem;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.control-hint {
		color: var(--muted-foreground);
		font-size: 0.75rem;
		white-space: nowrap;
	}

	.control-size {
		display: flex;
		flex-shrink: 0;
		align-items: center;
		gap: 0.25rem;
	}
	.control-size :global(.neo-button.size-key),
	.control-size :global(.neo-button.size-reset) {
		flex-shrink: 0;
		width: var(--touch-target, 36px);
		height: var(--touch-target, 36px);
		padding: 0;
		justify-content: center;
	}
	.control-size :global(.neo-button.size-reset) {
		color: var(--muted-foreground);
	}
	.size-value {
		min-width: 2.75rem;
		color: var(--muted-foreground);
		font-size: 0.875rem;
		font-variant-numeric: tabular-nums;
		font-weight: 700;
		text-align: center;
	}
	.size-value.changed {
		color: var(--brand);
	}
	.size-control :global(.neo-button.control-done) {
		flex-shrink: 0;
		height: 40px;
		padding-inline: 1rem;
		font-weight: 600;
	}

	.menu-size {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		color: var(--muted-foreground);
		font-size: 0.75rem;
		font-variant-numeric: tabular-nums;
	}
	.menu-size.changed {
		color: var(--brand);
		font-weight: 600;
	}
</style>
