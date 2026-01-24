import { invoke } from '@tauri-apps/api/core';
import { AssetType, SourceType, TrackType } from './enums.js';
import { SerializableBase } from './misc/SerializableBase.js';
import { Utilities } from './misc/Utilities.js';
import { openPath } from '@tauri-apps/plugin-opener';
import { exists, open, remove } from '@tauri-apps/plugin-fs';
import { globalState } from '$lib/runes/main.svelte.js';
import { Duration } from './index.js';
import ModalManager from '$lib/components/modals/ModalManager.js';
import { WaveformService } from '$lib/services/WaveformService.svelte.js';

export class Asset extends SerializableBase {
	id: number = $state(0);
	fileName: string = $state('');
	filePath: string = $state('');
	type: AssetType = $state(AssetType.Unknown);
	duration: Duration = $state(new Duration(0));
	exists: boolean = $state(true);
	sourceUrl?: string = $state(undefined);
	sourceType: SourceType = $state(SourceType.Local);
	metadata: Record<string, any> = $state({});

	constructor(
		filePath: string = '',
		sourceUrl?: string,
		sourceType: SourceType = SourceType.Local,
		metadata: Record<string, any> = {}
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
			this.initializeDuration();
		}
	}

	async addToTimeline(asVideo: boolean, asAudio: boolean) {
		if (asVideo) globalState.getVideoTrack.addAsset(this);
		if (asAudio) globalState.getAudioTrack.addAsset(this);

		if (asVideo && this.type === AssetType.Video) {
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
			const currentProjectDimensions = globalState.getStyle('global', 'video-dimension').value;
			if (
				assetDimensions.width === currentProjectDimensions.width &&
				assetDimensions.height === currentProjectDimensions.height
			) {
				return;
			}

			// Demande confirmation à l'utilisateur
			const confirm = await ModalManager.confirmModal(
				'Would you like to set the project dimensions to match this video? (' +
				assetDimensions.width +
				'x' +
				assetDimensions.height +
				')',
				true
			);

			if (confirm) {
				if (assetDimensions.width > 0 && assetDimensions.height > 0) {
					globalState.getStyle('global', 'video-dimension').value = {
						width: assetDimensions.width,
						height: assetDimensions.height
					};
				}
			}
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
		try {
			const durationMs = (await invoke('get_duration', {
				filePath: this.filePath
			})) as number;

			this.duration = new Duration(durationMs);

			if (durationMs === -1) {
				this.duration = new Duration(0);
				this.exists = false;
			}
		} catch (error) {
			this.duration = new Duration(0);

			if (this.isFfprobeMissingError(error)) {
				await this.showMissingFfmpegModal();
			} else {
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

		// Cas général
		return normalized.substring(0, lastSeparatorIndex);
	}

	updateFilePath(element: string) {
		const oldPath = this.filePath;
		this.filePath = this.normalizeFilePath(element);
		WaveformService.clearCache(oldPath);
		this.exists = true; // Réinitialise l'existence à vrai
		if (this.type === AssetType.Audio || this.type === AssetType.Video) {
			this.duration = new Duration(0);
			this.initializeDuration(); // Réinitialise la durée
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

	private isFfprobeMissingError(error: unknown): boolean {
		const message = this.extractErrorMessage(error).toUpperCase();
		return message.includes('FFPROBE_NOT_FOUND');
	}

	private extractErrorMessage(error: unknown): string {
		if (typeof error === 'string') {
			return error;
		}

		if (
			error &&
			typeof error === 'object' &&
			'message' in error &&
			typeof (error as any).message === 'string'
		) {
			return (error as { message: string }).message;
		}

		return String(error ?? '');
	}

	private async showMissingFfmpegModal(): Promise<void> {
		const instructions = this.getFfmpegInstallInstructions();
		await ModalManager.errorModal(
			'FFmpeg is required',
			`QuranCaption needs FFmpeg (ffmpeg + ffprobe) to analyze your media files. Please install both tools and ensure they are available in your PATH.\n\n${instructions}`
		);
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
