<script lang="ts">
	import { globalState } from '$lib/runes/main.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { onMount, tick } from 'svelte';
	import PresetLibrary from './presets/components/PresetLibrary.svelte';
	import { CustomTextClip } from '$lib/classes';
	import { ClipWithTranslation } from '$lib/classes/Clip.svelte';
	import type { Category, Style, StyleName } from '$lib/classes/VideoStyle.svelte';
	import { VerseTranslation } from '$lib/classes/Translation.svelte';
	import { getStyleName } from '$lib/i18n/styleMapper';
	import { get } from 'svelte/store';
	import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
	import CustomContentPanel from './CustomContentPanel.svelte';
	import StyleCategoryBlock from './StyleCategoryBlock.svelte';
	import StyleEditorHeader from './StyleEditorHeader.svelte';
	import { getVisibleCustomStyles } from './customContentStyleUtils';
	import type {
		StyleControlGroup,
		StyleGroupCopyKey,
		StylePanel,
		StyleUiCopyKey
	} from './styleEditorTypes';

	type FeatureState = 'active' | 'inactive' | 'mixed';

	let {
		presetLibraryOpen,
		openPresetLibrary,
		closePresetLibrary
	}: {
		presetLibraryOpen: boolean;
		openPresetLibrary: () => void;
		closePresetLibrary: () => void;
	} = $props();

	let stylesContainer: HTMLDivElement | undefined = $state();

	const currentStyleTarget = $derived(() => globalState.getStylesState.getCurrentSelection());
	const styleSearchQuery = $derived(() =>
		globalState.getStylesState.searchQuery.toLowerCase().trim()
	);
	const hasWordByWordTimestamps = $derived(() =>
		globalState.getSubtitleTrack.hasWordByWordTimestamps()
	);

	const stylePanels = $derived(() => getStylePanels());
	const visiblePanels = $derived(() => {
		if (styleSearchQuery() === '') {
			const currentPanel = stylePanels().find(
				(panel) => panel.id === globalState.getStylesState.currentPanel
			);
			return currentPanel ? [currentPanel] : [];
		}

		return stylePanels().filter((panel) => panelHasSearchResult(panel));
	});

	onMount(async () => {
		// Assure la présence des nouveaux styles ajoutés par les updates.
		await ProjectHistoryManager.ignoreAsync(() =>
			globalState.getVideoStyle.ensureStylesSchemaUpToDate()
		);

		stylesContainer!.scrollTop =
			globalState.currentProject!.projectEditorState.stylesEditor.scrollPosition;

		// S'il manque des styles à une traduction, on les ajoute.
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

	/**
	 * Retourne les catégories réellement accessibles pour la cible et la sélection en cours.
	 * @returns {Category[]} Catégories disponibles.
	 */
	function getCategoriesToDisplay(): Category[] {
		const target = currentStyleTarget();
		const categories = globalState.getVideoStyle.getStylesOfTarget(target).categories;

		// Les sélections de clips vidéo ne peuvent modifier que l'overlay.
		if (target === 'global' && globalState.getStylesState.selectedVideos.length > 0) {
			return categories.filter((category) => category.id === 'overlay');
		}

		return categories;
	}

	/**
	 * Regroupe les catégories techniques en panneaux compréhensibles par l'utilisateur.
	 * @returns {StylePanel[]} Panneaux de style disponibles.
	 */
	function getStylePanels(): StylePanel[] {
		const panels = new Map<string, StylePanel>();
		for (const category of getCategoriesToDisplay()) {
			const panelMetadata = category.ui?.panel;
			if (!panelMetadata) continue;

			const panel = panels.get(panelMetadata.id) ?? {
				id: panelMetadata.id,
				icon: panelMetadata.icon,
				label: panelMetadata.label,
				order: panelMetadata.order,
				categoryNavigation: panelMetadata.categoryNavigation,
				categoryIds: []
			};
			panel.categoryIds.push(category.id);
			panels.set(panel.id, panel);
		}

		const availablePanels = [...panels.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

		if (
			currentStyleTarget() === 'global' &&
			globalState.getStylesState.selectedVideos.length === 0 &&
			globalState.getStylesState.selectedSubtitles.length === 0
		) {
			availablePanels.push({
				id: 'custom-content',
				icon: 'add_photo_alternate',
				label: 'customElements',
				categoryIds: [],
				customContent: true
			});
		}

		return availablePanels;
	}

	/**
	 * Retourne les catégories affichées dans un panneau.
	 * @param {StylePanel} panel Panneau à résoudre.
	 * @returns {Category[]} Catégories du panneau.
	 */
	function getPanelCategories(panel: StylePanel): Category[] {
		return getCategoriesToDisplay()
			.filter((category) => panel.categoryIds.includes(category.id))
			.sort((a, b) => (a.ui?.panel.categoryOrder ?? 0) - (b.ui?.panel.categoryOrder ?? 0));
	}

	/**
	 * Retourne la catégorie active d'un panneau possédant une sous-navigation.
	 * @param {StylePanel} panel Panneau à résoudre.
	 * @returns {string} Identifiant de la catégorie active.
	 */
	function getActivePanelCategoryId(panel: StylePanel): string {
		const categories = getPanelCategories(panel);
		const activeCategoryId = globalState.getStylesState.activePanelCategoryIds[panel.id];
		return categories.some((category) => category.id === activeCategoryId)
			? activeCategoryId
			: (categories[0]?.id ?? '');
	}

	/**
	 * Retourne les catégories à afficher selon la sous-navigation et la recherche.
	 * @param {StylePanel} panel Panneau à filtrer.
	 * @returns {Category[]} Catégories visibles dans le panneau.
	 */
	function getVisiblePanelCategories(panel: StylePanel): Category[] {
		const categories = getPanelCategories(panel);
		if (!panel.categoryNavigation || styleSearchQuery() !== '') return categories;

		const activeCategoryId = getActivePanelCategoryId(panel);
		return categories.filter((category) => category.id === activeCategoryId);
	}

	/**
	 * Sélectionne une catégorie dans la sous-navigation d'un panneau.
	 * @param {string} panelId Identifiant du panneau parent.
	 * @param {string} categoryId Identifiant de la catégorie choisie.
	 * @returns {void}
	 */
	function selectPanelCategory(panelId: string, categoryId: string): void {
		globalState.getStylesState.activePanelCategoryIds[panelId] = categoryId;
	}

	/**
	 * Retourne le libellé localisé d'un panneau de style.
	 * @param {StylePanel} panel Panneau à traduire.
	 * @returns {string} Libellé du panneau.
	 */
	function getPanelLabel(panel: StylePanel): string {
		const LL_ = get(LL);
		const copy = (LL_.style as unknown as Record<string, (() => string) | undefined>)[panel.label];
		return copy?.() || getStyleName(panel.label, LL_);
	}

	/**
	 * Lit une microcopie ajoutée au dictionnaire de style en attendant la génération i18n du hook.
	 * @param {StyleUiCopyKey} key Clé de microcopie à résoudre.
	 * @returns {string} Texte localisé.
	 */
	function getStyleUiCopy(key: StyleUiCopyKey): string {
		return (get(LL).style as unknown as Record<StyleUiCopyKey, () => string>)[key]();
	}

	/**
	 * Met à jour le panneau actif et replace le contenu en haut.
	 * @param {string} panelId Identifiant du panneau choisi.
	 * @returns {void}
	 */
	function selectPanel(panelId: string): void {
		globalState.getStylesState.currentPanel = panelId;
		globalState.getStylesState.searchQuery = '';
		stylesContainer?.scrollTo({ top: 0, behavior: 'smooth' });
	}

	/**
	 * Efface la recherche de styles.
	 * @returns {void}
	 */
	function clearSearch(): void {
		globalState.getStylesState.searchQuery = '';
	}

	/**
	 * Retourne les IDs de clips concernés par les styles de la cible active.
	 * @returns {number[]} IDs de clips sélectionnés.
	 */
	function getSelectedStyleClipIds(): number[] {
		if (currentStyleTarget() !== 'global') {
			return globalState.getStylesState.selectedSubtitles.map((subtitle) => subtitle.id);
		}

		return globalState.getStylesState.selectedVideos.map((clip) => clip.id);
	}

	/**
	 * Retourne les valeurs effectives d'un style pour la portée en cours.
	 * @param {string} styleId Identifiant du style à résoudre.
	 * @param {Category} [category] Catégorie contenant le style lorsque disponible.
	 * @returns {unknown[]} Valeurs globales ou valeurs effectives de la sélection.
	 */
	function getEffectiveStyleValues(styleId: string, category?: Category): unknown[] {
		const target = currentStyleTarget();
		const selectedClipIds = getSelectedStyleClipIds();
		const styles = globalState.getVideoStyle.getStylesOfTarget(target);

		if (selectedClipIds.length > 0) {
			return selectedClipIds.map((clipId) =>
				styles.getEffectiveValue(styleId as StyleName, clipId)
			);
		}

		const style =
			category?.getStyle(styleId as StyleName) ?? styles.findStyle(styleId as StyleName);
		return [style?.value];
	}

	/**
	 * Résout l'état effectif d'un toggle, y compris pour une sélection de clips.
	 * @param {string} styleId Identifiant du style parent.
	 * @param {Category} [category] Catégorie contenant le style lorsque disponible.
	 * @returns {FeatureState} État actif, inactif ou mixte.
	 */
	function getFeatureState(styleId: string, category?: Category): FeatureState {
		const values = getEffectiveStyleValues(styleId, category).map(Boolean);
		if (values.every(Boolean)) return 'active';
		if (values.some(Boolean)) return 'mixed';
		return 'inactive';
	}

	/**
	 * Indique si un style parent est actif ou possède des valeurs mixtes dans la sélection.
	 * @param {string} styleId Identifiant du style parent.
	 * @param {Category} [category] Catégorie contenant le style.
	 * @returns {boolean} `true` si les réglages enfants restent utiles.
	 */
	function isFeatureEnabled(styleId: string, category?: Category): boolean {
		return getFeatureState(styleId, category) !== 'inactive';
	}

	/**
	 * Indique si au moins une valeur effective de hauteur maximale est nulle.
	 * @returns {boolean} `true` lorsque le fond ne peut pas être rendu correctement.
	 */
	function isBackgroundMaxHeightMissing(): boolean {
		return getEffectiveStyleValues('max-height').some((value) => Number(value) === 0);
	}

	/**
	 * Vérifie si un style ou sa catégorie correspond à la recherche courante.
	 * @param {Style} style Style évalué.
	 * @param {Category} category Catégorie du style.
	 * @returns {boolean} `true` si le style correspond.
	 */
	function matchesStyleSearch(style: Style, category: Category): boolean {
		const query = styleSearchQuery();
		if (query === '') return true;

		const LL_ = get(LL);
		return (
			style.name.toLowerCase().includes(query) ||
			getStyleName(style.id, LL_).toLowerCase().includes(query) ||
			category.name.toLowerCase().includes(query) ||
			getStyleName(category.id, LL_).toLowerCase().includes(query)
		);
	}

	/**
	 * Retourne le type d'aide à afficher pour le panneau WBW courant.
	 * @returns {'arabic' | 'translation' | null} Type d'aide requis.
	 */
	function getWordByWordHintTarget(): 'arabic' | 'translation' | null {
		const target = currentStyleTarget();
		if (target === 'arabic' && !hasWordByWordTimestamps()) return 'arabic';
		if (target !== 'global' && target !== 'arabic' && !hasTranslationWbwMappings()) {
			return 'translation';
		}
		return null;
	}

	/**
	 * Indique si la traduction sélectionnée possède au moins un mapping WBW.
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
	 * Masque les styles incompatibles avec la cible ou une sélection locale.
	 * @param {Category} category Catégorie du style.
	 * @param {Style} style Style évalué.
	 * @returns {boolean} `true` si le style ne doit jamais être affiché dans ce contexte.
	 */
	function isStyleUnsupported(category: Category, style: Style): boolean {
		const selection = globalState.getStylesState.currentSelection;
		const selectedSubtitles = globalState.getStylesState.selectedSubtitles.length > 0;

		if (style.id === 'reactive-font-size' || style.id === 'reactive-y-position') return true;

		if (
			selection === 'arabic' &&
			[
				'verse-number-format',
				'verse-number-position',
				'verse-number-numeral-system',
				'text-direction'
			].includes(style.id)
		)
			return true;

		if (style.id === 'show-decorative-brackets' && selection !== 'arabic') return true;
		if (style.id === 'decorative-brackets-font-family' && selection !== 'arabic') return true;
		if (style.id === 'mushaf-style' && selection !== 'arabic') return true;

		if (
			style.id === 'decorative-brackets-font-family' &&
			!isFeatureEnabled('show-decorative-brackets', category)
		)
			return true;

		if (
			selectedSubtitles &&
			[
				'show-subtitles',
				'show-verse-number',
				'show-decorative-brackets',
				'mushaf-style',
				'decorative-brackets-font-family',
				'verse-number-format',
				'max-height',
				'max-line',
				'verse-number-position',
				'verse-number-numeral-system',
				'text-direction'
			].includes(style.id)
		)
			return true;

		if (
			category.id === 'word-by-word-highlight' &&
			['wbw-always-show-verse-number', 'wbw-show-current-word-only'].includes(style.id) &&
			selection !== 'arabic'
		)
			return true;

		return false;
	}

	/**
	 * Indique si le mushaf sélectionné impose la police arabe.
	 * @returns {boolean} `true` si la police ne peut pas être modifiée manuellement.
	 */
	function isMushafFontLocked(): boolean {
		return (
			globalState.getStylesState.currentSelection === 'arabic' &&
			!['Uthmani', 'Minimal Quran'].includes(
				String(globalState.getStyle('arabic', 'mushaf-style')?.value)
			)
		);
	}

	/**
	 * Détermine si un style est actuellement inutile parce que son prérequis est inactif.
	 * Les résultats de recherche conservent ces styles, mais les rendent inactifs.
	 * @param {Category} category Catégorie du style.
	 * @param {Style} style Style évalué.
	 * @returns {boolean} `true` si le style dépend d'une fonctionnalité inactive.
	 */
	function isStyleInactiveByDependency(category: Category, style: Style): boolean {
		const id = style.id;
		const target = currentStyleTarget();

		if (target !== 'global' && id !== 'show-subtitles' && !isFeatureEnabled('show-subtitles')) {
			return true;
		}

		if (
			target !== 'global' &&
			[
				'verse-number-color',
				'verse-number-format',
				'verse-number-position',
				'verse-number-numeral-system'
			].includes(id) &&
			!isFeatureEnabled('show-verse-number')
		)
			return true;

		if (category.id === 'general') {
			if (id === 'video-clip-transition-duration') {
				return (
					!isFeatureEnabled('video-clip-transition', category) ||
					getEffectiveStyleValues('video-clip-transition', category).every(
						(value) => value === 'none'
					)
				);
			}
			if (id === 'spacing') return !isFeatureEnabled('anti-collision', category);
		}

		if (category.id === 'overlay') {
			if (id !== 'overlay-enable' && !isFeatureEnabled('overlay-enable', category)) return true;
			if (
				['background-overlay-fade-intensity', 'background-overlay-fade-coverage'].includes(id) &&
				getEffectiveStyleValues('background-overlay-mode', category).every(
					(value) => value === 'uniform'
				)
			)
				return true;
		}

		if (category.id === 'surah-name') {
			if (id !== 'show-surah-name' && !isFeatureEnabled('show-surah-name', category)) return true;
			if (
				['surah-name-time-appearance', 'surah-name-time-disappearance'].includes(id) &&
				isFeatureEnabled('surah-name-always-show', category)
			)
				return true;
			if (
				['surah-calligraphy-style', 'surah-size'].includes(id) &&
				!isFeatureEnabled('surah-show-arabic', category)
			)
				return true;
			if (
				['surah-name-format', 'surah-latin-spacing', 'surah-latin-text-style'].includes(id) &&
				!isFeatureEnabled('surah-show-latin', category)
			)
				return true;
		}

		if (category.id === 'reciter-name') {
			if (
				id !== 'show-reciter-name' &&
				id !== 'reciter-name' &&
				!isFeatureEnabled('show-reciter-name', category)
			)
				return true;
			if (
				['reciter-name-time-appearance', 'reciter-name-time-disappearance'].includes(id) &&
				isFeatureEnabled('reciter-name-always-show', category)
			)
				return true;
			if (id === 'reciter-size' && !isFeatureEnabled('reciter-show-arabic', category)) return true;
			if (
				['reciter-name-format', 'reciter-latin-spacing', 'reciter-latin-text-style'].includes(id) &&
				!isFeatureEnabled('reciter-show-latin', category)
			)
				return true;
		}

		if (category.id === 'ayah-container') {
			if (id !== 'ayah-container-image' && !isFeatureEnabled('ayah-container-image', category))
				return true;
			if (
				['time-appearance', 'time-disappearance'].includes(id) &&
				isFeatureEnabled('always-show', category)
			)
				return true;
		}

		if (category.id === 'verse-number') {
			return id !== 'show-verse-number' && !isFeatureEnabled('show-verse-number', category);
		}

		if (category.id === 'background') {
			if (
				!['background-enable', 'max-height', 'width'].includes(id) &&
				!isFeatureEnabled('background-enable', category)
			)
				return true;
			if (
				['time-appearance', 'time-disappearance'].includes(id) &&
				isFeatureEnabled('always-show', category)
			)
				return true;
		}

		const categoryEnablers: Record<string, string> = {
			border: 'border-enable',
			shadow: 'shadow-enable',
			outline: 'outline-enable',
			'text-glow': 'text-glow-enable',
			'text-neon': 'text-neon-enable'
		};
		const enabler = categoryEnablers[category.id];
		if (enabler && id !== enabler && !isFeatureEnabled(enabler, category)) return true;

		if (category.id === 'word-by-word-highlight') {
			if (getWordByWordHintTarget()) return true;

			if (
				isFeatureEnabled('wbw-show-current-word-only', category) &&
				![
					'wbw-show-current-word-only',
					'wbw-current-word-custom-css',
					'enable-wbw-current-word-opacity',
					'wbw-current-word-opacity'
				].includes(id)
			)
				return true;

			if (id === 'wbw-current-word-opacity') {
				return !isFeatureEnabled('enable-wbw-current-word-opacity', category);
			}
			if (['wbw-color', 'wbw-persist-color'].includes(id)) {
				return !isFeatureEnabled('enable-wbw-highlight', category);
			}
			if (id === 'wbw-bg-color') return !isFeatureEnabled('enable-wbw-background', category);
			if (id === 'wbw-underline-thickness') {
				return !isFeatureEnabled('enable-wbw-underline', category);
			}
			if (['wbw-glow-color', 'wbw-glow-blur'].includes(id)) {
				return !isFeatureEnabled('enable-wbw-glow', category);
			}
			if (id === 'wbw-always-show-verse-number') {
				return !isFeatureEnabled('wbw-reveal-on-recitation', category);
			}
		}

		return false;
	}

	/**
	 * Résout les styles rattachés visuellement à une catégorie par les métadonnées JSON.
	 * @param {Category} category Catégorie d'affichage.
	 * @returns {Style[]} Styles ordonnés pour cette catégorie.
	 */
	function getDisplayCategoryStyles(category: Category): Style[] {
		const categories = getCategoriesToDisplay();
		const localStyleIds = new Set(category.styles.map((style) => style.id));
		const groupedStyleIds =
			category.ui?.groups?.flatMap((group) =>
				group.styleIds.filter(
					(styleId) => styleSearchQuery() === '' || !group.shared || localStyleIds.has(styleId)
				)
			) ?? [];
		const groupedStyles = groupedStyleIds.flatMap((styleId) => {
			const style = categories
				.flatMap((candidate) => candidate.styles)
				.find((candidate) => candidate.id === styleId);
			return style ? [style] : [];
		});
		const stylesClaimedByAnotherCategory = new Set(
			categories
				.filter((candidate) => candidate.id !== category.id)
				.flatMap(
					(candidate) =>
						candidate.ui?.groups
							?.filter((group) => !group.shared)
							.flatMap((group) => group.styleIds) ?? []
				)
		);
		const localStyles = category.styles.filter(
			(style) => !stylesClaimedByAnotherCategory.has(style.id)
		);

		return [
			...new Map([...groupedStyles, ...localStyles].map((style) => [style.id, style])).values()
		];
	}

	/**
	 * Retourne les styles pertinents à afficher dans une catégorie.
	 * @param {Category} category Catégorie à filtrer.
	 * @returns {Style[]} Styles visibles.
	 */
	function getVisibleStyles(category: Category): Style[] {
		const styles = getDisplayCategoryStyles(category);
		const headerStyleId = category.ui?.headerStyle;

		return styles.filter((style) => {
			if (style.id === headerStyleId) return false;
			if (isStyleUnsupported(category, style) || !matchesStyleSearch(style, category)) return false;
			return (
				styleSearchQuery() !== '' ||
				(category.id === 'background' && isBackgroundMaxHeightMissing()) ||
				!isStyleInactiveByDependency(category, style)
			);
		});
	}

	/**
	 * Retourne le booléen principal à afficher dans l'en-tête d'une catégorie.
	 * @param {Category} category Catégorie affichée.
	 * @returns {Style | undefined} Style principal de la catégorie.
	 */
	function getCategoryHeaderStyle(category: Category): Style | undefined {
		const styleId = category.ui?.headerStyle;
		return category.styles.find((style) => style.id === styleId && style.valueType === 'boolean');
	}

	/**
	 * Convertit l'identifiant JSON d'un groupe vers sa clé de traduction.
	 * @param {string} groupId Identifiant du groupe.
	 * @returns {StyleGroupCopyKey} Clé de traduction correspondante.
	 */
	function getStyleGroupCopyKey(groupId: string): StyleGroupCopyKey {
		return `group${groupId.charAt(0).toUpperCase()}${groupId.slice(1)}` as StyleGroupCopyKey;
	}

	/**
	 * Réorganise les longues catégories en groupes visuels sans masquer de style.
	 * @param {Category} category Catégorie affichée.
	 * @param {Style[]} styles Styles visibles de la catégorie.
	 * @returns {StyleControlGroup[]} Groupes ordonnés à afficher.
	 */
	function getStyleControlGroups(category: Category, styles: Style[]): StyleControlGroup[] {
		if (styleSearchQuery() !== '') return [{ styles }];

		const definitions = category.ui?.groups;
		if (!definitions) return [{ styles }];

		const stylesById = new Map(styles.map((style) => [style.id, style]));
		const groups = definitions
			.map(({ id, styleIds }) => ({
				label: getStyleGroupCopyKey(id),
				styles: styleIds.flatMap((styleId) => {
					const style = stylesById.get(styleId);
					if (!style) return [];
					stylesById.delete(styleId);
					return [style];
				})
			}))
			.filter((group) => group.styles.length > 0);

		const remainingStyles = styles.filter((style) => stylesById.has(style.id));
		if (remainingStyles.length > 0) {
			groups.push({ label: 'groupAdvanced', styles: remainingStyles });
		}

		return groups.length > 1 ? groups : [{ styles }];
	}

	/**
	 * Indique si un style rendu par la recherche doit être désactivé.
	 * @param {Category} category Catégorie du style.
	 * @param {Style} style Style évalué.
	 * @returns {boolean} `true` si le style ne peut pas être modifié dans son contexte actuel.
	 */
	function isStyleDisabled(category: Category, style: Style): boolean {
		return (
			(style.id === 'font-family' && isMushafFontLocked()) ||
			(category.id === 'background' &&
				!['max-height', 'width'].includes(style.id) &&
				isBackgroundMaxHeightMissing()) ||
			(styleSearchQuery() !== '' && isStyleInactiveByDependency(category, style))
		);
	}

	/**
	 * Indique si un panneau possède au moins un résultat de recherche.
	 * @param {StylePanel} panel Panneau à vérifier.
	 * @returns {boolean} `true` si le panneau contient un résultat.
	 */
	function panelHasSearchResult(panel: StylePanel): boolean {
		if (panel.customContent) {
			return globalState.getCustomClipTrack.clips.some((clip) => {
				const category = (clip as CustomTextClip).category;
				return !!category && getVisibleCustomStyles(category, styleSearchQuery()).length > 0;
			});
		}

		return getPanelCategories(panel).some((category) => {
			const headerStyle = getCategoryHeaderStyle(category);
			return (
				getVisibleStyles(category).length > 0 ||
				(!!headerStyle && matchesStyleSearch(headerStyle, category))
			);
		});
	}

	$effect(() => {
		if (globalState.getStylesState.currentSelection !== 'translation') return;
		ensureCurrentTranslationSelection();
	});

	$effect(() => {
		const panels = stylePanels();
		if (panels.some((panel) => panel.id === globalState.getStylesState.currentPanel)) return;
		globalState.getStylesState.currentPanel = panels[0]?.id ?? '';
	});

	$effect(() => {
		const categoryId = globalState.getStylesState.scrollAndHighlight;
		if (!categoryId) return;

		const panel = stylePanels().find((candidate) => candidate.categoryIds.includes(categoryId));
		globalState.getStylesState.currentPanel = panel?.id ?? stylePanels()[0]?.id ?? '';
		if (panel?.categoryNavigation) {
			globalState.getStylesState.activePanelCategoryIds[panel.id] = categoryId;
		}
		globalState.getStylesState.searchQuery = '';

		void tick().then(() => {
			const element = stylesContainer?.querySelector(`[data-category="${categoryId}"]`);
			if (!element) return;

			element.scrollIntoView({ behavior: 'smooth', block: 'start' });
			element.classList.add('highlight');
			setTimeout(() => element.classList.remove('highlight'), 2000);
		});

		globalState.getStylesState.scrollAndHighlight = null;
	});
</script>

<div
	class="bg-secondary h-full border border-color mx-0.5 rounded-xl relative flex flex-col shadow"
>
	{#if presetLibraryOpen}
		<PresetLibrary onBack={closePresetLibrary} />
	{:else}
		<StyleEditorHeader panels={stylePanels()} {openPresetLibrary} {getPanelLabel} {selectPanel} />
		<div
			class="style-settings-scroll flex-1 min-h-0 overflow-y-auto px-3 py-3"
			bind:this={stylesContainer}
			onscroll={() => {
				globalState.currentProject!.projectEditorState.stylesEditor.scrollPosition =
					stylesContainer?.scrollTop || 0;
			}}
		>
			{#if globalState.getStylesState.getCurrentSelection() === 'global' && globalState.getStylesState.selectedSubtitles.length > 0}
				<div class="style-empty-state border-amber-400/40 bg-amber-500/10 text-amber-100">
					<span class="material-icons-outlined text-xl">info</span>
					<p>{$LL.editor.cannotEditGlobalWithSelection()}</p>
				</div>
			{:else if globalState.getStylesState.currentSelection === 'translation' && globalState.getProjectTranslation.addedTranslationEditions.length === 0}
				<div class="style-empty-state">
					<span class="material-icons-outlined text-xl">translate</span>
					<p>{$LL.editor.noTranslationsYet()}</p>
				</div>
			{:else if styleSearchQuery() !== '' && visiblePanels().length === 0}
				<div class="style-empty-state">
					<span class="material-icons-outlined text-xl">search_off</span>
					<p>{getStyleUiCopy('noMatchingStyles')}</p>
					<button type="button" class="btn mt-2 px-3 py-1.5 text-xs" onclick={clearSearch}>
						{$LL.editor.clearSearch()}
					</button>
				</div>
			{:else}
				{#each visiblePanels() as panel (panel.id)}
					<div
						id={'style-panel-' + panel.id}
						class="style-panel-content"
						aria-label={getPanelLabel(panel)}
					>
						{#if styleSearchQuery() !== '' && panel.customContent}
							<div class="style-panel-result-heading">
								<span class="material-icons-outlined text-accent text-[18px]!">{panel.icon}</span>
								<h3>{getPanelLabel(panel)}</h3>
							</div>
						{/if}

						{#if panel.customContent}
							<CustomContentPanel />
						{:else}
							{#if panel.categoryNavigation && styleSearchQuery() === ''}
								<div class="style-category-tabs" aria-label={getPanelLabel(panel)}>
									{#each getPanelCategories(panel) as category (category.id)}
										{@const categoryLabel = getStyleName(category.id, get(LL))}
										<button
											type="button"
											aria-pressed={getActivePanelCategoryId(panel) === category.id}
											class:style-category-tab-active={getActivePanelCategoryId(panel) ===
												category.id}
											class="style-category-tab"
											onclick={() => selectPanelCategory(panel.id, category.id)}
										>
											<span class="material-icons-outlined text-[16px]!">{category.icon}</span>
											<span>{categoryLabel}</span>
										</button>
									{/each}
								</div>
							{/if}

							{#each getVisiblePanelCategories(panel) as category (category.id)}
								{@const visibleStyles = getVisibleStyles(category)}
								{@const styleGroups = getStyleControlGroups(category, visibleStyles)}
								{@const headerStyle = getCategoryHeaderStyle(category)}
								{#if visibleStyles.length > 0 || (headerStyle && (styleSearchQuery() === '' || matchesStyleSearch(headerStyle, category))) || category.id === 'word-by-word-highlight'}
									<StyleCategoryBlock
										{category}
										{visibleStyles}
										{styleGroups}
										{headerStyle}
										target={currentStyleTarget()}
										searchActive={styleSearchQuery() !== ''}
										mushafFontLocked={isMushafFontLocked()}
										backgroundRequiresMaxHeight={category.id === 'background' &&
											isBackgroundMaxHeightMissing()}
										wordByWordHint={getWordByWordHintTarget()}
										{isStyleDisabled}
										{getStyleUiCopy}
									/>
								{/if}
							{/each}
						{/if}
					</div>
				{/each}
			{/if}
		</div>
	{/if}
</div>

<style>
	.style-panel-content {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.style-panel-result-heading {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		font-size: 0.85rem;
		font-weight: 700;
		color: var(--text-primary);
	}

	.style-category-tabs {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.35rem;
		margin-bottom: 0.1rem;
	}

	.style-category-tab {
		display: flex;
		align-items: center;
		justify-content: flex-start;
		gap: 0.35rem;
		width: 100%;
		min-width: 0;
		border: 1px solid transparent;
		border-radius: 0.6rem;
		padding: 0.45rem 0.55rem;
		background: var(--bg-accent);
		color: var(--text-secondary);
		font-size: 0.7rem;
		font-weight: 600;
		line-height: 1.2;
		text-align: left;
		cursor: pointer;
		transition: 150ms ease;
	}

	.style-category-tab > span:last-child {
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.style-category-tab:hover {
		border-color: var(--border-color);
		color: var(--text-primary);
	}

	.style-category-tab-active,
	.style-category-tab-active:hover {
		border-color: var(--accent-primary);
		background: color-mix(in srgb, var(--accent-primary) 28%, var(--bg-secondary));
		color: var(--text-primary);
	}

	:global(.style-category-block.highlight) {
		border-color: #facc15;
		background: color-mix(in srgb, #facc15 12%, var(--bg-secondary));
	}

	.style-empty-state {
		display: flex;
		min-height: 8rem;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.45rem;
		padding: 1rem;
		border: 1px dashed var(--border-color);
		border-radius: 0.75rem;
		background: color-mix(in srgb, var(--bg-accent) 45%, transparent);
		color: var(--text-secondary);
		font-size: 0.8rem;
		text-align: center;
	}
</style>
