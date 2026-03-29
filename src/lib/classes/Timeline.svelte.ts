import { Asset, AssetClip, Clip, Duration, TrackType } from './index.js';
import { SerializableBase } from './misc/SerializableBase.js';
import { Track } from './Track.svelte.js';
import { globalState } from '$lib/runes/main.svelte.js';

export class Timeline extends SerializableBase {
	tracks: Track[] = $state([]);

	constructor(tracks: Track[] = []) {
		super();
		this.tracks = tracks;
	}

	getLongestTrackDuration(): Duration {
		return new Duration(Math.max(...this.tracks.map((track) => track.getDuration().ms)));
	}

	getLongestTrackDurationIgnoringLoopedVideo(): Duration {
		return new Duration(
			Math.max(
				...this.tracks.map((track) => {
					if (track.type === TrackType.Video) {
						const nonLoopedClips = track.clips.filter(
							(clip) => !(clip instanceof AssetClip && clip.loopUntilAudioEnd)
						);
						if (nonLoopedClips.length === 0) return 0;
						return Math.max(...nonLoopedClips.map((clip) => clip.endTime));
					}
					return track.getDuration().ms;
				})
			)
		);
	}

	removeAssetFromTracks(asset: Asset) {
		this.tracks.forEach((track) => {
			if (track.type === TrackType.Audio || track.type === TrackType.Video) {
				for (let i = track.clips.length - 1; i >= 0; i--) {
					const clip = track.clips[i];

					if (clip && (clip as AssetClip).assetId === asset.id) {
						track.removeClip(clip.id);
					}
				}
			}
		});
	}

	/**
	 * Renvoie, si elle existe, l'image de fond de la timeline.
	 * @returns L'image de fond ou null si elle n'existe pas.
	 */
	getBackgroundImage(): Asset | null {
		const videoTrack = this.getFirstTrack(TrackType.Video);

		// Si on est dans la track `Video` et qu'il n'y a qu'un seul clip avec une durée de 0,
		// c'est que c'est une image en tant que fond. Renvoie donc l'image pour la durée de la vidéo entière.
		if (
			videoTrack.type === 'Video' &&
			videoTrack.clips.length === 1 &&
			videoTrack.clips[0].endTime === 0
		) {
			return this.clipToAsset(videoTrack.clips[0]);
		}

		return null;
	}

	/**
	 * Retourne la vidéo qui doit être actuellement jouée sur la timeline
	 * en fonction du type de piste.
	 * @param trackType Le type de piste
	 * @returns L'asset actuellement joué sur la piste, ou null si aucun clip n'est trouvé
	 */
	getCurrentAssetOnTrack(trackType: TrackType): Asset | null {
		const track = this.tracks.find((t) => t.type === trackType);
		const currentClip = track?.getCurrentClip();

		if (!currentClip) return null;

		return this.clipToAsset(currentClip) || null;
	}

	/**
	 * Convertit un clip en asset.
	 * @param clip Le clip à convertir.
	 * @returns L'asset correspondant au clip, ou null si aucun asset n'est trouvé.
	 */
	clipToAsset(clip: Clip): Asset | null {
		if (clip instanceof AssetClip) {
			return globalState.currentProject?.content.getAssetById(clip.assetId) || null;
		}
		return null;
	}

	/**
	 * Retourne la première piste de la timeline du type spécifié.
	 * @param trackType Le type de piste à rechercher (Audio, Video, etc.)
	 * @returns La première piste trouvée du type spécifié
	 */
	getFirstTrack(trackType: TrackType) {
		const track = this.tracks.find((t) => t.type === trackType);
		if (!track) throw new Error('Track not found.');
		return track;
	}

	doesTrackExist(trackType: TrackType): boolean {
		return this.tracks.some((track) => track.type === trackType);
	}

	/**
	 * Ajoute une nouvelle piste à la timeline.
	 * @param track La piste à ajouter
	 */
	addTrack(track: Track) {
		this.tracks.unshift(track);
	}
}

// Enregistre les classes enfants pour la désérialisation automatique
SerializableBase.registerChildClass(Timeline, 'tracks', Track);
