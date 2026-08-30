<script lang="ts">
	import { VersionService } from '$lib/services/VersionService.svelte';
	import { onMount } from 'svelte';
	import TourManager from '$lib/components/tour/TourManager';
	import Settings from '$lib/classes/Settings.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import LL from '$lib/i18n/i18n-svelte';

	let version = $state('');
	onMount(async () => {
		version = await VersionService.getAppVersion();
	});
</script>

<div class="space-y-4">
	<h3 class="text-lg font-medium text-primary">{$LL.settings.about()}</h3>
	<p>{$LL.settings.aboutDescription()}</p>

	<p>{$LL.settings.versionLabel({ version })}</p>

	<div class="mt-2 flex flex-wrap gap-3">
		<button
			class="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium"
			style="background: var(--bg-accent); color: var(--text-secondary);"
			onclick={async () => {
				// Reset tutorial seen state in settings
				if (globalState.settings) {
					globalState.settings.persistentUiState.hasSeenTour = false;
					globalState.settings.persistentUiState.showFirstVideoGuide = true;
					await Settings.save();
				}
				// Close settings modal
				globalState.uiState.isSettingsOpen = false;
				// Go to homepage
				if (globalState.currentProject) {
					await globalState.currentProject?.save();
					globalState.currentProject = null;
				}
				// Small delay to let the settings modal animate out
				setTimeout(() => TourManager.start(true), 300);
			}}
		>
			<span class="material-icons text-base">school</span>
			{$LL.settings.restartTutorial()}
		</button>
	</div>
</div>
