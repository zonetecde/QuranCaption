import { globalState } from '$lib/runes/main.svelte';
import { SerializableBase } from '../misc/SerializableBase';
import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
import type { RawCategoryDefinition } from '$lib/services/StyleDefinitionCatalog';
import { Category } from './Category.svelte';
import { Style } from './Style.svelte';
import { getPreviewKeyframeFadeDuration, styleLookupCache } from './styleRuntime';
import type { StyleKeyframe, StyleName, StyleOverrideValue } from './types';
import { StyleCssGenerator } from './StyleCssGenerator';
import { StyleOverrideService, type StyleOverrideContext } from './StyleOverrideService';

export class StylesData extends SerializableBase {
	categories: Category[] = $state([]);
	target: 'global' | 'arabic' | string = $state('');

	// Overrides spécifiques aux clips sélectionnés
	overrides: { [clipId: number]: { [styleId in StyleName]?: StyleOverrideValue } } = $state({});
	overrideKeyframes: {
		[clipId: number]: { [styleId in StyleName]?: StyleKeyframe[] };
	} = $state({});

	/**
	 * Initialise les styles d'une cible et normalise leurs catégories.
	 * @param {'global' | 'arabic' | string} target Cible à laquelle les styles s'appliquent.
	 * @param {Array<Category | RawCategoryDefinition>} categories Catégories initiales.
	 */
	constructor(
		target: 'global' | 'arabic' | string,
		categories: Array<Category | RawCategoryDefinition> = []
	) {
		super();
		this.target = target;
		// S'assurer que chaque élément passé est bien une instance de Category
		// (les JSON importés depuis les fichiers contiennent seulement les attributs)
		this.categories = (categories || []).map((c) => (c instanceof Category ? c : new Category(c)));
	}

	/**
	 * Génère le CSS pour tous les styles actifs.
	 * @param {number} [clipId] Identifiant du clip dont les overrides doivent être appliqués.
	 * @param {string[]} excludedCategories Catégories à exclure du CSS généré.
	 * @returns {string} Déclarations CSS actives.
	 */
	generateCSS(clipId?: number, excludedCategories: string[] = []): string {
		return StyleCssGenerator.generate(
			{
				target: this.target,
				categories: this.categories,
				getEffectiveValue: this.getEffectiveValue.bind(this)
			},
			clipId,
			excludedCategories
		);
	}

	/**
	 * Génère les classes Tailwind pour tous les styles actifs.
	 * @returns {string} Chaîne de classes Tailwind.
	 */
	generateTailwind(): string {
		const currentTime =
			globalState.currentProject?.projectEditorState?.timeline.cursorPosition ?? 0;
		return StyleCssGenerator.generateTailwind(this.categories, currentTime);
	}

	/**
	 * Définit la valeur d'un style
	 * @param {StyleName} styleId L'ID du style à modifier.
	 * @param {Style['value']} value La nouvelle valeur à appliquer.
	 * @returns {void}
	 */
	setStyle(styleId: StyleName, value: Style['value']): void {
		ProjectHistoryManager.begin('set style');
		try {
			// Trouve le style
			const style = this.findStyle(styleId);
			if (style) {
				style.value = value;
				styleLookupCache.delete(this);
			}
		} finally {
			ProjectHistoryManager.commit();
		}
	}

	/**
	 * Trouve un style par son ID
	 * @param {StyleName} styleId L'ID du style à trouver.
	 * @returns {Style | undefined} Style correspondant ou `undefined` s'il n'est pas trouvé.
	 */
	findStyle(styleId: StyleName): Style | undefined {
		let cache = styleLookupCache.get(this);
		if (!cache) {
			cache = new Map();
			styleLookupCache.set(this, cache);
		}

		const cachedStyle = cache.get(styleId);
		if (cachedStyle) return cachedStyle;

		for (const category of this.categories) {
			const style = category.styles.find((s) => s.id === styleId);
			if (style) {
				cache.set(styleId, style);
				return style;
			}
		}
		return undefined;
	}

	/** Ajoute ou remplace une image clé. @param {StyleName} styleId Style animé. @param {number} time Position en millisecondes. @param {Style['value']} value Valeur active. @param {number[]} clipIds Clips ciblés. @returns {void} */
	setKeyframe(
		styleId: StyleName,
		time: number,
		value: Style['value'],
		clipIds: number[] = []
	): void {
		StyleOverrideService.setKeyframe(this.getOverrideContext(), styleId, time, value, clipIds);
	}

	/** Retourne les temps des images clés. @param {StyleName} styleId Style inspecté. @param {number[]} clipIds Clips ciblés. @returns {number[]} Temps triés. */
	getKeyframeTimes(styleId: StyleName, clipIds: number[] = []): number[] {
		return StyleOverrideService.getKeyframeTimes(this.getOverrideContext(), styleId, clipIds);
	}

	/** Collecte toutes les images clés de la cible. @returns {number[]} Temps triés. */
	getAllKeyframeTimes(): number[] {
		return StyleOverrideService.getAllKeyframeTimes(this.getOverrideContext());
	}

