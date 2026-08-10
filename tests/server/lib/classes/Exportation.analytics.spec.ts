import { afterEach, describe, expect, it, vi } from 'vitest';
import Exportation, { ExportKind, ExportState } from '$lib/classes/Exportation.svelte';
import { AnalyticsService, type AnalyticsWorkflow } from '$lib/services/AnalyticsService';

afterEach(() => vi.restoreAllMocks());

describe('video export analytics terminal guard', () => {
	it('emits only the first terminal transition with an allowlisted failure stage', () => {
		const workflow: AnalyticsWorkflow = { workflowId: 'export-1', startedAt: 100 };
		vi.spyOn(AnalyticsService, 'trackVideoExportStarted').mockReturnValue(workflow);
		const failed = vi
			.spyOn(AnalyticsService, 'trackVideoExportFailed')
			.mockImplementation(() => undefined);
		const canceled = vi
			.spyOn(AnalyticsService, 'trackVideoExportCanceled')
			.mockImplementation(() => undefined);
		const exportation = new Exportation(
			1,
			'private-name.mp4',
			'C:\\Users\\private\\private-name.mp4',
			{ width: 1920, height: 1080 },
			0,
			10_000,
			'1:1-1:7',
			ExportState.CapturingFrames,
			30,
			0,
			0,
			'',
			ExportKind.Video
		);

		exportation.startAnalytics({ video_width: 1920, video_height: 1080 });
		expect(
			exportation.trackAnalyticsTerminal(ExportState.Error, {
				failureStage: ExportState.CapturingFrames
			})
		).toBe(true);
		expect(
			exportation.trackAnalyticsTerminal(ExportState.Canceled, {
				cancelSource: 'export_monitor'
			})
		).toBe(false);

		expect(failed).toHaveBeenCalledTimes(1);
		expect(failed).toHaveBeenCalledWith(
			workflow,
			expect.objectContaining({
				failure_stage: 'capturing_frames',
				video_width: 1920,
				video_height: 1080
			})
		);
		expect(JSON.stringify(failed.mock.calls[0][1])).not.toMatch(/private-name|Users|path/i);
		expect(canceled).not.toHaveBeenCalled();
	});
});
