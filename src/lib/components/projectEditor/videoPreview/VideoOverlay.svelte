<script lang="ts">
	import {
		CustomTextClip,
		PredefinedSubtitleClip,
		ProjectEditorTabs,
		SubtitleClip
	} from '$lib/classes';
	import { ClipWithTranslation, CustomImageClip } from '$lib/classes/Clip.svelte';
	import {
		VerseTranslation,
		type TranslationInlineStyleFlags
	} from '$lib/classes/Translation.svelte';
	import type { StyleCategoryName } from '$lib/classes/VideoStyle.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { mouseDrag } from '$lib/services/verticalDrag';
	import { untrack } from 'svelte';
	import ReciterName from '../tabs/styleEditor/ReciterName.svelte';
	import SurahName from '../tabs/styleEditor/SurahName.svelte';
	import VerseNumber from '../tabs/styleEditor/VerseNumber.svelte';
	import CustomText from '../tabs/styleEditor/CustomText.svelte';
	import CustomImage from '../tabs/styleEditor/CustomImage.svelte';
	import { Utilities } from '$lib/classes/misc/Utilities';
	import { convertFileSrc } from '@tauri-apps/api/core';
	import {
		createPlainOverlaySegment,
		getBackgroundClipIdForTarget as getBackgroundClipIdForTargetUtil,
		getReferenceClipForTarget as getReferenceClipForTargetUtil,
		getVisibleArabicSegments as getVisibleArabicSegmentsUtil,
		getVisibleTranslationSegments as getVisibleTranslationSegmentsUtil,
		isVisualMergeTargetMerged,
		type OverlayTextSegment
	} from './visualMergeOverlayUtils';

	const fadeDuration = $derived(() => {
		return globalState.getStyle('global', 'fade-duration').value as number;
	});

	let getTimelineSettings = $derived(() => {
		return globalState.currentProject!.projectEditorState.timeline;
	});

	let currentVideoClip = $derived(() => {
		const _ = getTimelineSettings().cursorPosition;
		return untrack(() =>
			globalState.getVideoTrack.getCurrentClip(getTimelineSettings().cursorPosition)
		);
	});

	let currentSubtitle = $derived(() => {
		const _ = getTimelineSettings().cursorPosition;
		return untrack(() => {
			return globalState.getSubtitleTrack.getCurrentSubtitleToDisplay();
		});
	});

	let currentVisualMergeGroup = $derived(() => {
		const subtitle = currentSubtitle();
		if (!(subtitle instanceof SubtitleClip)) return null;
		return globalState.getSubtitleTrack.getVisualMergeGroupForClipId(subtitle.id);
	});

	// Sous-titre de référence pour afficher les backgrounds en continu
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

			// Cherche d'abord le sous-titre (normal ou prédéfini) précédent
			if (indexAfter === -1) {
				// Après le dernier clip: on cherche depuis la fin
				for (let i = clips.length - 1; i >= 0; i--) {
					const c = clips[i];
					if (c instanceof SubtitleClip || c instanceof PredefinedSubtitleClip) return c;
				}
			} else {
				for (let i = indexAfter - 1; i >= 0; i--) {
					const c = clips[i];
					if (c instanceof SubtitleClip || c instanceof PredefinedSubtitleClip) return c;
				}
				// Pas de précédent: on prend le prochain
				for (let i = indexAfter; i < clips.length; i++) {
					const c = clips[i];
					if (c instanceof SubtitleClip || c instanceof PredefinedSubtitleClip) return c;
				}
			}

			return null;
		});
	});

	let currentSubtitleTranslations = $derived(() => {
		const subtitle = currentSubtitle();
		if (!subtitle) return [];
		if (!(subtitle instanceof SubtitleClip || subtitle instanceof PredefinedSubtitleClip))
			return [];
		return subtitle.translations;
	});

	let visibleTranslationTargets = $derived(() => {
		const mergedGroup = currentVisualMergeGroup();
		if (mergedGroup && (mergedGroup.mode === 'translation' || mergedGroup.mode === 'both')) {
			return Object.keys(mergedGroup.firstClip.translations);
		}

		return Object.keys(currentSubtitleTranslations() || {});
	});

	let showDecorativeBrackets = $derived(() => {
		return Boolean(globalState.getStyle('arabic', 'show-decorative-brackets').value);
	});

	let decorativeBracketsGlyphPair = $derived(() => {
		return String(globalState.getStyle('arabic', 'decorative-brackets-font-family').value || 'LM');
	});

	/**
	 * Indique si une cible donnee doit etre rendue via le merge visuel actif.
	 * @param {string} target Cible de style (`arabic` ou nom d'edition).
	 * @returns {boolean} `true` si la cible doit utiliser le groupe merge.
	 */
	function isTargetMerged(target: string): boolean {
		return isVisualMergeTargetMerged(currentVisualMergeGroup(), target);
	}

	/**
	 * Retourne le clip de reference pour les styles de la cible.
	 * @param {string} target Cible de style (`arabic` ou nom d'edition).
	 * @returns {SubtitleClip | PredefinedSubtitleClip | null} Clip de reference.
	 */
	function getReferenceClipForTarget(target: string): SubtitleClip | PredefinedSubtitleClip | null {
		const subtitle = currentSubtitle();
		if (!(subtitle instanceof SubtitleClip || subtitle instanceof PredefinedSubtitleClip)) return null;
		return getReferenceClipForTargetUtil(subtitle, currentVisualMergeGroup(), target);
	}

	/**
	 * Retourne le clip de reference a utiliser pour les backgrounds d'une cible.
	 * @param {string} target Cible de style (`arabic` ou nom d'edition).
	 * @returns {number | undefined} Identifiant du clip de reference.
	 */
	function getBackgroundClipIdForTarget(target: string): number | undefined {
		const background = backgroundSubtitle();
		const subtitleBackground =
			background instanceof SubtitleClip || background instanceof PredefinedSubtitleClip
				? background
				: null;
		return getBackgroundClipIdForTargetUtil(
			currentVisualMergeGroup(),
			subtitleBackground,
			target
		);
	}

	/**
	 * Génère le CSS pour les crochets décoratifs en fonction de la police sélectionnée.
	 * Petites retouches de positionnement et d'échelle pour chaque police.
	 */
	function getDecorativeBracketCss(): string {
		return "font-family: 'QPC2BSML', serif; display: inline-block;";
	}

	function getDecorativeBracketGlyphs(): { opening: string; closing: string } {
		const raw = decorativeBracketsGlyphPair();
		const compact = raw.replaceAll(' ', '').replaceAll('/', '').replaceAll('-', '');
		const allowedPairs = ['LM', 'NO', 'PQ', 'RS', 'TU', 'VW', 'XY', 'Z:', '()'];
		if (allowedPairs.includes(compact) && compact.length >= 2) {
			return { opening: compact[0], closing: compact[1] };
		}
		return { opening: 'L', closing: 'M' };
	}

	// Contient les textes custom à afficher à ce moment précis
	let currentCustomClips = $derived(() => {
		const _ = getTimelineSettings().cursorPosition;
		return untrack(() => {
			return globalState.getCustomClipTrack.getCurrentClips();
		});
	});

	let subtitleImageFailedToLoad = $state(false);

	let currentSubtitleImagePath = $derived(() => {
		const subtitle = currentSubtitle();
		if (!subtitle) return null;
		if (!(subtitle instanceof SubtitleClip || subtitle instanceof PredefinedSubtitleClip))
			return null;

		return subtitle.getAssociatedImagePath();
	});

	$effect(() => {
		currentSubtitleImagePath();
		subtitleImageFailedToLoad = false;
	});

	/**
	 * Retourne les segments arabes rendus pour un clip.
	 * @param {ClipWithTranslation} subtitle Clip a convertir.
	 * @param {string} keyPrefix Prefixe de cle pour les segments.
	 * @returns {OverlayTextSegment[]} Segments du clip.
	 */
	function getArabicOverlaySegments(
		subtitle: ClipWithTranslation,
		keyPrefix: string
	): OverlayTextSegment[] {
		if (subtitle instanceof PredefinedSubtitleClip) {
			return [createPlainOverlaySegment(`${keyPrefix}-arabic`, subtitle.getText())];
		}

		const displayParts = subtitle.getArabicRenderParts('preview');
		const baseSegments =
			(subtitle.arabicInlineStyleRuns?.length ?? 0) > 0
				? subtitle.getArabicInlineStyledSegments('preview').map((segment, index) => ({
						key: `${keyPrefix}-arabic-${index}`,
						text: segment.text,
						flags: segment
					}))
				: [createPlainOverlaySegment(`${keyPrefix}-arabic`, displayParts.text)];

		if (!displayParts.suffix) return baseSegments;

		return [
			...baseSegments,
			createPlainOverlaySegment(
				`${keyPrefix}-suffix`,
				displayParts.suffix,
				displayParts.suffixFontFamily ? `font-family: ${displayParts.suffixFontFamily};` : ''
			)
		];
	}

	/**
	 * Retourne les segments de traduction rendus pour un clip et une edition.
	 * @param {string} edition Edition de traduction.
	 * @param {SubtitleClip} subtitle Clip Quran de reference.
	 * @returns {OverlayTextSegment[]} Segments de traduction.
	 */
	function getTranslationOverlaySegments(edition: string, subtitle: SubtitleClip): OverlayTextSegment[] {
		const translation = subtitle.translations[edition];
		if (!translation) return [];

		if (translation.type === 'verse') {
			const verseTranslation = translation as VerseTranslation;
			const textParts = verseTranslation.getFormattedTextParts(edition, subtitle);
			const segments: OverlayTextSegment[] = [];

			if (textParts.prefix) {
				segments.push(createPlainOverlaySegment(`${edition}-${subtitle.id}-prefix`, textParts.prefix));
			}

			segments.push(
				...verseTranslation.getInlineStyledSegments().map((segment, index) => ({
					key: `${edition}-${subtitle.id}-${index}`,
					text: segment.text,
					flags: segment
				}))
			);

			if (textParts.suffix) {
				segments.push(createPlainOverlaySegment(`${edition}-${subtitle.id}-suffix`, textParts.suffix));
			}

			return segments;
		}

		return [createPlainOverlaySegment(`${edition}-${subtitle.id}`, translation.getText())];
	}

	/**
	 * Retourne les segments arabes a afficher selon le merge visuel actif.
	 * @returns {OverlayTextSegment[]} Segments arabes a rendre.
	 */
	function getVisibleArabicSegments(): OverlayTextSegment[] {
		const subtitle = currentSubtitle();
		return getVisibleArabicSegmentsUtil(
			subtitle instanceof ClipWithTranslation ? subtitle : null,
			currentVisualMergeGroup(),
			getArabicOverlaySegments
		);
	}

	/**
	 * Retourne les segments de traduction a afficher selon le merge visuel actif.
	 * @param {string} edition Edition de traduction.
	 * @returns {OverlayTextSegment[]} Segments de traduction a rendre.
	 */
	function getVisibleTranslationSegments(edition: string): OverlayTextSegment[] {
		const subtitle = currentSubtitle();
		return getVisibleTranslationSegmentsUtil(
			subtitle instanceof SubtitleClip || subtitle instanceof PredefinedSubtitleClip ? subtitle : null,
			currentVisualMergeGroup(),
			edition,
			getTranslationOverlaySegments
		);
	}

	// Calcul de l'opacité des sous-titres (prend en compte les overrides par clip)
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

		if (timeLeft <= halfFade) {
			return Math.max(0, (timeLeft / halfFade) * maxOpacity);
		}

		const startTime = activeRange.startTime;
		const timeSinceStart = currentTime - startTime;

		if (timeSinceStart <= halfFade) {
			return Math.min(maxOpacity, (timeSinceStart / halfFade) * maxOpacity);
		}

		return maxOpacity;
	});

	let getCss = $derived((target: string, clipId?: number, excludedCategories: string[] = []) => {
		return globalState.getVideoStyle
			.getStylesOfTarget(target)
			.generateCSS(clipId, excludedCategories);
	});

	let getTailwind = $derived((target: string) => {
		return globalState.getVideoStyle.getStylesOfTarget(target).generateTailwind();
	});

	/**
	 * Retourne le CSS de padding horizontal à appliquer au texte quand le background est activé.
	 * @param target La cible de style (arabic ou édition de traduction).
	 * @param clipId L'identifiant du clip pour les overrides éventuels.
	 * @returns Une chaîne CSS vide si non applicable, sinon le padding gauche/droite.
	 */
	function getBackgroundHorizontalPaddingCss(target: string, clipId?: number): string {
		const styles = globalState.getVideoStyle.getStylesOfTarget(target);
		const isBackgroundEnabled = Boolean(styles.getEffectiveValue('background-enable', clipId));
		if (!isBackgroundEnabled) return '';

		const padding = Number(styles.getEffectiveValue('background-horizontal-padding', clipId));
		if (!Number.isFinite(padding) || padding <= 0) return '';

		return `padding-left: ${padding}px; padding-right: ${padding}px;`;
	}

	// Liste des éditions de traduction configurées dans le projet (pour backgrounds)
	let projectTranslationEditionNames = $derived(() => {
		return globalState.getProjectTranslation.addedTranslationEditions.map((e) => e.name);
	});

	let helperStyles = $derived((target: string) => {
		// Vérifie que la sélection actuelle correspond à la cible
		if (
			globalState.currentProject?.projectEditorState.currentTab === ProjectEditorTabs.Style &&
			(globalState.getStylesState.currentSelection === target ||
				(globalState.getStylesState.currentSelection === 'translation' &&
					globalState.getStylesState.currentSelectionTranslation === target))
		) {
			let classes = ' ';

			// Si on a certains styles qu'on modifie, on ajoute des styles pour afficher ce qu'ils font
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

	let lastSubtitleId = 0;
	let lastVisualMergeGroupId: string | null = null;

	// Variable pour stocker l'AbortController de l'exécution précédente
	let currentAbortController: AbortController | null = null;
	// Identifie le dernier run de layout afin d'éviter les remises d'opacité
	// provoquées par un run annulé alors qu'un run plus récent est en cours.
	let subtitleLayoutRunId = 0;

	/**
	 * Détecte le target (arabic, traduction, etc.) d'un élément sous-titre
	 * @param element L'élément HTML du sous-titre
	 * @returns Le nom du target ou null si non trouvé
	 */
	function getTargetFromElement(element: HTMLElement): string | null {
		// Chercher dans les classes CSS de l'élément
		const classList = Array.from(element.classList);

		// Vérifier si c'est un sous-titre arabe
		if (classList.includes('arabic')) {
			return 'arabic';
		}

		// Vérifier si c'est une traduction
		const translationKeys = Object.keys(currentSubtitleTranslations() || {});
		for (const translationKey of translationKeys) {
			if (classList.includes(translationKey)) {
				return translationKey;
			}
		}

		return null;
	}

	function consumeReactiveDependencies(..._deps: unknown[]): void {}

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
	 * Gère le max-height (fit on N lines) et la taille de police réactive des sous-titres
	 */
	$effect(() => {
		(async () => {
			const subtitlesContainer = document.getElementById('subtitles-container');

			// Dépendances explicites: relancer à chaque changement de curseur/preview.
			consumeReactiveDependencies(
				globalState.getTimelineState.cursorPosition,
				globalState.getTimelineState.movePreviewTo
			);

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

			// Pendant la lecture: éviter les recalculs pour le même clip
			// et pour les transitions internes d'un même groupe merge visuel.
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

			const runId = ++subtitleLayoutRunId;
			lastSubtitleId = subtitle.id;
			lastVisualMergeGroupId = currentVisualMergeGroupId;

			consumeReactiveDependencies(
				globalState.getStyle('arabic', 'max-height').value,
				globalState.getStyle('arabic', 'font-size').value,
				globalState.getStyle('global', 'spacing').value
			);

			// Cache tout les sous-titres pendant le recalcul pour éviter les sauts visuels
			// sélectionne l'élément d'id subtitles-container
			if (subtitlesContainer && runId === subtitleLayoutRunId) {
				subtitlesContainer.style.opacity = '0';
			}

			await untrack(async () => {
				// Annuler l'exécution précédente si elle existe
				if (currentAbortController) {
					currentAbortController.abort();
				}

				// Créer un nouveau AbortController pour cette exécution
				currentAbortController = new AbortController();
				const abortSignal = currentAbortController.signal;

				try {
					let targets = ['arabic', ...Object.keys(currentSubtitleTranslations()!)];

					// Remettre à zéro toutes les positions réactives quand on change de sous-titre
					for (const target of targets) {
						globalState.getVideoStyle.getStylesOfTarget(target).setStyle('reactive-y-position', 0);
					}

					// Attendre un peu que le DOM se mette à jour après la remise à zéro
					await wait(abortSignal);

					// Utiliser for...of au lieu de forEach pour un meilleur contrôle async
					for (const target of targets) {
						// Vérifier si l'opération a été annulée
						if (abortSignal.aborted) return;

						try {
							const maxHeightValue = globalState.getStyle(target, 'max-height').value as number;
							if (maxHeightValue !== 0) {
								// Make the font-size responsive
								let fontSize = globalState.getStyle(target, 'font-size').value as number;

								globalState.getVideoStyle
									.getStylesOfTarget(target)
									.setStyle('reactive-font-size', fontSize);

								await wait(abortSignal);

								const subtitles = document.querySelectorAll('.' + CSS.escape(target) + '.subtitle');

								// Utiliser for...of pour un meilleur contrôle async
								for (const subtitle of subtitles) {
									// Vérifier si l'opération a été annulée
									if (abortSignal.aborted) return;

									// Cette marge qu'on calcule permet de prévenir un bug qui fait que si le texte est en bas ou à droite, il dépasse un peu et donc que ça considère que c'est plus grand que le max-height
									let isVerticalPosNotCentered =
										String(globalState.getStyle(target, 'vertical-text-alignment').value) !==
										'center';
									let marge = isVerticalPosNotCentered ? 10 : 0; // Marge supplémentaire si le texte n'est pas centré verticalement

									// Tant que la hauteur du texte est supérieure à la hauteur maximale, on réduit la taille de la police
									while (subtitle.scrollHeight > maxHeightValue + marge && fontSize > 1) {
										// Vérifier si l'opération a été annulée
										if (abortSignal.aborted) return;

										fontSize -= fontSize / 20; // Réduction progressive

										globalState.getVideoStyle
											.getStylesOfTarget(target)
											.setStyle('reactive-font-size', fontSize);

										await wait(abortSignal);
									}
								}
							}
						} catch (error) {
							// Ignorer les erreurs d'annulation
							if (error instanceof Error && error.message === 'Aborted') {
								return;
							}
						}
					}

					// Une fois qu'on a traité tout les abaissements de taille de max-height, on gère les collisions
					// Check si l'anti-collision est activé
					if (globalState.getStyle('global', 'anti-collision').value) {
						// Récupère tous les sous-titres visibles
						const allSubtitles = document.querySelectorAll('.subtitle');
						const subtitleElements = Array.from(allSubtitles) as HTMLElement[];

						// Set pour suivre les paires de collisions déjà traitées
						const processedPairs = new Set<string>();

						// Vérifie les collisions pour chaque sous-titre
						for (let i = 0; i < subtitleElements.length; i++) {
							// Vérifie si l'opération a été annulée
							if (abortSignal.aborted) return;

							const currentElement = subtitleElements[i];

							// Récupère son target
							const currentTarget = getTargetFromElement(currentElement);

							if (!currentTarget) continue;

							const currentRect = currentElement.getBoundingClientRect();

							// Chercher les collisions avec les autres sous-titres (seulement ceux après i pour éviter les doublons)
							for (let j = i + 1; j < subtitleElements.length; j++) {
								const otherElement = subtitleElements[j];
								const otherRect = otherElement.getBoundingClientRect();

								// Détecte son target
								const otherTarget = getTargetFromElement(otherElement);

								// Double check pour pas que ce soit le même élément
								if (!otherTarget || currentTarget === otherTarget) continue;

								// Créer un identifiant unique pour cette paire (ordre alphabétique pour éviter les doublons)
								const pairId = [currentTarget, otherTarget].sort().join('-');

								// Si cette paire a déjà été traitée, passer au suivant
								if (processedPairs.has(pairId)) continue;

								// Vérifier s'il y a une collision entre les deux
								const isColliding = !(
									currentRect.bottom < otherRect.top ||
									currentRect.top > otherRect.bottom ||
									currentRect.right < otherRect.left ||
									currentRect.left > otherRect.right
								);

								if (isColliding) {
									// Une collision est détectée entre currentElement et otherElement

									// Marquer cette paire comme traitée
									processedPairs.add(pairId);

									// Déplacer le sous-titre le plus bas vers le bas
									const targetToAdjust =
										currentRect.top > otherRect.top ? currentTarget : otherTarget;

									// Boucle jusqu'à ce qu'il n'y ait plus de collision ou qu'on atteigne la limite d'itérations
									let stillColliding;
									let iterationCount = 0;
									const maxIterations = 10; // Sécurité pour éviter les boucles infinies

									do {
										iterationCount++;

										// Vérifier si l'opération a été annulée
										if (abortSignal.aborted) return;

										// Recalculer les positions actuelles
										const currentRectLoop = currentElement.getBoundingClientRect();
										const otherRectLoop = otherElement.getBoundingClientRect();

										let spacing = globalState.getStyle('global', 'spacing').value as number;

										// Calculer l'ajustement nécessaire basé sur l'overlap actuel
										const overlapHeight = Math.abs(currentRectLoop.bottom - otherRectLoop.top);
										const adjustmentNeeded = overlapHeight + spacing;

										// Vérifier la valeur actuelle avant modification
										const currentValue = globalState.getStyle(targetToAdjust, 'reactive-y-position')
											.value as number;

										// Incrémenter la position réactive
										const newValue = currentValue + adjustmentNeeded;

										// Appliquer le nouvel ajustement
										globalState.getVideoStyle
											.getStylesOfTarget(targetToAdjust)
											.setStyle('reactive-y-position', newValue);

										// Attendre que le DOM se mette à jour
										await wait(abortSignal);

										// Vérifier les nouvelles positions après ajustement
										const newCurrentRect = currentElement.getBoundingClientRect();
										const newOtherRect = otherElement.getBoundingClientRect();

										// Vérifier s'il y a encore collision
										stillColliding = !(
											newCurrentRect.bottom + spacing < newOtherRect.top ||
											newCurrentRect.top - spacing > newOtherRect.bottom ||
											newCurrentRect.right + spacing < newOtherRect.left ||
											newCurrentRect.left - spacing > newOtherRect.right
										);
									} while (stillColliding && iterationCount < maxIterations);
								}
							}
						}
					}
				} catch (error) {
					// Ignorer les erreurs d'annulation
					if (error instanceof Error && error.message === 'Aborted') {
						return;
					}
				}
			});

			// Une fois tout ça fait, on remet l'opacité normale
			// sélectionne l'élément d'id subtitles-container
			if (subtitlesContainer && runId === subtitleLayoutRunId) {
				subtitlesContainer.style.opacity = '1';
			}
		})();
	});

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

	function getOverlayLayerCss(): string {
		const settings = overlaySettings();
		const mode = String(settings.mode || 'uniform');
		const opacity = Utilities.clamp01(Number(settings.opacity));

		if (mode === 'uniform') {
			return `background-color: ${settings.color}; opacity: ${opacity};`;
		}

		const intensity = Utilities.clamp01(Number(settings.fadeIntensity));
		const fadeCoverage = Utilities.clamp01(Number(settings.fadeCoverage));
		const [r, g, b] = Utilities.parseColorToRgb(String(settings.color || '#000000'));
		const edgeOpacity = opacity * (1 - intensity);
		const centerOpacity = opacity;

		let gradient = '';
		if (mode === 'fade-up') {
			const fadeEndPct = Math.max(0, Math.min(100, fadeCoverage * 100));
			gradient = `linear-gradient(to bottom, rgba(${r}, ${g}, ${b}, ${edgeOpacity}) 0%, rgba(${r}, ${g}, ${b}, ${centerOpacity}) ${fadeEndPct}%, rgba(${r}, ${g}, ${b}, ${centerOpacity}) 100%)`;
		} else if (mode === 'fade-down') {
			const fadeStartPct = Math.max(0, Math.min(100, 100 - fadeCoverage * 100));
			gradient = `linear-gradient(to bottom, rgba(${r}, ${g}, ${b}, ${centerOpacity}) 0%, rgba(${r}, ${g}, ${b}, ${centerOpacity}) ${fadeStartPct}%, rgba(${r}, ${g}, ${b}, ${edgeOpacity}) 100%)`;
		} else if (mode === 'fade-center') {
			const fadeEdgePct = Math.max(0, Math.min(50, fadeCoverage * 50));
			const centerStartPct = fadeEdgePct;
			const centerEndPct = 100 - fadeEdgePct;
			gradient = `linear-gradient(to bottom, rgba(${r}, ${g}, ${b}, ${edgeOpacity}) 0%, rgba(${r}, ${g}, ${b}, ${centerOpacity}) ${centerStartPct}%, rgba(${r}, ${g}, ${b}, ${centerOpacity}) ${centerEndPct}%, rgba(${r}, ${g}, ${b}, ${edgeOpacity}) 100%)`;
		} else {
			return `background-color: ${settings.color}; opacity: ${opacity};`;
		}

		return `background: ${gradient}; opacity: 1;`;
	}

	function getInlineStyleCss(flags: TranslationInlineStyleFlags): string {
		const parts: string[] = [];
		if (flags.bold) parts.push('font-weight: 700;');
		if (flags.italic) parts.push('font-style: italic;');
		if (flags.underline) parts.push('text-decoration: underline;');
		if (flags.color) parts.push(`color: ${flags.color};`);
		return parts.join(' ');
	}

	let canShowAlignmentOverlay = $derived(() => {
		const isStyleTab =
			globalState.currentProject?.projectEditorState.currentTab === ProjectEditorTabs.Style;
		if (globalState.getVideoPreviewState.showAlignmentGridWhileDragging) return true;
		return isStyleTab && globalState.getVideoPreviewState.showAlignmentGrid;
	});
</script>

<div class="inset-0 absolute" style="" id="overlay">
	{#if canShowAlignmentOverlay()}
		<div class="alignment-overlay absolute inset-0 pointer-events-none" aria-hidden="true">
			<div class="alignment-grid"></div>
		</div>
	{/if}

	{#if currentSubtitleImagePath() && !subtitleImageFailedToLoad}
		<div
			class="absolute inset-0 z-0 pointer-events-none select-none"
			style={`opacity: ${subtitleOpacity('arabic')}; background-image: url('${convertFileSrc(currentSubtitleImagePath()!)}'); background-size: contain; background-position: center; background-repeat: no-repeat;`}
		></div>
	{/if}

	{#if overlaySettings().enable}
		<div
			class="absolute inset-0 z-0"
			style="{getOverlayLayerCss()} {overlaySettings().customCSS};"
		></div>

		<div
			class="absolute inset-0 z-0"
			style="backdrop-filter: blur({overlaySettings().blur}px);"
		></div>
	{/if}

	<!-- Backgrounds des sous-titres: toujours visibles, basés sur le dernier/next sous-titre -->
	<div
		id="subtitles-backgrounds"
		class="absolute inset-0 z-1 flex flex-col items-center justify-center"
	>
		<!-- Background arabe -->
		<div
			class={'arabic absolute subtitle select-none' +
				getTailwind('arabic') +
				helperStyles('arabic')}
			style="{getCss('arabic', getBackgroundClipIdForTarget('arabic'))};"
		></div>

		<!-- Backgrounds des traductions -->
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

	<div class="w-full h-full absolute inset-0 flex flex-col items-center justify-center">
		{#if currentSubtitle()}
			{@const subtitle = currentSubtitle()}
			{#snippet overlaySegmentsContent(segments: OverlayTextSegment[])}
				<span class="translation-inline-flow">
					{#each segments as segment (segment.key)}
						<span style={`${getInlineStyleCss(segment.flags)} ${segment.extraCss ?? ''}`}>
							{segment.text}
						</span>
					{/each}
				</span>
			{/snippet}
			<div
				id="subtitles-container"
				class="absolute inset-0 z-1 flex flex-col items-center justify-center"
				style="opacity: 1;"
			>
				{#if subtitle && subtitle.id}
					{@const arabicReferenceClip = getReferenceClipForTarget('arabic')}
					{@const arabicSegments = getVisibleArabicSegments()}
					<p
						ondblclick={() => {
							globalState.getVideoStyle.highlightCategory('arabic', 'general');
						}}
						use:mouseDrag={{
							target: 'arabic',
							verticalStyleId: 'vertical-position',
							horizontalStyleId: 'horizontal-position'
						}}
						class={'arabic absolute subtitle select-none z-10 ' +
							getTailwind('arabic') +
							helperStyles('arabic')}
						style="opacity: {subtitleOpacity('arabic')}; {getCss('arabic', arabicReferenceClip?.id, [
							'background',
							'border'
						])}; {getBackgroundHorizontalPaddingCss('arabic', arabicReferenceClip?.id)} white-space: pre-line;"
					>
						{#if subtitle instanceof SubtitleClip || subtitle instanceof PredefinedSubtitleClip}
							{@const bracketGlyphs = getDecorativeBracketGlyphs()}
							{#if showDecorativeBrackets() && arabicSegments.some((segment) => segment.text.trim().length > 0)}
								<span style={getDecorativeBracketCss()}>{bracketGlyphs.opening}</span>
								{@render overlaySegmentsContent(arabicSegments)}
								<span style={getDecorativeBracketCss()}>{bracketGlyphs.closing}</span>
							{:else}
								{@render overlaySegmentsContent(arabicSegments)}
							{/if}
						{/if}
					</p>
				{/if}

				{#each visibleTranslationTargets() as edition (edition)}
					{#if globalState.getVideoStyle.doesTargetStyleExist(edition)}
						{@const translationReferenceClip = getReferenceClipForTarget(edition)}
						<p
							ondblclick={() => {
								globalState.getVideoStyle.highlightCategory(
									'translation',
									edition as StyleCategoryName
								);
							}}
							use:mouseDrag={{
								target: edition,
								verticalStyleId: 'vertical-position',
								horizontalStyleId: 'horizontal-position'
							}}
							class={`translation absolute subtitle select-none z-10 ${edition} ${getTailwind(edition)} ${helperStyles(edition)}`}
							style={`opacity: ${subtitleOpacity(edition)}; ${getCss(edition, translationReferenceClip?.id, [
								'background',
								'border'
							])}; ${getBackgroundHorizontalPaddingCss(edition, translationReferenceClip?.id)} white-space: pre-line;`}
						>
							{@render overlaySegmentsContent(getVisibleTranslationSegments(edition))}
						</p>
					{/if}
				{/each}
			</div>
		{/if}

		<SurahName />
		<ReciterName />

		{#if currentSubtitle() instanceof SubtitleClip}
			{@const verseSubtitle = currentSubtitle() as SubtitleClip}
			<VerseNumber currentSurah={verseSubtitle.surah} currentVerse={verseSubtitle.verse} />
		{/if}

		{#each currentCustomClips() as customText (customText.id)}
			{#if customText.type === 'Custom Text'}
				<CustomText customText={(customText as CustomTextClip).category!} />
			{:else if customText.type === 'Custom Image'}
				<CustomImage customImage={(customText as CustomImageClip).category!} />
			{/if}
		{/each}
	</div>
</div>

<style>
	.translation-inline-flow {
		display: inline;
		white-space: inherit;
	}

	.alignment-overlay {
		z-index: 2;
	}

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
