<script lang="ts">
	import LL from '$lib/i18n/i18n-svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { getCurrentWindow } from '@tauri-apps/api/window';
	import { openUrl } from '@tauri-apps/plugin-opener';
	import EditableText from './misc/EditableText.svelte';
	import ExportService from '$lib/services/ExportService';
	import ExportMonitor from './ExportMonitor.svelte';
	import ModalManager from './modals/ModalManager';
	import { discordService } from '$lib/services/DiscordService';
	import { VersionService } from '$lib/services/VersionService.svelte';
	import { slide, fade } from 'svelte/transition';
	import Settings from './settings/Settings.svelte';
	import TitleBarTools from './TitleBarTools.svelte';
	import {
		ProjectHistoryManager,
		projectHistoryAvailability
	} from '$lib/services/undoRedo/ProjectHistoryManager';
	import BatchReviewNavigation from './batch/BatchReviewNavigation.svelte';
	import {
		isBatchReviewActive,
		leaveBatchReview
	} from '$lib/services/BatchReviewNavigationService';

	let showHelpPopover = $state(false);

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
			disabled={globalState.uiState.isTourActive}
			onclick={async () => {
				// go home
				if (isBatchReviewActive()) {
					await leaveBatchReview('home');
				} else if (globalState.currentProject) {
					await globalState.currentProject?.save();
					globalState.currentProject = null;
				}
				globalState.currentPage = 'home';
				// Discord Rich Presence
				discordService.setIdleState();
			}}
		>
			<img class="text-indigo-400 w-8 pb-0.25" alt="Logo" src="favicon.png" />
			<h1 class="text-lg font-semibold text-primary pt-0.75">Quran Caption</h1>
		</button>

		{#if VersionService.latestUpdate?.hasUpdate}
			<button
				class="w-10 cursor-pointer rounded-full hover:bg-gray-700 relative"
				type="button"
				onclick={() => ModalManager.newUpdateModal(VersionService.latestUpdate!)}
				aria-label={$LL.home.updateAvailableTitle()}
			>
				<span class="material-icons pt-2">system_update</span>
				<p
					class="absolute top-1.25 right-1.5 w-2.5 h-2.5 rounded-full bg-blue-400 outline outline-blue-600 animate-pulse"
				></p>
			</button>
		{/if}

		{#if globalState.currentProject}
			<div class="flex items-center gap-1">
				<button
					class="w-8 h-8 rounded-full duration-100 flex items-center justify-center text-primary hover:bg-accent disabled:opacity-35 disabled:cursor-not-allowed disabled:hover:bg-transparent"
					type="button"
					disabled={globalState.uiState.isTourActive || !$projectHistoryAvailability.canUndo}
					onclick={() => ProjectHistoryManager.undo()}
				>
					<span class="material-icons text-[20px]!">undo</span>
				</button>
				<button
					class="w-8 h-8 rounded-full duration-100 flex items-center justify-center text-primary hover:bg-accent disabled:opacity-35 disabled:cursor-not-allowed disabled:hover:bg-transparent"
					type="button"
					disabled={globalState.uiState.isTourActive || !$projectHistoryAvailability.canRedo}
					onclick={() => ProjectHistoryManager.redo()}
				>
					<span class="material-icons text-[20px]!">redo</span>
				</button>
			</div>

			{#if isBatchReviewActive() && globalState.currentProject.detail.batchId === globalState.shared.batchReview.batchId}
				<BatchReviewNavigation />
			{:else}
				<EditableText
					bind:value={globalState.currentProject.detail.name}
					text={$LL.home.projectName()}
					disabled={globalState.uiState.isTourActive}
					parentClasses="absolute left-1/2 -translate-x-1/2 pr-[18px]"
				></EditableText>
			{/if}
		{/if}
	</div>
	<div class="flex items-center space-x-2">
		<button
			class="w-10 cursor-pointer rounded-full hover:bg-accent"
			type="button"
			disabled={globalState.uiState.isTourActive}
			onclick={ModalManager.settingsModal}
			aria-haspopup="dialog"
			aria-expanded={globalState.uiState.isSettingsOpen}
		>
			<span class="material-icons pt-2">settings</span>
		</button>

		<!-- Si un projet est actif, alors on affiche les outils -->
		{#if globalState.currentProject}
			<button
				class="w-10 cursor-pointer rounded-full hover:bg-accent"
				type="button"
				disabled={globalState.uiState.isTourActive}
				onclick={() => {
					globalState.shared.projectSearch.openRequest = Date.now();
				}}
				aria-label={$LL.home.searchProject()}
			>
				<span class="material-icons pt-2">search</span>
			</button>
			<TitleBarTools />
		{/if}

		<button
			id="help-popover-button"
			class="w-10 cursor-pointer rounded-full hover:bg-gray-700 relative"
			type="button"
			disabled={globalState.uiState.isTourActive}
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
					transition:slide
				>
					<div class="flex items-center justify-between mb-2">
						<h3 class="text-base font-semibold text-primary">{$LL.home.needAssistance()}</h3>
						<!-- svelte-ignore node_invalid_placement_ssr -->
						<button
							class="material-icons text-secondary hover:text-primary"
							type="button"
							onclick={(event) => {
								event.stopPropagation();
								showHelpPopover = false;
							}}
						>
							close
						</button>
					</div>
					<p class="text-thirdly text-left text-xs mb-3">
						{$LL.home.assistanceDescription()}
					</p>
					<div class="rounded-md overflow-hidden border border-color mb-3">
						<iframe
							class="w-full aspect-video"
							src="https://www.youtube.com/embed/vCRUjzATRDk"
							title={$LL.home.quranCaptionOverview()}
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
						{$LL.home.openOnlineDocumentation()}
					</button>
				</div>
			{/if}
		</button>
		<button
			id="export-button"
			class="w-10 cursor-pointer rounded-full hover:bg-gray-700 relative"
			type="button"
			disabled={globalState.uiState.isTourActive}
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
			class="w-10 cursor-pointer rounded-full hover:bg-accent"
			type="button"
			onclick={minimizeButtonClick}
		>
			<span class="material-icons pt-2">minimize</span>
		</button>
		<button
			class="w-10 cursor-pointer rounded-full hover:bg-accent"
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

{#if globalState.uiState.isSettingsOpen}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="modal-wrapper z-[10000]!"
		transition:fade={{ duration: 200 }}
		onclick={() => (globalState.uiState.isSettingsOpen = false)}
	>
		<div onclick={(e) => e.stopPropagation()}>
			<Settings resolve={() => (globalState.uiState.isSettingsOpen = false)} />
		</div>
	</div>
{/if}

<!-- Export Monitor -->
<ExportMonitor />
