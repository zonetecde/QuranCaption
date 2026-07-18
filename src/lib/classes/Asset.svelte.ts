import { invoke } from '@tauri-apps/api/core';
import { AssetType, SourceType, TrackType } from './enums.js';
import { SerializableBase } from './misc/SerializableBase.js';
import { Utilities } from './misc/Utilities.js';
import { openPath } from '@tauri-apps/plugin-opener';
import { exists } from '@tauri-apps/plugin-fs';
import { globalState } from '$lib/runes/main.svelte.js';
import LL from '$lib/i18n/i18n-svelte';
import { get } from 'svelte/store';
import { Duration } from './index.js';
import toast from 'svelte-5-french-toast';
import ModalManager from '$lib/components/modals/ModalManager.js';
import { WaveformService } from '$lib/services/WaveformService.svelte.js';
import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager.js';
import type { UnknownRecord } from '$lib/types/common.js';
import type { Project } from './Project.js';
import type { AssetTrack } from './Track.svelte.js';

type DurationLoadState = 'idle' | 'loading' | 'success' | 'error';

export class Asset extends SerializableBase {
	id: number = $state(0);
	fileName: string = $state('');
	filePath: string = $state('');
	type: AssetType = $state(AssetType.Unknown);
	duration: Duration = $state(new Duration(0));
	exists: boolean = $state(true);
	sourceUrl?: string = $state(undefined);
	sourceType: SourceType = $state(SourceType.Local);
	metadata: UnknownRecord = $state({});
	durationLoadState: DurationLoadState = $state('idle');
	durationLoadError: string | null = $state(null);
	mediaReloadToken: number = $state(0);

	/** Promesse résolue quand la durée est chargée (null si pas de chargement nécessaire). */
	private durationPromise: Promise<void> | null = null;

	constructor(
		filePath: string = '',
		sourceUrl?: string,
		sourceType: SourceType = SourceType.Local,
		metadata: UnknownRecord = {}
	) {
		super();

		// Si l'arg est undefined (cas de désérialisation)
		if (!filePath) {
			return;
		}

		this.id = Utilities.randomId();
		this.exists = true;

		this.filePath = this.normalizeFilePath(filePath);

		if (sourceUrl) {
			this.sourceUrl = sourceUrl;
			this.sourceType = sourceType;
		} else {
			this.sourceType = SourceType.Local;
		}

		this.metadata = metadata;

		const fileName = this.getFileName(this.filePath);

		this.fileName = fileName;

		const extension = this.getFileExtension();
		this.type = this.getAssetType(extension);

		this.duration = new Duration(0);

		if (this.type === AssetType.Audio || this.type === AssetType.Video) {
			this.durationPromise = this.initializeDuration();
		}
	}

	/**
	 * Attend que la durée du media soit chargée (nécessaire avant d'ajouter à la timeline).
	 * @returns {Promise<void>}
	 */
	async ensureDurationLoaded(): Promise<void> {
		if (this.durationPromise) {
			await this.durationPromise;
		}
	}

	/**
	 * Ajoute l'asset à la timeline.
	 * @param {boolean} asVideo Ajouter en tant que piste vidéo.
	 * @param {boolean} asAudio Ajouter en tant que piste audio.
	 * @param {boolean} skipDimensionPrompt Si true, ne demande pas la confirmation pour adapter les dimensions.
	 * @returns {Promise<void>}
	 */
	async addToTimeline(asVideo: boolean, asAudio: boolean, skipDimensionPrompt = false) {
		let wasAddedToVideo = false;
		if (asVideo) wasAddedToVideo = globalState.getVideoTrack.addAsset(this);
		if (asAudio) globalState.getAudioTrack.addAsset(this);

		if (asVideo && wasAddedToVideo && this.type === AssetType.Video) {
			// Demande à l'utilisateur s'il veut que le format de les dimensions de la vidéo soient appliquées au projet
			// Récupère les dimensions de la vidéo
			const assetDimensions = (await invoke('get_video_dimensions', {
				filePath: this.filePath
			})) as {
				width: number;
				height: number;
			};
			// Si les dimensions sont invalides, on ne fait rien
			if (assetDimensions.width <= 0 || assetDimensions.height <= 0) {
				return;
			}
			// Si les dimensions sont déjà les mêmes, on ne fait rien non plus
			const currentProjectDimensions = globalState.getStyle('global', 'video-dimension').value as {
				width: number;
				height: number;
			};
			if (
				assetDimensions.width === currentProjectDimensions.width &&
				assetDimensions.height === currentProjectDimensions.height
			) {
				return;
			}

			if (skipDimensionPrompt) {
				// Applique automatiquement les dimensions sans demander confirmation
				if (assetDimensions.width > 0 && assetDimensions.height > 0) {
					globalState.getStyle('global', 'video-dimension').value = {
						width: assetDimensions.width,
						height: assetDimensions.height
					};
				}
				return;
			}
			if (globalState.currentProject!.projectEditorState.hasAnsweredVideoDimensionPrompt) {
				return;
			}

			// Demande confirmation à l'utilisateur
			const confirm = await ModalManager.confirmModal(
				get(LL).editor.setDimensionsMatchVideo({
					width: String(assetDimensions.width),
					height: String(assetDimensions.height)
				}),
				true
			);

			ProjectHistoryManager.track(
				confirm ? 'set video dimensions from asset' : 'dismiss video dimensions prompt',
				() => {
					globalState.currentProject!.projectEditorState.hasAnsweredVideoDimensionPrompt = true;
					if (!confirm) return;
					if (assetDimensions.width > 0 && assetDimensions.height > 0) {
						globalState.getStyle('global', 'video-dimension').value = {
							width: assetDimensions.width,
							height: assetDimensions.height
						};
					}
				}
			);
		}
	}

