import { Timeline } from './Timeline.svelte.js';
import { Asset } from './Asset.svelte.js';
import { AssetTrack, CustomTextTrack, SubtitleTrack } from './Track.svelte.js';
import { AssetType, SourceType, TrackType } from './enums.js';
import { SerializableBase } from './misc/SerializableBase.js';
import toast from 'svelte-5-french-toast';
import LL from '$lib/i18n/i18n-svelte';
import { get } from 'svelte/store';
import { ProjectTranslation, VideoStyle } from './index.js';
import type { UnknownRecord } from '$lib/types/common';
import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';

export class ProjectContent extends SerializableBase {
	timeline: Timeline;
	assets: Asset[];
	projectTranslation: ProjectTranslation;

	// Style
	videoStyle: VideoStyle;

	/**
	 * Crée une instance de ProjectContent.
	 * @param timeline La timeline du projet, par défaut une nouvelle Timeline vide.
	 * @param assets La liste des assets du projet, par défaut un tableau vide.
	 */
	constructor(
		timeline: Timeline = new Timeline(),
		assets: Asset[] = [],
		projectTranslation: ProjectTranslation = new ProjectTranslation(),
		videoStyle: VideoStyle = new VideoStyle()
	) {
		super();

		this.timeline = $state(timeline);
		this.assets = $state(assets);
		this.projectTranslation = $state(projectTranslation);
		this.videoStyle = $state(videoStyle);
	}

	/**
	 * Retourne le contenu par défaut d'un projet, avec une timeline contenant
	 * une piste de sous-titres, une piste vidéo et une piste audio.
	 * @returns Le contenu par défaut d'un projet
	 */
	static async getDefaultProjectContent(): Promise<ProjectContent> {
		return new ProjectContent(
			new Timeline([
				new CustomTextTrack(),
				new SubtitleTrack(),
				new AssetTrack(TrackType.Video),
				new AssetTrack(TrackType.Audio)
			]),
			[],
			new ProjectTranslation(),
			await VideoStyle.getDefaultVideoStyle()
		);
	}

	addAsset(
		filePath: string,
		sourceUrl?: string,
		sourceType: SourceType = SourceType.Local,
		metadata: UnknownRecord = {}
	): Asset | undefined {
		return ProjectHistoryManager.track('add asset', () => {
			const asset = this.addAssetHeadless(filePath, sourceUrl, sourceType, metadata);
			if (!asset) {
				toast.error(get(LL).editor.fileFormatNotSupported());
			}
			return asset;
		});
	}

	/**
	 * Crée un asset sans historique ni effet d'interface.
	 * @param {string} filePath Chemin du média.
	 * @param {string | undefined} sourceUrl URL d'origine éventuelle.
	 * @param {SourceType} sourceType Type de source.
	 * @param {UnknownRecord} metadata Métadonnées de l'asset.
	 * @returns {Asset | undefined} Asset ajouté, ou `undefined` si son format est inconnu.
	 */
	addAssetHeadless(
		filePath: string,
		sourceUrl?: string,
		sourceType: SourceType = SourceType.Local,
		metadata: UnknownRecord = {}
	): Asset | undefined {
		const asset = new Asset(filePath, sourceUrl, sourceType, metadata);
		if (asset.type === AssetType.Unknown) {
			return undefined;
		}
		this.assets.unshift(asset);
		return asset;
	}

	removeAsset(asset: Asset): void {
		ProjectHistoryManager.track('remove asset', () => {
			const index = this.assets.indexOf(asset);
			if (index !== -1) {
				this.assets.splice(index, 1);

				// Maintenant, supprime l'asset de la timeline
				this.timeline.removeAssetFromTracks(asset);
			} else {
				toast.error(get(LL).editor.assetNotFound());
			}
		});
	}

	getAssetById(id: number) {
		return this.assets.find((x) => x.id === id)!;
	}
}

// Enregistre les classes enfants pour la désérialisation automatique
SerializableBase.registerChildClass(ProjectContent, 'timeline', Timeline);
SerializableBase.registerChildClass(ProjectContent, 'assets', Asset);
SerializableBase.registerChildClass(ProjectContent, 'projectTranslation', ProjectTranslation);
SerializableBase.registerChildClass(ProjectContent, 'videoStyle', VideoStyle);
