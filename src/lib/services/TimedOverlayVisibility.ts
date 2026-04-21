export type TimedOverlayVisibilityParams = {
	alwaysShow: boolean;
	maxOpacity: number;
	currentTime: number;
	fadeDuration: number;
	startTime?: number | null;
	endTime?: number | null;
};

/**
 * Computes overlay opacity using the same timing model as custom text/image overlays.
 */
export function getTimedOverlayOpacity({
	alwaysShow,
	maxOpacity,
	currentTime,
	fadeDuration,
	startTime,
	endTime
}: TimedOverlayVisibilityParams): number {
	if (alwaysShow) return maxOpacity;
	if (startTime == null || endTime == null) return 0;

	// Before appearance
	if (currentTime < startTime) return 0;

	// Instant toggle when fade duration is disabled
	if (fadeDuration <= 0) {
		if (currentTime >= startTime && currentTime <= endTime) return maxOpacity;
		return 0;
	}

	// Fade in
	if (currentTime >= startTime && currentTime < startTime + fadeDuration) {
		const t = (currentTime - startTime) / fadeDuration;
		return Math.max(0, Math.min(1, t)) * maxOpacity;
	}

	// Full opacity
	if (currentTime >= startTime + fadeDuration && currentTime < endTime - fadeDuration) {
		return maxOpacity;
	}

	// Fade out
	if (currentTime >= endTime - fadeDuration && currentTime <= endTime) {
		const t = (endTime - currentTime) / fadeDuration;
		return Math.max(0, Math.min(1, t)) * maxOpacity;
	}

	// After disappearance
	return 0;
}
