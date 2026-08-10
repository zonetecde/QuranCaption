<script lang="ts">
	import type Exportation from '$lib/classes/Exportation.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { invoke } from '@tauri-apps/api/core';
	import { listen, type UnlistenFn } from '@tauri-apps/api/event';
	import { openUrl } from '@tauri-apps/plugin-opener';
	import { open } from '@tauri-apps/plugin-dialog';
	import { get } from 'svelte/store';
	import { onMount } from 'svelte';
	import { slide } from 'svelte/transition';
	import { globalState } from '$lib/runes/main.svelte';
	import { AnalyticsService } from '$lib/services/AnalyticsService';

	type AuthStatus = {
		configured: boolean;
		connected: boolean;
		accountEmail: string | null;
	};

	type UploadProgress = {
		exportId: number;
		progress: number;
		stage: 'preparing' | 'uploading' | 'thumbnail' | 'completed';
	};

	type UploadResult = {
		videoId: string;
		url: string;
		warning?: string;
	};

	type PublicationUpdate = {
		status: 'uploading' | 'published' | 'failed';
		progress: number;
		url?: string;
		error?: string;
	};

	let { exportation, close, onUpdate } = $props<{
		exportation: Exportation;
		close: () => void;
		onUpdate: (update: PublicationUpdate) => void;
	}>();

	let auth = $state<AuthStatus>({ configured: false, connected: false, accountEmail: null });
	let title = $state('');
	let description = $state('');
	let visibility = $state<'public' | 'unlisted' | 'private'>('private');
	let scheduleEnabled = $state(false);
	let scheduleAt = $state('');
	let thumbnailPath = $state('');
	let isConnecting = $state(false);
	let isInsertingChapters = $state(false);
	let isUploading = $state(false);
	let progress = $state(0);
	let stage = $state<UploadProgress['stage']>('preparing');
	let error = $state('');
	let warning = $state('');
	let result = $state<UploadResult | null>(null);

	const canUpload = $derived(
		auth.connected &&
			!isUploading &&
			title.trim().length > 0 &&
			title.trim().length <= 100 &&
			description.length <= 1500 &&
			(!scheduleEnabled || (scheduleAt.length > 0 && new Date(scheduleAt).getTime() > Date.now()))
	);

	/**
	 * Résout un message localisé du moniteur sans dépendre de types i18n générés.
	 * @param {string} key Clé du message.
	 * @returns {string} Texte localisé.
	 */
	function message(key: string): string {
		const translator = Reflect.get(get(LL).exporterMonitor, key) as (() => string) | undefined;
		return translator?.() ?? key;
	}

	/**
	 * Recharge l'état du compte YouTube conservé localement.
	 * @returns {Promise<void>} Résolution après lecture du coffre-fort.
	 */
	async function refreshAuth(): Promise<void> {
		auth = await invoke<AuthStatus>('youtube_auth_status');
	}

	/**
	 * Lance le consentement Google dans le navigateur système.
	 * @returns {Promise<void>} Résolution après connexion ou erreur.
	 */
	async function connect(): Promise<void> {
		isConnecting = true;
		error = '';
		try {
			auth = await invoke<AuthStatus>('youtube_connect');
		} catch (connectError) {
			error = formatError(connectError);
		} finally {
			isConnecting = false;
		}
	}

	/**
	 * Déconnecte le compte YouTube du coffre-fort local.
	 * @returns {Promise<void>} Résolution après suppression des tokens.
	 */
	async function disconnect(): Promise<void> {
		error = '';
		try {
			auth = await invoke<AuthStatus>('youtube_disconnect');
		} catch (disconnectError) {
			error = formatError(disconnectError);
		}
	}

	/**
	 * Sélectionne une miniature YouTube compatible.
	 * @returns {Promise<void>} Résolution après fermeture du sélecteur.
	 */
	async function selectThumbnail(): Promise<void> {
		const selection = await open({
			multiple: false,
			filters: [{ name: message('youtubeThumbnail'), extensions: ['jpg', 'jpeg', 'png'] }]
		});
		if (typeof selection === 'string') thumbnailPath = selection;
	}

	/**
	 * Ajoute les chapitres YouTube du projet source après la description existante.
	 * @returns {Promise<void>} Résolution après génération et insertion des chapitres.
	 */
	async function insertYouTubeChapters(): Promise<void> {
		const sourceProjectId = exportation.sourceProjectId;
		if (isInsertingChapters || sourceProjectId === null) {
			error = message('youtubeChaptersUnavailable');
			return;
		}

		isInsertingChapters = true;
		error = '';
		try {
			const [{ default: Exporter }, { ProjectService }] = await Promise.all([
				import('$lib/classes/Exporter'),
				import('$lib/services/ProjectService')
			]);
			const currentProject = globalState.currentProject;
			const project =
				currentProject && currentProject.detail.id === sourceProjectId
					? currentProject
					: await ProjectService.load(sourceProjectId);
			const exportSettings = project.projectEditorState.export;
			const generated = await Exporter.generateYouTubeChapters(
				project,
				exportSettings.ytbChaptersChoice,
				exportSettings.exportOnlyRecitation
			);
			if (generated.chapterCount === 0) {
				error = message('youtubeChaptersUnavailable');
				return;
			}

			const chapters = generated.content.trim();
			const currentDescription = description.trimEnd();
			description = `${currentDescription}${currentDescription ? '\n\n' : ''}${chapters}`;
		} catch (chapterError) {
			console.error('Unable to insert YouTube chapters:', chapterError);
			error = message('youtubeChaptersInsertFailed');
		} finally {
			isInsertingChapters = false;
		}
	}

	/**
	 * Publie l'export courant avec les métadonnées saisies.
	 * @returns {Promise<void>} Résolution après résultat final.
	 */
	async function upload(): Promise<void> {
		if (!canUpload) return;
		const analyticsProperties = {
			visibility: scheduleEnabled ? 'scheduled_private' : visibility,
			is_scheduled: scheduleEnabled,
			has_thumbnail: thumbnailPath.length > 0
		};
		const analyticsWorkflow = AnalyticsService.trackYouTubeUploadStarted(analyticsProperties);
		isUploading = true;
		progress = 0;
		stage = 'preparing';
		error = '';
		warning = '';
		result = null;
		onUpdate({ status: 'uploading', progress: 0 });
		try {
			const uploaded = await invoke<UploadResult>('youtube_upload_video', {
				request: {
					exportId: exportation.exportId,
					filePath: exportation.finalFilePath,
					title: title.trim(),
					description,
					privacyStatus: scheduleEnabled ? 'private' : visibility,
					publishAt: scheduleEnabled ? new Date(scheduleAt).toISOString() : null,
					thumbnailPath: thumbnailPath || null,
					madeForKids: false
				}
			});
			result = uploaded;
			progress = 100;
			warning = uploaded.warning ?? '';
			onUpdate({
				status: 'published',
				progress: 100,
				url: uploaded.url,
				error: uploaded.warning
			});
			AnalyticsService.trackYouTubeUploadFinished(
				analyticsWorkflow,
				uploaded.warning ? 'partial' : 'completed',
				{
					...analyticsProperties,
					failure_stage: uploaded.warning ? 'thumbnail' : undefined,
					has_warning: Boolean(uploaded.warning)
				}
			);
		} catch (uploadError) {
			AnalyticsService.trackYouTubeUploadFinished(analyticsWorkflow, 'failed', {
				...analyticsProperties,
				failure_stage: stage
			});
			error = formatError(uploadError);
			onUpdate({ status: 'failed', progress, error });
		} finally {
			isUploading = false;
		}
	}

	/**
	 * Traduit les codes stables puis conserve les erreurs détaillées inattendues.
	 * @param {unknown} value Erreur IPC brute.
	 * @returns {string} Erreur affichable.
	 */
	function formatError(value: unknown): string {
		const raw = String(value).replace(/^Error:\s*/, '');
		const known: Record<string, string> = {
			YOUTUBE_OAUTH_NOT_CONFIGURED: 'youtubeNotConfigured',
			YOUTUBE_NOT_CONNECTED: 'youtubeNotConnected',
			YOUTUBE_OAUTH_TIMEOUT: 'youtubeOAuthTimeout',
			YOUTUBE_INVALID_TITLE: 'youtubeInvalidTitle',
			YOUTUBE_INVALID_DESCRIPTION: 'youtubeInvalidDescription',
			YOUTUBE_INVALID_VISIBILITY: 'youtubeInvalidVisibility',
			YOUTUBE_SCHEDULE_REQUIRES_PRIVATE: 'youtubeScheduleRequiresPrivate',
			YOUTUBE_VIDEO_NOT_FOUND: 'youtubeVideoNotFound',
			YOUTUBE_THUMBNAIL_NOT_FOUND: 'youtubeThumbnailNotFound',
			YOUTUBE_THUMBNAIL_TOO_LARGE: 'youtubeThumbnailTooLarge',
			YOUTUBE_INVALID_THUMBNAIL: 'youtubeInvalidThumbnail'
		};
		return known[raw] ? message(known[raw]) : raw;
	}

	onMount(() => {
		let unlisten: UnlistenFn | null = null;
		const defaults = globalState.settings?.defaultValuesSettings;
		title = defaults?.youtubeVideoTitle.trim() || exportation.finalFileName.replace(/\.[^.]+$/, '');
		description = defaults?.youtubeVideoDescription ?? '';
		void listen<UploadProgress>('youtube-upload-progress', ({ payload }) => {
			if (payload.exportId !== exportation.exportId) return;
			progress = payload.progress;
			stage = payload.stage;
			onUpdate({ status: 'uploading', progress });
		}).then((stop) => (unlisten = stop));
		void refreshAuth().catch((authError) => (error = formatError(authError)));
		return () => unlisten?.();
	});
