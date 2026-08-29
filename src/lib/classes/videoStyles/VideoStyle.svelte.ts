import { globalState } from '$lib/runes/main.svelte';
import { SerializableBase } from '../misc/SerializableBase';
import ModalManager from '$lib/components/modals/ModalManager';
import LL from '$lib/i18n/i18n-svelte';
import { get } from 'svelte/store';
import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
import type { ProjectContent } from '../ProjectContent.svelte';
import { getCustomCompositeStyles } from '$lib/services/ProjectStyleContentService';
import {
	applyStylePresetToProject,
	getPresetTranslationTargets
} from '$lib/services/StylePresetApplicationService';
import type { Style } from './Style.svelte';
import { StylesData } from './StylesData.svelte';
import type { StyleCategoryName, StyleName, VideoStyleFileData } from './types';
import { VideoStyleFactory } from './VideoStyleFactory';
import { VideoStyleCustomClipService } from './VideoStyleCustomClipService';
import { VideoStyleMetadataService } from './VideoStyleMetadataService';
import { VideoStyleNavigationService } from './VideoStyleNavigationService';
import { VideoStylePresetSerializer } from './VideoStylePresetSerializer';
import { VideoStylePresetFileService } from './VideoStylePresetFileService';
import { VideoStyleSchemaService } from './VideoStyleSchemaService';

export class VideoStyle extends SerializableBase {
	styles: StylesData[] = $state([]);

	lastUpdated: Date = $state(new Date());

	/** Initialise une collection vide de styles vidéo. */
	constructor() {
		super();
	}

	/**
	 * Collecte les changements temporels nécessaires à l'aperçu et à l'export.
	 * @returns {number[]} Temps uniques triés en millisecondes.
	 */
	getAllKeyframeTimes(): number[] {
		const times = this.styles.flatMap((styles) => styles.getAllKeyframeTimes());
		return Array.from(new Set(times)).sort((a, b) => a - b);
	}

	/**
	 * Recharge la configuration visuelle de l'éditeur depuis les JSON statiques.
	 * @returns {Promise<void>}
	 */
	async hydrateStyleEditorUiMetadata(): Promise<void> {
		await VideoStyleMetadataService.hydrate(this.styles);
	}

	/**
	 * Recopie les métadonnées UI non persistées lors d'une restauration undo/redo.
	 * @param {VideoStyle} source Styles du projet actuellement chargé.
	 * @returns {void}
	 */
	copyStyleEditorUiMetadataFrom(source: VideoStyle): void {
		VideoStyleMetadataService.copy(this.styles, source.styles);
	}

	/**
	 * Retourne les styles par défaut d'un projet
	 * @returns {Promise<VideoStyle>} Styles par défaut d'une vidéo.
	 */
	static async getDefaultVideoStyle(): Promise<VideoStyle> {
		const videoStyle = new VideoStyle();
		videoStyle.styles = await VideoStyleFactory.createDefaultCollections();
		if (globalState.currentProject)
			for (const translation of globalState.getProjectTranslation.addedTranslationEditions) {
				await videoStyle.addStylesForEdition(translation.name);
			}

		return videoStyle;
	}

	/**
	 * Obtient les styles d'une cible spécifique
	 * @param {'global' | 'arabic' | string} target La cible à interroger.
	 * @returns {StylesData} Styles de la cible.
	 */
	getStylesOfTarget(target: 'global' | 'arabic' | string): StylesData {
		const styles = this.styles.find((s) => s.target === target);
		return styles ? styles : new StylesData(target);
	}

	/**
	 * Update la valeur d'un style d'un custom text (depuis la track Custom Text)
	 * @param {StyleCategoryName} customTextId L'ID du texte custom.
	 * @param {StyleName} styleId L'ID du style à obtenir.
	 * @param {Style['value']} value La nouvelle valeur à appliquer.
	 * @returns {void}
	 */
	setCustomTextStyle(
		customTextId: StyleCategoryName,
		styleId: StyleName,
		value: Style['value']
	): void {
		ProjectHistoryManager.begin('set custom text style');
		try {
			VideoStyleCustomClipService.setStyle(customTextId, styleId, value);
		} finally {
			ProjectHistoryManager.commit();
		}
	}

	/**
	 * Vérifie si une cible possède déjà sa collection de styles.
	 * @param {string} target Identifiant de la cible recherchée.
	 * @returns {boolean} `true` lorsque la cible existe.
	 */
	doesTargetStyleExist(target: string): boolean {
		return this.styles.find((style) => style.target === target) !== undefined;
	}

	/**
	 * Ajoute les styles par défaut nécessaires à une édition de traduction.
	 * @param {string} translationEdition Identifiant de l'édition à enregistrer.
	 * @returns {Promise<void>} Promesse résolue une fois les styles ajoutés ou déjà présents.
	 */
	async addStylesForEdition(translationEdition: string) {
		if (this.doesTargetStyleExist(translationEdition)) return;
		this.styles.push(await VideoStyleFactory.createTranslationStyles(translationEdition));
	}

	/**
	 * Merge les styles manquants avec les JSON par défaut, sans écraser les valeurs existantes.
	 * Utile quand de nouveaux styles sont ajoutés dans une update.
	 * @param {ProjectContent | undefined} projectContent Contenu explicite pour les clips personnalisés.
	 * @returns {Promise<boolean>} `true` lorsque le schéma a été complété.
	 */
	async ensureStylesSchemaUpToDate(projectContent?: ProjectContent): Promise<boolean> {
		const content = projectContent ?? globalState.currentProject?.content;
		return VideoStyleSchemaService.ensureUpToDate(this.styles, content);
	}

