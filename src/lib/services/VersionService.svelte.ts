import { getTauriVersion, getVersion } from '@tauri-apps/api/app';

export interface UpdateInfo {
	hasUpdate: boolean;
	changelog: string;
	latestVersion: string;
}

class VersionService {
	currentVersion: string | null = $state(null);
	latestUpdate: UpdateInfo | null = $state(null);

	async init() {
		this.currentVersion = await this.getAppVersion();
		this.latestUpdate = await this.checkForUpdates();
	}

	async getAppVersion(): Promise<string> {
		return (await getVersion()) || '0.0.0';
	}

	// normalise "v1.2.3" -> "1.2.3", garde 3 segments
	private normalizeVersion(v: string): string {
		if (!v) return '0.0.0';
		const s = v
			.trim()
			.replace(/^v/i, '')
			.replace(/^qc[-_]?/i, '');
		// garder seulement chiffres séparés par non-chiffres
		const parts = s
			.split(/[^0-9]+/)
			.filter(Boolean)
			.map((p) => p.replace(/^0+(?=\d)|^$/, (m) => m));
		if (parts.length >= 3) return parts.slice(0, 3).join('.');
		if (parts.length === 2) return ['0', parts[0], parts[1]].join('.');
		if (parts.length === 1) return ['0', '0', parts[0]].join('.');
		return '0.0.0';
	}

	// retourne -1 si a<b, 0 si égal, 1 si a>b
	private compareSemver(a: string, b: string): number {
		const pa = this.normalizeVersion(a).split('.').map(Number);
		const pb = this.normalizeVersion(b).split('.').map(Number);
		for (let i = 0; i < 3; i++) {
			if (pa[i] > pb[i]) return 1;
			if (pa[i] < pb[i]) return -1;
		}
		return 0;
	}

	async checkForUpdates(): Promise<UpdateInfo> {
		const currentVersion = (await this.getAppVersion()) || '0.0.0';

		try {
			// récupère jusqu'à 100 releases (ajuster la pagination si besoin)
			const response = await fetch(
				'https://api.github.com/repos/zonetecde/qurancaption/releases?per_page=100'
			);
			if (!response.ok) {
				throw new Error('Failed to fetch releases');
			}
			const releases = await response.json();
			if (!Array.isArray(releases) || releases.length === 0) {
				return { hasUpdate: false, changelog: '', latestVersion: '0.0.0' };
			}

			// filtrer seulement les releases qui commencent par "QC-" et ne sont pas des pre-releases
			const qcReleases = releases.filter((r: any) => {
				const tag = r.tag_name || '';
				return tag.startsWith('QC-') && !r.prerelease;
			});

			if (qcReleases.length === 0) {
				return { hasUpdate: false, changelog: '', latestVersion: '0.0.0' };
			}

			// déterminer la version la plus élevée trouvée (au cas où l'ordre GitHub ne suit pas SemVer)
			const highest = qcReleases.reduce((max: string, r: any) => {
				const tag = r.tag_name || '0.0.0';
				return this.compareSemver(tag, max) === 1 ? tag : max;
			}, qcReleases[0].tag_name || '0.0.0');

			// filtrer les releases strictement supérieures à la version courante
			const newer = qcReleases
				.filter((r: any) => {
					const tag = r.tag_name || '';
					return this.compareSemver(tag, currentVersion) === 1;
				})
				// trier par SemVer asc (de la plus proche de current vers latest)
				.sort((a: any, b: any) => this.compareSemver(a.tag_name || '0.0.0', b.tag_name || '0.0.0'));

			// concatène les changelogs (ordre chronologique asc)
			const changelog = newer
				.map((r: any) => {
					const tag = r.tag_name || '';
					const body = r.body || '';
					return `## ${tag}\n\n${body}`.trim();
				})
				.join('\n\n');

			// extraire la partie numérique du tag le plus élevé (enlever "QC-")
			const latestVersionNumber = highest.startsWith('QC-') ? highest.substring(3) : highest;

			return {
				hasUpdate: newer.length > 0,
				changelog: newer.length > 0 ? changelog : '',
				latestVersion: latestVersionNumber || '0.0.0'
			};
		} catch (error) {
			console.error('Error checking for updates:', error);
			return { hasUpdate: false, changelog: '', latestVersion: '0.0.0' };
		}
	}
}

const versionService = new VersionService();
export { versionService as VersionService };
