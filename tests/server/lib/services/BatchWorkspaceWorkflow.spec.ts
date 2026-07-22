import { describe, expect, it } from 'vitest';
import type { BatchProjectItem } from '$lib/classes';
import { BatchWorkspaceWorkflow } from '$lib/services/BatchWorkspaceWorkflow.svelte';

describe('BatchWorkspaceWorkflow', () => {
	it('autorise une seule opération Batch à la fois', () => {
		const workflow = new BatchWorkspaceWorkflow();

		expect(workflow.begin('media')).toBe(true);
		expect(workflow.begin('export')).toBe(false);
		expect(workflow.isActive('media')).toBe(true);
		expect(workflow.activeOperation).toBe('media');
	});

	it('ne libère pas le verrou depuis une autre opération', () => {
		const workflow = new BatchWorkspaceWorkflow();

		workflow.begin('segmentation');
		workflow.finish('media');
		expect(workflow.activeOperation).toBe('segmentation');

		workflow.finish('segmentation');
		expect(workflow.activeOperation).toBeNull();
	});

	it('identifie uniquement les opérations globales', () => {
		const workflow = new BatchWorkspaceWorkflow();

		workflow.begin('style');
		expect(workflow.isGlobalOperationActive()).toBe(true);

		workflow.finish('style');
		workflow.begin('translation');
		expect(workflow.isGlobalOperationActive()).toBe(false);
	});

	it('centralise la sélection des projets affichés', () => {
		const workflow = new BatchWorkspaceWorkflow();
		const projects = [
			{ projectId: 1, media: { status: 'pending' } },
			{ projectId: 2, media: { status: 'pending' } }
		] as BatchProjectItem[];

		workflow.toggleProject(1);
		expect(workflow.getSelectedProjects(projects)).toEqual([projects[0]]);

		workflow.toggleAllProjects(projects);
		expect(workflow.areAllProjectsSelected(projects)).toBe(true);

		workflow.toggleAllProjects(projects);
		expect(workflow.selectedProjectIds.size).toBe(0);
	});

	it('détermine le stage actif depuis les états persistants et le workflow', () => {
		const workflow = new BatchWorkspaceWorkflow();
		const project = {
			media: { status: 'completed' },
			segmentation: { status: 'not_started' },
			translations: {}
		} as BatchProjectItem;

		expect(workflow.getActiveProjectStage([project])).toBe('media');
		workflow.begin('segmentation');
		expect(workflow.getActiveProjectStage([project])).toBe('segmentation');
		workflow.finish('segmentation');
		project.translations.edition = {} as never;
		expect(workflow.getActiveProjectStage([project])).toBe('translation');
	});
});
