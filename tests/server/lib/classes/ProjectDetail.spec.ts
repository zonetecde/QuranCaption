import { describe, expect, it } from 'vitest';

import { ProjectDetail } from '$lib/classes';

describe('ProjectDetail metadata', () => {
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

	it('rejects unsupported project types when deserializing', () => {
		const detail = new ProjectDetail('Friday khutbah', 'Shaykh Ahmad');
		const serialized = {
			...(detail.toJSON() as Record<string, unknown>),
			projectType: 'Unsupported type'
		};

		const restored = ProjectDetail.fromJSON(serialized) as ProjectDetail;

		expect(restored.projectType).toBe('Lecture / Course');
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
