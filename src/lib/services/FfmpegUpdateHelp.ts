const MACOS_COMMANDS = [
	'brew update',
	'brew unlink ffmpeg@6',
	'brew install ffmpeg',
	'ffmpeg -version'
];
const WINDOWS_COMMANDS = ['winget upgrade --id Gyan.FFmpeg --exact', 'ffmpeg -version'];
const LINUX_COMMANDS = ['sudo apt update', 'sudo apt install ffmpeg', 'ffmpeg -version'];

/**
 * Retourne les commandes de mise a jour adaptees a l'OS pour une erreur FFmpeg obsolete.
 * @param {string} errorLog Journal d'erreur FFmpeg.
 * @param {string} userAgent Agent utilisateur courant.
 * @returns {string | null} Commandes a afficher, ou `null` si l'erreur n'est pas concernee.
 */
export function getFfmpegUpdateCommands(errorLog: string, userAgent: string): string | null {
	if (!errorLog.includes("Unrecognized option '/filter_complex'")) return null;

	const platform = `${userAgent}\n${errorLog}`.toLowerCase();
	if (platform.includes('mac') || platform.includes('/opt/homebrew/')) {
		return MACOS_COMMANDS.join('\n');
	}
	if (platform.includes('windows') || platform.includes('\\')) {
		return WINDOWS_COMMANDS.join('\n');
	}
	return LINUX_COMMANDS.join('\n');
}
