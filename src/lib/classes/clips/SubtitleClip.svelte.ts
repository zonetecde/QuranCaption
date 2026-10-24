import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
import MigrationService from '$lib/services/MigrationService';
import { ClipWithTranslation } from './ClipWithTranslation.svelte';
import { Translation } from '../Translation.svelte';
import { SerializableBase, type RegisteredSerializableClass } from '../misc/SerializableBase';
import { normalizeTranscriptWordTimings } from '$lib/services/TranscriptTiming';
import type { TranscriptAlignmentMetadata, VisualMergeMode } from '$lib/types/transcription';

export class SubtitleClip extends ClipWithTranslation {
	wbwTimestampsManuallyEdited: boolean = $state(false);
	alignmentMetadata: TranscriptAlignmentMetadata | null = $state(null);
	visualMergeGroupId: string | null = $state(null);
	visualMergeMode: VisualMergeMode | null = $state(null);

	/**
	 * Crée un sous-titre Minbar à partir du texte et des timings fournis par le moteur.
	 * @param {number} startTime Début en millisecondes.
	 * @param {number} endTime Fin en millisecondes.
	 * @param {string} text Texte libre avec ses éventuelles annotations.
	 * @param {Record<string, Translation>} translations Traductions initialisées par le projet appelant.
	 * @param {boolean} comeFromIA Origine automatique du sous-titre.
	 * @param {number | null} confidence Confiance du moteur.
	 * @param {TranscriptAlignmentMetadata | null} alignmentMetadata Alignement mot par mot.
	 */
	constructor(
		startTime = 0,
		endTime = 0,
		text = '',
		translations: Record<string, Translation> = {},
		comeFromIA = false,
		confidence: number | null = null,
		alignmentMetadata: TranscriptAlignmentMetadata | null = null
	) {
		super(text, startTime, endTime, 'Subtitle', translations, comeFromIA, confidence);
		this.alignmentMetadata = alignmentMetadata;
		if (this.alignmentMetadata) {
			this.alignmentMetadata = {
				...this.alignmentMetadata,
				words: normalizeTranscriptWordTimings(
					this.alignmentMetadata.words,
					Math.max(0, (endTime - startTime) / 1000)
				)
			};
		}
	}

	/**
	 * Restaure le dictionnaire réactif des traductions et les timings relatifs sans consulter le projet actif.
	 * @param {Record<string, unknown>} data Données sérialisées du sous-titre.
	 * @returns {T} Sous-titre restauré.
	 */
	static override fromJSON<T extends SerializableBase>(
		this: RegisteredSerializableClass<T>,
		data: Record<string, unknown>
	): T {
		const clip = super.fromJSON.call(this, MigrationService.migrateSingleSpeakerData(data)) as T;
		if (clip instanceof SubtitleClip && clip.translations instanceof Translation) {
			// Une instance de classe ne rend pas réactif le remplacement des traductions par langue.
			clip.translations = Object.fromEntries(
				Object.entries(clip.translations).filter(
					([, translation]) => translation instanceof Translation
				)
			);
		}
		if (clip instanceof SubtitleClip && clip.alignmentMetadata) {
			clip.alignmentMetadata = {
				...clip.alignmentMetadata,
				timeFrom: clip.startTime / 1000,
				timeTo: clip.endTime / 1000,
				words: normalizeTranscriptWordTimings(
					clip.alignmentMetadata.words,
					Math.max(0, (clip.endTime - clip.startTime) / 1000)
				)
			};
		}
		return clip;
	}

	setVisualMerge(groupId: string, mode: VisualMergeMode): void {
		this.visualMergeGroupId = groupId;
		this.visualMergeMode = mode;
	}

	clearVisualMerge(): void {
		this.visualMergeGroupId = null;
		this.visualMergeMode = null;
	}

	isVisuallyMerged(): boolean {
		return !!this.visualMergeGroupId && !!this.visualMergeMode;
	}

	private retimeAlignmentAfterStartChange(previousStartTime: number): void {
		if (!this.alignmentMetadata) return;

		const clipDurationSeconds = Math.max(0, (this.endTime - this.startTime) / 1000);
		const offsetSeconds = (previousStartTime - this.startTime) / 1000;
		const shiftedWords = this.alignmentMetadata.words.map((word, index) => ({
			...word,
			start: index === 0 ? 0 : word.start + offsetSeconds,
			end: word.end + offsetSeconds
		}));

		this.alignmentMetadata = {
			...this.alignmentMetadata,
			timeFrom: this.startTime / 1000,
			timeTo: this.endTime / 1000,
			words: normalizeTranscriptWordTimings(shiftedWords, clipDurationSeconds)
		};
	}

