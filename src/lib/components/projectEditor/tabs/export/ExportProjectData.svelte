<script>
	import Exporter from '$lib/classes/Exporter';
	import { slide } from 'svelte/transition';
	import ExportFolderPicker from './ExportFolderPicker.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { get } from 'svelte/store';

	const LL_ = get(LL);
	let includeProjectAssets = false;
</script>

<!-- Export Project Data Configuration -->
<div
	class="flex h-full min-h-0 flex-col rounded-lg border border-color bg-secondary p-6 pb-2"
	transition:slide
>
	<div class="min-h-0 flex-1 overflow-y-auto -mx-6 px-6">
		<!-- Section Title -->
		<div class="mb-6">
			<h3 class="text-lg font-semibold text-primary mb-2">
				{includeProjectAssets ? $LL.export.exportProjectPackage() : $LL.export.exportProjectData()}
			</h3>
			<p class="text-thirdly text-sm">
				{includeProjectAssets
					? $LL.export.exportProjectPackageDescription()
					: $LL.export.exportProjectDataDescription()}
			</p>
		</div>

		<!-- Project Assets Option -->
		<label
			class="mb-6 flex cursor-pointer items-start gap-3 rounded-lg border border-color bg-accent p-4"
		>
			<input
				type="checkbox"
				bind:checked={includeProjectAssets}
				class="mt-1 h-4 w-4 shrink-0 accent-accent-primary"
			/>
			<div>
				<span class="text-secondary text-sm font-medium">{$LL.export.includeProjectAssets()}</span>
				<p class="text-thirdly mt-1 text-xs">
					{$LL.export.includeProjectAssetsDescription()}
				</p>
			</div>
		</label>

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
					{#if includeProjectAssets}
						<div class="flex items-start gap-3">
							<div class="w-2 h-2 bg-accent-primary rounded-full mt-2 flex-shrink-0"></div>
							<div>
								<span class="text-secondary text-sm font-medium">{$LL.export.projectAssets()}</span>
								<p class="text-thirdly mt-1 text-xs">
									{$LL.export.projectAssetsDescription()}
								</p>
							</div>
						</div>
					{/if}
				</div>
			</div>
		</div>

		<!-- Assets Status -->
		<div class="mb-6">
			{#if includeProjectAssets}
				<h4 class="text-base font-medium text-secondary mb-3">{$LL.export.projectAssets()}</h4>
				<div class="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-4">
					<div class="flex items-start gap-3">
						<div class="flex-shrink-0 text-lg text-emerald-500">✓</div>
						<div>
							<span class="text-sm font-medium text-emerald-200"
								>{$LL.export.projectAssetsIncluded()}</span
							>
							<p class="mt-1 text-xs text-emerald-100/80">
								{$LL.export.projectAssetsIncludedDescription()}
							</p>
						</div>
					</div>
				</div>
			{:else}
				<h4 class="text-base font-medium text-secondary mb-3">{$LL.export.limitations()}</h4>
				<div class="rounded-lg border border-amber-500/20 bg-amber-500/10 p-4">
					<div class="flex items-start gap-3">
						<div class="flex-shrink-0 text-lg text-amber-500">⚠️</div>
						<div>
							<span class="text-sm font-medium text-amber-200"
								>{$LL.export.mediaFilesNotIncluded()}</span
							>
							<p class="mt-1 text-xs text-amber-100/80">
								{$LL.export.mediaFilesNotIncludedDescription()}
							</p>
						</div>
					</div>
				</div>
			{/if}
		</div>

		<!-- Export Folder -->
		<div class="mb-6">
			<h4 class="text-base font-medium text-secondary mb-3">{$LL.export.exportFolder()}</h4>
			<div class="bg-accent rounded-lg p-4 border border-color">
				<ExportFolderPicker />
			</div>
		</div>
	</div>

	<!-- Export Button -->
	<div class="flex flex-shrink-0 flex-col items-center border-t border-color pt-2">
		<button
			class="btn-accent px-6 py-3 font-medium"
			onclick={() =>
				includeProjectAssets ? Exporter.exportProjectPackage() : Exporter.exportProjectData()}
		>
			{includeProjectAssets
				? $LL.export.exportProjectPackage()
				: $LL.export.exportProjectDataButton()}
		</button>
		<p class="text-thirdly text-xs mt-2 text-center">
			{includeProjectAssets
				? $LL.export.exportProjectPackageButtonDescription()
				: $LL.export.exportProjectDataButtonDescription()}
		</p>
		<button
			class="btn px-4 py-2 mt-4 text-xs font-medium"
			onclick={() => Exporter.exportSubtitlesJson()}
		>
			{$LL.export.exportSubtitlesJsonButton()}
		</button>
		<p class="text-thirdly text-xs mt-2 text-center">
			{$LL.export.exportSubtitlesJsonButtonDescription()}
		</p>
	</div>
</div>
