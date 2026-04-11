export type ExportCapturePlatform = 'macos' | 'other';

export type ScreenshotCaptureStage = 'createContext' | 'domToCanvas' | 'encode' | 'writeFile';

export const EXPORT_CAPTURE_MAX_ATTEMPTS = 2;

export function detectExportCapturePlatform(
	userAgent: string | null | undefined
): ExportCapturePlatform {
	if (!userAgent) return 'other';
	return /macintosh|mac os x/i.test(userAgent) ? 'macos' : 'other';
}

export function getCaptureAttemptTimeoutMs(
	platform: ExportCapturePlatform,
	attempt: number
): number {
	if (platform !== 'macos') return 6_000;
	return attempt <= 1 ? 12_000 : 18_000;
}

export function shouldRetryCapture(attempt: number): boolean {
	return attempt < EXPORT_CAPTURE_MAX_ATTEMPTS;
}

export function shouldUseDataUrlFallback(
	platform: ExportCapturePlatform,
	attempt: number,
	previousFailureStage: ScreenshotCaptureStage | null
): boolean {
	return platform === 'macos' && attempt === 2 && previousFailureStage === 'encode';
}