	/**
	 * Ajoute l'asset aux pistes d'un projet explicite sans historique ni effet d'interface.
	 * @param {Project} project Projet à modifier en arrière-plan.
	 * @param {boolean} asVideo Ajouter sur la piste vidéo.
	 * @param {boolean} asAudio Ajouter sur la piste audio.
	 * @returns {Promise<void>} Promesse résolue après l'ajout et l'adaptation des dimensions.
	 */
	async addToProjectTimeline(project: Project, asVideo: boolean, asAudio: boolean): Promise<void> {
		const timeline = project.content.timeline;
		const videoTrack = timeline.getFirstTrack(TrackType.Video) as AssetTrack;
		const audioTrack = timeline.getFirstTrack(TrackType.Audio) as AssetTrack;
		if (asVideo && videoTrack.addAssetHeadless(this) !== 'added') {
			const message = Reflect.get(get(LL).batch, 'errorVideoTrack') as () => string;
			throw new Error(message());
		}
		if (asAudio && audioTrack.addAssetHeadless(this) !== 'added') {
			const message = Reflect.get(get(LL).batch, 'errorAudioTrack') as () => string;
			throw new Error(message());
		}

		if (!asVideo || this.type !== AssetType.Video) return;
		const dimensions = (await invoke('get_video_dimensions', {
			filePath: this.filePath
		})) as { width: number; height: number };
		if (dimensions.width <= 0 || dimensions.height <= 0) return;
		const dimensionStyle = project.content.videoStyle
			.getStylesOfTarget('global')
			.findStyle('video-dimension');
		if (dimensionStyle) {
			dimensionStyle.value = { width: dimensions.width, height: dimensions.height };
		}
	}

	private normalizeFilePath(filePath: string): string {
		// Nettoie le chemin en supprimant les doubles slashes et normalise les séparateurs
		let normalized = filePath.replace(/\\/g, '/');

		// Supprime les doubles slashes sauf pour les protocoles (://)
		normalized = normalized.replace(/\/+/g, '/');

		// Gère le cas spécial des chemins UNC Windows (\\server\share -> //server/share)
		if (filePath.startsWith('\\\\')) {
			normalized = '//' + normalized.substring(1);
		}

		return normalized;
	}

	private async initializeDuration() {
		this.durationLoadState = 'loading';
		this.durationLoadError = null;

		try {
			const durationMs = (await invoke('get_duration', {
				filePath: this.filePath
			})) as number;

			this.duration = new Duration(durationMs);
			this.durationLoadState = 'success';
			await this.warnIfNotConstantBitrate();
			await this.checkAudioTimestampStretch();

			if (durationMs === -1) {
				this.duration = new Duration(0);
				this.exists = false;
			}
		} catch (error) {
			this.duration = new Duration(0);
			this.durationLoadState = 'error';

			const ffprobeError = this.parseFfprobeError(error);
			if (ffprobeError) {
				const message = this.getFfmpegErrorMessage(ffprobeError.code, ffprobeError.details);
				this.durationLoadError = message;
				if (this.metadata.suppressUiEffects !== true) {
					await this.showMissingFfmpegModal(message);
				}
			} else {
				this.durationLoadError = 'Unable to retrieve media duration. Please check the logs.';
				console.error('Unable to retrieve media duration', error);
			}
		}
	}

