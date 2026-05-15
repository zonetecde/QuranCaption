import { describe, expect, it } from 'vitest';

import {
	getRukuDefinitionsForSurah,
	getRukuExportTargets,
	type RukuSourceClip
} from '$lib/services/RukuExportService';

describe('getRukuDefinitionsForSurah', () => {
	it('builds ruku ranges from inclusive end ayahs', () => {
		expect(getRukuDefinitionsForSurah(2).slice(0, 3)).toEqual([
			{ surah: 2, rukuNumber: 1, startAyah: 1, endAyah: 7 },
			{ surah: 2, rukuNumber: 2, startAyah: 8, endAyah: 20 },
			{ surah: 2, rukuNumber: 3, startAyah: 21, endAyah: 29 }
		]);
	});
});

describe('getRukuExportTargets', () => {
	it('groups split subtitle clips by verse before creating a ruku target', () => {
		const clips: RukuSourceClip[] = [
			{ surah: 2, verse: 1, startTime: 0, endTime: 99 },
			{ surah: 2, verse: 2, startTime: 100, endTime: 199 },
			{ surah: 2, verse: 3, startTime: 200, endTime: 249 },
			{ surah: 2, verse: 3, startTime: 250, endTime: 399 },
			{ surah: 2, verse: 4, startTime: 400, endTime: 499 },
			{ surah: 2, verse: 5, startTime: 500, endTime: 599 },
			{ surah: 2, verse: 6, startTime: 600, endTime: 699 },
			{ surah: 2, verse: 7, startTime: 700, endTime: 799 }
		];

		expect(getRukuExportTargets(clips, 0, 1_000, 0)).toEqual([
			{
				surah: 2,
				rukuNumber: 1,
				startAyah: 1,
				endAyah: 7,
				startTime: 0,
				endTime: 799
			}
		]);
	});

	it('skips a ruku when any ayah in the ruku is missing', () => {
		const clips: RukuSourceClip[] = [
			{ surah: 2, verse: 1, startTime: 0, endTime: 99 },
			{ surah: 2, verse: 2, startTime: 100, endTime: 199 },
			{ surah: 2, verse: 4, startTime: 400, endTime: 499 },
			{ surah: 2, verse: 5, startTime: 500, endTime: 599 },
			{ surah: 2, verse: 6, startTime: 600, endTime: 699 },
			{ surah: 2, verse: 7, startTime: 700, endTime: 799 }
		];

		expect(getRukuExportTargets(clips, 0, 1_000, 0)).toEqual([]);
	});

	it('keeps only complete rukus inside the selected export range', () => {
		const clips: RukuSourceClip[] = [
			{ surah: 1, verse: 1, startTime: 0, endTime: 99 },
			{ surah: 1, verse: 2, startTime: 100, endTime: 199 },
			{ surah: 1, verse: 3, startTime: 200, endTime: 299 },
			{ surah: 1, verse: 4, startTime: 300, endTime: 399 },
			{ surah: 1, verse: 5, startTime: 400, endTime: 499 },
			{ surah: 1, verse: 6, startTime: 500, endTime: 599 },
			{ surah: 1, verse: 7, startTime: 600, endTime: 699 }
		];

		expect(getRukuExportTargets(clips, 100, 1_000, 0)).toEqual([]);
	});
});
