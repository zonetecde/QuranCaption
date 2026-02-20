export class Utilities {
	private static lastId: number = 0;

	static randomId(): number {
		// Génère un ID basé sur timestamp + nombre aléatoire plus grand
		const timestamp = Date.now();
		const random = Math.floor(Math.random() * 1000); // 0-999
		let id = timestamp * 1000 + random;

		// S'assure que l'ID est toujours supérieur au précédent
		if (id <= this.lastId) {
			id = this.lastId + 1;
		}

		this.lastId = id;
		return id;
	}

	/**
	 * Vérifie si un nom de chemin contient des caractères interdits sous Windows
	 * @param name Le nom du chemin à vérifier
	 * @returns true si le nom contient des caractères interdits, false sinon
	 */
	static isPathNotSafe(name: string) {
		const forbiddenChars = /[<>:"/\\|?*\x00-\x1F]/g;
		return forbiddenChars.test(name);
	}

	/**
	 * Contraint un nombre dans l'intervalle [0, 1].
	 * @param value La valeur à borner.
	 * @returns La valeur bornée entre 0 et 1. Retourne 0 si la valeur est invalide.
	 */
	static clamp01(value: number): number {
		if (!Number.isFinite(value)) return 0;
		return Math.min(1, Math.max(0, value));
	}

	/**
	 * Convertit une couleur CSS (hex, rgb ou rgba) en triplet RGB.
	 * @param color La couleur à convertir (formats supportés: #RRGGBB, rgb(...), rgba(...)).
	 * @returns Un tuple [r, g, b]. Retourne [0, 0, 0] si le format n'est pas reconnu.
	 */
	static parseColorToRgb(color: string): [number, number, number] {
		const c = String(color).trim();

		if (/^#[0-9a-fA-F]{6}$/.test(c)) {
			return [
				parseInt(c.slice(1, 3), 16),
				parseInt(c.slice(3, 5), 16),
				parseInt(c.slice(5, 7), 16)
			];
		}

		const rgb = c.match(/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i);
		if (rgb) {
			return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
		}

		const rgba = c.match(/^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*[\d.]+\s*\)$/i);
		if (rgba) {
			return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])];
		}

		return [0, 0, 0];
	}
}
