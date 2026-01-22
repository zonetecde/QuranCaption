<script lang="ts">
	import { onMount } from 'svelte';
	import { getCurrentWindow } from '@tauri-apps/api/window';
	import VideoPreview from './videoPreview/VideoPreview.svelte';
	import Timeline from './timeline/Timeline.svelte';
	import Navigator from './Navigator.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { ProjectEditorTabs } from '$lib/classes';
	import toast from 'svelte-5-french-toast';
	
	// Specific Tab Components
	import AssetsManager from './tabs/videoEditor/assetsManager/AssetsManager.svelte';
	import SubtitlesEditorSettings from './tabs/subtitlesEditor/SubtitlesEditorSettings.svelte';
	import SubtitlesWorkspace from './tabs/subtitlesEditor/SubtitlesWorkspace.svelte';
	import SubtitlesList from './tabs/subtitlesEditor/SubtitlesList.svelte';
	import StyleEditorSettings from './tabs/styleEditor/StyleEditorSettings.svelte';
	import ExportSettings from './tabs/export/ExportSettings.svelte';
	import TranslationsEditor from './tabs/translationsEditor/TranslationsEditor.svelte';
	
	import DiviseurRedimensionnable from './tabs/DiviseurRedimensionnable.svelte';

	let saveInterval: any;

	onMount(() => {
		// Sauvegarde automatique du projet toutes les 5 secondes
		saveInterval = setInterval(() => {
			globalState.currentProject?.save();
		}, 5000);

		// Fermer les menus contextuels lors d'un clic en dehors
		const handleGlobalClick = (e: MouseEvent) => {
			const portal = document.getElementById('context-menu-portal');
			if (portal && portal.contains(e.target as Node)) {
				return;
			}
			globalState.closeAllMenus();
		};
		window.addEventListener('mousedown', handleGlobalClick, true);

		return () => {
			clearInterval(saveInterval);
			window.removeEventListener('mousedown', handleGlobalClick, true);
		};
	});
</script>

<div class="flex flex-col h-full bg-secondary min-h-0 overflow-hidden">
	<Navigator />

	<!-- Translations Editor (Rendered but hidden when not active to preserve state) -->
	<div 
		class="h-full min-h-0" 
		class:hidden={globalState.currentProject!.projectEditorState.currentTab !== ProjectEditorTabs.Translations}
	>
		<TranslationsEditor />
	</div>

	<!-- Shared Layout for Video, Subtitles, Style, Export (Timeline Shared) -->
	<div 
		class="flex-grow w-full max-w-full flex overflow-hidden h-full min-h-0"
		class:hidden={globalState.currentProject!.projectEditorState.currentTab === ProjectEditorTabs.Translations}
	>
		<!-- Left Panel -->
		<section
			class="flex-shrink-0 divide-y-2 divide-color max-h-full overflow-hidden flex flex-col transition-all duration-200"
			class:w-[300px]={globalState.currentProject!.projectEditorState.currentTab === ProjectEditorTabs.VideoEditor || globalState.currentProject!.projectEditorState.currentTab === ProjectEditorTabs.Style}
			class:w-[225px]={globalState.currentProject!.projectEditorState.currentTab === ProjectEditorTabs.SubtitlesEditor}
			class:2xl:w-[300px]={globalState.currentProject!.projectEditorState.currentTab === ProjectEditorTabs.SubtitlesEditor}
			class:2xl:w-[350px]={globalState.currentProject!.projectEditorState.currentTab === ProjectEditorTabs.Style}
			class:w-[350px]={globalState.currentProject!.projectEditorState.currentTab === ProjectEditorTabs.Export}
			class:2xl:w-[450px]={globalState.currentProject!.projectEditorState.currentTab === ProjectEditorTabs.Export}
		>
			<!-- Helper class for Style tab width since we can't have duplicate keys cleanly in class directive with conflict -->
			<!-- Actually, Tailwind classes just append. We need to ensure we don't have conflicting width classes applied simultaneously.
				 Logic:
				 Video: w-[300px]
				 Subtitles: w-[225px] 2xl:w-[300px]
				 Style: w-[300px] 2xl:w-[350px]
				 Export: w-[350px] 2xl:w-[450px]
			-->
			
			{#if globalState.currentProject!.projectEditorState.currentTab === ProjectEditorTabs.VideoEditor}
				<AssetsManager />
			{:else if globalState.currentProject!.projectEditorState.currentTab === ProjectEditorTabs.SubtitlesEditor}
				<SubtitlesEditorSettings />
			{:else if globalState.currentProject!.projectEditorState.currentTab === ProjectEditorTabs.Style}
				<StyleEditorSettings />
			{:else if globalState.currentProject!.projectEditorState.currentTab === ProjectEditorTabs.Export}
				<ExportSettings />
			{/if}
		</section>

		<!-- Center Panel -->
		<section class="flex-1 min-w-0 flex flex-row max-h-full min-h-0">
			<section class="w-full min-w-0 flex flex-col min-h-0">
				<!-- Upper Workspace (Video Preview or Subtitles Workspace) -->
				<!-- Note: Depending on tab, we show VideoPreview HERE or in Right Panel.
					 Use display:none to keep instances if necessary, but SubtitlesWorkspace is distinct from VideoPreview.
					 Ideally we want ONE VideoPreview instance.
					 But Subtitles tab puts VideoPreview in the Right sidebar.
					 Moving a DOM element (VideoPreview) between parents without remount involves complexity (reparenting script).
					 For now, we utilize the conditional rendering. Switching to Subtitles WILL remount VIDEO PREVIEW.
					 BUT Timeline stays. This is the main gain.
				-->
				{#if globalState.currentProject!.projectEditorState.currentTab === ProjectEditorTabs.SubtitlesEditor}
					<SubtitlesWorkspace />
				{:else}
					<VideoPreview showControls={true} />
				{/if}

				<DiviseurRedimensionnable />

				<!-- Shared Timeline (Persists across these tabs) -->
				<Timeline />
			</section>
		</section>

		<!-- Right Panel (Only for Subtitles) -->
		{#if globalState.currentProject!.projectEditorState.currentTab === ProjectEditorTabs.SubtitlesEditor}
			<section
				class="w-[200px] 2xl:w-[300px] flex-shrink-0 divide-y-2 divide-color max-h-full overflow-hidden flex flex-col border border-color rounded-lg border-l-0 relative"
			>
				<VideoPreview showControls={false} />

				<!-- Play/Pause Overlay for Subtitles Tab -->
				<button
					class="flex items-center justify-center w-8 h-8 text-[var(--text-on-hover)] bg-accent/20 hover:bg-accent rounded-full transition-colors cursor-pointer duration-200 absolute top-2 right-2 z-20 border-2 border-color"
					onclick={() => {
						globalState.getVideoPreviewState.togglePlayPause();
					}}
				>
					<span class="material-icons text-xl pt-0.25">
						{globalState.getVideoPreviewState.isPlaying ? 'pause' : 'play_arrow'}
					</span>
				</button>

				<div class="flex-1 min-h-0 overflow-hidden z-15">
					<SubtitlesList />
				</div>
			</section>
		{/if}
	</div>
</div>
