import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	Category,
	CustomTextClip,
	Project,
	ProjectContent,
	ProjectDetail,
	Style,
	StylesData,
	Timeline,
	VideoStyle
} from '$lib/classes';
import { CustomTextTrack } from '$lib/classes/Track.svelte';
import { initializeClassRegistry } from '$lib/classes/ClassRegistry';
import Settings, { type SavedVideoStylePreset } from '$lib/classes/Settings.svelte';
import ModalManager from '$lib/components/modals/ModalManager';
import {
	applyPreset,
	savePreset,
	updatePreset
} from '$lib/components/projectEditor/tabs/styleEditor/presets/actions/localActions';
import { globalState } from '$lib/runes/main.svelte';
import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
import { loadLocale } from '$lib/i18n/i18n-util.sync';
import { setLocale } from '$lib/i18n/i18n-svelte';

vi.mock('$lib/services/AnalyticsService', () => ({
	AnalyticsService: { trackStylePresetSaved: vi.fn(), trackStylePresetApplied: vi.fn() }
}));
vi.mock('svelte-5-french-toast', () => ({ default: { success: vi.fn() } }));

/**
 * Construit un projet minimal avec une résolution, un style arabe et une piste personnalisée.
 * @returns {Project} Projet utilisable sans chargement de fichiers de styles.
 */
function createProject(): Project {
	const videoStyle = new VideoStyle();
	videoStyle.styles = [
		new StylesData('global', [
			new Category({
				id: 'general',
				styles: [new Style({ id: 'video-dimension', value: { width: 1920, height: 1080 } })]
			})
		]),
		new StylesData('arabic', [
			new Category({ id: 'text', styles: [new Style({ id: 'font-size', value: 90 })] })
		])
	];
	vi.spyOn(videoStyle, 'ensureStylesSchemaUpToDate').mockResolvedValue(false);
	return new Project(
		new ProjectDetail('Preset test', 'reciter'),
		new ProjectContent(new Timeline([new CustomTextTrack()]), [], undefined, videoStyle)
	);
}

describe('local style preset updates', () => {
	let original: SavedVideoStylePreset;

	beforeEach(() => {
		initializeClassRegistry();
		loadLocale('en');
		setLocale('en');
		globalState.currentProject = createProject();
		globalState.settings = new Settings();
		ProjectHistoryManager.resetForCurrentProject();
		vi.spyOn(Settings, 'save').mockResolvedValue();
		vi.spyOn(ModalManager, 'confirmModal').mockResolvedValue(true);
		original = {
			id: 1,
			name: 'Mihrab',
			createdAt: '2026-01-01T00:00:00.000Z',
			updatedAt: '2026-01-01T00:00:00.000Z',
			resolution: { width: 1920, height: 1080 },
			data: globalState.getVideoStyle.exportStylesData(new Set())
		};
		globalState.settings.savedVideoStylePresets = [original, { ...original, id: 2, name: 'Azur' }];
	});

	afterEach(() => {
		vi.restoreAllMocks();
		ProjectHistoryManager.clear();
		globalState.currentProject = null;
		globalState.settings = undefined;
	});

	it('updates only the selected preset and preserves its identity and custom content', async () => {
		globalState.getStylesState.activeLocalPresetId = original.id;
		globalState.getVideoStyle.getStylesOfTarget('arabic').findStyle('font-size')!.value = 120;
		const clip = new CustomTextClip(new Category({ id: 'custom-text-test', styles: [] }));
		globalState.getCustomClipTrack.clips.push(clip);
		await updatePreset();

		const presets = globalState.settings!.savedVideoStylePresets;
		expect(presets).toHaveLength(2);
		expect(presets[0]).toMatchObject({
			id: original.id,
			name: original.name,
			createdAt: original.createdAt
		});
		expect(presets[0].updatedAt).not.toBe(original.updatedAt);
		expect(presets[0].data.customClips[0].id).toBe(clip.id);
		const savedStyle = VideoStyle.fromJSON(presets[0].data.videoStyle) as VideoStyle;
		expect(savedStyle.getStylesOfTarget('arabic').findStyle('font-size')?.value).toBe(120);
		expect(presets[1]).toEqual({ ...original, id: 2, name: 'Azur' });
		expect(Settings.save).toHaveBeenCalledOnce();
	});

	it('does not update a preset when another project has no selection', async () => {
		globalState.getStylesState.activeLocalPresetId = original.id;
		globalState.currentProject = createProject();
		await updatePreset();
		expect(Settings.save).not.toHaveBeenCalled();
	});

	it('groups preset application and selection in the same undo step', async () => {
		await applyPreset(original);
		expect(globalState.getStylesState.activeLocalPresetId).toBe(original.id);
		expect(ProjectHistoryManager.undo()).toBe(true);
		expect(globalState.getStylesState.activeLocalPresetId).toBeNull();
		expect(ProjectHistoryManager.redo()).toBe(true);
		expect(globalState.getStylesState.activeLocalPresetId).toBe(original.id);
	});

	it('selects the stored identity when New replaces a preset with the same name', async () => {
		await savePreset(original.name, new Set());
		expect(globalState.getStylesState.activeLocalPresetId).toBe(original.id);
		expect(globalState.settings!.savedVideoStylePresets).toHaveLength(2);
	});
});
