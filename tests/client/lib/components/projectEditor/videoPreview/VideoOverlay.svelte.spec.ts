import { cleanup, render } from 'vitest-browser-svelte';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { tick } from 'svelte';

import VideoOverlay from '$lib/components/projectEditor/videoPreview/VideoOverlay.svelte';
import { globalState } from '$lib/runes/main.svelte';
import { ProjectEditorState } from '$lib/classes/ProjectEditorState.svelte';
import { Timeline } from '$lib/classes/Timeline.svelte';
import { ProjectEditorTabs, TrackType } from '$lib/classes/enums';
import {
	PredefinedSubtitleClip,
	SubtitleClip
} from '$lib/classes/Clip.svelte';
import { Translation, VerseTranslation } from '$lib/classes/Translation.svelte';
import { AssetTrack, CustomTextTrack, SubtitleTrack } from '$lib/classes/Track.svelte';

vi.mock('$lib/components/projectEditor/tabs/styleEditor/ReciterName.svelte', async () => ({
	default: (await import('../../../../stubs/EmptyComponent.svelte')).default
}));

vi.mock('$lib/components/projectEditor/tabs/styleEditor/SurahName.svelte', async () => ({
	default: (await import('../../../../stubs/EmptyComponent.svelte')).default
}));

vi.mock('$lib/components/projectEditor/tabs/styleEditor/VerseNumber.svelte', async () => ({
	default: (await import('../../../../stubs/EmptyComponent.svelte')).default
}));

vi.mock('$lib/components/projectEditor/tabs/styleEditor/CustomText.svelte', async () => ({
	default: (await import('../../../../stubs/EmptyComponent.svelte')).default
}));

vi.mock('$lib/components/projectEditor/tabs/styleEditor/CustomImage.svelte', async () => ({
	default: (await import('../../../../stubs/EmptyComponent.svelte')).default
}));

vi.mock('$lib/services/verticalDrag', () => ({
	mouseDrag: () => ({
		destroy() {}
	})
}));

vi.mock('@tauri-apps/api/core', async () => {
	const actual = await vi.importActual<typeof import('@tauri-apps/api/core')>(
		'@tauri-apps/api/core'
	);

	return {
		...actual,
		convertFileSrc: (path: string) => path
	};
});

type MockStyle = {
	value: string | number | boolean | null;
};

type MockStyleTarget = {
	categories: unknown[];
	findStyle: (styleId: string) => MockStyle;
	generateCSS: (clipId?: number) => string;
	generateTailwind: () => string;
	getEffectiveValue: (styleId: string) => string | number | boolean | null;
	setStyle: (styleId: string, value: string | number | boolean | null) => void;
};

type MockVideoStyle = {
	doesTargetStyleExist: (target: string) => boolean;
	getStylesOfTarget: (target: string) => MockStyleTarget;
	highlightCategory: () => void;
};

type VideoOverlayFixture = {
	setCursor: (cursorPosition: number) => Promise<void>;
	setPlaying: (isPlaying: boolean) => Promise<void>;
	subtitleTrack: SubtitleTrack;
	videoStyle: MockVideoStyle;
};

function createDefaultStyleValue(target: string, styleId: string): string | number | boolean | null {
	if (styleId === 'opacity') return 1;
	if (styleId === 'max-height') return 0;
	if (styleId === 'font-size') return target === 'arabic' ? 42 : 28;
	if (styleId === 'vertical-text-alignment') return 'center';
	if (styleId === 'reactive-font-size') return target === 'arabic' ? 42 : 28;
	if (styleId === 'reactive-y-position') return 0;
	if (styleId === 'show-verse-number') return false;
	if (styleId === 'verse-number-position') return 'after';
	if (styleId === 'verse-number-format') return '(<number>)';
	if (styleId === 'font-family') return 'MockArabic';
	if (styleId === 'mushaf-style') return 'Uthmani';
	if (styleId === 'show-decorative-brackets') return false;
	if (styleId === 'decorative-brackets-font-family') return 'LM';
	if (styleId === 'fade-duration') return 200;
	if (styleId === 'spacing') return 0;
	if (styleId === 'anti-collision') return false;
	if (styleId === 'overlay-enable') return false;
	if (styleId === 'overlay-blur') return 0;
	if (styleId === 'overlay-opacity') return 0;
	if (styleId === 'overlay-color') return '#000000';
	if (styleId === 'background-overlay-mode') return 'uniform';
	if (styleId === 'background-overlay-fade-intensity') return 0;
	if (styleId === 'background-overlay-fade-coverage') return 0;
	if (styleId === 'overlay-custom-css') return '';
	return 0;
}

