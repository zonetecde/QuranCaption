<script lang="ts">
	import Home from '$lib/components/home/Home.svelte';
	import AiVideoPage from '$lib/components/aiVideo/AiVideoPage.svelte';
	import BatchImportPage from '$lib/components/batch/BatchImportPage.svelte';
	import BatchWorkspace from '$lib/components/batch/BatchWorkspace.svelte';

	import ExportService from '$lib/services/ExportService';
	import DonationFloatingButton from '$lib/components/misc/DonationFloatingButton.svelte';
	import DonationProgressBar from '$lib/components/misc/DonationProgressBar.svelte';
	import HomepageMessageBanner from '$lib/components/misc/HomepageMessageBanner.svelte';
	import ProjectEditor from '$lib/components/projectEditor/ProjectEditor.svelte';
	import TitleBar from '$lib/components/TitleBar.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import ShortcutService from '$lib/services/ShortcutService';
	import { discordService } from '$lib/services/DiscordService';
	import { get } from 'svelte/store';
	import LL from '$lib/i18n/i18n-svelte';
	import ModalManager from '$lib/components/modals/ModalManager';
	import { getCurrentWindow, type CloseRequestedEvent } from '@tauri-apps/api/window';
	import { onDestroy, onMount } from 'svelte';
	import toast, { Toaster } from 'svelte-5-french-toast';
	import Settings from '$lib/classes/Settings.svelte';
	import { quranAuthService } from '$lib/services/QuranAuthService.svelte';
	import QuranReflectionPrompt from '$lib/components/reflection/QuranReflectionPrompt.svelte';
	import {
		getHomepageMessage,
		type HomepageMessage
	} from '$lib/services/StylePresetLibraryService';

	let allowWindowClose = false;
	let isHandlingCloseRequest = false;
	let unlistenCloseRequest: (() => void) | undefined;
	let homepageMessage = $state<HomepageMessage | null>(null);
	let homepageMessageLoaded = $state(false);
	let homepageMessageVisible = $state(false);

	async function cancelOngoingExports() {
		const ongoingExports = ExportService.currentlyExportingProjects(true);
		await Promise.all(ongoingExports.map((exportation) => exportation.cancelExport('app_close')));
		await ExportService.saveExports();
	}

	/**
	 * Check si des exports sont en cours
	 * @param event
	 */
	async function handleMainWindowClose(event: CloseRequestedEvent) {
		if (allowWindowClose) return;

		const ongoingExports = ExportService.currentlyExportingProjects(true);
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

	/**
	 * Masque le message courant et mémorise son contenu pour les prochains lancements.
	 *
	 * @returns {Promise<void>}
	 */
	async function dismissHomepageMessage(): Promise<void> {
		homepageMessageVisible = false;
		if (!homepageMessage || !globalState.settings) return;

		globalState.settings.persistentUiState.dismissedHomepageMessageFingerprint =
			homepageMessage.fingerprint;
		try {
			await Settings.save();
		} catch (error) {
			console.error('Failed to persist homepage message dismissal:', error);
			toast.error(get(LL).donation.failedToSavePreference());
		}
	}

	/**
	 * Charge le message d’accueil sans bloquer les autres services de démarrage.
	 *
	 * @returns {Promise<void>}
	 */
	async function loadHomepageMessage(): Promise<void> {
		try {
			const message = await getHomepageMessage();
			const hasContent = Boolean(
				message.enabled && message.title.trim() && message.description.trim()
			);
			homepageMessage = hasContent ? message : null;
			homepageMessageVisible = Boolean(
				hasContent &&
					message.fingerprint !==
						globalState.settings?.persistentUiState.dismissedHomepageMessageFingerprint
			);
		} catch (error) {
			console.error('Failed to load homepage message:', error);
		} finally {
			homepageMessageLoaded = true;
		}
	}

	onMount(async () => {
		// Init le gestionnaire de shortcuts
		ShortcutService.init();

		// Charge les paramètres utilisateur (une seconde fois pour etre sur)
		await Settings.load();
		void loadHomepageMessage();
		await quranAuthService.init();

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
<QuranReflectionPrompt />

<div class="flex flex-col h-screen overflow-hidden">
	<!-- Barre de titre fixe -->
	<TitleBar />

	<!-- Zone de contenu avec scroll -->
	<main class="flex-1 overflow-auto mt-10">
		{#if globalState.currentProject !== null}
			{#key globalState.currentProject.detail.id}
				<ProjectEditor />
			{/key}
		{:else if globalState.currentPage === 'ai-video'}
			<AiVideoPage />
		{:else if globalState.currentPage === 'batch-import'}
			<BatchImportPage />
		{:else if globalState.currentPage === 'batch-workspace'}
			<BatchWorkspace />
		{:else}
			<Home />
		{/if}
		<DonationFloatingButton />
		{#if homepageMessage && homepageMessageVisible}
			<HomepageMessageBanner message={homepageMessage} ondismiss={dismissHomepageMessage} />
		{/if}
		<DonationProgressBar suppressed={!homepageMessageLoaded || homepageMessageVisible} />
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
