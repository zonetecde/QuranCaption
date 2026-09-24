<script lang="ts">
	import LL from '$lib/i18n/i18n-svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import ExportService from '$lib/services/ExportService';
	import ExportMonitor from './ExportMonitor.svelte';
	import ModalManager from './modals/ModalManager';
	import { VersionService } from '$lib/services/VersionService.svelte';
	import Settings from './settings/Settings.svelte';
	import TitleBarTools from './TitleBarTools.svelte';
	import { fade } from 'svelte/transition';
	import {
		ProjectHistoryManager,
		projectHistoryAvailability
	} from '$lib/services/undoRedo/ProjectHistoryManager';

	let isHomePage = $derived(
		globalState.currentProject === null && globalState.currentPage === 'home'
	);

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

<header class="mobile-app-bar" dir="ltr">
	{#if isHomePage}
		<div class="app-bar-logo" aria-hidden="true">
			<img src="/favicon.png" alt="" />
		</div>
	{:else}
		<button
			type="button"
			class="app-bar-button"
			onclick={goHome}
			disabled={globalState.uiState.isTourActive}
			aria-label={$LL.settings.atHomeMenu()}
		>
			<span class="material-icons">home</span>
		</button>

		<button
			type="button"
			class="app-bar-button"
			onclick={() => ProjectHistoryManager.undo()}
			disabled={!$projectHistoryAvailability.canUndo || globalState.uiState.isTourActive}
			aria-label={($LL.common as unknown as Record<string, string>).undo}
		>
			<span class="material-icons">undo</span>
		</button>

		<button
			type="button"
			class="app-bar-button"
			onclick={() => ProjectHistoryManager.redo()}
			disabled={!$projectHistoryAvailability.canRedo || globalState.uiState.isTourActive}
			aria-label={($LL.common as unknown as Record<string, string>).redo}
		>
			<span class="material-icons">redo</span>
		</button>
	{/if}

	{#if VersionService.latestUpdate?.hasUpdate && globalState.currentProject === null}
		<button
			type="button"
			class="app-bar-button relative"
			onclick={() => void ModalManager.newUpdateModal(VersionService.latestUpdate!)}
			disabled={globalState.uiState.isTourActive}
			aria-label={$LL.home.updateAvailableTitle()}
		>
			<span class="material-icons">system_update</span>
			<span class="absolute top-2 right-2 h-2 w-2 rounded-full bg-blue-400 animate-pulse"></span>
		</button>
	{/if}

	<div class="app-bar-title min-w-0 text-center">
		<p class:app-bar-brand-title={isHomePage} class="app-bar-title-text truncate text-primary">
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

	{#if globalState.currentProject}
		<TitleBarTools />
	{/if}

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
		min-height: calc(2.0625rem + env(safe-area-inset-top));
		align-items: center;
		gap: 0.125rem;
		padding: env(safe-area-inset-top) 0.375rem 0;
		background:
			linear-gradient(
				90deg,
				color-mix(in srgb, var(--accent-primary) 5%, transparent),
				transparent 32%
			),
			var(--bg-titlebar);
		border-bottom: 1px solid var(--border-color);
		box-shadow: 0 1px 8px rgb(0 0 0 / 8%);
		z-index: 200;
	}

	.app-bar-button {
		display: flex;
		width: 2.0625rem;
		height: 2.0625rem;
		flex: 0 0 2.0625rem;
		align-items: center;
		justify-content: center;
		border-radius: 0.5625rem;
		color: var(--text-primary);
		transition: background-color 120ms ease;
	}

	.app-bar-button .material-icons {
		font-size: 1.125rem;
	}

	.app-bar-logo {
		display: flex;
		width: 2.0625rem;
		height: 2.0625rem;
		flex: 0 0 2.0625rem;
		align-items: center;
		justify-content: center;
	}

	.app-bar-logo img {
		width: 1.5rem;
		height: 1.5rem;
		border-radius: 0.45rem;
		box-shadow: 0 3px 10px rgb(0 0 0 / 18%);
	}

	.app-bar-title {
		position: absolute;
		top: calc(env(safe-area-inset-top) + 1.03125rem);
		left: 50%;
		width: calc(100% - 13.75rem);
		transform: translate(-50%, -50%);
		pointer-events: none;
	}

	.app-bar-title-text {
		font-size: 0.675rem;
		font-weight: 650;
		letter-spacing: -0.01em;
	}

	.app-bar-brand-title {
		font-size: 0.7875rem;
		font-weight: 800;
		letter-spacing: -0.025em;
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
		min-width: 0.8625rem;
		height: 0.8625rem;
		align-items: center;
		justify-content: center;
		border-radius: 9999px;
		padding: 0 0.1875rem;
		background: var(--accent-primary);
		color: white;
		font-size: 0.5rem;
		font-weight: 700;
	}
</style>
