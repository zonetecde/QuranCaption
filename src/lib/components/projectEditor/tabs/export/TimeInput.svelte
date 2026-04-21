<script lang="ts">
	import { globalState } from '$lib/runes/main.svelte';

	let {
		label,
		value = $bindable(),
		placeholder = '00:00:00'
	}: {
		label: string;
		value: number;
		placeholder?: string;
	} = $props();

	// Convert milliseconds to HH:MM:SS format for time input
	function msToTimeValue(ms: number): string {
		const totalSeconds = Math.floor(ms / 1000);
		const hours = Math.floor(totalSeconds / 3600);
		const minutes = Math.floor((totalSeconds % 3600) / 60);
		const seconds = totalSeconds % 60;

		return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
	}

	// Apply new time value
	function applyValue(newValue: number) {
		// Make sure que start time < end time
		if (label === 'Start Time' && newValue >= globalState.getExportState.videoEndTime) {
			value = newValue;
			globalState.getExportState.videoEndTime = newValue + 1000; // Ensure
		} else if (label === 'End Time' && newValue <= globalState.getExportState.videoStartTime) {
			value = newValue;
			globalState.getExportState.videoStartTime = Math.max(0, newValue - 1000); // Ensure at least 1 second duration
		} else value = newValue;
	}
</script>

<div>
	<label for="time-input-{label}" class="block text-secondary text-sm font-medium mb-2">
		{label}
	</label>

	<div class="relative flex flex-col 2xl:flex-row gap-2 items-center">
		<input
			id="time-input-{label}"
			type="time"
			step="1"
			class="w-full px-3 py-2 bg-secondary border border-color rounded-lg text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent"
			oninput={(e) => {
				// Convertis en ms et applique
				const timeString = (e.target as HTMLInputElement).value;
				const [hh, mm, ss] = timeString.split(':').map(Number);
				const totalSeconds = hh * 3600 + mm * 60 + (ss || 0);
				applyValue(totalSeconds * 1000);
			}}
			value={msToTimeValue(value)}
			{placeholder}
		/>
		<div class=" flex flex-row items-center gap-x-2">
			<span class="text-thirdly text-sm">or</span>
			<button
				class="btn-accent text-sm py-1 px-3 min-w-[150px] whitespace-nowrap"
				title="Use the preview timeline cursor time and put it into the time field"
				onclick={() => {
					const currentPreviewTime = globalState.getTimelineState.cursorPosition;
					applyValue(currentPreviewTime);
				}}
			>
				Use cursor time
			</button>
		</div>
	</div>

	<p class="text-thirdly text-xs mt-1">
		Format: HH:MM:SS or use the current timeline cursor position
	</p>
</div>
