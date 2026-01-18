import { AssetType, TrackType } from './enums.js';
import {
	AssetClip,
	Clip,
	ClipWithTranslation,
	CustomClip,
	CustomImageClip,
	CustomTextClip,
	PredefinedSubtitleClip,
	SilenceClip,
	SubtitleClip,
	type PredefinedSubtitleType
} from './Clip.svelte.js';
import { SerializableBase } from './misc/SerializableBase.js';
import { Duration, type Asset } from './index.js';
import { globalState } from '$lib/runes/main.svelte.js';
import { Quran, type Verse } from './Quran.js';
import toast from 'svelte-5-french-toast';
import { VerseTranslation } from './Translation.svelte.js';
import ModalManager from '$lib/components/modals/ModalManager.js';
import type { Category } from './VideoStyle.svelte.js';
import { open } from '@tauri-apps/plugin-dialog';
import { AnalyticsService } from '$lib/services/AnalyticsService';

export class Track extends SerializableBase {
	type: TrackType = $state(TrackType.Unknown);
	clips: Clip[] = $state([]);

	constructor(type: TrackType) {
		super();
		this.type = type;
		this.clips = [];
	}

	/**
	 * Supprime un clip de la piste.
	 * @param id L'ID du clip à supprimer.
	 * @param makeNextClipStartAtThisClipStartTime Si vrai, le prochain clip commencera à l'heure de début de ce clip plutôt que de tout décaler.
	 * * Si faux, les clips suivants seront décalés pour combler l'espace laissé par le clip supprimé.
	 * */
	removeClip(id: number, makeNextClipStartAtThisClipStartTime: boolean = false) {
		const index = this.clips.findIndex((clip) => clip.id === id);
		if (index !== -1) {
			const clipToRemoveStartTime = this.clips[index].startTime;
			this.clips.splice(index, 1);

			if (!makeNextClipStartAtThisClipStartTime) {
				// Met à jour les timestamps des clips suivants
				for (let i = index; i < this.clips.length; i++) {
					const clip = this.clips[i];
					clip.startTime = i === 0 ? 0 : this.clips[i - 1].endTime + 1;
					clip.endTime = clip.startTime + clip.duration;
				}
			} else {
				// Trouve le clip suivant et met à jour son startTime
				const nextClip = this.clips[index];
				if (nextClip) {
					nextClip.setStartTime(clipToRemoveStartTime);
				}
			}
		}

		globalState.updateVideoPreviewUI();
	}

	removeLastClip() {
		if (this.clips.length === 0) {
			return;
		}

		this.clips.pop();
	}

	getClipById(clipId: number) {
		return this.clips.find((clip) => clip.id === clipId)!;
	}

	getName(): string {
		switch (this.type) {
			case TrackType.Video:
				return 'Video';
			case TrackType.Audio:
				return 'Audio';
			case TrackType.Subtitle:
				return 'Subtitles';
			case TrackType.CustomClip:
				return 'Custom Clips';
			default:
				return 'Unknown Track';
		}
	}

	getIcon(): string {
		switch (this.type) {
			case TrackType.Video:
				return 'movie';
			case TrackType.Audio:
				return 'music_note';
			case TrackType.Subtitle:
				return 'subtitles';
			case TrackType.CustomClip:
				return 'text_fields';
			default:
				return 'help_outline';
		}
	}

	getAcceptableAssetType(): AssetType {
		switch (this.type) {
			case TrackType.Video:
				return AssetType.Video;
			case TrackType.Audio:
				return AssetType.Audio;
			default:
				return AssetType.Unknown;
		}
	}

	getPixelPerSecond() {
		return globalState.currentProject?.projectEditorState.timeline.zoom!;
	}

	getDuration(): Duration {
		if (this.clips.length === 0) {
			return new Duration(0);
		}
		return new Duration(Math.max(...this.clips.map((clip) => clip.endTime)));
	}

