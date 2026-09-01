<script lang="ts">
	import Exporter from '$lib/classes/Exporter';
	import { slide } from 'svelte/transition';
	import ExportFolderPicker from './ExportFolderPicker.svelte';
	import LL from '$lib/i18n/i18n-svelte';

	let includeProjectAssets = false;
</script>

<!-- Export Project Data Configuration -->

<div class="flex h-full min-h-0 min-w-0 flex-col rounded-lg bg-secondary p-3 pb-0" transition:slide>
	<div class="min-h-0 flex-1 overflow-y-auto">
		<!-- Section Title -->
		<div class="mb-4">
			<h3 class="mb-1 text-base font-semibold text-primary">
				{includeProjectAssets ? $LL.export.exportProjectPackage() : $LL.export.exportProjectData()}
			</h3>
			<p class="text-xs leading-snug text-thirdly">
				{includeProjectAssets
					? $LL.export.exportProjectPackageDescription()
					: $LL.export.exportProjectDataDescription()}
			</p>
		</div>

		<label
			class="mb-4 flex cursor-pointer items-start gap-3 rounded-lg border border-color bg-accent p-3"
		>
			<input
				type="checkbox"
				bind:checked={includeProjectAssets}
				class="mt-1 h-4 w-4 shrink-0 accent-accent-primary"
			/>
			<div>
				<span class="text-sm font-medium text-secondary">{$LL.export.includeProjectAssets()}</span>
				<p class="mt-1 text-xs text-thirdly">{$LL.export.includeProjectAssetsDescription()}</p>
			</div>
		</label>

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
					{#if includeProjectAssets}
						<div class="flex items-start gap-3">
							<div class="w-2 h-2 bg-accent-primary rounded-full mt-2 flex-shrink-0"></div>
							<div>
								<span class="text-secondary text-sm font-medium">{$LL.export.projectAssets()}</span>
								<p class="text-thirdly text-xs mt-1">
									{$LL.export.projectAssetsDescription()}
								</p>
							</div>
						</div>
					{/if}
				</div>
			</div>
		</div>

		<div class="mb-4">
			{#if includeProjectAssets}
				<h4 class="mb-2 text-sm font-medium text-secondary">{$LL.export.projectAssets()}</h4>
				<div class="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3">
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
			{/if}
		</div>

		<!-- Export Folder -->
		<div class="mb-4">
			<h4 class="mb-2 text-sm font-medium text-secondary">{$LL.export.exportFolder()}</h4>
			<div class="rounded-lg border border-color bg-accent p-3">
				<ExportFolderPicker />
			</div>
		</div>
	</div>

	<!-- Export Button -->
	<div class="flex flex-shrink-0 flex-col items-center border-t border-color pt-1">
		<button
			class="btn-accent h-10 w-full px-4 font-medium"
			onclick={() =>
				includeProjectAssets ? Exporter.exportProjectPackage() : Exporter.exportProjectData()}
		>
			{includeProjectAssets
				? $LL.export.exportProjectPackage()
				: $LL.export.exportProjectDataButton()}
		</button>
		<button
			class="btn mt-2 min-h-10 w-full px-4 py-2 text-xs font-medium"
			onclick={() => Exporter.exportSubtitlesJson()}
		>
			{$LL.export.exportSubtitlesJsonButton()}
		</button>
	</div>
</div>