	/**
	 * Checks bitrate mode and shows a guidance toast when media is not constant bitrate.
	 * @returns A promise that resolves when the check completes.
	 */
	private async warnIfNotConstantBitrate(): Promise<void> {
		if (this.type !== AssetType.Audio && this.type !== AssetType.Video) return;
		if (this.metadata.skipConstantBitrateWarning === true) return;

		try {
			const isConstant = (await invoke('is_constant_bitrate', {
				filePath: this.filePath
			})) as boolean;
			if (isConstant) return;

			toast(get(LL).editor.variableBitrateWarning(), { duration: 18000, position: 'bottom-left' });
		} catch (error) {
			console.warn('Unable to detect bitrate mode for asset:', error);
		}
	}

	/**
	 * Détecte un éventuel "étirement" des timestamps audio (PTS plus longs que le
	 * contenu réel décodé) et mémorise le résultat dans les métadonnées, afin que
	 * l'auto-segmentation puisse re-timer l'audio plus tard — y compris dans une
	 * session ultérieure. Silencieux : aucune action n'est prise ici, le re-timing
	 * a lieu au moment d'une auto-segmentation.
	 * @returns {Promise<void>}
	 */
	private async checkAudioTimestampStretch(): Promise<void> {
		if (this.type !== AssetType.Audio && this.type !== AssetType.Video) return;
		// Déjà corrigé, ou déjà détecté précédemment : rien à refaire.
		if (this.metadata.audioRetimeDone === true) return;
		if (typeof this.metadata.audioRetimeNeeded === 'boolean') return;

		try {
			const stretchMs = (await invoke('audio_timestamp_stretch_ms', {
				filePath: this.filePath
			})) as number;
			// ~500ms d'écart cumulé avant de considérer la dérive comme perceptible.
			this.metadata.audioRetimeNeeded = stretchMs > 500;
		} catch (error) {
			console.warn('Unable to detect audio timestamp stretch for asset:', error);
		}
	}

	async checkExistence() {
		if (!(await exists(this.filePath))) {
			this.exists = false;
		}
	}

