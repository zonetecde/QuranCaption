<script lang="ts">
	import { globalState } from '$lib/runes/main.svelte';
	import { onDestroy, onMount, untrack } from 'svelte';
	import { slide } from 'svelte/transition';
	import type { Style, StyleName } from '$lib/classes/VideoStyle.svelte';
	import type { CustomClip } from '$lib/classes/Clip.svelte';
	import { default as StyleComponent } from '$lib/components/projectEditor/tabs/styleEditor/Style.svelte';
	import toast from 'svelte-5-french-toast';
	import LL from '$lib/i18n/i18n-svelte';
	import { get } from 'svelte/store';
	import { getStyleName, getStyleDescription } from '$lib/i18n/styleMapper';
	import { applyStyleMutation } from '$lib/services/StyleMutationService';
	import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
	import AyahImageControl from './controls/AyahImageControl.svelte';
	import BracketsFontControl from './controls/BracketsFontControl.svelte';
	import BasmalaStyleControl from './controls/BasmalaStyleControl.svelte';
	import ColorControl from './controls/ColorControl.svelte';
	import DimensionControl from './controls/DimensionControl.svelte';
	import FadeControl from './controls/FadeControl.svelte';
	import FileControl from './controls/FileControl.svelte';
	import FontFamilyControl from './controls/FontFamilyControl.svelte';
	import NumberControl from './controls/NumberControl.svelte';
	import ReciterControl from './controls/ReciterControl.svelte';
	import SelectControl from './controls/SelectControl.svelte';
	import TextControl from './controls/TextControl.svelte';
	import TimeControl from './controls/TimeControl.svelte';
	import TimedRangesControl from './controls/TimedRangesControl.svelte';
	import KeyframeControls from './KeyframeControls.svelte';
	import { asDimensionValue, asFadeValue, hasFadeEnabled, msToTimeValue } from './controls/utils';
	import { getTimedOverlayRanges } from '$lib/services/TimedOverlayRanges';

	const LL_ = get(LL);
	const NON_ANIMATABLE_STYLE_IDS = new Set([
		'video-dimension',
		'media-fill',
		'media-scale',
		'media-position-x',
		'media-position-y',
		'fade-duration',
		'video-and-audio-fade',
		'video-clip-transition',
		'video-clip-transition-duration',
		'overlay-blur',
		'riwayah',
		'mushaf-style',
		'reactive-font-size',
		'reactive-y-position',
		'always-show',
		'surah-name-always-show',
		'reciter-name-always-show'
	]);
	const NON_ANIMATABLE_STYLE_TYPES = new Set([
		'composite',
		'reciter',
		'file',
		'ayah-image',
		'time',
		'time-ranges'
	]);

	/**
	 * Lit une microcopie ajoutée au dictionnaire de style en attendant la génération i18n du hook.
	 * @param {'mixedValue' | 'localOverride'} key Clé de microcopie à résoudre.
	 * @returns {string} Texte localisé.
	 */
	function getStyleUiCopy(
		key: 'mixedValue' | 'localOverride' | 'keyframeInterpolationNotice'
	): string {
		return (
			get(LL).style as unknown as Record<
				'mixedValue' | 'localOverride' | 'keyframeInterpolationNotice',
				() => string
			>
		)[key]();
	}

	let {
		style,
		descriptionId,
		target,
		disabled,
		showControl = false,
		headerControl = false,
		applyValueSimple
	}: {
		style: Style;
		descriptionId?: string;
		target?: string;
		disabled: boolean;
		showControl?: boolean;
		headerControl?: boolean;
		applyValueSimple: (value: Style['value']) => void;
	} = $props();

	type StyleValue = Style['value'];

	onMount(async () => {
		// Par défaut fermé
		if (!globalState.getSectionsState[style.id])
			globalState.getSectionsState[style.id] = {
				extended: false
			};
		else extended = globalState.getSectionsState[style.id].extended;

		// Si est un style composite
		if (style.valueType === 'composite' && target) {
			// On charge les styles composites
			await globalState.getVideoStyle.getStylesOfTarget(target).loadCompositeStyles();
		}
	});

	let extended = $state(false);
	let styleTooltip = $state<HTMLDivElement>();

	/**
	 * Affiche la description du style près de son icône d'information.
	 * @param {HTMLElement} anchor Icône servant de point d'ancrage.
	 * @returns {void}
	 */
	function showStyleTooltip(anchor: HTMLElement): void {
		if (!styleTooltip) return;
		styleTooltip.showPopover();
		const anchorRect = anchor.getBoundingClientRect();
		const tooltipRect = styleTooltip.getBoundingClientRect();
		const gap = 8;
		const left = Math.min(
			Math.max(anchorRect.left + anchorRect.width / 2 - tooltipRect.width / 2, gap),
			window.innerWidth - tooltipRect.width - gap
		);
		const topAbove = anchorRect.top - tooltipRect.height - gap;
		const top =
			topAbove >= gap
				? topAbove
				: Math.min(anchorRect.bottom + gap, window.innerHeight - tooltipRect.height - gap);

		styleTooltip.style.left = `${left}px`;
		styleTooltip.style.top = `${top}px`;
	}

	/**
	 * Masque l'infobulle de description du style.
	 * @returns {void}
	 */
	function hideStyleTooltip(): void {
		if (styleTooltip?.matches(':popover-open')) styleTooltip.hidePopover();
	}

	$effect(() => {
		globalState.getSectionsState[style.id] = {
			extended: extended
		};
	});

	$effect(() => {
		if (showControl) extended = true;
	});

	// Gestion sélection de clips
	const overlayGlobalStyleIds = new Set<string>([
		'overlay-enable',
		'overlay-color',
		'overlay-opacity',
		'background-overlay-mode',
		'background-overlay-fade-intensity',
		'background-overlay-fade-coverage',
		'background-overlay-fade-softness',
		'background-overlay-fade-curve',
		'background-overlay-fade-invert',
		'background-overlay-fade-position-x',
		'background-overlay-fade-position-y',
		'background-overlay-fade-width',
		'background-overlay-fade-height',
		'overlay-custom-css',
		'overlay-blur'
	]);

	function isGlobalOverlayStyle(): boolean {
		return target === 'global' && overlayGlobalStyleIds.has(style.id);
	}

	const selectedClipIds = $derived(() => {
		// Pour les targets de sous-titres/traductions: sélection de sous-titres.
		if (target && target !== 'global') {
			return globalState.getStylesState.selectedSubtitles.map((s) => s.id);
		}
		// Pour global.overlay.*: sélection de clips vidéo.
		if (isGlobalOverlayStyle()) {
			return globalState.getStylesState.selectedVideos.map((clip) => clip.id);
		}
		// Les autres styles globaux restent strictement globaux.
		return [];
	});

	/**
	 * Retourne le temps entier du curseur utilisé comme position d'image clé.
	 * @returns {number} Position absolue en millisecondes.
	 */
	function getKeyframeCursorTime(): number {
		return Math.max(0, Math.floor(globalState.getTimelineState.cursorPosition));
	}

	/**
	 * Retrouve la portée standard du style lorsque celui-ci appartient à une cible vidéo.
	 * @returns {ReturnType<typeof globalState.getVideoStyle.getStylesOfTarget> | undefined} Portée gérée, si disponible.
	 */
	function getManagedStylesData():
		| ReturnType<typeof globalState.getVideoStyle.getStylesOfTarget>
		| undefined {
		const videoStyle = globalState.currentProject?.content?.videoStyle;
		if (!target || !videoStyle) return undefined;
		const styles = videoStyle.getStylesOfTarget(target);
		return styles.findStyle(style.id as StyleName) === style ? styles : undefined;
	}

	/**
	 * Retourne les images clés visibles pour la portée éditée.
	 * @returns {number[]} Positions triées en millisecondes.
	 */
	function getVisibleKeyframeTimes(): number[] {
		const styles = getManagedStylesData();
		if (styles) return styles.getKeyframeTimes(style.id as StyleName, selectedClipIds());
		return style.keyframes.map((keyframe) => keyframe.time);
	}

	/**
	 * Ajoute ou supprime l'image clé située sous le curseur.
	 * @returns {void}
	 */
	function toggleKeyframe(): void {
		const time = getKeyframeCursorTime();
		const hadProjectKeyframes = globalState.getAllStyleKeyframeTimes().length > 0;
		let createdKeyframe = false;
		ProjectHistoryManager.track('toggle style keyframe', () => {
			const styles = getManagedStylesData();
			if (styles?.hasKeyframeAt(style.id as StyleName, time, selectedClipIds())) {
				styles.removeKeyframe(style.id as StyleName, time, selectedClipIds());
			} else if (styles) {
				styles.setKeyframe(
					style.id as StyleName,
					time,
					$state.snapshot(inputValue) as StyleValue,
					selectedClipIds()
				);
				createdKeyframe = true;
			} else if (style.hasKeyframeAt(time)) style.removeKeyframe(time);
			else {
				style.setKeyframe(time, $state.snapshot(inputValue) as StyleValue);
				createdKeyframe = true;
			}
		});
		const editorState = globalState.currentProject?.projectEditorState;
		if (
			createdKeyframe &&
			!hadProjectKeyframes &&
			editorState &&
			!editorState.keyframeInterpolationNoticeShown
		) {
			editorState.keyframeInterpolationNoticeShown = true;
			toast(getStyleUiCopy('keyframeInterpolationNotice'), {
				icon: 'ℹ️',
				duration: 9000,
				position: 'bottom-left'
			});
		}
		globalState.updateVideoPreviewUI();
	}

	/**
	 * Déplace le curseur vers l'image clé précédente ou suivante.
	 * @param {'previous' | 'next'} direction Sens de navigation demandé.
	 * @returns {void}
	 */
	function seekKeyframe(direction: 'previous' | 'next'): void {
		const time = getKeyframeCursorTime();
		const times = getVisibleKeyframeTimes();
		const destination =
			direction === 'previous'
				? times.findLast((candidate) => candidate < time)
				: times.find((candidate) => candidate > time);
		if (destination === undefined) return;
		globalState.getTimelineState.cursorPosition = destination;
		globalState.getTimelineState.movePreviewTo = destination;
	}

	const keyframeTimes = $derived(() => {
		const _ = globalState.getTimelineState.cursorPosition;
		return getVisibleKeyframeTimes();
	});
	const hasKeyframeAtCursor = $derived(() => keyframeTimes().includes(getKeyframeCursorTime()));
	const hasPreviousKeyframe = $derived(() =>
		keyframeTimes().some((time) => time < getKeyframeCursorTime())
	);
	const hasNextKeyframe = $derived(() =>
		keyframeTimes().some((time) => time > getKeyframeCursorTime())
	);
	const canAnimate = $derived(
		() =>
			!NON_ANIMATABLE_STYLE_IDS.has(style.id) && !NON_ANIMATABLE_STYLE_TYPES.has(style.valueType)
	);

	function getEffectiveForSelection(): {
		value: unknown;
		mixed: boolean;
		overridden: boolean;
	} {
		if (!target) {
			return {
				value: style.getValueAt(getKeyframeCursorTime(), 0),
				mixed: false,
				overridden: false
			};
		}

		if (selectedClipIds().length === 0) {
			return {
				value: style.getValueAt(getKeyframeCursorTime(), 0),
				mixed: false,
				overridden: false
			};
		}

		const values = selectedClipIds().map((id) =>
			globalState.getVideoStyle
				.getStylesOfTarget(target)
				.getEffectiveValue(style.id as StyleName, id, undefined, 0)
		);
		const first = values[0];
		const mixed = values.some((v) => JSON.stringify(v) !== JSON.stringify(first));
		const overridden = globalState.getVideoStyle
			.getStylesOfTarget(target)
			.hasOverrideForAny(selectedClipIds(), style.id as StyleName);
		return { value: mixed ? first : first, mixed, overridden };
	}

	// Drapeaux visuels
	const isMixed = $derived(() =>
		selectedClipIds().length > 0 ? getEffectiveForSelection().mixed : false
	);
	const isOverridden = $derived(() =>
		selectedClipIds().length > 0 ? getEffectiveForSelection().overridden : false
	);

	let inputValue: StyleValue = $state(untrack(() => style.getValueAt(getKeyframeCursorTime(), 0)));
	$effect(() => {
		const eff = getEffectiveForSelection();
		inputValue = eff.value as StyleValue;
	});

	/**
	 * Supprime les chevauchements vidéo en décalant les clips suivants sans perdre leurs espaces.
	 * @returns {boolean} `true` si au moins un clip a été déplacé.
	 */
	function removeVideoClipOverlaps(): boolean {
		let cumulativeOffset = 0;
		let previousEndTime = -1;
		let changed = false;

		for (const clip of globalState.getVideoTrack.clips) {
			const shiftedStartTime = clip.startTime + cumulativeOffset;
			if (shiftedStartTime <= previousEndTime) {
				cumulativeOffset += previousEndTime + 1 - shiftedStartTime;
			}
			if (cumulativeOffset > 0) {
				clip.startTime += cumulativeOffset;
				clip.endTime += cumulativeOffset;
				changed = true;
			}
			previousEndTime = clip.endTime;
		}

		return changed;
	}

	function applyValue(v: unknown) {
		const shouldRemoveVideoOverlaps =
			style.id === 'video-clip-transition' &&
			String(style.value) === 'crossfade' &&
			String(v) === 'fade-through-black';
		let removedVideoOverlaps = false;
		const result = ProjectHistoryManager.track('set style value', () => {
			const mutationResult = applyStyleMutation({
				videoStyle: globalState.getVideoStyle,
				style,
				target,
				clipIds: selectedClipIds(),
				time: getKeyframeCursorTime(),
				value: v,
				applyBaseValue: applyValueSimple
			});
			if (shouldRemoveVideoOverlaps) removedVideoOverlaps = removeVideoClipOverlaps();
			return mutationResult;
		});
		if (result.refreshPreview || removedVideoOverlaps) globalState.updateVideoPreviewUI();
		if (result.showTajweedWarning) toast(get(LL).editor.tajweedFontWarning());
	}

	function applySelectValue(value: string) {
		applyValue(value);
	}

	/**
	 * Efface les styles différents de son parent appliqués aux clips sélectionnés
	 */
	function clearOverride() {
		if (selectedClipIds().length === 0) return;
		const styles = globalState.getVideoStyle.getStylesOfTarget(target!);
		if (target === 'arabic' && style.id === 'riwayah') {
			ProjectHistoryManager.track('clear riwayah override', () => {
				styles.clearStyleForClips(selectedClipIds(), 'riwayah');
				styles.clearStyleForClips(selectedClipIds(), 'font-family');
			});
			return;
		}
		styles.clearStyleForClips(selectedClipIds(), style.id as StyleName);
	}

	/**
	 * Effect permettant de fermer le style si celui-ci se fait désactiver
	 */
	$effect(() => {
		if (disabled) {
			extended = false; // Si le style est désactivé, on le ferme
			return;
		}
	});

	onDestroy(() => {
		if (globalState.hoveredStylePreviewHelper === style.id) {
			globalState.hoveredStylePreviewHelper = null;
		}
	});

	function getStyleValue() {
		if (style.valueType === 'composite') {
			return LL_.common.details();
		} else if (style.valueType === 'reciter') {
			return globalState.currentProject!.detail.reciter || LL_.common.none();
		} else if (style.valueType === 'dimension') {
			const dimension = asDimensionValue(inputValue);
			return dimension.width + 'x' + dimension.height;
		} else if (style.valueType === 'fade') {
			const fadeValue = asFadeValue(inputValue);
			return `${hasFadeEnabled(fadeValue) ? LL_.common.enabled() + ' - ' + fadeValue.fadeDurationMs + LL_.common.ms() : LL_.common.disabled()}`;
		} else if (style.valueType === 'ayah-image') {
			return inputValue ? String(inputValue) : LL_.common.none();
		} else if (style.valueType === 'time-ranges') {
			return String(getTimedOverlayRanges(inputValue, 0, 10000).length);
		} else return String(inputValue);
	}

	function getHeaderPreviewStyle() {
		return style.id === 'decorative-brackets-font-family' ? "font-family: 'QPC2BSML', serif;" : '';
	}

	/**
	 * Harmonise begin/end après clic sur "Use preview cursor time":
	 * - si on set begin et begin > end, alors end = begin + 3s
	 * - si on set end et end < begin, alors begin = end et end = end + 3s
	 */
	function syncTimeRangeAfterPreviewCursor(cursorMs: number): void {
		const beginToEndStyle: Partial<Record<StyleName, StyleName>> = {
			'time-appearance': 'time-disappearance',
			'surah-name-time-appearance': 'surah-name-time-disappearance',
			'reciter-name-time-appearance': 'reciter-name-time-disappearance'
		};

		const endToBeginStyle: Partial<Record<StyleName, StyleName>> = {
			'time-disappearance': 'time-appearance',
			'surah-name-time-disappearance': 'surah-name-time-appearance',
			'reciter-name-time-disappearance': 'reciter-name-time-appearance'
		};

		const currentStyleId = style.id as StyleName;
		const endStyleId = beginToEndStyle[currentStyleId];

		if (endStyleId) {
			const endFallback = cursorMs + 3000;

			// Cas custom clip: synchroniser style et clip pour garder timeline/preview coherents.
			if (currentStyleId === 'time-appearance') {
				let didSyncCustomClip = false;
				for (const customClip of (globalState.getCustomClipTrack?.clips || []) as CustomClip[]) {
					const category = customClip.category;
					if (!category) continue;

					const isCurrentCategory = category.styles.some((s: Style) => s === style);
					if (!isCurrentCategory) continue;

					const endStyle = category.styles.find((s: Style) => s.id === endStyleId);
					if (!endStyle) break;

					const currentEnd = Number(endStyle.value ?? 0);
					if (cursorMs > currentEnd) {
						endStyle.value = endFallback;
						customClip.setEndTime(endFallback);
					}
					didSyncCustomClip = true;
					break;
				}
				if (didSyncCustomClip) return;
			}

			if (target && target !== 'global') {
				const targetEndStyle = globalState.getVideoStyle
					.getStylesOfTarget(target)
					.findStyle(endStyleId);
				if (targetEndStyle) {
					const currentEnd = Number(targetEndStyle.value ?? 0);
					if (cursorMs > currentEnd) {
						targetEndStyle.value = endFallback;
					}
					return;
				}
			}

			// Cas style global (surah/reciter): simple mise a jour du style global.
			const globalEndStyle = globalState.getStyle('global', endStyleId);
			const currentEnd = Number(globalEndStyle.value ?? 0);
			if (cursorMs > currentEnd) {
				globalEndStyle.value = endFallback;
			}
			return;
		}

		const beginStyleId = endToBeginStyle[currentStyleId];
		if (!beginStyleId) return;

		const endFallback = cursorMs + 3000;

		if (currentStyleId === 'time-disappearance') {
			let didSyncCustomClip = false;
			for (const customClip of (globalState.getCustomClipTrack?.clips || []) as CustomClip[]) {
				const category = customClip.category;
				if (!category) continue;

				const isCurrentCategory = category.styles.some((s: Style) => s === style);
				if (!isCurrentCategory) continue;

				const beginStyle = category.styles.find((s: Style) => s.id === beginStyleId);
				if (!beginStyle) break;

				const currentBegin = Number(beginStyle.value ?? 0);
				if (cursorMs < currentBegin) {
					beginStyle.value = cursorMs;
					customClip.setStartTime(cursorMs);
					style.value = endFallback;
					customClip.setEndTime(endFallback);
				}
				didSyncCustomClip = true;
				break;
			}
			if (didSyncCustomClip) return;
		}

		if (target && target !== 'global') {
			const targetBeginStyle = globalState.getVideoStyle
				.getStylesOfTarget(target)
				.findStyle(beginStyleId);
			if (targetBeginStyle) {
				const currentBegin = Number(targetBeginStyle.value ?? 0);
				if (cursorMs < currentBegin) {
					targetBeginStyle.value = cursorMs;
					style.value = endFallback;
				}
				return;
			}
		}

		const globalBeginStyle = globalState.getStyle('global', beginStyleId);
		const currentBegin = Number(globalBeginStyle.value ?? 0);
		if (cursorMs < currentBegin) {
			globalBeginStyle.value = cursorMs;
			style.value = endFallback;
		}
	}
