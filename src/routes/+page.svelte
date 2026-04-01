<script lang="ts">
	import Home from '$lib/components/home/Home.svelte';
	import ExportService from '$lib/services/ExportService';
	import DonationFloatingButton from '$lib/components/misc/DonationFloatingButton.svelte';
	import ProjectEditor from '$lib/components/projectEditor/ProjectEditor.svelte';
	import TitleBar from '$lib/components/TitleBar.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import ShortcutService from '$lib/services/ShortcutService';
	import { discordService } from '$lib/services/DiscordService';
	import ModalManager from '$lib/components/modals/ModalManager';
	import { getCurrentWindow, type CloseRequestedEvent } from '@tauri-apps/api/window';
	import { onDestroy, onMount } from 'svelte';
	import { Toaster } from 'svelte-5-french-toast';
	import Settings from '$lib/classes/Settings.svelte';

	let allowWindowClose = false;
	let isHandlingCloseRequest = false;
	let unlistenCloseRequest: (() => void) | undefined;

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
				'Warning: an export is currently in progress. Do you really want to close Quran Caption? Any ongoing exports will be canceled.',
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

	onMount(async () => {
		// Init le gestionnaire de shortcuts
		ShortcutService.init();

		// Charge les paramètres utilisateur (une seconde fois pour être sûr)
		Settings.load();

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
	<!-- Barre de titre fixe -->
	<TitleBar />

	<!-- Zone de contenu avec scroll -->
	<main class="flex-1 overflow-auto mt-10">
		{#if globalState.currentProject === null}
			<Home />
		{:else}
			<ProjectEditor />
		{/if}
		<DonationFloatingButton />
	</main>
</div>