	async openParentDirectory() {
		let parentDir = this.getParentDirectory();
		const userAgent = navigator?.userAgent?.toLowerCase() ?? '';
		// Windows Explorer handles paths with forward slashes incorrectly when opening a directory via the opener plugin.
		// It often defaults to the Documents folder or times out.
		// We force backslashes for Windows to ensure the correct directory opens immediately.
		if (userAgent.includes('win')) {
			parentDir = parentDir.replace(/\//g, '\\');
		}
		await openPath(parentDir);
	}

	getFileNameWithoutExtension(): string {
		const filenames = this.fileName.split('.');
		if (filenames.length > 1) {
			return filenames.slice(0, -1).join('.');
		}
		return this.fileName;
	}

	getParentDirectory(): string {
		// Normalise le chemin d'abord
		const normalized = this.normalizeFilePath(this.filePath);

		// Trouve le dernier séparateur
		const lastSeparatorIndex = normalized.lastIndexOf('/');

		if (lastSeparatorIndex === -1) {
			// Pas de séparateur trouvé, retourne le répertoire courant
			return '.';
		}

		// Cas spécial pour les chemins racine
		if (lastSeparatorIndex === 0) {
			// Chemin Unix/Linux racine (ex: /file.txt -> /)
			return '/';
		}

		// Cas spécial pour les chemins Windows avec lettre de lecteur
		if (lastSeparatorIndex === 2 && normalized.charAt(1) === ':') {
			// Chemin Windows racine (ex: C:/file.txt -> C:/)
			return normalized.substring(0, 3);
		}

		// Cas spécial pour les chemins UNC
		if (normalized.startsWith('//')) {
			const parts = normalized.split('/');
			if (parts.length <= 4) {
				// Chemin UNC racine (ex: //server/share/file.txt -> //server/share)
				return parts.slice(0, 4).join('/');
			}
		}

		// Cas général.
		return normalized.substring(0, lastSeparatorIndex);
	}

	updateFilePath(element: string) {
		const oldPath = this.filePath;
		this.filePath = this.normalizeFilePath(element);
		WaveformService.clearCache(oldPath);
		this.exists = true;
		this.reloadMedia();
	}

	/**
	 * Force les lecteurs et caches à oublier le fichier média courant.
	 * @returns {void}
	 */
	reloadMedia() {
		WaveformService.clearCache(this.filePath);
		this.mediaReloadToken++;
		delete this.metadata.audioRetimeNeeded;
		delete this.metadata.audioRetimeDone;
		if (this.type === AssetType.Audio || this.type === AssetType.Video) {
			this.duration = new Duration(0);
			this.durationLoadState = 'idle';
			this.durationLoadError = null;
			this.durationPromise = this.initializeDuration();
		}
	}

	private getFileName(filePath: string): string {
		const normalized = this.normalizeFilePath(filePath);
		const parts = normalized.split('/');

		if (parts.length > 0) {
			return parts[parts.length - 1];
		}
		return '';
	}

	getFileExtension(): string {
		const parts = this.fileName.split('.');
		if (parts.length > 1) {
			return parts[parts.length - 1].toLowerCase();
		}
		return '';
	}

	getAssetType(extension: string): AssetType {
		switch (extension) {
			case 'mp4':
			case 'avi':
			case 'mov':
			case 'mkv':
			case 'flv':
			case 'webm':
				return AssetType.Video;
			case 'mp3':
			case 'aac':
			case 'ogg':
			case 'flac':
			case 'm4a':
			case 'opus':
			case 'wav':
				return AssetType.Audio;
			case 'png':
			case 'jpg':
			case 'jpeg':
			case 'gif':
			case 'bmp':
			case 'webp':
				return AssetType.Image;
			default:
				return AssetType.Unknown;
		}
	}

	isDurationLoading(): boolean {
		return this.durationLoadState === 'loading';
	}

	hasDurationLoadError(): boolean {
		return this.durationLoadState === 'error';
	}

	getDurationLoadErrorMessage(): string | null {
		return this.durationLoadError;
	}

	private extractErrorMessage(error: unknown): string {
		if (typeof error === 'string') {
			return error;
		}

		if (error && typeof error === 'object' && 'message' in error) {
			const maybeError = error as { message?: unknown };
			if (typeof maybeError.message === 'string') {
				return maybeError.message;
			}
		}

		return String(error ?? '');
	}

	/**
	 * Parses FFprobe errors.
	 * @param error The error object to parse.
	 * @returns An object containing the error code and optional details.
	 */
	private parseFfprobeError(error: unknown): { code: string; details?: string } | null {
		const rawMessage = this.extractErrorMessage(error);
		const message = rawMessage.toUpperCase();

		if (message.includes('FFPROBE_NOT_FOUND')) {
			return { code: 'FFPROBE_NOT_FOUND' };
		}

		if (message.includes('FFPROBE_NOT_EXECUTABLE')) {
			const details = rawMessage.split(':').slice(1).join(':').trim();
			return { code: 'FFPROBE_NOT_EXECUTABLE', details: details || undefined };
		}

		if (message.includes('FFPROBE_EXEC_FAILED:')) {
			const marker = 'FFPROBE_EXEC_FAILED:';
			const index = rawMessage.toUpperCase().indexOf(marker);
			const details = index >= 0 ? rawMessage.substring(index + marker.length).trim() : '';
			return { code: 'FFPROBE_EXEC_FAILED', details: details || undefined };
		}

		return null;
	}

	/**
	 * Generates a user-friendly error message based on FFprobe error codes and details.
	 * @param code The error code to include in the message.
	 * @param details Optional additional details about the error.
	 * @returns A user-friendly error message.
	 */
	private getFfmpegErrorMessage(code: string, details?: string): string {
		const instructions = this.getFfmpegInstallInstructions();

		if (code === 'FFPROBE_NOT_FOUND') {
			return `FFprobe could not be found. QuranCaption needs FFmpeg (ffmpeg + ffprobe).\n\n${instructions}`;
		}

		if (code === 'FFPROBE_NOT_EXECUTABLE') {
			return `FFprobe was found but could not be executed.${details ? `\nReason: ${details}` : ''}\n\nTry reinstalling FFmpeg for your CPU architecture and remove macOS quarantine if needed.\n\n${instructions}`;
		}

		return `FFprobe execution failed.${details ? `\nReason: ${details}` : ''}\n\n${instructions}`;
	}

	private async showMissingFfmpegModal(message: string): Promise<void> {
		await ModalManager.errorModal(get(LL).editor.ffmpegRequired(), message);
	}

	private getFfmpegInstallInstructions(): string {
		const userAgent = navigator?.userAgent?.toLowerCase() ?? '';

		if (userAgent.includes('mac')) {
			return 'macOS: install with Homebrew using `brew install ffmpeg`, which also provides ffprobe.';
		}

		if (userAgent.includes('linux')) {
			return 'Linux: install via your distribution package manager (e.g. `sudo apt install ffmpeg`, `sudo dnf install ffmpeg`, or `sudo pacman -S ffmpeg`) and ensure ffmpeg/ffprobe are on your PATH.';
		}

		return 'Install the official FFmpeg build for your platform from https://ffmpeg.org/download.html and add both ffmpeg and ffprobe to your PATH.';
	}
}

// Enregistre les classes enfants pour la désérialisation automatique
SerializableBase.registerChildClass(Asset, 'duration', Duration);
