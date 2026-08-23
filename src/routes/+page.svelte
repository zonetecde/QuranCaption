<script lang="ts">
	import Home from '$lib/components/home/Home.svelte';
	import AiVideoPage from '$lib/components/aiVideo/AiVideoPage.svelte';

	import ExportService, {
		applyExportLog,
		applyExportProgress,
		type ExportLogPayload,
		type ExportProgress
	} from '$lib/services/ExportService';
	import DonationFloatingButton from '$lib/components/misc/DonationFloatingButton.svelte';
	import DonationProgressBar from '$lib/components/misc/DonationProgressBar.svelte';
	import HomepageMessageBanner from '$lib/components/misc/HomepageMessageBanner.svelte';
	import ProjectEditor from '$lib/components/projectEditor/ProjectEditor.svelte';
	import TitleBar from '$lib/components/TitleBar.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { get } from 'svelte/store';
	import LL from '$lib/i18n/i18n-svelte';
	import ModalManager from '$lib/components/modals/ModalManager';
	import { getCurrentWindow, type CloseRequestedEvent } from '@tauri-apps/api/window';
	import { onDestroy, onMount } from 'svelte';
	import toast, { Toaster } from 'svelte-5-french-toast';
	import Settings from '$lib/classes/Settings.svelte';
	import { quranAuthService } from '$lib/services/QuranAuthService.svelte';
	import { listen } from '@tauri-apps/api/event';
	import { invoke, type InvokeArgs, type InvokeOptions } from '@tauri-apps/api/core';
	import QuranReflectionPrompt from '$lib/components/reflection/QuranReflectionPrompt.svelte';
	import {
		getHomepageMessage,
		type HomepageMessage
	} from '$lib/services/StylePresetLibraryService';

	let allowWindowClose = false;
	let isHandlingCloseRequest = false;
	let unlistenCloseRequest: (() => void) | undefined;
	let unlistenRendererFinished: (() => void) | undefined;
	let unlistenExportNativeEvents: Array<() => void> = [];
	let exportRenderer = $state<HTMLIFrameElement | undefined>(undefined);
	let captureRendererExportId = $state<string | null>(null);
	let captureRendererIds = $state<number[]>([]);
	let captureRendererElements = $state<Array<HTMLIFrameElement | undefined>>([]);

	/**
	 * Retourne l'identifiant du renderer de capture correspondant à une source de message.
	 * @param {MessageEventSource | null} source Source du message reçu.
	 * @returns {number | null} Identifiant du worker, ou null si la source est inconnue.
	 */
	function getCaptureRendererWorkerId(source: MessageEventSource | null): number | null {
		for (let workerId = 0; workerId < captureRendererElements.length; workerId++) {
			if (source === captureRendererElements[workerId]?.contentWindow) return workerId;
		}
		return null;
	}

	/**
	 * Démonte tous les renderers de capture de l'export courant.
	 * @returns {void}
	 */
	function clearCaptureRenderers(): void {
		captureRendererExportId = null;
		captureRendererIds = [];
		captureRendererElements = [];
	}

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

	/**
	 * Termine localement un renderer si le pont événementiel Tauri est indisponible.
	 * @param {MessageEvent} event Message émis par l'iframe d'export courante.
	 * @returns {void}
	 */
	function handleExportRendererMessage(event: MessageEvent): void {
		const isCoordinator = event.source === exportRenderer?.contentWindow;
		const sourceWorkerId = getCaptureRendererWorkerId(event.source);
		if (!isCoordinator && sourceWorkerId === null) return;
		const data = event.data as
			| { type?: 'export-renderer-finished-main'; exportId?: string }
			| { type?: 'export-renderer-progress-main'; payload?: ExportProgress }
			| { type?: 'export-renderer-log-main'; payload?: ExportLogPayload }
			| {
					type?: 'export-renderer-workers-create-main';
					exportId?: string;
					count?: number;
			  }
			| { type?: 'export-renderer-workers-close-main'; exportId?: string }
			| {
					type?: 'export-renderer-worker-event-main';
					exportId?: string;
					workerId?: number;
					eventName?: string;
					payload?: unknown;
			  }
			| {
					type?: 'export-renderer-worker-command-main';
					exportId?: string;
					workerId?: number;
					eventName?: string;
					payload?: unknown;
			  }
			| {
					type?: 'export-renderer-invoke-main';
					requestId?: string;
					exportId?: string;
					command?: string;
					args?: InvokeArgs;
					options?: InvokeOptions;
			  }
			| null;

		if (
			data?.type === 'export-renderer-invoke-main' &&
			data.requestId &&
			data.command &&
			event.source
		) {
			const source = event.source as WindowProxy;
			const startedAt = performance.now();
			const diagnosticExportId = Number(data.exportId);
			const diagnosticSource =
				sourceWorkerId === null
					? 'android-ipc-parent'
					: `android-ipc-parent-worker-${sourceWorkerId}`;
			void invoke(data.command, data.args, data.options).then(
				(result) => {
					source.postMessage(
						{
							type: 'export-renderer-invoke-result-main',
							requestId: data.requestId,
							result
						},
						'*'
					);
				},
				(error) => {
					if (Number.isFinite(diagnosticExportId)) {
						applyExportLog({
							exportId: diagnosticExportId,
							timestamp: new Date().toISOString(),
							source: diagnosticSource,
							level: 'error',
							message: `IPC ✗ ${data.command} ${Math.round(performance.now() - startedAt)}ms error=${error instanceof Error ? error.message : String(error)}`
						});
					}
					source.postMessage(
						{
							type: 'export-renderer-invoke-result-main',
							requestId: data.requestId,
							error: error instanceof Error ? error.message : String(error)
						},
						'*'
					);
				}
			);
			return;
		}
		if (data?.type === 'export-renderer-progress-main' && data.payload && isCoordinator) {
			applyExportProgress(data.payload);
			return;
		}
		if (data?.type === 'export-renderer-log-main' && data.payload) {
			applyExportLog(data.payload);
			return;
		}
		if (
			data?.type === 'export-renderer-workers-create-main' &&
			isCoordinator &&
			data.exportId === globalState.uiState.activeExportId
		) {
			const count = Math.max(1, Math.min(4, Math.round(data.count ?? 1)));
			captureRendererExportId = data.exportId;
			captureRendererIds = Array.from({ length: count }, (_, workerId) => workerId);
			return;
		}
		if (
			data?.type === 'export-renderer-workers-close-main' &&
			isCoordinator &&
			data.exportId === captureRendererExportId
		) {
			clearCaptureRenderers();
			return;
		}
		if (
			data?.type === 'export-renderer-worker-event-main' &&
			sourceWorkerId !== null &&
			data.exportId === globalState.uiState.activeExportId &&
			data.workerId === sourceWorkerId &&
			data.eventName
		) {
			exportRenderer?.contentWindow?.postMessage(
				{
					type: 'export-renderer-worker-event-renderer',
					eventName: data.eventName,
					payload: data.payload
				},
				'*'
			);
			return;
		}
		if (
			data?.type === 'export-renderer-worker-command-main' &&
			isCoordinator &&
			data.exportId === captureRendererExportId &&
			typeof data.workerId === 'number' &&
			data.eventName
		) {
			captureRendererElements[data.workerId]?.contentWindow?.postMessage(
				{
					type: 'export-renderer-worker-command-renderer',
					eventName: data.eventName,
					payload: data.payload
				},
				'*'
			);
			return;
		}
		if (
			data?.type === 'export-renderer-finished-main' &&
			isCoordinator &&
			data.exportId === globalState.uiState.activeExportId
		) {
			clearCaptureRenderers();
			globalState.uiState.activeExportId = null;
		}
	}
	let homepageMessage = $state<HomepageMessage | null>(null);
	let homepageMessageLoaded = $state(false);
	let homepageMessageVisible = $state(false);

	async function cancelOngoingExports() {
		const ongoingExports = ExportService.currentlyExportingProjects();
		await Promise.all(ongoingExports.map((exportation) => exportation.cancelExport('app_close')));
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
		window.addEventListener('message', handleExportRendererMessage);

		return () => {
			window.removeEventListener('resize', syncAndroidViewport);
			window.removeEventListener('message', handleExportRendererMessage);
		};
	});

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
		ExportService.setupListener();
		unlistenRendererFinished = await listen<{ exportId: string }>(
			'export-renderer-finished-main',
			(event) => {
				if (globalState.uiState.activeExportId === event.payload.exportId) {
					clearCaptureRenderers();
					globalState.uiState.activeExportId = null;
				}
			}
		);
		for (const eventName of [
			'export-progress',
			'export-complete',
			'export-error',
			'cancel-export-renderer'
		]) {
			unlistenExportNativeEvents.push(
				await listen(eventName, (event) => {
					const message = {
						type: 'export-renderer-native-event-main',
						eventName,
						payload: event.payload
					};
					exportRenderer?.contentWindow?.postMessage(message, '*');
					if (eventName === 'cancel-export-renderer') {
						for (const renderer of captureRendererElements) {
							renderer?.contentWindow?.postMessage(message, '*');
						}
					}
				})
			);
		}

		// Charge les paramètres utilisateur (une seconde fois pour etre sur)
		await Settings.load();
		void loadHomepageMessage();
		await quranAuthService.init();

		unlistenCloseRequest = await getCurrentWindow().onCloseRequested(handleMainWindowClose);
	});

	onDestroy(() => {
		unlistenCloseRequest?.();
		unlistenRendererFinished?.();
		for (const unlisten of unlistenExportNativeEvents) unlisten();
		unlistenExportNativeEvents = [];
	});
