import { beforeEach, describe, expect, it } from 'vitest';
import { initializeClassRegistry } from '$lib/classes/ClassRegistry';
import { SubtitleClip } from '$lib/classes/Clip.svelte';
import { QuranSubtitleClip } from '$lib/compatibility/QuranSubtitleClip.svelte';
import { SubtitleTrack } from '$lib/classes/Track.svelte';
import { VerseTranslation } from '$lib/classes/Translation.svelte';

describe('Minbar subtitle model', () => {
	beforeEach(() => initializeClassRegistry());

	it('constructs free text without Quran fields or implicit project translations', () => {
		const clip = new SubtitleClip(100, 900, 'A lecture {{2:255}}', 'Speaker');
		expect(clip.text).toBe('A lecture {{2:255}}');
		expect(clip.speaker).toBe('Speaker');
		expect(clip.translations).toEqual({});
		for (const key of ['surah', 'verse', 'startWordIndex', 'wbwTranslation', 'isFullVerse']) {
			expect(clip.toJSON()).not.toHaveProperty(key);
		}
	});

	it('cleans obsolete Quran defaults from saved Minbar clips without mutating their data', () => {
		const stored = {
			...new SubtitleClip(100, 900, 'Lecture', 'Speaker').toJSON(),
			surah: 0,
			verse: 0,
			wbwTranslation: []
		};
		const clip = SubtitleClip.fromJSON(stored);
		expect(clip).toBeInstanceOf(SubtitleClip);
		expect(clip).not.toBeInstanceOf(QuranSubtitleClip);
		expect(clip.toJSON()).not.toHaveProperty('surah');
		expect(stored).toHaveProperty('surah', 0);
	});

	it('restores old Quran projects through the engine adapter, including nested translations', () => {
		const legacy = new QuranSubtitleClip(100, 900, 2, 255, 0, 2, 'Quran', [], false, false, {
			english: new VerseTranslation('Translation', 'reviewed')
		}).toJSON();
		legacy.__className = 'SubtitleClip';
		const track = SubtitleTrack.fromJSON<SubtitleTrack>({
			__className: 'SubtitleTrack',
			clips: [legacy]
		});
		const clip = track.clips[0];
		expect(clip).toBeInstanceOf(QuranSubtitleClip);
		if (!(clip instanceof QuranSubtitleClip)) throw new Error('Missing Quran adapter');
		expect(clip.getVerseKey()).toBe('2:255');
		expect(clip.translations.english).toBeInstanceOf(VerseTranslation);
		expect(clip.translations.english.text).toBe('Translation');
	});

	it('clones the adapter without sharing translations or losing its verse range', () => {
		const original = new QuranSubtitleClip(100, 900, 2, 255, 0, 2, 'Quran', [], false, false, {
			english: new VerseTranslation('Translation', 'reviewed')
		});
		const clone = original.cloneWithTimes(200, 800);
		expect(clone).toBeInstanceOf(QuranSubtitleClip);
		expect(clone.getVerseKey()).toBe('2:255');
		expect(clone.text).toBe('Quran');
		expect([clone.startTime, clone.endTime]).toEqual([200, 800]);
		expect(clone.id).not.toBe(original.id);
		clone.translations.english.text = 'Changed';
		expect(original.translations.english.text).toBe('Translation');
	});
});
