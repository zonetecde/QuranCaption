<script lang="ts">
	import { PredefinedSubtitleClip, SubtitleClip } from '$lib/classes';
	import {
		type TranslationInlineStyleFlags,
		tokenizeTranslationText,
		VerseTranslation
	} from '$lib/classes/Translation.svelte';
	import type { StyleCategoryName } from '$lib/classes/VideoStyle.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { mouseDrag } from '$lib/services/verticalDrag';
	import {
		createPlainOverlaySegment,
		getMergedClipsWithoutWordOverlap,
		getVisibleTranslationSegments as getVisibleTranslationSegmentsUtil,
		isVisualMergeTargetMerged,
		type OverlayTextSegment
	} from './visualMergeOverlayUtils';
	import { getBackgroundHorizontalPaddingCss } from './helpers/overlayCss';
	import type { SegmentationWordTimestamp } from '$lib/services/AutoSegmentation';
	import {
		getWordByWordHighlightProgress,
		getWordByWordHighlightState,
		getWordByWordWordCss
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

	// =========================================================================
	// Dérivations depuis globalState
	// =========================================================================

	/** Sous-titre courant. */
	let currentSubtitle = $derived(() => {
		return globalState.getSubtitleTrack.getCurrentSubtitleToDisplay();
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
	 * Retourne les flags inline appliqués à une unité de traduction.
	 *
	 * @param {VerseTranslation} translation Traduction source.
	 * @param {number} unitIndex Index de l'unité trim.
	 * @returns {TranslationInlineStyleFlags} Flags inline.
	 */
	function getInlineFlagsForUnitIndex(
		translation: VerseTranslation,
		unitIndex: number
	): TranslationInlineStyleFlags {
		for (const run of translation.inlineStyleRuns ?? []) {
			if (run.startWordIndex <= unitIndex && unitIndex <= run.endWordIndex) {
				return {
					bold: run.bold,
					italic: run.italic,
					underline: run.underline,
					color: run.color ?? null
				};
			}
		}

		return {
			bold: false,
			italic: false,
			underline: false,
			color: null
		};
	}

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
		for (const arabicWordIndex of uniqueArabicWordIndexes) {
			const timing = subtitle.alignmentMetadata?.words[arabicWordIndex] ?? null;
			if (!timing) continue;

			const wbwWordIndex = wordOffset + words.length;
			wbwIndexByArabicWord.set(arabicWordIndex, wbwWordIndex);
			words.push({
				...timing,
				start: timing.start + timingOffsetS,
				end: timing.end + timingOffsetS
			});
			maxRevealedUnitIndexByWordIndex.push(
				sortedRanges
					.filter((range) => range.arabicWordIndex <= arabicWordIndex)
					.reduce((max, range) => Math.max(max, range.endUnitIndex), -1)
			);
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

		for (let index = 0; index < tokens.length; index++) {
			const token = tokens[index];
			const segment: TranslationWbwOverlaySegment = {
				key: `${editionName}-${subtitle.id}-wbw-${index}`,
				text: token.text,
				flags:
					token.isWord && token.wordIndex !== null
						? getInlineFlagsForUnitIndex(translation, token.wordIndex)
						: {
								bold: false,
								italic: false,
								underline: false,
								color: null
							}
			};

			if (token.isWord && token.wordIndex !== null) {
				const arabicWordIndexes = rangesByUnit.get(token.wordIndex) ?? [];
				segment.unitIndex = token.wordIndex;
				for (const arabicWordIndex of arabicWordIndexes) {
					const wbwWordIndex = wbwIndexByArabicWord.get(arabicWordIndex);
					if (wbwWordIndex === undefined) continue;
					segment.wbwWordIndexes = [...(segment.wbwWordIndexes ?? []), wbwWordIndex];
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

		if (!isEditionMerged()) {
			return getTranslationWbwRenderDataForClip(edition, subtitle);
		}

		const group = currentVisualMergeGroup();
		if (!group) return null;

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

		return words.length > 0
			? { segments, words, clipStartTimeS, maxRevealedUnitIndexByWordIndex }
			: null;
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
	 * Convertit les flags de style inline en CSS appliqué au segment.
	 *
	 * @param flags - Flags de style inline (bold, italic, underline, color).
	 * @returns Chaîne CSS correspondante.
	 */
	function getInlineStyleCss(flags: TranslationInlineStyleFlags): string {
		const parts: string[] = [];
		if (flags.bold) parts.push('font-weight: 700;');
		if (flags.italic) parts.push('font-style: italic;');
		if (flags.underline) parts.push('text-decoration: underline;');
		if (flags.color) parts.push(`color: ${flags.color};`);
		return parts.join(' ');
	}

	/**
	 * Fusionne le CSS WBW avec le CSS inline d'une unité de traduction.
	 *
	 * @param {TranslationWbwOverlaySegment} segment Segment à afficher.
	 * @returns {string} CSS inline final.
	 */
	function getTranslationSegmentCss(segment: TranslationWbwOverlaySegment): string {
		let wbwCss = '';
		const wbwWordIndexes = segment.wbwWordIndexes ?? [];
		if (wbwWordIndexes.length > 0 && wbwState().enabled) {
			const best = wbwWordIndexes
				.map((index) => ({
					index,
					progress: getWordByWordHighlightProgress(index, wbwState(), wbwPreviewFadeDuration())
				}))
				.sort((a, b) => b.progress - a.progress)[0];
			wbwCss = getWordByWordWordCss(
				best.index,
				wbwState(),
				best.progress,
				wbwPreviewFadeDuration()
			);
		}

		return `${wbwCss} ${getForcedRevealCss(segment)} ${getInlineStyleCss(segment.flags)} ${segment.extraCss ?? ''}`.trim();
	}

	/**
	 * Force l'affichage des unités déjà révélées quand l'ordre de traduction diffère de l'arabe.
	 *
	 * @param {TranslationWbwOverlaySegment} segment Segment à afficher.
	 * @returns {string} CSS de visibilité forcée, ou chaîne vide.
	 */
	function getForcedRevealCss(segment: TranslationWbwOverlaySegment): string {
		const data = wbwRenderData();
		const state = wbwState();
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
			getStyleValue: (styleId) =>
				referenceClip ? styles.getEffectiveValue(styleId as never, referenceClip.id) : false
		});
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
	style={`opacity: ${subtitleOpacity}; ${css}; ${backgroundHorizontalPaddingCss} white-space: pre-line;`}
>
	<span class="translation-inline-flow">
		{#each wbwState().enabled && wbwRenderData() ? wbwRenderData()!.segments : visibleSegments() as segment (segment.key)}
			{@const segmentStyle = getTranslationSegmentCss(segment)}
			{#if segmentStyle}
				<span style={segmentStyle}>{segment.text}</span>
			{:else}
				{segment.text}
			{/if}
		{/each}
	</span>
</p>
