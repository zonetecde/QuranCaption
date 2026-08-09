import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	createPrivateReflectionNote,
	deriveQuranReflectionContext,
	getCuratedReflections,
	getReflectionSubmissionScopes,
	hasReflectionSubmissionScopes,
	parsePendingQuranReflection,
	publishReflectionNote,
	shouldPromptForReflection
} from '$lib/services/QuranReflectionService';

const verseCounts = { 1: 7, 2: 286, 18: 110 };

afterEach(() => vi.unstubAllGlobals());

describe('Quran reflection export ranges', () => {
	it('derives a short one-surah range from clips inside the export interval', () => {
		const context = deriveQuranReflectionContext(
			[
				{ startTime: 0, endTime: 999, surah: 18, verse: 9 },
				{ startTime: 1000, endTime: 2000, surah: 18, verse: 10 },
				{ startTime: 2000, endTime: 3000, surah: 18, verse: 11 }
			],
			1000,
			3000,
			verseCounts
		);
		expect(context?.surahs[0]).toMatchObject({
			surah: 18,
			firstAyah: 10,
			lastAyah: 11,
			ranges: [{ from: 10, to: 11 }],
			wholeSurah: false
		});
	});

	it('recognizes a whole surah', () => {
		const clips = Array.from({ length: 7 }, (_, index) => ({
			startTime: index * 1000,
			endTime: (index + 1) * 1000,
			surah: 1,
			verse: index + 1
		}));
		expect(deriveQuranReflectionContext(clips, 0, 7000, verseCounts)?.surahs[0].wholeSurah).toBe(
			true
		);
	});

	it('deprioritizes Al-Fatiha when several surahs are exported', () => {
		const context = deriveQuranReflectionContext(
			[
				{ startTime: 0, endTime: 1000, surah: 1, verse: 1 },
				{ startTime: 1000, endTime: 2000, surah: 2, verse: 1 }
			],
			0,
			2000,
			verseCounts
		);
		expect(context?.multiSurah).toBe(true);
		expect(context?.surahs.map((item) => item.surah)).toEqual([2, 1]);
	});

	it('keeps discontinuous ayat as separate selectable spans', () => {
		const context = deriveQuranReflectionContext(
			[
				{ startTime: 0, endTime: 1000, surah: 2, verse: 1 },
				{ startTime: 1000, endTime: 2000, surah: 2, verse: 2 },
				{ startTime: 2000, endTime: 3000, surah: 2, verse: 5 }
			],
			0,
			3000,
			verseCounts
		);
		expect(context?.surahs[0].ranges).toEqual([
			{ from: 1, to: 2 },
			{ from: 5, to: 5 }
		]);
	});

	it('removes clips fully covered by export skip ranges', () => {
		const context = deriveQuranReflectionContext(
			[
				{ startTime: 0, endTime: 1000, surah: 2, verse: 1 },
				{ startTime: 1000, endTime: 2000, surah: 2, verse: 2 }
			],
			0,
			2000,
			verseCounts,
			[{ startTime: 0, endTime: 1000 }]
		);
		expect(context?.surahs[0].ranges).toEqual([{ from: 2, to: 2 }]);
	});

	it('returns null when no Quran subtitle is included', () => {
		expect(deriveQuranReflectionContext([], 0, 1000, verseCounts)).toBeNull();
	});

	it('prompts when a Quran video export operation is first queued', () => {
		const context = deriveQuranReflectionContext(
			[{ startTime: 0, endTime: 1000, surah: 1, verse: 1 }],
			0,
			1000,
			verseCounts
		);
		expect(shouldPromptForReflection(undefined, 'Capturing Frames', 'Video', context)).toBe(true);
		expect(shouldPromptForReflection(undefined, 'Pending', 'Video', context)).toBe(true);
		expect(shouldPromptForReflection(undefined, 'Error', 'Video', context)).toBe(false);
		expect(shouldPromptForReflection(undefined, 'Canceled', 'Video', context)).toBe(false);
		expect(shouldPromptForReflection(undefined, 'Capturing Frames', 'Video', null)).toBe(false);
		expect(shouldPromptForReflection('Capturing Frames', 'Creating Video', 'Video', context)).toBe(
			false
		);
	});
});

