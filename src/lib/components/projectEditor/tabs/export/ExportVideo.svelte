<script lang="ts">
	import Exporter from '$lib/classes/Exporter';
	import { globalState } from '$lib/runes/main.svelte';
	import { slide } from 'svelte/transition';
	import TimeInput from './TimeInput.svelte';
	import Style from '../styleEditor/Style.svelte';
	import { VerseRange } from '$lib/classes';
	import ExportFolderPicker from './ExportFolderPicker.svelte';

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
	<div class="mb-6">
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
					globalState.getStyle('global', 'video-dimension')!.value = v;
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
					<b>Chunk size</b> for video processing (lower values use less memory). Range: 1-200 (1=30s,
					50=2min30, 200=10min)
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
					min="1"
					max="200"
					step="1"
					class="input w-full h-10"
					bind:value={globalState.getExportState.chunkSize}
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
						<p class="text-thirdly text-xs italic">Extension (.mp4) will be added automatically.</p>
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
</div>
