// Chaque halo reste indépendant ; les segments inline recomposent aussi les effets hérités.
export const TEXT_SHADOW_CSS =
	'text-shadow: var(--wbw-word-glow-shadow, 0 0 0 transparent), var(--inline-word-glow-shadow, 0 0 0 transparent), var(--text-neon-shadow, 0 0 0 transparent), var(--text-glow-shadow, 0 0 0 transparent), var(--text-drop-shadow, 0 0 0 transparent);';

/**
 * Ajoute un halo local sans remplacer les effets du texte parent ni éclaircir son remplissage.
 * @param {string} color Couleur du halo, éventuellement interpolée pour le mot courant.
 * @param {string} blur Rayon CSS du halo.
 * @param {'inline' | 'wbw'} [kind='inline'] Origine du halo pour conserver les autres halos locaux.
 * @returns {string} Déclarations CSS du halo et de la composition des ombres.
 */
export function getWordGlowCss(
	color: string,
	blur: string,
	kind: 'inline' | 'wbw' = 'inline'
): string {
	const prefix = `--${kind}-word-glow`;
	return `${prefix}-color: ${color}; ${prefix}-shadow: 0 0 calc(${blur} * 0.5) var(${prefix}-color), 0 0 ${blur} var(${prefix}-color), 0 0 calc(${blur} * 2) var(${prefix}-color); ${TEXT_SHADOW_CSS}`;
}
