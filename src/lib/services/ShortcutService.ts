/**
 * Interface représentant un raccourci clavier
 */
interface Shortcut {
	keys: string[];
	onKeyDown: (event: KeyboardEvent) => void;
	onKeyUp?: (event: KeyboardEvent) => void;
}

/**
 * Service de gestion des raccourcis clavier
 * Fournit une interface propre pour enregistrer, gérer et exécuter des raccourcis clavier
 */
class ShortcutService {
	private static shortcuts = new Map<string, Shortcut>();
	private static keydownListener: ((event: KeyboardEvent) => void) | null = null;
	private static keyupListener: ((event: KeyboardEvent) => void) | null = null;
	private static isInitialized = false;

	/**
	 * Indique si l'événement vient d'un champ editable.
	 */
	private static isTypingTarget(target: EventTarget | null): boolean {
		return (
			target instanceof HTMLInputElement ||
			target instanceof HTMLTextAreaElement ||
			target instanceof HTMLSelectElement ||
			(target instanceof HTMLElement && target.isContentEditable)
		);
	}

	/**
	 * Initialise le service de raccourcis
	 * Nettoie les anciens listeners et configure les nouveaux
	 */
	static init(): void {
		if (this.isInitialized) {
			this.cleanup();
		}

		this.keydownListener = this.handleKeyDown.bind(this);
		this.keyupListener = this.handleKeyUp.bind(this);

		document.addEventListener('keydown', this.keydownListener);
		document.addEventListener('keyup', this.keyupListener);

		this.isInitialized = true;
	}

	/**
	 * Nettoie les listeners d'événements
	 */
	static cleanup(): void {
		if (this.keydownListener) {
			document.removeEventListener('keydown', this.keydownListener);
			this.keydownListener = null;
		}
		if (this.keyupListener) {
			document.removeEventListener('keyup', this.keyupListener);
			this.keyupListener = null;
		}
		this.isInitialized = false;
	}

	/**
	 * Gère les événements keydown
	 */
	private static handleKeyDown(event: KeyboardEvent): void {
		const key = event.key.toLowerCase();
		const shortcut = this.shortcuts.get(key);

		if (!shortcut || this.isTypingTarget(event.target)) return;

		event.preventDefault();
		shortcut.onKeyDown(event);
	}

	/**
	 * Gère les événements keyup
	 */
	private static handleKeyUp(event: KeyboardEvent): void {
		const key = event.key.toLowerCase();
		const shortcut = this.shortcuts.get(key);

		if (!shortcut?.onKeyUp || this.isTypingTarget(event.target)) return;

		event.preventDefault();
		shortcut.onKeyUp(event);
	}

	/**
	 * Normalise les clés pour une comparaison cohérente
	 */
	private static normalizeKeys(keys: string | string[]): string[] {
		const keyArray = Array.isArray(keys) ? keys : [keys];
		return keyArray.map((key) => key.toLowerCase());
	}

	/**
	 * Enregistre un nouveau raccourci
	 */
	static registerShortcut(options: {
		key: { keys: string[]; description: string };
		onKeyDown: (event: KeyboardEvent) => void;
		onKeyUp?: (event: KeyboardEvent) => void;
		preventDefault?: boolean;
	}): void {
		const normalizedKeys = this.normalizeKeys(options.key.keys);

		const shortcut: Shortcut = {
			keys: normalizedKeys,
			onKeyDown: options.onKeyDown,
			onKeyUp: options.onKeyUp
		};

		// Enregistre le raccourci pour chaque clé
		normalizedKeys.forEach((key) => {
			this.shortcuts.set(key, shortcut);
		});
	}

	/**
	 * Supprime un raccourci
	 */
	static unregisterShortcut(key: { keys: string[]; description: string }): boolean {
		if (!key) return false;

		const normalizedKeys = this.normalizeKeys(key.keys);
		let hasDeleted = false;

		normalizedKeys.forEach((normalizedKey) => {
			if (this.shortcuts.delete(normalizedKey)) {
				hasDeleted = true;
			}
		});

		return hasDeleted;
	}

	/**
	 * Vérifie si un raccourci existe
	 */
	static hasShortcut(key: string): boolean {
		const normalizedKey = key.toLowerCase();
		return this.shortcuts.has(normalizedKey);
	}
}

export default ShortcutService;