	/**
	 * Ajoute un clip personnalisé au projet dans les styles globaux
	 * @param {'text' | 'image'} clipType Type du contenu personnalisé.
	 * @param {number} [startTime] Début facultatif du clip en millisecondes.
	 * @param {number} [endTime] Fin facultative du clip en millisecondes.
	 * @returns {Promise<void>} Promesse résolue lorsque le clip est ajouté.
	 */
	async addCustomClip(
		clipType: 'text' | 'image',
		startTime?: number,
		endTime?: number
	): Promise<void> {
		ProjectHistoryManager.begin('add custom clip');
		try {
			await VideoStyleCustomClipService.add(clipType, startTime, endTime);
		} finally {
			ProjectHistoryManager.commit();
		}
	}

	/**
	 * Recherche parmis tout les targets qu'on a s'il existe un override pour
	 * un clip donné
	 * @param {number} id L'ID du clip à vérifier.
	 * @param {boolean} includeGlobal Inclut les styles globaux dans la recherche.
	 * @returns {boolean} `true` lorsqu'au moins un override existe.
	 */
	hasAnyOverrideForClip(id: number, includeGlobal: boolean = false): boolean {
		for (const stylesData of this.styles) {
			if (!includeGlobal && stylesData.target === 'global') continue;
			if (stylesData.hasAnyOverrideForClip(id)) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Retourne les styles du style composite d'un custom text
	 * @param {string} customTextId L'id du customText.
	 * @param {ProjectContent | undefined} projectContent Projet explicite à parcourir.
	 * @returns {Style[]} Styles du composite, ou une liste vide.
	 */
	getCustomTextCompositeStyles(customTextId: string, projectContent?: ProjectContent): Style[] {
		const content = projectContent ?? globalState.currentProject?.content;
		return content ? getCustomCompositeStyles(content, customTextId) : [];
	}

	/**
	 * Exporte les styles vers un fichier
	 * @param {Set<number>} includedExportClips Liste des contenus personnalisés à inclure.
	 * @param {ProjectContent | undefined} projectContent Projet explicite lors d'un export headless.
	 * @returns {VideoStyleFileData} Données exportées au format JSON.
	 */
	exportStylesData(
		includedExportClips: Set<number>,
		projectContent?: ProjectContent
	): VideoStyleFileData {
		return VideoStylePresetSerializer.serialize(
			this,
			includedExportClips,
			projectContent ?? globalState.currentProject?.content
		);
	}

	/**
	 * Sérialise un preset de styles au format JSON historique.
	 * @param {Set<number>} includedExportClips Contenus personnalisés à inclure.
	 * @param {ProjectContent | undefined} projectContent Projet explicite lors d'un export headless.
	 * @returns {string} Preset JSON formaté.
	 */
	exportStyles(includedExportClips: Set<number>, projectContent?: ProjectContent): string {
		return JSON.stringify(this.exportStylesData(includedExportClips, projectContent), null, 2);
	}

	/**
	 * Ouvre un fichier de styles, le valide puis l'applique au projet courant.
	 * @returns {Promise<void>} Promesse résolue après l'import ou son annulation.
	 */
	async importStylesFromFile() {
		const preset = await VideoStylePresetFileService.select();
		if (preset) await globalState.getVideoStyle.importStyles(preset);
	}

	/**
	 * Importe un preset dans le style courant, éventuellement pour un projet chargé hors interface.
	 * @param {VideoStyleFileData} json Données du preset.
	 * @param {ProjectContent | undefined} projectContent Contenu explicite à modifier sans état global.
	 * @returns {Promise<void>} Promesse résolue après la mise à jour du schéma.
	 */
	async importStyles(json: VideoStyleFileData, projectContent?: ProjectContent): Promise<void> {
		if (!projectContent) ProjectHistoryManager.begin('import styles');
		try {
			const content = projectContent ?? globalState.currentProject?.content;
			if (!content) throw new Error('Cannot import styles without a project');
			const translationAssignments: Record<string, string> = {};
			if (!projectContent) {
				const availableTargets = getPresetTranslationTargets(json);
				for (const translation of content.projectTranslation.addedTranslationEditions) {
					if (availableTargets.includes(translation.name)) continue;
					for (const sourceTarget of availableTargets) {
						const confirm = await ModalManager.confirmModal(
							get(LL).translations.translationNoStyles({ name: translation.name }),
							true
						);
						if (!confirm) continue;
						translationAssignments[translation.name] = sourceTarget;
						break;
					}
				}
			}

			await applyStylePresetToProject({
				videoStyle: this,
				projectContent: content,
				data: json,
				translationAssignments
			});
		} finally {
			if (!projectContent) ProjectHistoryManager.commit();
		}
	}

	/**
	 * Highlight dans le gestionnaire de style la catégorie en paramètre
	 * @param {string} target La cible à mettre en évidence.
	 * @param {StyleCategoryName} categoryName La catégorie à mettre en évidence.
	 * @returns {void}
	 */
	highlightCategory(target: string, categoryName: StyleCategoryName) {
		VideoStyleNavigationService.highlight(target, categoryName);
	}

	/**
	 * Demande confirmation puis restaure tous les styles par défaut.
	 * @returns {Promise<void>} Promesse résolue après la réinitialisation ou son annulation.
	 */
	async resetStyles() {
		ProjectHistoryManager.begin('reset styles');
		try {
			const confirmation = await ModalManager.confirmModal(
				get(LL).translations.resetAllStylesConfirm(),
				false
			);
			if (!confirmation) return;

			// Réinitialise les styles
			globalState.currentProject!.content.videoStyle = await VideoStyle.getDefaultVideoStyle();
		} finally {
			ProjectHistoryManager.commit();
		}
	}
}
