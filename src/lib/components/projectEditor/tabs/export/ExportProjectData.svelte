<script>
	import Exporter from '$lib/classes/Exporter';
	import { slide } from 'svelte/transition';
	import ExportFolderPicker from './ExportFolderPicker.svelte';
	import LL from '$lib/i18n/i18n-svelte';
</script>

<!-- Export Project Data Configuration -->
<div class="min-w-0 rounded-lg bg-secondary p-3" transition:slide>
	<!-- Section Title -->
	<div class="mb-4">
		<h3 class="mb-1 text-base font-semibold text-primary">{$LL.export.exportProjectData()}</h3>
		<p class="text-xs leading-snug text-thirdly">
			{$LL.export.exportProjectDataDescription()}
		</p>
	</div>

	<!-- Content Information -->
	<div class="mb-4">
		<h4 class="mb-2 text-sm font-medium text-secondary">{$LL.export.whatsIncluded()}</h4>
		<div class="rounded-lg border border-color bg-accent p-3">
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
	<div class="mb-4">
		<h4 class="mb-2 text-sm font-medium text-secondary">{$LL.export.limitations()}</h4>
		<div class="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3">
			<div class="flex items-start gap-3">
				<div class="text-amber-500 text-lg flex-shrink-0">⚠️</div>
				<div>
					<span class="text-amber-200 text-sm font-medium"
						>{$LL.export.mediaFilesNotIncluded()}</span
					>
					<p class="text-amber-100/80 text-xs mt-1">
						{$LL.export.mediaFilesNotIncludedDescription()}
					</p>
				</div>
			</div>
		</div>
	</div>

	<!-- Export Folder -->
	<div class="mb-4">
		<h4 class="mb-2 text-sm font-medium text-secondary">{$LL.export.exportFolder()}</h4>
		<div class="rounded-lg border border-color bg-accent p-3">
			<ExportFolderPicker />
		</div>
	</div>

	<!-- Export Button -->
	<div class="flex flex-col items-center">
		<button
			class="btn-accent h-11 w-full px-4 font-medium"
			onclick={() => Exporter.exportProjectData()}
		>
			{$LL.export.exportProjectDataButton()}
		</button>
		<p class="text-thirdly text-xs mt-2 text-center">
			{$LL.export.exportProjectDataButtonDescription()}
		</p>
		<button
			class="btn mt-3 min-h-10 w-full px-4 py-2 text-xs font-medium"
			onclick={() => Exporter.exportSubtitlesJson()}
		>
			{$LL.export.exportSubtitlesJsonButton()}
		</button>
		<p class="text-thirdly text-xs mt-2 text-center">
			{$LL.export.exportSubtitlesJsonButtonDescription()}
		</p>
	</div>
</div>
