import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/plugin-fs', async (importOriginal) => ({
	...(await importOriginal<typeof import('@tauri-apps/plugin-fs')>()),
	writeTextFile: vi.fn(async () => undefined)
}));
vi.mock('@tauri-apps/api/path', async (importOriginal) => ({
	...(await importOriginal<typeof import('@tauri-apps/api/path')>()),
	appDataDir: vi.fn(async () => '/app-data'),
	join: vi.fn(async (...parts: string[]) => parts.join('/'))
}));
vi.mock('@tauri-apps/plugin-opener', () => ({ openPath: vi.fn(async () => undefined) }));
vi.mock('@tauri-apps/api/event', async (importOriginal) => ({
	...(await importOriginal<typeof import('@tauri-apps/api/event')>()),
	listen: vi.fn(async () => vi.fn())
}));
vi.mock('$lib/services/ProjectService', () => ({
	ProjectService: { ensureFolder: vi.fn(async () => '/app-data/logs') }
}));

import { writeTextFile } from '@tauri-apps/plugin-fs';
import { openPath } from '@tauri-apps/plugin-opener';
import { listen } from '@tauri-apps/api/event';
import { ExportState } from '$lib/classes/Exportation.svelte';
import ExportService, { type ExportLogPayload } from '$lib/services/ExportService';

/**
 * Crée une ligne de log de capture avec des caractères UTF-8.
 * @param {number | string} exportId Identifiant d'export.
 * @param {string} message Message de la ligne.
 * @returns {ExportLogPayload} Ligne prête à être mise en tampon.
 */
function createLog(
	exportId: number | string,
	message = 'Capture réussie — القرآن'
): ExportLogPayload {
	return {
		exportId,
		timestamp: '2026-10-10T16:00:00.000Z',
		level: 'info',
		source: '123-capture-0',
		message
	};
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.clearAllMocks();
	vi.mocked(writeTextFile).mockResolvedValue(undefined);
});

