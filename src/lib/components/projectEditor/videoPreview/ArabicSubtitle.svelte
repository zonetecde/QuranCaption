<script lang="ts">
	import { PredefinedSubtitleClip, SubtitleClip } from '$lib/classes';
	import { ClipWithTranslation } from '$lib/classes/Clip.svelte';
	import {
		EMPTY_INLINE_STYLE_FLAGS,
		getInlineStyleCss,
		getInlineStyleFlagsForWordIndex,
		type TranslationInlineStyleFlags
	} from '$lib/classes/Translation.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { mouseDrag } from '$lib/services/verticalDrag';
	import {
		getTranscriptReferenceLogicalParts,
		getTranscriptReferenceRenderParts,
		parseQuranTranscriptReference,
		prefetchTranscriptReferences,
		type QuranTranscriptReference
	} from '$lib/services/TranscriptReferenceService';
	import { untrack } from 'svelte';
	import type { SegmentationWordTimestamp } from '$lib/services/AutoSegmentation';
	import {
		createPlainOverlaySegment,
		getMergedClipsWithoutWordOverlap,
		getVisibleArabicSegments as getVisibleArabicSegmentsUtil,
		isVisualMergeTargetMerged,
		type OverlayTextSegment
	} from './visualMergeOverlayUtils';
	import {
		type WordByWordHighlightState,
		getWordByWordHighlightState as computeWordByWordHighlightState,
		getWordByWordHighlightProgress as computeWordByWordHighlightProgress,
		getWordByWordWordCss as buildWordByWordWordCss,
		getWordByWordWordOpacity,
		interpolateCssColor
	} from './wordByWordHighlightUtils';
	import {
		getDecorativeBracketCss,
		getDecorativeBracketGlyphs
	} from './helpers/decorativeBrackets';
	import {
		getBackgroundHorizontalPaddingCss,
		getExportCaptureLayoutCss
	} from './helpers/overlayCss';

	/**
	 * Propriétés reçues du composant parent VideoOverlay.
	 * Tout le reste (subtitle courant, styles, etc.) est dérivé
	 * directement depuis `globalState`.
	 */
	interface ArabicSubtitleProps {
		/** Opacité calculée du sous-titre arabe au temps courant. */
		subtitleOpacity: number;
		/** CSS complet généré pour la cible arabe (hors background/border). */
		css: string;
		/** CSS runtime calculé par la preview (font-size et offset non persistés). */
		runtimeLayoutCss: string;
		/** Classes Tailwind générées pour la cible arabe. */
		tailwind: string;
		/** Classes CSS d'aide visuelle (ex: surbrillance de la zone éditée). */
		helperStyles: string;
		/** Indique si on est en mode capture d'export. */
		isExportCapturePreview: boolean;
	}

	let {
		subtitleOpacity,
		css,
		runtimeLayoutCss,
		tailwind,
		helperStyles,
		isExportCapturePreview
	}: ArabicSubtitleProps = $props();

	// =========================================================================
	// Dérivations réactives depuis globalState
	// =========================================================================

	/** Position actuelle du curseur sur la timeline. */
	let getTimelineSettings = $derived(() => {
		return globalState.currentProject!.projectEditorState.timeline;
	});

	/** Sous-titre actuellement affiché. */
	let currentSubtitle = $derived(() => {
		const _ = getTimelineSettings().cursorPosition;
		return untrack(() => {
			return globalState.getSubtitleTrack.getCurrentSubtitleToDisplay();
		});
	});

	let referenceRenderVersion = $state(0);

	$effect(() => {
		const subtitle = currentSubtitle();
		if (!(subtitle instanceof SubtitleClip)) return;

		void prefetchTranscriptReferences([subtitle.text]).then(() => {
			referenceRenderVersion += 1;
		});
	});

	/** Groupe de fusion visuelle actif (si le sous-titre courant est fusionné). */
	let currentVisualMergeGroup = $derived(() => {
		const subtitle = currentSubtitle();
		if (!(subtitle instanceof SubtitleClip)) return null;
		return globalState.getSubtitleTrack.getVisualMergeGroupForClipId(subtitle.id);
	});

	/** Durée de fondu configurée. */
	let fadeDuration = $derived(() => {
		return globalState.getStyle('global', 'fade-duration').value as number;
	});

	/** Durée de fondu pour la preview WBW (0 en mode export pour éviter les artefacts). */
	let wbwPreviewFadeDuration = $derived(() => {
		return isExportCapturePreview ? 0 : fadeDuration();
	});

	/** Affiche-t-on les crochets décoratifs ? */
	let showDecorativeBrackets = $derived(() => {
		return Boolean(globalState.getStyle('arabic-quran', 'show-decorative-brackets').value);
	});

	/** Paire de glyphes brute pour les crochets décoratifs. */
	let decorativeBracketsGlyphPair = $derived(() => {
		return String(
			globalState.getStyle('arabic-quran', 'decorative-brackets-font-family').value || 'LM'
		);
	});

	// =========================================================================
	// Fonctions de rendu arabe
	// =========================================================================

	/**
	 * Renvoie les glyphes ouvrant/fermant des crochets décoratifs
	 * à partir de la valeur de style configurée.
	 */
	function getBracketGlyphs(): { opening: string; closing: string } {
		return getDecorativeBracketGlyphs(decorativeBracketsGlyphPair());
	}

	/**
	 * Génère uniquement les styles autorisés pour une référence arabe.
	 * @param {'quran' | 'citation'} referenceType Type de portion ciblée.
	 * @param {number} clipId Identifiant du clip pour les overrides locaux.
	 * @returns {string} CSS à appliquer au span de référence.
	 */
	function getReferenceStyleCss(referenceType: 'quran' | 'citation', clipId: number): string {
		const target = referenceType === 'quran' ? 'arabic-quran' : 'arabic-citation';
		const styles = globalState.getVideoStyle.getStylesOfTarget(target);
		let referenceCss = styles.generateCSS(clipId, [
			'general',
			'word-by-word-highlight',
			'positioning',
			'background',
			'border',
			'shadow',
			'outline',
			'animation',
			'custom-css'
		]);
		if (styles.getEffectiveValue('font-family', clipId) === 'Hafs') {
			referenceCss += 'font-family: Hafs, sans-serif;';
		}
		const opacity = styles.getEffectiveValue('opacity', clipId);
		if (opacity !== '' && Number.isFinite(Number(opacity))) {
			referenceCss += `opacity: ${Number(opacity)};`;
		}
		return referenceCss;
	}

	/**
	 * Indique si une plage Quran continue dans le sous-titre adjacent.
	 * @param {OverlayTextSegment} segment Portion Quran affichée.
	 * @param {-1 | 1} direction Sous-titre précédent ou suivant.
	 * @returns {boolean} `true` si les deux plages sont consécutives dans le même verset.
	 */
	function isQuranReferenceContinued(
		segment: Pick<OverlayTextSegment, 'quranReference' | 'sourceClipId'>,
		direction: -1 | 1
	): boolean {
		const reference = segment.quranReference;
		if (!reference || !segment.sourceClipId) return false;

		const clips = globalState.getSubtitleTrack.clips;
		const sourceIndex = clips.findIndex((clip) => clip.id === segment.sourceClipId);
		if (sourceIndex < 0) return false;
		const adjacentClip = clips
			.slice(direction < 0 ? 0 : sourceIndex + 1, direction < 0 ? sourceIndex : undefined)
			.filter((clip): clip is SubtitleClip => clip instanceof SubtitleClip)
			.at(direction < 0 ? -1 : 0);
		if (!adjacentClip) return false;

		return Array.from(adjacentClip.text.matchAll(/\{\{([^{}]+)\}\}/g)).some((match) => {
			const adjacentReference = parseQuranTranscriptReference(match[1]);
			if (
				!adjacentReference ||
				adjacentReference.surah !== reference.surah ||
				adjacentReference.verse !== reference.verse
			)
				return false;
			return direction < 0
				? reference.startWord !== null && adjacentReference.endWord === reference.startWord - 1
				: reference.endWord !== null && adjacentReference.startWord === reference.endWord + 1;
		});
	}

	/**
	 * Indique si la cible `arabic` est actuellement fusionnée visuellement.
	 */
	function isArabicMerged(): boolean {
		return isVisualMergeTargetMerged(currentVisualMergeGroup(), 'arabic');
	}

	/**
	 * Retourne le clip de référence pour les styles de la cible arabe.
	 */
	function getArabicReferenceClip(): SubtitleClip | PredefinedSubtitleClip | null {
		const subtitle = currentSubtitle();
		if (!(subtitle instanceof SubtitleClip || subtitle instanceof PredefinedSubtitleClip))
			return null;
		if (isArabicMerged()) {
			return currentVisualMergeGroup()?.firstClip ?? null;
		}
		return subtitle;
	}

	// =========================================================================
	// Génération des segments de texte arabe
	// =========================================================================

	/**
	 * Convertit un clip en segments de texte pour l'overlay vidéo.
	 *
	 * Stratégie :
	 * 1. Clip prédéfini → texte brut.
	 * 2. Clip sans styles inline → un seul segment texte (concaténé avec le suffixe si pas de police distincte).
	 * 3. Clip avec styles inline → un segment par portion stylée.
	 *
	 * @param subtitle - Le clip à convertir en segments.
	 * @param keyPrefix - Préfixe de clé pour la stabilité du rendu.
	 * @returns Les segments de texte à afficher.
	 */
	function getArabicOverlaySegments(
		subtitle: ClipWithTranslation,
		keyPrefix: string
	): OverlayTextSegment[] {
		if (subtitle instanceof PredefinedSubtitleClip) {
			return [createPlainOverlaySegment(`${keyPrefix}-arabic`, subtitle.getText())];
		}
		if (subtitle instanceof SubtitleClip) {
			const referenceParts = getTranscriptReferenceRenderParts(
				subtitle.text,
				String(globalState.getStyle('arabic-quran', 'mushaf-style')?.value ?? 'Uthmani'),
				String(globalState.getStyle('arabic-quran', 'font-family')?.value ?? 'Hafs')
			);
			if (referenceParts) {
				return referenceParts.map((part, index) => {
					const referenceType = part.isQuran ? 'quran' : part.isCitation ? 'citation' : undefined;
					const referenceCss = referenceType
						? getReferenceStyleCss(referenceType, subtitle.id)
						: '';
					return createPlainOverlaySegment(
						`${keyPrefix}-reference-${index}`,
						part.text,
						`${referenceCss} ${part.extraCss}`.trim(),
						referenceType,
						part.quranReference,
						subtitle.id
					);
				});
			}
		}

		const displayParts = subtitle.getArabicRenderParts('preview');
		const perClipFontCss = '';
		const suffixFontCss = displayParts.suffixFontFamily
			? `font-family: ${displayParts.suffixFontFamily}; `
			: perClipFontCss;
		const hasInlineStyles = (subtitle.arabicInlineStyleRuns?.length ?? 0) > 0;

		if (!hasInlineStyles) {
			const segments = [
				createPlainOverlaySegment(`${keyPrefix}-arabic`, displayParts.text, perClipFontCss)
			];

			if (displayParts.suffix) {
				segments.push(
					createPlainOverlaySegment(
						`${keyPrefix}-suffix`,
						displayParts.suffix,
						suffixFontCss + 'color: var(--verse-number-color);'
					)
				);
			}
			return segments;
		}

		// Avec styles inline : un segment par portion stylée
		const baseSegments = subtitle
			.getArabicInlineStyledSegments('preview')
			.map((segment, index) => ({
				key: `${keyPrefix}-arabic-${index}`,
				text: segment.text,
				flags: segment,
				extraCss: perClipFontCss
			}));

		if (!displayParts.suffix) return baseSegments;

		return [
			...baseSegments,
			createPlainOverlaySegment(
				`${keyPrefix}-suffix`,
				displayParts.suffix,
				suffixFontCss + 'color: var(--verse-number-color);'
			)
		];
	}

	/**
	 * Retourne les segments arabes visibles en tenant compte de la fusion visuelle.
	 */
	function getVisibleArabicSegments(): OverlayTextSegment[] {
		const subtitle = currentSubtitle();
		return getVisibleArabicSegmentsUtil(
			subtitle instanceof ClipWithTranslation ? subtitle : null,
			currentVisualMergeGroup(),
			getArabicOverlaySegments
		);
	}

	// =========================================================================
	// Rendu Word-By-Word (WBW)
	// =========================================================================

	/** Mot rendu avec un ou plusieurs timings WBW. */
	type ArabicWordByWordEntry = {
		text: string;
		timings: SegmentationWordTimestamp[];
		flags: TranslationInlineStyleFlags;
	};

	/** Groupe visuel continu partageant le même style de référence. */
	type ArabicWordByWordGroup = {
		words: ArabicWordByWordEntry[];
		startWordIndex: number;
		suffix: string;
		suffixFontFamily: string | null;
		extraCss: string;
		baseColor: string | null;
		referenceType?: 'quran' | 'citation';
		quranReference?: QuranTranscriptReference;
		sourceClipId: number;
	};

	/** Structure de données pour le rendu WBW arabe. */
	type ArabicWordByWordRenderData = {
		words: ArabicWordByWordEntry[];
		groups: ArabicWordByWordGroup[];
		clipStartTimeS: number;
	};

	/** Description d'un groupe avant association de ses timings. */
	type ArabicWordByWordGroupDefinition = Omit<ArabicWordByWordGroup, 'words' | 'startWordIndex'> & {
		wordTexts: string[];
	};

	/**
	 * Compte le nombre de mots qui se chevauchent entre la fin
	 * d'un groupe et le début du groupe suivant.
	 *
	 * @param previousWords - Liste des mots du groupe précédent.
	 * @param currentWords - Liste des mots du groupe courant.
	 * @returns Nombre de mots en chevauchement.
	 */
	function countWordOverlap(previousWords: string[], currentWords: string[]): number {
		const maxOverlap = Math.min(previousWords.length, currentWords.length);
		for (let overlap = maxOverlap; overlap > 0; overlap--) {
			const previousTail = previousWords.slice(previousWords.length - overlap);
			const currentHead = currentWords.slice(0, overlap);
			if (previousTail.every((word, index) => word === currentHead[index])) {
				return overlap;
			}
		}
		return 0;
	}

	/**
	 * Sélectionne le timing à utiliser pour un mot dans le clip courant.
	 *
	 * Priorités :
	 * 1. Timing correspondant au clipId courant.
	 * 2. Timing actif (curseur dans [start, end]).
	 * 3. Dernier timing passé.
	 * 4. Premier timing disponible.
	 *
	 * @param timings - Timings disponibles pour ce mot.
	 * @param cursorTimeS - Position du curseur en secondes.
	 * @param currentClipId - ID du clip courant (pour le matching prioritaire).
	 * @returns Le timing sélectionné, ou `null` si aucun.
	 */
	function selectWordTimingForCurrentClip(
		timings: SegmentationWordTimestamp[],
		cursorTimeS: number,
		currentClipId: number | null
	): SegmentationWordTimestamp | null {
		const validTimings = timings.filter(
			(timing): timing is SegmentationWordTimestamp => timing !== undefined && timing !== null
		);
		if (validTimings.length === 0) return null;

		// Priorité 1 : timing correspondant au clip courant
		if (currentClipId !== null) {
			const currentClipTiming = validTimings.find(
				(timing) =>
					(timing as SegmentationWordTimestamp & { clipId?: number }).clipId === currentClipId
			);
			if (currentClipTiming) return currentClipTiming;
		}

		// Priorité 2 : timing actif
		const activeTiming = validTimings.find(
			(word) => cursorTimeS >= word.start && cursorTimeS <= word.end
		);
		if (activeTiming) return activeTiming;

		// Priorité 3 : dernier timing passé
		const pastTimings = validTimings.filter((word) => word.start <= cursorTimeS);
		if (pastTimings.length > 0) {
			return pastTimings[pastTimings.length - 1];
		}

		// Priorité 4 : premier timing
		return validTimings[0];
	}

	/**
	 * Fusionne deux jeux de flags inline en donnant priorite au second.
	 * @param {TranslationInlineStyleFlags} base Flags deja presents.
	 * @param {TranslationInlineStyleFlags} override Flags a appliquer en priorite.
	 * @returns {TranslationInlineStyleFlags} Resultat fusionne.
	 */
	function mergeInlineStyleFlags(
		base: TranslationInlineStyleFlags,
		override: TranslationInlineStyleFlags
	): TranslationInlineStyleFlags {
		return {
			bold: Boolean(base.bold || override.bold),
			italic: Boolean(base.italic || override.italic),
			underline: Boolean(base.underline || override.underline),
			lineBreak: Boolean(base.lineBreak || override.lineBreak),
			color: override.color ?? base.color ?? null
		};
	}

	/** Sépare un texte affiché en unités WBW non vides. */
	function splitVisibleWords(text: string): string[] {
		return text.trim().split(/\s+/).filter(Boolean);
	}

	/**
	 * Extrait un éventuel numéro de verset ajouté au texte Quran rendu.
	 * @param {string} text Texte Quran déjà résolu.
	 * @returns {{ text: string; suffix: string }} Texte sans suffixe et suffixe séparé.
	 */
	function splitRenderedQuranSuffix(text: string): { text: string; suffix: string } {
		const match = /^(.*?)(\s+۝\d+)\s*$/u.exec(text.trim());
		return match ? { text: match[1].trim(), suffix: match[2] } : { text: text.trim(), suffix: '' };
	}

	/**
	 * Construit les groupes visibles d'un clip en conservant les styles Quran/citation.
	 * Le nombre total d'unités doit correspondre exactement aux timings disponibles.
	 */
	function buildClipWordGroupDefinitions(
		sourceClip: SubtitleClip,
		alignmentWordTexts: string[]
	): ArabicWordByWordGroupDefinition[] | null {
		const logicalParts = getTranscriptReferenceLogicalParts(sourceClip.text);
		if (!logicalParts) {
			const displayParts = sourceClip.getArabicRenderParts('preview');
			const visibleWords = displayParts.words ?? splitVisibleWords(displayParts.text);
			if (visibleWords.length !== alignmentWordTexts.length) return null;
			return [
				{
					wordTexts: visibleWords,
					suffix: displayParts.suffix,
					suffixFontFamily: displayParts.suffixFontFamily,
					extraCss: '',
					baseColor: null,
					sourceClipId: sourceClip.id
				}
			];
		}

		const renderedParts =
			getTranscriptReferenceRenderParts(
				sourceClip.text,
				String(globalState.getStyle('arabic-quran', 'mushaf-style')?.value ?? 'Uthmani'),
				String(globalState.getStyle('arabic-quran', 'font-family')?.value ?? 'Hafs')
			) ?? [];
		const counts = logicalParts.map((part) => part.wordCount);
		const unknownIndexes = counts.flatMap((count, index) => (count === null ? [index] : []));
		const knownCount = counts.reduce<number>((sum, count) => sum + (count ?? 0), 0);

		if (unknownIndexes.length === 1) {
			counts[unknownIndexes[0]] = alignmentWordTexts.length - knownCount;
		} else if (unknownIndexes.length > 1) {
			for (const index of unknownIndexes) {
				const rendered = renderedParts[index];
				const renderedText = rendered?.isQuran ? splitRenderedQuranSuffix(rendered.text).text : '';
				const renderedCount = splitVisibleWords(renderedText).length;
				if (renderedCount <= 0) return null;
				counts[index] = renderedCount;
			}
		}

		if (counts.some((count) => count === null || count < 0)) return null;
		if (
			counts.reduce<number>((sum, count) => sum + Number(count), 0) !== alignmentWordTexts.length
		) {
			return null;
		}

		const definitions: ArabicWordByWordGroupDefinition[] = [];
		let wordCursor = 0;
		for (const [index, part] of logicalParts.entries()) {
			const wordCount = Number(counts[index]);
			if (wordCount === 0) continue;
			const alignedWords = alignmentWordTexts.slice(wordCursor, wordCursor + wordCount);
			const renderedPart = renderedParts[index];
			let wordTexts = alignedWords;
			let suffix = '';
			let suffixFontFamily: string | null = null;

			if (part.referenceType === 'quran') {
				const renderedQuran = renderedPart?.isQuran
					? splitRenderedQuranSuffix(renderedPart.text)
					: { text: '', suffix: '' };
				const renderedWords =
					renderedPart?.isQuran && renderedPart.words
						? renderedPart.words
						: splitVisibleWords(renderedQuran.text);
				if (renderedPart?.isQuran && renderedWords.length === wordCount) {
					wordTexts = renderedWords;
				}
				suffix = renderedPart?.suffix ?? renderedQuran.suffix;
				suffixFontFamily = renderedPart?.suffixFontFamily ?? null;
			} else {
				const sourceWords = splitVisibleWords(part.text);
				if (sourceWords.length === wordCount) wordTexts = sourceWords;
			}

			const referenceCss = part.referenceType
				? getReferenceStyleCss(part.referenceType, sourceClip.id)
				: '';
			const referenceBaseColor = part.referenceType
				? String(
						globalState.getVideoStyle
							.getStylesOfTarget(
								part.referenceType === 'quran' ? 'arabic-quran' : 'arabic-citation'
							)
							.getEffectiveValue('text-color', sourceClip.id) ?? ''
					)
				: null;
			definitions.push({
				wordTexts,
				suffix,
				suffixFontFamily,
				extraCss: `${referenceCss} ${renderedPart?.extraCss ?? ''}`.trim(),
				baseColor: referenceBaseColor,
				referenceType: part.referenceType ?? undefined,
				quranReference: part.quranReference,
				sourceClipId: sourceClip.id
			});
			wordCursor += wordCount;
		}
		return wordCursor === alignmentWordTexts.length ? definitions : null;
	}

	/**
	 * Construit les données de rendu WBW pour le sous-titre arabe courant.
	 *
	 * Gère la fusion visuelle : si le texte arabe est fusionné, on agrège
	 * les mots de tous les clips du groupe en supprimant les chevauchements.
	 *
	 * @returns Les données de rendu WBW, ou `null` si les données d'alignement
	 *          sont absentes ou si le rendu WBW n'est pas applicable.
	 */
	function buildArabicWordByWordRenderData(): ArabicWordByWordRenderData | null {
		const subtitle = currentSubtitle();
		if (!(subtitle instanceof SubtitleClip)) return null;

		const mergedGroup = currentVisualMergeGroup();
		const sourceClips =
			mergedGroup && isArabicMerged()
				? getMergedClipsWithoutWordOverlap(mergedGroup.clips)
				: [subtitle];

		const shouldUseMergedSource =
			mergedGroup &&
			isArabicMerged() &&
			mergedGroup.clips.every((clip) => (clip.alignmentMetadata?.words.length ?? 0) > 0);

		if (mergedGroup && isArabicMerged() && !shouldUseMergedSource) return null;
		if (!shouldUseMergedSource && (subtitle.alignmentMetadata?.words.length ?? 0) === 0) {
			return null;
		}

		const clipStartTimeS = shouldUseMergedSource
			? mergedGroup!.startTime / 1000
			: (subtitle.alignmentMetadata?.timeFrom ?? 0);
		const words: ArabicWordByWordEntry[] = [];
		const groups: ArabicWordByWordGroup[] = [];
		let visibleWordTexts: string[] = [];

		for (const sourceClip of sourceClips) {
			const alignmentWords = sourceClip.alignmentMetadata?.words ?? [];
			const dedupedAlignmentWords = alignmentWords.filter(
				(word, index, candidates) =>
					!('location' in word) ||
					!word.location ||
					candidates.findIndex(
						(candidate) => 'location' in candidate && candidate.location === word.location
					) === index
			);
			if (dedupedAlignmentWords.length === 0) continue;

			const alignmentWordTexts = dedupedAlignmentWords.map((word) => word.word?.trim() ?? '');
			if (alignmentWordTexts.some((word) => !word)) return null;
			const groupDefinitions = buildClipWordGroupDefinitions(sourceClip, alignmentWordTexts);
			if (!groupDefinitions) return null;
			const clipVisibleWords = groupDefinitions.flatMap((group) => group.wordTexts);
			if (clipVisibleWords.length !== dedupedAlignmentWords.length) return null;

			const clipOffsetS = shouldUseMergedSource
				? (sourceClip.startTime - mergedGroup!.startTime) / 1000
				: 0;
			const timingCandidates = dedupedAlignmentWords.map(
				(word) =>
					({
						...word,
						start: word.start + clipOffsetS,
						end: word.end + clipOffsetS,
						clipId: sourceClip.id
					}) as SegmentationWordTimestamp & { clipId: number }
			);
			const hasReferenceParts = getTranscriptReferenceLogicalParts(sourceClip.text) !== null;
			const sourceWordCount = splitVisibleWords(sourceClip.text).length;
			const inlineWordOffset = Math.max(0, sourceWordCount - clipVisibleWords.length);
			const getWordFlags = (wordIndex: number): TranslationInlineStyleFlags =>
				hasReferenceParts
					? EMPTY_INLINE_STYLE_FLAGS
					: getInlineStyleFlagsForWordIndex(
							sourceClip.arabicInlineStyleRuns,
							inlineWordOffset + wordIndex
						);

			const overlapCount = countWordOverlap(visibleWordTexts, clipVisibleWords);
			const clampedOverlapCount = Math.min(overlapCount, timingCandidates.length);
			for (let index = 0; index < clampedOverlapCount; index += 1) {
				const wordEntry = words[words.length - clampedOverlapCount + index];
				if (!wordEntry) continue;
				wordEntry.timings.push(timingCandidates[index]);
				wordEntry.flags = mergeInlineStyleFlags(wordEntry.flags, getWordFlags(index));
			}

			let clipWordIndex = 0;
			let remainingOverlap = clampedOverlapCount;
			for (const definition of groupDefinitions) {
				const skippedWords = Math.min(remainingOverlap, definition.wordTexts.length);
				clipWordIndex += skippedWords;
				remainingOverlap -= skippedWords;
				const groupWords: ArabicWordByWordEntry[] = [];
				const startWordIndex = words.length;

				for (
					let localIndex = skippedWords;
					localIndex < definition.wordTexts.length;
					localIndex += 1
				) {
					const timing = timingCandidates[clipWordIndex];
					if (!timing) return null;
					const wordEntry: ArabicWordByWordEntry = {
						text: definition.wordTexts[localIndex],
						timings: [timing],
						flags: getWordFlags(clipWordIndex)
					};
					words.push(wordEntry);
					groupWords.push(wordEntry);
					clipWordIndex += 1;
				}

				if (groupWords.length > 0) {
					groups.push({
						words: groupWords,
						startWordIndex,
						suffix: definition.suffix,
						suffixFontFamily: definition.suffixFontFamily,
						extraCss: definition.extraCss,
						baseColor: definition.baseColor,
						referenceType: definition.referenceType,
						quranReference: definition.quranReference,
						sourceClipId: definition.sourceClipId
					});
				}
			}
			if (clipWordIndex !== timingCandidates.length) return null;
			visibleWordTexts = words.map((word) => word.text);
		}

		if (groups.length === 0 || words.length === 0) return null;
		return { words, groups, clipStartTimeS };
	}

	/** État du highlight WBW courant. */
	let currentArabicWordByWordState = $derived(() => {
		const subtitle = currentSubtitle();
		const clip = subtitle instanceof SubtitleClip ? subtitle : null;
		const arabicStyles = globalState.getVideoStyle.getStylesOfTarget('arabic');
		const renderData = buildArabicWordByWordRenderData();
		const styleReferenceClip = getArabicReferenceClip();
		const currentClipId = clip?.id ?? null;

		return computeWordByWordHighlightState({
			subtitle: clip,
			isArabicMerged: isArabicMerged(),
			mushafStyle: String(globalState.getStyle('arabic', 'mushaf-style')?.value ?? 'Uthmani'),
			cursorTimeS: getTimelineSettings().cursorPosition / 1000,
			// Si un groupe fusionné est actif, et que un subtitle dans ce groupe ne possède
			// pas de timing wbw, alors on enlève le rendu WBW pour tous les mots
			words:
				renderData?.words
					.map(
						(word) =>
							selectWordTimingForCurrentClip(
								word.timings,
								getTimelineSettings().cursorPosition / 1000,
								currentClipId
							) ?? word.timings[0]
					)
					.filter((word): word is SegmentationWordTimestamp => word !== null) ?? [],
			clipStartTimeS: renderData?.clipStartTimeS,
			baseOpacity: subtitleOpacity,
			getStyleValue: (styleId) =>
				styleReferenceClip
					? arabicStyles.getEffectiveValue(styleId as never, styleReferenceClip.id)
					: false
		});
	});

	/** Groupes de mots visibles quand le WBW est actif. */
	let currentArabicPreviewGroups = $derived(() => {
		const renderData = buildArabicWordByWordRenderData();
		if (!renderData || !currentArabicWordByWordState().enabled) return [];
		const state = currentArabicWordByWordState();
		if (!state.showCurrentWordOnly) return renderData.groups;
		if (state.activeWordIndex < 0 || state.activeWordIndex >= renderData.words.length) return [];

		return renderData.groups.flatMap((group) => {
			const localIndex = state.activeWordIndex - group.startWordIndex;
			const word = group.words[localIndex];
			if (!word) return [];

			return [
				{
					...group,
					words: [word],
					startWordIndex: state.activeWordIndex,
					suffix: localIndex === group.words.length - 1 ? group.suffix : ''
				}
			];
		});
	});

	// =========================================================================
	// Style inline (gras, italique, souligné, couleur) pour les segments
	// =========================================================================

	/**
	 * Fusionne le CSS WBW avec le CSS inline d'un mot, en laissant l'inline prioritaire.
	 * @param {number} wordIndex Index du mot dans le flux WBW courant.
	 * @param {WordByWordHighlightState} state État WBW courant.
	 * @param {number} highlightProgress Progression du highlight.
	 * @param {TranslationInlineStyleFlags} flags Flags inline du mot.
	 * @param {string | null} baseColor Couleur de base propre au groupe de référence.
	 * @returns {string} CSS inline final.
	 */
	function getCombinedWordByWordCss(
		wordIndex: number,
		state: WordByWordHighlightState,
		highlightProgress: number,
		flags: TranslationInlineStyleFlags,
		baseColor: string | null
	): string {
		const wbwCss = buildWordByWordWordCss(
			wordIndex,
			state,
			highlightProgress,
			wbwPreviewFadeDuration(),
			baseColor || undefined
		);
		const inlineCss = getRevealedInlineStyleCss(wordIndex, state, highlightProgress, flags);
		return `${wbwCss} ${inlineCss}`.trim();
	}

	/**
	 * Retourne la progression de révélation du style inline d'un mot.
	 *
	 * @param {number} wordIndex Index du mot dans le flux WBW courant.
	 * @param {WordByWordHighlightState} state État WBW courant.
	 * @param {number} highlightProgress Progression WBW du mot courant.
	 * @returns {number} Progression normalisée entre 0 et 1.
	 */
	function getInlineStyleRevealProgress(
		wordIndex: number,
		state: WordByWordHighlightState,
		highlightProgress: number
	): number {
		if (!state.revealSpecificWordStyle) return 1;
		if (state.activeWordIndex >= state.words.length || wordIndex < state.activeWordIndex) return 1;
		if (wordIndex > state.activeWordIndex) return 0;
		return highlightProgress;
	}

	/**
	 * Retourne le CSS inline visible, avec fondu pour la couleur custom.
	 *
	 * @param {number} wordIndex Index du mot dans le flux WBW courant.
	 * @param {WordByWordHighlightState} state État WBW courant.
	 * @param {number} highlightProgress Progression WBW du mot courant.
	 * @param {TranslationInlineStyleFlags} flags Flags inline persistés.
	 * @returns {string} CSS inline visible à cet instant.
	 */
	function getRevealedInlineStyleCss(
		wordIndex: number,
		state: WordByWordHighlightState,
		highlightProgress: number,
		flags: TranslationInlineStyleFlags
	): string {
		const revealProgress = getInlineStyleRevealProgress(wordIndex, state, highlightProgress);
		if (revealProgress <= 0) return getInlineStyleCss(EMPTY_INLINE_STYLE_FLAGS);
		if (!state.revealSpecificWordStyle || revealProgress >= 1 || !flags.color) {
			return getInlineStyleCss(flags);
		}

		return `${getInlineStyleCss({ ...flags, color: null })} color: ${interpolateCssColor(
			state.baseColor,
			flags.color,
			revealProgress
		)};`.trim();
	}

	// =========================================================================
	// Props dérivées pour le template
	// =========================================================================

	let arabicReferenceClip = $derived(() => getArabicReferenceClip());

	let arabicSegments = $derived(() => {
		const _ = referenceRenderVersion;
		return getVisibleArabicSegments();
	});

	let wbwState = $derived(() => currentArabicWordByWordState());

	let bracketGlyphs = $derived(() => getBracketGlyphs());

	let isArabicSubtitleVisible = $derived(() => {
		const referenceClip = arabicReferenceClip();
		const styles = globalState.getVideoStyle.getStylesOfTarget('arabic');
		return Boolean(styles.getEffectiveValue('show-subtitles', referenceClip?.id));
	});

	let shouldForceRtlJustify = $derived(() => {
		const subtitle = currentSubtitle();
		if (!(subtitle instanceof SubtitleClip)) return false;

		const referenceClip = arabicReferenceClip();
		const styles = globalState.getVideoStyle.getStylesOfTarget('arabic');
		return (
			String(styles.getEffectiveValue('horizontal-text-alignment', referenceClip?.id)) === 'justify'
		);
	});

	/** CSS de capture qui garde le `display: block` attendu par modern-screenshot. */
	let exportCaptureLayoutCss = $derived(() => {
		if (!isArabicSubtitleVisible()) return '';

		const referenceClip = arabicReferenceClip();
		const styles = globalState.getVideoStyle.getStylesOfTarget('arabic');
		const verticalAlignment = String(
			styles.getEffectiveValue('vertical-text-alignment', referenceClip?.id)
		);

		return getExportCaptureLayoutCss(verticalAlignment);
	});

	/** Padding horizontal pour le fond du sous-titre arabe. */
	let backgroundHorizontalPaddingCss = $derived(() => {
		const referenceClip = arabicReferenceClip();
		const styles = globalState.getVideoStyle.getStylesOfTarget('arabic');
		const isBackgroundEnabled = Boolean(
			styles.getEffectiveValue('background-enable', referenceClip?.id)
		);
		const padding = Number(
			styles.getEffectiveValue('background-horizontal-padding', referenceClip?.id)
		);
		return getBackgroundHorizontalPaddingCss(isBackgroundEnabled, padding);
	});
