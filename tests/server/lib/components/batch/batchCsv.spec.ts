import { describe, expect, it } from 'vitest';

import { ProjectDetail } from '$lib/classes';
import { parseBatchCsv, validateBatchRows } from '$lib/components/batch/batchCsv';

describe('batch CSV parsing', () => {
	it('parses a valid CSV and preserves row order', () => {
		const result = parseBatchCsv(
			'project_name;reciter;source\nFirst;Reciter A;https://example.com/a\nSecond;Reciter B;C:\\Media\\b.mp3'
		);

		expect(result.errors).toEqual([]);
		expect(result.rows.map((row) => row.projectName)).toEqual(['First', 'Second']);
		expect(result.rows[1].source).toBe('C:\\Media\\b.mp3');
	});

	it.each([
		['UTF-8 BOM', '\uFEFFproject_name;reciter;source\nA;B;https://example.com'],
		['CRLF', 'project_name;reciter;source\r\nA;B;https://example.com\r\n'],
		['blank lines', 'project_name;reciter;source\n\nA;B;https://example.com\n\n'],
		['quoted fields', 'project_name;reciter;source\n"A; title";"B";"https://example.com"'],
		['empty final separator', 'project_name;reciter;source;\nA;B;https://example.com;']
	])('accepts %s', (_label, csv) => {
		const result = parseBatchCsv(csv);

		expect(result.errors).toEqual([]);
		expect(result.rows).toHaveLength(1);
	});

	it('rejects an invalid header', () => {
		const result = parseBatchCsv('name;reciter;source\nA;B;https://example.com');

		expect(result.errors).toContainEqual({ line: 1, code: 'invalid-header' });
	});

	it('rejects a missing column', () => {
		const result = parseBatchCsv('project_name;reciter;source\nA;B');

		expect(result.errors).toContainEqual({ line: 2, code: 'missing-column' });
	});

	it('rejects extra non-empty columns', () => {
		const result = parseBatchCsv('project_name;reciter;source\nA;B;C;D');

		expect(result.errors).toContainEqual({ line: 2, code: 'too-many-columns' });
	});
});

describe('batch CSV validation', () => {
	const existingFile = async () => true;

	it.each([
		['project-name-empty', { projectName: '', reciter: 'Reciter', source: 'C:\\a.mp3' }],
		['reciter-empty', { projectName: 'Project', reciter: '', source: 'C:\\a.mp3' }],
		['source-empty', { projectName: 'Project', reciter: 'Reciter', source: '' }],
		['project-name-unsafe', { projectName: 'Project?', reciter: 'Reciter', source: 'C:\\a.mp3' }],
		['reciter-unsafe', { projectName: 'Project', reciter: 'Reciter?', source: 'C:\\a.mp3' }],
		[
			'project-name-too-long',
			{
				projectName: 'P'.repeat(ProjectDetail.NAME_MAX_LENGTH + 1),
				reciter: 'Reciter',
				source: 'C:\\a.mp3'
			}
		],
		[
			'reciter-too-long',
			{
				projectName: 'Project',
				reciter: 'R'.repeat(ProjectDetail.RECITER_MAX_LENGTH + 1),
				source: 'C:\\a.mp3'
			}
		]
	] as const)('reports %s', async (code, values) => {
		const result = await validateBatchRows([{ line: 2, ...values }], existingFile);

		expect(result.errors.map((error) => error.code)).toContain(code);
	});

	it('rejects an invalid HTTP URL', async () => {
		const result = await validateBatchRows(
			[{ line: 2, projectName: 'Project', reciter: 'Reciter', source: 'https://[' }],
			existingFile
		);

		expect(result.errors).toContainEqual({ line: 2, code: 'invalid-url' });
	});

	it('rejects a missing local file', async () => {
		const result = await validateBatchRows(
			[{ line: 2, projectName: 'Project', reciter: 'Reciter', source: 'C:\\missing.mp3' }],
			async () => false
		);

		expect(result.errors).toContainEqual({ line: 2, code: 'file-not-found' });
	});

	it('rejects an unsupported local file extension', async () => {
		const result = await validateBatchRows(
			[{ line: 2, projectName: 'Project', reciter: 'Reciter', source: 'C:\\media.txt' }],
			existingFile
		);

		expect(result.errors).toContainEqual({ line: 2, code: 'unsupported-media' });
	});
});
