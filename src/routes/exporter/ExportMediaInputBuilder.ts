import { AssetClip } from '$lib/classes';
import { globalState } from '$lib/runes/main.svelte';

export type ExportVideoInput = {
	path: string;
	loop_until_audio_end: boolean;
	source_start_ms?: number;
	timeline_start_ms?: number;
	duration_ms?: number;
};

export type ExportAudioClipInput = {
	path: string;
	source_start_ms: number;
	timeline_start_ms: number;
	duration_ms: number;
	volume_percent: number;
};

/** Construit les entrées média attendues par les commandes d'export Tauri. */
export class ExportMediaInputBuilder {
	/**
	 * Construit les entrées audio avec leurs métadonnées lorsque la timeline l'exige.
	 * @returns {{ audios: string[]; audioClips?: ExportAudioClipInput[] }} Entrées audio Tauri.
	 */
	static getAudioInputs(): {
		audios: string[];
		audioClips?: ExportAudioClipInput[];
	} {
		const clips = globalState.getAudioTrack.clips as AssetClip[];
		const audios = clips.map((clip) => this.getAssetPath(clip));
		if (!this.requiresTimedExport(clips)) return { audios };

		return {
			audios,
			audioClips: clips.map((clip) => ({
				path: this.getAssetPath(clip),
				source_start_ms: Math.round(clip.sourceStartTime ?? 0),
				timeline_start_ms: Math.round(clip.startTime),
				duration_ms: Math.round(clip.duration),
				volume_percent: clip.volumePercent
			}))
		};
	}

	/**
	 * Construit les entrées vidéo en conservant le contrat historique sans trim.
	 * @returns {ExportVideoInput[]} Entrées vidéo Tauri.
	 */
	static getVideoInputs(): ExportVideoInput[] {
		const clips = globalState.getVideoTrack.clips as AssetClip[];
		const requiresTiming = this.requiresTimedExport(clips);

		return clips.map((clip) => {
			const input: ExportVideoInput = {
				path: this.getAssetPath(clip),
				loop_until_audio_end: clip.loopUntilAudioEnd
			};
			if (!requiresTiming) return input;
			input.source_start_ms = Math.round(clip.sourceStartTime ?? 0);
			input.timeline_start_ms = Math.round(clip.startTime);
			input.duration_ms = Math.round(clip.duration);
			return input;
		});
	}

	/**
	 * Indique si une piste exige des métadonnées temporelles détaillées.
	 * @param {AssetClip[]} clips Clips à inspecter.
	 * @returns {boolean} true en présence d'un trim, espace ou volume individuel.
	 */
	private static requiresTimedExport(clips: AssetClip[]): boolean {
		let expectedStartTime = 0;
		return clips.some((clip) => {
			const asset = globalState.currentProject!.content.getAssetById(clip.assetId);
			const requiresTiming =
				clip.startTime !== expectedStartTime ||
				(clip.sourceStartTime ?? 0) > 0 ||
				clip.duration < asset.duration.ms ||
				clip.volumePercent !== 100;
			expectedStartTime = clip.endTime + 1;
			return requiresTiming;
		});
	}

	/**
	 * Résout le chemin de l'asset d'un clip.
	 * @param {AssetClip} clip Clip média.
	 * @returns {string} Chemin source.
	 */
	private static getAssetPath(clip: AssetClip): string {
		return globalState.currentProject!.content.getAssetById(clip.assetId).filePath;
	}
}
