<script lang="ts">
	import { PredefinedSubtitleClip, SubtitleClip } from '$lib/classes';
	import {
		EMPTY_INLINE_STYLE_FLAGS,
		getInlineStyleCss,
		getInlineStyleFlagsForWordIndex,
		type TranslationInlineStyleFlags,
		tokenizeTranslationText,
		VerseTranslation
	} from '$lib/classes/Translation.svelte';
	import type { StyleCategoryName } from '$lib/classes/VideoStyle.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { mouseDrag } from '$lib/services/verticalDrag';
	import { untrack } from 'svelte';
	import {
		createPlainOverlaySegment,
		getMergedClipsWithoutWordOverlap,
		getVisibleTranslationSegments as getVisibleTranslationSegmentsUtil,
		hasSharedMergedTranslation,
		isVisualMergeTargetMerged,
		type OverlayTextSegment
	} from './visualMergeOverlayUtils';
	import { getBackgroundHorizontalPaddingCss } from './helpers/overlayCss';
	import type { SegmentationWordTimestamp } from '$lib/services/AutoSegmentation';
	import {
		type WordByWordHighlightState,
		getWordByWordHighlightProgress,
		getWordByWordHighlightState,
		getWordByWordWordCss,
		interpolateCssColor
	} from './wordByWordHighlightUtils';

	/**
	 * Propriétés reçues du composant parent VideoOverlay.
	 * Une instance de ce composant est créée pour chaque édition
	 * de traduction visible.
	 */
	interface TranslationSubtitleProps {
		/** Nom de l'édition de traduction (ex: "fr-hamidullah"). */
		edition: string;
		/** Opacité calculée de cette traduction au temps courant. */
		subtitleOpacity: number;
		/** CSS complet généré pour cette édition (hors background/border). */
		css: string;
		/** CSS runtime calculé par la preview (font-size et offset non persistés). */
		runtimeLayoutCss: string;
		/** Classes Tailwind générées pour cette édition. */
		tailwind: string;
		/** Classes CSS d'aide visuelle (ex: surbrillance de la zone éditée). */
		helperStyles: string;
		isExportCapturePreview: boolean;
	}

	let {
		edition,
		subtitleOpacity,
		css,
		runtimeLayoutCss,
		tailwind,
		helperStyles,
		isExportCapturePreview
	}: TranslationSubtitleProps = $props();

	type TranslationWbwOverlaySegment = OverlayTextSegment & {
		wbwWordIndex?: number;
		wbwWordIndexes?: number[];
		unitIndex?: number;
	};

	type TranslationWbwRenderData = {
		segments: TranslationWbwOverlaySegment[];
		words: SegmentationWordTimestamp[];
		clipStartTimeS: number;
		maxRevealedUnitIndexByWordIndex: number[];
	};

	let cachedWbwRenderDataKey = '';
	let cachedWbwRenderData: TranslationWbwRenderData | null = null;

	// =========================================================================
	// Dérivations depuis globalState
	// =========================================================================

	/** Sous-titre courant. */
	let currentSubtitle = $derived(() => {
		const _ = getTimelineSettings().cursorPosition;
		const _refresh = getTimelineSettings().previewRefreshToken;
		return untrack(() => {
			return globalState.getSubtitleTrack.getCurrentSubtitleToDisplay();
		});
	});

	/** Groupe de fusion visuelle actif. */
	let currentVisualMergeGroup = $derived(() => {
		const subtitle = currentSubtitle();
		if (!(subtitle instanceof SubtitleClip)) return null;
		return globalState.getSubtitleTrack.getVisualMergeGroupForClipId(subtitle.id);
	});

	let getTimelineSettings = $derived(() => {
		return globalState.currentProject!.projectEditorState.timeline;
	});

	let fadeDuration = $derived(() => {
		return globalState.getStyle('global', 'fade-duration').value as number;
	});

	let wbwPreviewFadeDuration = $derived(() => {
		return isExportCapturePreview ? 0 : fadeDuration();
	});

	// =========================================================================
	// Fonctions de rendu
	// =========================================================================

	/**
	 * Indique si la cible (cette édition) est actuellement fusionnée visuellement.
	 */
	function isEditionMerged(): boolean {
		return isVisualMergeTargetMerged(currentVisualMergeGroup(), edition);
	}

	/**
	 * Retourne le clip de référence pour les styles de cette édition.
	 */
	function getTranslationReferenceClip(): SubtitleClip | PredefinedSubtitleClip | null {
		const subtitle = currentSubtitle();
		if (!(subtitle instanceof SubtitleClip || subtitle instanceof PredefinedSubtitleClip))
			return null;
		if (isEditionMerged()) {
			return currentVisualMergeGroup()?.firstClip ?? null;
		}
		return subtitle;
	}

	/**
	 * Génère les segments d'overlay pour une édition de traduction
	 * appliquée à un clip donné.
	 *
	 * Gère deux types de traduction :
	 * 1. VerseTranslation : supporte les styles inline et les préfixes/suffixes.
	 * 2. Traduction simple : un seul segment texte.
	 *
	 * @param editionName - Nom de l'édition de traduction.
	 * @param subtitle - Clip portant la traduction.
	 * @returns Segments de texte à afficher.
	 */
	function getTranslationOverlaySegments(
		editionName: string,
		subtitle: SubtitleClip
	): OverlayTextSegment[] {
		const translation = subtitle.translations[editionName];
		if (!translation) return [];

		if (translation.type === 'verse') {
			const verseTranslation = translation as VerseTranslation;
			const textParts = verseTranslation.getFormattedTextParts(editionName, subtitle);
			const segments: OverlayTextSegment[] = [];

			// Préfixe éventuel (ex: numéro de verset avant la traduction)
			if (textParts.prefix) {
				segments.push(
					createPlainOverlaySegment(
						`${editionName}-${subtitle.id}-prefix`,
						textParts.prefix,
						'color: var(--verse-number-color);'
					)
				);
			}

			// Segments avec styles inline
			segments.push(
				...verseTranslation.getInlineStyledSegments().map((segment, index) => ({
					key: `${editionName}-${subtitle.id}-${index}`,
					text: segment.text,
					flags: segment
				}))
			);

			// Suffixe éventuel
			if (textParts.suffix) {
				segments.push(
					createPlainOverlaySegment(
						`${editionName}-${subtitle.id}-suffix`,
						textParts.suffix,
						'color: var(--verse-number-color);'
					)
				);
			}

			return segments;
		}

		// Traduction simple
		return [createPlainOverlaySegment(`${editionName}-${subtitle.id}`, translation.getText())];
	}

	/**
	 * Retourne les segments de traduction visibles pour cette édition,
	 * en tenant compte de la fusion visuelle.
	 */
	/**
	 * Construit les segments WBW d'une traduction pour un clip.
	 *
	 * @param {string} editionName Nom de l'édition.
	 * @param {SubtitleClip} subtitle Clip source.
	 * @param {number} wordOffset Décalage dans la liste globale de timings.
	 * @param {number} timingOffsetS Décalage temporel du clip dans un groupe fusionné.
	 * @returns {TranslationWbwRenderData | null} Données de rendu, ou `null` sans mapping.
	 */
	function getTranslationWbwRenderDataForClip(
		editionName: string,
		subtitle: SubtitleClip,
		wordOffset: number = 0,
		timingOffsetS: number = 0
	): TranslationWbwRenderData | null {
		const translation = subtitle.translations[editionName];
		if (!(translation instanceof VerseTranslation)) return null;

		const arabicWordCount = subtitle.getArabicRenderParts().text.split(' ').filter(Boolean).length;
		const normalizedRanges = translation.getNormalizedWbwRanges(arabicWordCount);
		if (normalizedRanges.length === 0 || (subtitle.alignmentMetadata?.words.length ?? 0) === 0) {
			return null;
		}

		const textParts = translation.getFormattedTextParts(editionName, subtitle);
		const tokens = tokenizeTranslationText(textParts.text);
		const rangesByUnit = new Map<number, number[]>();
		for (const range of normalizedRanges) {
			for (let index = range.startUnitIndex; index <= range.endUnitIndex; index++) {
				const unitRanges = rangesByUnit.get(index) ?? [];
				unitRanges.push(range.arabicWordIndex);
				rangesByUnit.set(index, unitRanges);
			}
		}

		const segments: TranslationWbwOverlaySegment[] = [];
		const words: SegmentationWordTimestamp[] = [];
		const wbwIndexByArabicWord = new Map<number, number>();
		const maxRevealedUnitIndexByWordIndex: number[] = [];

		const sortedRanges = [...normalizedRanges].sort(
			(a, b) => a.arabicWordIndex - b.arabicWordIndex
		);
		const uniqueArabicWordIndexes = Array.from(
			new Set(sortedRanges.map((range) => range.arabicWordIndex))
		);
		let rangeCursor = 0;
		let maxRevealedUnitIndex = -1;
		for (const arabicWordIndex of uniqueArabicWordIndexes) {
			const timing = subtitle.alignmentMetadata?.words[arabicWordIndex] ?? null;
			if (!timing) continue;

			while (
				rangeCursor < sortedRanges.length &&
				sortedRanges[rangeCursor].arabicWordIndex <= arabicWordIndex
			) {
				maxRevealedUnitIndex = Math.max(
					maxRevealedUnitIndex,
					sortedRanges[rangeCursor].endUnitIndex
				);
				rangeCursor++;
			}

			const wbwWordIndex = wordOffset + words.length;
			wbwIndexByArabicWord.set(arabicWordIndex, wbwWordIndex);
			words.push({
				...timing,
				start: timing.start + timingOffsetS,
				end: timing.end + timingOffsetS
			});
			maxRevealedUnitIndexByWordIndex.push(maxRevealedUnitIndex);
		}

		if (textParts.prefix) {
			segments.push(
				createPlainOverlaySegment(
					`${editionName}-${subtitle.id}-prefix`,
					textParts.prefix,
					'color: var(--verse-number-color);'
				)
			);
		}

		let previousWordFlags: TranslationInlineStyleFlags | null = null;
		for (let index = 0; index < tokens.length; index++) {
			const token = tokens[index];
			if (!token.isWord && previousWordFlags?.lineBreak && /^\s+$/.test(token.text)) continue;
			const flags =
				token.isWord && token.wordIndex !== null
					? getInlineStyleFlagsForWordIndex(translation.inlineStyleRuns ?? [], token.wordIndex)
					: {
							bold: false,
							italic: false,
							underline: false,
							color: null
						};

			const segment: TranslationWbwOverlaySegment = {
				key: `${editionName}-${subtitle.id}-wbw-${index}`,
				text: token.text,
				flags
			};

			if (token.isWord && token.wordIndex !== null) {
				previousWordFlags = flags;
				const arabicWordIndexes = rangesByUnit.get(token.wordIndex) ?? [];
				segment.unitIndex = token.wordIndex;
				for (const arabicWordIndex of arabicWordIndexes) {
					const wbwWordIndex = wbwIndexByArabicWord.get(arabicWordIndex);
					if (wbwWordIndex === undefined) continue;
					if (!segment.wbwWordIndexes) segment.wbwWordIndexes = [];
					segment.wbwWordIndexes.push(wbwWordIndex);
					segment.wbwWordIndex = segment.wbwWordIndexes[0];
				}
			}

			segments.push(segment);
		}

		if (textParts.suffix) {
			segments.push(
				createPlainOverlaySegment(
					`${editionName}-${subtitle.id}-suffix`,
					textParts.suffix,
					'color: var(--verse-number-color);'
				)
			);
		}

		return {
			segments,
			words,
			clipStartTimeS: subtitle.alignmentMetadata?.timeFrom ?? subtitle.startTime / 1000,
			maxRevealedUnitIndexByWordIndex
		};
	}

	/**
	 * Retourne les données WBW visibles pour la traduction courante.
	 *
	 * @returns {TranslationWbwRenderData | null} Données de rendu visibles.
	 */
	function getVisibleTranslationWbwRenderData(): TranslationWbwRenderData | null {
		const subtitle = currentSubtitle();
		if (!(subtitle instanceof SubtitleClip)) return null;

		const cacheKey = getVisibleTranslationWbwRenderDataCacheKey(subtitle);
		if (cacheKey === cachedWbwRenderDataKey) return cachedWbwRenderData;

		cachedWbwRenderDataKey = cacheKey;
		if (!isEditionMerged()) {
			cachedWbwRenderData = getTranslationWbwRenderDataForClip(edition, subtitle);
			return cachedWbwRenderData;
		}

		const group = currentVisualMergeGroup();
		if (!group) {
			cachedWbwRenderData = null;
			return cachedWbwRenderData;
		}
		if (hasSharedMergedTranslation(group.clips, edition)) {
			cachedWbwRenderData = null;
			return cachedWbwRenderData;
		}

		const segments: TranslationWbwOverlaySegment[] = [];
		const words: SegmentationWordTimestamp[] = [];
		const maxRevealedUnitIndexByWordIndex: number[] = [];
		const sourceClips = getMergedClipsWithoutWordOverlap(group.clips);
		let clipStartTimeS = group.startTime / 1000;

		for (let index = 0; index < sourceClips.length; index++) {
			const timingOffsetS = (sourceClips[index].startTime - group.startTime) / 1000;
			const data = getTranslationWbwRenderDataForClip(
				edition,
				sourceClips[index],
				words.length,
				timingOffsetS
			);
			if (!data) continue;
			if (segments.length > 0) {
				const previousLastSegment = segments.at(-1);
				const separator = previousLastSegment?.text.endsWith('—') ? '' : ' ';
				if (separator) {
					segments.push(
						createPlainOverlaySegment(`merged-${edition}-wbw-separator-${index}`, separator)
					);
				}
			}
			segments.push(...data.segments);
			words.push(...data.words);
			maxRevealedUnitIndexByWordIndex.push(...data.maxRevealedUnitIndexByWordIndex);
			clipStartTimeS = Math.min(clipStartTimeS, data.clipStartTimeS);
		}

		cachedWbwRenderData =
			words.length > 0
				? { segments, words, clipStartTimeS, maxRevealedUnitIndexByWordIndex }
				: null;
		return cachedWbwRenderData;
	}

	/**
	 * Construit une clé stable pour réutiliser les segments WBW de traduction entre deux frames.
	 *
	 * @param {SubtitleClip} subtitle Sous-titre courant.
	 * @returns {string} Clé représentant le contenu WBW visible.
	 */
	function getVisibleTranslationWbwRenderDataCacheKey(subtitle: SubtitleClip): string {
		const group = currentVisualMergeGroup();
		const clips =
			group && isEditionMerged() ? getMergedClipsWithoutWordOverlap(group.clips) : [subtitle];

		return clips
			.map((clip) => {
				const translation = clip.translations[edition];
				const words = clip.alignmentMetadata?.words ?? [];
				if (!(translation instanceof VerseTranslation)) {
					return `${clip.id}:plain:${words.length}`;
				}

				return [
					clip.id,
					clip.startTime,
					clip.endTime,
					clip.startWordIndex,
					clip.endWordIndex,
					translation.text,
					translation.startWordIndex,
					translation.endWordIndex,
					JSON.stringify(translation.inlineStyleRuns ?? []),
					JSON.stringify(translation.wbwRanges ?? []),
					words.length,
					words[0]?.start ?? '',
					words.at(-1)?.end ?? ''
				].join(':');
			})
			.join('|');
	}

	function getVisibleTranslationSegments(): OverlayTextSegment[] {
		const subtitle = currentSubtitle();
		return getVisibleTranslationSegmentsUtil(
			subtitle instanceof SubtitleClip || subtitle instanceof PredefinedSubtitleClip
				? subtitle
				: null,
			currentVisualMergeGroup(),
			edition,
			getTranslationOverlaySegments
		);
	}

	// =========================================================================
	// Style inline (gras, italique, souligné, couleur)
	// =========================================================================

	/**
	 * Fusionne le CSS WBW avec le CSS inline d'une unité de traduction.
	 *
	 * @param {TranslationWbwOverlaySegment} segment Segment à afficher.
	 * @param {WordByWordHighlightState} state État WBW courant.
	 * @param {TranslationWbwRenderData | null} data Données WBW visibles.
	 * @returns {string} CSS inline final.
	 */
	function getTranslationSegmentCss(
		segment: TranslationWbwOverlaySegment,
		state: WordByWordHighlightState,
		data: TranslationWbwRenderData | null
	): string {
		let wbwCss = '';
		let inlineRevealProgress = 1;
		const wbwWordIndexes = segment.wbwWordIndexes ?? [];
		if (wbwWordIndexes.length > 0 && state.enabled) {
			let bestIndex = wbwWordIndexes[0];
			let bestProgress = 0;
			for (const index of wbwWordIndexes) {
				if (!shouldComputeWordByWordProgress(index, state)) continue;

				const progress = getWordByWordHighlightProgress(index, state, wbwPreviewFadeDuration());
				if (progress > bestProgress || bestProgress === 0) {
					bestIndex = index;
					bestProgress = progress;
				}
			}

			if (
				bestProgress > 0 ||
				state.underlineEnabled ||
				state.revealWordsOnRecitation ||
				state.currentWordCustomCss.trim() ||
				state.currentWordOpacityEnabled
			) {
				wbwCss = getWordByWordWordCss(bestIndex, state, bestProgress, wbwPreviewFadeDuration());
			}
			inlineRevealProgress = getInlineStyleRevealProgress(wbwWordIndexes, bestProgress, state);
		}

		return `${wbwCss} ${getForcedRevealCss(segment, state, data)} ${getRevealedInlineStyleCss(segment, inlineRevealProgress, state)} ${segment.extraCss ?? ''}`.trim();
	}

	/**
	 * Indique si un mot peut avoir une progression WBW non nulle à cette frame.
	 *
	 * @param {number} wordIndex Index WBW à tester.
	 * @param {WordByWordHighlightState} state État WBW courant.
	 * @returns {boolean} `true` si la progression doit être calculée.
	 */
	function shouldComputeWordByWordProgress(
		wordIndex: number,
		state: WordByWordHighlightState
	): boolean {
		if (state.persistColor && wordIndex <= state.activeWordIndex) return true;
		return wordIndex === state.activeWordIndex || wordIndex === state.activeWordIndex - 1;
	}

	/**
	 * Retourne la progression de révélation du style inline d'un segment.
	 *
	 * @param {number[]} wbwWordIndexes Index WBW liés au segment.
	 * @param {number} activeProgress Progression du meilleur mot actif.
	 * @param {WordByWordHighlightState} state État WBW courant.
	 * @returns {number} Progression normalisée entre 0 et 1.
	 */
	function getInlineStyleRevealProgress(
		wbwWordIndexes: number[],
		activeProgress: number,
		state: WordByWordHighlightState
	): number {
		if (!state.revealSpecificWordStyle) return 1;
		if (state.activeWordIndex >= state.words.length) return 1;
		if (wbwWordIndexes.some((wordIndex) => wordIndex < state.activeWordIndex)) return 1;
		if (wbwWordIndexes.some((wordIndex) => wordIndex === state.activeWordIndex)) {
			return activeProgress;
		}
		return 0;
	}

	/**
	 * Retourne le CSS inline visible, avec fondu pour la couleur custom.
	 *
	 * @param {TranslationWbwOverlaySegment} segment Segment à afficher.
	 * @param {number} revealProgress Progression de révélation du style.
	 * @param {WordByWordHighlightState} state État WBW courant.
	 * @returns {string} CSS inline visible à cet instant.
	 */
	function getRevealedInlineStyleCss(
		segment: TranslationWbwOverlaySegment,
		revealProgress: number,
		state: WordByWordHighlightState
	): string {
		if (revealProgress <= 0) return getInlineStyleCss(EMPTY_INLINE_STYLE_FLAGS);
		if (!state.revealSpecificWordStyle || revealProgress >= 1 || !segment.flags.color) {
			return getInlineStyleCss(segment.flags);
		}

		return `${getInlineStyleCss({ ...segment.flags, color: null })} color: ${interpolateCssColor(
			state.baseColor,
			segment.flags.color,
			revealProgress
		)};`.trim();
	}

	/**
	 * Force l'affichage des unités déjà révélées quand l'ordre de traduction diffère de l'arabe.
	 *
	 * @param {TranslationWbwOverlaySegment} segment Segment à afficher.
	 * @param {WordByWordHighlightState} state État WBW courant.
	 * @param {TranslationWbwRenderData | null} data Données WBW visibles.
	 * @returns {string} CSS de visibilité forcée, ou chaîne vide.
	 */
	function getForcedRevealCss(
		segment: TranslationWbwOverlaySegment,
		state: WordByWordHighlightState,
		data: TranslationWbwRenderData | null
	): string {
		if (
			!data ||
			!state.enabled ||
			!state.revealWordsOnRecitation ||
			segment.unitIndex === undefined ||
			state.activeWordIndex < 0
		) {
			return '';
		}

		const revealIndex = Math.min(
			state.activeWordIndex,
			data.maxRevealedUnitIndexByWordIndex.length - 1
		);
		const maxRevealedUnitIndex = data.maxRevealedUnitIndexByWordIndex[revealIndex] ?? -1;
		return segment.unitIndex <= maxRevealedUnitIndex ? 'opacity: 1;' : '';
	}

	// =========================================================================
	// Props dérivées pour le template
	// =========================================================================

	let translationReferenceClip = $derived(() => getTranslationReferenceClip());

	let visibleSegments = $derived(() => getVisibleTranslationSegments());

	let wbwRenderData = $derived(() => getVisibleTranslationWbwRenderData());

	let wbwState = $derived(() => {
		const subtitle = currentSubtitle();
		const clip = subtitle instanceof SubtitleClip ? subtitle : null;
		const data = wbwRenderData();
		const styles = globalState.getVideoStyle.getStylesOfTarget(edition);
		const referenceClip = translationReferenceClip();

		return getWordByWordHighlightState({
			subtitle: clip,
			isArabicMerged: isEditionMerged(),
			mushafStyle: '',
			cursorTimeS: getTimelineSettings().cursorPosition / 1000,
			words: data?.words ?? [],
			clipStartTimeS: data?.clipStartTimeS,
			baseOpacity: subtitleOpacity,
			getStyleValue: (styleId) =>
				referenceClip ? styles.getEffectiveValue(styleId as never, referenceClip.id) : false
		});
	});

	let visibleWbwSegments = $derived(() => {
		const data = wbwRenderData();
		const state = wbwState();
		if (!data) return [];
		if (!state.showCurrentWordOnly) return data.segments;
		if (state.activeWordIndex < 0 || state.activeWordIndex >= data.words.length) return [];

		return data.segments.filter((segment) =>
			(segment.wbwWordIndexes ?? []).includes(state.activeWordIndex)
		);
	});

	/** Padding horizontal pour le fond de cette traduction. */
	let backgroundHorizontalPaddingCss = $derived(() => {
		const referenceClip = translationReferenceClip();
		const styles = globalState.getVideoStyle.getStylesOfTarget(edition);
		const isBackgroundEnabled = Boolean(
			styles.getEffectiveValue('background-enable', referenceClip?.id)
		);
		const padding = Number(
			styles.getEffectiveValue('background-horizontal-padding', referenceClip?.id)
		);
		return getBackgroundHorizontalPaddingCss(isBackgroundEnabled, padding);
	});
