<script lang="ts">
	import LL from '$lib/i18n/i18n-svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import ExportService from '$lib/services/ExportService';
	import { discordService } from '$lib/services/DiscordService';
	import ExportMonitor from './ExportMonitor.svelte';
	import ModalManager from './modals/ModalManager';
	import Settings from './settings/Settings.svelte';
	import { fade } from 'svelte/transition';

	/**
	 * Sauvegarde le projet courant puis revient à l'accueil mobile.
	 * @returns {Promise<void>}
	 */
	async function goHome(): Promise<void> {
		if (globalState.currentProject) {
			await globalState.currentProject.save();
			globalState.currentProject = null;
		}
		globalState.currentPage = 'home';
		discordService.setIdleState();
	}
</script>

<header class="mobile-app-bar">
	<button
		type="button"
		class="app-bar-button"
		onclick={goHome}
		disabled={globalState.uiState.isTourActive}
		aria-label={$LL.settings.atHomeMenu()}
		aria-current={globalState.currentProject === null && globalState.currentPage === 'home'
			? 'page'
			: undefined}
	>
		<span class="material-icons">home</span>
	</button>

	<div class="min-w-0 flex-1 text-center">
		<p class="truncate text-sm font-semibold text-primary">
			{globalState.currentProject?.detail.name ?? 'Quran Caption'}
		</p>
	</div>

	<button
		type="button"
		class="app-bar-button"
		onclick={ModalManager.settingsModal}
		disabled={globalState.uiState.isTourActive}
		aria-label={$LL.settings.settings()}
		aria-haspopup="dialog"
		aria-expanded={globalState.uiState.isSettingsOpen}
	>
		<span class="material-icons">settings</span>
	</button>

	<button
		type="button"
		class="app-bar-button relative"
		onclick={() => {
			globalState.uiState.showExportMonitor = true;
		}}
		disabled={globalState.uiState.isTourActive}
		aria-label={$LL.exporterMonitor.exportsMonitor()}
		aria-haspopup="dialog"
		aria-expanded={globalState.uiState.showExportMonitor}
	>
		<span class="material-icons">file_download</span>
		{#if ExportService.currentlyExportingProjects().length > 0}
			<span class="export-count">
				{ExportService.currentlyExportingProjects().length}
			</span>
		{/if}
	</button>
</header>

{#if globalState.uiState.isSettingsOpen}
	<div
		class="modal-wrapper z-[10000]!"
		transition:fade={{ duration: 150 }}
		onclick={() => (globalState.uiState.isSettingsOpen = false)}
	>
		<div onclick={(event) => event.stopPropagation()}>
			<Settings resolve={() => (globalState.uiState.isSettingsOpen = false)} />
		</div>
	</div>
{/if}

<ExportMonitor />

<style>
	.mobile-app-bar {
		display: flex;
		min-height: calc(3.5rem + env(safe-area-inset-top));
		align-items: flex-end;
		gap: 0.25rem;
		padding: env(safe-area-inset-top) 0.5rem 0.25rem;
		background: var(--bg-titlebar);
		border-bottom: 1px solid var(--border-color);
		z-index: 60;
	}

	.app-bar-button {
		display: flex;
		width: 3rem;
		height: 3rem;
		flex: 0 0 3rem;
		align-items: center;
		justify-content: center;
		border-radius: 0.9rem;
		color: var(--text-primary);
		transition: background-color 120ms ease;
	}

	.app-bar-button:active {
		background: var(--bg-accent);
	}

	.app-bar-button:disabled {
		opacity: 0.45;
	}

	.export-count {
		position: absolute;
		top: 0.2rem;
		right: 0.15rem;
		display: flex;
		min-width: 1.15rem;
		height: 1.15rem;
		align-items: center;
		justify-content: center;
		border-radius: 9999px;
		padding: 0 0.25rem;
		background: var(--accent-primary);
		color: white;
		font-size: 0.65rem;
		font-weight: 700;
	}
</style>
