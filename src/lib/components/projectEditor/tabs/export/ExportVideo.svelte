<script lang="ts">
	import Exporter from '$lib/classes/Exporter';
	import Settings from '$lib/classes/Settings.svelte';
	import type { FadeValue } from '$lib/components/projectEditor/tabs/subtitlesEditor/modal/autoSegmentation/types';
	import { globalState } from '$lib/runes/main.svelte';
	import { slide } from 'svelte/transition';
	import TimeInput from './TimeInput.svelte';
	import Style from '../styleEditor/Style.svelte';
	import { VerseRange } from '$lib/classes';
	import ExportFolderPicker from './ExportFolderPicker.svelte';
	import LL from '$lib/i18n/i18n-svelte';

	type PerformanceProfile = 'fastest' | 'balanced' | 'low_cpu';

	const performanceProfileIds: PerformanceProfile[] = ['fastest', 'balanced', 'low_cpu'];

	let showAdvancedSettings = $state(false);

	// Initialize export state values if not set
	$effect(() => {
		if (!globalState.getExportState.videoStartTime) {
			globalState.getExportState.videoStartTime = 0;
		}
		if (!globalState.getExportState.videoEndTime) {
			globalState.getExportState.videoEndTime = globalState.getAudioTrack.getDuration().ms || 0;
		}
	});

	// Helper function to format duration for display
	function formatDuration(ms: number): string {
		const totalSeconds = Math.floor(ms / 1000);
		const hours = Math.floor(totalSeconds / 3600);
		const minutes = Math.floor((totalSeconds % 3600) / 60);
		const seconds = totalSeconds % 60;

		if (hours > 0) {
			return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
		} else {
			return `${minutes}:${seconds.toString().padStart(2, '0')}`;
		}
	}

	function persistGlobalBatchSize(): void {
		void Settings.save();
	}
</script>

