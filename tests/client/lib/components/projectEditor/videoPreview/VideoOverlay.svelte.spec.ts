import { cleanup, render } from 'vitest-browser-svelte';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { tick } from 'svelte';

import VideoOverlay from '$lib/components/projectEditor/videoPreview/VideoOverlay.svelte';
import { globalState } from '$lib/runes/main.svelte';
import { ProjectEditorState } from '$lib/classes/ProjectEditorState.svelte';
import { Timeline } from '$lib/classes/Timeline.svelte';
import { ProjectEditorTabs, TrackType } from '$lib/classes/enums';
import { PredefinedSubtitleClip, SubtitleClip } from '$lib/classes/Clip.svelte';
import { Translation, VerseTranslation } from '$lib/classes/Translation.svelte';
import { AssetTrack, CustomTextTrack, SubtitleTrack } from '$lib/classes/Track.svelte';
import QPCFontProvider from '$lib/services/FontProvider';

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
	const actual =
		await vi.importActual<typeof import('@tauri-apps/api/core')>('@tauri-apps/api/core');

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

function createDefaultStyleValue(
	target: string,
	styleId: string
): string | number | boolean | null {
	if (styleId === 'opacity') return 1;
	if (styleId === 'max-height') return 0;
	if (styleId === 'max-line') return 'Infinite';
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
	if (styleId === 'enable-wbw-highlight') return false;
	if (styleId === 'enable-wbw-background') return false;
	if (styleId === 'enable-wbw-underline') return false;
	if (styleId === 'background-enable') return false;
	if (styleId === 'background-horizontal-padding') return 0;
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
	return new SubtitleClip(startTime, endTime, surah, verse, 0, 1, arabicText, [], false, false, {
		english: new VerseTranslation(translationText, 'reviewed')
	});
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

/**
 * Crée un clip Quran dont le dernier mot déclenche le suffixe du numéro de verset.
 * @param {number} startTime Début du clip en millisecondes.
 * @param {number} endTime Fin du clip en millisecondes.
 * @param {number} surah Numéro de sourate.
 * @param {number} verse Numéro de verset.
 * @param {number} startWordIndex Index du premier mot inclus.
 * @param {number} endWordIndex Index du dernier mot inclus.
 * @returns {SubtitleClip} Clip prêt pour les tests de rendu QPC.
 */
function createLastWordsQpcSubtitle(
	startTime: number,
	endTime: number,
	surah: number,
	verse: number,
	startWordIndex: number,
	endWordIndex: number
): SubtitleClip {
	return new SubtitleClip(
		startTime,
		endTime,
		surah,
		verse,
		startWordIndex,
		endWordIndex,
		`${surah}:${verse}`,
		[],
		false,
		true,
		{
			english: new VerseTranslation(`${surah}:${verse}`, 'reviewed')
		}
	);
}

/**
 * Injecte uniquement les glyphes QPC2 nécessaires aux scénarios de test.
 * @returns {void}
 */
function seedQpc2PreviewFixture(): void {
	QPCFontProvider.qpc2Glyphs = {
		'1:1:1': 'ﱁ',
		'1:1:2': 'ﱂ',
		'1:1:3': 'ﱃ',
		'1:1:4': 'ﱄ',
		'1:1:5': 'ﱅ',
		'1:2:1': 'ﱆ',
		'1:2:2': 'ﱇ',
		'1:2:3': 'ﱈ',
		'1:2:4': 'ﱉ',
		'1:2:5': 'ﱊ',
		'71:10:4': 'ﳆ',
		'71:10:5': 'ﳇ',
		'71:10:6': 'ﳈ',
		'71:10:7': 'ﳉ',
		'71:11:1': 'ﱁ',
		'71:11:2': 'ﱂ',
		'71:11:3': 'ﱃ',
		'71:11:4': 'ﱄ',
		'71:11:5': 'ﱅ'
	};
	QPCFontProvider.verseMappingV2 = {
		'1:1': 'QPC2_p001',
		'1:2': 'QPC2_p001',
		'71:10': 'QPC2_p570',
		'71:11': 'QPC2_p571'
	};
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

/**
 * Retourne les spans stylés du flux arabe principal.
 * @param {HTMLElement} container Conteneur rendu par le test.
 * @returns {HTMLElement[]} Spans directs du flux inline arabe.
 */
function getArabicInlineFlowSpans(container: HTMLElement): HTMLElement[] {
	return Array.from(
		container.querySelectorAll(
			'#subtitles-container .arabic.subtitle .translation-inline-flow > span'
		)
	);
}

/**
 * Retourne uniquement les spans du numéro de verset arabe.
 * @param {HTMLElement} container Conteneur rendu par le test.
 * @returns {HTMLElement[]} Spans colorés comme numéro de verset.
 */
function getArabicVerseNumberSpans(container: HTMLElement): HTMLElement[] {
	return getArabicInlineFlowSpans(container).filter((span) =>
		span.getAttribute('style')?.includes('verse-number-color')
	);
}

describe('Video overlay subtitle preview', () => {
	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
		globalState.currentProject = null;
		globalState.settings = undefined;
		QPCFontProvider.qpc2Glyphs = undefined;
		QPCFontProvider.verseMappingV2 = undefined;
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

	test('keeps em dash translation spacing normalized across merged clips', async () => {
		const firstClip = createVerseSubtitle(
			0,
			999,
			'First Arabic',
			'the Path of those You have blessed—'
		);
		const secondClip = createVerseSubtitle(
			1000,
			1999,
			'Second Arabic',
			'not those You are displeased with, or those who are astray.'
		);
		firstClip.startWordIndex = 0;
		firstClip.endWordIndex = 5;
		secondClip.startWordIndex = 6;
		secondClip.endWordIndex = 15;
		applyVisualMerge([firstClip, secondClip], 'translation');
		setupVideoOverlayFixture([firstClip, secondClip], { cursorPosition: 1100 });

		const component = render(VideoOverlay);
		await settleOverlay();

		expect(
			normalizeText(getForegroundTranslationNode(component.container, 'english')?.textContent)
		).toBe(
			'the Path of those You have blessed—not those You are displeased with, or those who are astray.'
		);
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

		expect(
			normalizeText(getForegroundTranslationNode(component.container, 'english')?.textContent)
		).toBe('Alpha English Beta English');
		expect(
			normalizeText(getForegroundTranslationNode(component.container, 'french')?.textContent)
		).toBe('Alpha French Beta French');
	});

	test('removes overlapping words inside merged clips for arabic and translations', async () => {
		const firstClip = new SubtitleClip(0, 999, 1, 1, 0, 2, 'w1 w2 w3', [], false, false, {
			english: new VerseTranslation('t1 t2 t3', 'reviewed')
		});
		const secondClip = new SubtitleClip(1000, 1999, 1, 1, 1, 3, 'w2 w3 w4', [], false, false, {
			english: new VerseTranslation('t2 t3 t4', 'reviewed')
		});
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

	test('keeps QPC2 verse-number fonts per clip across a merged page boundary', async () => {
		seedQpc2PreviewFixture();
		const firstClip = createLastWordsQpcSubtitle(0, 999, 71, 10, 3, 5);
		const secondClip = createLastWordsQpcSubtitle(1000, 1999, 71, 11, 0, 3);
		applyVisualMerge([firstClip, secondClip], 'arabic');
		const fixture = setupVideoOverlayFixture([firstClip, secondClip], { cursorPosition: 1100 });
		fixture.videoStyle.getStylesOfTarget('arabic').setStyle('font-family', 'QPC2');
		fixture.videoStyle.getStylesOfTarget('arabic').setStyle('show-verse-number', true);

		const component = render(VideoOverlay);
		await settleOverlay();

		const spans = getArabicInlineFlowSpans(component.container);
		const verseNumberSpans = getArabicVerseNumberSpans(component.container);
		expect(normalizeText(getForegroundArabicNode(component.container)?.textContent)).toBe(
			'ﳆ ﳇ ﳈ ﳉ ﱁ ﱂ ﱃ ﱄ ﱅ'
		);
		expect(spans.map((span) => span.getAttribute('style'))).toEqual([
			expect.stringContaining('font-family: QPC2_p570'),
			expect.stringContaining('font-family: QPC2_p570'),
			expect.stringContaining('font-family: QPC2_p571'),
			expect.stringContaining('font-family: QPC2_p571')
		]);
		expect(verseNumberSpans.map((span) => span.textContent)).toEqual([' ﳉ', ' ﱅ']);
		expect(verseNumberSpans.map((span) => span.getAttribute('style'))).toEqual([
			expect.stringContaining('font-family: QPC2_p570'),
			expect.stringContaining('font-family: QPC2_p571')
		]);
	});

	test('keeps QPC2 verse-number fonts when merged verses stay on the same page', async () => {
		seedQpc2PreviewFixture();
		const firstClip = createLastWordsQpcSubtitle(0, 999, 1, 1, 0, 3);
		const secondClip = createLastWordsQpcSubtitle(1000, 1999, 1, 2, 0, 3);
		applyVisualMerge([firstClip, secondClip], 'arabic');
		const fixture = setupVideoOverlayFixture([firstClip, secondClip], { cursorPosition: 1100 });
		fixture.videoStyle.getStylesOfTarget('arabic').setStyle('font-family', 'QPC2');
		fixture.videoStyle.getStylesOfTarget('arabic').setStyle('show-verse-number', true);

		const component = render(VideoOverlay);
		await settleOverlay();

		const verseNumberSpans = getArabicVerseNumberSpans(component.container);
		expect(verseNumberSpans).toHaveLength(2);
		expect(verseNumberSpans.map((span) => span.textContent)).toEqual([' ﱅ', ' ﱊ']);
		expect(
			verseNumberSpans.every((span) => span.getAttribute('style')?.includes('QPC2_p001'))
		).toBe(true);
	});

	test('keeps QPC2 verse-number fonts on merged clips with arabic inline styles', async () => {
		seedQpc2PreviewFixture();
		const firstClip = createLastWordsQpcSubtitle(0, 999, 71, 10, 3, 5);
		const secondClip = createLastWordsQpcSubtitle(1000, 1999, 71, 11, 0, 3);
		firstClip.toggleArabicInlineStyles(0, 0, {
			bold: true,
			italic: false,
			underline: false,
			color: null
		});
		secondClip.toggleArabicInlineStyles(0, 1, {
			bold: false,
			italic: false,
			underline: true,
			color: '#ff0000'
		});
		applyVisualMerge([firstClip, secondClip], 'arabic');
		const fixture = setupVideoOverlayFixture([firstClip, secondClip], { cursorPosition: 1100 });
		fixture.videoStyle.getStylesOfTarget('arabic').setStyle('font-family', 'QPC2');
		fixture.videoStyle.getStylesOfTarget('arabic').setStyle('show-verse-number', true);

		const component = render(VideoOverlay);
		await settleOverlay();

		const verseNumberSpans = getArabicVerseNumberSpans(component.container);
		expect(verseNumberSpans).toHaveLength(2);
		expect(verseNumberSpans.map((span) => span.getAttribute('style'))).toEqual([
			expect.stringContaining('font-family: QPC2_p570'),
			expect.stringContaining('font-family: QPC2_p571')
		]);
		expect(
			verseNumberSpans.every((span) => !span.getAttribute('style')?.includes('font-weight'))
		).toBe(true);
	});

	test('keeps Tajweed verse-number fonts per page on merged QPC2 glyphs', async () => {
		seedQpc2PreviewFixture();
		const firstClip = createLastWordsQpcSubtitle(0, 999, 71, 10, 3, 5);
		const secondClip = createLastWordsQpcSubtitle(1000, 1999, 71, 11, 0, 3);
		applyVisualMerge([firstClip, secondClip], 'arabic');
		const fixture = setupVideoOverlayFixture([firstClip, secondClip], { cursorPosition: 1100 });
		fixture.videoStyle.getStylesOfTarget('arabic').setStyle('mushaf-style', 'Tajweed');
		fixture.videoStyle.getStylesOfTarget('arabic').setStyle('show-verse-number', true);

		const component = render(VideoOverlay);
		await settleOverlay();

		expect(
			getArabicVerseNumberSpans(component.container).map((span) => span.getAttribute('style'))
		).toEqual([
			expect.stringContaining('font-family: p570-v4, QPC2_p570'),
			expect.stringContaining('font-family: p571-v4, QPC2_p571')
		]);
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
		const firstClip = createVerseSubtitle(
			500,
			700,
			'First Background',
			'First background translation'
		);
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

describe('Decorative brackets', () => {
	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
		globalState.currentProject = null;
		globalState.settings = undefined;
	});

	test('shows decorative brackets when enabled', async () => {
		const fixture = setupVideoOverlayFixture(
			[createVerseSubtitle(0, 999, 'Test Arabic', 'Test translation')],
			{ cursorPosition: 500 }
		);
		fixture.videoStyle.getStylesOfTarget('arabic').setStyle('show-decorative-brackets', true);

		const component = render(VideoOverlay);
		await settleOverlay();

		const arabicNode = getForegroundArabicNode(component.container);
		expect(arabicNode).not.toBeNull();
		const bracketSpans = arabicNode!.querySelectorAll('span[style*="QPC2BSML"]');
		expect(bracketSpans.length).toBe(2); // ouvrant + fermant
	});

	test('does not show decorative brackets when disabled', async () => {
		const fixture = setupVideoOverlayFixture(
			[createVerseSubtitle(0, 999, 'Test Arabic', 'Test translation')],
			{ cursorPosition: 500 }
		);
		fixture.videoStyle.getStylesOfTarget('arabic').setStyle('show-decorative-brackets', false);

		const component = render(VideoOverlay);
		await settleOverlay();

		const arabicNode = getForegroundArabicNode(component.container);
		expect(arabicNode).not.toBeNull();
		const bracketSpans = arabicNode!.querySelectorAll('span[style*="QPC2BSML"]');
		expect(bracketSpans.length).toBe(0);
	});

	test('shows configured bracket glyph pair (NO)', async () => {
		const fixture = setupVideoOverlayFixture(
			[createVerseSubtitle(0, 999, 'Test Arabic', 'Test translation')],
			{ cursorPosition: 500 }
		);
		fixture.videoStyle.getStylesOfTarget('arabic').setStyle('show-decorative-brackets', true);
		fixture.videoStyle
			.getStylesOfTarget('arabic')
			.setStyle('decorative-brackets-font-family', 'NO');

		const component = render(VideoOverlay);
		await settleOverlay();

		const arabicNode = getForegroundArabicNode(component.container);
		expect(arabicNode).not.toBeNull();
		const text = normalizeText(arabicNode!.textContent);
		expect(text).toMatch(/^N\s.*\sO$/);
	});

	test('falls back to LM pair when bracket style is not explicitly set', async () => {
		const fixture = setupVideoOverlayFixture(
			[createVerseSubtitle(0, 999, 'Test Arabic', 'Test translation')],
			{ cursorPosition: 500 }
		);
		fixture.videoStyle.getStylesOfTarget('arabic').setStyle('show-decorative-brackets', true);

		const component = render(VideoOverlay);
		await settleOverlay();

		const arabicNode = getForegroundArabicNode(component.container);
		const text = normalizeText(arabicNode!.textContent);
		expect(text).toMatch(/^L\s.*\sM$/);
	});
});

describe('Overlay effect', () => {
	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
		globalState.currentProject = null;
		globalState.settings = undefined;
	});

	test('shows overlay layer when enabled', async () => {
		const fixture = setupVideoOverlayFixture(
			[createVerseSubtitle(0, 999, 'Arabic', 'Translation')],
			{ cursorPosition: 500 }
		);
		const globalStyles = fixture.videoStyle.getStylesOfTarget('global');
		globalStyles.setStyle('overlay-enable', true);
		globalStyles.setStyle('overlay-opacity', 0.5);
		globalStyles.setStyle('overlay-color', '#FF0000');

		const component = render(VideoOverlay);
		await settleOverlay();

		// La couche d'overlay est le premier div avec backdrop-filter ou background-color
		const overlayEl = component.container.querySelector(
			'#overlay > div[style*="background-color"]'
		);
		expect(overlayEl).not.toBeNull();
	});

	test('does not show overlay when disabled', async () => {
		const fixture = setupVideoOverlayFixture(
			[createVerseSubtitle(0, 999, 'Arabic', 'Translation')],
			{ cursorPosition: 500 }
		);
		fixture.videoStyle.getStylesOfTarget('global').setStyle('overlay-enable', false);

		const component = render(VideoOverlay);
		await settleOverlay();

		const blurEls = component.container.querySelectorAll('[style*="backdrop-filter"]');
		expect(blurEls.length).toBe(0);
	});

	test('applies blur when overlay is enabled', async () => {
		const fixture = setupVideoOverlayFixture(
			[createVerseSubtitle(0, 999, 'Arabic', 'Translation')],
			{ cursorPosition: 500 }
		);
		const globalStyles = fixture.videoStyle.getStylesOfTarget('global');
		globalStyles.setStyle('overlay-enable', true);
		globalStyles.setStyle('overlay-blur', 5);

		const component = render(VideoOverlay);
		await settleOverlay();

		const blurEl = component.container.querySelector('[style*="backdrop-filter"]');
		expect(blurEl).not.toBeNull();
		expect(blurEl!.getAttribute('style')).toContain('blur(5px)');
	});

	test('applies gradient overlay for fade-up mode', async () => {
		const fixture = setupVideoOverlayFixture(
			[createVerseSubtitle(0, 999, 'Arabic', 'Translation')],
			{ cursorPosition: 500 }
		);
		const globalStyles = fixture.videoStyle.getStylesOfTarget('global');
		globalStyles.setStyle('overlay-enable', true);
		globalStyles.setStyle('background-overlay-mode', 'fade-up');
		globalStyles.setStyle('overlay-opacity', 1);

		const component = render(VideoOverlay);
		await settleOverlay();

		const overlayEl = component.container.querySelector('#overlay > div[style*="linear-gradient"]');
		expect(overlayEl).not.toBeNull();
	});
});

describe('Subtitle opacity / fade', () => {
	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
		globalState.currentProject = null;
		globalState.settings = undefined;
	});

	test('subtitle is fully opaque in the middle of its time range', async () => {
		const _fixture = setupVideoOverlayFixture(
			[createVerseSubtitle(0, 1000, 'Arabic', 'Translation')],
			{ cursorPosition: 500 }
		);

		const component = render(VideoOverlay);
		await settleOverlay();

		const arabicNode = getForegroundArabicNode(component.container);
		expect(arabicNode).not.toBeNull();
		expect(Number(arabicNode!.style.opacity)).toBe(1);
	});

	test('subtitle fades in at the beginning of its time range', async () => {
		const _fixture = setupVideoOverlayFixture(
			[createVerseSubtitle(0, 1000, 'Arabic', 'Translation')],
			{ cursorPosition: 50 }
		);

		const component = render(VideoOverlay);
		await settleOverlay();

		const arabicNode = getForegroundArabicNode(component.container);
		expect(arabicNode).not.toBeNull();
		const opacity = Number(arabicNode!.style.opacity);
		expect(opacity).toBeGreaterThan(0);
		expect(opacity).toBeLessThan(1);
	});

	test('subtitle fades out at the end of its time range', async () => {
		const _fixture = setupVideoOverlayFixture(
			[createVerseSubtitle(0, 1000, 'Arabic', 'Translation')],
			{ cursorPosition: 950 }
		);

		const component = render(VideoOverlay);
		await settleOverlay();

		const arabicNode = getForegroundArabicNode(component.container);
		expect(arabicNode).not.toBeNull();
		const opacity = Number(arabicNode!.style.opacity);
		expect(opacity).toBeGreaterThan(0);
		expect(opacity).toBeLessThan(1);
	});

	test('subtitle opacity respects the configured opacity style value', async () => {
		const fixture = setupVideoOverlayFixture(
			[createVerseSubtitle(0, 1000, 'Arabic', 'Translation')],
			{ cursorPosition: 500 }
		);
		fixture.videoStyle.getStylesOfTarget('arabic').setStyle('opacity', 0.7);

		const component = render(VideoOverlay);
		await settleOverlay();

		const arabicNode = getForegroundArabicNode(component.container);
		expect(Number(arabicNode!.style.opacity)).toBe(0.7);
	});
});

describe('Alignment grid', () => {
	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
		globalState.currentProject = null;
		globalState.settings = undefined;
	});

	test('does not show alignment grid by default in VideoEditor tab', async () => {
		setupVideoOverlayFixture([createVerseSubtitle(0, 999, 'Arabic', 'Translation')], {
			cursorPosition: 500
		});

		const component = render(VideoOverlay);
		await settleOverlay();

		const gridEl = component.container.querySelector('.alignment-overlay');
		expect(gridEl).toBeNull();
	});

	test('shows alignment grid when enabled in Style tab', async () => {
		const _fixture = setupVideoOverlayFixture(
			[createVerseSubtitle(0, 999, 'Arabic', 'Translation')],
			{ cursorPosition: 500 }
		);
		globalState.currentProject!.projectEditorState.currentTab = ProjectEditorTabs.Style;
		globalState.getVideoPreviewState.showAlignmentGrid = true;

		const component = render(VideoOverlay);
		await settleOverlay();

		const gridEl = component.container.querySelector('.alignment-overlay');
		expect(gridEl).not.toBeNull();
	});
});

