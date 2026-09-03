import { SerializableBase } from '../misc/SerializableBase';
import { globalState } from '$lib/runes/main.svelte';
import type { TimedOverlayRange } from '$lib/services/TimedOverlayRanges';
import {
	getPreviewKeyframeFadeDuration,
	resolveKeyframeVisibilityOpacity,
	resolvePreviewKeyframeValue
} from './styleRuntime';
import type { StyleKeyframe, StyleName, StyleValueType } from './types';

export class Style extends SerializableBase {
	id: string = $state('');
	name: string = '';
	description: string = '';
	value:
		| string
		| number
		| boolean
		| { width: number; height: number }
		| {
				fadeDurationMs: number;
				videoFadeInEnabled: boolean;
				videoFadeOutEnabled: boolean;
				audioFadeInEnabled: boolean;
				audioFadeOutEnabled: boolean;
		  }
		| TimedOverlayRange[]
		| Style[] = $state('');
	valueType: StyleValueType = 'text';
	valueMin?: number = $state(-540);
	valueMax?: number = $state(540);
	step?: number;
	options?: string[];
	css: string = '';
	tailwind?: boolean;
	tailwindClass?: string;
	icon: string = '';
	keyframes: StyleKeyframe[] = $state([]);

	/**
	 * Initialise un style depuis ses valeurs sérialisées.
	 * @param {Partial<Style>} [init] Valeurs initiales du style.
	 */
	constructor(init?: Partial<Style>) {
		super();
		if (!init) return;
		Object.assign(this, init);
	}

	/**
	 * Ajoute ou remplace l'image clé située au temps demandé.
	 * @param {number} time Position absolue dans la timeline, en millisecondes.
	 * @param {Style['value']} value Valeur active à partir de cette position.
	 * @returns {void}
	 */
	setKeyframe(time: number, value: Style['value']): void {
		const normalizedTime = Math.max(0, Math.floor(time));
		const existing = this.keyframes.find((keyframe) => keyframe.time === normalizedTime);
		if (existing) existing.value = value;
		else this.keyframes.push({ time: normalizedTime, value });
		this.keyframes.sort((a, b) => a.time - b.time);
	}

	/**
	 * Résout la valeur active à une position de la timeline.
	 * @param {number} time Position absolue dans la timeline, en millisecondes.
	 * @param {number} fadeDuration Durée du fondu entre images clés en millisecondes.
	 * @returns {Style['value']} Valeur de base ou dernière image clé atteinte.
	 */
	getValueAt(time: number, fadeDuration = getPreviewKeyframeFadeDuration()): Style['value'] {
		return resolvePreviewKeyframeValue(this, this.keyframes, time, this.value, fadeDuration);
	}

	/**
	 * Résout les images clés booléennes sous forme d'opacité de visibilité.
	 * @param {number} time Position absolue dans la timeline.
	 * @param {number} fadeDuration Durée du fondu en millisecondes.
	 * @returns {number} Opacité entre zéro et un.
	 */
	getVisibilityOpacityAt(time: number, fadeDuration = getPreviewKeyframeFadeDuration()): number {
		return resolveKeyframeVisibilityOpacity(this.keyframes, time, this.value, fadeDuration);
	}

	/**
	 * Indique si une image clé existe au temps demandé.
	 * @param {number} time Position absolue dans la timeline, en millisecondes.
	 * @returns {boolean} `true` si le temps contient une image clé.
	 */
	hasKeyframeAt(time: number): boolean {
		const normalizedTime = Math.max(0, Math.floor(time));
		return this.keyframes.some((keyframe) => keyframe.time === normalizedTime);
	}

	/**
	 * Supprime l'image clé située au temps demandé.
	 * @param {number} time Position absolue dans la timeline, en millisecondes.
	 * @returns {void}
	 */
	removeKeyframe(time: number): void {
		const normalizedTime = Math.max(0, Math.floor(time));
		this.keyframes = this.keyframes.filter((keyframe) => keyframe.time !== normalizedTime);
	}

