import { invoke } from '@tauri-apps/api/core';
import { AssetType, SourceType } from './enums.js';
import { SerializableBase } from './misc/SerializableBase.js';
import { Utilities } from './misc/Utilities.js';
import { openPath } from '@tauri-apps/plugin-opener';
import { exists } from '@tauri-apps/plugin-fs';
import { Duration } from './index.js';
import { WaveformService } from '$lib/services/WaveformService.svelte.js';
import type { UnknownRecord } from '$lib/types/common.js';
import LL from '$lib/i18n/i18n-svelte';
import { get } from 'svelte/store';

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
	durationLoadErrorCode: string | null = $state(null);
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
		this.durationLoadErrorCode = null;
		this.durationLoadError = null;

		try {
			const durationMs = (await invoke('get_duration', {
				filePath: this.filePath
			})) as number;

			this.duration = new Duration(durationMs);
			this.durationLoadState = 'success';

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
				this.durationLoadErrorCode = ffprobeError.code;
			} else {
				this.durationLoadError = 'Unable to retrieve media duration. Please check the logs.';
				console.error('Unable to retrieve media duration', error);
			}
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
		const copy = Reflect.get(get(LL).editor, 'ffprobe');
		const reason = details ? copy.reason({ details }) : '';

		if (code === 'FFPROBE_NOT_FOUND') {
			return `${copy.notFound()}\n\n${instructions}`;
		}

		if (code === 'FFPROBE_NOT_EXECUTABLE') {
			return `${copy.notExecutable({ reason })}\n\n${instructions}`;
		}

		return `${copy.failed({ reason })}\n\n${instructions}`;
	}

	private getFfmpegInstallInstructions(): string {
		const userAgent = navigator?.userAgent?.toLowerCase() ?? '';
		const copy = Reflect.get(get(LL).editor, 'ffprobe');

		if (userAgent.includes('mac')) {
			return copy.installMac();
		}

		if (userAgent.includes('linux')) {
			return copy.installLinux();
		}

		return copy.installOther();
	}
}

// Enregistre les classes enfants pour la désérialisation automatique
SerializableBase.registerChildClass(Asset, 'duration', Duration);
