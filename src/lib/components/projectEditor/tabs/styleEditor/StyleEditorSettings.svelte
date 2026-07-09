<script lang="ts">
	import { globalState } from '$lib/runes/main.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { onMount } from 'svelte';
	import Section from '../../Section.svelte';
	import StyleComponent from './Style.svelte';
	import PresetLibrary from './presets/components/PresetLibrary.svelte';
	import { slide } from 'svelte/transition';
	import { CustomTextClip } from '$lib/classes';
	import {
		ClipWithTranslation,
		CustomImageClip,
		type VisualMergeMode
	} from '$lib/classes/Clip.svelte';
	import { VerseTranslation } from '$lib/classes/Translation.svelte';
	import ModalManager from '$lib/components/modals/ModalManager';
	import {
		canMergeArabicVisualModes,
		getActiveVisualMergeGroupId,
		getActiveVisualMergeMode
	} from './visualMergeStyleUtils';
	import { getStyleName, getStyleDescription } from '$lib/i18n/styleMapper';
	import { get } from 'svelte/store';
	import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';

	let {
		presetLibraryOpen,
		openPresetLibrary,
		closePresetLibrary
	}: {
		presetLibraryOpen: boolean;
		openPresetLibrary: () => void;
		closePresetLibrary: () => void;
	} = $props();

	const getCategoriesToDisplay = $derived(() => {
		const target = globalState.getStylesState.getCurrentSelection();
		const categories = globalState.getVideoStyle.getStylesOfTarget(target).categories;

		// Quand des clips vidéo sont sélectionnés dans l'onglet Style,
		// on n'affiche que la catégorie Overlay côté global.
		if (target === 'global' && globalState.getStylesState.selectedVideos.length > 0) {
			return categories.filter((category) => category.id === 'overlay');
		}

		return categories;
	});

	const hasWordByWordTimestamps = $derived(() =>
		globalState.getSubtitleTrack.hasWordByWordTimestamps()
	);

	const currentStyleTarget = $derived(() => globalState.getStylesState.getCurrentSelection());
	const styleSearchQuery = $derived(() =>
		globalState.getStylesState.searchQuery.toLowerCase().trim()
	);

	let stylesContainer: HTMLDivElement | undefined = $state();
	let styleSearchLabelCache = new Map<string, string>();

	const visualMergeSelection = $derived(() =>
		globalState.getSubtitleTrack.getVisualMergeSelection(
			globalState.getStylesState.selectedSubtitles
		)
	);

	const activeVisualMergeMode = $derived(() => {
		return getActiveVisualMergeMode(
			globalState.getStylesState.selectedSubtitles,
			globalState.getSubtitleTrack
		);
	});

	const activeVisualMergeGroupId = $derived(() => {
		return getActiveVisualMergeGroupId(
			globalState.getStylesState.selectedSubtitles,
			activeVisualMergeMode()
		);
	});

	const canMergeArabicModes = $derived(() => {
		return canMergeArabicVisualModes(visualMergeSelection(), globalState.getSubtitleTrack);
	});

	onMount(async () => {
		// Assure la présence des nouveaux styles ajoutés par les updates.
		await ProjectHistoryManager.ignoreAsync(() =>
			globalState.getVideoStyle.ensureStylesSchemaUpToDate()
		);

		stylesContainer!.scrollTop =
			globalState.currentProject!.projectEditorState.stylesEditor.scrollPosition;

		// S'il manque des styles à une traduction, on les ajoute
		for (const translation of globalState.getProjectTranslation.addedTranslationEditions) {
			if (globalState.getVideoStyle.doesTargetStyleExist(translation.name)) continue;

			await globalState.getVideoStyle.addStylesForEdition(translation.name);
		}
	});

	/**
	 * Sélectionne la première traduction disponible si la sélection courante est vide ou invalide.
	 * @returns {void}
	 */
	function ensureCurrentTranslationSelection(): void {
		const translations = globalState.getProjectTranslation.addedTranslationEditions;
		if (translations.length === 0) return;

		const currentTranslation = globalState.getStylesState.currentSelectionTranslation;
		if (translations.some((translation) => translation.name === currentTranslation)) return;

		globalState.getStylesState.currentSelectionTranslation = translations[0].name;
	}

	function clearSearch() {
		globalState.getStylesState.searchQuery = '';
	}

	/**
	 * Retourne le libellé localisé normalisé d'un style ou d'une catégorie.
	 * @param {string} id Identifiant de style ou catégorie.
	 * @returns {string} Libellé normalisé pour la recherche.
	 */
	function getCachedSearchLabel(id: string): string {
		const cached = styleSearchLabelCache.get(id);
		if (cached !== undefined) return cached;

		const label = getStyleName(id, get(LL)).toLowerCase();
		styleSearchLabelCache.set(id, label);
		return label;
	}

	/**
	 * Vérifie si un style ou sa catégorie correspond à la recherche courante.
	 * @param {{ id: string; name: string }} style Style évalué.
	 * @param {{ id: string; name: string }} category Catégorie optionnelle du style.
	 * @returns {boolean} `true` si le style doit être affiché.
	 */
	function matchesStyleSearch(
		style: { id: string; name: string },
		category?: { id: string; name: string }
	): boolean {
		const query = styleSearchQuery();
		if (query === '') return true;

		return (
			style.name.toLowerCase().includes(query) ||
			getCachedSearchLabel(style.id).includes(query) ||
			(category?.name.toLowerCase().includes(query) ?? false) ||
			(category ? getCachedSearchLabel(category.id).includes(query) : false)
		);
	}

	/**
	 * Applique un merge visuel sur la sélection courante.
	 * @param {VisualMergeMode} mode Mode de merge choisi.
	 * @returns {void}
	 */
	function applyVisualMerge(mode: VisualMergeMode): void {
		globalState.getSubtitleTrack.applyVisualMerge(
			globalState.getStylesState.selectedSubtitles,
			mode
		);
	}

	/**
	 * Retourne la classe du bouton de merge selon le mode actif.
	 * @param {VisualMergeMode} mode Mode représenté par le bouton.
	 * @returns {string} Classes CSS à appliquer.
	 */
	function getMergeButtonClass(mode: VisualMergeMode): string {
		return (
			'py-1.5 2xl:text-sm text-xs 2xl:px-2 ' +
			(activeVisualMergeMode() === mode ? 'btn-accent' : 'btn')
		);
	}

	/**
	 * Retire le merge visuel du groupe actuellement sélectionné.
	 * @returns {void}
	 */
	function unmergeSelectedVisualGroup(): void {
		const groupId = activeVisualMergeGroupId();
		if (!groupId) return;
		globalState.getSubtitleTrack.unmergeVisualGroup(groupId);
	}

	/**
	 * Ouvre la librairie de presets de style.
	 */
	function toggleImportExportMenu() {
		openPresetLibrary();
	}

	/**
	 * Désactive les styles de timing (appearance/disappearance) des overlays globaux
	 * lorsque leur style always-show vaut `true`.
	 */
	function isGlobalTimedOverlayStyleDisabled(categoryId: string, styleId: string): boolean {
		const alwaysShowStyleId =
			categoryId === 'surah-name'
				? 'surah-name-always-show'
				: categoryId === 'reciter-name'
					? 'reciter-name-always-show'
					: categoryId === 'ayah-container'
						? 'always-show'
						: null;

		const isTimingStyle =
			(categoryId === 'surah-name' &&
				(styleId === 'surah-name-time-appearance' ||
					styleId === 'surah-name-time-disappearance')) ||
			(categoryId === 'reciter-name' &&
				(styleId === 'reciter-name-time-appearance' ||
					styleId === 'reciter-name-time-disappearance')) ||
			(categoryId === 'ayah-container' &&
				(styleId === 'time-appearance' || styleId === 'time-disappearance'));

		if (!alwaysShowStyleId || !isTimingStyle) return false;
		return Boolean(globalState.getStyle('global', alwaysShowStyleId).value);
	}

	/**
	 * Désactive certains styles WBW selon leurs toggles parents, sans bloquer toute la catégorie.
	 * @param {string} categoryId Identifiant de la catégorie courante.
	 * @param {string} styleId Identifiant du style courant.
	 * @returns {boolean} true si le style doit être désactivé.
	 */
	function isWordByWordStyleDisabled(categoryId: string, styleId: string): boolean {
		if (categoryId !== 'word-by-word-highlight') return false;
		const target = currentStyleTarget();
		const showCurrentWordOnly = Boolean(
			globalState.getStyle(target, 'wbw-show-current-word-only')?.value
		);

		if (
			showCurrentWordOnly &&
			styleId !== 'wbw-show-current-word-only' &&
			styleId !== 'wbw-current-word-custom-css' &&
			styleId !== 'enable-wbw-current-word-opacity' &&
			styleId !== 'wbw-current-word-opacity'
		)
			return true;

		if (styleId === 'wbw-current-word-opacity') {
			return !Boolean(globalState.getStyle(target, 'enable-wbw-current-word-opacity')?.value);
		}

		if (styleId === 'wbw-color' || styleId === 'wbw-persist-color') {
			return !Boolean(globalState.getStyle(target, 'enable-wbw-highlight')?.value);
		}

		if (styleId === 'wbw-bg-color') {
			return !Boolean(globalState.getStyle(target, 'enable-wbw-background')?.value);
		}

		if (styleId === 'wbw-underline-thickness') {
			return !Boolean(globalState.getStyle(target, 'enable-wbw-underline')?.value);
		}

		if (styleId === 'wbw-glow-color' || styleId === 'wbw-glow-blur') {
			return !Boolean(globalState.getStyle(target, 'enable-wbw-glow')?.value);
		}

		return false;
	}

	/**
	 * Indique si la traduction sélectionnée possède au moins un mapping WBW.
	 *
	 * @returns {boolean} `true` si une range WBW existe pour cette édition.
	 */
	function hasTranslationWbwMappings(): boolean {
		const target = currentStyleTarget();
		if (target === 'global' || target === 'arabic') return false;

		return globalState.getSubtitleTrack.clips.some((clip) => {
			if (!(clip instanceof ClipWithTranslation)) return false;
			const translation = clip.translations?.[target];
			return translation instanceof VerseTranslation && (translation.wbwRanges?.length ?? 0) > 0;
		});
	}

	/**
	 * Indique si un hint WBW doit être affiché pour la cible courante.
	 *
	 * @returns {'arabic' | 'translation' | null} Type de hint à afficher.
	 */
	function getWordByWordHintTarget(): 'arabic' | 'translation' | null {
		const target = currentStyleTarget();
		if (target === 'arabic' && !hasWordByWordTimestamps()) return 'arabic';
		if (target !== 'global' && target !== 'arabic' && !hasTranslationWbwMappings()) {
			return 'translation';
		}
		return null;
	}

	$effect(() => {
		const _ = globalState.getStylesState.scrollAndHighlight;

		if (_) {
			// Scroll to the highlighted category
			const category = globalState.getStylesState.scrollAndHighlight;
			const element = stylesContainer!.querySelector(`[data-category="${category}"]`);
			if (element) {
				element.scrollIntoView({ behavior: 'smooth', block: 'start' });
				// Le met en jaune pendant 2 secondes
				element.classList.add('highlight');
				setTimeout(() => {
					element.classList.remove('highlight');
				}, 2000);
			}

			globalState.getStylesState.scrollAndHighlight = null;
		}
	});

	$effect(() => {
		if (globalState.getStylesState.currentSelection !== 'translation') return;

		ensureCurrentTranslationSelection();
	});
