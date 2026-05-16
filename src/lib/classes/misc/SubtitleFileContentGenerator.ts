export default class SubtitleFileContentGenerator {
	public static generateSubtitleFile(
		subtitles: { startTimeMs: number; endTimeMs: number; text: string }[],
		format: 'SRT' | 'VTT'
	): string {
		if (format === 'SRT') {
			return this.generateSRTContent(subtitles);
		} else if (format === 'VTT') {
			return this.generateVTTContent(subtitles);
		}
		throw new Error(`Unsupported subtitle format: ${format}`);
	}

	/**
	 * Génère le contenu d'un fichier SRT
	 */
	private static generateSRTContent(
		subtitles: { startTimeMs: number; endTimeMs: number; text: string }[]
	): string {
		let content = '';

		for (let i = 0; i < subtitles.length; i++) {
			const subtitle = subtitles[i];
			const startTime = this.formatSRTTime(subtitle.startTimeMs);
			const endTime = this.formatSRTTime(subtitle.endTimeMs);

			content += `${i + 1}\n`;
			content += `${startTime} --> ${endTime}\n`;
			content += `${subtitle.text}\n\n`;
		}

		return content.trim();
	}

	/**
	 * Génère le contenu d'un fichier VTT
	 */
	private static generateVTTContent(
		subtitles: { startTimeMs: number; endTimeMs: number; text: string }[]
	): string {
		let content = 'WEBVTT\n\n';

		for (const subtitle of subtitles) {
			const startTime = this.formatVTTTime(subtitle.startTimeMs);
			const endTime = this.formatVTTTime(subtitle.endTimeMs);

			content += `${startTime} --> ${endTime}\n`;
			content += `${subtitle.text}\n\n`;
		}

		return content.trim();
	}

	/**
	 * Formate le temps en millisecondes au format SRT (HH:MM:SS,mmm)
	 */
	private static formatSRTTime(timeMs: number): string {
		const totalSeconds = Math.floor(timeMs / 1000);
		const milliseconds = Math.floor(timeMs % 1000);
		const hours = Math.floor(totalSeconds / 3600);
		const minutes = Math.floor((totalSeconds % 3600) / 60);
		const seconds = totalSeconds % 60;

		return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')},${milliseconds.toString().padStart(3, '0')}`;
	}

	/**
	 * Formate le temps en millisecondes au format VTT (HH:MM:SS.mmm)
	 */
	private static formatVTTTime(timeMs: number): string {
		const totalSeconds = Math.floor(timeMs / 1000);
		const milliseconds = Math.floor(timeMs % 1000);
		const hours = Math.floor(totalSeconds / 3600);
		const minutes = Math.floor((totalSeconds % 3600) / 60);
		const seconds = totalSeconds % 60;

		return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
	}
}