	getCurrentClip(cursorPos?: number): Clip | null {
		const currentTime =
			cursorPos ?? globalState.currentProject?.projectEditorState.timeline.cursorPosition ?? 0;

		for (let index = 0; index < this.clips.length; index++) {
			const element = this.clips[index];
			if (currentTime >= element.startTime && currentTime <= element.endTime) {
				return element;
			}
		}

		return null;
	}

	getClipBefore(id: number) {
		for (let i = 0; i < this.clips.length; i++) {
			const element = this.clips[i];
			if (element.id === id) {
				return i > 0 ? this.clips[i - 1] : null;
			}
		}
	}

	getClipAfter(id: number) {
		for (let i = 0; i < this.clips.length; i++) {
			const element = this.clips[i];
			if (element.id === id) {
				return i < this.clips.length - 1 ? this.clips[i + 1] : null;
			}
		}
	}

	getLastClip() {
		return this.clips[this.clips.length - 1] || null;
	}
}

export class AssetTrack extends Track {
	constructor(type: TrackType) {
		super(type);
	}

	addAsset(asset: Asset) {
		// Récupère le dernier clip de la piste, s'il existe
		const lastClip = this.clips.length > 0 ? this.clips[this.clips.length - 1] : null;

		if (lastClip) {
			// S'il y a un dernier clip alors qu'on essaie de mettre une image dans la timeline (= mettre une image en
			// tant que background pour la vidéo), alors on informe l'utilisateur que ce n'est pas possible.
			if (asset.type === AssetType.Image) {
				ModalManager.errorModal(
					'Background Image Error',
					'You cannot add a background image to the timeline because there is already a video or image clip in the video track.'
				);
				return;
			}

			this.clips.push(
				new AssetClip(lastClip.endTime + 1, lastClip.endTime + asset.duration.ms + 1, asset.id)
			);
		} else this.clips.push(new AssetClip(0, asset.duration.ms, asset.id));

		// Trigger la réactivé dans la videopreview pour afficher le clip ajouté (si le curseur est dessus)
		setTimeout(() => {
			if (!globalState.currentProject) return;

			globalState.getTimelineState.movePreviewTo = globalState.getTimelineState.cursorPosition + 1;
		}, 0);
	}
}

export class SubtitleTrack extends Track {
	constructor() {
		super(TrackType.Subtitle);
	}

	/**
	 * Modifie un sous-titre existant pour le transformer en un sous-titre pré-défini (Silence, Istiadhah, Basmala).
	 * @param subtitle Le sous-titre à modifier.
	 * @param presetChoice Le type de sous-titre pré-défini à appliquer.
	 */
	editSubtitleToSpecial(
		subtitle: SubtitleClip | PredefinedSubtitleClip | SilenceClip,
		presetChoice: 'Silence' | 'Istiadhah' | 'Basmala'
	) {
		let newSubtitleClip: SilenceClip | PredefinedSubtitleClip | undefined = undefined;

		if (presetChoice === 'Silence') {
			newSubtitleClip = new SilenceClip(subtitle.startTime, subtitle.endTime);
		} else if (presetChoice === 'Istiadhah') {
			newSubtitleClip = new PredefinedSubtitleClip(
				subtitle.startTime,
				subtitle.endTime,
				'Istiadhah'
			);
		} else if (presetChoice === 'Basmala') {
			newSubtitleClip = new PredefinedSubtitleClip(subtitle.startTime, subtitle.endTime, 'Basmala');
		}

		// Modiife le clip existant ou le remplace par le nouveau clip pré-défini
		if (newSubtitleClip) {
			const clipIndex = this.clips.findIndex((clip) => clip.id === subtitle.id);
			if (clipIndex !== -1) {
				this.clips[clipIndex] = newSubtitleClip;
			}
		}
	}

