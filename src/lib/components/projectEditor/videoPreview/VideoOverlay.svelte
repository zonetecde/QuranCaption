<script lang="ts">
	/**
	 * VideoOverlay — Orchestrateur de l'affichage superposé à la vidéo.
	 *
	 * Ce composant est le point d'entrée de tout le rendu visuel au-dessus
	 * de la prévisualisation vidéo. Il orchestre plusieurs couches :
	 *
	 * 1. Grille d'alignement (onglet Style uniquement).
	 * 2. Image associée au sous-titre courant.
	 * 3. Overlay d'effet (flou, couleur, dégradé configurable).
	 * 4. Fond des sous-titres (visible en continu).
	 * 5. Sous-titre arabe (avec highlight mot-à-mot, crochets décoratifs).
	 * 6. Traductions (une par édition configurée).
	 * 7. Décorations fixes (nom de sourate, récitateur, numéro de verset).
	 * 8. Clips custom (texte et images).
	 *
	 * La logique métier complexe est extraite dans :
	 * - `ArabicSubtitle.svelte` : rendu du texte arabe.
	 * - `TranslationSubtitle.svelte` : rendu d'une traduction.
	 * - `helpers/antiCollision.ts` : résolution des collisions entre sous-titres.
	 * - `helpers/reactiveFontSize.ts` : ajustement réactif de la taille de police.
	 * - `helpers/overlayCss.ts` : CSS des effets d'overlay et padding de fond.
	 * - `helpers/decorativeBrackets.ts` : glyphes décoratifs.
	 */

	import {
		CustomTextClip,
		PredefinedSubtitleClip,
		ProjectEditorTabs,
		SubtitleClip
	} from '$lib/classes';
	import { CustomImageClip } from '$lib/classes/Clip.svelte';
	import { VerseTranslation } from '$lib/classes/Translation.svelte';
	import type { StyleName } from '$lib/classes/VideoStyle.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { tick, untrack } from 'svelte';
	import ReciterName from '../tabs/styleEditor/ReciterName.svelte';
	import SurahName from '../tabs/styleEditor/SurahName.svelte';
	import VerseNumber from '../tabs/styleEditor/VerseNumber.svelte';
	import AyahContainer from '../tabs/styleEditor/AyahContainer.svelte';
	import CustomText from '../tabs/styleEditor/CustomText.svelte';
	import CustomImage from '../tabs/styleEditor/CustomImage.svelte';
	import { convertFileSrc } from '@tauri-apps/api/core';
	import { getTimedOverlayOpacity } from '$lib/services/TimedOverlayVisibility';
	import QPCFontProvider from '$lib/services/FontProvider';
	import {
		getBackgroundClipIdForTarget as getBackgroundClipIdForTargetUtil,
		getReferenceClipForTarget as getReferenceClipForTargetUtil,
		getMergedClipsWithoutWordOverlap,
		isVisualMergeTargetMerged
	} from './visualMergeOverlayUtils';

	// Sous-composants
	import ArabicSubtitle from './ArabicSubtitle.svelte';
	import TranslationSubtitle from './TranslationSubtitle.svelte';

	// Helpers extraits
	import { getOverlayLayerCss } from './helpers/overlayCss';
	import {
		resolveOverlayVisualState,
		resolveTimedVisualState
	} from '$lib/services/StyleVisualResolver';
	import { applyReactiveFontSize } from './helpers/reactiveFontSize';
	import { resolveSubtitleCollisions } from './helpers/antiCollision';

	type RuntimeSubtitleLayout = {
		fontSize: number | null;
		yOffset: number;
		forceCenterAlignment?: boolean;
	};

	const MAX_RUNTIME_LAYOUT_CACHE_ENTRIES = 300;

	// =========================================================================
	// Dérivations réactives globales
	// =========================================================================

	/** Durée de fondu configurée au niveau global (en ms). */
	let fadeDuration = $derived(() => {
		return globalState.getStyle('global', 'fade-duration').value as number;
	});

	/**
	 * Indique si on est en mode capture d'export.
	 * Dans ce mode, on applique des ajustements spécifiques pour les renderers
	 * de screenshot (ex: pas de fade, display: block forcé).
	 */
	let isExportCapturePreview = $derived(() => {
		if (typeof window === 'undefined') return false;
		return (
			window.location.pathname.includes('/exporter') &&
			new URLSearchParams(window.location.search).has('id')
		);
	});

	/** Raccourci vers les paramètres de la timeline. */
	let getTimelineSettings = $derived(() => {
		return globalState.currentProject!.projectEditorState.timeline;
	});

	/** Clip vidéo courant (basé sur la position du curseur). */
	let currentVideoClip = $derived(() => {
		const _ = getTimelineSettings().cursorPosition;
		const _refresh = getTimelineSettings().previewRefreshToken;
		return untrack(() =>
			globalState.getVideoTrack.getCurrentClip(getTimelineSettings().cursorPosition)
		);
	});

	/** Sous-titre actuellement affiché. */
	let currentSubtitle = $derived(() => {
		const _ = getTimelineSettings().cursorPosition;
		const _refresh = getTimelineSettings().previewRefreshToken;
		return untrack(() => {
			return globalState.getSubtitleTrack.getCurrentSubtitleToDisplay();
		});
	});

	/** Groupe de fusion visuelle actif (si le sous-titre est fusionné). */
	let currentVisualMergeGroup = $derived(() => {
		const subtitle = currentSubtitle();
		if (!(subtitle instanceof SubtitleClip)) return null;
		return globalState.getSubtitleTrack.getVisualMergeGroupForClipId(subtitle.id);
	});

	/**
	 * Sous-titre de référence pour les fonds (backgrounds).
	 *
	 * Quand le curseur est entre deux sous-titres, on cherche le sous-titre
	 * précédent ou suivant pour continuer d'afficher les backgrounds.
	 * On ne considère que les SubtitleClip et PredefinedSubtitleClip.
	 */
	let backgroundSubtitle = $derived(() => {
		const _ = getTimelineSettings().cursorPosition;
		const _refresh = getTimelineSettings().previewRefreshToken;
		return untrack(() => {
			const track = globalState.getSubtitleTrack;
			const cur = track.getCurrentSubtitleToDisplay();
			if (cur) return cur;

			const clips = track.clips;
			if (!clips || clips.length === 0) return null;

			const time = getTimelineSettings().cursorPosition;
			let indexAfter = clips.findIndex((c) => time < c.startTime);

			if (indexAfter === -1) {
				// Après le dernier clip : cherche depuis la fin
				for (let i = clips.length - 1; i >= 0; i--) {
					const c = clips[i];
					if (c instanceof SubtitleClip || c instanceof PredefinedSubtitleClip) return c;
				}
			} else {
				// Cherche le sous-titre précédent
				for (let i = indexAfter - 1; i >= 0; i--) {
					const c = clips[i];
					if (c instanceof SubtitleClip || c instanceof PredefinedSubtitleClip) return c;
				}
				// Pas de précédent : prend le suivant
				for (let i = indexAfter; i < clips.length; i++) {
					const c = clips[i];
					if (c instanceof SubtitleClip || c instanceof PredefinedSubtitleClip) return c;
				}
			}

			return null;
		});
	});

	/** Traductions disponibles pour le sous-titre courant. */
	let currentSubtitleTranslations = $derived(() => {
		const subtitle = currentSubtitle();
		if (!subtitle) return [];
		if (!(subtitle instanceof SubtitleClip || subtitle instanceof PredefinedSubtitleClip))
			return [];
		return subtitle.translations;
	});

	/**
	 * Liste des targets de traduction visibles.
	 * En mode fusion "translation" ou "both", on utilise les clés
	 * du premier clip du groupe. Sinon, on utilise celles du sous-titre courant.
	 */
	let visibleTranslationTargets = $derived(() => {
		const mergedGroup = currentVisualMergeGroup();
		if (mergedGroup && (mergedGroup.mode === 'translation' || mergedGroup.mode === 'both')) {
			return Object.keys(mergedGroup.firstClip.translations);
		}

		return Object.keys(currentSubtitleTranslations() || {});
	});

	/**
	 * Indique si le sous-titre visible contient un retour ligne manuel.
	 *
	 * @param {string} target Cible de style.
	 * @returns {boolean} `true` si au moins un run force un retour ligne.
	 */
	function hasForcedLineBreak(target: string): boolean {
		const subtitle = currentSubtitle();
		const mergedGroup = currentVisualMergeGroup();
		const clips =
			mergedGroup && isVisualMergeTargetMerged(mergedGroup, target)
				? mergedGroup.clips
				: subtitle instanceof SubtitleClip
					? [subtitle]
					: [];

		return clips.some((clip) => {
			if (target === 'arabic') {
				return (clip.arabicInlineStyleRuns ?? []).some((run) => Boolean(run.lineBreak));
			}

			const translation = clip.translations[target];
			return (
				translation instanceof VerseTranslation &&
				(translation.inlineStyleRuns ?? []).some((run) => Boolean(run.lineBreak))
			);
		});
	}

	/** Clips custom (texte/image) à afficher au temps courant. */
	let currentCustomClips = $derived(() => {
		const _ = getTimelineSettings().cursorPosition;
		const _refresh = getTimelineSettings().previewRefreshToken;
		return untrack(() => {
			return globalState.getCustomClipTrack.getCurrentClips();
		});
	});

	/** Chemin de l'image associée au sous-titre courant. */
	let currentSubtitleImagePath = $derived(() => {
		const subtitle = currentSubtitle();
		if (!subtitle) return null;
		if (!(subtitle instanceof SubtitleClip || subtitle instanceof PredefinedSubtitleClip))
			return null;

		return subtitle.getAssociatedImagePath();
	});

	/** Flag indiquant si l'image associée a échoué à charger. */
	let subtitleImageFailedToLoad = $state(false);

	// Réinitialise le flag d'erreur quand l'image change
	$effect(() => {
		currentSubtitleImagePath();
		subtitleImageFailedToLoad = false;
	});

	// =========================================================================
	// Paramètres de l'overlay d'effet (flou, couleur, dégradé)
	// =========================================================================

	/**
	 * Paramètres de l'overlay d'arrière-plan lus depuis les styles globaux.
	 * Utilisé par la couche de flou et de couleur/dégradé derrière les sous-titres.
	 */
	let overlaySettings = $derived(() => {
		const clipId = currentVideoClip()?.id;
		const globalStyles = globalState.getVideoStyle.getStylesOfTarget('global');
		return resolveOverlayVisualState(globalStyles, clipId);
	});

	let videoFrameSettings = $derived.by(() => {
		const verticalSize = Math.min(
			45,
			Math.max(0, Number(globalState.getStyle('global', 'video-frame-vertical-size')?.value ?? 8))
		);
		const horizontalSize = Math.min(
			45,
			Math.max(0, Number(globalState.getStyle('global', 'video-frame-horizontal-size')?.value ?? 8))
		);
		const radius = Math.min(
			50,
			Math.max(0, Number(globalState.getStyle('global', 'video-frame-radius')?.value ?? 4))
		);
		const dimensions = globalState.getStyle('global', 'video-dimension')?.value as
			| { width: number; height: number }
			| undefined;
		const width = Math.max(1, Number(dimensions?.width ?? 1920));
		const height = Math.max(1, Number(dimensions?.height ?? 1080));
		const innerWidth = width * (1 - horizontalSize / 50);
		const innerHeight = height * (1 - verticalSize / 50);
		const radiusPixels = (radius / 100) * Math.min(innerWidth, innerHeight);
		const radiusX = (radiusPixels / width) * 100;
		const radiusY = (radiusPixels / height) * 100;
		const left = horizontalSize;
		const top = verticalSize;
		const right = 100 - horizontalSize;
		const bottom = 100 - verticalSize;

		return {
			enable: Boolean(globalState.getStyle('global', 'video-frame-enable')?.value),
			color: String(globalState.getStyle('global', 'video-frame-color')?.value ?? '#000000'),
			path: `M 0 0 H 100 V 100 H 0 Z M ${left + radiusX} ${top} H ${right - radiusX} A ${radiusX} ${radiusY} 0 0 1 ${right} ${top + radiusY} V ${bottom - radiusY} A ${radiusX} ${radiusY} 0 0 1 ${right - radiusX} ${bottom} H ${left + radiusX} A ${radiusX} ${radiusY} 0 0 1 ${left} ${bottom - radiusY} V ${top + radiusY} A ${radiusX} ${radiusY} 0 0 1 ${left + radiusX} ${top} Z`
		};
	});

	// =========================================================================
	// Grille d'alignement
	// =========================================================================

	/**
	 * Conditions d'affichage de la grille d'alignement :
	 * - Toujours visible pendant un drag (showAlignmentGridWhileDragging).
	 * - Visible dans l'onglet Style si l'option est activée.
	 */
	let canShowAlignmentOverlay = $derived(() => {
		const isStyleTab =
			globalState.currentProject?.projectEditorState.currentTab === ProjectEditorTabs.Style;
		if (globalState.getVideoPreviewState.showAlignmentGridWhileDragging) return true;
		return isStyleTab && globalState.getVideoPreviewState.showAlignmentGrid;
	});

	// =========================================================================
	// Utilitaires de style
	// =========================================================================

	/**
	 * Indique si une cible est en mode fusion visuelle.
	 * @param target - Cible de style (`arabic` ou nom d'édition).
	 */
	function isTargetMerged(target: string): boolean {
		return isVisualMergeTargetMerged(currentVisualMergeGroup(), target);
	}

	/**
	 * Retourne le clip de référence pour les styles d'une cible.
	 * En mode fusion, c'est le premier clip du groupe. Sinon, le sous-titre courant.
	 *
	 * @param target - Cible de style (`arabic` ou nom d'édition).
	 */
	function getReferenceClipForTarget(target: string): SubtitleClip | PredefinedSubtitleClip | null {
		const subtitle = currentSubtitle();
		if (!(subtitle instanceof SubtitleClip || subtitle instanceof PredefinedSubtitleClip))
			return null;
		return getReferenceClipForTargetUtil(subtitle, currentVisualMergeGroup(), target);
	}

	/**
	 * Retourne l'ID du clip de référence pour les backgrounds d'une cible.
	 *
	 * @param target - Cible de style (`arabic` ou nom d'édition).
	 */
	function getBackgroundClipIdForTarget(target: string): number | undefined {
		const background = backgroundSubtitle();
		const subtitleBackground =
			background instanceof SubtitleClip || background instanceof PredefinedSubtitleClip
				? background
				: null;
		return getBackgroundClipIdForTargetUtil(currentVisualMergeGroup(), subtitleBackground, target);
	}

	/**
	 * Calcule l'opacité d'un sous-titre en fonction de sa position
	 * dans le temps et de la durée de fondu configurée.
	 *
	 * Le fondu est symétrique : moitié de la durée en entrée, moitié en sortie.
	 * Entre les deux, l'opacité est à son maximum (valeur du style `opacity`).
	 *
	 * @param target - Cible de style (`arabic` ou nom d'édition).
	 * @returns Opacité entre 0 et la valeur max configurée.
	 */
	let subtitleOpacity = $derived((target: string) => {
		const referenceClip = getReferenceClipForTarget(target);
		if (!referenceClip) return 0;

		const clipId = referenceClip.id;
		let maxOpacity = Number(
			globalState.getVideoStyle.getStylesOfTarget(target).getEffectiveValue('opacity', clipId)
		);

		const currentTime = getTimelineSettings().cursorPosition;
		const activeRange = isTargetMerged(target)
			? currentVisualMergeGroup()
			: { startTime: referenceClip.startTime, endTime: referenceClip.endTime };
		if (!activeRange) return 0;

		const endTime = activeRange.endTime;
		const timeLeft = endTime - currentTime;
		const halfFade = fadeDuration() / 2;

		// Fondu de sortie
		if (timeLeft <= halfFade) {
			return Math.max(0, (timeLeft / halfFade) * maxOpacity);
		}

		// Fondu d'entrée
		const startTime = activeRange.startTime;
		const timeSinceStart = currentTime - startTime;

		if (timeSinceStart <= halfFade) {
			return Math.min(maxOpacity, (timeSinceStart / halfFade) * maxOpacity);
		}

		return maxOpacity;
	});

	let backgroundOpacity = $derived((target: string) => {
		const styles = globalState.getVideoStyle.getStylesOfTarget(target);
		const alwaysShowStyle = styles.findStyle('always-show');
		if (!alwaysShowStyle) return 1;

		const clipId = getBackgroundClipIdForTarget(target);
		const timing = resolveTimedVisualState(
			styles,
			{
				alwaysShow: 'always-show',
				startTime: 'time-appearance',
				endTime: 'time-disappearance'
			},
			clipId
		);
		return getTimedOverlayOpacity({
			alwaysShow: timing.alwaysShow,
			maxOpacity: 1,
			currentTime: getTimelineSettings().cursorPosition,
			fadeDuration: fadeDuration(),
			startTime: timing.startTime,
			endTime: timing.endTime
		});
	});

	/**
	 * Génère le CSS complet pour une cible de style, en excluant
	 * certaines catégories si demandé.
	 *
	 * @param target - Cible de style.
	 * @param clipId - ID du clip pour les overrides éventuels.
	 * @param excludedCategories - Catégories CSS à exclure.
	 */
	let getCss = $derived((target: string, clipId?: number, excludedCategories: string[] = []) => {
		return globalState.getVideoStyle
			.getStylesOfTarget(target)
			.generateCSS(clipId, excludedCategories);
	});

	/** Génère les classes Tailwind pour une cible de style. */
	let getTailwind = $derived((target: string) => {
		return globalState.getVideoStyle.getStylesOfTarget(target).generateTailwind();
	});

	/**
	 * Classes CSS d'aide visuelle pour l'édition de style.
	 *
	 * Quand on édite une cible dans l'onglet Style, on ajoute une classe
	 * de fond semi-transparent pendant le survol des contrôles "width"
	 * ou "max-height" afin de visualiser leurs contraintes.
	 *
	 * @param target - Cible de style.
	 * @returns Classes CSS additionnelles.
	 */
	let helperStyles = $derived((target: string) => {
		if (
			globalState.currentProject?.projectEditorState.currentTab === ProjectEditorTabs.Style &&
			(globalState.getStylesState.currentSelection === target ||
				(globalState.getStylesState.currentSelection === 'translation' &&
					globalState.getStylesState.currentSelectionTranslation === target))
		) {
			let classes = ' ';

			if (
				globalState.hoveredStylePreviewHelper === 'width' ||
				globalState.hoveredStylePreviewHelper === 'max-height'
			) {
				classes += 'bg-[#11A2AF]/50 ';
			}

			return classes;
		}
		return '';
	});

	let runtimeSubtitleLayout: Record<string, RuntimeSubtitleLayout> = $state({});
	const runtimeLayoutCache = new Map<string, Record<string, RuntimeSubtitleLayout>>();

	/**
	 * Clone un snapshot de layout runtime pour éviter les mutations partagées.
	 *
	 * @param {Record<string, RuntimeSubtitleLayout>} layout Snapshot source.
	 * @returns {Record<string, RuntimeSubtitleLayout>} Snapshot cloné.
	 */
	function cloneRuntimeSubtitleLayout(
		layout: Record<string, RuntimeSubtitleLayout>
	): Record<string, RuntimeSubtitleLayout> {
		return Object.fromEntries(
			Object.entries(layout).map(([target, targetLayout]) => [target, { ...targetLayout }])
		);
	}

	/**
	 * Retourne un layout runtime déjà calculé pour une clé stable.
	 *
	 * @param {string} layoutKey Clé des contraintes de layout.
	 * @returns {Record<string, RuntimeSubtitleLayout> | null} Snapshot de layout ou null.
	 */
	function getCachedRuntimeLayout(layoutKey: string): Record<string, RuntimeSubtitleLayout> | null {
		const cachedLayout = runtimeLayoutCache.get(layoutKey);
		return cachedLayout ? cloneRuntimeSubtitleLayout(cachedLayout) : null;
	}

	/**
	 * Applique un snapshot de layout sans modifier les styles persistés.
	 *
	 * @param {Record<string, RuntimeSubtitleLayout>} layout Snapshot runtime à appliquer.
	 * @returns {void}
	 */
	function applyRuntimeLayout(layout: Record<string, RuntimeSubtitleLayout>): void {
		runtimeSubtitleLayout = cloneRuntimeSubtitleLayout(layout);
	}

	/**
	 * Mémorise le layout runtime calculé pour réutilisation pendant l'édition.
	 *
	 * @param {string} layoutKey Clé des contraintes de layout.
	 * @param {string[]} targets Cibles incluses dans le snapshot.
	 * @returns {void}
	 */
	function cacheRuntimeLayout(layoutKey: string, targets: string[]): void {
		const snapshot: Record<string, RuntimeSubtitleLayout> = {};
		for (const target of targets) {
			snapshot[target] = { ...getRuntimeSubtitleLayout(target) };
		}

		runtimeLayoutCache.set(layoutKey, snapshot);
		if (runtimeLayoutCache.size <= MAX_RUNTIME_LAYOUT_CACHE_ENTRIES) return;

		const oldestKey = runtimeLayoutCache.keys().next().value;
		if (oldestKey) runtimeLayoutCache.delete(oldestKey);
	}

	/**
	 * Retourne l'état runtime de layout d'une cible sans toucher aux styles persistés.
	 *
	 * @param {string} target Cible de style.
	 * @returns {RuntimeSubtitleLayout} Etat runtime courant.
	 */
	function getRuntimeSubtitleLayout(target: string): RuntimeSubtitleLayout {
		return (
			runtimeSubtitleLayout[target] ?? { fontSize: null, yOffset: 0, forceCenterAlignment: false }
		);
	}

	/**
	 * Met à jour une partie du layout runtime d'une cible.
	 *
	 * @param {string} target Cible de style.
	 * @param {Partial<RuntimeSubtitleLayout>} patch Valeurs à remplacer.
	 * @returns {void}
	 */
	function setRuntimeSubtitleLayout(target: string, patch: Partial<RuntimeSubtitleLayout>): void {
		runtimeSubtitleLayout = {
			...runtimeSubtitleLayout,
			[target]: {
				...getRuntimeSubtitleLayout(target),
				...patch
			}
		};
	}

	/**
	 * Applique la taille de police runtime calculée pour une cible.
	 *
	 * @param {string} target Cible de style.
	 * @param {number} value Taille de police en pixels.
	 * @returns {void}
	 */
	function setRuntimeFontSize(target: string, value: number): void {
		setRuntimeSubtitleLayout(target, { fontSize: Number.isFinite(value) ? value : null });
	}

	/**
	 * Applique le décalage vertical runtime calculé pour une cible.
	 *
	 * @param {string} target Cible de style.
	 * @param {number} value Décalage vertical en pixels.
	 * @returns {void}
	 */
	function setRuntimeYOffset(target: string, value: number): void {
		setRuntimeSubtitleLayout(target, { yOffset: Number.isFinite(value) ? value : 0 });
	}

	/**
	 * Force temporairement l'alignement vertical au centre pendant la mesure.
	 *
	 * @param {string} target Cible de style.
	 * @param {boolean} value Si l'alignement doit être forcé au centre.
	 * @returns {void}
	 */
	function setRuntimeForceCenterAlignment(target: string, value: boolean): void {
		setRuntimeSubtitleLayout(target, { forceCenterAlignment: value });
	}

	/**
	 * Réinitialise les décalages verticaux runtime des cibles visibles.
	 *
	 * @param {string[]} targets Cibles de style à réinitialiser.
	 * @returns {void}
	 */
	function resetRuntimeYOffsets(targets: string[]): void {
		for (const target of targets) {
			setRuntimeYOffset(target, 0);
		}
	}

	/**
	 * Génère le CSS inline runtime appliqué uniquement au rendu preview.
	 *
	 * @param {string} target Cible de style.
	 * @returns {string} CSS inline runtime.
	 */
	function getRuntimeLayoutCss(target: string): string {
		const layout = getRuntimeSubtitleLayout(target);
		const fontSizeCss =
			layout.fontSize !== null ? `font-size: ${layout.fontSize}px !important;` : '';
		const centerAlignmentCss = layout.forceCenterAlignment
			? 'display: flex !important; align-items: center !important;'
			: '';
		return `--reactive-y-position: ${layout.yOffset}px; ${fontSizeCss} ${centerAlignmentCss}`;
	}

	/**
	 * Retourne les cibles qui participent au layout de sous-titres.
	 *
	 * @returns {string[]} Cibles visibles dans le preview.
	 */
	function getLayoutTargets(): string[] {
		return ['arabic', ...visibleTranslationTargets()];
	}

	/**
	 * Sérialise une valeur de cache dans un ordre stable.
	 *
	 * @param {unknown} value Valeur à sérialiser.
	 * @returns {string} Signature stable de la valeur.
	 */
	function getLayoutCacheValueSignature(value: unknown): string {
		if (value === null || value === undefined) return '';
		if (typeof value !== 'object') return String(value);
		if (Array.isArray(value)) return `[${value.map(getLayoutCacheValueSignature).join(',')}]`;

		return `{${Object.entries(value as Record<string, unknown>)
			.sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
			.map(([key, nestedValue]) => `${key}:${getLayoutCacheValueSignature(nestedValue)}`)
			.join(',')}}`;
	}

	/**
	 * Construit la signature des styles effectifs d'une cible.
	 *
	 * @param {string} target Cible de style.
	 * @param {number | undefined} clipId Clip utilisé pour les overrides.
	 * @returns {string} Signature des styles effectifs.
	 */
	function getTargetStylesCacheSignature(target: string, clipId?: number): string {
		const styles = globalState.getVideoStyle.getStylesOfTarget(target);
		return styles.categories
			.flatMap((category) =>
				category.styles.map((style) => {
					const value = styles.getEffectiveValue(style.id as StyleName, clipId);
					return `${category.id}.${style.id}=${getLayoutCacheValueSignature(value)}`;
				})
			)
			.join(';');
	}

	/**
	 * Retourne les clips dont le contenu peut participer au layout d'une cible.
	 *
	 * @param {string} target Cible de style.
	 * @returns {(SubtitleClip | PredefinedSubtitleClip)[]} Clips visibles pour la cible.
	 */
	function getLayoutContentClips(target: string): (SubtitleClip | PredefinedSubtitleClip)[] {
		const subtitle = currentSubtitle();
		const mergedGroup = currentVisualMergeGroup();

		if (mergedGroup && isVisualMergeTargetMerged(mergedGroup, target)) {
			return getMergedClipsWithoutWordOverlap(mergedGroup.clips);
		}

		if (subtitle instanceof SubtitleClip || subtitle instanceof PredefinedSubtitleClip) {
			return [subtitle];
		}

		return [];
	}

	/**
	 * Construit la signature du texte arabe réellement rendu.
	 *
	 * @returns {string} Signature du contenu arabe visible.
	 */
	function getArabicContentCacheSignature(): string {
		return getLayoutContentClips('arabic')
			.map((clip) => {
				const parts = clip.getArabicRenderParts('preview');
				return getLayoutCacheValueSignature({
					id: clip.id,
					text: parts.text,
					suffix: parts.suffix,
					suffixFontFamily: parts.suffixFontFamily,
					inlineStyleRuns: clip.arabicInlineStyleRuns ?? []
				});
			})
			.join('|');
	}

	/**
	 * Retourne le texte d'une traduction pour la signature de cache.
	 *
	 * @param {unknown} translation Traduction attachée au clip.
	 * @param {string} target Edition de traduction.
	 * @param {SubtitleClip | PredefinedSubtitleClip} clip Clip mesuré.
	 * @returns {string} Texte à inclure dans la clé de cache.
	 */
	function getTranslationCacheText(
		translation: unknown,
		target: string,
		clip: SubtitleClip | PredefinedSubtitleClip
	): string {
		if (
			translation &&
			typeof translation === 'object' &&
			'getText' in translation &&
			typeof translation.getText === 'function'
		) {
			return clip instanceof SubtitleClip
				? String(translation.getText(target, clip))
				: String(translation.getText());
		}

		if (translation && typeof translation === 'object' && 'text' in translation) {
			return String(translation.text ?? '');
		}

		return '';
	}

	/**
	 * Construit la signature du texte de traduction réellement rendu.
	 *
	 * @param {string} target Edition de traduction.
	 * @returns {string} Signature du contenu de traduction visible.
	 */
	function getTranslationContentCacheSignature(target: string): string {
		return getLayoutContentClips(target)
			.map((clip) => {
				const translation = clip.translations[target];
				if (!translation) return `${clip.id}:`;
				const translationCacheData = translation as {
					inlineStyleRuns?: unknown;
					wbwRanges?: unknown;
				};

				return getLayoutCacheValueSignature({
					id: clip.id,
					text: getTranslationCacheText(translation, target, clip),
					inlineStyleRuns:
						translation instanceof VerseTranslation
							? (translation.inlineStyleRuns ?? [])
							: (translationCacheData.inlineStyleRuns ?? []),
					wbwRanges:
						translation instanceof VerseTranslation
							? (translation.wbwRanges ?? [])
							: (translationCacheData.wbwRanges ?? [])
				});
			})
			.join('|');
	}

	/**
	 * Construit la signature du contenu rendu pour une cible.
	 *
	 * @param {string} target Cible de style.
	 * @returns {string} Signature du contenu visible.
	 */
	function getTargetContentCacheSignature(target: string): string {
		if (target === 'arabic') return getArabicContentCacheSignature();
		return getTranslationContentCacheSignature(target);
	}

	/**
	 * Retourne la taille actuelle du conteneur de sous-titres.
	 *
	 * @returns {string} Signature largeur/hauteur du conteneur.
	 */
	function getSubtitleContainerSizeSignature(): string {
		if (typeof document === 'undefined') return '';
		const container = document.getElementById('subtitles-container');
		if (!(container instanceof HTMLElement)) return '';
		return `${container.clientWidth}x${container.clientHeight}`;
	}

	/**
	 * Construit une clé stable pour éviter les recalculs de layout identiques.
	 *
	 * @param {string[]} targets Cibles de style mesurées.
	 * @returns {string} Clé représentant les contraintes de layout courantes.
	 */
	function getLayoutCacheKey(targets: string[]): string {
		const subtitle = currentSubtitle();
		const visualMergeGroupId =
			subtitle instanceof SubtitleClip ? (subtitle.visualMergeGroupId ?? '') : '';
		const targetConstraints = targets.map((target) => {
			const referenceClip = getReferenceClipForTarget(target);
			return [
				target,
				referenceClip?.id ?? '',
				getTargetContentCacheSignature(target),
				getTargetStylesCacheSignature(target, referenceClip?.id),
				hasForcedLineBreak(target)
			].join(':');
		});

		return [
			subtitle?.id ?? '',
			visualMergeGroupId,
			getSubtitleContainerSizeSignature(),
			globalState.getTimelineState.previewRefreshToken,
			getTargetStylesCacheSignature('global', currentVideoClip()?.id),
			...targetConstraints
		].join('|');
	}

	// =========================================================================
	// Liste des éditions de traduction (pour les backgrounds)
	// =========================================================================

	/** Noms de toutes les éditions de traduction configurées dans le projet. */
	let projectTranslationEditionNames = $derived(() => {
		return globalState.getProjectTranslation.addedTranslationEditions.map((e) => e.name);
	});

	// =========================================================================
	// Effet principal : ajustement réactif de la taille de police
	// et résolution des collisions entre sous-titres.
	// =========================================================================

	/**
	 * Identifiants du dernier sous-titre traité.
	 * Permet d'éviter les recalculs inutiles pendant la lecture
	 * quand le sous-titre n'a pas changé.
	 */
	let lastSubtitleId = 0;
	let lastVisualMergeGroupId: string | null = null;
	let lastLayoutKey = '';

	/** Contrôleur d'annulation pour les opérations asynchrones de layout. */
	let currentAbortController: AbortController | null = null;

	/**
	 * Retourne le timing courant sous une forme stable pour la capture export.
	 * @returns {string} Timing courant arrondi en millisecondes.
	 */
	function getExportLayoutTimingKey(): string {
		return String(Math.round(getTimelineSettings().cursorPosition));
	}

	/**
	 * Marque l'etat du layout de sous-titres consomme par l'export.
	 * @param {HTMLElement | null} element Conteneur des sous-titres.
	 * @param {'pending' | 'ready'} state Etat courant du layout.
	 * @returns {void}
	 */
	function markExportLayoutState(element: HTMLElement | null, state: 'pending' | 'ready'): void {
		const target = element ?? document.getElementById('subtitles-container');
		if (!(target instanceof HTMLElement)) return;
		target.dataset.exportLayoutTiming = getExportLayoutTimingKey();
		target.dataset.exportLayoutState = state;
	}

	/**
	 * Fonction utilitaire qui consomme des dépendances réactives
	 * sans rien faire. Utilisée pour forcer la réactivité dans `untrack`.
	 */
	function consumeReactiveDependencies(..._deps: unknown[]): void {}

	/**
	 * Promesse qui attend 1ms et s'annule si le signal est aborté.
	 * Permet de céder au navigateur entre deux ajustements DOM.
	 */
	async function wait(abortSignal: AbortSignal) {
		await new Promise((resolve, reject) => {
			if (abortSignal.aborted) {
				reject(new Error('Aborted'));
				return;
			}
			setTimeout(() => {
				if (abortSignal.aborted) {
					reject(new Error('Aborted'));
				} else {
					resolve(undefined);
				}
			}, 1);
		});
	}

	/**
	 * Effect principal de layout des sous-titres.
	 *
	 * Déclenché à chaque changement de sous-titre, de position du curseur,
	 * ou des styles `max-height`, `font-size`, `spacing`.
	 *
	 * Flux :
	 * 1. Cache les sous-titres (opacity: 0) pour éviter les sauts visuels.
	 * 2. Annule toute exécution précédente.
	 * 3. Pour chaque target (arabic + traductions) :
	 *    a. Réinitialise la position Y réactive.
	 *    b. Applique l'ajustement réactif de taille de police (max-height).
	 * 4. Si l'anti-collision est activée, résout les collisions.
	 * 5. Ré-affiche les sous-titres (opacity: 1).
	 */
	$effect(() => {
		(async () => {
			const subtitlesContainer = document.getElementById('subtitles-container');

			const subtitle = currentSubtitle();
			if (!subtitle) {
				lastSubtitleId = 0;
				lastVisualMergeGroupId = null;
				lastLayoutKey = '';
				if (subtitlesContainer) {
					// En export, l'attente peut observer ce noeud avant que Svelte le retire.
					subtitlesContainer.style.opacity = '0';
					markExportLayoutState(subtitlesContainer, 'ready');
				}
				return;
			}

			const currentVisualMergeGroupId =
				subtitle instanceof SubtitleClip ? subtitle.visualMergeGroupId : null;
			const isPlaying = globalState.getVideoPreviewState.isPlaying;

			// Pendant la lecture : évite les recalculs coûteux pour le même clip
			// ou pour les transitions internes d'un groupe de fusion visuelle.
			if (isPlaying) {
				if (subtitle.id === lastSubtitleId) return;
				if (
					currentVisualMergeGroupId &&
					lastVisualMergeGroupId &&
					currentVisualMergeGroupId === lastVisualMergeGroupId
				) {
					lastSubtitleId = subtitle.id;
					return;
				}
			}

			lastSubtitleId = subtitle.id;
			lastVisualMergeGroupId = currentVisualMergeGroupId;

			const targets = getLayoutTargets();
			const layoutKey = getLayoutCacheKey(targets);
			if (layoutKey === lastLayoutKey) {
				// Le layout est réutilisé, mais l'export attend un timing à jour pour chaque frame.
				if (subtitlesContainer) {
					subtitlesContainer.style.opacity = '1';
					markExportLayoutState(subtitlesContainer, 'ready');
				}
				return;
			}
			lastLayoutKey = layoutKey;

			// Dépendances réactives à tracker (forcent le déclenchement de l'effet)
			consumeReactiveDependencies(
				globalState.getTimelineState.movePreviewTo,
				globalState.getTimelineState.previewRefreshToken,
				...targets.map((target) => globalState.getStyle(target, 'max-height').value),
				...targets.map((target) => globalState.getStyle(target, 'max-line').value),
				...targets.map((target) => hasForcedLineBreak(target)),
				...targets.map((target) => globalState.getStyle(target, 'font-size').value),
				globalState.getStyle('global', 'spacing').value
			);

			const cachedLayout = getCachedRuntimeLayout(layoutKey);
			if (cachedLayout) {
				if (currentAbortController) {
					currentAbortController.abort();
				}
				applyRuntimeLayout(cachedLayout);
				await tick();
				const currentSubtitlesContainer = document.getElementById('subtitles-container');
				if (currentSubtitlesContainer instanceof HTMLElement) {
					currentSubtitlesContainer.style.opacity = '1';
					markExportLayoutState(currentSubtitlesContainer, 'ready');
				}
				return;
			}

			// Cache les sous-titres pendant le recalcul
			if (subtitlesContainer) {
				markExportLayoutState(subtitlesContainer, 'pending');
				subtitlesContainer.style.opacity = '0';
			}

			let layoutCompleted = false;

			await untrack(async () => {
				// Annule l'exécution précédente
				if (currentAbortController) {
					currentAbortController.abort();
				}

				currentAbortController = new AbortController();
				const abortSignal = currentAbortController.signal;

				try {
					if (isExportCapturePreview()) {
						await QPCFontProvider.waitForFontsInElement(
							document.getElementById('subtitles-container')
						);
						if (abortSignal.aborted) return;
						await tick();
						await wait(abortSignal);
					}

					// Étape 1 : Réinitialise les positions Y réactives
					resetRuntimeYOffsets(targets);

					// Laisse le DOM se mettre à jour après la réinitialisation
					await wait(abortSignal);

					// Étape 2 : Ajustement réactif de la taille de police
					for (const target of targets) {
						if (abortSignal.aborted) return;

						try {
							const styles = globalState.getVideoStyle.getStylesOfTarget(target);
							const referenceClip = getReferenceClipForTarget(target);
							const maxHeightValue = globalState.getStyle(target, 'max-height').value as number;
							const maxLineValue = hasForcedLineBreak(target)
								? Infinity
								: Number(globalState.getStyle(target, 'max-line').value);
							const initialFontSize = Number(
								styles.getEffectiveValue('font-size', referenceClip?.id)
							);
							const shouldForceCenterAlignment =
								maxHeightValue > 0 || (maxLineValue >= 1 && maxLineValue <= 4);

							if (shouldForceCenterAlignment) {
								setRuntimeForceCenterAlignment(target, true);
								await tick();
								await wait(abortSignal);
							}

							await applyReactiveFontSize(
								target,
								maxHeightValue,
								maxLineValue,
								initialFontSize,
								shouldForceCenterAlignment,
								abortSignal,
								setRuntimeFontSize,
								wait
							);
						} catch (error) {
							if (error instanceof Error && error.message === 'Aborted') {
								return;
							}
						} finally {
							setRuntimeForceCenterAlignment(target, false);
						}
					}

					// Étape 3 : Résolution des collisions si activée
					await tick();
					await wait(abortSignal);

					if (globalState.getStyle('global', 'anti-collision').value) {
						const translationKeys = Object.keys(currentSubtitleTranslations() || {});
						const spacing = globalState.getStyle('global', 'spacing').value as number;

						await resolveSubtitleCollisions(
							abortSignal,
							spacing,
							translationKeys,
							(target) => {
								return getRuntimeSubtitleLayout(target).yOffset;
							},
							setRuntimeYOffset,
							wait
						);
					}

					layoutCompleted = !abortSignal.aborted;
				} catch (error) {
					if (error instanceof Error && error.message === 'Aborted') {
						return;
					}
				}
			});

			if (!layoutCompleted) return;
			cacheRuntimeLayout(layoutKey, targets);

			// Réaffiche les sous-titres
			const currentSubtitlesContainer = document.getElementById('subtitles-container');
			if (currentSubtitlesContainer instanceof HTMLElement) {
				currentSubtitlesContainer.style.opacity = '1';
				markExportLayoutState(currentSubtitlesContainer, 'ready');
			}
		})();
	});
