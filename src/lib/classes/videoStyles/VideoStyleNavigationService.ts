import { globalState } from '$lib/runes/main.svelte.js';
import { ProjectEditorTabs } from '../enums.js';
import type { StyleCategoryName } from './types.js';

/** Coordonne la navigation vers une catégorie de l'éditeur de styles. */
export class VideoStyleNavigationService {
	/**
	 * Ouvre puis met en évidence une catégorie de styles.
	 * @param {string} target Cible de styles.
	 * @param {StyleCategoryName} categoryName Catégorie à mettre en évidence.
	 * @returns {void}
	 */
	static highlight(target: string, categoryName: StyleCategoryName): void {
		if (globalState.currentProject!.projectEditorState.currentTab !== ProjectEditorTabs.Style) {
			globalState.currentProject!.projectEditorState.currentTab = ProjectEditorTabs.Style;
		}
		setTimeout(() => {
			if (target === 'arabic' || target === 'global') {
				globalState.getStylesState.currentSelection = target;
			} else {
				globalState.getStylesState.currentSelection = 'translation';
				setTimeout(() => {
					globalState.getStylesState.currentSelectionTranslation = categoryName;
				}, 0);
			}
			setTimeout(() => {
				globalState.getStylesState.scrollAndHighlight = categoryName;
			}, 0);
		}, 0);
	}
}
