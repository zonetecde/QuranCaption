import { getTauriVersion, getVersion } from '@tauri-apps/api/app';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import type { Update } from '@tauri-apps/plugin-updater';

export interface UpdateInfo {
	hasUpdate: boolean;
	changelog: string;
	latestVersion: string;
}

export type UpdateState = 'idle' | 'checking' | 'downloading' | 'installing' | 'done' | 'error';

class VersionService {
	currentVersion: string | null = $state(null);
	latestUpdate: UpdateInfo | null = $state(null);

	// Auto-update state
	updateState: UpdateState = $state('idle');
	downloadProgress: number = $state(0); // 0-100
	downloadedBytes: number = $state(0);
	totalBytes: number = $state(0);
	updateError: string = $state('');

	// Cached Tauri update object
	private _tauriUpdate: Update | null = null;

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

	/**
	 * Check for updates using Tauri's built-in updater plugin.
	 * Returns the Update object if available, null otherwise.
	 */
	async checkTauriUpdate(): Promise<Update | null> {
		try {
			const update = await check();
			if (update?.available) {
				this._tauriUpdate = update;
				return update;
			}
			return null;
		} catch (error) {
			console.error('Tauri updater check failed:', error);
			return null;
		}
	}

	/**
	 * Download and install the update using Tauri's updater.
	 * Tracks progress and state for the UI.
	 */
	async downloadAndInstall(): Promise<void> {
		if (!this._tauriUpdate) {
			// Try checking again
			const update = await this.checkTauriUpdate();
			if (!update) {
				this.updateState = 'error';
				this.updateError = 'No update available';
				return;
			}
		}

		try {
			this.updateState = 'downloading';
			this.downloadProgress = 0;
			this.downloadedBytes = 0;
			this.totalBytes = 0;

			await this._tauriUpdate!.downloadAndInstall((event) => {
				switch (event.event) {
					case 'Started':
						this.totalBytes = event.data.contentLength ?? 0;
						this.downloadedBytes = 0;
						break;
					case 'Progress':
						this.downloadedBytes += event.data.chunkLength;
						if (this.totalBytes > 0) {
							this.downloadProgress = Math.min(
								100,
								Math.round((this.downloadedBytes / this.totalBytes) * 100)
							);
						}
						break;
					case 'Finished':
						this.downloadProgress = 100;
						this.updateState = 'installing';
						break;
				}
			});

			this.updateState = 'done';

			// Relaunch the app after a short delay
			setTimeout(async () => {
				await relaunch();
			}, 1500);
		} catch (error) {
			console.error('Update download/install failed:', error);
			this.updateState = 'error';
			this.updateError = error instanceof Error ? error.message : String(error);
		}
	}

	/**
	 * Reset the update state (e.g., after dismissing an error).
	 */
	resetUpdateState() {
		this.updateState = 'idle';
		this.downloadProgress = 0;
		this.downloadedBytes = 0;
		this.totalBytes = 0;
		this.updateError = '';
	}

	/**
	 * Format bytes to human-readable string.
	 */
	formatBytes(bytes: number): string {
		if (bytes === 0) return '0 B';
		const k = 1024;
		const sizes = ['B', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
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

			// filtrer seulement les releases qui commencent par "QC-" ou "v" et ne sont pas des pre-releases
			const qcReleases = releases.filter((r: any) => {
				const tag = r.tag_name || '';
				return (tag.startsWith('QC-') || tag.startsWith('v')) && !r.prerelease;
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
				// trier par SemVer desc (latest en haut, oldest en bas)
				.sort((a: any, b: any) => this.compareSemver(b.tag_name || '0.0.0', a.tag_name || '0.0.0'));

			// concatène les changelogs (ordre chronologique asc)
			const changelog = newer
				.map((r: any) => {
					const tag = r.tag_name || '';
					const body = r.body || '';
					return `## ${tag}\n\n${body}`.trim();
				})
				.join('\n\n');

			// extraire la partie numérique du tag le plus élevé (enlever "QC-" ou "v")
			const latestVersionNumber = highest.replace(/^QC-/i, '').replace(/^v/i, '');

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
