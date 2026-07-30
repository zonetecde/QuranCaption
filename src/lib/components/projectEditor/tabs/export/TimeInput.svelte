<script lang="ts">
	import { globalState } from '$lib/runes/main.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';

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
		ProjectHistoryManager.track('set export time range', () => {
			// Make sure que start time < end time
			if (label === 'Start Time' && newValue >= globalState.getExportState.videoEndTime) {
				value = newValue;
				globalState.getExportState.videoEndTime = newValue + 1000; // Ensure
			} else if (label === 'End Time' && newValue <= globalState.getExportState.videoStartTime) {
				value = newValue;
				globalState.getExportState.videoStartTime = Math.max(0, newValue - 1000); // Ensure at least 1 second duration
			} else value = newValue;
		});
	}
</script>

<div>
	<label for="time-input-{label}" class="mb-1.5 block text-xs font-medium text-secondary">
		{label}
	</label>

	<div class="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
		<input
			id="time-input-{label}"
			type="time"
			step="1"
			class="h-10 min-w-0 w-full rounded-lg border border-color bg-secondary px-2 text-sm text-primary focus:border-transparent focus:outline-none focus:ring-2 focus:ring-accent-primary"
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
		<button
			class="btn-accent flex h-10 max-w-32 items-center justify-center gap-1 px-2 text-[11px] leading-tight"
			title={$LL.export.cursorTimeTitle()}
			onclick={() => {
				const currentPreviewTime = globalState.getTimelineState.cursorPosition;
				applyValue(currentPreviewTime);
			}}
		>
			<span class="material-icons-outlined shrink-0 text-sm">my_location</span>
			<span class="line-clamp-2">{$LL.export.useCursorTime()}</span>
		</button>
	</div>
</div>
