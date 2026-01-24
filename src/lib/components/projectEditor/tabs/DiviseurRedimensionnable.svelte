<script lang="ts">
	import { globalState } from '$lib/runes/main.svelte';
	import { onMount } from 'svelte';
	import { WaveformService } from '$lib/services/WaveformService.svelte.js';

	let isDragging = $state(false);
	let containerRef: HTMLElement | null = $state(null);

	onMount(() => {
		// containerRef = parent de ce composant
		containerRef = document.querySelector('.diviseur')?.parentNode as HTMLElement;
	});

	function startResize(e: MouseEvent) {
		isDragging = true;
		document.addEventListener('mousemove', resize);
		document.addEventListener('mouseup', stopResize);
		e.preventDefault();
	}

	function resize(e: MouseEvent) {
		if (!isDragging || !containerRef) return;

		const rect = containerRef.getBoundingClientRect();
		const newHeight = ((e.clientY - rect.top) / rect.height) * 100;
		globalState.currentProject!.projectEditorState.upperSectionHeight = Math.max(
			10,
			Math.min(90, newHeight)
		); // Limite entre 10% et 90%
	}

	function stopResize() {
		isDragging = false;
		document.removeEventListener('mousemove', resize);
		document.removeEventListener('mouseup', stopResize);
		WaveformService.clearAllCache();
	}
</script>

<!-- Diviseur redimensionnable -->
<div
	class="h-0.75 bg-secondary cursor-row-resize flex-shrink-0 diviseur {isDragging
		? 'bg-blue-500'
		: ''}"
	onmousedown={startResize}
></div>