</script>

{#if currentSubtitle()}
	<!-- Le display: block est appliqué partout pour garder la preview normale alignée avec la preview d'export. Sans cela, modern-screenshot peut décaler le dernier mot/numéro de verset. -->
	<p
		ondblclick={() => {
			globalState.getVideoStyle.highlightCategory('arabic', 'general');
			const subtitle = currentSubtitle();
			if (subtitle) globalState.openQuickTimelineEditor(subtitle.id, 'subtitle');
		}}
		use:mouseDrag={{
			target: 'arabic',
			verticalStyleId: 'vertical-position',
			horizontalStyleId: 'horizontal-position'
		}}
		dir={shouldForceRtlJustify() ? 'rtl' : undefined}
		class={'arabic absolute subtitle select-none z-10 ' + tailwind + helperStyles}
		style="opacity: {wbwState().enabled
			? 1
			: subtitleOpacity}; {css}; {runtimeLayoutCss}; {backgroundHorizontalPaddingCss} white-space: pre-line; {exportCaptureLayoutCss()}"
	>
		{#if currentSubtitle() instanceof SubtitleClip || currentSubtitle() instanceof PredefinedSubtitleClip}
			{@const subtitle = currentSubtitle()}
			{@const segments = arabicSegments()}
			{@const groups = currentArabicPreviewGroups()}
			{@const state = wbwState()}

			{#if state.enabled && subtitle instanceof SubtitleClip}
				<!-- Rendu WBW -->
				<span class="arabic-wbw-flow line-background" dir="rtl" style="unicode-bidi: isolate;">
					{#each groups as group, groupIndex (`${subtitle.id}-wbw-group-${group.startWordIndex}-${groupIndex}`)}
						<span
							class="arabic-wbw-group"
							dir="rtl"
							style="unicode-bidi: isolate; {group.extraCss}"
						>
							{#if group.referenceType === 'quran' && showDecorativeBrackets()}
								{@const glyphs = bracketGlyphs()}
								{@const bracketStyle = `${group.extraCss} ${getDecorativeBracketCss()}`.trim()}
								{#if !isQuranReferenceContinued(group, -1)}
									<span style={bracketStyle}>{glyphs.closing}</span>
								{/if}
							{/if}
							{#each group.words as wordEntry, i (`${subtitle.id}-wbw-preview-${group.startWordIndex + i}-${wordEntry.text}`)}
								{@const wordIndex = group.startWordIndex + i}
								{@const highlightProgress = computeWordByWordHighlightProgress(
									wordIndex,
									state,
									wbwPreviewFadeDuration()
								)}
								<span
									style={getCombinedWordByWordCss(
										wordIndex,
										state,
										highlightProgress,
										wordEntry.flags,
										group.baseColor
									)}
								>
									{wordEntry.text}{i < group.words.length - 1 && !wordEntry.flags.lineBreak
										? ' '
										: ''}
								</span>
								{#if wordEntry.flags.lineBreak}
									<br />
								{/if}
							{/each}
							{#if group.suffix}
								{@const suffixOpacity = state.alwaysShowVerseNumber
									? 1
									: getWordByWordWordOpacity(
											group.startWordIndex + group.words.length - 1,
											state,
											wbwPreviewFadeDuration(),
											false
										)}
								{@const lastWordIndex = group.startWordIndex + group.words.length - 1}
								{@const lastWordProgress = computeWordByWordHighlightProgress(
									lastWordIndex,
									state,
									wbwPreviewFadeDuration()
								)}
								{@const lastWordWbwCss = buildWordByWordWordCss(
									lastWordIndex,
									state,
									lastWordProgress,
									wbwPreviewFadeDuration(),
									state.verseNumberColor
								)}
								<span
									style={(group.suffixFontFamily
										? `font-family: ${group.suffixFontFamily}; `
										: '') +
										`color: var(--verse-number-color); ` +
										lastWordWbwCss +
										` opacity: ${suffixOpacity};`}
								>
									{group.suffix}
								</span>
							{/if}
							{#if group.referenceType === 'quran' && showDecorativeBrackets()}
								{@const glyphs = bracketGlyphs()}
								{@const bracketStyle = `${group.extraCss} ${getDecorativeBracketCss()}`.trim()}
								{#if !isQuranReferenceContinued(group, 1)}
									<span style={bracketStyle}>{glyphs.opening}</span>
								{/if}
							{/if}
						</span>
						{#if groupIndex < groups.length - 1}&nbsp;{/if}
					{/each}
				</span>
			{:else}
				<!-- Fallback standard : rendu arabe sans WBW -->
				{@render overlaySegmentsContent(segments)}
			{/if}
		{/if}
	</p>
{/if}

{#snippet overlaySegmentsContent(segments: OverlayTextSegment[])}
	{@const hasQuranReference = segments.some((segment) => segment.referenceType === 'quran')}
	{@const hasRtlText = segments.some((segment) => /[\u0590-\u08FF]/u.test(segment.text))}
	<span
		class="translation-inline-flow line-background"
		dir={hasQuranReference || hasRtlText ? 'rtl' : undefined}
		style={hasRtlText ? 'unicode-bidi: plaintext;' : undefined}
	>
		{#each segments as segment (segment.key)}
			{@const segmentStyle = `${getInlineStyleCss(segment.flags)} ${segment.extraCss ?? ''}`.trim()}
			{#if segment.referenceType === 'quran' && showDecorativeBrackets()}
				{@const glyphs = bracketGlyphs()}
				{@const bracketCss = getDecorativeBracketCss()}
				{@const bracketStyle = `${segmentStyle} ${bracketCss}`.trim()}
				{@const continuesPrevious = isQuranReferenceContinued(segment, -1)}
				{@const continuesNext = isQuranReferenceContinued(segment, 1)}
				<span dir="rtl" style="unicode-bidi: isolate;">
					{#if !continuesPrevious}<span style={bracketStyle}>{glyphs.closing}</span>{/if}
					<span style={segmentStyle}>{segment.text}</span>
					{#if !continuesNext}<span style={bracketStyle}>{glyphs.opening}</span>{/if}
				</span>
			{:else if segment.referenceType === 'citation'}
				<span dir="rtl" style={`unicode-bidi: isolate; ${segmentStyle}`}>{segment.text}</span>
			{:else if segmentStyle}
				<span style={segmentStyle}>{segment.text}</span>
			{:else}
				{segment.text}
			{/if}
			{#if segment.flags.lineBreak}
				<br />
			{/if}
		{/each}
	</span>
{/snippet}
