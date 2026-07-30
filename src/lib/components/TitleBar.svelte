<script lang="ts">
	import LL from '$lib/i18n/i18n-svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import ExportService from '$lib/services/ExportService';
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

	<div class="app-bar-title min-w-0 text-center">
		<p class="truncate text-sm font-semibold text-primary">
			{globalState.currentProject?.detail.name ?? 'Quran Caption'}
		</p>
	</div>

	<button
		type="button"
		class="app-bar-button app-bar-settings"
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
		position: relative;
		display: flex;
		min-height: calc(2.75rem + env(safe-area-inset-top));
		align-items: center;
		gap: 0.25rem;
		padding: env(safe-area-inset-top) 0.5rem 0;
		background: var(--bg-titlebar);
		border-bottom: 1px solid var(--border-color);
		z-index: 60;
	}

	.app-bar-button {
		display: flex;
		width: 2.75rem;
		height: 2.75rem;
		flex: 0 0 2.75rem;
		align-items: center;
		justify-content: center;
		border-radius: 0.75rem;
		color: var(--text-primary);
		transition: background-color 120ms ease;
	}

	.app-bar-title {
		position: absolute;
		top: calc(env(safe-area-inset-top) + 1.375rem);
		left: 50%;
		width: calc(100% - 11.5rem);
		transform: translate(-50%, -50%);
		pointer-events: none;
	}

	.app-bar-settings {
		margin-left: auto;
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
