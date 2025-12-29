import { SerializableBase } from './misc/SerializableBase';

import { globalState } from '$lib/runes/main.svelte';
import { Edition, TrackType, Utilities } from '.';
import { Duration } from './index.js';
import { VerseRange } from './VerseRange.svelte';
import { Status } from './Status';
import type { ClipWithTranslation } from './Clip.svelte';
import { VerseTranslation } from './Translation.svelte';

export class ProjectDetail extends SerializableBase {
	static NAME_MAX_LENGTH: number = 50;
	static RECITER_MAX_LENGTH: number = 35;

	id: number;

	name: string;
	reciter: string;
	createdAt: Date;
	updatedAt: Date;

	verseRange: VerseRange;
	duration: Duration;
	percentageCaptioned: number;
	status: Status;

	// Format : author: percentage
	translations: { [author: string]: number };

	/**
	 * Crée une nouvelle instance de ProjectDetail
	 * @param name Nom du projet
	 * @param reciter Nom du réciteur
	 */
	constructor(name: string, reciter: string, createdAt?: Date, updatedAt?: Date) {
		super();

		this.id = Utilities.randomId();

		this.name = $state(name);
		this.reciter = $state(reciter || 'not set');
		this.createdAt = $state(createdAt || new Date());
		this.updatedAt = $state(updatedAt || new Date());

		this.percentageCaptioned = $state(0);
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
		this.updateVideoPercentageCaptioned();
		this.updateVerseRange();
	}

	private updateVideoPercentageCaptioned() {
		const captionedDuration = globalState.getSubtitleTrack.getDuration().ms || 0;

		const totalDuration = globalState.getAudioTrack.getDuration().ms || 0;

		let percentage = (captionedDuration / totalDuration) * 100;
		if (percentage >= 97) {
			percentage = 100;
		}

		globalState.currentProject!.detail.percentageCaptioned = Math.floor(percentage);
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
		const normalizedProjectInfo = `${this.name} ${this.reciter} ${this.verseRange.toString()}`;
		return this.normalize(normalizedProjectInfo).includes(this.normalize(searchQuery));
	}

	normalize(str: string) {
		return str.trim().toLowerCase().replaceAll(/\s+/g, ' ').replaceAll('-', '').replaceAll("'", '');
	}

	/**
	 * Génère, en fonction des paramètres d'export actuels, le nom du fichier d'export.
	 */
	generateExportFileName(): string {
		if (globalState.getExportState.customFileName) {
			return globalState.getExportState.customFileName;
		}

		// Nom du projet (Nom du récitateur) - Al Insan 12-21, XXX
		const finalFileName =
			globalState.currentProject!.detail.name +
			' ' +
			(globalState.currentProject!.detail.reciter
				? '(' + globalState.currentProject!.detail.reciter + ') - '
				: '- ') +
			VerseRange.getVerseRange(
				globalState.getExportState.videoStartTime,
				globalState.getExportState.videoEndTime
			).toStringForExportFile();
		return finalFileName;
	}
}

// Enregistre les classes enfants pour la désérialisation automatique
SerializableBase.registerChildClass(ProjectDetail, 'duration', Duration);
SerializableBase.registerChildClass(ProjectDetail, 'status', Status);
SerializableBase.registerChildClass(ProjectDetail, 'verseRange', VerseRange);
