const DRAG_CLOSE_DISTANCE_PX = 80;
const DRAG_TITLE_HEIGHT_PX = 112;
const INTERACTIVE_SELECTOR = 'button, input, select, textarea, a, label, [contenteditable="true"]';

/**
 * Transforme un panneau de modal en feuille mobile refermable.
 *
 * @param {HTMLElement} panel Panneau principal du modal.
 * @param {() => void} onClose Fermeture du modal.
 * @returns {() => void} Nettoyage des écouteurs et styles temporaires.
 */
export function setupMobileModalSheet(panel: HTMLElement, onClose: () => void): () => void {
	const directParent = panel.parentElement;
	const wrapper =
		directParent &&
		(directParent.classList.contains('modal-wrapper') || directParent.classList.contains('fixed'))
			? directParent
			: (panel.closest<HTMLElement>('.modal-wrapper') ?? directParent);
	if (!wrapper) return () => {};

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
		panel.removeEventListener('pointerdown', startDrag);
		panel.removeEventListener('pointermove', moveDrag);
		panel.removeEventListener('pointerup', endDrag);
		panel.removeEventListener('pointercancel', endDrag);
		wrapper.removeEventListener('pointerdown', closeFromBackdrop);
		panel.classList.remove('mobile-modal-sheet-panel', 'is-dragging');
		panel.style.transform = '';
		wrapper.classList.remove('mobile-modal-sheet-wrapper');
		contentWrapper?.classList.remove('mobile-modal-sheet-content');
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
