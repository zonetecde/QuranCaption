<script lang="ts">
	import { globalState } from '$lib/runes/main.svelte';
	import { fade } from 'svelte/transition';
	import LL from '$lib/i18n/i18n-svelte';
	import { get } from 'svelte/store';

	let { title, subtitle }: { title?: string; subtitle?: string } = $props();

	$effect(() => {
		if (
			globalState.currentProject &&
			!globalState.currentProject.projectEditorState.showDropScreen
		) {
			// destroy the `#drop-overlay-container` div
			const dropOverlayContainer = document.getElementById('drop-overlay-container');
			if (dropOverlayContainer) {
				dropOverlayContainer.remove();
			}
		}
	});
</script>

<div
	class="w-screen h-full absolute inset-0 z-30 backdrop-blur-sm bg-black/40"
	transition:fade={{ duration: 300 }}
>
	<!-- Drop zone with animated border -->
	<div class="flex flex-col items-center justify-center h-full p-8">
		<div class="drop-zone">
			<div class="drop-zone-content">
				<span class="material-icons upload-icon">cloud_upload</span>
				<div class="text-white text-2xl font-semibold mb-2">
					{title ?? get(LL).editor.dropFilesHere()}
				</div>
				<div class="text-gray-300 text-sm">
					{subtitle ?? get(LL).editor.supportMediaTypes()}
				</div>

				<!-- Corner decorations -->
				<div class="corner corner-tl"></div>
				<div class="corner corner-tr"></div>
				<div class="corner corner-bl"></div>
				<div class="corner corner-br"></div>
			</div>
		</div>
	</div>
</div>

<style>
	.drop-zone {
		position: relative;
		width: 100%;
		max-width: 600px;
		height: 300px;
		border: 3px dashed rgba(99, 102, 241, 0.5);
		border-radius: 20px;
		background: rgba(255, 255, 255, 0.05);
		backdrop-filter: blur(10px);
		transition: all 0.3s ease;
		animation: pulse-border 2s ease-in-out infinite;
	}

	.drop-zone:hover {
		border-color: rgba(99, 102, 241, 0.8);
		background: rgba(255, 255, 255, 0.1);
		transform: scale(1.02);
	}

	.drop-zone-content {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		height: 100%;
		padding: 2rem;
	}

	.upload-icon {
		font-size: 4rem;
		color: #6366f1;
		margin-bottom: 1rem;
		animation: float 3s ease-in-out infinite;
	}

	.corner {
		position: absolute;
		width: 30px;
		height: 30px;
		border: 3px solid #6366f1;
		border-radius: 8px;
		background: rgba(99, 102, 241, 0.2);
		animation: corner-glow 2s ease-in-out infinite alternate;
	}

	.corner-tl {
		top: -15px;
		left: -15px;
		border-right: none;
		border-bottom: none;
		border-top-left-radius: 15px;
	}

	.corner-tr {
		top: -15px;
		right: -15px;
		border-left: none;
		border-bottom: none;
		border-top-right-radius: 15px;
	}

	.corner-bl {
		bottom: -15px;
		left: -15px;
		border-right: none;
		border-top: none;
		border-bottom-left-radius: 15px;
	}

	.corner-br {
		bottom: -15px;
		right: -15px;
		border-left: none;
		border-top: none;
		border-bottom-right-radius: 15px;
	}

	@keyframes pulse-border {
		0%,
		100% {
			border-color: rgba(99, 102, 241, 0.5);
		}
		50% {
			border-color: rgba(99, 102, 241, 0.8);
		}
	}

	@keyframes float {
		0%,
		100% {
			transform: translateY(0px);
		}
		50% {
			transform: translateY(-10px);
		}
	}

	@keyframes corner-glow {
		0% {
			box-shadow: 0 0 5px rgba(99, 102, 241, 0.3);
		}
		100% {
			box-shadow: 0 0 20px rgba(99, 102, 241, 0.8);
		}
	}
</style>