	/**
	 * Retourne l'image clé précédant strictement la position courante.
	 * @param {number} time Position absolue dans la timeline, en millisecondes.
	 * @returns {number | undefined} Temps précédent, ou `undefined`.
	 */
	getPreviousKeyframeTime(time: number): number | undefined {
		return this.keyframes.findLast((keyframe) => keyframe.time < time)?.time;
	}

	/**
	 * Retourne l'image clé suivant strictement la position courante.
	 * @param {number} time Position absolue dans la timeline, en millisecondes.
	 * @returns {number | undefined} Temps suivant, ou `undefined`.
	 */
	getNextKeyframeTime(time: number): number | undefined {
		return this.keyframes.find((keyframe) => keyframe.time > time)?.time;
	}

	/**
	 * Recherche la catégorie qui contient ce style dans la configuration courante.
	 * @returns {string} Identifiant de la catégorie, ou une chaîne vide si elle est introuvable.
	 */
	getCategory(): string {
		for (const category of globalState.getVideoStyle.getStylesOfTarget('arabic').categories) {
			if (category.styles.some((style) => style.id === this.id)) {
				return category.id;
			}
		}
		for (const category of globalState.getVideoStyle.getStylesOfTarget('global').categories) {
			if (category.styles.some((style) => style.id === this.id)) {
				return category.id;
			}
		}
		return '';
	}

	/**
	 * Méthode utile uniquement si valueType est composite.
	 * Génère le CSS d'un style composite
	 * @param {number} [time] Position de la timeline en millisecondes.
	 * @returns {string} CSS généré pour ce style composite.
	 */
	generateCSSForComposite(time?: number): string {
		// Récupère tous les styles composites pour un style donné
		const compositeStyles = this.value as Style[];
		const currentTime =
			time ?? globalState.currentProject?.projectEditorState?.timeline.cursorPosition ?? 0;

		let css = '';
		for (let i = 0; i < compositeStyles.length; i++) {
			const element = compositeStyles[i];
			const effectiveValue = element.getValueAt(currentTime);

			if (element.id === 'outline-enable' && !effectiveValue) {
				// Si on désactive l'outline, alors on skip les 3 styles concernant l'outline
				// (en comptant celui là)
				i += 2;
				continue;
			}

			if (element.id === 'text-glow-enable' && !effectiveValue) {
				// Si on désactive le glow, alors on skip les 3 styles concernant le glow
				// (en comptant celui là)
				i += 2;
				continue;
			}

			if (element.id === 'enable-italic' && !effectiveValue) {
				continue;
			}

			if (element.id && element.css)
				css += element.css.replaceAll('{value}', String(effectiveValue)) + '\n';
		}

		return css;
	}

	/**
	 * Méthode utile uniquement si valueType est composite.
	 * @param {StyleName} styleId Le nom du style.
	 * @param {string | number | boolean} value La nouvelle valeur à appliquer.
	 * @returns {void}
	 */
	setCompositeStyleValue(styleId: StyleName, value: string | number | boolean) {
		if (this.valueType === 'composite') {
			const style = this.getCompositeStyle(styleId);
			if (style) {
				style.value = value;
			}
		}
	}

	/**
	 * Méthode utile uniquement si valueType est composite.
	 * Récupère un style composite par son ID
	 * @param {StyleName} styleId L'ID du style à récupérer.
	 * @returns {Style | undefined} Style composite correspondant ou `undefined`.
	 */
	getCompositeStyle(styleId: StyleName): Style | undefined {
		if (this.valueType === 'composite' && this.value instanceof Array) {
			const v = (this.value as Style[]).find((s) => s.id === styleId);
			if (v) return v;
		}

		// Le style composite n'a toujours pas été chargé
		return new Style({ id: styleId, value: 0 });
	}
}