</script>

<p
	ondblclick={() => {
		globalState.getVideoStyle.highlightCategory('translation', edition as StyleCategoryName);
		const subtitle = currentSubtitle();
		if (subtitle) globalState.openQuickTimelineEditor(subtitle.id, 'translation');
	}}
	use:mouseDrag={{
		target: edition,
		verticalStyleId: 'vertical-position',
		horizontalStyleId: 'horizontal-position'
	}}
	class={`translation absolute subtitle select-none z-10 ${edition} ${tailwind} ${helperStyles}`}
	style={`opacity: ${wbwState().enabled ? 1 : subtitleOpacity}; ${css}; ${runtimeLayoutCss}; ${backgroundHorizontalPaddingCss} white-space: pre-line;`}
>
	<!-- Le wrapper externe porte le layout flex, le fond interne reste fragmentable par ligne. -->
	<span class="translation-inline-flow">
		<span class="line-background">
			{#if true}
				{@const state = wbwState()}
				{@const data = wbwRenderData()}
				{#each state.enabled && data ? visibleWbwSegments() : visibleSegments() as segment (segment.key)}
					{@const segmentStyle = getTranslationSegmentCss(segment, state, data)}
					{#if segmentStyle}
						<span style={segmentStyle}>{segment.text}</span>
					{:else}
						{segment.text}
					{/if}
					{#if segment.flags.lineBreak}
						<br />
					{/if}
				{/each}
			{/if}
		</span>
	</span>
</p>
