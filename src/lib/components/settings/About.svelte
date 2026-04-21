<script lang="ts">
	import { VersionService } from '$lib/services/VersionService.svelte';
	import { openUrl } from '@tauri-apps/plugin-opener';
	import { onMount } from 'svelte';
	import TourManager from '$lib/components/tour/TourManager';
	import Settings from '$lib/classes/Settings.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import MigrationService from '$lib/services/MigrationService';
	import { setupTutorialProject } from '$lib/services/TutorialService';

	let version = $state('');
	let isOrganizingProjects = $state(false);
	onMount(async () => {
		version = await VersionService.getAppVersion();
	});
</script>

<div class="space-y-4">
	<h3 class="text-lg font-medium text-primary">About</h3>
	<p>
		Quran Caption is an open-source project for creating videos of Quran recitation. <br /><br />The
		software is completely free. I ask Allah to increase my provision (rizq) and to bless everyone
		who contributes to this project—whether through donations, feedback, or by using and sharing it.
		May Allah reward you all.
		<br /><br />
		This software was developed by Rayane STASZEWSKI with support from the
		<button
			class="text-blue-400 underline"
			onclick={() => openUrl('https://discord.gg/Hxfqq2QA2J')}
		>
			Quran Caption community
		</button>. Collaborations and sponsorships are welcome to help improve and maintain the project.
	</p>

	<p>Version {version}</p>

	<div class="mt-2 flex flex-wrap gap-3">
		<button
			class="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium"
			style="background: var(--bg-accent); color: var(--text-secondary);"
			onclick={async () => {
				// Reset tutorial seen state in settings
				if (globalState.settings) {
					globalState.settings.persistentUiState.hasSeenTour = false;
					await Settings.save();
				}
				// Close settings modal
				globalState.uiState.isSettingsOpen = false;
				// Go to homepage
				if (globalState.currentProject) {
					await globalState.currentProject?.save();
					globalState.currentProject = null;
				}
				// Re-import tutorial project (force = true deletes and recreates it)
				try {
					await setupTutorialProject(true);
				} catch (e) {
					console.warn('Tutorial reset failed:', e);
				}
				// Small delay to let the settings modal animate out
				setTimeout(() => TourManager.start(true), 300);
			}}
		>
			<span class="material-icons text-base">school</span>
			Restart Tutorial
		</button>

		<button
			class="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
			style="background: var(--bg-accent); color: var(--text-secondary);"
			disabled={isOrganizingProjects}
			onclick={async () => {
				if (isOrganizingProjects) return;
				isOrganizingProjects = true;
				try {
					await MigrationService.organizeExistingProjectsIntoSubCategories();
				} finally {
					isOrganizingProjects = false;
				}
			}}
		>
			<span class="material-icons text-base">auto_awesome</span>
			{isOrganizingProjects ? 'Organizing Projects...' : 'Organize Project Folders'}
		</button>
	</div>
</div>
