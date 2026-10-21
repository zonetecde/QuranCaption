import { SerializableBase } from '../misc/SerializableBase';
import {
	loadCompositeStyleDefinitions,
	type RawCategoryDefinition,
	type RawStyleDefinition
} from '$lib/services/StyleDefinitionCatalog';
import { Style } from './Style.svelte';
import { collectStyleKeyframeTimes } from './styleRuntime';
import type { StyleCategoryUiMetadata, StyleName } from './types';

export class Category extends SerializableBase {
	id: string = $state('');
	name: string = '';
	description: string = '';
	icon: string = '';
	styles: Style[] = $state([]);
	declare ui?: StyleCategoryUiMetadata;

	/**
	 * Initialise une catégorie et convertit ses définitions brutes en instances de style.
	 * @param {Partial<Category> | RawCategoryDefinition} [init] Valeurs initiales de la catégorie.
	 */
	constructor(init?: Partial<Category> | RawCategoryDefinition) {
		super();
		if (!init) return;
		// assign simples
		const { styles, ui, ...rest } = init;
		Object.assign(this, rest);
		this.setUiMetadata(ui);

		// s'assurer que les styles sont des instances de Style
		if (Array.isArray(styles)) {
			this.styles = styles.map((s) => (s instanceof Style ? s : new Style(s)));
		}
	}

	/**
	 * Attache les métadonnées d'éditeur sans les sérialiser dans le projet.
	 * @param {StyleCategoryUiMetadata | undefined} ui Métadonnées issues du JSON statique.
	 * @returns {void}
	 */
	setUiMetadata(ui: StyleCategoryUiMetadata | undefined): void {
		Object.defineProperty(this, 'ui', {
			configurable: true,
			enumerable: false,
			writable: true,
			value: ui
		});
	}

	/**
	 * Recherche un style direct de la catégorie.
	 * @param {StyleName} styleId Identifiant du style recherché.
	 * @returns {Style | undefined} Style correspondant, s'il existe.
	 */
	getStyle(styleId: StyleName): Style | undefined {
		return this.styles.find((style) => style.id === styleId);
	}

	/**
	 * Retourne le premier style composite de la catégorie.
	 * @returns {Style | undefined} Style composite, s'il existe.
	 */
	getCompositeStyle(): Style | undefined {
		for (const style of this.styles) {
			if (style.valueType === 'composite') {
				return style;
			}
		}
		return undefined;
	}

	/**
	 * Collecte les images clés de tous les styles de la catégorie.
	 * @returns {number[]} Temps trouvés en millisecondes.
	 */
	getAllKeyframeTimes(): number[] {
		return this.styles.flatMap(collectStyleKeyframeTimes);
	}

	/**
	 * Initialise les composites et complète les anciens sans écraser leurs valeurs.
	 * @param {RawStyleDefinition[]} [defaults] Définitions déjà chargées du catalogue composite.
	 * @returns {Promise<boolean>} Vrai si un composite a été initialisé ou complété.
	 */
	async loadCompositeStyle(defaults?: RawStyleDefinition[]): Promise<boolean> {
		let hasChanges = false;
		for (const style of this.styles) {
			if (style.valueType !== 'composite') continue;
			const raw = defaults ?? (await loadCompositeStyleDefinitions());
			if (Array.isArray(style.value)) {
				const children = style.value as Style[];
				for (const definition of raw) {
					if (!children.some((existing) => existing.id === definition.id)) {
						children.push(new Style(definition));
						hasChanges = true;
					}
				}
			} else {
				// Transforme chaque entrée en véritable instance de Style
				style.value = raw.map((s) => (s instanceof Style ? s : new Style(s)));
				hasChanges = true;

				if (style.id === 'surah-latin-text-style' || style.id === 'reciter-latin-text-style') {
					style.setCompositeStyleValue('font-size', 30);
				}
			}
		}
		return hasChanges;
	}
}