</script>

<div
	class="border-color bg-secondary relative flex max-h-[90vh] w-[680px] max-w-full flex-col overflow-hidden rounded-2xl border shadow-2xl shadow-black"
	transition:slide
	role="dialog"
	aria-modal="true"
	aria-labelledby="youtube-upload-title"
>
	<div class="border-color from-accent to-bg-accent shrink-0 border-b bg-gradient-to-r px-6 py-4">
		<div class="flex items-center justify-between gap-4">
			<div class="flex min-w-0 items-center gap-3">
				<div
					class="bg-accent-primary flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
				>
					<span class="material-icons text-xl text-black">smart_display</span>
				</div>
				<div class="min-w-0">
					<h2 id="youtube-upload-title" class="text-primary text-xl font-bold">
						{message('youtubePublish')}
					</h2>
					<p class="text-thirdly truncate text-sm">{exportation.finalFileName}</p>
				</div>
			</div>
			<button
				type="button"
				class="text-secondary hover:text-primary flex h-8 w-8 cursor-pointer items-center justify-center rounded-full transition-all duration-200 hover:bg-[rgba(255,255,255,0.1)] disabled:opacity-40"
				disabled={isUploading || isConnecting}
				aria-label={message('youtubeClose')}
				onclick={close}
			>
				<span class="material-icons text-lg">close</span>
			</button>
		</div>
	</div>

	<div class="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-5">
		<div class="border-color bg-accent rounded-xl border p-4">
			{#if auth.connected}
				<div class="flex items-center justify-between gap-3">
					<div class="flex min-w-0 items-center gap-3">
						<div
							class="bg-accent-primary/15 flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
						>
							<span class="material-icons text-accent-primary text-lg">account_circle</span>
						</div>
						<div class="min-w-0">
							<p class="text-primary text-sm font-medium">
								{message('youtubeConnectedAccount')}
							</p>
							<p class="text-thirdly truncate text-xs">{auth.accountEmail}</p>
						</div>
					</div>
					<button
						type="button"
						class="btn px-3 py-1.5 text-sm"
						disabled={isUploading}
						onclick={disconnect}>{message('youtubeDisconnect')}</button
					>
				</div>
			{:else}
				<button
					type="button"
					class="btn-accent flex w-full items-center justify-center gap-2 px-4 py-2.5 font-medium disabled:cursor-not-allowed disabled:opacity-50"
					disabled={isConnecting || !auth.configured}
					onclick={connect}
				>
					<span class="material-icons text-lg">account_circle</span>
					{isConnecting ? message('youtubeConnecting') : message('youtubeConnect')}
				</button>
				{#if !auth.configured}
					<p class="text-danger-color mt-2 text-xs">{message('youtubeNotConfigured')}</p>
				{/if}
			{/if}
		</div>

		<label class="block space-y-2">
			<span class="text-thirdly text-xs font-medium uppercase">{message('youtubeTitle')}</span>
			<input
				class="border-color bg-accent text-primary focus:border-accent-primary w-full rounded-lg border px-3 py-2.5 text-sm outline-none transition-colors"
				maxlength="100"
				bind:value={title}
				disabled={isUploading}
			/>
			<span class="text-thirdly block text-right text-xs">{title.length}/100</span>
		</label>

		<div class="block space-y-2">
			<div class="flex items-center justify-between gap-3">
				<label for="youtube-upload-description" class="text-thirdly text-xs font-medium uppercase">
					{message('youtubeDescription')}
				</label>
				<button
					type="button"
					class="text-accent-secondary hover:text-primary flex items-center gap-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50"
					disabled={isUploading || isInsertingChapters}
					onclick={insertYouTubeChapters}
				>
					<span class="material-icons text-sm">playlist_add</span>
					{isInsertingChapters
						? message('youtubeInsertingChapters')
						: message('youtubeInsertChapters')}
				</button>
			</div>
			<textarea
				id="youtube-upload-description"
				class="bg-accent text-primary min-h-40! w-full resize-y rounded-lg border px-3 py-2.5 text-sm outline-none transition-colors
				{description.length > 1500 ? 'border-danger-color' : 'border-color focus:border-accent-primary'}"
				maxlength="5000"
				bind:value={description}
				disabled={isUploading}
			></textarea>
			<span
				class="block text-right text-xs {description.length > 1500
					? 'text-danger-color'
					: 'text-thirdly'}"
			>
				{description.length}/1500
			</span>
		</div>

		<div class="grid gap-4 sm:grid-cols-2">
			<label class="block space-y-2">
				<span class="text-thirdly text-xs font-medium uppercase">
					{message('youtubeVisibility')}
				</span>
				<select
					class="border-color bg-accent text-primary focus:border-accent-primary w-full rounded-lg border px-3 py-2.5 text-sm outline-none transition-colors"
					bind:value={visibility}
					disabled={isUploading || scheduleEnabled}
				>
					<option value="private">{message('youtubePrivate')}</option>
					<option value="unlisted">{message('youtubeUnlisted')}</option>
					<option value="public">{message('youtubePublic')}</option>
				</select>
			</label>

			<div class="space-y-2">
				<span class="text-thirdly block text-xs font-medium uppercase">
					{message('youtubeSchedule')}
				</span>
				<label
					class="border-color bg-accent text-secondary flex min-h-10 items-center gap-3 rounded-lg border px-3 py-2 text-sm"
				>
					<input
						class="accent-accent-primary"
						type="checkbox"
						bind:checked={scheduleEnabled}
						disabled={isUploading}
					/>
					<span>{message('youtubeSchedule')}</span>
				</label>
			</div>
		</div>

		{#if scheduleEnabled}
			<input
				type="datetime-local"
				class="border-color bg-accent text-primary focus:border-accent-primary w-full rounded-lg border px-3 py-2.5 text-sm outline-none transition-colors"
				bind:value={scheduleAt}
				disabled={isUploading}
			/>
		{/if}

		<div class="space-y-2">
			<p class="text-thirdly text-xs font-medium uppercase">{message('youtubeThumbnail')}</p>
			<div class="flex gap-3">
				<input
					class="border-color bg-accent text-primary min-w-0 flex-1 truncate rounded-lg border px-3 py-2.5 text-sm"
					value={thumbnailPath}
					readonly
					placeholder={message('youtubeThumbnailOptional')}
				/>
				<button
					type="button"
					class="btn px-4 py-2 text-sm"
					disabled={isUploading}
					onclick={selectThumbnail}>{message('youtubeBrowse')}</button
				>
			</div>
		</div>

		{#if isUploading}
			<div class="border-color bg-accent/50 space-y-3 rounded-xl border p-4">
				<div class="flex justify-between gap-3 text-xs">
					<span class="text-secondary">
						{message(`youtubeStage${stage[0].toUpperCase()}${stage.slice(1)}`)}
					</span>
					<span class="text-primary font-semibold">{progress}%</span>
				</div>
				<div class="bg-secondary h-2 overflow-hidden rounded-full">
					<div
						class="bg-accent-primary h-full rounded-full transition-all duration-300"
						style:width={`${progress}%`}
					></div>
				</div>
			</div>
		{/if}

		{#if error}
			<p
				class="border-danger-color bg-danger-color/10 text-danger-color rounded-xl border px-4 py-3 text-sm"
			>
				{error}
			</p>
		{/if}
		{#if warning}
			<p
				class="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-400"
			>
				{warning}
			</p>
		{/if}
		{#if result}
			<button
				type="button"
				class="btn flex w-full items-center justify-center gap-2 px-4 py-3 text-sm"
				onclick={() => openUrl(result!.url)}
			>
				<span class="material-icons text-lg">open_in_new</span>
				{message('youtubeOpenVideo')}
			</button>
		{/if}
	</div>

	<div class="border-color bg-primary flex shrink-0 justify-end gap-3 border-t px-6 py-4">
		<button
			type="button"
			class="btn px-5 py-2 text-sm"
			disabled={isUploading || isConnecting}
			onclick={close}>{result ? message('youtubeClose') : message('youtubeCancel')}</button
		>
		{#if !result}
			<button
				type="button"
				class="btn-accent flex items-center gap-2 px-5 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
				disabled={!canUpload}
				onclick={upload}
			>
				<span class="material-icons text-base">upload</span>
				{message('youtubeUpload')}
			</button>
		{/if}
	</div>
</div>
