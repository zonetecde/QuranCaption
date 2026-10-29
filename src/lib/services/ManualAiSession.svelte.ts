import { invoke } from '@tauri-apps/api/core';
import { get } from 'svelte/store';
import type editor from '$lib/i18n/en/editor';
import LL from '$lib/i18n/i18n-svelte';

export type ManualAiCopy = {
	[K in keyof typeof editor.manualAi]: () => string;
};
export type ManualAiStep = {
	prompt: string;
	response: string;
	error: string;
	status: 'waiting' | 'valid';
};

/**
 * Résout les libellés du parcours manuel dans la langue active.
 * @returns {ManualAiCopy} Textes localisés.
 */
function getManualAiCopy(): ManualAiCopy {
	return (get(LL).editor as unknown as { manualAi: ManualAiCopy }).manualAi;
}

/** Maintient les réponses manuelles en mémoire jusqu'à leur validation ou l'annulation. */
export class ManualAiSession {
	steps = $state<ManualAiStep[]>([]);
	active = $state(false);
	ready = $state(false);
	private pending: { accept: () => void; reject: (error: Error) => void } | null = null;

	/** Réinitialise les réponses avant une nouvelle préparation. @returns {void} */
	start(): void {
		this.cancel();
		this.steps = [];
		this.ready = false;
		this.active = true;
	}

	/** Termine la préparation sans appliquer les résultats au projet. @returns {void} */
	finish(): void {
		this.active = false;
		this.ready = true;
	}

	/** Annule l'attente sans appliquer de réponse partielle. @returns {void} */
	cancel(): void {
		this.active = false;
		this.ready = false;
		this.pending?.reject(new DOMException('', 'AbortError'));
		this.pending = null;
	}

	/** Vérifie la réponse courante, en conservant les réponses précédemment validées. @returns {void} */
	submit(): void {
		this.pending?.accept();
	}

	/**
	 * Prépare un prompt local puis attend une réponse conforme au validateur métier existant.
	 * @param {string} kind Fonctionnalité concernée.
	 * @param {Record<string, unknown>} request Données du lot, sans identifiants du fournisseur.
	 * @param {(response: unknown) => T} validate Validation complète du lot sans mutation du projet.
	 * @returns {Promise<T>} Résultat validé.
	 */
	async request<T>(
		kind: string,
		request: Record<string, unknown>,
		validate: (response: unknown) => T
	): Promise<T> {
		if (!this.active) throw new DOMException('', 'AbortError');
		let instructions: string;
		try {
			instructions = await invoke<string>('prepare_manual_ai_prompt', { kind, request });
		} catch {
			throw new Error(getManualAiCopy().prepareError());
		}
		if (!this.active) throw new DOMException('', 'AbortError');
		// L'enveloppe empêche d'accepter par erreur une réponse d'un autre lot ou projet.
		const requestId = crypto.randomUUID();
		this.steps.push({
			prompt: `${instructions}\n\nRESPONSE ENVELOPE: Put the requested JSON result inside this exact outer object: {"requestId":"${requestId}","result":<requested JSON object>}. Copy requestId exactly. Return the complete outer JSON object only, with no Markdown or explanation.`,
			response: '',
			error: '',
			status: 'waiting'
		});
		const step = this.steps[this.steps.length - 1];
		return new Promise<T>((resolve, reject) => {
			this.pending = {
				reject,
				/** Valide uniquement la réponse attendue. @returns {void} */
				accept: () => {
					try {
						let parsed: { requestId?: unknown; result?: unknown };
						try {
							const raw = step.response.trim();
							parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
						} catch {
							throw new Error(getManualAiCopy().invalidJson());
						}
						if (!parsed || parsed.requestId !== requestId)
							throw new Error(getManualAiCopy().wrongPrompt());
						const result = validate(parsed.result);
						step.status = 'valid';
						step.error = '';
						this.pending = null;
						resolve(result);
					} catch (error) {
						step.error = error instanceof Error ? error.message : getManualAiCopy().invalidJson();
					}
				}
			};
		});
	}
}