</script>

<Toaster />
<QuranReflectionPrompt />

<div class="flex h-[100dvh] flex-col overflow-hidden">
	<TitleBar />
	<main
		class={`flex-1 overflow-auto ${
			globalState.currentProject === null && globalState.currentPage === 'home'
				? 'home-scroll-host'
				: ''
		}`}
	>
		{#if globalState.currentProject !== null}
			{#key globalState.currentProject.detail.id}
				<ProjectEditor />
			{/key}
		{:else if globalState.currentPage === 'ai-video'}
			<AiVideoPage />
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

	{#if globalState.uiState.activeExportId}
		<iframe
			bind:this={exportRenderer}
			class="export-renderer"
			src={`/exporter?${new URLSearchParams({
				id: globalState.uiState.activeExportId,
				embedded: '1',
				workers: String(globalState.settings?.exportSettings.parallelCaptureWorkers ?? 1)
			})}`}
			title={$LL.export.exportVideo()}
			aria-hidden="true"
			tabindex="-1"
		></iframe>
		{#if captureRendererExportId === globalState.uiState.activeExportId}
			{#each captureRendererIds as workerId (workerId)}
				<iframe
					bind:this={captureRendererElements[workerId]}
					class="export-renderer"
					src={`/exporter?${new URLSearchParams({
						id: globalState.uiState.activeExportId,
						embedded: '1',
						mode: 'capture-worker',
						worker: String(workerId)
					})}`}
					title={`${$LL.export.parallelCaptureWorkers()} ${workerId + 1}`}
					aria-hidden="true"
					tabindex="-1"
				></iframe>
			{/each}
		{/if}
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

	.export-renderer {
		position: fixed;
		top: 0;
		left: -12000px;
		width: 1920px;
		height: 1080px;
		border: 0;
		pointer-events: none;
	}
</style>
