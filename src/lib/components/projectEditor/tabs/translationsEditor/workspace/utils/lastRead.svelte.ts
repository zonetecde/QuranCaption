import { tick } from 'svelte';

// État minimal conservé dans le projet pour mémoriser la dernière lecture.
type LastReadEditorState = {
	lastReadClipId: number | null;
	lastReadUpdatedAt: string | null;
};

// Dépendances fournies par Workspace.svelte pour garder ce fichier réutilisable.
type CreateWorkspaceLastReadOptions = {
	getEditorState: () => LastReadEditorState;
	getGroupIndexForClipId: (clipId: number) => number;
	getVisibleCount: () => number;
	setVisibleCount: (count: number) => void;
	saveProject: () => Promise<unknown> | void;
};

export function createWorkspaceLastRead(options: CreateWorkspaceLastReadOptions) {
	// Références et états locaux utilisés pour la reprise de lecture.
	let container: HTMLElement | null = $state(null);
	let highlightedClipId: number | null = $state(null);
	let pendingResumeClipId: number | null = $state(null);
	let lastObservedViewportClipId: number | null = $state(null);
	let saveTimeout: ReturnType<typeof setTimeout> | null = null;
	let captureTimeout: ReturnType<typeof setTimeout> | null = null;
	let highlightTimeout: ReturnType<typeof setTimeout> | null = null;
	let resumeAttemptedForClipId: number | null = null;

	// Regroupe les sauvegardes pour éviter d'écrire trop souvent.
	function scheduleSave(): void {
		if (saveTimeout) clearTimeout(saveTimeout);

		saveTimeout = setTimeout(() => {
			saveTimeout = null;
			void options.saveProject();
		}, 600);
	}

	// Met à jour le dernier clip lu puis déclenche une sauvegarde différée.
	function setLastReadClipId(clipId: number | null): void {
		if (clipId === null) return;

		const editorState = options.getEditorState();
		if (editorState.lastReadClipId === clipId) return;

		editorState.lastReadClipId = clipId;
		editorState.lastReadUpdatedAt = new Date().toISOString();
		scheduleSave();
	}

	// Affiche brièvement un highlight visuel sur le clip repris.
	function highlightClip(clipId: number): void {
		highlightedClipId = clipId;
		if (highlightTimeout) clearTimeout(highlightTimeout);

		highlightTimeout = setTimeout(() => {
			highlightedClipId = null;
			highlightTimeout = null;
		}, 2600);
	}

	// Cherche le clip le plus proche du centre visible de la zone de scroll.
	function getNearestVisibleClipId(targetContainer: HTMLElement): number | null {
		const nodes = Array.from(
			targetContainer.querySelectorAll<HTMLElement>('[data-translation-clip-id]')
		);
		if (nodes.length === 0) return null;

		const containerRect = targetContainer.getBoundingClientRect();
		const containerCenter = containerRect.top + containerRect.height / 2;
		let nearestClipId: number | null = null;
		let nearestDistance = Number.POSITIVE_INFINITY;

		for (const node of nodes) {
			const clipId = Number(node.dataset.translationClipId);
			if (!Number.isFinite(clipId)) continue;

			const rect = node.getBoundingClientRect();
			const center = rect.top + rect.height / 2;
			const distance = Math.abs(center - containerCenter);

			if (distance < nearestDistance) {
				nearestDistance = distance;
				nearestClipId = clipId;
			}
		}

		return nearestClipId;
	}

	// Capture immédiatement le clip actuellement le plus pertinent dans le viewport.
	function captureFromViewport(targetContainer: HTMLElement): void {
		const nearestClipId = getNearestVisibleClipId(targetContainer);
		if (nearestClipId === null) return;

		lastObservedViewportClipId = nearestClipId;
		setLastReadClipId(nearestClipId);
	}

	// Attend un peu avant de capturer pour éviter de spammer pendant le scroll.
	function scheduleViewportCapture(targetContainer: HTMLElement): void {
		const nearestClipId = getNearestVisibleClipId(targetContainer);
		if (nearestClipId !== null) {
			lastObservedViewportClipId = nearestClipId;
		}

		if (captureTimeout) {
			clearTimeout(captureTimeout);
			captureTimeout = null;
		}

		captureTimeout = setTimeout(() => {
			captureTimeout = null;
			captureFromViewport(targetContainer);
		}, 180);
	}

	// Recharge le clip sauvegardé en l'amenant dans la zone visible.
	async function resumeToClip(clipId: number): Promise<void> {
		if (!container) return;

		const groupIndex = options.getGroupIndexForClipId(clipId);
		if (groupIndex === -1) {
			pendingResumeClipId = null;
			return;
		}

		if (options.getVisibleCount() < groupIndex + 1) {
			options.setVisibleCount(Math.max(options.getVisibleCount(), groupIndex + 1));
			await tick();
		}

		await tick();

		const target = container.querySelector<HTMLElement>(`[data-translation-clip-id="${clipId}"]`);
		if (!target) return;

		target.scrollIntoView({ block: 'center', behavior: 'auto' });
		lastObservedViewportClipId = clipId;
		highlightClip(clipId);
		pendingResumeClipId = null;
	}

	// Lance la reprise seulement une fois quand le clip est disponible.
	function tryResume(): void {
		const clipId = pendingResumeClipId;
		if (!clipId || resumeAttemptedForClipId === clipId) return;
		if (options.getGroupIndexForClipId(clipId) === -1) return;

		resumeAttemptedForClipId = clipId;
		void resumeToClip(clipId);
	}

	// Initialise l'état au montage du composant.
	function init(): void {
		const lastReadClipId = options.getEditorState().lastReadClipId;
		if (typeof lastReadClipId === 'number') {
			pendingResumeClipId = lastReadClipId;
			return;
		}

		void tick().then(() => {
			if (container) {
				captureFromViewport(container);
			}
		});
	}

	// Nettoie les timeouts et force une dernière sauvegarde si nécessaire.
	function cleanup(): void {
		if (captureTimeout) {
			clearTimeout(captureTimeout);
			captureTimeout = null;
		}

		if (lastObservedViewportClipId !== null) {
			setLastReadClipId(lastObservedViewportClipId);
		}

		if (saveTimeout) {
			clearTimeout(saveTimeout);
			saveTimeout = null;
			void options.saveProject();
		}

		if (highlightTimeout) {
			clearTimeout(highlightTimeout);
			highlightTimeout = null;
		}
	}

	return {
		// Le composant parent bind cette référence sur le conteneur scrollable.
		get container() {
			return container;
		},
		set container(value: HTMLElement | null) {
			container = value;
		},
		// Exposé au parent pour afficher le highlight sur le bon clip.
		get highlightedClipId() {
			return highlightedClipId;
		},
		init,
		tryResume,
		scheduleViewportCapture,
		cleanup
	};
}
