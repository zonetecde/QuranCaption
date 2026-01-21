<script>
	import Exporter from '$lib/classes/Exporter';
	import { slide } from 'svelte/transition';
	import ExportFolderPicker from './ExportFolderPicker.svelte';
</script>

<!-- Export Project Data Configuration -->
<div class="p-6 bg-secondary rounded-lg border border-color" transition:slide>
	<!-- Section Title -->
	<div class="mb-6">
		<h3 class="text-lg font-semibold text-primary mb-2">Export Project Data</h3>
		<p class="text-thirdly text-sm">
			Export your complete project as a JSON file for backup or sharing purposes.
		</p>
	</div>

	<!-- Content Information -->
	<div class="mb-6">
		<h4 class="text-base font-medium text-secondary mb-3">What's Included</h4>
		<div class="bg-accent rounded-lg p-4 border border-color">
			<div class="space-y-3">
				<div class="flex items-start gap-3">
					<div class="w-2 h-2 bg-accent-primary rounded-full mt-2 flex-shrink-0"></div>
					<div>
						<span class="text-secondary text-sm font-medium">Project Settings</span>
						<p class="text-thirdly text-xs mt-1">
							All your project configuration, timeline settings, and style preferences
						</p>
					</div>
				</div>
				<div class="flex items-start gap-3">
					<div class="w-2 h-2 bg-accent-primary rounded-full mt-2 flex-shrink-0"></div>
					<div>
						<span class="text-secondary text-sm font-medium">Subtitle Data</span>
						<p class="text-thirdly text-xs mt-1">
							All subtitle clips, translations, and timing information
						</p>
					</div>
				</div>
				<div class="flex items-start gap-3">
					<div class="w-2 h-2 bg-accent-primary rounded-full mt-2 flex-shrink-0"></div>
					<div>
						<span class="text-secondary text-sm font-medium">Custom Elements</span>
						<p class="text-thirdly text-xs mt-1">
							Custom text clips, styling overrides, and visual elements
						</p>
					</div>
				</div>
			</div>
		</div>
	</div>

	<!-- Limitations Warning -->
	<div class="mb-6">
		<h4 class="text-base font-medium text-secondary mb-3">Limitations</h4>
		<div class="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
			<div class="flex items-start gap-3">
				<div class="text-amber-500 text-lg flex-shrink-0">⚠️</div>
				<div>
					<span class="text-amber-200 text-sm font-medium">Media Files Not Included</span>
					<p class="text-amber-100/80 text-xs mt-1">
						Non-YouTube videos, audio files, and any cropped or trimmed YouTube videos will not be
						included in the export. Only project metadata and subtitle data will be saved.
					</p>
				</div>
			</div>
		</div>
	</div>

	<!-- Export Folder -->
	<div class="mb-6">
		<h4 class="text-base font-medium text-secondary mb-3">Export Folder</h4>
		<div class="bg-accent rounded-lg p-4 border border-color">
			<ExportFolderPicker />
		</div>
	</div>

	<!-- Export Button -->
	<div class="flex flex-col items-center">
		<button class="btn-accent px-6 py-3 font-medium" onclick={Exporter.exportProjectData}>
			Export Project Data
		</button>
		<p class="text-thirdly text-xs mt-2 text-center">
			Generate a JSON file containing your entire project configuration
		</p>
	</div>
</div>
