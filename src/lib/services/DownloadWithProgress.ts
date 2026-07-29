import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

/** Progression d'un téléchargement. `total` est null si l'hôte n'annonce pas de taille. */
export type DownloadProgress = {
	downloaded: number;
	total: number | null;
};

type DownloadProgressEvent = {
	downloadId: string;
	downloaded: number;
	total: number | null;
};

let counter = 0;

/** Formate un nombre d'octets en Mo à une décimale (ex. `12.3`). */
export function bytesToMb(bytes: number): string {
	return (bytes / (1024 * 1024)).toFixed(1);
}

/**
 * Télécharge un fichier via la commande Rust `download_file` en relayant sa
 * progression. Corrèle les events `download-progress` par `downloadId` pour que
 * plusieurs téléchargements simultanés ne se mélangent pas.
 *
 * @param url URL source.
 * @param path Chemin de destination sur disque.
 * @param onProgress Callback appelé (throttlé côté Rust ~5x/s) à chaque avancée.
 * @returns Nombre d'octets téléchargés.
 */
export async function downloadFileWithProgress(
	url: string,
	path: string,
	onProgress?: (progress: DownloadProgress) => void
): Promise<number> {
	const downloadId = `dl-${Date.now()}-${counter++}`;
	let unlisten: (() => void) | undefined;

	if (onProgress) {
		unlisten = await listen<DownloadProgressEvent>('download-progress', (event) => {
			if (event.payload.downloadId !== downloadId) return;
			onProgress({ downloaded: event.payload.downloaded, total: event.payload.total ?? null });
		});
	}

	try {
		return (await invoke('download_file', { url, path, downloadId })) as number;
	} finally {
		unlisten?.();
	}
}