</script>

<div
	class="bg-secondary h-full border border-color mx-0.5 rounded-xl relative flex flex-col shadow"
>
	{#if presetLibraryOpen}
		<PresetLibrary onBack={closePresetLibrary} />
	{:else}
		<!-- En-tête avec icône -->
		<div class="flex gap-x-2 items-center px-3 mb-2 mt-4 style-editor-header-row">
			<span class="material-icons-outlined text-accent text-2xl">auto_fix_high</span>
			<h2 class="text-xl font-semibold text-primary tracking-wide">{$LL.style.styleEditor()}</h2>

			<div class="relative ml-auto">
				<button
					class="import-export-button style-presets-button btn-accent flex flex-row items-center px-2 py-1 gap-x-2 text-sm"
					onclick={toggleImportExportMenu}
					title={$LL.editor.saveStylesTooltip()}
				>
					<div class="flex flex-col">
						<span class="material-icons-outlined text-[22px]!">style</span>
						<span class="material-icons-outlined text-[22px]!">public</span>
					</div>
					<span class="flex flex-col items-start leading-none">
						<span class="font-bold">{$LL.editor.presetsLabel()}</span>
						<span class="text-[10px] font-medium opacity-85 text-left"
							>{$LL.editor.saveStylesCommunityPresets()}</span
						>
					</span>
				</button>
			</div>
		</div>

		<div
			class="flex flex-col px-3 py-3 bg-[var(--bg-primary)]/60 border border-b-0 rounded-b-none border-[var(--border-color)]/50 rounded-xl gap-y-2 style-editor-top-controls"
		>
			<p class="text-sm text-secondary style-editor-target-label">{$LL.editor.chooseTarget()}</p>
			<div data-tour-id="style-subtabs" class="w-full grid grid-cols-3 gap-2">
				{#each ['global', 'arabic', 'translation'] as selection (selection)}
					<button
						onclick={() => {
							globalState.getStylesState.currentSelection = selection as
								| 'global'
								| 'arabic'
								| 'translation';
						}}
						class={'py-1.5 px-2 rounded-lg flex items-center justify-center gap-1  ' +
							(globalState.getStylesState.currentSelection === selection
								? 'btn-accent ring-1 ring-white/20'
								: 'btn hover:ring-1 hover:ring-white/10')}
						aria-pressed={globalState.getStylesState.currentSelection === selection}
						title={selection === 'arabic'
							? $LL.editor.arabic()
							: selection === 'translation'
								? $LL.editor.translation()
								: $LL.editor.global()}
					>
						{#if selection === 'arabic'}
							{$LL.editor.arabic()}
						{:else if selection === 'translation'}
							{$LL.editor.translation()}
						{:else}
							{$LL.editor.global()}
						{/if}
					</button>
				{/each}
			</div>

			{#if globalState.getStylesState.currentSelection === 'translation'}
				{#if globalState.getProjectTranslation.addedTranslationEditions.length > 0}
					<div class="flex items-center gap-2 mt-1">
						<span class="material-icons-outlined text-secondary text-sm"> translate </span>
						<select
							class="flex-1"
							bind:value={globalState.getStylesState.currentSelectionTranslation}
							transition:slide
							title={$LL.editor.selectTranslation()}
						>
							{#each globalState.getProjectTranslation.addedTranslationEditions as translation (translation.name)}
								<option value={translation.name}>{translation.author}</option>
							{/each}
						</select>
					</div>
				{:else}
					<p class="text-secondary text-sm mt-1 text-center">{$LL.editor.noTranslationsYet()}</p>
				{/if}
			{/if}

			<!-- search bar -->
			<div class="mt-1">
				<div class="relative">
					<span
						class="material-icons-outlined absolute left-2 top-1/2 -translate-y-1/2 text-secondary text-sm"
						>search</span
					>
					<input
						type="text"
						placeholder={$LL.style.searchStyles()}
						class="w-full pl-10! pr-8 py-1.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] focus:ring-1 focus:ring-white/20"
						bind:value={globalState.getStylesState.searchQuery}
					/>
					{#if globalState.getStylesState.searchQuery}
						<button
							title={$LL.editor.clearSearch()}
							onclick={clearSearch}
							class="absolute right-2 top-1/2 -translate-y-1/2 text-secondary hover:text-primary"
						>
							<span class="material-icons-outlined text-sm">close</span>
						</button>
					{/if}
				</div>
			</div>

			<!-- Clips actuellement sélectionnés -->
			{#if globalState.getStylesState.selectedSubtitles.length > 0}
				<div
					class="mt-2 flex items-center justify-between bg-white/5 border border-[var(--border-color)] rounded-lg px-2 py-1"
				>
					<div class="flex items-center gap-2 text-secondary text-sm">
						<span class="material-icons-outlined text-base">select_all</span>
						<span class="style-selection-count-label">
							{$LL.editor.subtitlesSelected({
								count: globalState.getStylesState.selectedSubtitles.length,
								plural: globalState.getStylesState.selectedSubtitles.length > 1 ? 's' : ''
							})}
						</span>
					</div>
					<button
						class="btn px-2 py-1 rounded-md flex items-center gap-1"
						onclick={() => {
							globalState.getStylesState.clearSelection();
						}}
						title={$LL.editor.clearSelection()}
					>
						<span class="material-icons-outlined text-sm">backspace</span>
						<span class="text-sm">{$LL.common.clear()}</span>
					</button>
				</div>

				{#if visualMergeSelection() && canMergeArabicModes()}
					<div class="rounded-lg border border-emerald-400/30 bg-emerald-500/8 px-3 py-2">
						<div class="flex items-start gap-2 text-sm text-[var(--text-primary)]">
							<span class="material-icons-outlined text-base mt-0.5">merge_type</span>
							<div class="flex-1">
								<p class="font-medium">{$LL.editor.visualMerge()}</p>
								<p class="mt-0.5 text-xs leading-relaxed text-secondary visual-merge-description">
									{$LL.editor.visualMergeDescription()}
								</p>
							</div>
						</div>

						<div class="mt-2 grid grid-cols-3 gap-2">
							<button
								data-testid="Merge Arabic"
								class={getMergeButtonClass('arabic')}
								onclick={() => applyVisualMerge('arabic')}
							>
								{$LL.editor.arabic()}
							</button>
							<button
								data-testid="Merge Translation"
								class={getMergeButtonClass('translation')}
								onclick={() => applyVisualMerge('translation')}
							>
								{$LL.editor.translation()}
							</button>
							<button
								data-testid="Merge Both"
								class={getMergeButtonClass('both')}
								onclick={() => applyVisualMerge('both')}
							>
								{$LL.editor.both()}
							</button>
						</div>

						{#if activeVisualMergeGroupId()}
							<button
								class="btn mt-2 w-full py-1.5 2xl:text-sm text-xs"
								onclick={unmergeSelectedVisualGroup}
							>
								{$LL.editor.unmergeGroup()}
							</button>
						{/if}
					</div>
				{/if}
			{/if}

			{#if globalState.getStylesState.selectedVideos.length > 0}
				<div
					class="mt-2 flex items-center justify-between bg-white/5 border border-[var(--border-color)] rounded-lg px-2 py-1"
				>
					<div class="flex items-center gap-2 text-secondary text-sm">
						<span class="material-icons-outlined text-base">movie</span>
						<span class="style-selection-count-label">
							{$LL.editor.videoClipsSelected({
								count: globalState.getStylesState.selectedVideos.length,
								plural: globalState.getStylesState.selectedVideos.length > 1 ? 's' : ''
							})}
						</span>
					</div>
					<button
						class="btn px-2 py-1 rounded-md flex items-center gap-1"
						onclick={() => {
							globalState.getStylesState.clearSelection();
						}}
						title={$LL.editor.clearSelection()}
					>
						<span class="material-icons-outlined text-sm">backspace</span>
						<span class="text-sm">{$LL.common.clear()}</span>
					</button>
				</div>
			{/if}

			{#if globalState.getStylesState.selectedSubtitles.length <= 1}
				<div
					class="mt-2 flex items-start gap-2 rounded-lg border border-sky-400/35 bg-sky-500/8 px-2 py-1.5 text-[var(--text-primary)] style-selection-hint-box"
				>
					<span class="material-icons-outlined text-base mt-0.5">info</span>
					<p class="text-xs leading-relaxed style-selection-hint-label">
						{$LL.editor.clickToSelect()}
					</p>
				</div>
			{/if}
		</div>
		<div
			class="flex flex-col gap-y-2 px-1 bg-[var(--bg-primary)]/60 rounded-xl border border-[var(--border-color)]/50 overflow-y-auto pb-10 rounded-t-none border-t-2 flex-1 py-1"
			bind:this={stylesContainer}
			onscroll={(_e) => {
				globalState.currentProject!.projectEditorState.stylesEditor.scrollPosition =
					stylesContainer?.scrollTop || 0;
			}}
		>
			{#if globalState.getStylesState.getCurrentSelection() === 'global' && globalState.getStylesState.selectedSubtitles.length > 0}
				<div
					class="mt-4 flex items-start gap-2 bg-amber-500/10 border border-amber-400/40 rounded-lg px-3 py-2 text-amber-200"
				>
					<span class="material-icons-outlined text-base mt-0.5">info</span>
					<p class="text-sm">
						{$LL.editor.cannotEditGlobalWithSelection()}
					</p>
				</div>
			{:else}
				{#each getCategoriesToDisplay() as category (category.id)}
					<Section
						name={getStyleName(category.id, get(LL)) || category.name}
						icon={category.icon}
						contentClasses="border-x border-b border-[var(--border-color)] rounded-b-lg -mt-1 pt-1"
						classes="-mb-1 bg-white/10 pl-0.5 rounded-t-lg"
						dataCategory={globalState.getStylesState.currentSelection === 'translation'
							? globalState.getStylesState.currentSelectionTranslation
							: category.id}
					>
						{#if category.id === 'background'}
							<div
								class="mx-2 mb-2 flex items-start gap-2 rounded-md border border-sky-400/35 bg-sky-500/8 px-2 py-1.5 translate-y-1.5 text-[var(--text-primary)]"
							>
								<span
									class="material-icons-outlined text-sm mt-0.5"
									title={$LL.editor.backgroundVisibilityHint()}>info</span
								>
								<p class="text-xs leading-relaxed">
									{$LL.editor.backgroundVisibilityHint()}
								</p>
							</div>
						{/if}

						{#if category.id === 'word-by-word-highlight' && getWordByWordHintTarget()}
							<div
								class="mx-2 mb-2 translate-y-1.5 rounded-md border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-amber-100"
							>
								<div class="flex items-start gap-2">
									<span class="material-icons-outlined text-sm mt-0.5">info</span>
									<div class="min-w-0">
										{#if getWordByWordHintTarget() === 'translation'}
											<p class="text-xs leading-relaxed">
												{$LL.style.translationWbwMissingMappingInfo()}
											</p>
										{:else}
											<p class="text-xs leading-relaxed">
												{$LL.style.wbwMissingInfo()}
											</p>
											<p class="mt-1 text-xs leading-relaxed">
												{$LL.style.wbwStep1()}
											</p>
											<p class="mt-1 text-xs leading-relaxed">
												{$LL.style.wbwStep2()}
											</p>
										{/if}
									</div>
								</div>
							</div>
						{/if}

						{#each category.styles as style (style.id)}
							{#if matchesStyleSearch(style, category)}
								<!-- 
							Cas spécial : on ne peut pas avoir de séparateur entre le numéro de verset et le verset
							pour le texte Coranique, ni changer sa position. Empêche donc l'affichage de ces styles dans ce cas précis.
							
							Deuxième cas spécial : on ne veut pas pouvoir individuellement modifier les styles suivants:
								- show-subtitles
								- show-verse-number
								- show-decorative-brackets
								- mushaf-style
								- text-direction
								- decorative-brackets-font-family
								- verse-number-format
								- verse-number-position
								- max-height
								- max-line
							Empêche donc l'affichage de ces deux styles si on a une sélection de sous-titre en cours.

							Troisième cas :
							On empêche l'affichage du style "reactive-font-size" et "reactive-y-position" qui sont des styles utilitaire censé être non-visible. 

							Quatrième cas :
							On empêche la modification du font-family style pour les mushafs qui imposent une police spécifique.
								  -->
								{#if !(globalState.getStylesState.currentSelection === 'arabic' && (style.id === 'verse-number-format' || style.id === 'verse-number-position' || style.id === 'verse-number-numeral-system' || style.id === 'text-direction')) && !(style.id === 'show-decorative-brackets' && globalState.getStylesState.currentSelection !== 'arabic') && !(style.id === 'decorative-brackets-font-family' && globalState.getStylesState.currentSelection !== 'arabic') && !(style.id === 'mushaf-style' && globalState.getStylesState.currentSelection !== 'arabic') && !(globalState.getStylesState.currentSelection === 'arabic' && style.id === 'font-family' && !['Uthmani', 'Minimal Quran'].includes(String(globalState.getStyle('arabic', 'mushaf-style')?.value))) && !(style.id === 'decorative-brackets-font-family' && !globalState.getStyle('arabic', 'show-decorative-brackets').value) && !(globalState.getStylesState.selectedSubtitles.length > 0 && (style.id === 'show-subtitles' || style.id === 'show-verse-number' || style.id === 'show-decorative-brackets' || style.id === 'mushaf-style' || style.id === 'decorative-brackets-font-family' || style.id === 'verse-number-format' || style.id === 'max-height' || style.id === 'max-line' || style.id === 'verse-number-position' || style.id === 'verse-number-numeral-system' || style.id === 'text-direction')) && !(category.id === 'word-by-word-highlight' && (style.id === 'wbw-always-show-verse-number' || style.id === 'wbw-show-current-word-only') && globalState.getStylesState.currentSelection !== 'arabic') && style.id !== 'reactive-font-size' && style.id !== 'reactive-y-position'}
									<!-- On veut désactiver certains style, comme par exemple
							 - Si on a le style "Always Show" pour les customs text d'enable, alors on disable les styles permettant
							 de set les propriétés de temps de début d'affichage et de fin d'affichage -->
									{@const toDisable =
										(category.id.includes('custom-text') &&
											category.getStyle('always-show')?.value &&
											(style.id === 'time-appearance' || style.id === 'time-disappearance')) ||
										(category.id === 'background' &&
											category.getStyle('always-show')?.value &&
											(style.id === 'time-appearance' || style.id === 'time-disappearance')) ||
										isGlobalTimedOverlayStyleDisabled(category.id, style.id) ||
										isWordByWordStyleDisabled(category.id, style.id) ||
										(category.id === 'word-by-word-highlight' &&
											!category.getStyle('wbw-reveal-on-recitation')?.value &&
											style.id === 'wbw-always-show-verse-number')}
									<!-- Si la recherche est vide ou si le nom du style correspond à la requête de recherche -->
									<StyleComponent
										{style}
										target={globalState.getStylesState.getCurrentSelection()}
										disabled={toDisable as boolean}
										applyValueSimple={(v) => {
											style.value = v as typeof style.value;
										}}
									/>
								{/if}
							{/if}
						{/each}

						{#if category.id === 'general' && globalState.getStylesState.currentSelection === 'global' && styleSearchQuery() === ''}
							<div class="mx-2 border-t border-color py-2">
								<div class="flex items-start justify-between gap-3">
									<div class="min-w-0">
										<div class="flex flex-row justify-between items-center">
											<p class="text-sm font-medium text-primary">{$LL.style.hifzMode()}</p>
											<button
												type="button"
												class="btn py-1 px-2 text-sm"
												onclick={() => {
													void ModalManager.hifzRepetitionModal();
												}}
											>
												{$LL.style.enableHifzMode()}
											</button>
										</div>
										<p class="text-xs leading-relaxed text-secondary mt-1 italic">
											{$LL.style.createMemorizationVideos()}
										</p>
									</div>
								</div>
							</div>
						{/if}
					</Section>
				{/each}

				<!-- Ajoute maintenant les customs texts -->
				{#if globalState.getStylesState.currentSelection === 'global' && globalState.getStylesState.selectedVideos.length === 0}
					{#each globalState.getCustomClipTrack.clips as customTextClip (customTextClip.id)}
						{@const category = (customTextClip as CustomTextClip).category!}
						<Section
							name={getStyleName(category.id, get(LL)) || category.name}
							icon={category.icon}
							contentClasses="border-x border-b border-[var(--border-color)] rounded-b-lg -mt-1 pt-1"
							classes="-mb-1 bg-white/10 pl-0.5 rounded-t-lg"
						>
							{#snippet headerActions()}
								<button
									type="button"
									class="flex items-center justify-center size-8 text-secondary hover:text-danger-color rounded"
									title={customTextClip instanceof CustomImageClip
										? ((
												$LL.editor as typeof $LL.editor & { removeCustomImage?: () => string }
											).removeCustomImage?.() ??
											`${$LL.common.remove()} ${$LL.editor.customImage()}`)
										: $LL.editor.removeCustomText()}
									aria-label={customTextClip instanceof CustomImageClip
										? ((
												$LL.editor as typeof $LL.editor & { removeCustomImage?: () => string }
											).removeCustomImage?.() ??
											`${$LL.common.remove()} ${$LL.editor.customImage()}`)
										: $LL.editor.removeCustomText()}
									onclick={(event) => {
										event.stopPropagation();
										globalState.getCustomClipTrack.removeClip(Number(customTextClip.id));
									}}
								>
									<span class="material-icons-outlined text-base">delete_outline</span>
								</button>
							{/snippet}
							{#each category.styles as style (style.id)}
								{#if matchesStyleSearch(style)}
									{@const toDisable =
										category.getStyle('always-show')!.value &&
										(style.id === 'time-appearance' || style.id === 'time-disappearance')}

									<!-- prettier-ignore -->
									<StyleComponent
								{style}
								applyValueSimple={(v) => {
									const targetCustomClip = globalState.getCustomClipTrack.getCustomClipWithId(
										category.id
									);
									if (!targetCustomClip) {
										style.value = v as typeof style.value;
										return;
									}

									// Harmonise begin/end pour éviter un état clip/style incoherent.
									if (style.id === 'time-appearance' && typeof v === 'number') {
										const endStyle = category.getStyle('time-disappearance');
										const currentEnd = Number(endStyle?.value ?? 0);

										if (v > currentEnd) {
											const endFallback = v + 3000;
											if (endStyle) endStyle.value = endFallback;
											targetCustomClip.setEndTime(endFallback);
										}

										targetCustomClip.setStartTime(v);
										style.value = v as typeof style.value;
										return;
									}

									if (style.id === 'time-disappearance' && typeof v === 'number') {
										const beginStyle = category.getStyle('time-appearance');
										const currentBegin = Number(beginStyle?.value ?? 0);

										if (v < currentBegin) {
											const endFallback = v + 3000;
											if (beginStyle) beginStyle.value = v;
											targetCustomClip.setStartTime(v);
											targetCustomClip.setEndTime(endFallback);
											style.value = endFallback as typeof style.value;
											return;
										}

										targetCustomClip.setEndTime(v);
										style.value = v as typeof style.value;
										return;
									}

									style.value = v as typeof style.value;
								}}
								disabled={toDisable as boolean}
							/>
								{/if}
							{/each}
						</Section>
					{/each}
				{/if}
			{/if}

			{#if globalState.getStylesState.getCurrentSelection() === 'global' && globalState.getStylesState.selectedVideos.length === 0}
				<div class="grid grid-cols-2 mb-20 gap-x-1.5 mt-4 pr-2">
					<!-- Bouton pour ajouter un texte custom -->
					<button
						class="btn-accent mx-auto px-2 py-2 rounded-md flex items-center justify-center gap-1"
						onclick={async () => {
							await globalState.getVideoStyle.addCustomClip('text');
						}}
						title={$LL.editor.addCustomText()}
					>
						<span class="material-icons-outlined text-sm">add</span>
						{$LL.editor.customText()}
					</button>
					<!-- Bouton pour ajouter un texte custom -->
					<button
						class="btn-accent mx-auto px-2 py-2 rounded-md flex items-center justify-center gap-1"
						onclick={async () => {
							await globalState.getVideoStyle.addCustomClip('image');
						}}
						title={$LL.editor.addCustomText()}
					>
						<span class="material-icons-outlined text-sm">add</span>
						{$LL.editor.customImage()}
					</button>
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	@media (max-width: 1440px) {
		.style-selection-count-label,
		.style-selection-hint-label {
			font-size: 0.625rem;
			line-height: 1.1;
		}
	}

	.style-presets-button {
		box-shadow:
			0 0 0 2px color-mix(in srgb, var(--accent-primary) 35%, transparent),
			0 8px 18px rgb(0 0 0 / 24%);
	}

	.style-presets-button:hover {
		transform: translateY(-1px);
	}

	@media (max-height: 780px), (max-width: 420px) {
		.style-editor-target-label,
		.visual-merge-description,
		.style-selection-hint-box {
			display: none;
		}

		.style-selection-count-label {
			display: -webkit-box;
			-webkit-line-clamp: 1;
			-webkit-box-orient: vertical;
			overflow: hidden;
		}

		.style-editor-header-row {
			margin-top: 0.5rem;
			margin-bottom: 0.25rem;
		}

		.style-editor-top-controls {
			padding-top: 0.5rem;
			padding-bottom: 0.5rem;
			gap: 0.375rem;
		}

		.style-presets-button {
			padding: 0.375rem 0.625rem;
		}
	}
</style>