function createMockVideoStyle(targets: string[]): MockVideoStyle {
	const targetsMap = new Map<string, MockStyleTarget>();

	function ensureTarget(target: string): MockStyleTarget {
		const existing = targetsMap.get(target);
		if (existing) return existing;

		const styles = new Map<string, MockStyle>();

		const styleTarget: MockStyleTarget = {
			categories: [],
			findStyle(styleId: string) {
				if (!styles.has(styleId)) {
					styles.set(styleId, {
						value: createDefaultStyleValue(target, styleId)
					});
				}
				return styles.get(styleId)!;
			},
			generateCSS(clipId?: number) {
				return `--mock-target: ${target}; --mock-clip-id: ${clipId ?? -1};`;
			},
			generateTailwind() {
				return '';
			},
			getEffectiveValue(styleId: string) {
				return this.findStyle(styleId).value;
			},
			setStyle(styleId: string, value: string | number | boolean | null) {
				this.findStyle(styleId).value = value;
			}
		};

		targetsMap.set(target, styleTarget);
		return styleTarget;
	}

	for (const target of targets) {
		ensureTarget(target);
	}

	return {
		doesTargetStyleExist(target: string) {
			return targetsMap.has(target);
		},
		getStylesOfTarget(target: string) {
			return ensureTarget(target);
		},
		highlightCategory() {}
	};
}

function createVerseSubtitle(
	startTime: number,
	endTime: number,
	arabicText: string,
	translationText: string,
	surah: number = 1,
	verse: number = 1
): SubtitleClip {
	return new SubtitleClip(
		startTime,
		endTime,
		surah,
		verse,
		0,
		1,
		arabicText,
		[],
		false,
		false,
		{
			english: new VerseTranslation(translationText, 'reviewed')
		}
	);
}

function applyVisualMerge(
	clips: SubtitleClip[],
	mode: 'arabic' | 'translation' | 'both',
	groupId: string = `group-${mode}`
): void {
	for (const clip of clips) {
		clip.setVisualMerge(groupId, mode);
	}
}

function createPredefinedSubtitle(
	startTime: number,
	endTime: number,
	type: ConstructorParameters<typeof PredefinedSubtitleClip>[2],
	translationText: string
): PredefinedSubtitleClip {
	const clip = new PredefinedSubtitleClip(startTime, endTime, type);
	clip.translations = {
		english: new Translation(translationText, 'completed by default')
	};
	return clip;
}

function setupVideoOverlayFixture(
	clips: Array<SubtitleClip | PredefinedSubtitleClip>,
	options: {
		cursorPosition?: number;
		isPlaying?: boolean;
	} = {}
): VideoOverlayFixture {
	const { cursorPosition = 0, isPlaying = false } = options;

	const projectEditorState = new ProjectEditorState();
	projectEditorState.currentTab = ProjectEditorTabs.VideoEditor;
	projectEditorState.timeline.cursorPosition = cursorPosition;
	projectEditorState.timeline.movePreviewTo = cursorPosition;
	projectEditorState.videoPreview.isPlaying = isPlaying;

	const subtitleTrack = new SubtitleTrack();
	subtitleTrack.clips = clips;

	const videoTrack = new AssetTrack(TrackType.Video);
	const audioTrack = new AssetTrack(TrackType.Audio);
	const customTrack = new CustomTextTrack();

	const translationTargets = Array.from(
		new Set(
			clips.flatMap((clip) =>
				clip instanceof SubtitleClip || clip instanceof PredefinedSubtitleClip
					? Object.keys(clip.translations)
					: []
			)
		)
	);
	const videoStyle = createMockVideoStyle(['global', 'arabic', ...translationTargets]);

	globalState.currentProject = {
		projectEditorState,
		content: {
			timeline: new Timeline([subtitleTrack, videoTrack, audioTrack, customTrack]),
			projectTranslation: {
				addedTranslationEditions: translationTargets.map((name) => ({
					name,
					language: name,
					author: name
				})),
				getPredefinedSubtitleTranslation: vi.fn(),
				getTranslations: vi.fn().mockResolvedValue({})
			},
			videoStyle
		},
		detail: {
			reciter: '',
			updatePercentageTranslated: vi.fn()
		}
	} as never;

	return {
		async setCursor(nextCursorPosition: number) {
			projectEditorState.timeline.cursorPosition = nextCursorPosition;
			projectEditorState.timeline.movePreviewTo = nextCursorPosition;
			await tick();
		},
		async setPlaying(nextIsPlaying: boolean) {
			projectEditorState.videoPreview.isPlaying = nextIsPlaying;
			await tick();
		},
		subtitleTrack,
		videoStyle
	};
}