	/** Vérifie la présence d'une image clé. @param {StyleName} styleId Style inspecté. @param {number} time Position. @param {number[]} clipIds Clips ciblés. @returns {boolean} Résultat du contrôle. */
	hasKeyframeAt(styleId: StyleName, time: number, clipIds: number[] = []): boolean {
		return this.getKeyframeTimes(styleId, clipIds).includes(Math.max(0, Math.floor(time)));
	}

	/** Supprime une image clé. @param {StyleName} styleId Style modifié. @param {number} time Position. @param {number[]} clipIds Clips ciblés. @returns {void} */
	removeKeyframe(styleId: StyleName, time: number, clipIds: number[] = []): void {
		StyleOverrideService.removeKeyframe(this.getOverrideContext(), styleId, time, clipIds);
	}

	/** Définit un override pour plusieurs clips. @param {number[]} clipIds Clips ciblés. @param {StyleName} styleId Style modifié. @param {StyleOverrideValue} value Valeur locale. @returns {void} */
	setStyleForClips(clipIds: number[], styleId: StyleName, value: StyleOverrideValue): void {
		ProjectHistoryManager.begin('set clip style override');
		try {
			StyleOverrideService.setStyleForClips(this.getOverrideContext(), clipIds, styleId, value);
		} finally {
			ProjectHistoryManager.commit();
		}
	}

	/** Supprime un override de plusieurs clips. @param {number[]} clipIds Clips ciblés. @param {StyleName} styleId Style nettoyé. @returns {void} */
	clearStyleForClips(clipIds: number[], styleId: StyleName): void {
		ProjectHistoryManager.begin('clear clip style override');
		try {
			StyleOverrideService.clearStyleForClips(this.getOverrideContext(), clipIds, styleId);
		} finally {
			ProjectHistoryManager.commit();
		}
	}

	/** Résout la valeur effective d'un style. @param {StyleName} styleId Style à résoudre. @param {number} [clipId] Clip courant. @param {number} [time] Position absolue. @param {number} fadeDuration Durée du fondu. @returns {string | number | boolean} Valeur effective. */
	getEffectiveValue(
		styleId: StyleName,
		clipId?: number,
		time?: number,
		fadeDuration = getPreviewKeyframeFadeDuration()
	): string | number | boolean {
		return StyleOverrideService.getEffectiveValue(
			this.getOverrideContext(),
			styleId,
			clipId,
			time,
			fadeDuration
		);
	}

	/** Résout un style booléen sous forme d'opacité. @param {StyleName} styleId Style à résoudre. @param {number} [clipId] Clip courant. @param {number} [time] Position absolue. @param {number} fadeDuration Durée du fondu. @returns {number} Opacité effective. */
	getEffectiveVisibilityOpacity(
		styleId: StyleName,
		clipId?: number,
		time?: number,
		fadeDuration = getPreviewKeyframeFadeDuration()
	): number {
		return StyleOverrideService.getEffectiveVisibilityOpacity(
			this.getOverrideContext(),
			styleId,
			clipId,
			time,
			fadeDuration
		);
	}

	/** Vérifie un override sur plusieurs clips. @param {number[]} clipIds Clips ciblés. @param {StyleName} styleId Style recherché. @returns {boolean} Résultat du contrôle. */
	hasOverrideForAny(clipIds: number[], styleId: StyleName): boolean {
		return StyleOverrideService.hasOverrideForAny(this.getOverrideContext(), clipIds, styleId);
	}

	/** Vérifie les personnalisations d'un clip. @param {number} clipId Clip ciblé. @returns {boolean} Résultat du contrôle. */
	hasAnyOverrideForClip(clipId: number): boolean {
		return StyleOverrideService.hasAnyOverrideForClip(this.getOverrideContext(), clipId);
	}

	/** Construit le contexte non propriétaire utilisé par le service d'overrides. @returns {StyleOverrideContext} Références vers l'état courant. */
	private getOverrideContext(): StyleOverrideContext {
		return {
			target: this.target,
			categories: this.categories,
			overrides: this.overrides,
			overrideKeyframes: this.overrideKeyframes,
			findStyle: this.findStyle.bind(this)
		};
	}

	/**
	 * Créer les styles composites s'ils n'existent pas déjà
	 * @returns {Promise<void>} Promesse résolue lorsque tous les composites sont chargés.
	 */
	async loadCompositeStyles() {
		for (const category of this.categories) {
			await category.loadCompositeStyle();
		}
	}

	/**
	 * Get - et créer si nécessaire - les styles composites pour un style donné
	 * @param {StyleName} compositeStyleId L'identifiant du style composite.
	 * @returns {Style[]} Styles internes du composite.
	 */
	getCompositeStyles(compositeStyleId: StyleName): Style[] {
		// Try catch au cas où le style composite n'a toujours pas été créé
		const style = this.findStyle(compositeStyleId);

		if (style) {
			if (style.value instanceof Array) return style.value as Style[];
			// Style par défaut non encore créé si on arrive là.
		}

		// Si non trouvé, alors cherche parmis les textes composites des customs text
		return globalState.getVideoStyle.getCustomTextCompositeStyles(compositeStyleId);
	}
}