describe('Quran reflection OAuth continuity', () => {
	it('distinguishes disconnected, missing-scope, private and public permissions', () => {
		expect(getReflectionSubmissionScopes('private')).toEqual(['note.create']);
		expect(getReflectionSubmissionScopes('public')).toEqual(['note.create', 'note.publish']);
		expect(hasReflectionSubmissionScopes([], 'private')).toBe(false);
		expect(hasReflectionSubmissionScopes(['bookmark', 'note.create'], 'private')).toBe(true);
		expect(hasReflectionSubmissionScopes(['note.create'], 'public')).toBe(false);
		expect(hasReflectionSubmissionScopes(['note'], 'public')).toBe(true);
	});

	it('restores the draft, range and requested action after OAuth', () => {
		const context = deriveQuranReflectionContext(
			[{ startTime: 0, endTime: 1000, surah: 2, verse: 5 }],
			0,
			1000,
			verseCounts
		)!;
		const restored = parsePendingQuranReflection(
			JSON.stringify({
				context,
				surah: 2,
				spanIndex: 0,
				from: 5,
				to: 5,
				draft: 'Preserved reflection',
				action: 'public',
				noteId: 'private-note-created-before-error',
				selectionMode: 'whole'
			})
		);
		expect(restored).toMatchObject({
			draft: 'Preserved reflection',
			action: 'public',
			noteId: 'private-note-created-before-error',
			selectionMode: 'whole',
			from: 5,
			to: 5
		});
		expect(
			parsePendingQuranReflection(
				JSON.stringify({ ...restored, selectionMode: 'single', from: 5, to: 5 })
			)?.selectionMode
		).toBe('single');
	});

	it('rejects corrupt pending reflection state', () => {
		expect(parsePendingQuranReflection('{broken')).toBeNull();
		expect(parsePendingQuranReflection(JSON.stringify({ draft: 'missing range' }))).toBeNull();
		expect(
			parsePendingQuranReflection(
				JSON.stringify({
					context: { surahs: [{}] },
					surah: 1,
					from: 1,
					to: 1,
					draft: '',
					action: null,
					selectionMode: 'invalid'
				})
			)
		).toBeNull();
	});
});

describe('Quran reflection API client', () => {
	it('loads curated reflections and tolerates an empty feed', async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					reflections: [
						{
							id: 1,
							body: 'Reflection',
							author: 'Contributor',
							avatarUrl: 'https://cdn.quranreflect.com/avatar.jpg',
							url: 'https://quranreflect.com/posts/1',
							likesCount: 0,
							language: 'English'
						}
					]
				}),
				{ status: 200 }
			)
		);
		vi.stubGlobal('fetch', fetchMock);
		await expect(getCuratedReflections(18, 10, 17, 'en')).resolves.toHaveLength(1);
	});

	it('rejects curated feed failures without coupling them to export state', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 502 })));
		await expect(getCuratedReflections(18, 10, 17, 'en')).rejects.toThrow('HTTP 502');
	});

	it('submits private notes and publishes existing notes without exposing the draft elsewhere', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ success: true, data: { id: 'note-1' } }), { status: 201 })
			)
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ success: true, data: { success: true, postId: 9 } }), {
					status: 200
				})
			);
		vi.stubGlobal('fetch', fetchMock);
		await createPrivateReflectionNote('token', 'My reflection', 2, 1, 2);
		await publishReflectionNote('token', 'note-1', 'My reflection', 2, 1, 286, true);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(fetchMock.mock.calls[0][1].headers.authorization).toBe('Bearer token');
		expect(String(fetchMock.mock.calls[1][0])).toContain('/notes/note-1/publish');
		expect(JSON.parse(String(fetchMock.mock.calls[1][1].body))).toMatchObject({
			chapterId: 2,
			wholeSurah: true
		});
	});
});