</script>

{#if headerControl}
	<div class="flex items-center gap-1" class:opacity-50={disabled}>
		{#if selectedClipIds().length > 0 && (isOverridden() || isMixed())}
			<button
				type="button"
				class="grid size-7 place-items-center rounded-md text-secondary transition-colors hover:bg-[var(--bg-accent)] hover:text-primary"
				title={$LL.editor.resetOverrideSelection()}
				onclick={(event) => {
					event.stopPropagation();
					clearOverride();
				}}
			>
				<span class="material-icons-outlined text-[16px]!">restart_alt</span>
			</button>
		{/if}
		<label
			class="inline-flex origin-right scale-75 cursor-pointer select-none items-center"
			title={getStyleName(style.id, get(LL))}
		>
			<input
				type="checkbox"
				class="peer sr-only"
				aria-label={getStyleName(style.id, get(LL))}
				checked={Boolean(inputValue)}
				indeterminate={isMixed()}
				{disabled}
				onchange={(event) => applyValue((event.target as HTMLInputElement).checked)}
			/>
			<div
				class="relative h-6 w-11 rounded-full border border-color bg-[var(--bg-accent)]
					transition-colors duration-150 peer-checked:bg-[var(--accent-primary)]
					peer-indeterminate:bg-fuchsia-500 peer-checked:[&>span]:translate-x-5
					peer-indeterminate:[&>span]:translate-x-2.5"
			>
				<span
					class="absolute left-1 top-0.75 h-4 w-4 rounded-full bg-white shadow transition-transform duration-150"
				></span>
			</div>
		</label>
		{#if canAnimate()}
			<KeyframeControls
				active={hasKeyframeAtCursor()}
				hasPrevious={hasPreviousKeyframe()}
				hasNext={hasNextKeyframe()}
				{disabled}
				onPrevious={() => seekKeyframe('previous')}
				onToggle={toggleKeyframe}
				onNext={() => seekKeyframe('next')}
			/>
		{/if}
	</div>
{:else}
	<div
		class={'style-control flex flex-col duration-150 ' +
			(showControl
				? 'style-control-direct '
				: 'rounded-xl overflow-hidden ' +
					(extended
						? 'bg-[var(--bg-accent)]/20 ring-1 ring-[var(--border-color)]'
						: 'hover:bg-[var(--bg-accent)]/20')) +
			(showControl
				? isMixed()
					? ' style-control-direct-mixed'
					: isOverridden()
						? ' style-control-direct-overridden'
						: ''
				: isMixed()
					? ' border border-fuchsia-400/60'
					: isOverridden()
						? ' border border-amber-400/60'
						: ' border border-transparent') +
			(showControl && style.valueType === 'number' ? ' style-control-number' : '') +
			(disabled ? ' opacity-50 pointer-events-none' : '')}
		onmouseenter={() => {
			if (style.id === 'width' || style.id === 'max-height') {
				globalState.hoveredStylePreviewHelper = style.id as StyleName;
			}
		}}
		onmouseleave={() => {
			if (globalState.hoveredStylePreviewHelper === style.id) {
				globalState.hoveredStylePreviewHelper = null;
			}
		}}
	>
		<!-- Header -->
		<div
			class={'flex items-center justify-between select-none ' +
				(showControl
					? 'style-control-direct-header '
					: 'py-1.25 px-2 ' + (extended ? 'border-b border-color ' : '')) +
				(showControl ? '' : 'cursor-pointer')}
			onclick={() => {
				if (showControl) return;
				// Impossible d'étendre un style booléen, comme on a le switch directement pour le mettre en true/false
				if (style.valueType !== 'boolean') extended = !extended;
				else applyValue(!inputValue);
			}}
		>
			<div class="flex items-center gap-2">
				<span
					class={'material-icons-outlined text-secondary ' +
						(showControl ? 'text-[18px]!' : 'text-[20px]!')}>{style.icon}</span
				>
				<span class="text-sm text-primary font-medium">{getStyleName(style.id, get(LL))}</span>
				<span
					class="style-info-trigger"
					tabindex="0"
					aria-label={getStyleDescription(descriptionId ?? style.id, get(LL))}
					onmouseenter={(event) => showStyleTooltip(event.currentTarget)}
					onmouseleave={hideStyleTooltip}
					onfocus={(event) => showStyleTooltip(event.currentTarget)}
					onblur={hideStyleTooltip}
				>
					<span class="material-icons-outlined translate-x-14 translate-y-0.25 opacity-60"
						>info_outline</span
					>
				</span>
				<div
					bind:this={styleTooltip}
					popover="manual"
					class="style-description-tooltip"
					role="tooltip"
				>
					{getStyleDescription(descriptionId ?? style.id, get(LL))}
				</div>
			</div>
			{#key selectedClipIds().length + JSON.stringify(inputValue)}
				<div class="flex items-center gap-2 text-xs text-secondary">
					{#if style.valueType === 'boolean'}
						<label
							class="inline-flex items-center cursor-pointer select-none scale-75 origin-right"
						>
							<input
								type="checkbox"
								class="sr-only peer"
								checked={Boolean(inputValue)}
								indeterminate={isMixed()}
								onchange={(e) => applyValue((e.target as HTMLInputElement).checked)}
							/>
							<div
								class="relative w-11 h-6 rounded-full border border-color bg-[var(--bg-accent)]
			transition-colors duration-150 peer-checked:bg-[var(--accent-primary)]
			peer-indeterminate:bg-fuchsia-500 peer-checked:[&>span]:translate-x-5
			peer-indeterminate:[&>span]:translate-x-2.5"
							>
								<span
									class="absolute left-1 top-0.75 w-4 h-4 bg-white rounded-full shadow
				transition-transform duration-150"
								>
								</span>
							</div>
						</label>
					{:else if selectedClipIds().length > 0}
						{#if getEffectiveForSelection().mixed}
							<span
								class="px-1.5 py-0.5 rounded bg-fuchsia-500/15 text-fuchsia-200 border border-fuchsia-400/40 flex items-center gap-1"
							>
								<span class="material-icons-outlined text-[12px]">scatter_plot</span>
								{getStyleUiCopy('mixedValue')}
							</span>
						{:else if getEffectiveForSelection().overridden}
							<span
								class="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-200 border border-amber-400/40 flex items-center gap-1 cursor-auto"
							>
								<span class="material-icons-outlined text-[12px]">auto_fix_high</span>
								{getStyleUiCopy('localOverride')}:
								<span style={getHeaderPreviewStyle()}>
									{style.valueType === 'time-ranges'
										? getTimedOverlayRanges(getEffectiveForSelection().value, 0, 10000).length
										: getEffectiveForSelection().value}
								</span>
							</span>
						{:else}
							<span style={getHeaderPreviewStyle()}>{String(inputValue)}</span>
						{/if}
					{:else if style.valueType === 'time' && !showControl}
						<span>{msToTimeValue(Number(inputValue))}</span>
					{:else if !showControl}
						<span class="truncate max-w-[140px]" style={getHeaderPreviewStyle()}
							>{getStyleValue()}</span
						>
					{/if}

					{#if selectedClipIds().length > 0 && (getEffectiveForSelection().overridden || getEffectiveForSelection().mixed)}
						<button
							class="ml-1 text-[11px] px-2 py-1 rounded border hover:opacity-90 duration-100 flex items-center gap-1 cursor-pointer"
							title={$LL.editor.resetOverrideSelection()}
							onclick={(e) => {
								e.stopPropagation();
								clearOverride();
							}}
						>
							<span class="material-icons-outlined text-[12px]">restart_alt</span>
							{$LL.common.reset()}
						</button>
					{/if}
					{#if canAnimate()}
						<KeyframeControls
							active={hasKeyframeAtCursor()}
							hasPrevious={hasPreviousKeyframe()}
							hasNext={hasNextKeyframe()}
							{disabled}
							onPrevious={() => seekKeyframe('previous')}
							onToggle={toggleKeyframe}
							onNext={() => seekKeyframe('next')}
						/>
					{/if}
				</div>
			{/key}
		</div>

		{#if (extended || showControl) && style.valueType !== 'boolean'}
			<div class={showControl ? 'style-control-direct-body' : 'my-2 px-2'} transition:slide>
				{#if !showControl || ['dimension', 'fade', 'composite', 'ayah-image', 'file', 'reciter', 'time-ranges'].includes(style.valueType) || style.id === 'video-clip-transition-duration'}
					<p class="text-xs text-secondary mb-2 flex items-center gap-1">
						<span class="material-icons-outlined text-[12px]">info</span>
						{getStyleDescription(descriptionId ?? style.id, get(LL))}
					</p>
				{/if}

				<!-- Modificateur de valeur -->
				{#if style.valueType === 'number'}
					<NumberControl {style} value={inputValue} onChange={applyValue} />
				{:else if style.valueType === 'color'}
					<ColorControl value={inputValue} onChange={applyValue} />
				{:else if style.id === 'font-family'}
					<FontFamilyControl value={inputValue} onChange={applySelectValue} />
				{:else if style.id === 'basmala-style'}
					<BasmalaStyleControl {style} value={inputValue} onChange={applySelectValue} />
				{:else if style.valueType === 'select'}
					<SelectControl {style} value={inputValue} onChange={applySelectValue} />
				{:else if style.valueType === 'brackets-font'}
					<BracketsFontControl {style} value={inputValue} onChange={applyValue} />
				{:else if style.valueType === 'text'}
					<TextControl {style} value={inputValue} onChange={applyValue} />
				{:else if style.valueType === 'time'}
					<TimeControl
						value={inputValue}
						onChange={applyValue}
						onUsePreviewCursor={syncTimeRangeAfterPreviewCursor}
					/>
				{:else if style.valueType === 'time-ranges'}
					<TimedRangesControl value={inputValue} onChange={applyValue} />
				{:else if style.valueType === 'reciter'}
					<ReciterControl />
				{:else if style.valueType === 'file'}
					<FileControl value={inputValue} {disabled} onChange={applyValue} />
				{:else if style.valueType === 'ayah-image'}
					<AyahImageControl value={inputValue} {disabled} onChange={applyValue} />
				{:else if style.valueType === 'dimension'}
					<DimensionControl value={inputValue} onChange={applyValue} />
				{:else if style.valueType === 'fade'}
					<FadeControl value={inputValue} onChange={applyValue} />
				{:else if style.valueType === 'composite'}
					<div class="style-control-list">
						{#each globalState.getVideoStyle
							.getStylesOfTarget(target!)
							.getCompositeStyles(style.id as StyleName) as subStyle (subStyle.id)}
							<StyleComponent
								style={subStyle}
								target={style.id}
								disabled={false}
								showControl
								applyValueSimple={(v) => {
									subStyle.value = v;
								}}
							/>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	</div>
{/if}

<style>
	.style-control-direct {
		border-bottom: 1px solid color-mix(in srgb, var(--border-color) 72%, transparent);
		background: transparent;
	}

	.style-control-direct-header {
		min-height: 2.6rem;
		padding: 0.55rem 0.15rem;
	}

	.style-control-direct-body {
		padding: 0.1rem 0.15rem 0.75rem;
	}

	.style-control-number .style-control-direct-header {
		min-height: 2.25rem;
		padding: 0.45rem 0.15rem 0.2rem;
	}

	.style-control-number .style-control-direct-body {
		padding-top: 0;
	}

	.style-control-direct-mixed,
	.style-control-direct-overridden {
		padding-left: 0.4rem;
	}

	.style-control-direct-mixed {
		border-left: 2px solid rgb(232 121 249 / 70%);
	}

	.style-control-direct-overridden {
		border-left: 2px solid rgb(251 191 36 / 70%);
	}

	.style-control-list {
		display: flex;
		flex-direction: column;
	}

	:global(.style-control-list > .style-control-direct:last-child) {
		border-bottom: 0;
	}

	.style-info-trigger {
		display: inline-flex;
		width: 14px;
		height: 14px;
		flex: 0 0 14px;
		align-items: center;
		justify-content: center;
		color: var(--text-secondary);
		cursor: help;
		transition: color 150ms;
	}

	.style-info-trigger:hover {
		color: var(--accent-primary);
	}

	.style-info-trigger .material-icons-outlined {
		font-size: 14px;
		line-height: 1;
		pointer-events: none;
	}

	.style-description-tooltip {
		position: fixed;
		width: fit-content;
		max-width: min(16rem, calc(100vw - 1rem));
		margin: 0;
		padding: 0.65rem 0.75rem;
		border: 1px solid color-mix(in srgb, var(--border-color) 75%, var(--accent-primary) 25%);
		border-radius: 0.7rem;
		background: color-mix(in srgb, var(--bg-secondary) 94%, black);
		box-shadow:
			0 14px 32px rgb(0 0 0 / 30%),
			0 2px 8px rgb(0 0 0 / 18%);
		color: var(--text-primary);
		font-size: 0.75rem;
		line-height: 1.4;
		text-align: start;
		pointer-events: none;
		backdrop-filter: blur(12px);
	}
</style>
