<script lang="ts">
	import { globalState } from '$lib/runes/main.svelte';
	import { onDestroy, onMount } from 'svelte';
	import { slide } from 'svelte/transition';
	import type { Style, StyleName } from '$lib/classes/VideoStyle.svelte';
	import type { CustomClip } from '$lib/classes/Clip.svelte';
	import { default as StyleComponent } from '$lib/components/projectEditor/tabs/styleEditor/Style.svelte';
	import toast from 'svelte-5-french-toast';
	import LL from '$lib/i18n/i18n-svelte';
	import { get } from 'svelte/store';
	import { getStyleName, getStyleDescription } from '$lib/i18n/styleMapper';
	import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
	import AyahImageControl from './controls/AyahImageControl.svelte';
	import BracketsFontControl from './controls/BracketsFontControl.svelte';
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
	import { asDimensionValue, asFadeValue, hasFadeEnabled, msToTimeValue } from './controls/utils';

	const LL_ = get(LL);

	/**
	 * Lit une microcopie ajoutée au dictionnaire de style en attendant la génération i18n du hook.
	 * @param {'mixedValue' | 'localOverride'} key Clé de microcopie à résoudre.
	 * @returns {string} Texte localisé.
	 */
	function getStyleUiCopy(key: 'mixedValue' | 'localOverride'): string {
		return (get(LL).style as unknown as Record<'mixedValue' | 'localOverride', () => string>)[
			key
		]();
	}

	let {
		style,
		target,
		disabled,
		showControl = false,
		headerControl = false,
		applyValueSimple
	}: {
		style: Style;
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

	function getEffectiveForSelection(): {
		value: unknown;
		mixed: boolean;
		overridden: boolean;
	} {
		if (!target) return { value: style.value, mixed: false, overridden: false };

		if (selectedClipIds().length === 0) {
			return { value: style.value, mixed: false, overridden: false };
		}

		const values = selectedClipIds().map((id) =>
			globalState.getVideoStyle
				.getStylesOfTarget(target)
				.getEffectiveValue(style.id as StyleName, id)
		);
		const first = values[0];
		const mixed = values.some((v) => String(v) !== String(first));
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

	let inputValue: StyleValue = $state(style.value);
	$effect(() => {
		const eff = getEffectiveForSelection();
		inputValue = eff.value as StyleValue;
	});

	function coerce(val: unknown): StyleValue {
		if (style.valueType === 'number') return Number(val);
		if (style.valueType === 'boolean') return Boolean(val);
		if (style.valueType === 'dimension') return asDimensionValue(val);
		if (style.valueType === 'fade') return asFadeValue(val);
		return val as StyleValue;
	}

	function applyValue(v: unknown) {
		ProjectHistoryManager.begin('set style value');
		try {
			const value = coerce(v);
			if (selectedClipIds().length > 0) {
				if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
					globalState.getVideoStyle
						.getStylesOfTarget(target!)
						.setStyleForClips(selectedClipIds(), style.id as StyleName, value);
				} else {
					applyValueSimple(value);
				}
			} else {
				applyValueSimple(value);
			}

			// Déclenche un refresh éventuel (ex: max-height fit)
			if (
				style.id === 'max-height' ||
				style.id === 'max-line' ||
				style.id === 'font-size' ||
				style.id === 'word-spacing' ||
				style.id === 'font-family'
			) {
				globalState.updateVideoPreviewUI();
			}
		} finally {
			ProjectHistoryManager.commit();
		}
	}

	function applySelectValue(value: string) {
		ProjectHistoryManager.begin('set select style');
		try {
			// Style global arabe (non-overridable): choix du mushaf
			if (target === 'arabic' && style.id === 'mushaf-style') {
				const arabicStyles = globalState.getVideoStyle.getStylesOfTarget('arabic');
				arabicStyles.setStyle('mushaf-style', value);

				if (value === 'Indopak') {
					arabicStyles.setStyle('font-family', 'IndoPak');
				} else if (value === 'Tajweed') {
					arabicStyles.setStyle('font-family', 'QPC2');
					toast(get(LL).editor.tajweedFontWarning());
				} else if (value === 'Soosi') {
					arabicStyles.setStyle('font-family', 'Soosi');
				} else {
					arabicStyles.setStyle('font-family', 'Hafs');
				}

				globalState.updateVideoPreviewUI();
				return;
			}

			// Si l'utilisateur choisit explicitement la police IndoPak, synchroniser le style mushaf.
			if (target === 'arabic' && style.id === 'font-family' && selectedClipIds().length === 0) {
				const arabicStyles = globalState.getVideoStyle.getStylesOfTarget('arabic');
				if (value === 'IndoPak') {
					arabicStyles.setStyle('mushaf-style', 'Indopak');
				} else if (value === 'Soosi') {
					arabicStyles.setStyle('mushaf-style', 'Soosi');
				} else if (
					arabicStyles.findStyle('mushaf-style')?.value === 'Tajweed' &&
					value !== 'QPC2'
				) {
					arabicStyles.setStyle('mushaf-style', 'Uthmani');
				}
			}

			applyValue(value);
		} finally {
			ProjectHistoryManager.commit();
		}
	}

	/**
	 * Efface les styles différents de son parent appliqués aux clips sélectionnés
	 */
	function clearOverride() {
		if (selectedClipIds().length === 0) return;
		globalState.getVideoStyle.getStylesOfTarget(target!).clearStyleForClips(
			selectedClipIds(),

			style.id as StyleName
		);
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
			const dimension = asDimensionValue(style.value);
			return dimension.width + 'x' + dimension.height;
		} else if (style.valueType === 'fade') {
			const fadeValue = asFadeValue(style.value);
			return `${hasFadeEnabled(fadeValue) ? LL_.common.enabled() + ' - ' + fadeValue.fadeDurationMs + LL_.common.ms() : LL_.common.disabled()}`;
		} else if (style.valueType === 'ayah-image') {
			return style.value ? String(style.value) : LL_.common.none();
		} else return String(style.value);
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
			title={showControl ? getStyleDescription(style.id, get(LL)) : undefined}
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
			</div>
			{#key selectedClipIds().length + String(inputValue)}
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
								<span style={getHeaderPreviewStyle()}>{getEffectiveForSelection().value}</span>
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
				</div>
			{/key}
		</div>

		{#if (extended || showControl) && style.valueType !== 'boolean'}
			<div class={showControl ? 'style-control-direct-body' : 'my-2 px-2'} transition:slide>
				{#if !showControl || ['dimension', 'fade', 'composite', 'ayah-image', 'file', 'reciter'].includes(style.valueType)}
					<p class="text-xs text-secondary mb-2 flex items-center gap-1">
						<span class="material-icons-outlined text-[12px]">info</span>
						{getStyleDescription(style.id, get(LL))}
					</p>
				{/if}

				<!-- Modificateur de valeur -->
				{#if style.valueType === 'number'}
					<NumberControl {style} value={inputValue} onChange={applyValue} />
				{:else if style.valueType === 'color'}
					<ColorControl value={inputValue} onChange={applyValue} />
				{:else if style.id === 'font-family'}
					<FontFamilyControl value={inputValue} onChange={applySelectValue} />
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
</style>
