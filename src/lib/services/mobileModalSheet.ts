const DRAG_CLOSE_DISTANCE_PX = 80;
const DRAG_TITLE_HEIGHT_PX = 112;
const INTERACTIVE_SELECTOR = 'button, input, select, textarea, a, label, [contenteditable="true"]';
const MODAL_HISTORY_KEY = 'quranCaptionModal';

type ModalHistoryEntry = {
	id: number;
	onClose: () => void;
	closedFromHistory: boolean;
};

const modalHistoryStack: ModalHistoryEntry[] = [];
let nextModalHistoryId = 0;
let ignoredPopstates = 0;
let isHistoryListenerRegistered = false;
let androidBackGuards = 0;

/**
 * Ferme le modal au premier plan lorsque la navigation Android revient en arrière.
 *
 * @returns {void}
 */
function closeTopModalFromHistory(): void {
	if (ignoredPopstates > 0) {
		ignoredPopstates -= 1;
		return;
	}

	const entry = modalHistoryStack.at(-1);
	if (!entry) {
		if (androidBackGuards > 0) history.pushState({ ...history.state }, '');
		return;
	}
	entry.closedFromHistory = true;
	entry.onClose();
}

/**
 * Installe l'écouteur partagé du bouton retour Android.
 *
 * @returns {void}
 */
function ensureHistoryListener(): void {
	if (isHistoryListenerRegistered) return;
	window.addEventListener('popstate', closeTopModalFromHistory);
	isHistoryListenerRegistered = true;
}

/**
 * Empêche le bouton retour Android de quitter l'application sans action explicite.
 *
 * @returns {() => void} Suppression de la garde.
 */
export function setupAndroidBackGuard(): () => void {
	ensureHistoryListener();
	androidBackGuards += 1;
	if (androidBackGuards === 1) history.pushState({ ...history.state }, '');

	return () => {
		androidBackGuards = Math.max(0, androidBackGuards - 1);
	};
}

/**
 * Associe un modal à une entrée d'historique consommée par le bouton retour Android.
 *
 * @param {() => void} onClose Fermeture du modal.
 * @returns {() => void} Suppression du modal de l'historique.
 */
function registerModalHistory(onClose: () => void): () => void {
	const entry: ModalHistoryEntry = {
		id: ++nextModalHistoryId,
		onClose,
		closedFromHistory: false
	};
	modalHistoryStack.push(entry);

	ensureHistoryListener();
	history.pushState({ ...history.state, [MODAL_HISTORY_KEY]: entry.id }, '');

	return () => {
		const index = modalHistoryStack.indexOf(entry);
		if (index !== -1) modalHistoryStack.splice(index, 1);
		if (!entry.closedFromHistory && history.state?.[MODAL_HISTORY_KEY] === entry.id) {
			ignoredPopstates += 1;
			history.back();
		}
	};
}

/**
 * Action Svelte fermant un modal avec le bouton retour Android.
 *
 * @param {HTMLElement} _element Élément racine du modal.
 * @param {() => void} onClose Fermeture du modal.
 * @returns {{ destroy: () => void }} Cycle de vie de l'action.
 */
export function androidBackButton(
	_element: HTMLElement,
	onClose: () => void
): { destroy: () => void } {
	return { destroy: registerModalHistory(onClose) };
}

/**
 * Transforme un panneau de modal en feuille mobile refermable.
 *
 * @param {HTMLElement} panel Panneau principal du modal.
 * @param {() => void} onClose Fermeture du modal.
 * @returns {() => void} Nettoyage des écouteurs et styles temporaires.
 */