	private retimeAlignmentAfterEndChange(): void {
		if (!this.alignmentMetadata) return;

		const clipDurationSeconds = Math.max(0, (this.endTime - this.startTime) / 1000);
		this.alignmentMetadata = {
			...this.alignmentMetadata,
			timeFrom: this.startTime / 1000,
			timeTo: this.endTime / 1000,
			words: normalizeTranscriptWordTimings(this.alignmentMetadata.words, clipDurationSeconds)
		};
	}

	/**
	 * Modifie les timings et leur alignement dans la même opération annulable.
	 * @param {number} newEndTime Nouvelle borne en millisecondes.
	 * @returns {boolean} Vrai si les bornes et leur alignement ont été modifiés.
	 */
	override setEndTime(newEndTime: number): boolean {
		return ProjectHistoryManager.track('set subtitle end', () => {
			if (!super.setEndTime(newEndTime)) return false;
			if (this.endTime === newEndTime) {
				this.retimeAlignmentAfterEndChange();
				super.markAsManualEdit();
			}
			return true;
		});
	}

	/**
	 * Modifie les timings et leur alignement dans la même opération annulable.
	 * @param {number} newStartTime Nouvelle borne en millisecondes.
	 * @returns {boolean} Vrai si les bornes et leur alignement ont été modifiés.
	 */
	override setStartTime(newStartTime: number): boolean {
		return ProjectHistoryManager.track('set subtitle start', () => {
			const previousStartTime = this.startTime;
			if (!super.setStartTime(newStartTime)) return false;
			if (this.startTime === newStartTime) {
				this.retimeAlignmentAfterStartChange(previousStartTime);
				super.markAsManualEdit();
			}
			return true;
		});
	}

	/**
	 * Modifie les timings et leur alignement dans la même opération annulable.
	 * @param {number} newStartTime Nouvelle borne en millisecondes.
	 * @returns {void}
	 */
	setStartTimeSilently(newStartTime: number): void {
		ProjectHistoryManager.track('set subtitle start', () => {
			const previousStartTime = this.startTime;
			super.setStartTime(newStartTime);
			if (this.startTime === newStartTime) {
				this.retimeAlignmentAfterStartChange(previousStartTime);
			}
		});
	}

	/**
	 * Modifie les timings et leur alignement dans la même opération annulable.
	 * @param {number} newEndTime Nouvelle borne en millisecondes.
	 * @returns {void}
	 */
	setEndTimeSilently(newEndTime: number): void {
		ProjectHistoryManager.track('set subtitle end', () => {
			super.setEndTime(newEndTime);
			if (this.endTime === newEndTime) {
				this.retimeAlignmentAfterEndChange();
			}
		});
	}

	/**
	 * Copie les éditions communes sans dépendre de l'énumérabilité des propriétés réactives Svelte.
	 * @param {SubtitleClip} clonedClip Destination déjà construite avec ses timings et traductions.
	 * @returns {void}
	 */
	protected copyEditingStateTo(clonedClip: SubtitleClip): void {
		clonedClip.arabicInlineStyleRuns = JSON.parse(JSON.stringify(this.arabicInlineStyleRuns ?? []));
		clonedClip.associatedImagePath = this.associatedImagePath;
		clonedClip.needsLongReview = this.needsLongReview;
		clonedClip.needsReview = this.needsReview;
		clonedClip.needsCoverageReview = this.needsCoverageReview;
		clonedClip.needsWbwTimestampReview = this.needsWbwTimestampReview;
		clonedClip.hasBeenVerified = this.hasBeenVerified;
		clonedClip.wbwTimestampsManuallyEdited = this.wbwTimestampsManuallyEdited;
		clonedClip.visualMergeGroupId = this.visualMergeGroupId;
		clonedClip.visualMergeMode = this.visualMergeMode;
	}

	cloneWithTimes(newStartTime: number, newEndTime: number): SubtitleClip {
		const clonedClip = new SubtitleClip(
			newStartTime,
			newEndTime,
			this.text,
			Object.fromEntries(
				Object.entries(this.translations).map(([key, translation]) => [
					key,
					typeof translation.clone === 'function'
						? translation.clone()
						: JSON.parse(JSON.stringify(translation))
				])
			),
			this.comeFromIA,
			this.confidence,
			this.alignmentMetadata ? JSON.parse(JSON.stringify(this.alignmentMetadata)) : null
		);

		this.copyEditingStateTo(clonedClip);
		return clonedClip;
	}
}

SerializableBase.registerChildClass(SubtitleClip, 'translations', Translation);
