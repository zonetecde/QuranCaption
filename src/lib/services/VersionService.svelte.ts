import { invoke } from './TauriCoreBridge';

export interface UpdateInfo {
	hasUpdate: boolean;
	changelog: string;
	latestVersion: string;
	releaseUrl: string;
}

type GitHubRelease = {
	tag_name?: string;
	draft?: boolean;
	prerelease?: boolean;
	body?: string;
	html_url?: string;
};

/**
 * Vérifie qu'une valeur reçue de GitHub peut représenter une release.
 *
 * @param {unknown} value Valeur à vérifier.
 * @returns {value is GitHubRelease} Vrai lorsque la valeur est un objet.
 */
function isGitHubRelease(value: unknown): value is GitHubRelease {
	return typeof value === 'object' && value !== null;
}

class VersionService {
	currentVersion: string | null = $state(null);
	latestUpdate: UpdateInfo | null = $state(null);

	/**
	 * Charge la version installée et recherche une release Android plus récente.
	 *
	 * @returns {Promise<void>} Résolution une fois la vérification terminée.
	 */
	async init(): Promise<void> {
		this.currentVersion = await this.getAppVersion();
		this.latestUpdate = await this.checkForUpdates();
	}

	/**
	 * Retourne la version déclarée par l'application Tauri.
	 *
	 * @returns {Promise<string>} Version courante de l'application.
	 */
	async getAppVersion(): Promise<string> {
		return (await invoke<string>('plugin:app|version')) || '0.0.0';
	}

	/**
	 * Normalise une version ou un tag Android vers trois segments numériques.
	 *
	 * @param {string} version Version ou tag à normaliser.
	 * @returns {string} Version SemVer normalisée.
	 */
	private normalizeVersion(version: string): string {
		const match = version.trim().match(/^(?:QCM-)?(\d+)\.(\d+)\.(\d+)$/i);
		return match ? `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}` : '0.0.0';
	}

	/**
	 * Compare deux versions SemVer.
	 *
	 * @param {string} first Première version.
	 * @param {string} second Seconde version.
	 * @returns {number} -1, 0 ou 1 selon l'ordre des versions.
	 */
	private compareSemver(first: string, second: string): number {
		const firstParts = this.normalizeVersion(first).split('.').map(Number);
		const secondParts = this.normalizeVersion(second).split('.').map(Number);
		for (let index = 0; index < 3; index++) {
			if (firstParts[index] > secondParts[index]) return 1;
			if (firstParts[index] < secondParts[index]) return -1;
		}
		return 0;
	}

	/**
	 * Recherche les releases GitHub Android préfixées par QCM.
	 *
	 * @returns {Promise<UpdateInfo>} Informations sur la dernière mise à jour disponible.
	 */
	async checkForUpdates(): Promise<UpdateInfo> {
		const noUpdate: UpdateInfo = {
			hasUpdate: false,
			changelog: '',
			latestVersion: '0.0.0',
			releaseUrl: ''
		};
		const currentVersion = await this.getAppVersion();

		try {
			const response = await fetch(
				'https://api.github.com/repos/zonetecde/QuranCaption/releases?per_page=100',
				{ headers: { Accept: 'application/vnd.github+json' } }
			);
			if (!response.ok) throw new Error('Failed to fetch releases');

			const payload: unknown = await response.json();
			if (!Array.isArray(payload)) return noUpdate;

			const releases = payload
				.filter(isGitHubRelease)
				.filter(
					(release) =>
						!release.draft &&
						!release.prerelease &&
						/^QCM-\d+\.\d+\.\d+$/i.test(release.tag_name ?? '')
				);
			if (releases.length === 0) return noUpdate;

			const newer = releases
				.filter((release) => this.compareSemver(release.tag_name ?? '', currentVersion) === 1)
				.sort((first, second) => this.compareSemver(second.tag_name ?? '', first.tag_name ?? ''));
			if (newer.length === 0) return noUpdate;

			const latest = newer[0];
			const latestTag = latest.tag_name ?? '';
			return {
				hasUpdate: true,
				changelog: newer
					.map((release) => `## ${release.tag_name}\n\n${release.body ?? ''}`.trim())
					.reverse()
					.join('\n\n'),
				latestVersion: this.normalizeVersion(latestTag),
				releaseUrl:
					latest.html_url ??
					`https://github.com/zonetecde/QuranCaption/releases/tag/${encodeURIComponent(latestTag)}`
			};
		} catch (error) {
			console.error('Error checking for Android updates:', error);
			return noUpdate;
		}
	}
}

const versionService = new VersionService();
export { versionService as VersionService };
