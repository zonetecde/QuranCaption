<script lang="ts">
	import Home from '$lib/components/home/Home.svelte';
	import AiVideoPage from '$lib/components/aiVideo/AiVideoPage.svelte';

	import ExportService from '$lib/services/ExportService';
	import DonationFloatingButton from '$lib/components/misc/DonationFloatingButton.svelte';
	import DonationProgressBar from '$lib/components/misc/DonationProgressBar.svelte';
	import ProjectEditor from '$lib/components/projectEditor/ProjectEditor.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import ShortcutService from '$lib/services/ShortcutService';
	import { discordService } from '$lib/services/DiscordService';
	import { get } from 'svelte/store';
	import LL from '$lib/i18n/i18n-svelte';
	import ModalManager from '$lib/components/modals/ModalManager';
	import { getCurrentWindow, type CloseRequestedEvent } from '@tauri-apps/api/window';
	import { onDestroy, onMount } from 'svelte';
	import { Toaster } from 'svelte-5-french-toast';
	import Settings from '$lib/classes/Settings.svelte';
	import { quranAuthService } from '$lib/services/QuranAuthService.svelte';

	let allowWindowClose = false;
	let isHandlingCloseRequest = false;
	let unlistenCloseRequest: (() => void) | undefined;

	/**
	 * Synchronise l'orientation Android courante dans l'etat global partage.
	 */
	function syncAndroidViewport(): void {
		if (typeof window === 'undefined') return;

		const width = window.innerWidth;
		const height = window.innerHeight;

		globalState.uiState.androidViewport = {
			width,
			height,
			orientation: width > height ? 'landscape' : 'portrait'
		};
	}

	async function cancelOngoingExports() {
		const ongoingExports = ExportService.currentlyExportingProjects();
		await Promise.all(ongoingExports.map((exportation) => exportation.cancelExport()));
		await ExportService.saveExports();
	}

	/**
	 * Check si des exports sont en cours
	 * @param event
	 */
	async function handleMainWindowClose(event: CloseRequestedEvent) {
		if (allowWindowClose) return;

		const ongoingExports = ExportService.currentlyExportingProjects();
		if (ongoingExports.length === 0) return;

		event.preventDefault();
		if (isHandlingCloseRequest) return;
		isHandlingCloseRequest = true;

		try {
			// Si des exports sont en cours alors on demande confirmation
			const confirmed = await ModalManager.confirmModal(
				get(LL).home.exportInProgressWarning(),
				true
			);

			if (!confirmed) return;

			allowWindowClose = true;
			await cancelOngoingExports();
			await getCurrentWindow().close();
		} finally {
			isHandlingCloseRequest = false;
		}
	}

	onMount(() => {
		syncAndroidViewport();
		window.addEventListener('resize', syncAndroidViewport);

		return () => {
			window.removeEventListener('resize', syncAndroidViewport);
		};
	});

	onMount(async () => {
		// Init le gestionnaire de shortcuts
		ShortcutService.init();

		// Charge les paramètres utilisateur (une seconde fois pour etre sur)
		await Settings.load();
		await quranAuthService.init();
		await quranAuthService.syncThemeFromPreferences(true);

		// Initialiser Discord Rich Presence
		discordService
			.init()
			.then(() => {
				discordService.setIdleState();
			})
			.catch((err) => {
				console.error('Failed to initialize Discord Rich Presence:', err);
			});

		unlistenCloseRequest = await getCurrentWindow().onCloseRequested(handleMainWindowClose);
	});

	onDestroy(() => {
		unlistenCloseRequest?.();
	});
</script>

<Toaster />

<div class="flex flex-col h-screen overflow-hidden">
	<main
		class={`flex-1 overflow-auto ${
			globalState.currentProject === null && globalState.currentPage === 'home'
				? 'home-scroll-host'
				: ''
		}`}
	>
		{#if globalState.currentProject !== null}
			<ProjectEditor />
		{:else if globalState.currentPage === 'ai-video'}
			<AiVideoPage />
		{:else}
			<Home />
		{/if}
		<DonationFloatingButton />
		<DonationProgressBar />
	</main>

	<!-- AI Video generation overlay — shown on top of everything while pipeline runs -->
	{#if globalState.aiVideo.generationStatus}
		<div
			class="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center"
			style="z-index: 99999;"
		>
			<div
				class="bg-primary border border-color rounded-2xl shadow-2xl p-8 max-w-md w-full mx-4 space-y-5"
			>
				<div class="flex items-center gap-4">
					<div
						class="w-12 h-12 bg-gradient-to-br from-purple-500 to-blue-500 rounded-full flex items-center justify-center shadow-lg shrink-0"
					>
						<span class="material-icons text-white text-xl animate-pulse">auto_awesome</span>
					</div>
					<div>
						<h2 class="text-lg font-bold text-primary">{$LL.home.settingUpProject()}</h2>
						<p class="text-sm text-secondary mt-0.5">{globalState.aiVideo.generationStatus}</p>
					</div>
				</div>
				<div class="w-full bg-bg-secondary rounded-full h-2 overflow-hidden">
					<div
						class="h-full bg-gradient-to-r from-purple-500 to-blue-500 rounded-full animate-pulse"
						style="width: 100%"
					></div>
				</div>
				<p class="text-xs text-thirdly text-center">{$LL.home.pleaseWaitMinute()}</p>
			</div>
		</div>
	{/if}
</div>

<style>
	.home-scroll-host {
		-ms-overflow-style: none;
		scrollbar-width: none;
	}

	.home-scroll-host::-webkit-scrollbar {
		display: none;
	}
</style>
