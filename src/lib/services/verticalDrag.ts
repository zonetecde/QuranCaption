import { globalState } from '$lib/runes/main.svelte';
import type { StyleName } from '$lib/classes/VideoStyle.svelte';

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
	let originVertical = 0;
	let originHorizontal = 0;
	let dragging = false;
	let opts = options;
	let isStuckToZero = false; // Pour le sticky behavior horizontal
	const HORIZONTAL_STICK_RANGE = 50; // Zone de stick autour de 0 (-50 à +50)

	function mousedown(e: MouseEvent) {
		if (e.button !== 0) return;
		e.preventDefault();
		startY = e.clientY;
		startX = e.clientX;
		isStuckToZero = false;

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
		globalState.getVideoPreviewState.showAlignmentGridWhileDragging = true;
		document.addEventListener('mousemove', mousemove);
		document.addEventListener('mouseup', mouseup);
		const cls = opts.classWhileDragging || 'dragging-vertical';
		node.classList.add(cls);
	}

	function mousemove(e: MouseEvent) {
		if (!dragging) return;
		globalState.getVideoPreviewState.showAlignmentGridWhileDragging = true;

		// Gestion du drag vertical
		const deltaY = e.clientY - startY;
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
			const deltaX = e.clientX - startX;
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

		// Déclenche un refresh si nécessaire pour certains styles
		if (
			opts.verticalStyleId === 'vertical-position' ||
			opts.verticalStyleId === 'horizontal-position' ||
			opts.horizontalStyleId === 'vertical-position' ||
			opts.horizontalStyleId === 'horizontal-position'
		) {
			globalState.updateVideoPreviewUI();
		}
	}

	function mouseup() {
		if (!dragging) return;
		dragging = false;
		globalState.getVideoPreviewState.showAlignmentGridWhileDragging = false;
		document.removeEventListener('mousemove', mousemove);
		document.removeEventListener('mouseup', mouseup);
		const cls = opts.classWhileDragging || 'dragging-vertical';
		node.classList.remove(cls);
	}

	node.addEventListener('mousedown', mousedown);
	if (!node.style.cursor) node.style.cursor = 'move';

	return {
		update(newOptions: VerticalDragOptions) {
			opts = newOptions;
		},
		destroy() {
			globalState.getVideoPreviewState.showAlignmentGridWhileDragging = false;
			node.removeEventListener('mousedown', mousedown);
			document.removeEventListener('mousemove', mousemove);
			document.removeEventListener('mouseup', mouseup);
		}
	};
}
