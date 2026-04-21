import { describe, expect, it } from 'vitest';

import { ProjectDetail } from '$lib/classes';

describe('ProjectDetail project type', () => {
	it('defaults new projects to Others', () => {
		const detail = new ProjectDetail('Night 27', 'Muhammad Al Luhaidan');

		expect(detail.projectType).toBe('Others');
	});

	it('loads old serialized projects without projectType as Others', () => {
		const detail = new ProjectDetail('Night 27', 'Muhammad Al Luhaidan');
		const serialized = detail.toJSON() as Record<string, unknown>;
		delete serialized.projectType;

		const restored = ProjectDetail.fromJSON(serialized) as ProjectDetail;

		expect(restored.projectType).toBe('Others');
	});

	it('normalizes legacy project type values from serialized data', () => {
		const detail = new ProjectDetail('Night 27', 'Muhammad Al Luhaidan');
		const serialized = {
			...(detail.toJSON() as Record<string, unknown>),
			projectType: 'salat'
		};

		const restored = ProjectDetail.fromJSON(serialized) as ProjectDetail;

		expect(restored.projectType).toBe('Prayer');
	});

	it('matches search queries against the project type', () => {
		const detail = new ProjectDetail(
			'Taraweeh 27th night',
			'Muhammad Al Luhaidan',
			undefined,
			undefined,
			'Rare recitation'
		);

		expect(detail.matchSearchQuery('rare')).toBe(true);
		expect(detail.matchSearchQuery('recitation')).toBe(true);
	});
});
