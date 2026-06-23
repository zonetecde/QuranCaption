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
	import QPCFontProvider from '$lib/services/FontProvider';
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
		return Boolean(globalState.getStyle('arabic', 'show-decorative-brackets').value);
	});

	/** Paire de glyphes brute pour les crochets décoratifs. */
	let decorativeBracketsGlyphPair = $derived(() => {
		return String(globalState.getStyle('arabic', 'decorative-brackets-font-family').value || 'LM');
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
	 * Retourne le CSS `font-family` propre au verset du clip lorsque le mushaf
	 * QPC1, QPC2 ou Tajweed est actif. Chaque page du mushaf a sa propre police,
	 * donc chaque clip doit forcer la sienne via un span lors d'un merge visuel.
	 *
	 * @param subtitle - Clip Quran dont on veut la police de page.
	 * @returns Chaîne CSS `font-family: ...;` ou chaîne vide.
	 */
	function getSubtitleQpcFontCss(subtitle: SubtitleClip): string {
		const mushafStyle = String(globalState.getStyle('arabic', 'mushaf-style')?.value ?? '');
		const fontFamily = globalState.getStyle('arabic', 'font-family');

		if (mushafStyle === 'Tajweed') {
			const tajweedFont = QPCFontProvider.getTajweedFontNameForVerse(
				subtitle.surah,
				subtitle.verse
			);
			const qpc2Fallback = QPCFontProvider.getFontNameForVerse(subtitle.surah, subtitle.verse, '2');
			return `font-family: ${tajweedFont}, ${qpc2Fallback};`;
		}

		if (fontFamily?.value === 'QPC1') {
			const font = QPCFontProvider.getFontNameForVerse(subtitle.surah, subtitle.verse, '1');
			return `font-family: ${font};`;
		}

		if (fontFamily?.value === 'QPC2') {
			const font = QPCFontProvider.getFontNameForVerse(subtitle.surah, subtitle.verse, '2');
			return `font-family: ${font};`;
		}

		return '';
	}

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

		const displayParts = subtitle.getArabicRenderParts('preview');
		const perClipFontCss = subtitle instanceof SubtitleClip ? getSubtitleQpcFontCss(subtitle) : '';
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

	/** Structure de données pour le rendu WBW arabe. */
	type ArabicWordByWordRenderData = {
		words: Array<{
			text: string;
			timings: SegmentationWordTimestamp[];
			flags: TranslationInlineStyleFlags;
		}>;
		groups: Array<{
			words: Array<{
				text: string;
				timings: SegmentationWordTimestamp[];
				flags: TranslationInlineStyleFlags;
			}>;
			startWordIndex: number;
			suffix: string;
			suffixFontFamily: string | null;
			extraCss: string;
		}>;
		clipStartTimeS: number;
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

		// Vérifie si le rendu WBW est possible
		if (mergedGroup && isArabicMerged() && !shouldUseMergedSource) return null;
		if (!shouldUseMergedSource && (subtitle.alignmentMetadata?.words.length ?? 0) === 0) {
			return null;
		}

		const clipStartTimeS = shouldUseMergedSource
			? mergedGroup!.startTime / 1000
			: (subtitle.alignmentMetadata?.timeFrom ?? 0);

		const words: ArabicWordByWordRenderData['words'] = [];
		const groups: ArabicWordByWordRenderData['groups'] = [];
		let totalWordCount = 0;
		let visibleWordTexts: string[] = [];

		for (const sourceClip of sourceClips) {
			const displayParts = sourceClip.getArabicRenderParts('preview');
			const visibleWords = displayParts.text.split(/\s+/).filter(Boolean);
			const alignmentWords = sourceClip.alignmentMetadata?.words ?? [];
			const visibleWordCount = Math.min(visibleWords.length, alignmentWords.length);
			const visibleAlignmentWords =
				visibleWordCount > 0
					? alignmentWords.slice(alignmentWords.length - visibleWordCount)
					: alignmentWords.slice();
			const clipOffsetS = shouldUseMergedSource
				? (sourceClip.startTime - mergedGroup!.startTime) / 1000
				: 0;
			const sourceWordCount = sourceClip.text.split(/\s+/).filter(Boolean).length;
			const inlineWordOffset = Math.max(0, sourceWordCount - visibleWords.length);

			if (visibleWords.length === 0) {
				continue;
			}

			// Ajuste les timings avec l'offset du clip dans le groupe
			const timingCandidates = visibleAlignmentWords.map(
				(word) =>
					({
						...word,
						start: word.start + clipOffsetS,
						end: word.end + clipOffsetS,
						clipId: sourceClip.id
					}) as SegmentationWordTimestamp & { clipId: number }
			);

			const overlapCount = countWordOverlap(visibleWordTexts, visibleWords);
			const clampedOverlapCount = Math.min(overlapCount, timingCandidates.length);

			// Ajoute les timings aux mots qui se chevauchent
			for (let i = 0; i < clampedOverlapCount; i++) {
				const wordEntry = words[words.length - clampedOverlapCount + i];
				if (!wordEntry) continue;
				wordEntry.timings.push(timingCandidates[i]);
				wordEntry.flags = mergeInlineStyleFlags(
					wordEntry.flags,
					getInlineStyleFlagsForWordIndex(sourceClip.arabicInlineStyleRuns, inlineWordOffset + i)
				);
			}

			const groupWords: ArabicWordByWordRenderData['groups'][number]['words'] = [];
			for (let i = clampedOverlapCount; i < visibleWords.length; i++) {
				const wordEntry = {
					text: visibleWords[i],
					timings: [timingCandidates[i]],
					flags: getInlineStyleFlagsForWordIndex(
						sourceClip.arabicInlineStyleRuns,
						inlineWordOffset + i
					)
				};
				words.push(wordEntry);
				groupWords.push(wordEntry);
			}

			const group = {
				words: groupWords,
				startWordIndex: totalWordCount,
				suffix: displayParts.suffix,
				suffixFontFamily: displayParts.suffixFontFamily,
				extraCss: getSubtitleQpcFontCss(sourceClip)
			};

			groups.push(group);
			totalWordCount += groupWords.length;
			visibleWordTexts = words.map((word) => word.text);
		}

		if (groups.length === 0) return null;

		return {
			words,
			groups,
			clipStartTimeS
		};
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
	 * @returns {string} CSS inline final.
	 */
	function getCombinedWordByWordCss(
		wordIndex: number,
		state: WordByWordHighlightState,
		highlightProgress: number,
		flags: TranslationInlineStyleFlags
	): string {
		const wbwCss = buildWordByWordWordCss(
			wordIndex,
			state,
			highlightProgress,
			wbwPreviewFadeDuration()
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

	let arabicSegments = $derived(() => getVisibleArabicSegments());

	let wbwState = $derived(() => currentArabicWordByWordState());

	let bracketGlyphs = $derived(() => getBracketGlyphs());

	let isArabicSubtitleVisible = $derived(() => {
		const referenceClip = arabicReferenceClip();
		const styles = globalState.getVideoStyle.getStylesOfTarget('arabic');
		return Boolean(styles.getEffectiveValue('show-subtitles', referenceClip?.id));
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
		class={'arabic absolute subtitle select-none z-10 ' + tailwind + helperStyles}
		style="opacity: {subtitleOpacity}; {css}; {runtimeLayoutCss}; {backgroundHorizontalPaddingCss} white-space: pre-line; {exportCaptureLayoutCss()}"
	>
		{#if currentSubtitle() instanceof SubtitleClip || currentSubtitle() instanceof PredefinedSubtitleClip}
			{@const subtitle = currentSubtitle()}
			{@const segments = arabicSegments()}
			{@const groups = currentArabicPreviewGroups()}
			{@const state = wbwState()}
			{@const glyphs = bracketGlyphs()}
			{@const showBrackets = showDecorativeBrackets()}

			{#if showBrackets && ((state.enabled && groups.length > 0) || segments.some((segment) => segment.text.trim().length > 0))}
				{@const bracketCss = getDecorativeBracketCss()}
				<span style={bracketCss}>{glyphs.opening}</span>

				{#if state.enabled && subtitle instanceof SubtitleClip}
					<!-- Rendu WBW avec crochets décoratifs -->
					<span class="arabic-wbw-flow" dir="rtl" style="unicode-bidi: isolate;">
						{#each groups as group, groupIndex (`${subtitle.id}-wbw-group-${group.startWordIndex}-${groupIndex}`)}
							<span
								class="arabic-wbw-group"
								dir="rtl"
								style="unicode-bidi: isolate; {group.extraCss}"
							>
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
											wordEntry.flags
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
												wbwPreviewFadeDuration()
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
							</span>
							{#if groupIndex < groups.length - 1}
								{' '}
							{/if}
						{/each}
					</span>
				{:else}
					<!-- Rendu standard avec crochets décoratifs -->
					{@render overlaySegmentsContent(segments)}
				{/if}

				<span style={bracketCss}>{glyphs.closing}</span>
			{:else if state.enabled && subtitle instanceof SubtitleClip}
				<!-- Rendu WBW sans crochets décoratifs -->
				<span class="arabic-wbw-flow" dir="rtl" style="unicode-bidi: isolate;">
					{#each groups as group, groupIndex (`${subtitle.id}-wbw-group-${group.startWordIndex}-${groupIndex}`)}
						<span
							class="arabic-wbw-group"
							dir="rtl"
							style="unicode-bidi: isolate; {group.extraCss}"
						>
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
										wordEntry.flags
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
											wbwPreviewFadeDuration()
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
						</span>
						{#if groupIndex < groups.length - 1}
							{' '}
						{/if}
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
	<span class="translation-inline-flow">
		{#each segments as segment (segment.key)}
			{@const segmentStyle = `${getInlineStyleCss(segment.flags)} ${segment.extraCss ?? ''}`.trim()}
			{#if segmentStyle}
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