describe('Subtitle image', () => {
	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
		globalState.currentProject = null;
		globalState.settings = undefined;
	});

	test('does not show image when subtitle has no associated image', async () => {
		setupVideoOverlayFixture([createVerseSubtitle(0, 999, 'Arabic', 'Translation')], {
			cursorPosition: 500
		});

		const component = render(VideoOverlay);
		await settleOverlay();

		const imgEls = component.container.querySelectorAll('[style*="background-image"]');
		expect(imgEls.length).toBe(0);
	});
});

describe('Word-by-word highlight', () => {
	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
		globalState.currentProject = null;
		globalState.settings = undefined;
	});

	test('renders standard arabic flow without WBW when disabled', async () => {
		const _fixture = setupVideoOverlayFixture(
			[createVerseSubtitle(0, 999, 'Simple Arabic Text', 'Translation')],
			{ cursorPosition: 500 }
		);

		const component = render(VideoOverlay);
		await settleOverlay();

		const arabicNode = getForegroundArabicNode(component.container);
		expect(arabicNode).not.toBeNull();
		const wbwFlow = arabicNode!.querySelector('.arabic-wbw-flow');
		expect(wbwFlow).toBeNull();
	});

	test('renders predefined subtitle text in a single segment', async () => {
		const basmala = createPredefinedSubtitle(0, 999, 'Basmala', 'Translation');
		setupVideoOverlayFixture([basmala], { cursorPosition: 500 });

		const component = render(VideoOverlay);
		await settleOverlay();

		const arabicNode = getForegroundArabicNode(component.container);
		expect(arabicNode).not.toBeNull();
		expect(normalizeText(arabicNode!.textContent)).toBe(normalizeText(basmala.getText()));
	});

	test('falls back to standard arabic when a merged group has partial WBW timestamps', async () => {
		const firstClip = createVerseSubtitle(0, 999, 'Alpha Beta', 'Alpha translation');
		const secondClip = createVerseSubtitle(1000, 1999, 'Gamma Delta', 'Beta translation');
		firstClip.alignmentMetadata = {
			source: 'local',
			segment: 0,
			refFrom: '1:1:1',
			refTo: '1:1:2',
			matchedText: firstClip.text,
			timeFrom: 0,
			timeTo: 1,
			words: [
				{ location: '1:1:1', start: 0, end: 0.5 },
				{ location: '1:1:2', start: 0.5, end: 1 }
			]
		};
		applyVisualMerge([firstClip, secondClip], 'arabic');
		const fixture = setupVideoOverlayFixture([firstClip, secondClip], { cursorPosition: 500 });
		fixture.videoStyle.getStylesOfTarget('arabic').setStyle('enable-wbw-highlight', true);

		const component = render(VideoOverlay);
		await settleOverlay();

		const arabicNode = getForegroundArabicNode(component.container);
		expect(arabicNode).not.toBeNull();
		expect(arabicNode!.querySelector('.arabic-wbw-flow')).toBeNull();
		expect(normalizeText(arabicNode!.textContent)).toContain('Alpha Beta');
	});
});

