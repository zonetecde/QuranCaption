<script>
	import Exporter from '$lib/classes/Exporter';
	import { slide } from 'svelte/transition';
	import ExportFolderPicker from './ExportFolderPicker.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { get } from 'svelte/store';

	const LL_ = get(LL);
</script>

<!-- Export Project Data Configuration -->
<div class="p-6 bg-secondary rounded-lg border border-color" transition:slide>
	<!-- Section Title -->
	<div class="mb-6">
		<h3 class="text-lg font-semibold text-primary mb-2">{$LL.export.exportProjectData()}</h3>
		<p class="text-thirdly text-sm">
			{$LL.export.exportProjectDataDescription()}
		</p>
	</div>

	<!-- Content Information -->
	<div class="mb-6">
		<h4 class="text-base font-medium text-secondary mb-3">{$LL.export.whatsIncluded()}</h4>
		<div class="bg-accent rounded-lg p-4 border border-color">
			<div class="space-y-3">
				<div class="flex items-start gap-3">
					<div class="w-2 h-2 bg-accent-primary rounded-full mt-2 flex-shrink-0"></div>
					<div>
						<span class="text-secondary text-sm font-medium">{$LL.export.projectSettings()}</span>
						<p class="text-thirdly text-xs mt-1">
							{$LL.export.projectSettingsDescription()}
						</p>
					</div>
				</div>
				<div class="flex items-start gap-3">
					<div class="w-2 h-2 bg-accent-primary rounded-full mt-2 flex-shrink-0"></div>
					<div>
						<span class="text-secondary text-sm font-medium">{$LL.export.subtitleData()}</span>
						<p class="text-thirdly text-xs mt-1">
							{$LL.export.subtitleDataDescription()}
						</p>
					</div>
				</div>
				<div class="flex items-start gap-3">
					<div class="w-2 h-2 bg-accent-primary rounded-full mt-2 flex-shrink-0"></div>
					<div>
						<span class="text-secondary text-sm font-medium">{$LL.export.customElements()}</span>
						<p class="text-thirdly text-xs mt-1">
							{$LL.export.customElementsDescription()}
						</p>
					</div>
				</div>
			</div>
		</div>
	</div>

	<!-- Limitations Warning -->
	<div class="mb-6">
		<h4 class="text-base font-medium text-secondary mb-3">{$LL.export.limitations()}</h4>
		<div class="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
			<div class="flex items-start gap-3">
				<div class="text-amber-500 text-lg flex-shrink-0">⚠️</div>
				<div>
					<span class="text-amber-200 text-sm font-medium">{$LL.export.mediaFilesNotIncluded()}</span>
					<p class="text-amber-100/80 text-xs mt-1">
						{$LL.export.mediaFilesNotIncludedDescription()}
					</p>
				</div>
			</div>
		</div>
	</div>

	<!-- Export Folder -->
	<div class="mb-6">
		<h4 class="text-base font-medium text-secondary mb-3">{$LL.export.exportFolder()}</h4>
		<div class="bg-accent rounded-lg p-4 border border-color">
			<ExportFolderPicker />
		</div>
	</div>

	<!-- Export Button -->
	<div class="flex flex-col items-center">
		<button class="btn-accent px-6 py-3 font-medium" onclick={() => Exporter.exportProjectData()}>
			{$LL.export.exportProjectDataButton()}
		</button>
		<p class="text-thirdly text-xs mt-2 text-center">
			{$LL.export.exportProjectDataButtonDescription()}
		</p>
		<button class="btn px-4 py-2 mt-4 text-xs font-medium" onclick={() => Exporter.exportSubtitlesJson()}>
			{$LL.export.exportSubtitlesJsonButton()}
		</button>
		<p class="text-thirdly text-xs mt-2 text-center">
			{$LL.export.exportSubtitlesJsonButtonDescription()}
		</p>
	</div>
</div>