</script>

<!-- ===================================================================== -->
<!-- TEMPLATE                                                              -->
<!-- ===================================================================== -->

<div class="inset-0 absolute" id="overlay">
	<!-- Couche 1 : Grille d'alignement (onglet Style uniquement) -->
	{#if canShowAlignmentOverlay()}
		<div class="alignment-overlay absolute inset-0 pointer-events-none" aria-hidden="true">
			<div class="alignment-grid"></div>
		</div>
	{/if}

	<!-- Couche 2 : Image associée au sous-titre courant -->
	{#if currentSubtitleImagePath() && !subtitleImageFailedToLoad}
		<div
			class="absolute inset-0 z-0 pointer-events-none select-none"
			style={`opacity: ${subtitleOpacity('arabic')}; background-image: url('${convertFileSrc(currentSubtitleImagePath()!)}'); background-size: contain; background-position: center; background-repeat: no-repeat;`}
		></div>
	{/if}

	<!-- Couche 3 : Overlay d'effet (flou + couleur/dégradé) -->
	{#if overlaySettings().enable}
		<div
			class="absolute inset-0 z-0"
			style="{getOverlayLayerCss(overlaySettings())} {overlaySettings().customCSS};"
		></div>

		<div
			class="absolute inset-0 z-0"
			style="backdrop-filter: blur({overlaySettings().blur}px);"
		></div>
	{/if}

	<!-- Couche 3.5 : Ayah Container (au-dessus de l'overlay, en-dessous des sous-titres) -->
	<AyahContainer />

	<!-- Couche 4 : Fonds des sous-titres -->
	<div
		id="subtitles-backgrounds"
		class="absolute inset-0 z-1 flex flex-col items-center justify-center"
	>
		<!-- Fond arabe -->
		<div
			class={'arabic absolute subtitle select-none' +
				getTailwind('arabic') +
				helperStyles('arabic')}
			style="{getCss('arabic', getBackgroundClipIdForTarget('arabic'))}; {getRuntimeLayoutCss(
				'arabic'
			)} opacity: {backgroundOpacity('arabic')};"
		></div>

		<!-- Fonds des traductions -->
		{#each projectTranslationEditionNames() as edition (edition)}
			{#if globalState.getVideoStyle.doesTargetStyleExist(edition)}
				<div
					class={'translation absolute subtitle select-none ' +
						edition +
						getTailwind(edition) +
						helperStyles(edition)}
					style="{getCss(edition, getBackgroundClipIdForTarget(edition))}; {getRuntimeLayoutCss(
						edition
					)} opacity: {backgroundOpacity(edition)};"
				></div>
			{/if}
		{/each}
	</div>

	<!-- Couche 5-8 : Sous-titres et décorations -->
	<div class="w-full h-full absolute inset-0 flex flex-col items-center justify-center">
		{#if currentSubtitle()}
			<div
				id="subtitles-container"
				class="absolute inset-0 z-1 flex flex-col items-center justify-center"
				style="opacity: 1;"
			>
				<!-- Couche 5 : Sous-titre arabe -->
				{#if currentSubtitle() && currentSubtitle()!.id}
					{@const arabicRefClip = getReferenceClipForTarget('arabic')}
					<ArabicSubtitle
						subtitleOpacity={subtitleOpacity('arabic')}
						css={getCss('arabic', arabicRefClip?.id, ['background', 'border'])}
						runtimeLayoutCss={getRuntimeLayoutCss('arabic')}
						tailwind={getTailwind('arabic')}
						helperStyles={helperStyles('arabic')}
						isExportCapturePreview={isExportCapturePreview()}
					/>
				{/if}

				<!-- Couche 6 : Traductions -->
				{#each visibleTranslationTargets() as edition (edition)}
					{#if globalState.getVideoStyle.doesTargetStyleExist(edition)}
						{@const translationRefClip = getReferenceClipForTarget(edition)}
						<TranslationSubtitle
							{edition}
							subtitleOpacity={subtitleOpacity(edition)}
							css={getCss(edition, translationRefClip?.id, ['background', 'border'])}
							runtimeLayoutCss={getRuntimeLayoutCss(edition)}
							tailwind={getTailwind(edition)}
							helperStyles={helperStyles(edition)}
							isExportCapturePreview={isExportCapturePreview()}
						/>
					{/if}
				{/each}
			</div>
		{/if}

		<!-- Couche 7 : Décorations fixes -->
		<SurahName />
		<ReciterName />

		{#if currentSubtitle() instanceof SubtitleClip}
			{@const verseSubtitle = currentSubtitle() as SubtitleClip}
			<VerseNumber currentSurah={verseSubtitle.surah} currentVerse={verseSubtitle.verse} />
		{/if}

		<!-- Couche 8 : Clips custom (texte / images) -->
		{#each currentCustomClips() as customText (customText.id)}
			{#if customText.type === 'Custom Text'}
				<CustomText customText={(customText as CustomTextClip).category!} clipId={customText.id} />
			{:else if customText.type === 'Custom Image'}
				<CustomImage
					customImage={(customText as CustomImageClip).category!}
					clipId={customText.id}
				/>
			{/if}
		{/each}
	</div>

	{#if videoFrameSettings.enable}
		<!-- Le tracé pair-impair conserve une fenêtre transparente aux quatre angles identiques. -->
		<svg
			class="pointer-events-none absolute inset-0 z-20 h-full w-full"
			viewBox="0 0 100 100"
			preserveAspectRatio="none"
			aria-hidden="true"
		>
			<path
				d={videoFrameSettings.path}
				fill={videoFrameSettings.color}
				fill-rule="evenodd"
				clip-rule="evenodd"
			></path>
		</svg>
	{/if}
</div>

<!-- ===================================================================== -->
<!-- STYLES                                                               -->
<!-- ===================================================================== -->

<style>
	/** Clone le décor sur chaque fragment créé par le retour à la ligne automatique. */
	:global(#subtitles-container .line-background) {
		position: relative;
		z-index: 0;
		-webkit-box-decoration-break: clone;
		box-decoration-break: clone;
		padding-inline: calc(var(--line-background-height, 0px) / 2);
		padding-block: calc(
			var(--line-background-height) / 2 +
				max(var(--line-background-position), calc(0px - var(--line-background-position)))
		);
		background:
			radial-gradient(circle closest-side, var(--line-background-color) 99%, transparent) left
				calc(50% + var(--line-background-position)) / var(--line-background-height)
				var(--line-background-height) no-repeat,
			radial-gradient(circle closest-side, var(--line-background-color) 99%, transparent) right
				calc(50% + var(--line-background-position)) / var(--line-background-height)
				var(--line-background-height) no-repeat,
			linear-gradient(var(--line-background-color), var(--line-background-color)) center
				calc(50% + var(--line-background-position)) / calc(100% - var(--line-background-height))
				var(--line-background-height) no-repeat;
	}

	/** Dessine la barre WBW hors du flux pour qu'une position basse ne la coupe pas. */
	:global(#subtitles-container .wbw-line-background) {
		position: relative;
	}

	:global(#subtitles-container .wbw-line-background::before) {
		position: absolute;
		z-index: 0;
		top: calc(50% + var(--wbw-line-background-position) - var(--wbw-line-background-height) / 2);
		inset-inline: -0.15em;
		height: var(--wbw-line-background-height);
		background: var(--wbw-line-background-color);
		content: '';
		pointer-events: none;
	}

	/** Maintient tous les glyphes au-dessus des barres WBW voisines. */
	:global(#subtitles-container .wbw-line-background-text) {
		position: relative;
		z-index: 1;
	}

	:global(#subtitles-container .wbw-line-background-single::before) {
		inset-inline: calc(0px - var(--wbw-line-background-padding));
		border-radius: 999px;
	}

	:global(#subtitles-container .wbw-line-background-start::before) {
		inset-inline-start: calc(0px - var(--wbw-line-background-padding));
		border-start-start-radius: 999px;
		border-end-start-radius: 999px;
	}

	:global(#subtitles-container .wbw-line-background-end::before) {
		inset-inline-end: calc(0px - var(--wbw-line-background-padding));
		border-start-end-radius: 999px;
		border-end-end-radius: 999px;
	}

	/**
	 * Conteneur inline pour les segments de traduction.
	 * `white-space: inherit` assure que le parent (qui a `pre-line`)
	 * contrôle les retours à la ligne.
	 */
	.translation-inline-flow {
		display: inline;
		white-space: inherit;
	}

	/**
	 * Conteneur inline pour le flux WBW arabe.
	 * Même principe que ci-dessus.
	 */
	.arabic-wbw-flow {
		display: inline;
		white-space: inherit;
	}

	/** Couche de grille d'alignement au-dessus des sous-titres. */
	.alignment-overlay {
		z-index: 2;
	}

	/**
	 * Grille de repère pour le positionnement des éléments.
	 * Affiche des lignes horizontales et verticales tous les 10%
	 * de la largeur/hauteur de la vidéo.
	 */
	.alignment-grid {
		position: absolute;
		inset: 0;
		background-image:
			linear-gradient(
				to right,
				color-mix(in srgb, var(--text-primary) 28%, transparent) 2px,
				transparent 2px
			),
			linear-gradient(
				to bottom,
				color-mix(in srgb, var(--text-primary) 28%, transparent) 2px,
				transparent 2px
			);
		background-size: 10% 10%;
	}
</style>
