<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

<script lang="ts">
	import { onDestroy, onMount, tick } from 'svelte';
	import { LEVELS, appSettings, setSetting } from '#lib/stores/settings.js';
	import { setTargetLanguage, setInstructionLanguage } from '#lib/stores/practice.js';
	import { pageHref } from '#lib/pages.js';
	import { OFFERED_LANGUAGES, instructionLanguagesFor, isCandidate, requireLanguage } from '#lib/languages/index.js';
	import SettingsSection from '#lib/components/settings/SettingsSection.svelte';
	import SettingRow from '#lib/components/settings/SettingRow.svelte';
	import SettingSelect from '#lib/components/settings/SettingSelect.svelte';
	import ProcessingSection from '#lib/components/settings/ProcessingSection.svelte';
	import SetupSection from '#lib/components/settings/SetupSection.svelte';
	import IosInstallSection from '#lib/components/settings/IosInstallSection.svelte';
	import ZoomSettings from '#lib/components/settings/ZoomSettings.svelte';
	import TextSizeSettings from '#lib/components/settings/TextSizeSettings.svelte';
	import ReminderSettings from '#lib/components/settings/ReminderSettings.svelte';

	import DataSettings from '#lib/components/settings/DataSettings.svelte';
	import UsageMonitor from '#lib/components/settings/UsageMonitor.svelte';
	import VoiceLibraryPanel from '#lib/components/settings/VoiceLibraryPanel.svelte';
	import LanguageSupportNotice from '#lib/components/settings/LanguageSupportNotice.svelte';
	import { closeVoiceLibrary, voiceLibrary, type VoiceRole } from '#lib/stores/voiceLibrary.js';
	import AppHeader from '#lib/components/AppHeader.svelte';
	import { SwipeBetweenTabs, type TabStep } from '#lib/gestures/swipeBetweenTabs.js';
	import type { ProcessingTarget } from '#lib/stores/processing.js';

	type TabId = 'learning' | 'usage' | 'data';

	const TABS: readonly { id: TabId; label: string; icon: string }[] = [
		{
			id: 'learning',
			label: 'Learning',
			icon: 'M4 5.5A1.5 1.5 0 0 1 5.5 4H11v15H5.5A1.5 1.5 0 0 0 4 20.5v-15ZM20 5.5A1.5 1.5 0 0 0 18.5 4H13v15h5.5a1.5 1.5 0 0 1 1.5 1.5v-15Z'
		},
		{ id: 'usage', label: 'Usage', icon: 'M4 19V9m5.3 10V5m5.4 14v-7M20 19v-4' },
		{
			id: 'data',
			label: 'Data',
			icon: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3Zm0 0v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6m-16 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6'
		}
	];

	const TAB_IDS: readonly TabId[] = TABS.map((t) => t.id);

	const HASH_TABS: Record<string, TabId> = {
		'#language': 'learning',
		'#processing': 'learning',
		'#speech-to-text': 'learning',
		'#llm': 'learning',
		'#text-to-speech': 'learning',
		'#ai-provider': 'learning',
		'#transcription': 'learning',
		'#voice': 'learning',
		'#interface-scale': 'learning',
		'#zoom': 'learning',
		'#text-size': 'learning',
		'#setup': 'learning',
		'#reminders': 'learning',
		'#what-onspot-does': 'learning',
		'#about': 'learning',
		'#usage': 'usage',
		'#storage': 'data',
		'#cloud-sync': 'data'
	};

	/** Legacy anchors from earlier builds still focus the right row. */
	const HASH_FOCUS: Record<string, ProcessingTarget> = {
		'#speech-to-text': 'speech-to-text',
		'#transcription': 'speech-to-text',
		'#llm': 'llm',
		'#ai-provider': 'llm',
		'#text-to-speech': 'text-to-speech',
		'#voice': 'text-to-speech'
	};

	let tab = $state<TabId>('learning');
	let focusTarget = $state<ProcessingTarget | null>(null);
	let focusNonce = $state(0);

	function showHash(): void {
		const hash = location.hash;
		const next = HASH_TABS[hash];
		if (next) tab = next;

		const target = HASH_FOCUS[hash] ?? null;
		focusTarget = target;
		if (target) focusNonce++;

		if (!hash) return;
		const scrollTarget = target ? `#${target}` : hash;

		void tick().then(() => {
			document.querySelector(scrollTarget)?.scrollIntoView({ block: 'center', behavior: 'auto' });
		});
	}

	onMount(() => {
		showHash();
		addEventListener('hashchange', showHash);
		return () => removeEventListener('hashchange', showHash);
	});

	function selectTab(next: string | number | undefined): void {
		const nextTab = TAB_IDS.find((id) => id === next);
		if (!nextTab) return;
		tab = nextTab;
		focusTarget = null;
	}

	/** Arrow keys, Home and End move between the tabs, as a tab list should. */
	function onTabKey(event: KeyboardEvent): void {
		const last = TAB_IDS.length - 1;
		const at = TAB_IDS.indexOf(tab);
		let to = at;
		if (event.key === 'ArrowDown' || event.key === 'ArrowRight') to = at === last ? 0 : at + 1;
		else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') to = at === 0 ? last : at - 1;
		else if (event.key === 'Home') to = 0;
		else if (event.key === 'End') to = last;
		else return;
		event.preventDefault();
		selectTab(TAB_IDS[to]);
		void tick().then(() => document.getElementById(`tab-${TAB_IDS[to]}`)?.focus());
	}

	/*
	 * Touch screens: a swipe sideways across the page shows the next or previous
	 * tab. When the tabs have scrolled out of sight, the page returns to them, so
	 * it is clear which tab is showing.
	 */
	let scroller = $state<HTMLElement>();
	let tabsRow = $state<HTMLElement>();

	$effect(() => {
		if (!scroller) return;
		const tabSwipe = new SwipeBetweenTabs(stepTab);
		return tabSwipe.listen(scroller);
	});

	/*
	 * The on-device voice library opens beside the settings when the page has
	 * room for both, and the settings column moves left; otherwise it opens
	 * over them as a sheet. The width is the page's own (after the interface
	 * scale), so a zoomed-in window gets the sheet sooner.
	 */
	const LIBRARY_BESIDE_MIN_PAGE_WIDTH = 1100;

	/** The trigger that opens each role's library, to give focus back when it closes. */
	const LIBRARY_TRIGGER_IDS: Record<VoiceRole, string> = { target: 'ttsVoice', explanation: 'explanationVoice' };

	let pageWidth = $state(0);
	const libraryRole = $derived($voiceLibrary.open);
	const libraryBeside = $derived(libraryRole !== null && pageWidth >= LIBRARY_BESIDE_MIN_PAGE_WIDTH);
	const libraryOver = $derived(libraryRole !== null && !libraryBeside);

	// The library belongs to the on-device voices on the Learning tab.
	$effect(() => {
		if (tab !== 'learning' || $appSettings.ttsMode !== 'local') closeVoiceLibrary();
	});

	onDestroy(closeVoiceLibrary);

	function closeLibrary(): void {
		const role = libraryRole;
		closeVoiceLibrary();
		if (role) void tick().then(() => document.getElementById(LIBRARY_TRIGGER_IDS[role])?.focus({ preventScroll: true }));
	}

	function stepTab(step: TabStep): void {
		const next = TAB_IDS[TAB_IDS.indexOf(tab) + step];
		if (!next) return;
		selectTab(next);
		if (scroller && tabsRow && tabsRow.getBoundingClientRect().top < scroller.getBoundingClientRect().top) {
			scroller.scrollTo({ top: 0 });
		}
	}