function normalizeText(text: string | null | undefined): string {
	return text?.replace(/\s+/g, ' ').trim() ?? '';
}

async function settleOverlay(): Promise<void> {
	await tick();
	await new Promise((resolve) => setTimeout(resolve, 25));
	await tick();
}

function getSubtitlesContainer(container: HTMLElement): HTMLElement | null {
	return container.querySelector('#subtitles-container');
}

function getCurrentSubtitleText(container: HTMLElement): string {
	const subtitleContainer = getSubtitlesContainer(container);
	return normalizeText(subtitleContainer?.textContent);
}

function getBackgroundArabicNode(container: HTMLElement): HTMLElement | null {
	return container.querySelector('#subtitles-backgrounds .arabic.subtitle');
}

function getForegroundArabicNode(container: HTMLElement): HTMLElement | null {
	return container.querySelector('#subtitles-container .arabic.subtitle');
}

function getForegroundTranslationNode(container: HTMLElement, edition: string): HTMLElement | null {
	return container.querySelector(`#subtitles-container .translation.subtitle.${edition}`);
}

describe('Video overlay subtitle preview', () => {
	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
		globalState.currentProject = null;
		globalState.settings = undefined;
	});

	test('keeps the subtitle container visible when playback advances within the new subtitle', async () => {
		const fixture = setupVideoOverlayFixture(
			[
				createVerseSubtitle(0, 999, 'Alpha Arabic', 'Alpha translation'),
				createVerseSubtitle(1000, 1999, 'Beta Arabic', 'Beta translation')
			],
			{ cursorPosition: 100 }
		);

		const component = render(VideoOverlay);
		await settleOverlay();

		await fixture.setPlaying(true);
		await fixture.setCursor(1100);
		await fixture.setCursor(1150);
		await settleOverlay();

		const subtitleContainer = getSubtitlesContainer(component.container);
		expect(subtitleContainer).not.toBeNull();
		expect(subtitleContainer!.style.opacity).toBe('1');
		expect(getCurrentSubtitleText(component.container)).toContain('Beta Arabic');
		expect(getCurrentSubtitleText(component.container)).toContain('Beta translation');
	});

	test('shows the next subtitle again after crossing a gap during playback', async () => {
		const fixture = setupVideoOverlayFixture(
			[
				createVerseSubtitle(0, 400, 'Gap Alpha', 'Gap alpha translation'),
				createVerseSubtitle(1000, 1499, 'Gap Beta', 'Gap beta translation')
			],
			{ cursorPosition: 100 }
		);

		const component = render(VideoOverlay);
		await settleOverlay();

		await fixture.setPlaying(true);
		await fixture.setCursor(700);
		await tick();
		expect(getSubtitlesContainer(component.container)).toBeNull();

		await fixture.setCursor(1100);
		await fixture.setCursor(1120);
		await settleOverlay();

		const subtitleContainer = getSubtitlesContainer(component.container);
		expect(subtitleContainer).not.toBeNull();
		expect(subtitleContainer!.style.opacity).toBe('1');
		expect(getCurrentSubtitleText(component.container)).toContain('Gap Beta');
		expect(getCurrentSubtitleText(component.container)).toContain('Gap beta translation');
	});

	test('keeps predefined subtitle previews visible during playback switches', async () => {
		const fixture = setupVideoOverlayFixture(
			[
				createVerseSubtitle(0, 999, 'Regular Subtitle', 'Regular translation'),
				createPredefinedSubtitle(1000, 1999, 'Basmala', 'Predefined translation')
			],
			{ cursorPosition: 100 }
		);

		const component = render(VideoOverlay);
		await settleOverlay();

		await fixture.setPlaying(true);
		await fixture.setCursor(1100);
		await fixture.setCursor(1180);
		await settleOverlay();

		const subtitleContainer = getSubtitlesContainer(component.container);
		expect(subtitleContainer).not.toBeNull();
		expect(subtitleContainer!.style.opacity).toBe('1');
		expect(getCurrentSubtitleText(component.container)).toContain('Predefined translation');
	});

	test('renders predefined basmala preview with its special arabic glyph text', async () => {
		const basmala = createPredefinedSubtitle(1000, 1999, 'Basmala', 'Predefined translation');
		const fixture = setupVideoOverlayFixture([basmala], { cursorPosition: 1100 });
		fixture.videoStyle.getStylesOfTarget('arabic').setStyle('font-family', 'QPC2');

		const component = render(VideoOverlay);
		await settleOverlay();

		const arabicNode = getForegroundArabicNode(component.container);
		expect(arabicNode).not.toBeNull();
		expect(normalizeText(arabicNode?.textContent)).toBe(normalizeText(basmala.getText()));
	});

	test('keeps merged arabic visible while translations continue to switch per clip', async () => {
		const firstClip = createVerseSubtitle(0, 999, 'Alpha Arabic', 'Alpha translation');
		const secondClip = createVerseSubtitle(1000, 1999, 'Beta Arabic', 'Beta translation');
		firstClip.startWordIndex = 0;
		firstClip.endWordIndex = 1;
		secondClip.startWordIndex = 2;
		secondClip.endWordIndex = 3;
		applyVisualMerge([firstClip, secondClip], 'arabic');
		setupVideoOverlayFixture([firstClip, secondClip], { cursorPosition: 1100 });

		const component = render(VideoOverlay);
		await settleOverlay();

		const mergedText = getCurrentSubtitleText(component.container);
		expect(mergedText).toContain('Alpha Arabic');
		expect(mergedText).toContain('Beta Arabic');
		expect(mergedText).toContain('Beta translation');
		expect(mergedText).not.toContain('Alpha translation');
	});

	test('keeps merged translations visible while arabic continues to switch per clip', async () => {
		const firstClip = createVerseSubtitle(0, 999, 'Alpha Arabic', 'Alpha translation');
		const secondClip = createVerseSubtitle(1000, 1999, 'Beta Arabic', 'Beta translation');
		firstClip.startWordIndex = 0;
		firstClip.endWordIndex = 1;
		secondClip.startWordIndex = 2;
		secondClip.endWordIndex = 3;
		applyVisualMerge([firstClip, secondClip], 'translation');
		setupVideoOverlayFixture([firstClip, secondClip], { cursorPosition: 1100 });

		const component = render(VideoOverlay);
		await settleOverlay();

		const mergedText = getCurrentSubtitleText(component.container);
		expect(mergedText).toContain('Beta Arabic');
		expect(mergedText).not.toContain('Alpha Arabic');
		expect(mergedText).toContain('Alpha translation');
		expect(mergedText).toContain('Beta translation');
	});

	test('keeps both arabic and translations merged across the active group', async () => {
		const firstClip = createVerseSubtitle(0, 999, 'Alpha Arabic', 'Alpha translation');
		const secondClip = createVerseSubtitle(1000, 1999, 'Beta Arabic', 'Beta translation');
		firstClip.startWordIndex = 0;
		firstClip.endWordIndex = 1;
		secondClip.startWordIndex = 2;
		secondClip.endWordIndex = 3;
		applyVisualMerge([firstClip, secondClip], 'both');
		setupVideoOverlayFixture([firstClip, secondClip], { cursorPosition: 1100 });

		const component = render(VideoOverlay);
		await settleOverlay();

		const mergedText = getCurrentSubtitleText(component.container);
		expect(mergedText).toContain('Alpha Arabic');
		expect(mergedText).toContain('Beta Arabic');
		expect(mergedText).toContain('Alpha translation');
		expect(mergedText).toContain('Beta translation');
	});

	test('merges every translation edition independently', async () => {
		const firstClip = createVerseSubtitle(0, 999, 'Alpha Arabic', 'Alpha English');
		firstClip.translations.french = new VerseTranslation('Alpha French', 'reviewed');
		const secondClip = createVerseSubtitle(1000, 1999, 'Beta Arabic', 'Beta English');
		secondClip.translations.french = new VerseTranslation('Beta French', 'reviewed');
		firstClip.startWordIndex = 0;
		firstClip.endWordIndex = 1;
		secondClip.startWordIndex = 2;
		secondClip.endWordIndex = 3;
		applyVisualMerge([firstClip, secondClip], 'translation');
		setupVideoOverlayFixture([firstClip, secondClip], { cursorPosition: 1100 });

		const component = render(VideoOverlay);
		await settleOverlay();

		expect(normalizeText(getForegroundTranslationNode(component.container, 'english')?.textContent)).toBe(
			'Alpha English Beta English'
		);
		expect(normalizeText(getForegroundTranslationNode(component.container, 'french')?.textContent)).toBe(
			'Alpha French Beta French'
		);
	});

	test('removes overlapping words inside merged clips for arabic and translations', async () => {
		const firstClip = new SubtitleClip(
			0,
			999,
			1,
			1,
			0,
			2,
			'w1 w2 w3',
			[],
			false,
			false,
			{
				english: new VerseTranslation('t1 t2 t3', 'reviewed')
			}
		);
		const secondClip = new SubtitleClip(
			1000,
			1999,
			1,
			1,
			1,
			3,
			'w2 w3 w4',
			[],
			false,
			false,
			{
				english: new VerseTranslation('t2 t3 t4', 'reviewed')
			}
		);
		applyVisualMerge([firstClip, secondClip], 'both');
		setupVideoOverlayFixture([firstClip, secondClip], { cursorPosition: 1100 });

		const component = render(VideoOverlay);
		await settleOverlay();

		const mergedText = normalizeText(getCurrentSubtitleText(component.container));
		expect(mergedText).toContain('w1 w2 w3 w4');
		expect(mergedText).not.toContain('w1 w2 w3 w2 w3 w4');
		expect(mergedText).toContain('t1 t2 t3 t4');
		expect(mergedText).not.toContain('t1 t2 t3 t2 t3 t4');
	});

	test('uses the whole merged group for fade timing on merged targets', async () => {
		const firstClip = createVerseSubtitle(0, 999, 'Alpha Arabic', 'Alpha translation');
		const secondClip = createVerseSubtitle(1000, 1999, 'Beta Arabic', 'Beta translation');
		applyVisualMerge([firstClip, secondClip], 'arabic');
		const fixture = setupVideoOverlayFixture([firstClip, secondClip], { cursorPosition: 1100 });

		const component = render(VideoOverlay);
		await settleOverlay();

		const arabicNode = getForegroundArabicNode(component.container);
		expect(arabicNode).not.toBeNull();
		expect(arabicNode!.style.opacity).toBe('1');

		await fixture.setCursor(1950);
		await settleOverlay();
		expect(Number(arabicNode!.style.opacity)).toBeLessThan(1);
		expect(Number(arabicNode!.style.opacity)).toBeGreaterThan(0);
	});

	test('keeps subtitle backgrounds anchored to the nearest subtitle outside active playback windows', async () => {
		const firstClip = createVerseSubtitle(500, 700, 'First Background', 'First background translation');
		const secondClip = createVerseSubtitle(
			1000,
			1200,
			'Second Background',
			'Second background translation'
		);
		const fixture = setupVideoOverlayFixture([firstClip, secondClip], { cursorPosition: 100 });

		const component = render(VideoOverlay);
		await settleOverlay();

		const backgroundArabic = getBackgroundArabicNode(component.container);
		expect(backgroundArabic).not.toBeNull();
		expect(backgroundArabic!.getAttribute('style')).toContain(`--mock-clip-id: ${firstClip.id}`);

		await fixture.setCursor(850);
		await settleOverlay();
		expect(backgroundArabic!.getAttribute('style')).toContain(`--mock-clip-id: ${firstClip.id}`);

		await fixture.setCursor(1400);
		await settleOverlay();
		expect(backgroundArabic!.getAttribute('style')).toContain(`--mock-clip-id: ${secondClip.id}`);
	});
});
