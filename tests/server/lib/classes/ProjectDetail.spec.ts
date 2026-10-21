import { describe, expect, it } from 'vitest';

import { Edition, ProjectDetail, SubtitleClip, Timeline } from '$lib/classes';
import { SubtitleTrack } from '$lib/classes/Track.svelte';
import { VerseTranslation } from '$lib/classes/Translation.svelte';
import { globalState } from '$lib/runes/main.svelte';

describe('ProjectDetail metadata', () => {
	it('counts AI, manual and supplied translations in the translated percentage', () => {
		const detail = new ProjectDetail('Lecture', 'Speaker');
		const edition = new Edition('fr', 'fr', 'French', 'French', 'ltr', 'test', '', '', '');
		const track = new SubtitleTrack();
		for (const status of [
			'ai translated',
			'reviewed',
			'completed by default',
			'to translate'
		] as const) {
			const subtitle = new SubtitleClip(0, 1000, 'Source');
			subtitle.translations.fr = new VerseTranslation('Translation', status);
			track.clips.push(subtitle);
		}
		const previous = globalState.currentProject;
		try {
			globalState.currentProject = {
				detail,
				content: { timeline: new Timeline([track]) }
			} as never;
			expect(detail.getPercentageTranslated(edition)).toBe(75);
			detail.updatePercentageTranslated(edition);
			expect(detail.translations.French).toBe(75);
		} finally {
			globalState.currentProject = previous;
		}
	});
	it('defaults new projects to Lecture / Course', () => {
		const detail = new ProjectDetail('The importance of intention', 'Shaykh Ahmad');

		expect(detail.projectType).toBe('Lecture / Course');
	});

	it('allows project names up to 150 characters', () => {
		expect(ProjectDetail.NAME_MAX_LENGTH).toBe(150);
	});

	it('uses Unknown speaker when no speaker is provided', () => {
		const detail = new ProjectDetail('Friday khutbah', '');

		expect(detail.speaker).toBe('Unknown speaker');
	});

	it('preserves custom project types when deserializing', () => {
		const detail = new ProjectDetail('Friday khutbah', 'Shaykh Ahmad');
		const serialized = {
			...(detail.toJSON() as Record<string, unknown>),
			projectType: 'Unsupported type'
		};

		const restored = ProjectDetail.fromJSON(serialized) as ProjectDetail;

		expect(restored.projectType).toBe('Unsupported type');
	});

	it('matches search queries against speaker and content type', () => {
		const detail = new ProjectDetail(
			'Patience during hardship',
			'Shaykh Ahmad',
			undefined,
			undefined,
			'Khutbah'
		);

		expect(detail.matchSearchQuery('ahmad')).toBe(true);
		expect(detail.matchSearchQuery('khutbah')).toBe(true);
	});
});
