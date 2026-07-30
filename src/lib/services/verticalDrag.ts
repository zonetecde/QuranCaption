import { globalState } from '$lib/runes/main.svelte';
import type { StyleName } from '$lib/classes/VideoStyle.svelte';
import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';

export interface VerticalDragOptions {
	// Mode simple : fonction manuelle
	getInitialVertical?: () => number;
	getInitialHorizontal?: () => number;
	applyVertical?: (value: number) => void;
	applyHorizontal?: (value: number) => void;
	verticalMin?: number;
	verticalMax?: number;
	horizontalMin?: number;
	horizontalMax?: number;
	round?: boolean;
	classWhileDragging?: string;

	// Mode automatique avec globalState
	target?: string;
	verticalStyleId?: StyleName;
	horizontalStyleId?: StyleName;
}

export function mouseDrag(node: HTMLElement, options: VerticalDragOptions) {
	let startY = 0;
	let startX = 0;
	let scaleY = 1;
	let scaleX = 1;
	let originVertical = 0;
	let originHorizontal = 0;
	let dragging = false;
	let activePointerId: number | null = null;
	let opts = options;
	let isStuckToZero = false; // Pour le sticky behavior horizontal
	const HORIZONTAL_STICK_RANGE = 50; // Zone de stick autour de 0 (-50 à +50)
	const hadTouchNone = node.classList.contains('touch-none');

	/**
	 * Démarre le déplacement avec la souris, le stylet ou le toucher.
	 * @param {PointerEvent} e Événement initial du pointeur.
	 * @returns {void}
	 */
	function pointerdown(e: PointerEvent) {
		if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
		e.preventDefault();
		ProjectHistoryManager.begin('drag style position');
		startY = e.clientY;
		startX = e.clientX;
		const preview = node.closest<HTMLElement>('#preview');
		const previewBounds = preview?.getBoundingClientRect();
		scaleY = preview && previewBounds ? previewBounds.height / preview.offsetHeight || 1 : 1;
		scaleX = preview && previewBounds ? previewBounds.width / preview.offsetWidth || 1 : 1;
		isStuckToZero = false;
		activePointerId = e.pointerId;

		// Mode automatique avec globalState
		if (opts.target && opts.verticalStyleId) {
			const selectedIds =
				globalState.currentProject!.projectEditorState.stylesEditor.selectedSubtitles.map(
					(s) => s.id
				);
			if (selectedIds.length > 0) {
				// Si on a des clips sélectionnés, utilise la valeur effective du premier clip
				originVertical = Number(
					globalState.getVideoStyle
						.getStylesOfTarget(opts.target)
						.getEffectiveValue(opts.verticalStyleId, selectedIds[0])
				);
			} else {
				// Sinon, utilise la valeur du style global
				originVertical = Number(
					globalState.getVideoStyle.getStylesOfTarget(opts.target).findStyle(opts.verticalStyleId)!
						.value
				);
			}

			// Si le drag horizontal est activé, récupère aussi l'origine horizontale
			if (opts.horizontalStyleId) {
				if (selectedIds.length > 0) {
					originHorizontal = Number(
						globalState.getVideoStyle
							.getStylesOfTarget(opts.target)
							.getEffectiveValue(opts.horizontalStyleId, selectedIds[0])
					);
				} else {
					originHorizontal = Number(
						globalState.getVideoStyle
							.getStylesOfTarget(opts.target)
							.findStyle(opts.horizontalStyleId)!.value
					);
				}
			}
		} else {
			// Mode manuel
			originVertical = opts.getInitialVertical!();
			if (opts.getInitialHorizontal) {
				originHorizontal = opts.getInitialHorizontal();
			}
		}

		dragging = true;
		node.setPointerCapture(e.pointerId);
		globalState.getVideoPreviewState.showAlignmentGridWhileDragging = true;
		document.addEventListener('pointermove', pointermove);
		document.addEventListener('pointerup', pointerup);
		document.addEventListener('pointercancel', pointerup);
		const cls = opts.classWhileDragging || 'dragging-vertical';
		node.classList.add(cls);
	}

	/**
	 * Applique le déplacement du pointeur dans le repère interne de la preview.
	 * @param {PointerEvent} e Événement de déplacement du pointeur.
	 * @returns {void}
	 */
	function pointermove(e: PointerEvent) {
		if (!dragging || e.pointerId !== activePointerId) return;
		e.preventDefault();
		globalState.getVideoPreviewState.showAlignmentGridWhileDragging = true;

		// Gestion du drag vertical
		const deltaY = (e.clientY - startY) / scaleY;
		let verticalVal = originVertical + deltaY;

		// Mode automatique avec globalState pour le vertical
		if (opts.target && opts.verticalStyleId) {
			const style = globalState.getVideoStyle
				.getStylesOfTarget(opts.target)
				.findStyle(opts.verticalStyleId)!;
			if (typeof style.valueMin === 'number') verticalVal = Math.max(style.valueMin, verticalVal);
			if (typeof style.valueMax === 'number') verticalVal = Math.min(style.valueMax, verticalVal);
		} else {
			// Mode manuel
			if (typeof opts.verticalMin === 'number')
				verticalVal = Math.max(opts.verticalMin, verticalVal);
			if (typeof opts.verticalMax === 'number')
				verticalVal = Math.min(opts.verticalMax, verticalVal);
		}

		if (opts.round !== false) verticalVal = Math.round(verticalVal);

		// Application du vertical
		if (opts.target && opts.verticalStyleId) {
			const selectedIds =
				globalState.currentProject!.projectEditorState.stylesEditor.selectedSubtitles.map(
					(s) => s.id
				);
			if (selectedIds.length > 0) {
				globalState.getVideoStyle
					.getStylesOfTarget(opts.target)
					.setStyleForClips(selectedIds, opts.verticalStyleId, verticalVal);
			} else {
				globalState.getVideoStyle
					.getStylesOfTarget(opts.target)
					.setStyle(opts.verticalStyleId, verticalVal);
			}
		} else {
			opts.applyVertical!(verticalVal);
		}

		// Gestion du drag horizontal (si activé)
		if (opts.horizontalStyleId || opts.applyHorizontal) {
			const deltaX = (e.clientX - startX) / scaleX;
			let horizontalVal = originHorizontal + deltaX;

			// Sticky behavior près de zéro
			// Si la valeur est dans la zone de stick (-50 à +50), on stick à 0
			if (Math.abs(horizontalVal) <= HORIZONTAL_STICK_RANGE) {
				// Si on n'était pas encore stuck, on devient stuck
				if (!isStuckToZero) {
					isStuckToZero = true;
				}
				horizontalVal = 0;
			} else {
				// Si on sort de la zone de stick, on n'est plus stuck
				isStuckToZero = false;
			}

			// Mode automatique avec globalState pour l'horizontal
			if (opts.target && opts.horizontalStyleId) {
				const style = globalState.getVideoStyle
					.getStylesOfTarget(opts.target)
					.findStyle(opts.horizontalStyleId)!;
				if (typeof style.valueMin === 'number')
					horizontalVal = Math.max(style.valueMin, horizontalVal);
				if (typeof style.valueMax === 'number')
					horizontalVal = Math.min(style.valueMax, horizontalVal);
			} else {
				// Mode manuel
				if (typeof opts.horizontalMin === 'number')
					horizontalVal = Math.max(opts.horizontalMin, horizontalVal);
				if (typeof opts.horizontalMax === 'number')
					horizontalVal = Math.min(opts.horizontalMax, horizontalVal);
			}

			if (opts.round !== false) horizontalVal = Math.round(horizontalVal);

			// Application de l'horizontal
			if (opts.target && opts.horizontalStyleId) {
				const selectedIds =
					globalState.currentProject!.projectEditorState.stylesEditor.selectedSubtitles.map(
						(s) => s.id
					);
				if (selectedIds.length > 0) {
					globalState.getVideoStyle
						.getStylesOfTarget(opts.target)
						.setStyleForClips(selectedIds, opts.horizontalStyleId, horizontalVal);
				} else {
					globalState.getVideoStyle
						.getStylesOfTarget(opts.target)
						.setStyle(opts.horizontalStyleId, horizontalVal);
				}
			} else if (opts.applyHorizontal) {
				opts.applyHorizontal(horizontalVal);
			}
		}
	}

	/**
	 * Termine le déplacement actif et valide son historique.
	 * @param {PointerEvent} e Événement final du pointeur.
	 * @returns {void}
	 */
	function pointerup(e: PointerEvent) {
		if (!dragging || e.pointerId !== activePointerId) return;
		dragging = false;
		activePointerId = null;
		globalState.getVideoPreviewState.showAlignmentGridWhileDragging = false;
		document.removeEventListener('pointermove', pointermove);
		document.removeEventListener('pointerup', pointerup);
		document.removeEventListener('pointercancel', pointerup);
		const cls = opts.classWhileDragging || 'dragging-vertical';
		node.classList.remove(cls);
		if (
			opts.verticalStyleId === 'vertical-position' ||
			opts.verticalStyleId === 'horizontal-position' ||
			opts.horizontalStyleId === 'vertical-position' ||
			opts.horizontalStyleId === 'horizontal-position'
		) {
			globalState.updateVideoPreviewUI();
		}
		ProjectHistoryManager.commit();
	}

	node.addEventListener('pointerdown', pointerdown);
	node.classList.add('touch-none');
	if (!node.style.cursor) node.style.cursor = 'move';

	return {
		update(newOptions: VerticalDragOptions) {
			opts = newOptions;
		},
		destroy() {
			globalState.getVideoPreviewState.showAlignmentGridWhileDragging = false;
			node.removeEventListener('pointerdown', pointerdown);
			document.removeEventListener('pointermove', pointermove);
			document.removeEventListener('pointerup', pointerup);
			document.removeEventListener('pointercancel', pointerup);
			if (!hadTouchNone) node.classList.remove('touch-none');
			ProjectHistoryManager.cancel();
		}
	};
}
