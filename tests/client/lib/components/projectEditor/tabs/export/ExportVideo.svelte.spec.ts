import { cleanup, render } from 'vitest-browser-svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { get } from 'svelte/store';
import ExportVideo from '$lib/components/projectEditor/tabs/export/ExportVideo.svelte';
import Settings from '$lib/classes/Settings.svelte';
import { ExportState, ProjectEditorState } from '$lib/classes/ProjectEditorState.svelte';
import { Timeline } from '$lib/classes/Timeline.svelte';
import { AssetTrack, SubtitleTrack } from '$lib/classes/Track.svelte';
import { TrackType } from '$lib/classes/enums';
import { Style } from '$lib/classes/VideoStyle.svelte';
import { globalState } from '$lib/runes/main.svelte';
import LL, { setLocale } from '$lib/i18n/i18n-svelte';
import { loadLocale } from '$lib/i18n/i18n-util.sync';
import { exists, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { VersionService } from '$lib/services/VersionService.svelte';

vi.mock('@tauri-apps/plugin-fs', async () => ({
	...(await vi.importActual<typeof import('@tauri-apps/plugin-fs')>('@tauri-apps/plugin-fs')),
	exists: vi.fn().mockResolvedValue(true),
	readTextFile: vi.fn(),
	writeTextFile: vi.fn().mockResolvedValue(undefined)
}));
vi.mock('@tauri-apps/api/path', async () => ({
	...(await vi.importActual<typeof import('@tauri-apps/api/path')>('@tauri-apps/api/path')),
	appDataDir: vi.fn().mockResolvedValue('/test-settings'),
	join: vi.fn().mockImplementation(async (...parts: string[]) => parts.join('/'))
}));
vi.mock('$lib/components/projectEditor/tabs/export/TimeInput.svelte', async () => ({
	default: (await import('../../../../../stubs/EmptyComponent.svelte')).default
}));
vi.mock('$lib/components/projectEditor/tabs/export/ExportFolderPicker.svelte', async () => ({
	default: (await import('../../../../../stubs/EmptyComponent.svelte')).default
}));
vi.mock('$lib/components/projectEditor/tabs/styleEditor/Style.svelte', async () => ({
	default: (await import('../../../../../stubs/EmptyComponent.svelte')).default
}));

/**
 * Installe un projet distinct pour vérifier que les options promotionnelles restent globales.
 * @returns {void}
 */
function openProject(): void {
	globalState.currentProject = {
		projectEditorState: new ProjectEditorState(),
		detail: { generateExportFileName: () => 'video' },
		content: {
			timeline: new Timeline([
				new SubtitleTrack(),
				new AssetTrack(TrackType.Audio),
				new AssetTrack(TrackType.Video)
			]),
			projectTranslation: { addedTranslationEditions: [] }
		}
	} as never;
}

beforeEach(() => {
	loadLocale('en');
	setLocale('en');
	globalState.settings = new Settings();
	globalState.settings.appVersion = '1.1.72';
	vi.spyOn(VersionService, 'getAppVersion').mockResolvedValue('1.1.72');
	vi.spyOn(globalState, 'getStyle').mockReturnValue(new Style({ id: 'font-size', value: 42 }));
	openProject();
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.clearAllMocks();
	globalState.currentProject = null;
	globalState.settings = undefined;
});

test('persists promotion activation and position across projects and application restarts', async () => {
	const copy = get(LL).export;
	let component = render(ExportVideo);
	await component
		.getByRole('button', { name: get(LL).export.additionalOptions(), exact: false })
		.click();
	const enabled = component.getByRole('checkbox', {
		name: copy.addQuranCaptionPromotion(),
		exact: false
	});
	await expect.element(enabled).not.toBeChecked();
	expect(globalState.settings!.exportSettings.quranCaptionPromotionPosition).toBe('end');

	await enabled.click();
	const position = component.getByRole('combobox', { name: copy.quranCaptionPromotionPosition() });
	await position.selectOptions('start');
	await vi.waitFor(() => expect(writeTextFile).toHaveBeenCalledTimes(2));
	const [path, saved] = vi.mocked(writeTextFile).mock.calls.at(-1)!;
	expect(path).toBe('/test-settings/settings.json');
	expect(JSON.parse(saved).exportSettings).toMatchObject({
		includeQuranCaptionPromotion: true,
		quranCaptionPromotionPosition: 'start'
	});
	expect(globalState.getExportState.toJSON()).not.toHaveProperty('includeQuranCaptionPromotion');
	expect(globalState.getExportState.toJSON()).not.toHaveProperty('quranCaptionPromotionPosition');

	cleanup();
	openProject();
	component = render(ExportVideo);
	await component
		.getByRole('button', { name: get(LL).export.additionalOptions(), exact: false })
		.click();
	await expect
		.element(
			component.getByRole('checkbox', { name: copy.addQuranCaptionPromotion(), exact: false })
		)
		.toBeChecked();
	await expect
		.element(component.getByRole('combobox', { name: copy.quranCaptionPromotionPosition() }))
		.toHaveValue('start');

	vi.mocked(readTextFile).mockResolvedValue(saved);
	globalState.settings = undefined;
	await Settings.load();
	expect(globalState.settings!.exportSettings).toMatchObject({
		includeQuranCaptionPromotion: true,
		quranCaptionPromotionPosition: 'start'
	});
	await component
		.getByRole('checkbox', { name: copy.addQuranCaptionPromotion(), exact: false })
		.click();
	await vi.waitFor(() => expect(writeTextFile).toHaveBeenCalledTimes(3));
	expect(JSON.parse(vi.mocked(writeTextFile).mock.calls.at(-1)![1]).exportSettings).toMatchObject({
		includeQuranCaptionPromotion: false,
		quranCaptionPromotionPosition: 'start'
	});
});

test('defaults legacy settings to disabled and ignores old project-specific promotion choices', async () => {
	const saved = globalState.settings!.toJSON();
	const exportSettings = saved.exportSettings as Record<string, unknown>;
	delete exportSettings.includeQuranCaptionPromotion;
	delete exportSettings.quranCaptionPromotionPosition;
	vi.mocked(readTextFile).mockResolvedValue(JSON.stringify(saved));
	globalState.settings = undefined;
	await Settings.load();
	expect(globalState.settings!.exportSettings).toMatchObject({
		includeQuranCaptionPromotion: false,
		quranCaptionPromotionPosition: 'end'
	});
	globalState.currentProject!.projectEditorState.export = ExportState.fromJSON({
		includeQuranCaptionPromotion: true,
		quranCaptionPromotionPosition: 'start'
	}) as ExportState;
	const component = render(ExportVideo);
	await component
		.getByRole('button', { name: get(LL).export.additionalOptions(), exact: false })
		.click();
	await expect
		.element(
			component.getByRole('checkbox', {
				name: get(LL).export.addQuranCaptionPromotion(),
				exact: false
			})
		)
		.not.toBeChecked();
	expect(globalState.getExportState.toJSON()).not.toHaveProperty('includeQuranCaptionPromotion');
	expect(globalState.getExportState.toJSON()).not.toHaveProperty('quranCaptionPromotionPosition');
	expect(JSON.parse(vi.mocked(writeTextFile).mock.calls.at(-1)![1]).exportSettings).toMatchObject({
		includeQuranCaptionPromotion: false,
		quranCaptionPromotionPosition: 'end'
	});
});