export function setupMobileModalSheet(panel: HTMLElement, onClose: () => void): () => void {
	const unregisterModalHistory = registerModalHistory(onClose);
	const directParent = panel.parentElement;
	const wrapper =
		directParent &&
		(directParent.classList.contains('modal-wrapper') || directParent.classList.contains('fixed'))
			? directParent
			: (panel.closest<HTMLElement>('.modal-wrapper') ?? directParent);
	if (!wrapper) return unregisterModalHistory;

	const contentWrapper = panel.parentElement !== wrapper ? panel.parentElement : null;
	if (wrapper.parentElement !== document.body) document.body.appendChild(wrapper);
	wrapper.classList.add('mobile-modal-sheet-wrapper');
	contentWrapper?.classList.add('mobile-modal-sheet-content');
	panel.classList.add('mobile-modal-sheet-panel');

	let startY = 0;
	let offsetY = 0;
	let dragging = false;

	/**
	 * Commence le geste depuis la poignée ou le titre du modal.
	 *
	 * @param {PointerEvent} event Événement pointeur initial.
	 * @returns {void}
	 */
	function startDrag(event: PointerEvent): void {
		if (!event.isPrimary || event.button !== 0) return;
		const rect = panel.getBoundingClientRect();
		if (event.clientY > rect.top + DRAG_TITLE_HEIGHT_PX) return;
		if (event.target instanceof Element && event.target.closest(INTERACTIVE_SELECTOR)) return;

		startY = event.clientY;
		offsetY = 0;
		dragging = true;
		panel.classList.add('is-dragging');
		panel.setPointerCapture(event.pointerId);
	}

	/**
	 * Déplace progressivement la feuille avec le doigt.
	 *
	 * @param {PointerEvent} event Événement de déplacement.
	 * @returns {void}
	 */
	function moveDrag(event: PointerEvent): void {
		if (!dragging) return;
		event.preventDefault();
		offsetY = Math.max(0, event.clientY - startY);
		panel.style.transform = `translateY(${offsetY}px)`;
	}

	/**
	 * Ferme la feuille ou la remet en place selon la distance glissée.
	 *
	 * @returns {void}
	 */
	function endDrag(): void {
		if (!dragging) return;
		dragging = false;
		panel.classList.remove('is-dragging');
		if (offsetY >= DRAG_CLOSE_DISTANCE_PX) {
			onClose();
			return;
		}
		offsetY = 0;
		panel.style.transform = '';
	}

	/**
	 * Ferme le modal lorsque son arrière-plan est touché.
	 *
	 * @param {PointerEvent} event Événement reçu par le wrapper.
	 * @returns {void}
	 */
	function closeFromBackdrop(event: PointerEvent): void {
		if (event.target === wrapper) onClose();
	}

	panel.addEventListener('pointerdown', startDrag);
	panel.addEventListener('pointermove', moveDrag);
	panel.addEventListener('pointerup', endDrag);
	panel.addEventListener('pointercancel', endDrag);
	wrapper.addEventListener('pointerdown', closeFromBackdrop);

	return () => {
		unregisterModalHistory();
		panel.removeEventListener('pointerdown', startDrag);
		panel.removeEventListener('pointermove', moveDrag);
		panel.removeEventListener('pointerup', endDrag);
		panel.removeEventListener('pointercancel', endDrag);
		wrapper.removeEventListener('pointerdown', closeFromBackdrop);
		panel.classList.remove('mobile-modal-sheet-panel', 'is-dragging');
		panel.style.transform = '';
		wrapper.classList.remove('mobile-modal-sheet-wrapper');
		contentWrapper?.classList.remove('mobile-modal-sheet-content');
		// Le wrapper déplacé hors de son composant doit être retiré explicitement au démontage.
		if (wrapper.parentElement === document.body) wrapper.remove();
	};
}

/**
 * Action Svelte appliquant le comportement de feuille mobile à un modal.
 *
 * @param {HTMLElement} panel Panneau principal du modal.
 * @param {() => void} onClose Fermeture du modal.
 * @returns {{ destroy: () => void }} Cycle de vie de l'action.
 */
export function mobileModalSheet(panel: HTMLElement, onClose: () => void): { destroy: () => void } {
	return { destroy: setupMobileModalSheet(panel, onClose) };
}
