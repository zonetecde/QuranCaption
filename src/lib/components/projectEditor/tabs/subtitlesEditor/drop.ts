/**
 * Retourne le premier fichier JSON d'un dépôt de fichiers.
 *
 * @param {string[]} paths Chemins déposés dans la fenêtre Tauri.
 * @param {boolean} isHandledByModal Indique si le modal d'import gère déjà le dépôt.
 * @returns {string | null} Premier chemin JSON ou null si aucun n'est présent.
 */
export function getDroppedJsonPath(paths: string[], isHandledByModal = false): string | null {
	if (isHandledByModal) return null;
	return paths.find((path) => path.toLowerCase().endsWith('.json')) ?? null;
}
