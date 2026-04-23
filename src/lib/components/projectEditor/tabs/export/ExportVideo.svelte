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

	type PerformanceProfile = 'fastest' | 'balanced' | 'low_cpu';

	const performanceProfiles: {
		id: PerformanceProfile;
		label: string;
		description: string;
	}[] = [
		{
			id: 'fastest',
			label: 'Fastest',
			description: 'Prioritizes export speed and may use more CPU.'
		},
		{
			id: 'balanced',
			label: 'Balanced',
			description: 'Keeps the current default behavior.'
		},
		{
			id: 'low_cpu',
			label: 'Low CPU',
			description: 'Reduces CPU usage at the cost of slower exports.'
		}
	];

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
		<h3 class="text-lg font-semibold text-primary mb-2">Export Video</h3>
		<p class="text-thirdly text-sm">
			Configure your video export settings and select the portion to export.
		</p>
	</div>

	<!-- Time Range Selection -->
	<div data-tour-id="export-range" class="mb-6">
		<h4 class="text-base font-medium text-secondary mb-3">Export Range</h4>
		<p class="text-thirdly text-sm mb-4">Select the time range of your video to export:</p>

		<div class="bg-accent rounded-lg p-4 border border-color">
			<div class="grid grid-cols-1 grid-rows-2 gap-4">
				<!-- Start Time -->
				<TimeInput label="Start Time" bind:value={globalState.getExportState.videoStartTime} />

				<!-- End Time -->
				<TimeInput label="End Time" bind:value={globalState.getExportState.videoEndTime} />
			</div>

			<!-- Duration Preview -->
			<div class="mt-4 p-3 bg-secondary rounded-lg border border-color">
				<div class="flex items-center justify-between text-sm">
					<span class="text-secondary">Export Duration:</span>
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
					<span class="text-secondary min-w-[150px]">Export Verse Range:</span>
					<span class="text-accent-primary font-medium">
						{VerseRange.getExportVerseRange().toString()}
					</span>
				</div>
			</div>
		</div>
	</div>

	<div class="mb-6">
		<h4 class="text-base font-medium text-secondary mb-3">Video Quality & Orientation</h4>
		<div class="bg-accent rounded-lg p-4 border border-color">
			<p class="text-thirdly text-sm mb-4">
				Set the resolution and orientation for the exported video. Higher resolutions offer better
				quality but may increase export time.
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
		<h4 class="text-base font-medium text-secondary mb-3">Video & Audio Fade</h4>
		<div class="bg-accent rounded-lg p-4 border border-color">
			<p class="text-thirdly text-sm mb-4">
				Enable or disable video and audio fade effects during export and change their duration.
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
		<h4 class="text-base font-medium text-secondary mb-3">Performance Settings</h4>
		<div class="bg-accent rounded-lg p-4 border border-color">
			<div class="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
				<p class="text-thirdly text-sm leading-snug">
					Set the <b>frames per second</b> for the exported video (lower values export faster but are
					less fluid).
				</p>
				<p class="text-thirdly text-sm leading-snug">
					<b>Batch size</b> for ffmpeg transitions. Lower values use less RAM but export slower. Default
					is 12.
				</p>
				<input
					type="number"
					min="5"
					max="60"
					step="1"
					class="input w-full h-10"
					bind:value={globalState.getExportState.fps}
				/>
				<input
					type="number"
					min="2"
					max="128"
					step="1"
					class="input w-full h-10"
					bind:value={globalState.settings!.exportSettings.batchSize}
					onchange={persistGlobalBatchSize}
				/>
			</div>
		</div>
	</div>

	<!-- Video Filename & Export Location -->
	<div class="mb-6">
		<h4 class="text-base font-medium text-secondary mb-3">Video File Name & Export Location</h4>
		<div class="bg-accent rounded-lg p-4 border border-color">
			<div class="flex flex-col gap-6">
				<div>
					<p class="text-thirdly text-sm mb-4">
						Enter a name for your video file. If left empty, a default name will be generated.
					</p>

					<div class="flex flex-col gap-2">
						<input
							type="text"
							class="input w-full"
							placeholder={globalState.currentProject?.detail.generateExportFileName()}
							bind:value={globalState.getExportState.customFileName}
						/>
						<p class="text-thirdly text-xs italic">
							Extension ({globalState.getExportState.exportWithoutBackground
								? globalState.getExportState.transparentExportFormat === 'webm_vp9_alpha'
									? '.webm'
									: '.mov'
								: '.mp4'}) will be added automatically.
						</p>
					</div>
				</div>

				<div class="border-t border-color pt-4">
					<ExportFolderPicker description="Choose where your exported videos will be saved." />
				</div>
			</div>
		</div>
	</div>

	<!-- Export Button -->
	<div class="flex flex-col items-center">
		<button class="btn-accent px-6 py-3 font-medium" onclick={Exporter.exportVideo}>
			Export Video
		</button>
		<p class="text-thirdly text-xs mt-2 text-center">
			Start the video export process with your selected time range
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
				<p class="text-sm font-medium text-primary">Advanced Settings</p>
				<p class="text-xs text-thirdly">
					Control export performance without exposing raw ffmpeg flags.
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
					<h4 class="text-base font-medium text-secondary mb-1">Background</h4>
					<label class="mt-2 flex items-start gap-3 cursor-pointer select-none">
						<input
							type="checkbox"
							class="mt-0.5 h-4 w-4 rounded border border-color bg-secondary accent-[var(--accent-primary)]"
							bind:checked={globalState.getExportState.exportWithoutBackground}
						/>
						<span class="text-sm text-primary">
							Export without background
							<span class="block text-xs text-thirdly mt-1">
								Renders only the overlay with transparency (alpha).
							</span>
						</span>
					</label>

					{#if globalState.getExportState.exportWithoutBackground}
						<div class="mt-3">
							<label class="block text-sm text-primary mb-2" for="transparent-export-format">
								Transparent export format
							</label>
							<select
								id="transparent-export-format"
								class="input w-full"
								bind:value={globalState.getExportState.transparentExportFormat}
							>
								<option value="webm_vp9_alpha">WEBM (VP9 alpha)</option>
								<option value="mov_prores_4444">MOV (ProRes 4444)</option>
							</select>
							<p class="text-xs text-thirdly mt-2">
								<code>MOV (ProRes 4444)</code> is selected by default for compatibility, but file
								sizes are huge.
							</p>
						</div>
					{/if}
				</div>

				<div class="mb-4">
					<h4 class="text-base font-medium text-secondary mb-1">Export Performance</h4>
					<p class="text-thirdly text-sm">
						Choose how aggressively the exporter should use your CPU during ffmpeg work.
					</p>
				</div>

				<div class="grid grid-cols-1 gap-3">
					{#each performanceProfiles as profile (profile.id)}
						<button
							type="button"
							class="rounded-xl border p-4 text-left transition-colors"
							class:border-accent-primary={globalState.getExportState.performanceProfile ===
								profile.id}
							class:bg-secondary={globalState.getExportState.performanceProfile === profile.id}
							class:border-color={globalState.getExportState.performanceProfile !== profile.id}
							onclick={() => {
								globalState.getExportState.performanceProfile = profile.id;
							}}
						>
							<div class="flex items-center justify-between gap-3">
								<p class="text-sm font-medium text-primary">{profile.label}</p>
								{#if globalState.getExportState.performanceProfile === profile.id}
									<span class="material-icons text-accent-primary text-lg">check_circle</span>
								{/if}
							</div>
							<p class="mt-1 text-xs text-thirdly">{profile.description}</p>
						</button>
					{/each}
				</div>
			</div>
		{/if}
	</div>
</div>