	/**
	 * Modifie un sous-titre existant ou le transforme en sous-titre normal s'il s'agit d'un sous-titre pré-défini.
	 * Si le sous-titre est déjà un sous-titre normal, il est simplement modifié.
	 * @param subtitle Le sous-titre à modifier ou transformer.
	 * @param verse Le nouveau verset du sous-titre.
	 * @param firstWordIndex Le nouvel index du premier mot du sous-titre.
	 * @param lastWordIndex Le nouvel index du dernier mot du sous-titre.
	 * @param surah Le nouveau numéro de la sourate du sous-titre.
	 */
	async editSubtitle(
		subtitle: SubtitleClip | PredefinedSubtitleClip | ClipWithTranslation | null,
		verse: Verse,
		firstWordIndex: number,
		lastWordIndex: number,
		surah: number
	) {
		// Modifie le sous-titre existant
		// Si c'est un sous-titre pré-défini, on le transforme en sous-titre normal (ex: de silence en Qur'an)
		if (subtitle?.type !== 'Subtitle') {
			// Transforme le sous-titre en sous-titre normal

			const subtitlesProperties = await this.getSubtitlesProperties(
				verse,
				firstWordIndex,
				lastWordIndex,
				surah
			);

			const newSubtitleClip = new SubtitleClip(
				subtitle!.startTime,
				subtitle!.endTime,
				surah,
				verse.id,
				firstWordIndex,
				lastWordIndex,
				verse.getArabicTextBetweenTwoIndexes(firstWordIndex, lastWordIndex),
				verse.getWordByWordTranslationBetweenTwoIndexes(firstWordIndex, lastWordIndex),
				subtitlesProperties.isFullVerse, // isFullVerse
				subtitlesProperties.isLastWordsOfVerse, // isLastWordsOfVerse
				subtitlesProperties.translations // translations
			);

			// Remplace l'ancien clip par le nouveau dans le tableau clips
			const clipIndex = this.clips.findIndex((clip) => clip.id === subtitle!.id);
			if (clipIndex !== -1) {
				this.clips[clipIndex] = newSubtitleClip;
			}

			subtitle = newSubtitleClip;
		} else if (subtitle instanceof SubtitleClip) {
			// Si c'est déjà un sous-titre normal, on le modifie
			subtitle.verse = verse.id;
			subtitle.surah = surah;
			subtitle.startWordIndex = firstWordIndex;
			subtitle.endWordIndex = lastWordIndex;
			subtitle.text = verse.getArabicTextBetweenTwoIndexes(firstWordIndex, lastWordIndex);
			subtitle.wbwTranslation = verse.getWordByWordTranslationBetweenTwoIndexes(
				firstWordIndex,
				lastWordIndex
			);
			const subtitlesProperties = await this.getSubtitlesProperties(
				verse,
				firstWordIndex,
				lastWordIndex,
				surah
			);
			subtitle.isFullVerse = subtitlesProperties.isFullVerse;
			subtitle.isLastWordsOfVerse = subtitlesProperties.isLastWordsOfVerse;
			subtitle.translations = subtitlesProperties.translations;
		}

		if (subtitle instanceof SubtitleClip) {
			subtitle.markAsManualEdit();
		}
	}

	splitSubtitle(clipId: number): boolean {
		const clipIndex = this.clips.findIndex((clip) => clip.id === clipId);
		if (clipIndex === -1) return false;

		const clip = this.clips[clipIndex] as SubtitleClip;
		const splitTime = globalState.getTimelineState.cursorPosition;

		// Check if the split time is within the clip
		if (splitTime <= clip.startTime || splitTime >= clip.endTime) {
			toast.error('The cursor must be strictly inside the subtitle to split it.');
			return false;
		}

		// Minimum duration check (e.g. 100ms) for both parts
		if (splitTime - clip.startTime < 100 || clip.endTime - splitTime < 100) {
			toast.error('Resulting clips would be too short (min 100ms).');
			return false;
		}

		const originalEndTime = clip.endTime;

		// Update le temps de fin du premier clip
		clip.endTime = splitTime;
		clip.duration = clip.endTime - clip.startTime;

		// Créer le deuxième clip avec les mêmes propriétés
		const newClip = clip.cloneWithTimes(splitTime, originalEndTime);

		// Insérer le nouveau clip après le clip original
		this.clips.splice(clipIndex + 1, 0, newClip);

		return true;
	}