afterEach(async () => {
	await ExportService.flushExportLogs();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('export log files', () => {
	it('groups a large multi-worker burst into one append per export without losing lines', async () => {
		for (let index = 0; index < 10_000; index++) {
			ExportService.bufferExportLog({
				...createLog(index % 2 === 0 ? 123 : 456, `Capture ${index} — القرآن`),
				source: `worker-${index % 4}`
			});
		}
		expect(writeTextFile).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(500);
		expect(writeTextFile).toHaveBeenCalledTimes(2);
		for (const [path, content, options] of vi.mocked(writeTextFile).mock.calls) {
			expect(path).toMatch(/\/app-data\/logs\/export_(123|456)\.txt$/);
			expect((content as string).split('\n')).toHaveLength(5001);
			expect(content).toContain('— القرآن');
			expect(options).toEqual({ append: true });
		}
		expect(vi.mocked(writeTextFile).mock.calls[0][1]).toContain('[info] [worker-0] Capture 0');
		expect(vi.mocked(writeTextFile).mock.calls[1][1]).toContain('[info] [worker-1] Capture 1');
		await vi.advanceTimersByTimeAsync(500);
		expect(writeTextFile).toHaveBeenCalledTimes(2);
	});

	it('writes the last small batch after 500 ms without opening the monitor', async () => {
		ExportService.bufferExportLog(createLog('123'));
		await vi.advanceTimersByTimeAsync(499);
		expect(writeTextFile).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(writeTextFile).toHaveBeenCalledExactlyOnceWith(
			'/app-data/logs/export_123.txt',
			'[2026-10-10T16:00:00.000Z] [info] [123-capture-0] Capture réussie — القرآن\n',
			{ append: true }
		);
	});

	it.each([ExportState.Exported, ExportState.Error, ExportState.Canceled])(
		'flushes logs received through the event listener immediately on %s',
		async (currentState) => {
			vi.spyOn(ExportService, 'saveExports').mockResolvedValue(undefined);
			ExportService.setupListener();
			const logHandler = vi
				.mocked(listen)
				.mock.calls.find(([event]) => event === 'export-log-main')?.[1];
			const progressHandler = vi
				.mocked(listen)
				.mock.calls.find(([event]) => event === 'export-progress-main')?.[1];
			expect(logHandler).toBeDefined();
			expect(progressHandler).toBeDefined();
			logHandler?.({ event: 'export-log-main', id: 1, payload: createLog(123, 'Last line') });
			progressHandler?.({
				event: 'export-progress-main',
				id: 2,
				payload: { exportId: 123, currentState, progress: 100, currentTime: 1000 }
			});
			await vi.advanceTimersByTimeAsync(0);
			expect(writeTextFile).toHaveBeenCalledTimes(1);
			expect(vi.mocked(writeTextFile).mock.calls[0][1]).toContain('Last line\n');
		}
	);

	it('keeps batches ordered when the disk is slower than incoming logs', async () => {
		let completeWrite: () => void = () => {};
		vi.mocked(writeTextFile).mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					completeWrite = resolve;
				})
		);
		ExportService.bufferExportLog(createLog(123, 'First'));
		const firstFlush = ExportService.flushExportLogs();
		await vi.advanceTimersByTimeAsync(0);
		expect(writeTextFile).toHaveBeenCalledTimes(1);
		ExportService.bufferExportLog(createLog(123, 'Second'));
		const secondFlush = ExportService.flushExportLogs();
		await vi.advanceTimersByTimeAsync(0);
		expect(writeTextFile).toHaveBeenCalledTimes(1);
		completeWrite();
		await Promise.all([firstFlush, secondFlush]);
		expect(writeTextFile).toHaveBeenCalledTimes(2);
		expect(vi.mocked(writeTextFile).mock.calls[0][1]).toContain('First\n');
		expect(vi.mocked(writeTextFile).mock.calls[1][1]).toContain('Second\n');
	});

	it('flushes pending and in-flight logs before opening the file', async () => {
		let completeWrite: () => void = () => {};
		vi.mocked(writeTextFile).mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					completeWrite = resolve;
				})
		);
		ExportService.bufferExportLog(createLog(123, 'First'));
		const firstFlush = ExportService.flushExportLogs();
		await vi.advanceTimersByTimeAsync(0);
		ExportService.bufferExportLog(createLog(123, 'Latest'));
		const opening = ExportService.openExportLogs(123);
		await vi.advanceTimersByTimeAsync(0);
		expect(openPath).not.toHaveBeenCalled();
		completeWrite();
		await Promise.all([firstFlush, opening]);
		expect(openPath).toHaveBeenCalledExactlyOnceWith('/app-data/logs/export_123.txt');
		expect(vi.mocked(writeTextFile).mock.calls[1][1]).toContain('Latest\n');
	});

	it('opens an existing file without truncating it after the export has finished', async () => {
		await ExportService.openExportLogs(123);
		expect(writeTextFile).not.toHaveBeenCalled();
		expect(openPath).toHaveBeenCalledExactlyOnceWith('/app-data/logs/export_123.txt');
	});

	it('continues writing future batches after an I/O failure', async () => {
		vi.mocked(writeTextFile).mockRejectedValueOnce(new Error('Disk error'));
		ExportService.bufferExportLog(createLog(123, 'Failed'));
		await expect(ExportService.flushExportLogs()).rejects.toThrow('Disk error');
		ExportService.bufferExportLog(createLog(123, 'Recovered'));
		await ExportService.flushExportLogs();
		expect(vi.mocked(writeTextFile).mock.calls[1][1]).toContain('Recovered\n');
	});

	it('reports timer write failures without failing the capture caller', async () => {
		const error = new Error('Disk error');
		vi.mocked(writeTextFile).mockRejectedValueOnce(error);
		const reportError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		expect(() => ExportService.bufferExportLog(createLog(123))).not.toThrow();
		await vi.advanceTimersByTimeAsync(500);
		expect(reportError).toHaveBeenCalledWith('Unable to write export logs:', error);
	});

	it('rejects invalid export identifiers before creating a path', async () => {
		for (const exportId of ['../other', -1, 0, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
			ExportService.bufferExportLog(createLog(exportId));
		}
		await ExportService.flushExportLogs();
		expect(writeTextFile).not.toHaveBeenCalled();
	});
});
