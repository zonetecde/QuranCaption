import { globalState } from '$lib/runes/main.svelte';
import { ProjectService } from '$lib/services/ProjectService';
import { ProjectContent, ProjectDetail, ProjectEditorState } from '.';
import { SerializableBase } from './misc/SerializableBase';
import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';

export class Project extends SerializableBase {
	detail: ProjectDetail;
	content: ProjectContent;
	projectEditorState: ProjectEditorState; // État de l'éditeur de projet

	/**
	 * Crée une nouvelle instance de projet
	 * @param detail Détails du projet
	 * @param content Contenu du projet, par défaut un contenu vide
	 */
	constructor(detail: ProjectDetail, content: ProjectContent = new ProjectContent()) {
		super();
		this.detail = detail;
		this.content = content;
		this.projectEditorState = new ProjectEditorState();
		if (detail?.speaker === 'Unknown speaker') {
			ProjectHistoryManager.track('hide unknown speaker name', () => {
				const style = content.videoStyle.getStylesOfTarget('global').findStyle('show-speaker-name');
				if (style) style.value = false;
			});
		}
	}

	/**
	 * Sauvegarde le projet sur l'ordinateur
	 */
	async save(updateUpdateAt: boolean = true): Promise<void> {
		// L'aperçu de la visite reste temporaire, y compris lors de l'autosave.
		if (globalState.uiState.tourPreviewProject === this) return;

		const projectsDetail = globalState.userProjectsDetails.find((p) => p.id === this.detail.id);

		if (projectsDetail) {
			if (updateUpdateAt) {
				this.detail.updateTimestamp();
				projectsDetail.updatedAt = this.detail.updatedAt;
			}
		} else {
			if (updateUpdateAt) {
				this.detail.updateTimestamp();
			}
			globalState.userProjectsDetails.unshift(this.detail);
		}

		await ProjectService.save(this);
	}
}

// Enregistre les classes enfants pour la désérialisation automatique
SerializableBase.registerChildClass(Project, 'detail', ProjectDetail);
SerializableBase.registerChildClass(Project, 'content', ProjectContent);
SerializableBase.registerChildClass(Project, 'projectEditorState', ProjectEditorState);