	async addSubtitle(
		verse: Verse,
		firstWordIndex: number,
		lastWordIndex: number,
		surah: number
	): Promise<boolean> {
		const arabicText = verse.getArabicTextBetweenTwoIndexes(firstWordIndex, lastWordIndex);
		const wbwTranslation = verse.getWordByWordTranslationBetweenTwoIndexes(
			firstWordIndex,
			lastWordIndex
		);

		const startTime = this.getDuration().ms + 1;
		const endTime = globalState.currentProject?.projectEditorState.timeline.cursorPosition || -1;

		if (endTime < startTime) {
			toast.error('End time must be greater than start time.');
			return false;
		}

		const subtitlesProperties = await this.getSubtitlesProperties(
			verse,
			firstWordIndex,
			lastWordIndex,
			surah
		);

		this.clips.push(
			new SubtitleClip(
				startTime,
				endTime,
				surah,
				verse.id,
				firstWordIndex,
				lastWordIndex,
				arabicText,
				wbwTranslation,
				subtitlesProperties.isFullVerse, // isFullVerse
				subtitlesProperties.isLastWordsOfVerse, // isLastWordsOfVerse
				subtitlesProperties.translations // translations
			)
		);

		AnalyticsService.trackSubtitleAdded(surah);

		return true;
	}

	/**
	 * À partir d'un verset et d'une plage de mots, extrait les propriétés des sous-titres.
	 * @param verse Le verset à analyser.
	 * @param firstWordIndex L'index du premier mot de la plage.
	 * @param lastWordIndex L'index du dernier mot de la plage.
	 * @param surah Le numéro de la sourate.
	 * @returns Un objet contenant les propriétés des sous-titres.
	 * @returns {isFullVerse, isLastWordsOfVerse, translations}
	 */
	async getSubtitlesProperties(
		verse: Verse,
		firstWordIndex: number,
		lastWordIndex: number,
		surah: number
	): Promise<{
		isFullVerse: boolean;
		isLastWordsOfVerse: boolean;
		translations: { [key: string]: VerseTranslation };
	}> {
		const isFullVerse = verse.words.length === lastWordIndex - firstWordIndex + 1;
		const isLastWordsOfVerse = verse.words.length - lastWordIndex - 1 === 0;

		// Prépare les traductions du sous-titre
		let translations: { [key: string]: VerseTranslation } = {};
		if (globalState.currentProject)
			translations = await globalState.getProjectTranslation.getTranslations(
				surah,
				verse.id,
				isFullVerse
			);

		return {
			isFullVerse,
			isLastWordsOfVerse,
			translations
		};
	}

	/**
	 * Retourne la sourate actuellement lue à la position du curseur (pour l'affiche du nom de la
	 * sourate sur la vidéo)
	 */
	getCurrentSurah(time?: number): number {
		const cursorPos = time !== undefined ? time : globalState.getTimelineState.cursorPosition;

		const currentClip = this.getCurrentClip(cursorPos);

		if (currentClip instanceof SubtitleClip) {
			return currentClip.surah;
		} else if (currentClip !== null) {
			// Prend le clip de sous-titre précédent
			const previousClip = this.getSubtitleBefore(this.clips.indexOf(currentClip));
			if (previousClip) {
				return previousClip.surah;
			}
			const nextClip = this.getSubtitleAfter(this.clips.indexOf(currentClip));
			if (nextClip) {
				return nextClip.surah;
			}
		} else {
			// Prend le dernier clip qui est un sous-titre dans le projet
			const lastSubtitleClip = this.clips.findLast((clip) => clip instanceof SubtitleClip);
			if (lastSubtitleClip) {
				return lastSubtitleClip.surah;
			}
		}
		return -1;
	}

