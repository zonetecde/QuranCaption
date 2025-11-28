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
}