<!-- Export Video Configuration -->
<div class="p-6 bg-secondary rounded-lg border border-color" transition:slide>
	<!-- Section Title -->
	<div class="mb-6">
		<h3 class="text-lg font-semibold text-primary mb-2">{$LL.export.exportVideo()}</h3>
		<p class="text-thirdly text-sm">
			{$LL.export.configureExportSettings()}
		</p>
	</div>

	<!-- Time Range Selection -->
	<div data-tour-id="export-range" class="mb-6">
		<h4 class="text-base font-medium text-secondary mb-3">{$LL.export.exportRange()}</h4>
		<p class="text-thirdly text-sm mb-4">{$LL.export.selectTimeRange()}</p>

		<div class="bg-accent rounded-lg p-4 border border-color">
			<div class="grid grid-cols-1 grid-rows-2 gap-4">
				<!-- Start Time -->
				<TimeInput label={$LL.export.startTime()} bind:value={globalState.getExportState.videoStartTime} />

				<!-- End Time -->
				<TimeInput label={$LL.export.endTime()} bind:value={globalState.getExportState.videoEndTime} />
			</div>

			<!-- Duration Preview -->
			<div class="mt-4 p-3 bg-secondary rounded-lg border border-color">
				<div class="flex items-center justify-between text-sm">
					<span class="text-secondary">{$LL.export.exportDuration()}</span>
					<span class="text-accent-primary font-medium">
						{formatDuration(
							Math.max(
								0,
								(globalState.getExportState.videoEndTime || 0) -
									(globalState.getExportState.videoStartTime || 0)
							)
						)}
					</span>
				</div>
			</div>

			<!-- Verse Range Preview -->
			<div class="mt-4 p-3 bg-secondary rounded-lg border border-color">
				<div class="flex items-center justify-between text-sm">
					<span class="text-secondary min-w-[150px]">{$LL.export.exportVerseRange()}</span>
					<span class="text-accent-primary font-medium">
						{VerseRange.getExportVerseRange().toString()}
					</span>
				</div>
			</div>
		</div>
	</div>

	<div class="mb-6">
		<h4 class="text-base font-medium text-secondary mb-3">{$LL.export.videoQualityOrientation()}</h4>
		<div class="bg-accent rounded-lg p-4 border border-color">
			<p class="text-thirdly text-sm mb-4">
				{$LL.export.setResolutionOrientation()}
			</p>

			<Style
				style={globalState.getStyle('global', 'video-dimension')!}
				target="global"
				applyValueSimple={(v) => {
					globalState.getStyle('global', 'video-dimension')!.value = v as {
						width: number;
						height: number;
					};
				}}
				disabled={false}
			/>
		</div>
	</div>

	<div class="mb-6">
		<h4 class="text-base font-medium text-secondary mb-3">{$LL.export.videoAudioFade()}</h4>
		<div class="bg-accent rounded-lg p-4 border border-color">
			<p class="text-thirdly text-sm mb-4">
				{$LL.export.enableDisableFade()}
			</p>

			<Style
				style={globalState.getStyle('global', 'video-and-audio-fade')!}
				target="global"
				applyValueSimple={(v) => {
					globalState.getStyle('global', 'video-and-audio-fade')!.value = v as FadeValue;
				}}
				disabled={false}
			/>
		</div>
	</div>
	<div class="mb-6">
		<h4 class="text-base font-medium text-secondary mb-3">{$LL.export.performanceSettings()}</h4>
		<div class="bg-accent rounded-lg p-4 border border-color">
			<div class="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
				<p class="text-thirdly text-sm leading-snug">
					{$LL.export.setFpsDescription()}
				</p>
				<p class="text-thirdly text-sm leading-snug">
					{$LL.export.batchSizeDescription()}
				</p>
				<input
					type="number"
					min="5"
					max="60"
					step="1"
					class="input w-full h-10"
					bind:value={globalState.getExportState.fps}
				/>
				<div class="flex flex-col gap-2">
					<div class="grid grid-cols-2 gap-1 rounded-lg border border-color bg-secondary p-1">
						<button
							type="button"
							class="rounded-md px-1 py-1.5 text-sm font-semibold transition-colors {globalState
								.settings!.exportSettings.batchSizeMode === 'auto'
								? 'bg-accent-primary text-[var(--text-on-accent)]'
								: 'text-secondary hover:bg-accent hover:text-primary'}"
							onclick={() => {
								globalState.settings!.exportSettings.batchSizeMode = 'auto';
								persistGlobalBatchSize();
							}}
						>
							{$LL.common.auto()}
						</button>
						<button
							type="button"
							class="rounded-md px-1 py-1.5 text-sm font-semibold transition-colors {globalState
								.settings!.exportSettings.batchSizeMode === 'fixed'
								? 'bg-accent-primary text-[var(--text-on-accent)]'
								: 'text-secondary hover:bg-accent hover:text-primary'}"
							onclick={() => {
								globalState.settings!.exportSettings.batchSizeMode = 'fixed';
								persistGlobalBatchSize();
							}}
						>
							{$LL.common.fixed()}
						</button>
					</div>
					{#if globalState.settings!.exportSettings.batchSizeMode === 'fixed'}
						<input
							type="number"
							min="2"
							max="128"
							step="1"
							class="input w-full h-10"
							bind:value={globalState.settings!.exportSettings.batchSize}
							onchange={persistGlobalBatchSize}
						/>
					{/if}
				</div>
			</div>
		</div>
	</div>

	<!-- Video Filename & Export Location -->
	<div class="mb-6">
		<h4 class="text-base font-medium text-secondary mb-3">{$LL.export.videoFileName()}</h4>
		<div class="bg-accent rounded-lg p-4 border border-color">
			<div class="flex flex-col gap-6">
				<div>
					<p class="text-thirdly text-sm mb-4">
						{$LL.export.enterFileName()}
					</p>

					<div class="flex flex-col gap-2">
						<input
							type="text"
							class="input w-full"
							placeholder={globalState.currentProject?.detail.generateExportFileName()}
							bind:value={globalState.getExportState.customFileName}
						/>
						<p class="text-thirdly text-xs italic">
							{$LL.export.extensionAddedAutomatically()}
						</p>
					</div>
				</div>

				<div class="border-t border-color pt-4">
					<ExportFolderPicker description={$LL.export.chooseExportLocation()} />
				</div>
			</div>
		</div>
	</div>

	<!-- Export Button -->
	<div class="flex flex-col items-center">
		<button class="btn-accent px-6 py-3 font-medium" onclick={Exporter.exportVideo}>
			{$LL.export.exportButton()}
		</button>
		<p class="text-thirdly text-xs mt-2 text-center">
			{$LL.export.startExportDescription()}
		</p>
	</div>

	<div class="mt-5">
		<button
			type="button"
			class="w-full flex items-center justify-between rounded-lg border border-color bg-accent px-4 py-3 text-left transition-colors hover:bg-primary/60"
			onclick={() => {
				showAdvancedSettings = !showAdvancedSettings;
			}}
			aria-expanded={showAdvancedSettings}
		>
			<div>
				<p class="text-sm font-medium text-primary">{$LL.export.advancedSettings()}</p>
				<p class="text-xs text-thirdly">
					{$LL.export.controlExportPerformance()}
				</p>
			</div>
			<span
				class="material-icons text-secondary transition-transform duration-200"
				style={`transform: rotate(${showAdvancedSettings ? 180 : 0}deg);`}
			>
				expand_more
			</span>
		</button>

		{#if showAdvancedSettings}
			<div class="mt-3 rounded-lg border border-color bg-accent p-4" transition:slide>
				<div class="mb-4">
					<h4 class="text-base font-medium text-secondary mb-1">{$LL.export.background()}</h4>
					<label class="mt-2 flex items-start gap-3 cursor-pointer select-none">
						<input
							type="checkbox"
							class="mt-0.5 h-4 w-4 rounded border border-color bg-secondary accent-[var(--accent-primary)]"
							bind:checked={globalState.getExportState.exportWithoutBackground}
						/>
						<span class="text-sm text-primary">
							{$LL.export.exportWithoutBackground()}
							<span class="block text-xs text-thirdly mt-1">
								{$LL.export.rendersOnlyOverlay()}
							</span>
						</span>
					</label>

					{#if globalState.getExportState.exportWithoutBackground}
						<div class="mt-3">
							<label class="block text-sm text-primary mb-2" for="transparent-export-format">
								{$LL.export.transparentExportFormat()}
							</label>
							<select
								id="transparent-export-format"
								class="input w-full"
								bind:value={globalState.getExportState.transparentExportFormat}
							>
								<option value="mov_prores_4444">{$LL.export.movQtrleRecommended()}</option>
								<option value="webm_vp9_alpha">{$LL.export.webmVp9()}</option>
							</select>
							<p class="text-xs text-thirdly mt-2">
								{$LL.export.movQtrleCompatibility()}
							</p>
						</div>
					{/if}
				</div>

				<div class="mb-4">
					<h4 class="text-base font-medium text-secondary mb-1">{$LL.export.exportPerformance()}</h4>
					<p class="text-thirdly text-sm">
						{$LL.export.chooseCpuUsage()}
					</p>
				</div>

				<div class="grid grid-cols-1 gap-3">
					{#each performanceProfileIds as id (id)}
						{@const label = id === 'fastest' ? $LL.export.fastest() : id === 'balanced' ? $LL.export.balanced() : $LL.export.lowCpu()}
						{@const desc = id === 'fastest' ? $LL.export.fastestDescription() : id === 'balanced' ? $LL.export.balancedDescription() : $LL.export.lowCpuDescription()}
						<button
							type="button"
							class="rounded-xl border p-4 text-left transition-colors"
							class:border-accent-primary={globalState.getExportState.performanceProfile === id}
							class:bg-secondary={globalState.getExportState.performanceProfile === id}
							class:border-color={globalState.getExportState.performanceProfile !== id}
							onclick={() => {
								globalState.getExportState.performanceProfile = id;
							}}
						>
							<div class="flex items-center justify-between gap-3">
								<p class="text-sm font-medium text-primary">{label}</p>
								{#if globalState.getExportState.performanceProfile === id}
									<span class="material-icons text-accent-primary text-lg">check_circle</span>
								{/if}
							</div>
							<p class="mt-1 text-xs text-thirdly">{desc}</p>
						</button>
					{/each}
				</div>
			</div>
		{/if}
	</div>
</div>
