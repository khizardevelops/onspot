<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

<script lang="ts">
	import { onDestroy, onMount, tick } from 'svelte';
	import { LEVELS, appSettings, setSetting } from '#lib/stores/settings.js';
	import { setTargetLanguage } from '#lib/stores/practice.js';
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
	import WhatOnspotDoes from '#lib/components/settings/WhatOnspotDoes.svelte';
	import DataSettings from '#lib/components/settings/DataSettings.svelte';
	import UsageMonitor from '#lib/components/settings/UsageMonitor.svelte';
	import VoiceLibraryPanel from '#lib/components/settings/VoiceLibraryPanel.svelte';
	import LanguageSupportNotice from '#lib/components/settings/LanguageSupportNotice.svelte';
	import { closeVoiceLibrary, voiceLibrary, type VoiceRole } from '#lib/stores/voiceLibrary.js';
	import { NeoTab, NeoTabs } from '@dvcol/neo-svelte/nav';
	import AppHeader from '#lib/components/AppHeader.svelte';
	import { SwipeBetweenTabs, type TabStep } from '#lib/gestures/swipeBetweenTabs.js';
	import type { ProcessingTarget } from '#lib/stores/processing.js';

	type TabId = 'learning' | 'usage' | 'data';

	const TAB_IDS: readonly TabId[] = ['learning', 'usage', 'data'];

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
		<div class="h-full min-h-0 overflow-y-auto" bind:this={scroller}>
			<div class="mx-auto max-w-[760px] px-4 pt-6 pb-16 sm:px-8 sm:pt-8">
				<p class="mb-8 max-w-xl text-sm leading-relaxed text-muted-foreground">
					Choose Local or Cloud for speech-to-text, the LLM and text-to-speech. Keys stay in this
					browser and are never written to the synced database.
				</p>

				<div class="settings-tabs mb-8" bind:this={tabsRow}>
					<NeoTabs
						active={tab}
						onchange={(next) => selectTab(next === undefined ? undefined : String(next))}
						rounded
						slide
						aria-label="Settings sections"
					>
						<NeoTab tabId="learning" value="learning">Learning</NeoTab>
						<NeoTab tabId="usage" value="usage">Usage</NeoTab>
						<NeoTab tabId="data" value="data">Data</NeoTab>
					</NeoTabs>
				</div>

				<div class:hidden={tab !== 'learning'}>
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
								onchange={(value) => setSetting('instructionLanguage', value)}
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
									{ value: 'casual', label: 'Casual' }
								]}
								value={$appSettings.mode}
								onchange={(value) => setSetting('mode', value as 'exam' | 'casual')}
							/>
						</SettingRow>
					</SettingsSection>

					<ProcessingSection focus={focusTarget} {focusNonce} />

					<ZoomSettings />

					<TextSizeSettings />

					<ReminderSettings />

					<WhatOnspotDoes />
				</div>

				<div class:hidden={tab !== 'usage'}>
					<UsageMonitor visible={tab === 'usage'} />
				</div>

				<div class:hidden={tab !== 'data'}>
					<DataSettings />
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

	/* Two sections: neo tabs spanning the column, one sliding selection. */
	.settings-tabs :global(.neo-tabs),
	.settings-tabs :global(.neo-tabs .neo-tabs-group) {
		display: flex;
		width: 100%;
	}
	.settings-tabs :global(.neo-tabs .neo-tab) {
		flex: 1 1 0;
	}
	.settings-tabs :global(.neo-tabs .neo-tab .neo-tab-button) {
		width: 100%;
		justify-content: center;
		font-weight: 600;
	}
	.settings-tabs :global(.neo-tabs .neo-tab.neo-active .neo-tab-button) {
		color: var(--primary);
	}

	/* Shared by the section components (Svelte scoped styles cannot reach them). */
	:global(.neo-card.info-item) {
		--neo-card-margin: 1rem 0;
		--info-spacing: 16px 18px;
		border-radius: 14px;
	}
	@media (min-width: 640px) {
		:global(.neo-card.info-item) {
			--info-spacing: 18px 22px;
		}
	}
	:global(.info-body) {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 12px 16px;
	}
	:global(.info-content) {
		display: flex;
		flex: 1 1 14rem;
		min-width: 14rem;
		flex-direction: column;
		gap: 4px;
	}
	:global(.info-actions) {
		display: flex;
		gap: 8px;
	}
	:global(.info-footer) {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin-top: 12px;
	}

	:global(.neo-button.small-button) {
		font-size: 0.8125rem;
		padding-block: 0.3rem;
	}

	:global(.settings-link) {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		color: var(--brand);
		font-weight: 600;
		text-underline-offset: 3px;
		transition: color 100ms ease;
	}
	:global(.settings-link:hover) {
		color: var(--brand-hover);
		text-decoration: underline;
	}
</style>
