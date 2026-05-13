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
	import { globalState } from '$lib/runes/main.svelte';
	import { untrack } from 'svelte';
	import ReciterName from '../tabs/styleEditor/ReciterName.svelte';
	import SurahName from '../tabs/styleEditor/SurahName.svelte';
	import VerseNumber from '../tabs/styleEditor/VerseNumber.svelte';
	import CustomText from '../tabs/styleEditor/CustomText.svelte';
	import CustomImage from '../tabs/styleEditor/CustomImage.svelte';
	import { convertFileSrc } from '@tauri-apps/api/core';
	import {
		getBackgroundClipIdForTarget as getBackgroundClipIdForTargetUtil,
		getReferenceClipForTarget as getReferenceClipForTargetUtil,
		isVisualMergeTargetMerged
	} from './visualMergeOverlayUtils';

	// Sous-composants
	import ArabicSubtitle from './ArabicSubtitle.svelte';
	import TranslationSubtitle from './TranslationSubtitle.svelte';

	// Helpers extraits
	import { getOverlayLayerCss } from './helpers/overlayCss';
	import { applyReactiveFontSize } from './helpers/reactiveFontSize';
	import { resolveSubtitleCollisions } from './helpers/antiCollision';

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

	/** Durée de fondu pour les éléments WBW : 0 en export, durée normale sinon. */
	let wbwPreviewFadeDuration = $derived(() => {
		return isExportCapturePreview() ? 0 : fadeDuration();
	});

	/** Raccourci vers les paramètres de la timeline. */
	let getTimelineSettings = $derived(() => {
		return globalState.currentProject!.projectEditorState.timeline;
	});

	/** Clip vidéo courant (basé sur la position du curseur). */
	let currentVideoClip = $derived(() => {
		const _ = getTimelineSettings().cursorPosition;
		return untrack(() =>
			globalState.getVideoTrack.getCurrentClip(getTimelineSettings().cursorPosition)
		);
	});

	/** Sous-titre actuellement affiché. */
	let currentSubtitle = $derived(() => {
		const _ = getTimelineSettings().cursorPosition;
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

	/** Clips custom (texte/image) à afficher au temps courant. */
	let currentCustomClips = $derived(() => {
		const _ = getTimelineSettings().cursorPosition;
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
		return {
			enable: Boolean(globalStyles.getEffectiveValue('overlay-enable', clipId)),
			blur: Number(globalStyles.getEffectiveValue('overlay-blur', clipId)),
			opacity: Number(globalStyles.getEffectiveValue('overlay-opacity', clipId)),
			color: String(globalStyles.getEffectiveValue('overlay-color', clipId)),
			mode: String(globalStyles.getEffectiveValue('background-overlay-mode', clipId)),
			fadeIntensity: Number(
				globalStyles.getEffectiveValue('background-overlay-fade-intensity', clipId)
			),
			fadeCoverage: Number(
				globalStyles.getEffectiveValue('background-overlay-fade-coverage', clipId)
			),
			customCSS: String(globalStyles.getEffectiveValue('overlay-custom-css', clipId))
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
	 * de fond semi-transparent si les sections "width" ou "max-height"
	 * sont en mode étendu (pour visualiser les contraintes).
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
				globalState.getSectionsState['width'] &&
				globalState.getSectionsState['max-height'] &&
				(globalState.getSectionsState['width'].extended ||
					globalState.getSectionsState['max-height'].extended)
			) {
				classes += 'bg-[#11A2AF]/50 ';
			}

			return classes;
		}
		return '';
	});

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

	/** Contrôleur d'annulation pour les opérations asynchrones de layout. */
	let currentAbortController: AbortController | null = null;

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
				if (subtitlesContainer) {
					subtitlesContainer.style.opacity = '1';
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

			// Dépendances réactives à tracker (forcent le déclenchement de l'effet)
			consumeReactiveDependencies(
				globalState.getTimelineState.movePreviewTo,
				globalState.getStyle('arabic', 'max-height').value,
				globalState.getStyle('arabic', 'font-size').value,
				globalState.getStyle('global', 'spacing').value
			);

			// Cache les sous-titres pendant le recalcul
			if (subtitlesContainer) {
				subtitlesContainer.style.opacity = '0';
			}

			await untrack(async () => {
				// Annule l'exécution précédente
				if (currentAbortController) {
					currentAbortController.abort();
				}

				currentAbortController = new AbortController();
				const abortSignal = currentAbortController.signal;

				try {
					const targets = ['arabic', ...Object.keys(currentSubtitleTranslations()!)];

					// Étape 1 : Réinitialise les positions Y réactives
					for (const target of targets) {
						globalState.getVideoStyle.getStylesOfTarget(target).setStyle('reactive-y-position', 0);
					}

					// Laisse le DOM se mettre à jour après la réinitialisation
					await wait(abortSignal);

					// Étape 2 : Ajustement réactif de la taille de police
					for (const target of targets) {
						if (abortSignal.aborted) return;

						try {
							const maxHeightValue = globalState.getStyle(target, 'max-height').value as number;
							const initialFontSize = globalState.getStyle(target, 'font-size').value as number;
							const verticalAlign = String(
								globalState.getStyle(target, 'vertical-text-alignment').value
							);
							const isCentered = verticalAlign === 'center';

							await applyReactiveFontSize(
								target,
								maxHeightValue,
								initialFontSize,
								isCentered,
								abortSignal,
								(_target, value) => {
									globalState.getVideoStyle
										.getStylesOfTarget(_target)
										.setStyle('reactive-font-size', value);
								},
								wait
							);
						} catch (error) {
							if (error instanceof Error && error.message === 'Aborted') {
								return;
							}
						}
					}

					// Étape 3 : Résolution des collisions si activée
					if (globalState.getStyle('global', 'anti-collision').value) {
						const translationKeys = Object.keys(currentSubtitleTranslations() || {});
						const spacing = globalState.getStyle('global', 'spacing').value as number;

						await resolveSubtitleCollisions(
							abortSignal,
							spacing,
							translationKeys,
							(target) => {
								return globalState.getStyle(target, 'reactive-y-position').value as number;
							},
							(target, value) => {
								globalState.getVideoStyle
									.getStylesOfTarget(target)
									.setStyle('reactive-y-position', value);
							},
							wait
						);
					}
				} catch (error) {
					if (error instanceof Error && error.message === 'Aborted') {
						return;
					}
				}
			});

			// Réaffiche les sous-titres
			if (subtitlesContainer) {
				subtitlesContainer.style.opacity = '1';
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

	<!-- Couche 4 : Fonds des sous-titres (toujours visibles) -->
	<div
		id="subtitles-backgrounds"
		class="absolute inset-0 z-1 flex flex-col items-center justify-center"
	>
		<!-- Fond arabe -->
		<div
			class={'arabic absolute subtitle select-none' +
				getTailwind('arabic') +
				helperStyles('arabic')}
			style="{getCss('arabic', getBackgroundClipIdForTarget('arabic'))};"
		></div>

		<!-- Fonds des traductions -->
		{#each projectTranslationEditionNames() as edition (edition)}
			{#if globalState.getVideoStyle.doesTargetStyleExist(edition)}
				<div
					class={'translation absolute subtitle select-none ' +
						edition +
						getTailwind(edition) +
						helperStyles(edition)}
					style="{getCss(edition, getBackgroundClipIdForTarget(edition))};"
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
							tailwind={getTailwind(edition)}
							helperStyles={helperStyles(edition)}
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
				<CustomText customText={(customText as CustomTextClip).category!} />
			{:else if customText.type === 'Custom Image'}
				<CustomImage customImage={(customText as CustomImageClip).category!} />
			{/if}
		{/each}
	</div>
</div>

<!-- ===================================================================== -->
<!-- STYLES                                                               -->
<!-- ===================================================================== -->

<style>
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
