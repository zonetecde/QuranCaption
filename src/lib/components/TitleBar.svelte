<script lang="ts">
	import { globalState } from '$lib/runes/main.svelte';
	import { getCurrentWindow } from '@tauri-apps/api/window';
	import { openUrl } from '@tauri-apps/plugin-opener';
	import EditableText from './misc/EditableText.svelte';
	import ExportService from '$lib/services/ExportService';
	import ExportMonitor from './ExportMonitor.svelte';
	import ModalManager from './modals/ModalManager';
	import { discordService } from '$lib/services/DiscordService';

	let showHelpPopover = false;

	async function minimizeButtonClick() {
		getCurrentWindow().minimize();
	}

	async function maximalizeButtonClick() {
		const currentWindow = await getCurrentWindow();
		if (await currentWindow.isMaximized()) {
			await currentWindow.unmaximize();
		} else {
			await currentWindow.maximize();
		}
	}

	async function closeButtonClick() {
		const currentWindow = await getCurrentWindow();
		if (await currentWindow.isDecorated()) {
			await currentWindow.setDecorations(false);
		}
		await currentWindow.close();
	}

	// Fermer le monitor quand on clique ailleurs
	function handleClickOutside(event: Event) {
		if (globalState.uiState.showExportMonitor) {
			const exportButton = document.getElementById('export-button');
			const exportMonitor = document.querySelector('[role="dialog"]');

			if (
				exportButton &&
				exportMonitor &&
				!exportButton.contains(event.target as Node) &&
				!exportMonitor.contains(event.target as Node)
			) {
				globalState.uiState.showExportMonitor = false;
			}
		}

		if (showHelpPopover) {
			const helpButton = document.getElementById('help-popover-button');
			const helpPopover = document.getElementById('help-popover');

			if (
				helpButton &&
				helpPopover &&
				!helpButton.contains(event.target as Node) &&
				!helpPopover.contains(event.target as Node)
			) {
				showHelpPopover = false;
			}
		}
	}
</script>

<svelte:window on:click={handleClickOutside} />

<header
	data-tauri-drag-region
	class="bg-titlebar shadow-md p-2 flex items-center justify-between fixed top-0 left-0 right-0 z-50 max-h-10"
>
	<div class="flex items-center space-x-5">
		<button
			class="flex space-x-2 cursor-pointer"
			onclick={async () => {
				// go home
				await globalState.currentProject?.save();
				globalState.currentProject = null;
				// Discord Rich Presence
				discordService.setIdleState();
			}}
		>
			<img class="text-indigo-400 w-8 pb-0.25" alt="Logo" src="favicon.png" />
			<h1 class="text-lg font-semibold text-gray-100 pt-0.75">Quran Caption</h1>
		</button>
		{#if globalState.currentProject}
			<button
				class="bg-green-700 hover:bg-green-800 duration-100 text-white text-sm px-2 py-1 rounded-md flex items-center space-x-2 cursor-pointer"
				type="button"
			>
				<span class="material-icons text-[20px]!">save</span>
				<span>Autosave</span>
			</button>

			<EditableText
				bind:value={globalState.currentProject.detail.name}
				text={'Project Name'}
				parentClasses="absolute left-1/2 -translate-x-1/2 pr-[18px]"
			></EditableText>
		{/if}
	</div>
	<div class="flex items-center space-x-2">
		<button
			class="w-10 cursor-pointer rounded-full hover:bg-gray-700"
			type="button"
			onclick={ModalManager.settingsModal}
		>
			<span class="material-icons pt-2">settings</span>
		</button>
		<button
			id="help-popover-button"
			class="w-10 cursor-pointer rounded-full hover:bg-gray-700 relative"
			type="button"
			onclick={(event) => {
				event.stopPropagation();
				showHelpPopover = !showHelpPopover;
			}}
			aria-haspopup="dialog"
			aria-expanded={showHelpPopover}
		>
			<span class="material-icons pt-2">help_outline</span>

			{#if showHelpPopover}
				<div
					id="help-popover"
					class="absolute right-0 mt-2 w-96 bg-primary border border-color rounded-lg shadow-lg p-4 z-50 text-sm text-secondary"
				>
					<div class="flex items-center justify-between mb-2">
						<h3 class="text-base font-semibold text-primary">Need Assistance?</h3>
						<!-- svelte-ignore node_invalid_placement_ssr -->
						<button
							class="material-icons text-secondary hover:text-primary"
							type="button"
							onclick={() => (showHelpPopover = false)}
						>
							close
						</button>
					</div>
					<p class="text-thirdly text-left text-xs mb-3">
						Watch the walkthrough below or open the full documentation for more details.
					</p>
					<div class="rounded-md overflow-hidden border border-color mb-3">
						<iframe
							class="w-full aspect-video"
							src="https://www.youtube.com/embed/vCRUjzATRDk"
							title="Quran Caption Overview"
							allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
							allowfullscreen
						></iframe>
					</div>
					<!-- svelte-ignore node_invalid_placement_ssr -->
					<button
						class="btn-accent w-full text-center py-2 text-sm font-medium"
						type="button"
						onclick={async () => {
							await openUrl('https://qurancaption-project.vercel.app/documentation');
							showHelpPopover = false;
						}}
					>
						Open Online Documentation
					</button>
				</div>
			{/if}
		</button>
		<button
			id="export-button"
			class="w-10 cursor-pointer rounded-full hover:bg-gray-700 relative"
			type="button"
			onclick={() => {
				globalState.uiState.showExportMonitor = !globalState.uiState.showExportMonitor;
			}}
		>
			<span class="material-icons pt-2">file_download</span>

			{#if ExportService.currentlyExportingProjects().length > 0}
				<p
					class="absolute top-0.5 -right-1 w-4 flex items-center pt-0.5 justify-center text-xs h-4 rounded-full bg-blue-400 outline outline-blue-600 animate-pulse"
				>
					{ExportService.currentlyExportingProjects().length}
				</p>
			{/if}
		</button>
		<button
			class="w-10 cursor-pointer rounded-full hover:bg-gray-700"
			type="button"
			onclick={minimizeButtonClick}
		>
			<span class="material-icons pt-2">minimize</span>
		</button>
		<button
			class="w-10 cursor-pointer rounded-full hover:bg-gray-700"
			type="button"
			onclick={maximalizeButtonClick}
		>
			<span class="material-icons pt-2">crop_square</span>
		</button>
		<button
			class="w-10 cursor-pointer rounded-full hover:bg-red-600"
			type="button"
			onclick={closeButtonClick}
		>
			<span class="material-icons pt-2">close</span>
		</button>
	</div>
</header>

<!-- Export Monitor -->
<ExportMonitor />
