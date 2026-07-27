import { appDataDir, join } from '@tauri-apps/api/path';
import { exists, mkdir, readDir, readTextFile, remove } from '@tauri-apps/plugin-fs';

/**
 * Cache partagé pour les audios « Quranic Universal Audio » (QUA).
 *
 * Un même récitateur+sourate téléchargé depuis QUA produit toujours les mêmes
 * octets (fichier de bucket non tronqué pour une sourate entière, découpe ffmpeg
 * déterministe pour une plage de versets). On le stocke donc une seule fois ici,
 * hors des dossiers d'assets par projet, et chaque `Asset.filePath` pointe
 * directement sur ce fichier partagé : zéro re-téléchargement et zéro copie
 * dupliquée sur le disque entre projets.
 *
 * Nettoyage par comptage de références « eager » : à la suppression d'un projet,
 * {@link pruneOrphanedQuaCache} supprime tout fichier de cache que plus aucun
 * projet ne référence (voir ProjectService.delete / BatchService).
 */

export const QUA_CACHE_FOLDER = 'qua-audio-cache';
const PROJECTS_FOLDER = 'projects/';

/** Normalise un chemin pour comparaison : `/` uniforme, doublons réduits, minuscule (Windows). */
function normalizeForCompare(filePath: string): string {
	return filePath
		.replace(/\\/g, '/')
		.replace(/\/+/g, '/')
		.toLowerCase();
}

/** Dossier du cache (`<appData>/qua-audio-cache`), créé si absent. */
export async function getQuaCacheDir(): Promise<string> {
	const dir = await join(await appDataDir(), QUA_CACHE_FOLDER);
	if (!(await exists(dir))) {
		await mkdir(dir, { recursive: true });
	}
	return dir;
}

/** Paramètres identifiant de façon stable un audio QUA téléchargeable. */
export type QuaCacheKeyParams = {
	/** Slug de livraison (identifiant immuable du récitateur, sûr pour un chemin). */
	slug: string;
	/** Numéro de sourate. */
	surah: number;
	/**
	 * Plage de versets, présente uniquement en mode « audio + segments ». Le mot
	 * à mot Preload télécharge le clip `[verseFrom, verseTo]` (timestamps relatifs
	 * au début de la fenêtre), donc les octets dépendent de la plage — même une
	 * sourate entière exclut l'isti'adha/basmala de tête et diffère du fichier
	 * complet. En mode « audio seul » ces champs sont absents (fichier complet).
	 */
	verseFrom?: number;
	verseTo?: number;
};

/**
 * Construit la clé de cache relative (`<slug>/<surah>[-<from>-<to>].mp3`).
 *
 * Basée sur le slug (immuable) + sourate + plage de versets, jamais sur le nom
 * d'affichage du récitateur (qui peut changer). Une plage présente → clip des
 * versets ; absente → fichier chapitre complet (mode audio seul).
 */
export function quaCacheRelKey(params: QuaCacheKeyParams): string {
	const { slug, surah, verseFrom, verseTo } = params;
	const hasRange = verseFrom != null && verseTo != null;
	const fileName = hasRange ? `${surah}-${verseFrom}-${verseTo}.mp3` : `${surah}.mp3`;
	return `${slug}/${fileName}`;
}

/**
 * Résout la clé relative en chemin absolu dans le cache, en créant le
 * sous-dossier du slug au besoin. Chemin retourné normalisé en `/`.
 */
export async function resolveQuaCachePath(relKey: string): Promise<string> {
	const cacheDir = await getQuaCacheDir();
	const parts = relKey.split('/').filter(Boolean);
	const fullPath = await join(cacheDir, ...parts);
	// Crée le sous-dossier du slug (parent du fichier) si nécessaire.
	if (parts.length > 1) {
		const slugDir = await join(cacheDir, ...parts.slice(0, -1));
		if (!(await exists(slugDir))) {
			await mkdir(slugDir, { recursive: true });
		}
	}
	return fullPath.replace(/\\/g, '/');
}

/** Indique si `filePath` se trouve dans le dossier de cache QUA. */
export async function isQuaCachePath(filePath: string): Promise<boolean> {
	const cacheDirNorm = normalizeForCompare(await getQuaCacheDir());
	return normalizeForCompare(filePath).startsWith(cacheDirNorm + '/');
}

/** Test rapide (sans parse) : un JSON de projet référence-t-il le cache QUA ? */
export function projectJsonReferencesQuaCache(jsonText: string): boolean {
	return jsonText.includes(QUA_CACHE_FOLDER);
}

/**
 * Rassemble l'ensemble des fichiers de cache encore référencés par au moins un
 * projet sur le disque (chemins normalisés). Lit les JSON directement pour
 * rester léger et éviter une dépendance circulaire avec ProjectService.
 */
async function collectReferencedCacheFiles(): Promise<Set<string>> {
	const referenced = new Set<string>();
	const projectsPath = await join(await appDataDir(), PROJECTS_FOLDER);
	if (!(await exists(projectsPath))) return referenced;

	const cacheDirNorm = normalizeForCompare(await getQuaCacheDir());
	const entries = await readDir(projectsPath);
	for (const entry of entries) {
		if (!entry.isFile || !entry.name?.endsWith('.json')) continue;
		try {
			const filePath = await join(projectsPath, entry.name);
			const text = await readTextFile(filePath);
			// Court-circuit : ignore les projets qui ne touchent pas au cache.
			if (!projectJsonReferencesQuaCache(text)) continue;
			const data = JSON.parse(text);
			const assets: Array<{ filePath?: string }> = data?.content?.assets ?? [];
			for (const asset of assets) {
				if (typeof asset?.filePath !== 'string') continue;
				const norm = normalizeForCompare(asset.filePath);
				if (norm.startsWith(cacheDirNorm + '/')) referenced.add(norm);
			}
		} catch (error) {
			// Projet illisible/corrompu : on le saute (comme loadUserProjectsDetails).
			console.warn(`QUA cache prune: could not read ${entry.name}:`, error);
		}
	}
	return referenced;
}

/**
 * Supprime les fichiers de cache QUA que plus aucun projet ne référence, puis
 * les sous-dossiers de slug devenus vides. Idempotent et auto-réparateur : il
 * ramasse aussi les orphelins laissés par un crash en cours de suppression.
 */
export async function pruneOrphanedQuaCache(): Promise<void> {
	try {
		const cacheDir = await getQuaCacheDir();
		const referenced = await collectReferencedCacheFiles();
		const cacheDirNorm = normalizeForCompare(cacheDir);

		const slugDirs = await readDir(cacheDir);
		for (const slugEntry of slugDirs) {
			if (!slugEntry.isDirectory || !slugEntry.name) continue;
			const slugDir = await join(cacheDir, slugEntry.name);
			let remaining = 0;
			const files = await readDir(slugDir);
			for (const fileEntry of files) {
				if (!fileEntry.isFile || !fileEntry.name) continue;
				const abs = await join(slugDir, fileEntry.name);
				const norm = normalizeForCompare(abs);
				// Sécurité : ne touche qu'aux chemins réellement sous le cache.
				if (!norm.startsWith(cacheDirNorm + '/')) continue;
				if (referenced.has(norm)) {
					remaining++;
				} else {
					await remove(abs);
				}
			}
			// Supprime le sous-dossier du slug s'il ne reste aucun fichier référencé.
			if (remaining === 0) {
				try {
					await remove(slugDir, { recursive: true });
				} catch {
					// Non bloquant : dossier non vide (autre contenu) ou déjà supprimé.
				}
			}
		}
	} catch (error) {
		console.warn('QUA cache prune failed:', error);
	}
}
