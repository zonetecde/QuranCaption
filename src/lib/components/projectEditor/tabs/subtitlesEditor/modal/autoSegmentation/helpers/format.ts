/** Builds a compact label for the current mobile audio input. */
export function buildAudioLabel(fileName?: string, clipCount?: number): string {
	if (!fileName) return 'No audio selected';
	return clipCount && clipCount > 1 ? `${fileName} (+${clipCount - 1})` : fileName;
}
