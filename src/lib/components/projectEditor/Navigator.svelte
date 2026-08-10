<script lang="ts">
	import { ProjectEditorTabs } from '$lib/classes';
	import { globalState } from '$lib/runes/main.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { get } from 'svelte/store';
	import { onMount } from 'svelte';
	import { AnalyticsService } from '$lib/services/AnalyticsService';

	const ANALYTICS_SECTION_NAMES: Record<ProjectEditorTabs, string> = {
		[ProjectEditorTabs.VideoEditor]: 'video',
		[ProjectEditorTabs.SubtitlesEditor]: 'subtitles',
		[ProjectEditorTabs.Translations]: 'translations',
		[ProjectEditorTabs.Style]: 'style',
		[ProjectEditorTabs.Export]: 'export'
	};

	let activeAnalyticsSection = globalState.currentProject!.projectEditorState.currentTab;
	let analyticsSectionActiveStartedAt: number | null = null;
	let analyticsSectionDurationMs = 0;

	let tabs = $state([
		{ name: get(LL).status.videoEditor(), icon: 'edit', value: ProjectEditorTabs.VideoEditor },
		{
			name: get(LL).status.subtitlesEditor(),
			icon: 'subtitles',
			value: ProjectEditorTabs.SubtitlesEditor
		},
		{
			name: get(LL).status.translations(),
			icon: 'translate',
			value: ProjectEditorTabs.Translations
		},
		{ name: get(LL).status.style(), icon: 'auto_fix_high', value: ProjectEditorTabs.Style },
		{ name: get(LL).status.export(), icon: 'upload_file', value: ProjectEditorTabs.Export }
	]);

	$effect(() => {
		const currentSection = globalState.currentProject!.projectEditorState.currentTab;
		if (currentSection === activeAnalyticsSection) return;
		trackActiveSection();
		activeAnalyticsSection = currentSection;
		resumeActiveSection();
	});

	function setActiveTab(tabValue: ProjectEditorTabs) {
		globalState.getStylesState.clearSelection();
		if (globalState.shared.quickTimelineEditor.active) {
			globalState.closeQuickTimelineEditor();
		}
		globalState.currentProject!.projectEditorState.currentTab = tabValue;
	}

	/**
	 * Suspend le chronometre de la section active.
	 * @returns {void}
	 */
	function pauseActiveSection(): void {
		if (analyticsSectionActiveStartedAt === null) return;
		analyticsSectionDurationMs += Date.now() - analyticsSectionActiveStartedAt;
		analyticsSectionActiveStartedAt = null;
	}

	/**
	 * Reprend le chronometre lorsque l'application est visible.
	 * @returns {void}
	 */
	function resumeActiveSection(): void {
		if (document.hidden || analyticsSectionActiveStartedAt !== null) return;
		analyticsSectionActiveStartedAt = Date.now();
	}

	/**
	 * Emet la duree active de consultation de la section courante.
	 * @returns {void}
	 */
	function trackActiveSection(): void {
		pauseActiveSection();
		AnalyticsService.trackEditorSectionViewed(
			ANALYTICS_SECTION_NAMES[activeAnalyticsSection],
			analyticsSectionDurationMs
		);
		analyticsSectionDurationMs = 0;
	}

	/**
	 * Synchronise le chronometre avec la visibilite de l'application.
	 * @returns {void}
	 */
	function handleVisibilityChange(): void {
		if (document.hidden) pauseActiveSection();
		else resumeActiveSection();
	}

	onMount(() => {
		resumeActiveSection();
		document.addEventListener('visibilitychange', handleVisibilityChange);
		return () => {
			document.removeEventListener('visibilitychange', handleVisibilityChange);
			trackActiveSection();
		};
	});
</script>

<div class="w-full h-11 flex items-center justify-center space-x-1 border-color flex-shrink-0">
	{#each tabs as tab (tab.value)}
		<button
			class="tab-button ring-0 outline-none flex items-center {globalState.currentProject!
				.projectEditorState.currentTab === tab.value
				? 'active'
				: ''}"
			type="button"
			onclick={() => setActiveTab(tab.value)}
			data-tour-id={tab.value === ProjectEditorTabs.SubtitlesEditor
				? 'nav-tab-subtitles'
				: tab.value === ProjectEditorTabs.Translations
					? 'nav-tab-translations'
					: tab.value === ProjectEditorTabs.Style
						? 'nav-tab-style'
						: tab.value === ProjectEditorTabs.Export
							? 'nav-tab-export'
							: undefined}
		>
			<span class="material-icons mr-2">{tab.icon}</span>{tab.name}
		</button>
	{/each}
</div>

<style>
	.tab-button {
		padding: 0.45rem 1rem;
		border-bottom: 2px solid transparent;
		font-size: 0.775rem;
		font-weight: 500;
		color: var(--text-thirdly);
		transition: colors 200ms ease-in-out;
		background: transparent;
		border-left: none;
		border-right: none;
		border-top: none;
		cursor: pointer;
	}
	.tab-button:hover:not(.active) {
		background-color: var(--bg-accent);
		color: var(--text-secondary);
	}
	.tab-button.active {
		border-bottom-color: var(--accent-primary);
		color: var(--accent-primary);
	}
</style>