	/**
	 * Ajoute un clip de silence à la piste.
	 * @param beforeClipOfId Si spécifié, ajoute le silence avant le clip avec cet ID.
	 * @returns true si le silence a été ajouté, false sinon.
	 */
	addSilence(beforeClipOfId: number = -1): boolean {
		if (beforeClipOfId === -1) {
			const startTime = this.getDuration().ms + 1;
			const endTime = globalState.currentProject?.projectEditorState.timeline.cursorPosition || -1;

			if (endTime < startTime) {
				toast.error('End time must be greater than start time.');
				return false;
			}

			this.clips.push(new SilenceClip(startTime, endTime));

			return true;
		} else {
			// Trouve le clip avant lequel ajouter le silence
			for (let i = 0; i < this.clips.length; i++) {
				const element = this.clips[i];

				if (element.id === beforeClipOfId) {
					const previousClip = i > 0 ? this.clips[i - 1] : null;

					if (previousClip) {
						const startTime = previousClip.endTime + 1;
						const endTime = startTime + 500; // Durée de 500ms par défaut

						// Vérifie si le clip actuel fera moins de 100ms
						if (element.endTime - (endTime + 1) < 100) {
							toast.error('Cannot add silence: resulting clip duration would be less than 100ms.');
							return false;
						}

						// Insert le clip silence avant le clip spécifié
						this.clips.splice(i, 0, new SilenceClip(startTime, endTime));

						// Change le startTime du clip spécifié pour éviter les chevauchements
						element.setStartTime(endTime + 1);
						return true;
					} else {
						// Ajoute le silence au début de la piste
						const startTime = 0;
						const endTime = 500; // Durée de 500ms par défaut
						if (element.endTime - (endTime + 1) < 100) {
							toast.error('Cannot add silence: resulting clip duration would be less than 100ms.');
							return false;
						}
						this.clips.unshift(new SilenceClip(startTime, endTime));
						// Change le startTime du clip spécifié pour éviter les chevauchements
						element.setStartTime(endTime + 1);
						return true;
					}
				}
			}
		}

		return false;
	}

	addPredefinedSubtitle(type: PredefinedSubtitleType): boolean {
		const startTime = this.getDuration().ms + 1;
		const endTime = globalState.currentProject?.projectEditorState.timeline.cursorPosition || -1;

		if (endTime < startTime) {
			toast.error('End time must be greater than start time.');
			return false;
		}

		this.clips.push(new PredefinedSubtitleClip(startTime, endTime, type));

		return true;
	}

	/**
	 * Renvoie le clip de sous-titre avant l'index spécifié.
	 * @param i L'index du clip pour lequel on veut trouver le clip de sous-titre précédent.
	 * @returns Le clip de sous-titre précédent ou null s'il n'existe pas.
	 */
	getSubtitleBefore(i: number, allowPredefined: boolean = false): SubtitleClip | null {
		if (i <= 0) {
			return null;
		}

		do {
			i--;
		} while (
			i >= 0 &&
			!(
				this.clips[i] instanceof SubtitleClip ||
				(allowPredefined && this.clips[i] instanceof PredefinedSubtitleClip)
			)
		);

		return this.clips[i] as SubtitleClip | null;
	}

	/**
	 * Renvoie le clip de sous-titre après l'index spécifié.
	 * @param i L'index du clip pour lequel on veut trouver le clip de sous-titre suivant.
	 * @returns Le clip de sous-titre suivant ou null s'il n'existe pas.
	 */
	getSubtitleAfter(i: number, allowPredefined: boolean = false): SubtitleClip | null {
		if (i < 0 || i >= this.clips.length - 1) {
			return null;
		}

		do {
			i++;
		} while (
			i < this.clips.length &&
			!(
				this.clips[i] instanceof SubtitleClip ||
				(allowPredefined && this.clips[i] instanceof PredefinedSubtitleClip)
			)
		);

		return this.clips[i] as SubtitleClip | null;
	}

	getCurrentSubtitleToDisplay(
		anyType: boolean = false
	): SubtitleClip | PredefinedSubtitleClip | null | Clip {
		const cursorPos = globalState.getTimelineState.cursorPosition;
		for (let i = 0; i < this.clips.length; i++) {
			const clip = this.clips[i];

			if (
				cursorPos >= clip.startTime &&
				cursorPos <= clip.endTime &&
				(anyType || clip instanceof SubtitleClip || clip instanceof PredefinedSubtitleClip)
			) {
				return clip;
			}
		}
		return null;
	}

