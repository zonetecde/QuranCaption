import { invoke } from '@tauri-apps/api/core';

let _refreshVersion = $state(0);
const peaksCache: Map<string, number[]> = new Map();

export class WaveformService {
	static get refreshVersion() {
		return _refreshVersion;
	}

	/**
	 * Récupère les peaks d'un fichier audio, soit depuis le cache, soit depuis le backend
	 */
	static async getPeaks(filePath: string): Promise<number[]> {
		// On dépend du refreshVersion pour forcer le recalcul si besoin
		const _ = _refreshVersion;
		// Vérifie si les peaks sont déjà en cache
		if (peaksCache.has(filePath)) {
			return peaksCache.get(filePath)!;
		}

		// Sinon, appelle le backend
		const peaks = await invoke<number[]>('get_audio_waveform', {
			filePath: filePath
		});

		// Met en cache pour la prochaine fois
		peaksCache.set(filePath, peaks);

		return peaks;
	}

	/**
	 * Vide le cache pour un fichier spécifique
	 */
	static clearCache(filePath: string) {
		peaksCache.delete(filePath);
	}

	/**
	 * Vide tout le cache
	 */
	static clearAllCache() {
		peaksCache.clear();
		_refreshVersion++;
	}
}
