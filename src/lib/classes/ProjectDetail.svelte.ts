import { SerializableBase } from './misc/SerializableBase';

import { globalState } from '$lib/runes/main.svelte';
import { Edition, Utilities } from '.';
import { Duration } from './index.js';
import { VerseRange } from './VerseRange.svelte';
import { Status } from './Status';
import type { ClipWithTranslation } from './Clip.svelte';
import { VerseTranslation } from './Translation.svelte';
import {
	DEFAULT_PROJECT_TYPE,
	normalizeProjectType,
	type ProjectType
} from '$lib/types/projectType';

export class ProjectDetail extends SerializableBase {
	static NAME_MAX_LENGTH: number = 150;
	static SPEAKER_MAX_LENGTH: number = 50;

	id: number;

	name: string;
	speaker: string;
	projectType: ProjectType;
	createdAt: Date;
	updatedAt: Date;

	verseRange: VerseRange;
	duration: Duration;
	transcriptionProgress: number;
	status: Status;

	// Format : author: percentage
	translations: { [author: string]: number };

	/**
	 * Crée une nouvelle instance de ProjectDetail
	 * @param name Nom du projet
	 * @param speaker Nom de l'intervenant
	 */
	constructor(
		name: string,
		speaker: string,
		createdAt?: Date,
		updatedAt?: Date,
		projectType: ProjectType = DEFAULT_PROJECT_TYPE
	) {
		super();

		this.id = Utilities.randomId();

		this.name = $state(name);
		this.speaker = $state(speaker || 'Unknown speaker');
		this.projectType = $state(normalizeProjectType(projectType));
		this.createdAt = $state(createdAt || new Date());
		this.updatedAt = $state(updatedAt || new Date());

		this.transcriptionProgress = $state(0);
		this.status = $state(Status.NOT_SET);
		this.duration = new Duration(0);
		this.verseRange = new VerseRange();
		this.translations = $state({});
	}

	/**
	 * Met à jour la date de dernière modification du projet
	 */
	public updateTimestamp(): void {
		this.updatedAt = new Date();
	}

	/**
	 * Met à jour le pourcentage de sous-titres captionnés par rapport
	 * à la durée total de la vidéo du projet
	 */
	public updateVideoDetailAttributes() {
		this.duration = new Duration(globalState.getAudioTrack.getDuration().ms || 0);
		this.updateTranscriptionProgress();
	}

	private updateTranscriptionProgress() {
		const transcribedDuration = globalState.getSubtitleTrack.getDuration().ms || 0;

		const totalDuration = globalState.getAudioTrack.getDuration().ms || 0;

		let percentage = totalDuration > 0 ? (transcribedDuration / totalDuration) * 100 : 0;
		if (percentage >= 97) {
			percentage = 100;
		}

		globalState.currentProject!.detail.transcriptionProgress = Math.floor(percentage);
	}

	private updateVerseRange() {
		// Update la verse range pour toute la vidéo
		this.verseRange = VerseRange.getVerseRange(0, globalState.getSubtitleTrack.getDuration().ms);
	}

	/**
	 * Met à jour le pourcentage de complétion des traductions du projet pour
	 * une édition donnée
	 * @param edition L'édition à mettre à jour
	 */
	updatePercentageTranslated(edition: Edition) {
		// Calcul le nbre de traduction complété/nbre de traduction total
		let total: number = 0;
		let completed: number = 0;

		for (const subtitle of globalState.getSubtitleTrack.clips) {
			if (subtitle.type === 'Subtitle' || subtitle.type === 'Pre-defined Subtitle') {
				const translations = (subtitle as ClipWithTranslation).translations;
				if (translations && translations[edition.name]) {
					// Si la traduction existe, on l'ajoute au pourcentage
					if (!(translations[edition.name] instanceof VerseTranslation)) continue;

					if (translations[edition.name].isStatusComplete()) {
						completed++;
					}

					total++;
				}
			}
		}

		globalState.currentProject!.detail.translations[edition.author] = Math.floor(
			total > 0 ? (completed / total) * 100 : 0
		);
	}

	matchSearchQuery(searchQuery: string): boolean {
		const normalizedProjectInfo = `${this.name} ${this.speaker} ${this.projectType}`;
		return this.normalize(normalizedProjectInfo).includes(this.normalize(searchQuery));
	}

	normalize(str: string) {
		return str.trim().toLowerCase().replaceAll(/\s+/g, ' ').replaceAll('-', '').replaceAll("'", '');
	}

	/**
	 * Génère, en fonction des paramètres d'export actuels, le nom du fichier d'export.
	 */
	generateExportFileName(): string {
		// Si un nom de fichier personnalisé est défini, l'utiliser
		const customFileName = globalState.getExportState.customFileName.trim();
		if (customFileName) {
			const sanitized = customFileName.replace(/[/\\:*?"<>|]/g, '_');
			return sanitized;
		}

		const finalFileName =
			globalState.currentProject!.detail.name +
			(globalState.currentProject!.detail.speaker
				? ` (${globalState.currentProject!.detail.speaker})`
				: '');
		return finalFileName.replace(/[/\\:*?"<>|]/g, '');
	}

	static override fromJSON<T extends SerializableBase>(
		this: any,
		data: Record<string, unknown>
	): T {
		const detail = super.fromJSON.call(this, data) as T;
		if (detail instanceof ProjectDetail) {
			detail.speaker = detail.speaker || 'Unknown speaker';
			detail.projectType = normalizeProjectType(detail.projectType);
		}
		return detail;
	}
}

// Enregistre les classes enfants pour la désérialisation automatique
SerializableBase.registerChildClass(ProjectDetail, 'duration', Duration);
SerializableBase.registerChildClass(ProjectDetail, 'status', Status);
SerializableBase.registerChildClass(ProjectDetail, 'verseRange', VerseRange);
