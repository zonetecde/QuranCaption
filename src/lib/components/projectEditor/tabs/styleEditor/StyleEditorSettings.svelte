<script lang="ts">
	import { globalState } from '$lib/runes/main.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { onMount, tick } from 'svelte';
	import StyleComponent from './Style.svelte';
	import PresetLibrary from './presets/components/PresetLibrary.svelte';
	import { CustomTextClip } from '$lib/classes';
	import {
		ClipWithTranslation,
		CustomImageClip,
		type VisualMergeMode
	} from '$lib/classes/Clip.svelte';
	import type { Category, Style, StyleName } from '$lib/classes/VideoStyle.svelte';
	import { VerseTranslation } from '$lib/classes/Translation.svelte';
	import ModalManager from '$lib/components/modals/ModalManager';
	import {
		canMergeArabicVisualModes,
		getActiveVisualMergeGroupId,
		getActiveVisualMergeMode
	} from './visualMergeStyleUtils';
	import { getStyleName } from '$lib/i18n/styleMapper';
	import { get } from 'svelte/store';
	import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';

	type FeatureState = 'active' | 'inactive' | 'mixed';

	type StylePanel = {
		id: string;
		icon: string;
		label: string;
		categoryIds: string[];
		order?: number;
		customContent?: boolean;
	};

	type StyleGroupCopyKey =
		| 'groupBasics'
		| 'groupTypography'
		| 'groupColors'
		| 'groupSpacing'
		| 'groupLayout'
		| 'groupTiming'
		| 'groupEffects'
		| 'groupAdvanced'
		| 'groupVerseNumber'
		| 'groupDecorations'
		| 'groupTransitions';

	type StyleControlGroup = {
		label?: StyleGroupCopyKey;
		styles: Style[];
	};

	type StyleUiCopyKey =
		| 'onScreenElements'
		| 'customElements'
		| 'noCustomElements'
		| 'noMatchingStyles'
		| 'fontControlledByMushaf'
		| StyleGroupCopyKey;

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

	const visualMergeSelection = $derived(() =>
		globalState.getSubtitleTrack.getVisualMergeSelection(
			globalState.getStylesState.selectedSubtitles
		)
	);

	const activeVisualMergeMode = $derived(() =>
		getActiveVisualMergeMode(
			globalState.getStylesState.selectedSubtitles,
			globalState.getSubtitleTrack
		)
	);

	const activeVisualMergeGroupId = $derived(() =>
		getActiveVisualMergeGroupId(
			globalState.getStylesState.selectedSubtitles,
			activeVisualMergeMode()
		)
	);

	const canMergeArabicModes = $derived(() =>
		canMergeArabicVisualModes(visualMergeSelection(), globalState.getSubtitleTrack)
	);

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
			if (id !== 'background-enable' && !isFeatureEnabled('background-enable', category))
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
		const groupedStyleIds = category.ui?.groups?.flatMap((group) => group.styleIds) ?? [];
		const groupedStyles = groupedStyleIds.flatMap((styleId) => {
			const style = categories
				.flatMap((candidate) => candidate.styles)
				.find((candidate) => candidate.id === styleId);
			return style ? [style] : [];
		});
		const stylesClaimedByAnotherCategory = new Set(
			categories
				.filter((candidate) => candidate.id !== category.id)
				.flatMap((candidate) => candidate.ui?.groups?.flatMap((group) => group.styleIds) ?? [])
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
			return styleSearchQuery() !== '' || !isStyleInactiveByDependency(category, style);
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
				return !!category && getVisibleCustomStyles(category).length > 0;
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
	 * Détermine si un style d'un élément personnalisé doit être masqué.
	 * @param {Category} category Catégorie de l'élément personnalisé.
	 * @param {Style} style Style évalué.
	 * @returns {boolean} `true` si le style est actuellement inutile.
	 */
	function isCustomStyleInactive(category: Category, style: Style): boolean {
		if (
			['time-appearance', 'time-disappearance'].includes(style.id) &&
			Boolean(category.getStyle('always-show')?.value)
		)
			return true;

		if (
			category.id.startsWith('custom-image') &&
			style.id !== 'filepath' &&
			!category.getStyle('filepath')?.value
		)
			return true;

		return style.id === 'above-overlay' && !globalState.getStyle('global', 'overlay-enable')?.value;
	}

	/**
	 * Retourne les styles visibles d'un élément personnalisé.
	 * @param {Category} category Catégorie de l'élément personnalisé.
	 * @returns {Style[]} Styles à afficher.
	 */
	function getVisibleCustomStyles(category: Category): Style[] {
		return category.styles.filter(
			(style) => matchesStyleSearch(style, category) && !isCustomStyleInactive(category, style)
		);
	}

	/**
	 * Applique un style personnalisé en conservant les timings cohérents avec la timeline.
	 * @param {Category} category Catégorie de l'élément personnalisé.
	 * @param {Style} style Style modifié.
	 * @param {Style['value']} value Valeur à appliquer.
	 * @returns {void}
	 */
	function applyCustomStyleValue(category: Category, style: Style, value: Style['value']): void {
		const targetCustomClip = globalState.getCustomClipTrack.getCustomClipWithId(category.id);
		if (!targetCustomClip) {
			style.value = value;
			return;
		}

		if (style.id === 'time-appearance' && typeof value === 'number') {
			const endStyle = category.getStyle('time-disappearance');
			const currentEnd = Number(endStyle?.value ?? 0);

			if (value > currentEnd) {
				const endFallback = value + 3000;
				if (endStyle) endStyle.value = endFallback;
				targetCustomClip.setEndTime(endFallback);
			}

			targetCustomClip.setStartTime(value);
			style.value = value;
			return;
		}

		if (style.id === 'time-disappearance' && typeof value === 'number') {
			const beginStyle = category.getStyle('time-appearance');
			const currentBegin = Number(beginStyle?.value ?? 0);

			if (value < currentBegin) {
				const endFallback = value + 3000;
				if (beginStyle) beginStyle.value = value;
				targetCustomClip.setStartTime(value);
				targetCustomClip.setEndTime(endFallback);
				style.value = endFallback;
				return;
			}

			targetCustomClip.setEndTime(value);
			style.value = value;
			return;
		}

		style.value = value;
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
		<header class="flex items-center gap-2 px-3 pt-3 pb-2">
			<div
				class="size-9 rounded-lg bg-accent/15 text-accent flex items-center justify-center shrink-0"
			>
				<span class="material-icons-outlined text-[22px]!">auto_fix_high</span>
			</div>
			<div class="min-w-0">
				<h2 class="text-base font-semibold text-primary tracking-wide">
					{$LL.style.styleEditor()}
				</h2>
				<p class="text-[11px] text-secondary truncate">{$LL.editor.chooseTarget()}</p>
			</div>
			<button
				type="button"
				class="btn-accent ml-auto flex items-center gap-1.5 px-2.5 py-1.5 text-xs shrink-0"
				onclick={openPresetLibrary}
				title={$LL.editor.saveStylesTooltip()}
			>
				<span class="material-icons-outlined text-[18px]!">style</span>
				{$LL.editor.presetsLabel()}
			</button>
		</header>

		<div class="px-3 pb-3 space-y-2.5 border-b border-color bg-[var(--bg-primary)]/45">
			<div data-tour-id="style-subtabs" class="grid grid-cols-3 gap-1.5">
				{#each ['global', 'arabic', 'translation'] as selection (selection)}
					<button
						type="button"
						aria-pressed={globalState.getStylesState.currentSelection === selection}
						onclick={() => {
							globalState.getStylesState.currentSelection = selection as
								| 'global'
								| 'arabic'
								| 'translation';
						}}
						class={'style-target-tab ' +
							(globalState.getStylesState.currentSelection === selection
								? 'style-target-tab-active'
								: '')}
						title={selection === 'arabic'
							? $LL.editor.arabic()
							: selection === 'translation'
								? $LL.editor.translation()
								: $LL.status.video()}
					>
						<span class="material-icons-outlined text-[16px]!">
							{selection === 'global'
								? 'movie'
								: selection === 'arabic'
									? 'text_fields'
									: 'translate'}
						</span>
						<span class="truncate">
							{selection === 'arabic'
								? $LL.editor.arabic()
								: selection === 'translation'
									? $LL.editor.translation()
									: $LL.status.video()}
						</span>
					</button>
				{/each}
			</div>

			{#if globalState.getStylesState.currentSelection === 'translation'}
				{#if globalState.getProjectTranslation.addedTranslationEditions.length > 0}
					<label class="flex items-center gap-2">
						<span class="material-icons-outlined text-secondary text-sm">translate</span>
						<select
							class="flex-1 text-sm"
							aria-label={$LL.editor.selectTranslation()}
							bind:value={globalState.getStylesState.currentSelectionTranslation}
						>
							{#each globalState.getProjectTranslation.addedTranslationEditions as translation (translation.name)}
								<option value={translation.name}>{translation.author}</option>
							{/each}
						</select>
					</label>
				{:else}
					<p class="text-secondary text-xs text-center py-1">{$LL.editor.noTranslationsYet()}</p>
				{/if}
			{/if}

			<div class="relative">
				<span
					class="material-icons-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-secondary text-sm"
					>search</span
				>
				<input
					type="search"
					placeholder={$LL.style.searchStyles()}
					aria-label={$LL.style.searchStyles()}
					class="w-full pl-9! pr-8 py-1.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] focus:ring-1 focus:ring-white/20 text-sm"
					bind:value={globalState.getStylesState.searchQuery}
				/>
				{#if globalState.getStylesState.searchQuery}
					<button
						type="button"
						title={$LL.editor.clearSearch()}
						aria-label={$LL.editor.clearSearch()}
						onclick={clearSearch}
						class="absolute right-2 top-1/2 -translate-y-1/2 text-secondary hover:text-primary"
					>
						<span class="material-icons-outlined text-sm">close</span>
					</button>
				{/if}
			</div>

			{#if globalState.getStylesState.selectedSubtitles.length > 0}
				<div class="style-selection-context">
					<span class="material-icons-outlined text-base">select_all</span>
					<p class="min-w-0 flex-1 text-xs leading-snug">
						{$LL.editor.subtitlesSelected({
							count: globalState.getStylesState.selectedSubtitles.length,
							plural: globalState.getStylesState.selectedSubtitles.length > 1 ? 's' : ''
						})}
					</p>
					<button
						type="button"
						class="text-secondary hover:text-primary"
						title={$LL.editor.clearSelection()}
						aria-label={$LL.editor.clearSelection()}
						onclick={() => globalState.getStylesState.clearSelection()}
					>
						<span class="material-icons-outlined text-base">close</span>
					</button>
				</div>

				{#if visualMergeSelection() && canMergeArabicModes()}
					<div class="rounded-lg border border-emerald-400/30 bg-emerald-500/8 px-2.5 py-2">
						<div class="flex items-start gap-2 text-xs text-[var(--text-primary)]">
							<span class="material-icons-outlined text-base mt-0.5">merge_type</span>
							<div class="min-w-0">
								<p class="font-medium">{$LL.editor.visualMerge()}</p>
								<p class="mt-0.5 leading-relaxed text-secondary">
									{$LL.editor.visualMergeDescription()}
								</p>
							</div>
						</div>
						<div class="mt-2 grid grid-cols-3 gap-1.5">
							<button
								type="button"
								data-testid="Merge Arabic"
								class={getMergeButtonClass('arabic')}
								onclick={() => applyVisualMerge('arabic')}
							>
								{$LL.editor.arabic()}
							</button>
							<button
								type="button"
								data-testid="Merge Translation"
								class={getMergeButtonClass('translation')}
								onclick={() => applyVisualMerge('translation')}
							>
								{$LL.editor.translation()}
							</button>
							<button
								type="button"
								data-testid="Merge Both"
								class={getMergeButtonClass('both')}
								onclick={() => applyVisualMerge('both')}
							>
								{$LL.editor.both()}
							</button>
						</div>
						{#if activeVisualMergeGroupId()}
							<button
								type="button"
								class="btn mt-2 w-full py-1.5 text-xs"
								onclick={unmergeSelectedVisualGroup}
							>
								{$LL.editor.unmergeGroup()}
							</button>
						{/if}
					</div>
				{/if}
			{:else if globalState.getStylesState.selectedVideos.length > 0}
				<div class="style-selection-context">
					<span class="material-icons-outlined text-base">movie</span>
					<p class="min-w-0 flex-1 text-xs leading-snug">
						{$LL.editor.videoClipsSelected({
							count: globalState.getStylesState.selectedVideos.length,
							plural: globalState.getStylesState.selectedVideos.length > 1 ? 's' : ''
						})}
					</p>
					<button
						type="button"
						class="text-secondary hover:text-primary"
						title={$LL.editor.clearSelection()}
						aria-label={$LL.editor.clearSelection()}
						onclick={() => globalState.getStylesState.clearSelection()}
					>
						<span class="material-icons-outlined text-base">close</span>
					</button>
				</div>
			{:else}
				<div
					class="flex items-start gap-2 rounded-lg border border-sky-400/25 bg-sky-500/7 px-2.5 py-1.5 text-[var(--text-primary)]"
				>
					<span class="material-icons-outlined text-sm mt-0.5">info</span>
					<p class="text-[11px] leading-relaxed">{$LL.editor.clickToSelect()}</p>
				</div>
			{/if}

			{#if !(globalState.getStylesState.getCurrentSelection() === 'global' && globalState.getStylesState.selectedSubtitles.length > 0) && !(globalState.getStylesState.currentSelection === 'translation' && globalState.getProjectTranslation.addedTranslationEditions.length === 0)}
				<div class="style-panel-tabs" aria-label={$LL.style.styleEditor()}>
					{#each stylePanels() as panel (panel.id)}
						<button
							type="button"
							aria-pressed={globalState.getStylesState.currentPanel === panel.id}
							class={'style-panel-tab ' +
								(globalState.getStylesState.currentPanel === panel.id
									? 'style-panel-tab-active'
									: '')}
							onclick={() => selectPanel(panel.id)}
						>
							<span class="material-icons-outlined text-[16px]!">{panel.icon}</span>
							<span>{getPanelLabel(panel)}</span>
						</button>
					{/each}
				</div>
			{/if}
		</div>

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
						{#if styleSearchQuery() !== ''}
							<div class="style-panel-result-heading">
								<span class="material-icons-outlined text-accent text-[18px]!">{panel.icon}</span>
								<h3>{getPanelLabel(panel)}</h3>
							</div>
						{/if}

						{#if panel.customContent}
							{#if globalState.getCustomClipTrack.clips.length === 0}
								<div class="style-empty-state mb-3">
									<span class="material-icons-outlined text-xl">add_photo_alternate</span>
									<p>{getStyleUiCopy('noCustomElements')}</p>
								</div>
							{/if}

							{#each globalState.getCustomClipTrack.clips as customClip (customClip.id)}
								{@const category = (customClip as CustomTextClip).category}
								{#if category && getVisibleCustomStyles(category).length > 0}
									<div class="style-category-block style-custom-card" data-category={category.id}>
										<div class="style-category-heading">
											<div class="flex min-w-0 items-center gap-2">
												<span class="material-icons-outlined text-accent text-[18px]!">
													{customClip instanceof CustomImageClip ? 'image' : 'title'}
												</span>
												<h4>{getStyleName(category.id, get(LL))}</h4>
											</div>
											<button
												type="button"
												class="text-secondary hover:text-danger-color"
												title={customClip instanceof CustomImageClip
													? ((
															$LL.editor as typeof $LL.editor & { removeCustomImage?: () => string }
														).removeCustomImage?.() ??
														`${$LL.common.remove()} ${$LL.editor.customImage()}`)
													: $LL.editor.removeCustomText()}
												onclick={() =>
													globalState.getCustomClipTrack.removeClip(Number(customClip.id))}
											>
												<span class="material-icons-outlined text-[18px]!">delete_outline</span>
											</button>
										</div>
										<div class="style-control-list">
											{#each getVisibleCustomStyles(category) as style (style.id)}
												<StyleComponent
													{style}
													showControl
													disabled={false}
													applyValueSimple={(value) =>
														applyCustomStyleValue(category, style, value)}
												/>
											{/each}
										</div>
									</div>
								{/if}
							{/each}

							<div class="grid grid-cols-2 gap-2 mt-3">
								<button
									type="button"
									class="btn-accent px-2 py-2 flex items-center justify-center gap-1 text-xs"
									onclick={() => void globalState.getVideoStyle.addCustomClip('text')}
									title={$LL.editor.addCustomText()}
								>
									<span class="material-icons-outlined text-sm">add</span>
									{$LL.editor.customText()}
								</button>
								<button
									type="button"
									class="btn-accent px-2 py-2 flex items-center justify-center gap-1 text-xs"
									onclick={() => void globalState.getVideoStyle.addCustomClip('image')}
									title={$LL.editor.customImage()}
								>
									<span class="material-icons-outlined text-sm">add</span>
									{$LL.editor.customImage()}
								</button>
							</div>
						{:else}
							{#each getPanelCategories(panel) as category (category.id)}
								{@const visibleStyles = getVisibleStyles(category)}
								{@const styleGroups = getStyleControlGroups(category, visibleStyles)}
								{@const headerStyle = getCategoryHeaderStyle(category)}
								{#if visibleStyles.length > 0 || (headerStyle && (styleSearchQuery() === '' || matchesStyleSearch(headerStyle, category))) || category.id === 'word-by-word-highlight'}
									<div
										class="style-category-block"
										class:style-category-block-collapsed={!!headerStyle &&
											visibleStyles.length === 0}
										data-category={category.id}
									>
										<div class="style-category-heading">
											<span class="material-icons-outlined text-accent text-[18px]!"
												>{category.icon}</span
											>
											<h4>{getStyleName(category.id, get(LL)) || category.name}</h4>
											{#if headerStyle}
												<div class="style-category-header-control">
													<StyleComponent
														style={headerStyle}
														target={currentStyleTarget()}
														disabled={isStyleDisabled(category, headerStyle)}
														headerControl
														applyValueSimple={(value) => {
															headerStyle.value = value as typeof headerStyle.value;
														}}
													/>
												</div>
											{/if}
										</div>

										{#if category.id === 'background' && isFeatureEnabled('background-enable', category)}
											<div class="style-inline-hint">
												<span class="material-icons-outlined text-sm">info</span>
												<p>{$LL.editor.backgroundVisibilityHint()}</p>
											</div>
										{/if}

										{#if category.id === 'text' && isMushafFontLocked()}
											<div class="style-inline-hint">
												<span class="material-icons-outlined text-sm">lock</span>
												<p>{getStyleUiCopy('fontControlledByMushaf')}</p>
											</div>
										{/if}

										{#if category.id === 'word-by-word-highlight' && getWordByWordHintTarget()}
											<div class="style-inline-hint style-inline-hint-warning">
												<span class="material-icons-outlined text-sm">info</span>
												<div>
													{#if getWordByWordHintTarget() === 'translation'}
														<p>{$LL.style.translationWbwMissingMappingInfo()}</p>
													{:else}
														<p>{$LL.style.wbwMissingInfo()}</p>
														<p class="mt-1">{$LL.style.wbwStep1()}</p>
														<p class="mt-1">{$LL.style.wbwStep2()}</p>
													{/if}
												</div>
											</div>
										{/if}

										<div class="style-control-groups">
											{#each styleGroups as group}
												<div class="style-control-group">
													{#if group.label}
														<div class="style-control-group-heading">
															<span>{getStyleUiCopy(group.label)}</span>
														</div>
													{/if}
													<div class="style-control-list">
														{#each group.styles as style (style.id)}
															<StyleComponent
																{style}
																target={currentStyleTarget()}
																showControl
																disabled={isStyleDisabled(category, style)}
																applyValueSimple={(value) => {
																	style.value = value as typeof style.value;
																}}
															/>
														{/each}
													</div>
												</div>
											{/each}
										</div>

										{#if category.id === 'general' && currentStyleTarget() === 'global' && styleSearchQuery() === ''}
											<div
												class="mt-2 border-t border-color pt-2 flex items-center justify-between gap-3"
											>
												<div class="min-w-0">
													<p class="text-sm font-medium text-primary">{$LL.style.hifzMode()}</p>
													<p class="text-xs leading-relaxed text-secondary mt-0.5">
														{$LL.style.createMemorizationVideos()}
													</p>
												</div>
												<button
													type="button"
													class="btn py-1.5 px-2 text-xs shrink-0"
													onclick={() => void ModalManager.hifzRepetitionModal()}
												>
													{$LL.style.enableHifzMode()}
												</button>
											</div>
										{/if}
									</div>
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
	.style-target-tab {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.35rem;
		min-width: 0;
		border: 1px solid var(--border-color);
		border-radius: 0.55rem;
		padding: 0.45rem 0.35rem;
		background: color-mix(in srgb, var(--bg-secondary) 85%, transparent);
		color: var(--text-secondary);
		font-size: 0.75rem;
		font-weight: 600;
		cursor: pointer;
		transition: 150ms ease;
	}

	.style-target-tab:hover {
		background: var(--bg-accent);
		color: var(--text-primary);
	}

	.style-target-tab-active {
		border-color: color-mix(in srgb, var(--accent-primary) 70%, var(--border-color));
		background: color-mix(in srgb, var(--accent-primary) 18%, var(--bg-secondary));
		color: var(--accent-primary);
	}

	.style-selection-context {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		border: 1px solid color-mix(in srgb, var(--accent-primary) 35%, var(--border-color));
		border-radius: 0.55rem;
		padding: 0.4rem 0.5rem;
		background: color-mix(in srgb, var(--accent-primary) 8%, transparent);
		color: var(--text-secondary);
	}

	.style-panel-tabs {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.35rem;
	}

	.style-panel-tab {
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

	.style-panel-tab > span:last-child {
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.style-panel-tab:hover {
		color: var(--text-primary);
		border-color: var(--border-color);
	}

	.style-panel-tab-active {
		background: var(--accent-primary);
		border-color: var(--accent-primary);
		color: var(--text-on-accent);
	}

	.style-panel-tab-active:hover {
		border-color: var(--accent-primary);
		color: var(--text-on-accent);
	}

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

	.style-category-block {
		border: 1px solid color-mix(in srgb, var(--border-color) 78%, transparent);
		border-radius: 0.75rem;
		padding: 0.65rem 0.7rem 0.2rem;
		background: color-mix(in srgb, var(--bg-secondary) 62%, transparent);
		transition:
			border-color 200ms ease,
			background 200ms ease;
	}

	.style-category-block.highlight {
		border-color: #facc15;
		background: color-mix(in srgb, #facc15 12%, var(--bg-secondary));
	}

	.style-category-block-collapsed {
		padding-bottom: 0.65rem;
	}

	.style-category-block-collapsed .style-category-heading {
		margin-bottom: 0;
		padding-bottom: 0;
		border-bottom: 0;
	}

	.style-category-block-collapsed .style-control-groups {
		display: none;
	}

	.style-category-heading {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.1rem;
		padding: 0 0.05rem 0.55rem;
		border-bottom: 1px solid color-mix(in srgb, var(--border-color) 65%, transparent);
	}

	.style-category-heading h4 {
		min-width: 0;
		font-size: 0.8rem;
		font-weight: 700;
		color: var(--text-primary);
	}

	.style-category-header-control {
		margin-left: auto;
	}

	.style-control-list {
		display: flex;
		flex-direction: column;
	}

	.style-control-groups {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.style-control-group-heading {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.45rem 0.15rem 0.1rem;
		color: var(--text-thirdly);
		font-size: 0.625rem;
		font-weight: 700;
		letter-spacing: 0.065em;
		text-transform: uppercase;
	}

	.style-control-group-heading::after {
		content: '';
		min-width: 1rem;
		height: 1px;
		flex: 1;
		background: color-mix(in srgb, var(--border-color) 45%, transparent);
	}

	.style-inline-hint {
		display: flex;
		align-items: flex-start;
		gap: 0.4rem;
		margin: 0 0 0.5rem;
		padding: 0.45rem 0.5rem;
		border: 1px solid rgb(56 189 248 / 30%);
		border-radius: 0.5rem;
		background: rgb(14 165 233 / 8%);
		color: var(--text-secondary);
		font-size: 0.7rem;
		line-height: 1.35;
	}

	.style-inline-hint-warning {
		border-color: rgb(251 191 36 / 35%);
		background: rgb(245 158 11 / 9%);
		color: var(--text-primary);
	}

	.style-empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.45rem;
		min-height: 8rem;
		padding: 1rem;
		border: 1px dashed var(--border-color);
		border-radius: 0.75rem;
		background: color-mix(in srgb, var(--bg-accent) 45%, transparent);
		color: var(--text-secondary);
		font-size: 0.8rem;
		text-align: center;
	}

	.style-custom-card {
		background: color-mix(in srgb, var(--accent-primary) 4%, var(--bg-secondary));
	}

	@media (max-width: 420px), (max-height: 760px) {
		.style-target-tab span:last-child {
			display: none;
		}

		.style-target-tab {
			padding-inline: 0.35rem;
		}
	}
</style>