	/**
	 * Décale tous les sous-titres de la piste d'un certain temps.
	 * @param offsetMs Le décalage en millisecondes (positif ou négatif).
	 * @returns true si le décalage a été appliqué, false sinon (ex: décalage impossible car temps < 0).
	 */
	shiftAllClips(offsetMs: number): boolean {
		if (this.clips.length === 0) return true;

		// Vérification préliminaire : est-ce que le décalage rendrait un temps négatif ?
		// On assume que les clips sont triés par ordre chronologique ou au moins que le premier a le startTime le plus bas
		// Pour être sûr, on check tous les clips
		for (const clip of this.clips) {
			if (clip.startTime + offsetMs < 0) {
				toast.error('Cannot shift: one or more subtitles would start before 0ms.');
				return false;
			}
		}

		// Applique le décalage
		for (const clip of this.clips) {
			// On met à jour directement les propriétés sans passer par les setters 'intelligents'
			// qui checkent les chevauchements avec les voisins, car ON DÉCALE TOUT LE MONDE EN MÊME TEMPS.
			// Cependant, on utilise quand même setStartTime/setEndTime pour la consistance si besoin,
			// mais ici on fait confiance à la logique globale.
			// Attention : clip.startTime et clip.endTime sont des $state, donc réactifs.

			// On modifie d'abord endTime puis startTime ou l'inverse n'a pas d'importance
			// tant qu'on ne trigger pas de logique de collision inter-clips.
			// Les clips ne se chevaucheront pas plus qu'avant puisqu'ils bougent tous de la même valeur.

			clip.startTime += offsetMs;
			clip.endTime += offsetMs;
			// duration reste la même
		}

		return true;
	}
}

export class CustomTextTrack extends Track {
	constructor() {
		super(TrackType.CustomClip);
	}

	async addCustomClip(
		customClipCategory: Category,
		clipType: 'text' | 'image',
		startTime?: number,
		endTime?: number
	) {
		// Si des durées sont spécifiées, alors on désactive l'option "always show"
		if (startTime !== undefined && endTime !== undefined) {
			customClipCategory.getStyle('always-show')!.value = false;
			customClipCategory.getStyle('time-appearance')!.value = startTime;
			customClipCategory.getStyle('time-disappearance')!.value = endTime;
		}

		let clip: any;
		if (clipType === 'image') {
			// Ajoute un clip image

			// Ouvre la modale de sélection d'image
			let imagePath = '';

			const result = await open({
				multiple: false,
				directory: false,
				filters: [
					{
						name: 'Image Files',
						extensions: ['png', 'jpg', 'jpeg', 'gif']
					}
				]
			});

			if (result) {
				imagePath = result as string;
				customClipCategory.getStyle('filepath')!.value = imagePath;
			} else {
				return; // Annule l'ajout du clip si aucun fichier n'est sélectionné
			}

			clip = new CustomImageClip(customClipCategory);
		} else {
			clip = new CustomTextClip(customClipCategory);
		}

		// Set les temps si spécifiés
		if (startTime !== undefined && endTime !== undefined) {
			clip.startTime = startTime;
			clip.endTime = endTime;
		}

		this.clips.push(clip);

		// Trigger la réactivé dans la videopreview pour afficher le clip ajouté (si le curseur est dessus)
		globalState.updateVideoPreviewUI();
	}

	getCurrentClips(): CustomClip[] {
		// Retourne tout les clips à afficher
		const currentTime = globalState.currentProject?.projectEditorState.timeline.cursorPosition ?? 0;
		const clips: CustomClip[] = [];

		for (let index = 0; index < this.clips.length; index++) {
			const element = this.clips[index] as CustomClip;
			if (
				element.getAlwaysShow() ||
				(currentTime >= element.startTime && currentTime <= element.endTime)
			) {
				clips.push(element);
			}
		}

		return clips;
	}

	getCustomTextWithId(categoryId: string) {
		return this.clips.find(
			(clip) => clip instanceof CustomTextClip && clip.category!.id === categoryId
		) as CustomTextClip | undefined;
	}
}

// Enregistre les classes enfants pour la désérialisation automatique
SerializableBase.registerChildClass(Track, 'clips', Clip);