</script>

<svelte:head><title>Settings · onspot</title></svelte:head>

<div class="flex h-full flex-col" bind:clientWidth={pageWidth} inert={libraryOver}>
	<AppHeader title="Settings" />
	<div class="settings-body min-h-0 flex-1" class:library-beside={libraryBeside}>
		<div class="desk h-full min-h-0 overflow-y-auto" bind:this={scroller}>
			<div class="shell mx-auto max-w-[1040px] px-4 pt-6 pb-20 sm:px-8 sm:pt-10">
				<div class="layout">
					<nav class="rail" bind:this={tabsRow} aria-label="Settings sections">
						<div class="tablist" role="tablist">
							{#each TABS as t (t.id)}
								<button
									type="button"
									role="tab"
									id="tab-{t.id}"
									class="tab"
									class:active={tab === t.id}
									aria-selected={tab === t.id}
									aria-controls="tabpanel-{t.id}"
									tabindex={tab === t.id ? 0 : -1}
									onclick={() => selectTab(t.id)}
									onkeydown={onTabKey}
								>
									<svg viewBox="0 0 24 24" aria-hidden="true"><path d={t.icon} /></svg>
									<span>{t.label}</span>
								</button>
							{/each}
						</div>
						<p class="note">
							Choose Local or Cloud for speech-to-text, the LLM and text-to-speech. Keys stay in this browser and
							are never written to the synced database.
						</p>
					</nav>

					<div class="content">
						<div
							id="tabpanel-learning"
							role="tabpanel"
							aria-labelledby="tab-learning"
							class="panel"
							class:hidden={tab !== 'learning'}
						>

							<SetupSection />

							<IosInstallSection />

							<SettingsSection id="language" title="Language">
								<SettingRow label="I am studying" for="targetLanguage">
									<SettingSelect
										id="targetLanguage"
										label="Language you are studying"
										options={OFFERED_LANGUAGES.map((entry) => ({
											value: entry.id,
											label: `${entry.name} (${entry.nativeName})${isCandidate(entry) ? ' · candidate, not yet approved' : ''}`
										}))}
										value={$appSettings.targetLanguage}
										onchange={(value) => void setTargetLanguage(value)}
									/>
								</SettingRow>
								<SettingRow
									label="Language of instruction"
									for="instructionLanguage"
									hint="Explanations, translations and word meanings are in this language."
								>
									<SettingSelect
										id="instructionLanguage"
										label="Language of instruction"
										options={instructionLanguagesFor(requireLanguage($appSettings.targetLanguage)).map((entry) => ({
											value: entry.id,
											label: entry.nativeName === entry.name ? entry.name : `${entry.name} (${entry.nativeName})`
										}))}
										value={$appSettings.instructionLanguage}
										onchange={(value) => setInstructionLanguage(value)}
									/>
								</SettingRow>
								<LanguageSupportNotice />
								<SettingRow label="Your level" for="level">
									<SettingSelect
										id="level"
										label="Your level"
										options={LEVELS.map((level) => ({ value: level, label: level }))}
										value={$appSettings.level}
										onchange={(value) => setSetting('level', value)}
									/>
								</SettingRow>
								<SettingRow label="Default mode" for="defaultMode">
									<SettingSelect
										id="defaultMode"
										label="Default mode"
										options={[
											{ value: 'exam', label: 'Exam' },
											{ value: 'casual', label: 'Casual' },
											{ value: 'freeflow', label: 'Free Flow' }
										]}
										value={$appSettings.mode}
										onchange={(value) => setSetting('mode', value as 'exam' | 'casual' | 'freeflow')}
									/>
								</SettingRow>
								<SettingRow
									label="Show part of speech in word tooltips"
									for="showWordPos"
									hint="When you hover over a word, the tooltip also shows whether it is a noun, verb, adjective, etc."
								>
									<input
										type="checkbox"
										role="switch"
										id="showWordPos"
										checked={$appSettings.showWordPos}
										onchange={(e) => setSetting('showWordPos', e.currentTarget.checked)}
										class="pos-toggle"
									/>
								</SettingRow>
							</SettingsSection>

							<ProcessingSection focus={focusTarget} {focusNonce} />

							<ZoomSettings />

							<TextSizeSettings />

							<ReminderSettings />

							<section id="about" class="about-link-row">
								<a href={pageHref('/about')} class="settings-link" aria-label="Learn about onspot">
									About onspot: aims, what it can and cannot do, links &amp; source code
								</a>
							</section>
						</div>

						<div
							id="tabpanel-usage"
							role="tabpanel"
							aria-labelledby="tab-usage"
							class="panel"
							class:hidden={tab !== 'usage'}
						>
							<UsageMonitor visible={tab === 'usage'} />
						</div>

						<div
							id="tabpanel-data"
							role="tabpanel"
							aria-labelledby="tab-data"
							class="panel"
							class:hidden={tab !== 'data'}
						>
							<DataSettings />
						</div>
					</div>
				</div>
			</div>
		</div>
		{#if libraryBeside && libraryRole}
			<div class="library-column">
				<VoiceLibraryPanel role={libraryRole} layout="beside" onclose={closeLibrary} />
			</div>
		{/if}
	</div>
</div>

{#if libraryOver && libraryRole}
	<VoiceLibraryPanel role={libraryRole} layout="over" onclose={closeLibrary} />
{/if}

<style>
	/* With the voice library open beside them, the settings take the space left of it. */
	.settings-body.library-beside {
		display: grid;
		grid-template-columns: minmax(0, 1fr) clamp(24rem, 36%, 30rem);
	}
	.library-column {
		min-height: 0;
		padding: 1.25rem 1.25rem 1.25rem 0;
	}

	/*
	 * Tokens. Surfaces and ink come from the app's own variables, so dark mode
	 * follows the app. The section components read these through inheritance.
	 * Set --font-display to change the section-title face.
	 */
	.shell {
		--paper: var(--background);
		--card-paper: var(--card, var(--background));
		--ink: var(--foreground);
		--ink-soft: var(--muted-foreground);
		--rule: color-mix(in srgb, var(--ink) 13%, transparent);
		--accent: var(--brand, var(--primary));
		--tint: color-mix(in srgb, var(--ink) 3.5%, transparent);
		--sheet:
			linear-gradient(var(--tint), var(--tint)), color-mix(in srgb, var(--card-paper) 62%, transparent);
		--tape: rgb(204 178 128 / 0.5);
		--display: var(--font-display, 'Fraunces', 'Iowan Old Style', 'Palatino Linotype', Georgia, serif);
		container-type: inline-size;
		container-name: shell;
	}

	/* Paper grain, kept faint, with soft light so the translucent sheets have something to blur. */
	.desk {
		background-color: var(--background);
		background-image:
			url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 .4 0 0 0 0 .36 0 0 0 0 .3 0 0 0 .075 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>"),
			radial-gradient(60rem 28rem at 8% -4%, color-mix(in srgb, var(--accent) 7%, transparent), transparent 70%),
			radial-gradient(50rem 30rem at 100% 100%, color-mix(in srgb, var(--ink) 5%, transparent), transparent 70%);
		background-attachment: local, scroll, scroll;
	}

	.layout {
		display: grid;
		gap: 1.25rem;
	}

	/* Narrow pages: a segmented tab row, the note beneath. */
	.rail {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
	}
	.tablist {
		display: flex;
		gap: 0.2rem;
		padding: 0.25rem;
		border: 1px solid var(--rule);
		border-radius: 10px;
		background: var(--sheet);
		backdrop-filter: blur(14px) saturate(1.3);
		-webkit-backdrop-filter: blur(14px) saturate(1.3);
	}
	.tab {
		position: relative;
		display: flex;
		flex: 1 1 0;
		align-items: center;
		justify-content: center;
		gap: 0.55rem;
		padding: 0.5rem 0.75rem;
		border-radius: 7px;
		color: var(--ink-soft);
		font-size: 0.875rem;
		font-weight: 500;
		transition:
			background-color 120ms ease,
			color 120ms ease;
	}
	.tab svg {
		width: 1.05rem;
		height: 1.05rem;
		flex: none;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.6;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.tab:hover {
		color: var(--ink);
		background: var(--tint);
	}
	.tab.active {
		color: var(--ink);
		background: color-mix(in srgb, var(--ink) 8%, transparent);
		font-weight: 600;
	}
	.tab.active svg {
		color: var(--accent);
	}
	.tab:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}
	.note {
		margin: 0;
		color: var(--ink-soft);
		font-size: 0.78rem;
		line-height: 1.55;
	}

	/* Wide pages: a sidebar sheet, held to the desk by one strip of tape. */
	@container shell (min-width: 760px) {
		.layout {
			grid-template-columns: 14rem minmax(0, 1fr);
			gap: 2.5rem;
		}
		.rail {
			position: sticky;
			top: 1.25rem;
			align-self: start;
			gap: 0;
			padding: 0.5rem;
			border: 1px solid var(--rule);
			border-radius: 14px;
			background: var(--sheet);
			backdrop-filter: blur(16px) saturate(1.35);
			-webkit-backdrop-filter: blur(16px) saturate(1.35);
			box-shadow:
				0 1px 0 rgb(255 255 255 / 0.28) inset,
				0 12px 28px -18px rgb(30 25 15 / 0.35);
		}
		.rail::before {
			content: '';
			position: absolute;
			top: -0.55rem;
			left: 50%;
			width: 4.5rem;
			height: 1.1rem;
			background: var(--tape);
			backdrop-filter: blur(2px);
			border-inline: 1px solid rgb(0 0 0 / 0.05);
			clip-path: polygon(0 0, 100% 0, 97% 25%, 100% 50%, 97% 75%, 100% 100%, 0 100%, 3% 75%, 0 50%, 3% 25%);
			transform: translateX(-50%) rotate(-2deg);
			pointer-events: none;
		}
		.tablist {
			flex-direction: column;
			padding: 0;
			border: 0;
			background: none;
			backdrop-filter: none;
			-webkit-backdrop-filter: none;
		}
		.tab {
			flex: none;
			justify-content: flex-start;
			padding: 0.6rem 0.75rem;
		}
		.note {
			margin-top: 0.5rem;
			padding: 0.85rem 0.75rem 0.5rem;
			border-top: 1px solid var(--rule);
		}
	}

	/* A panel settles in when it is chosen. */
	.panel:not(.hidden) {
		animation: settle 160ms ease-out;
	}
	.panel > :global(*:first-child) {
		margin-top: 0;
	}
	@keyframes settle {
		from {
			opacity: 0;
		}
	}

	/* Text fields elsewhere in the sections match the selects. */
	.content :global(input:is([type='text'], [type='password'], [type='number'], [type='search'])) {
		min-height: 2.25rem;
		padding: 0.3rem 0.75rem;
		border: 1px solid var(--rule);
		border-radius: 8px;
		background-color: color-mix(in srgb, var(--paper) 55%, transparent);
		color: var(--ink);
		font-size: 0.875rem;
		transition:
			border-color 120ms ease,
			box-shadow 120ms ease;
	}
	.content :global(input:is([type='text'], [type='password'], [type='number'], [type='search']):focus-visible) {
		outline: none;
		border-color: var(--accent);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent);
	}

	/* Shared by the section components (Svelte scoped styles cannot reach them). */
	.content :global(.neo-card.info-item) {
		--neo-card-margin: 1rem 0;
		--info-spacing: 16px 18px;
		border-radius: 12px;
	}
	@media (min-width: 640px) {
		.content :global(.neo-card.info-item) {
			--info-spacing: 18px 22px;
		}
	}
	.content :global(.info-body) {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 12px 16px;
	}
	.content :global(.info-content) {
		display: flex;
		flex: 1 1 14rem;
		min-width: 14rem;
		flex-direction: column;
		gap: 4px;
	}
	.content :global(.info-actions) {
		display: flex;
		gap: 8px;
	}
	.content :global(.info-footer) {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin-top: 12px;
	}
	.content :global(.neo-button.small-button) {
		font-size: 0.8125rem;
		padding-block: 0.3rem;
	}
	.content :global(.settings-link) {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		color: var(--accent);
		font-weight: 550;
		text-underline-offset: 3px;
		transition: color 100ms ease;
	}
	.content :global(.settings-link:hover) {
		color: var(--brand-hover, var(--accent));
		text-decoration: underline;
	}
	.about-link-row {
		margin-top: 2rem;
		padding: 0.9rem 1.15rem;
		border: 1px solid var(--rule);
		border-radius: 12px;
		background: var(--sheet);
	}

	/* Part-of-speech switch */
	.pos-toggle {
		appearance: none;
		position: relative;
		flex: none;
		width: 2.375rem;
		height: 1.375rem;
		border: 1px solid var(--rule);
		border-radius: 999px;
		background: color-mix(in srgb, var(--ink) 14%, transparent);
		cursor: pointer;
		transition: background-color 140ms ease;
	}
	.pos-toggle::before {
		content: '';
		position: absolute;
		top: 2px;
		left: 2px;
		width: 1.0625rem;
		height: 1.0625rem;
		border-radius: 50%;
		background: var(--card-paper);
		box-shadow: 0 1px 2px rgb(30 25 15 / 0.3);
		transition: transform 160ms cubic-bezier(0.3, 0.7, 0.3, 1);
	}
	.pos-toggle:checked {
		border-color: transparent;
		background: var(--accent);
	}
	.pos-toggle:checked::before {
		transform: translateX(1rem);
	}
	.pos-toggle:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	@media (prefers-reduced-motion: reduce) {
		.panel:not(.hidden) {
			animation: none;
		}
		.pos-toggle::before,
		.tab,
		.content :global(input) {
			transition: none;
		}
	}
</style>