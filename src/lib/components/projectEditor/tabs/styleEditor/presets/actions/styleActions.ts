import type { Project } from '$lib/classes/Project';
import type {
	VideoStyle as VideoStyleModel,
	StyleCategoryName,
	VideoStyleFileData
} from '$lib/classes/VideoStyle.svelte';
import { ProjectEditorTabs } from '$lib/classes/enums';
import { globalState } from '$lib/runes/main.svelte';
import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
import ModalManager from '$lib/components/modals/ModalManager';
import { open } from '@tauri-apps/plugin-dialog';
import { readTextFile } from '@tauri-apps/plugin-fs';
import LL from '$lib/i18n/i18n-svelte';
import { get } from 'svelte/store';

/**
 * Recueille les associations de traductions avant toute modification du projet.
 * @param {Project} project Projet propriétaire.
 * @param {VideoStyleFileData} data Preset à appliquer.
 * @returns {Promise<boolean>} Vrai si le preset a été appliqué au projet initial.
 */
export async function applyProjectStylePreset(
	project: Project,
	data: VideoStyleFileData
): Promise<boolean> {
	if (globalState.currentProject !== project) return false;
	// Charger les classes au lancement de l'action évite le cycle modèles → modales → éditeur.
	const { VideoStyle } = await import('$lib/classes/VideoStyle.svelte');
	const { applyStylePreset, SOURCE_STYLE_TARGETS } = await import(
		'$lib/services/StylePresetApplicationService'
	);
	if (globalState.currentProject !== project) return false;
	const imported = VideoStyle.fromJSON(data.videoStyle) as VideoStyleModel;
	const translationSources: Record<string, string> = {};
	const available = imported.styles.filter(
		(styles) => !SOURCE_STYLE_TARGETS.includes(styles.target)
	);
	for (const edition of project.content.projectTranslation.addedTranslationEditions) {
		if (imported.doesTargetStyleExist(edition.name)) continue;
		for (const styles of available) {
			const confirmed = await ModalManager.confirmModal(
				get(LL).translations.translationNoStyles({ name: edition.name }),
				true
			);
			if (globalState.currentProject !== project) return false;
			if (!confirmed) continue;
			translationSources[edition.name] = styles.target;
			break;
		}
	}
	await applyStylePreset(project, data, translationSources);
	globalState.updateVideoPreviewUI();
	return true;
}

/**
 * Ouvre un fichier de styles puis applique son contenu au projet initial.
 * @param {Project} project Projet propriétaire.
 * @returns {Promise<void>} Fin de l'import ou de son annulation.
 */
export async function importStylesFromFile(project: Project): Promise<void> {
	const file = await open({ multiple: false, directory: false });
	if (!file || globalState.currentProject !== project) return;
	try {
		await applyProjectStylePreset(project, JSON.parse(await readTextFile(file)));
	} catch (error) {
		await ModalManager.errorModal(
			get(LL).settings.errorImportingStyles(),
			get(LL).settings.stylesFileInvalid(),
			JSON.stringify(error, Object.getOwnPropertyNames(error))
		);
	}
}

/**
 * Confirme puis réinitialise les styles dans une action annulable du projet initial.
 * @param {Project} project Projet propriétaire.
 * @returns {Promise<void>} Fin de la réinitialisation ou de son annulation.
 */
export async function resetProjectStyles(project: Project): Promise<void> {
	if (!(await ModalManager.confirmModal(get(LL).translations.resetAllStylesConfirm(), false)))
		return;
	if (globalState.currentProject !== project) return;
	const { VideoStyle } = await import('$lib/classes/VideoStyle.svelte');
	if (globalState.currentProject !== project) return;
	const defaults = await VideoStyle.getDefaultVideoStyle(
		project.content.projectTranslation.addedTranslationEditions.map((edition) => edition.name)
	);
	if (globalState.currentProject !== project) return;
	ProjectHistoryManager.track(
		'reset styles',
		() => {
			project.content.videoStyle = defaults;
		},
		project
	);
	globalState.updateVideoPreviewUI();
}

/**
 * Ouvre l'éditeur et met une catégorie en évidence sans modifier les modèles de styles.
 * @param {Project} project Projet affiché.
 * @param {string} target Cible à sélectionner.
 * @param {StyleCategoryName} categoryName Catégorie à mettre en évidence.
 * @returns {void}
 */
export function highlightStyleCategory(
	project: Project,
	target: string,
	categoryName: StyleCategoryName
): void {
	if (globalState.currentProject !== project) return;
	project.projectEditorState.currentTab = ProjectEditorTabs.Style;
	setTimeout(() => {
		if (globalState.currentProject !== project) return;
		const styles = project.projectEditorState.stylesEditor;
		styles.currentSelection = target === 'arabic' || target === 'global' ? target : 'translation';
		setTimeout(() => {
			if (globalState.currentProject !== project) return;
			if (target !== 'arabic' && target !== 'global')
				styles.currentSelectionTranslation = categoryName;
			styles.scrollAndHighlight = categoryName;
		}, 0);
	}, 0);
}
