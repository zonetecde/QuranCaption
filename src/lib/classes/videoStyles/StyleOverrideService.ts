import { globalState } from '$lib/runes/main.svelte.js';
import type { Category } from './Category.svelte.js';
import type { Style } from './Style.svelte.js';
import {
	isGlobalOverlayStyleId,
	resolveKeyframeVisibilityOpacity,
	resolvePreviewKeyframeValue
} from './styleRuntime.js';
import type { StyleKeyframe, StyleName, StyleOverrideValue } from './types.js';

export type StyleOverrideMap = {
	[clipId: number]: { [styleId in StyleName]?: StyleOverrideValue };
};

export type StyleKeyframeOverrideMap = {
	[clipId: number]: { [styleId in StyleName]?: StyleKeyframe[] };
};

export type StyleOverrideContext = {
	target: string;
	categories: Category[];
	overrides: StyleOverrideMap;
	overrideKeyframes: StyleKeyframeOverrideMap;
	findStyle: (styleId: StyleName) => Style | undefined;
};

/** Gère les valeurs et images clés spécifiques aux clips. */
export class StyleOverrideService {
	/**
	 * Ajoute ou remplace une image clé globale ou locale.
	 * @param {StyleOverrideContext} context État des overrides.
	 * @param {StyleName} styleId Style à animer.
	 * @param {number} time Position en millisecondes.
	 * @param {Style['value']} value Valeur de l'image clé.
	 * @param {number[]} clipIds Clips ciblés, ou liste vide pour le style de base.
	 * @returns {void}
	 */
	static setKeyframe(
		context: StyleOverrideContext,
		styleId: StyleName,
		time: number,
		value: Style['value'],
		clipIds: number[]
	): void {
		if (!clipIds.length) {
			context.findStyle(styleId)?.setKeyframe(time, value);
			return;
		}
		if (context.target === 'global' && !isGlobalOverlayStyleId(styleId)) return;
		const normalizedTime = Math.max(0, Math.floor(time));
		for (const clipId of clipIds) {
			context.overrideKeyframes[clipId] ??= {};
			const keyframes = (context.overrideKeyframes[clipId][styleId] ??= []);
			const existing = keyframes.find((keyframe) => keyframe.time === normalizedTime);
			if (existing) existing.value = value;
			else keyframes.push({ time: normalizedTime, value });
			keyframes.sort((left, right) => left.time - right.time);
		}
	}

	/**
	 * Retourne les temps uniques des images clés d'une portée.
	 * @param {StyleOverrideContext} context État des overrides.
	 * @param {StyleName} styleId Style inspecté.
	 * @param {number[]} clipIds Clips inspectés.
	 * @returns {number[]} Temps triés en millisecondes.
	 */
	static getKeyframeTimes(
		context: StyleOverrideContext,
		styleId: StyleName,
		clipIds: number[]
	): number[] {
		const times = !clipIds.length
			? (context.findStyle(styleId)?.keyframes.map((keyframe) => keyframe.time) ?? [])
			: clipIds.flatMap((clipId) =>
					(context.overrideKeyframes[clipId]?.[styleId] ?? []).map((keyframe) => keyframe.time)
				);
		return Array.from(new Set(times)).sort((left, right) => left - right);
	}

	/**
	 * Collecte toutes les images clés d'une cible.
	 * @param {StyleOverrideContext} context État des overrides.
	 * @returns {number[]} Temps uniques triés.
	 */
	static getAllKeyframeTimes(context: StyleOverrideContext): number[] {
		const baseTimes = context.categories.flatMap((category) => category.getAllKeyframeTimes());
		const overrideTimes = Object.values(context.overrideKeyframes).flatMap((byStyle) =>
			Object.values(byStyle).flatMap((keyframes) =>
				(keyframes ?? []).map((keyframe) => keyframe.time)
			)
		);
		return Array.from(new Set([...baseTimes, ...overrideTimes])).sort(
			(left, right) => left - right
		);
	}

	/**
	 * Supprime une image clé globale ou locale.
	 * @param {StyleOverrideContext} context État des overrides.
	 * @param {StyleName} styleId Style modifié.
	 * @param {number} time Position en millisecondes.
	 * @param {number[]} clipIds Clips ciblés.
	 * @returns {void}
	 */
	static removeKeyframe(
		context: StyleOverrideContext,
		styleId: StyleName,
		time: number,
		clipIds: number[]
	): void {
		if (!clipIds.length) {
			context.findStyle(styleId)?.removeKeyframe(time);
			return;
		}
		const normalizedTime = Math.max(0, Math.floor(time));
		for (const clipId of clipIds) {
			const byStyle = context.overrideKeyframes[clipId];
			if (!byStyle?.[styleId]) continue;
			byStyle[styleId] = byStyle[styleId].filter((keyframe) => keyframe.time !== normalizedTime);
			if (!byStyle[styleId].length) delete byStyle[styleId];
			if (!Object.keys(byStyle).length) delete context.overrideKeyframes[clipId];
		}
	}

