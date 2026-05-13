<script lang="ts">
	import { PredefinedSubtitleClip, SubtitleClip } from '$lib/classes';
	import { type TranslationInlineStyleFlags, VerseTranslation } from '$lib/classes/Translation.svelte';
	import type { StyleCategoryName } from '$lib/classes/VideoStyle.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { mouseDrag } from '$lib/services/verticalDrag';
	import {
		createPlainOverlaySegment,
		getVisibleTranslationSegments as getVisibleTranslationSegmentsUtil,
		isVisualMergeTargetMerged,
		type OverlayTextSegment
	} from './visualMergeOverlayUtils';
	import { getBackgroundHorizontalPaddingCss } from './helpers/overlayCss';

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
	}

	let { edition, subtitleOpacity, css, tailwind, helperStyles }: TranslationSubtitleProps =
		$props();

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
					createPlainOverlaySegment(`${editionName}-${subtitle.id}-prefix`, textParts.prefix)
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
					createPlainOverlaySegment(`${editionName}-${subtitle.id}-suffix`, textParts.suffix)
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

	// =========================================================================
	// Props dérivées pour le template
	// =========================================================================

	let translationReferenceClip = $derived(() => getTranslationReferenceClip());

	let visibleSegments = $derived(() => getVisibleTranslationSegments());

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
		{#each visibleSegments() as segment (segment.key)}
			{@const segmentStyle = `${getInlineStyleCss(segment.flags)} ${segment.extraCss ?? ''}`.trim()}
			{#if segmentStyle}
				<span style={segmentStyle}>{segment.text}</span>
			{:else}
				{segment.text}
			{/if}
		{/each}
	</span>
</p>
