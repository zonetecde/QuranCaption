<script>
	import DownloadFromQuranSourceSection from './DownloadFromQuranSourceSection.svelte';
	import DownloadFromYouTubeSection from './DownloadFromYouTubeSection.svelte';
	import ProjectAssetSection from './ProjectAssetSection.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { get } from 'svelte/store';
</script>

<div
	data-tour-id="assets-manager"
	class="bg-secondary h-full border border-color rounded-lg py-6 px-2 space-y-6 relative overflow-auto"
>
	<!-- En-tête avec icône -->
	<div class="flex gap-x-2 items-center justify-center mb-6">
		<span class="material-icons text-accent text-xl">movie</span>
		<h2 class="text-xl font-bold text-primary">{get(LL).editor.videoEditorLabel()}</h2>
	</div>

	<ProjectAssetSection />
	<DownloadFromQuranSourceSection />
	<DownloadFromYouTubeSection />
</div>