describe('Translation inline styles', () => {
	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
		globalState.currentProject = null;
		globalState.settings = undefined;
	});

	test('renders translation with bold inline style', async () => {
		const clip = new SubtitleClip(0, 999, 1, 1, 0, 2, 'Arabic text', [], false, false, {
			english: new VerseTranslation('Bold translation word', 'reviewed')
		});
		const verseTrans = clip.translations['english'] as VerseTranslation;
		verseTrans.inlineStyleRuns = [
			{
				startWordIndex: 0,
				endWordIndex: 0,
				bold: true,
				italic: false,
				underline: false,
				color: null
			}
		];
		setupVideoOverlayFixture([clip], { cursorPosition: 500 });

		const component = render(VideoOverlay);
		await settleOverlay();

		const translationNode = getForegroundTranslationNode(component.container, 'english');
		expect(translationNode).not.toBeNull();
		const boldSpan = translationNode!.querySelector('span[style*="font-weight: 700"]');
		expect(boldSpan).not.toBeNull();
	});

	test('renders translation with color inline style', async () => {
		const clip = new SubtitleClip(0, 999, 1, 1, 0, 1, 'Arabic', [], false, false, {
			english: new VerseTranslation('Colored word', 'reviewed')
		});
		const verseTrans = clip.translations['english'] as VerseTranslation;
		verseTrans.inlineStyleRuns = [
			{
				startWordIndex: 0,
				endWordIndex: 0,
				bold: false,
				italic: false,
				underline: false,
				color: '#FF0000'
			}
		];
		setupVideoOverlayFixture([clip], { cursorPosition: 500 });

		const component = render(VideoOverlay);
		await settleOverlay();

		const translationNode = getForegroundTranslationNode(component.container, 'english');
		expect(translationNode).not.toBeNull();
		expect(translationNode!.innerHTML).toContain('color: rgb(255, 0, 0)');
	});
});
