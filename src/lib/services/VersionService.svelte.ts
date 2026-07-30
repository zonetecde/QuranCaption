import { getVersion } from '@tauri-apps/api/app';

class VersionService {
	/**
	 * Retourne la version embarquée de l'application mobile.
	 * @returns {Promise<string>} Version courante.
	 */
	async getAppVersion(): Promise<string> {
		return (await getVersion()) || '0.0.0';
	}
}

const versionService = new VersionService();
export { versionService as VersionService };
