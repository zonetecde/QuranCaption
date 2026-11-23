import { cleanup, render } from 'vitest-browser-svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { tick } from 'svelte';
import { get } from 'svelte/store';
import LL, { setLocale } from '$lib/i18n/i18n-svelte';
import { loadLocale } from '$lib/i18n/i18n-util.sync';

const mocks = vi.hoisted(() => ({
	createNote: vi.fn(),
	publishNote: vi.fn(),
	track: vi.fn()
}));

vi.mock('$lib/services/AnalyticsService', () => ({
	AnalyticsService: { trackReflection: mocks.track }
}));
vi.mock('$lib/services/QuranAuthService.svelte', () => ({
	quranAuthService: {
		status: 'connected',
		grantedScopes: ['note.create', 'note.publish'],
		getAccessToken: vi.fn().mockResolvedValue('token')
	}
}));
vi.mock('$lib/services/QuranReflectionService', async (original) => ({
	...(await original<typeof import('$lib/services/QuranReflectionService')>()),
	createPrivateReflectionNote: mocks.createNote,
	publishReflectionNote: mocks.publishNote,
	getCuratedReflections: vi.fn().mockResolvedValue([])
}));
vi.mock('$lib/classes/Quran', () => ({
	Quran: { surahs: [{ id: 1, name: 'Al-Fatiha' }], getVerseCount: () => 7 }
}));
vi.mock('$lib/classes/Settings.svelte', () => ({ default: { save: vi.fn() } }));
vi.mock('$lib/classes/Exportation.svelte', () => ({ ExportState: {} }));
vi.mock('$lib/runes/main.svelte', () => ({
	globalState: { exportations: [], settings: { persistentUiState: {} }, uiState: {} }
}));

import QuranReflectionPrompt from '$lib/components/reflection/QuranReflectionPrompt.svelte';

beforeEach(() => {
	vi.clearAllMocks();
	sessionStorage.clear();
	loadLocale('en');
	setLocale('en');
	mocks.createNote.mockResolvedValue({ data: { id: 'note-1' } });
	mocks.publishNote.mockResolvedValue({ data: { postId: 9 } });
});

afterEach(async () => {
	await cleanup();
	sessionStorage.clear();
});

test.each(['private', 'public'] as const)(
	'stops automatic retries after a failed %s submission and preserves manual retry',
	async (mode) => {
		const failingRequest = mode === 'private' ? mocks.createNote : mocks.publishNote;
		failingRequest.mockRejectedValueOnce(new Error('HTTP 503'));
		sessionStorage.setItem(
			'quran_reflection_pending',
			JSON.stringify({
				context: {
					surahs: [
						{
							surah: 1,
							firstAyah: 1,
							lastAyah: 1,
							ranges: [{ from: 1, to: 1 }],
							wholeSurah: false
						}
					],
					multiSurah: false
				},
				surah: 1,
				spanIndex: 0,
				from: 1,
				to: 1,
				draft: 'Preserved reflection',
				action: mode,
				noteId: null,
				selectionMode: 'single'
			})
		);
		render(QuranReflectionPrompt);
		const dialog = await vi.waitFor(() => {
			const modal = document.querySelector<HTMLDialogElement>(
				'dialog[aria-labelledby="quran-reflection-title"]'
			);
			expect(modal?.querySelector('.text-red-400')).toBeTruthy();
			return modal!;
		});
		await tick();
		expect(failingRequest).toHaveBeenCalledTimes(1);
		expect(
			mocks.track.mock.calls.filter(([event]) => event === 'reflection_submit_failed')
		).toHaveLength(0);
		expect(JSON.parse(sessionStorage.getItem('quran_reflection_pending')!)).toMatchObject({
			draft: 'Preserved reflection',
			action: null,
			noteId: mode === 'public' ? 'note-1' : null
		});
		expect(dialog.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe(
			'Preserved reflection'
		);

		const label =
			mode === 'private' ? get(LL).export.reflectionPrivate() : get(LL).export.reflectionPublic();
		Array.from(dialog.querySelectorAll('button'))
			.find((button) => button.textContent?.includes(label))!
			.click();
		await vi.waitFor(() =>
			expect(mocks.track).toHaveBeenCalledWith(
				mode === 'private' ? 'reflection_private_saved' : 'reflection_public_published',
				expect.any(Object)
			)
		);
		expect(failingRequest).toHaveBeenCalledTimes(2);
		expect(mocks.createNote).toHaveBeenCalledTimes(mode === 'private' ? 2 : 1);
		expect(sessionStorage.getItem('quran_reflection_pending')).toBeNull();
	}
);