	/**
	 * Définit une valeur locale pour plusieurs clips.
	 * @param {StyleOverrideContext} context État des overrides.
	 * @param {number[]} clipIds Clips ciblés.
	 * @param {StyleName} styleId Style modifié.
	 * @param {StyleOverrideValue} value Valeur locale.
	 * @returns {void}
	 */
	static setStyleForClips(
		context: StyleOverrideContext,
		clipIds: number[],
		styleId: StyleName,
		value: StyleOverrideValue
	): void {
		if (context.target === 'global' && !isGlobalOverlayStyleId(styleId)) return;
		const baseValue = context.findStyle(styleId)?.value;
		const matchesBase =
			Array.isArray(baseValue) && Array.isArray(value)
				? JSON.stringify(baseValue) === JSON.stringify(value)
				: baseValue === value;
		for (const clipId of clipIds) {
			context.overrides[clipId] ??= {};
			if (matchesBase) delete context.overrides[clipId][styleId];
			else context.overrides[clipId][styleId] = value;
		}
	}

	/**
	 * Supprime une valeur locale de plusieurs clips.
	 * @param {StyleOverrideContext} context État des overrides.
	 * @param {number[]} clipIds Clips ciblés.
	 * @param {StyleName} styleId Style à nettoyer.
	 * @returns {void}
	 */
	static clearStyleForClips(
		context: StyleOverrideContext,
		clipIds: number[],
		styleId: StyleName
	): void {
		if (context.target === 'global' && !isGlobalOverlayStyleId(styleId)) return;
		for (const clipId of clipIds) {
			const byClip = context.overrides[clipId];
			if (!byClip) continue;
			delete byClip[styleId];
			if (!Object.keys(byClip).length) delete context.overrides[clipId];
		}
	}

	/**
	 * Résout la valeur effective d'un style.
	 * @param {StyleOverrideContext} context État des overrides.
	 * @param {StyleName} styleId Style à résoudre.
	 * @param {number | undefined} clipId Clip courant.
	 * @param {number | undefined} time Position absolue.
	 * @param {number} fadeDuration Durée du fondu.
	 * @returns {string | number | boolean} Valeur effective.
	 */
	static getEffectiveValue(
		context: StyleOverrideContext,
		styleId: StyleName,
		clipId: number | undefined,
		time: number | undefined,
		fadeDuration: number
	): string | number | boolean {
		const style = context.findStyle(styleId);
		const currentTime =
			time ?? globalState.currentProject?.projectEditorState?.timeline.cursorPosition ?? 0;
		const canOverride = context.target !== 'global' || isGlobalOverlayStyleId(styleId);
		let value = style ? style.getValueAt(currentTime, fadeDuration) : '';
		if (canOverride && clipId !== undefined && context.overrides[clipId]?.[styleId] !== undefined) {
			value = context.overrides[clipId][styleId]!;
		}
		const keyframes =
			clipId === undefined ? undefined : context.overrideKeyframes[clipId]?.[styleId];
		return (
			keyframes && style
				? resolvePreviewKeyframeValue(style, keyframes, currentTime, value, fadeDuration)
				: value
		) as string | number | boolean;
	}

	/**
	 * Résout un style booléen sous forme d'opacité.
	 * @param {StyleOverrideContext} context État des overrides.
	 * @param {StyleName} styleId Style à résoudre.
	 * @param {number | undefined} clipId Clip courant.
	 * @param {number | undefined} time Position absolue.
	 * @param {number} fadeDuration Durée du fondu.
	 * @returns {number} Opacité comprise entre zéro et un.
	 */
	static getEffectiveVisibilityOpacity(
		context: StyleOverrideContext,
		styleId: StyleName,
		clipId: number | undefined,
		time: number | undefined,
		fadeDuration: number
	): number {
		const style = context.findStyle(styleId);
		if (!style) return 0;
		const currentTime =
			time ?? globalState.currentProject?.projectEditorState?.timeline.cursorPosition ?? 0;
		const override = clipId === undefined ? undefined : context.overrides[clipId]?.[styleId];
		const keyframes =
			clipId === undefined ? undefined : context.overrideKeyframes[clipId]?.[styleId];
		if (!keyframes) {
			return override === undefined
				? style.getVisibilityOpacityAt(currentTime, fadeDuration)
				: override
					? 1
					: 0;
		}
		const fallback = override ?? style.getValueAt(currentTime, 0);
		return resolveKeyframeVisibilityOpacity(keyframes, currentTime, fallback, fadeDuration);
	}

	/**
	 * Indique si un des clips possède l'override demandé.
	 * @param {StyleOverrideContext} context État des overrides.
	 * @param {number[]} clipIds Clips à vérifier.
	 * @param {StyleName} styleId Style à vérifier.
	 * @returns {boolean} `true` lorsqu'un override existe.
	 */
	static hasOverrideForAny(
		context: StyleOverrideContext,
		clipIds: number[],
		styleId: StyleName
	): boolean {
		if (context.target === 'global' && !isGlobalOverlayStyleId(styleId)) return false;
		return clipIds.some((clipId) => context.overrides[clipId]?.[styleId] !== undefined);
	}

	/**
	 * Indique si un clip possède une valeur ou animation locale.
	 * @param {StyleOverrideContext} context État des overrides.
	 * @param {number} clipId Clip à vérifier.
	 * @returns {boolean} `true` lorsqu'une personnalisation existe.
	 */
	static hasAnyOverrideForClip(context: StyleOverrideContext, clipId: number): boolean {
		return (
			Object.keys(context.overrides[clipId] ?? {}).length > 0 ||
			Object.keys(context.overrideKeyframes[clipId] ?? {}).length > 0
		);
	}
}
