import { describe, expect, it } from 'vitest';
import {
	EXPORT_CAPTURE_MAX_ATTEMPTS,
	detectExportCapturePlatform,
	getCaptureAttemptTimeoutMs,
	shouldRetryCapture,
	shouldUseDataUrlFallback
} from '$lib/services/ExportCapturePolicy';

describe('ExportCapturePolicy', () => {
	it('detects macOS from the user agent', () => {
		expect(
			detectExportCapturePlatform(
				'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15'
			)
		).toBe('macos');
		expect(detectExportCapturePlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('other');
	});

	it('uses the expected timeout budgets by platform and attempt', () => {
		expect(getCaptureAttemptTimeoutMs('other', 1)).toBe(6_000);
		expect(getCaptureAttemptTimeoutMs('other', 2)).toBe(6_000);
		expect(getCaptureAttemptTimeoutMs('macos', 1)).toBe(12_000);
		expect(getCaptureAttemptTimeoutMs('macos', 2)).toBe(18_000);
		expect(getCaptureAttemptTimeoutMs('macos', 3)).toBe(18_000);
	});

	it('stops retrying after the maximum number of attempts', () => {
		expect(EXPORT_CAPTURE_MAX_ATTEMPTS).toBe(2);
		expect(shouldRetryCapture(1)).toBe(true);
		expect(shouldRetryCapture(2)).toBe(false);
		expect(shouldRetryCapture(3)).toBe(false);
	});

	it('only enables the data URL fallback on macOS second attempt after encode failure', () => {
		expect(shouldUseDataUrlFallback('macos', 2, 'encode')).toBe(true);
		expect(shouldUseDataUrlFallback('macos', 1, 'encode')).toBe(false);
		expect(shouldUseDataUrlFallback('macos', 2, 'domToCanvas')).toBe(false);
		expect(shouldUseDataUrlFallback('other', 2, 'encode')).toBe(false);
		expect(shouldUseDataUrlFallback('macos', 2, null)).toBe(false);
	});
});
