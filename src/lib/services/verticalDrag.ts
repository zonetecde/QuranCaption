import { globalState } from '$lib/runes/main.svelte';
import type { StyleName } from '$lib/classes/VideoStyle.svelte';
import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
import { getSubtitleCollisionElements } from '$lib/components/projectEditor/videoPreview/helpers/antiCollision';

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

/**
 * Mesure uniquement le contenu réellement visible d'un élément draggable.
 * @param {HTMLElement} element Élément dont le contenu doit être mesuré.
 * @returns {DOMRect} Rectangle englobant les textes et médias visibles.
 */
function getVisibleContentRect(element: HTMLElement): DOMRect {
	const visibleRects: DOMRect[] = [];
	const elements = [element, ...Array.from(element.querySelectorAll<HTMLElement>('*'))];

	for (const current of elements) {
		let visibilityNode: HTMLElement | null = current;
		let hidden = false;
		while (visibilityNode) {
			const style = getComputedStyle(visibilityNode);
			if (
				style.display === 'none' ||
				style.visibility === 'hidden' ||
				Number(style.opacity) === 0
			) {
				hidden = true;
				break;
			}
			if (visibilityNode === element) break;
			visibilityNode = visibilityNode.parentElement;
		}
		if (hidden) continue;
		for (const child of current.childNodes) {
			if (child.nodeType !== Node.TEXT_NODE || !child.textContent?.trim()) continue;
			const range = document.createRange();
			range.selectNodeContents(child);
			const rect = range.getBoundingClientRect();
			if (rect.width > 0 && rect.height > 0) visibleRects.push(rect);
		}
		if (current.matches('img, svg, canvas, video')) {
			const rect = current.getBoundingClientRect();
			if (rect.width > 0 && rect.height > 0) visibleRects.push(rect);
		}
	}

	if (visibleRects.length === 0) return element.getBoundingClientRect();
	const left = Math.min(...visibleRects.map((rect) => rect.left));
	const top = Math.min(...visibleRects.map((rect) => rect.top));
	const right = Math.max(...visibleRects.map((rect) => rect.right));
	const bottom = Math.max(...visibleRects.map((rect) => rect.bottom));
	return new DOMRect(left, top, right - left, bottom - top);
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
	let dragStartRect: DOMRect | null = null;
	let snapTargetRects: DOMRect[] = [];
	let subtitlePositionDragContainer: HTMLElement | null = null;
	let collisionFrameId: number | null = null;
	let runtimeVerticalOffset = 0;
	let lastVerticalValue = 0;
	let hasMoved = false;
	let isStuckToZero = false; // Pour le sticky behavior horizontal
	const HORIZONTAL_STICK_RANGE = 50; // Zone de stick autour de 0 (-50 à +50)
	const hadTouchNone = node.classList.contains('touch-none');
	const ELEMENT_SNAP_RANGE = 8;

	/**
	 * Affiche les guides correspondant aux axes actuellement accrochés.
	 * @param {number | null} x Position horizontale dans le viewport.
	 * @param {number | null} y Position verticale dans le viewport.
	 * @returns {void}
	 */
	function updateSnapGuides(x: number | null, y: number | null): void {
		const overlay = node.closest<HTMLElement>('#overlay');
		const verticalGuide = document.getElementById('preview-element-snap-x');
		const horizontalGuide = document.getElementById('preview-element-snap-y');
		if (!overlay || !verticalGuide || !horizontalGuide) return;

		const overlayRect = overlay.getBoundingClientRect();
		verticalGuide.style.display = x === null ? 'none' : 'block';
		horizontalGuide.style.display = y === null ? 'none' : 'block';
		if (x !== null) verticalGuide.style.left = `${(x - overlayRect.left) / scaleX}px`;
		if (y !== null) horizontalGuide.style.top = `${(y - overlayRect.top) / scaleY}px`;
	}

	/**
	 * Retire l'indication visuelle de collision du déplacement courant.
	 * @returns {void}
	 */
	function clearSubtitleCollisionPreview(): void {
		if (collisionFrameId !== null) cancelAnimationFrame(collisionFrameId);
		collisionFrameId = null;
		subtitlePositionDragContainer
			?.querySelectorAll('.position-drag-collision')
			.forEach((element) => element.classList.remove('position-drag-collision'));
		if (subtitlePositionDragContainer) {
			delete subtitlePositionDragContainer.dataset.positionDragCollision;
		}
	}

	/**
	 * Planifie la détection visuelle après la mise à jour du layout par Svelte.
	 * @returns {void}
	 */
	function scheduleSubtitleCollisionPreview(): void {
		if (!subtitlePositionDragContainer) return;
		if (collisionFrameId !== null) cancelAnimationFrame(collisionFrameId);
		collisionFrameId = requestAnimationFrame(() => {
			collisionFrameId = null;
			clearSubtitleCollisionPreview();
			if (!Boolean(globalState.getStyleValue('global', 'anti-collision'))) return;

			const spacing = Number(globalState.getStyleValue('global', 'spacing')) || 0;
			const elements = getSubtitleCollisionElements(subtitlePositionDragContainer!, node, spacing);
			for (const element of elements) element.classList.add('position-drag-collision');
			if (elements.length > 0) {
				subtitlePositionDragContainer!.dataset.positionDragCollision = 'true';
			}
		});
	}

	/**
	 * Applique la position verticale aux clips sélectionnés ou au style global.
	 * @param {number} value Position à appliquer.
	 * @returns {void}
	 */
	function applyAutomaticVertical(value: number): void {
		if (!opts.target || !opts.verticalStyleId) return;
		const styles = globalState.getVideoStyle.getStylesOfTarget(opts.target);
		const selectedIds =
			globalState.currentProject!.projectEditorState.stylesEditor.selectedSubtitles.map(
				(s) => s.id
			);
		if (styles.getKeyframeTimes(opts.verticalStyleId, selectedIds).length > 0) {
			styles.setKeyframe(
				opts.verticalStyleId,
				globalState.getTimelineState.cursorPosition,
				value,
				selectedIds
			);
		} else if (selectedIds.length > 0) {
			styles.setStyleForClips(selectedIds, opts.verticalStyleId, value);
		} else styles.setStyle(opts.verticalStyleId, value);
	}

	/**
	 * Démarre le déplacement avec la souris, le stylet ou le toucher.
	 * @param {PointerEvent} e Événement initial du pointeur.
	 * @returns {void}
	 */
	function pointerdown(e: PointerEvent) {
		if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
		if (node.classList.contains('subtitle')) {
			const bounds = node.getBoundingClientRect();
			const isInCenter =
				e.clientX >= bounds.left + bounds.width * 0.25 &&
				e.clientX <= bounds.right - bounds.width * 0.25 &&
				e.clientY >= bounds.top + bounds.height * 0.25 &&
				e.clientY <= bounds.bottom - bounds.height * 0.25;
			// Les zones périphériques restent réservées aux poignées de redimensionnement tactiles.
			if (!isInCenter) return;
		}
		e.preventDefault();
		ProjectHistoryManager.begin('drag style position');
		startY = e.clientY;
		startX = e.clientX;
		const preview = node.closest<HTMLElement>('#preview');
		const previewBounds = preview?.getBoundingClientRect();
		scaleY = preview && previewBounds ? previewBounds.height / preview.offsetHeight || 1 : 1;
		scaleX = preview && previewBounds ? previewBounds.width / preview.offsetWidth || 1 : 1;
		isStuckToZero = false;
		hasMoved = false;
		activePointerId = e.pointerId;
		dragStartRect = getVisibleContentRect(node);
		snapTargetRects = Array.from(
			node.closest('#overlay')?.querySelectorAll<HTMLElement>('[data-preview-draggable]') ?? []
		)
			.filter((element) => {
				const style = getComputedStyle(element);
				return element !== node && element.offsetParent !== null && style.opacity !== '0';
			})
			.map(getVisibleContentRect);

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
					globalState.getVideoStyle
						.getStylesOfTarget(opts.target)
						.getEffectiveValue(opts.verticalStyleId)
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
							.getEffectiveValue(opts.horizontalStyleId)
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
		runtimeVerticalOffset =
			opts.target && opts.verticalStyleId === 'vertical-position'
				? Number.parseFloat(getComputedStyle(node).getPropertyValue('--reactive-y-position')) || 0
				: 0;
		lastVerticalValue = originVertical;

		dragging = true;
		node.setPointerCapture(e.pointerId);
		const isPositionDrag = [opts.verticalStyleId, opts.horizontalStyleId].some(
			(styleId) => styleId === 'vertical-position' || styleId === 'horizontal-position'
		);
		if (opts.target && isPositionDrag) {
			subtitlePositionDragContainer = node.closest<HTMLElement>('#subtitles-container');
			if (subtitlePositionDragContainer) {
				subtitlePositionDragContainer.dataset.positionDragTarget = opts.target;
			}
		}
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
		const deltaX = (e.clientX - startX) / scaleX;
		let snappedDeltaY = deltaY;
		let snappedDeltaX = deltaX;
		let snappedGuideY: number | null = null;
		let snappedGuideX: number | null = null;
		if (dragStartRect) {
			let closestY = ELEMENT_SNAP_RANGE;
			let closestX = ELEMENT_SNAP_RANGE;
			const draggedCenterY = dragStartRect.top + dragStartRect.height / 2;
			const draggedCenterX = dragStartRect.left + dragStartRect.width / 2;
			for (const targetRect of snapTargetRects) {
				const targetCenterY = targetRect.top + targetRect.height / 2;
				const targetCenterX = targetRect.left + targetRect.width / 2;
				const yDistance = targetCenterY - (draggedCenterY + deltaY * scaleY);
				if (Math.abs(yDistance) < closestY) {
					closestY = Math.abs(yDistance);
					snappedDeltaY = deltaY + yDistance / scaleY;
					snappedGuideY = targetCenterY;
				}
				const xDistance = targetCenterX - (draggedCenterX + deltaX * scaleX);
				if (Math.abs(xDistance) < closestX) {
					closestX = Math.abs(xDistance);
					snappedDeltaX = deltaX + xDistance / scaleX;
					snappedGuideX = targetCenterX;
				}
			}
		}
		updateSnapGuides(snappedGuideX, snappedGuideY);
		let verticalVal = originVertical + snappedDeltaY;

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
		lastVerticalValue = verticalVal;
		hasMoved = true;

		// Application du vertical
		if (opts.target && opts.verticalStyleId) {
			applyAutomaticVertical(verticalVal);
		} else {
			opts.applyVertical!(verticalVal);
		}

		// Gestion du drag horizontal (si activé)
		if (opts.horizontalStyleId || opts.applyHorizontal) {
			let horizontalVal = originHorizontal + snappedDeltaX;

			// Sticky behavior près de zéro
			// Si la valeur est dans la zone de stick (-50 à +50), on stick à 0
			if (snappedGuideX === null && Math.abs(horizontalVal) <= HORIZONTAL_STICK_RANGE) {
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
				const styles = globalState.getVideoStyle.getStylesOfTarget(opts.target);
				const selectedIds =
					globalState.currentProject!.projectEditorState.stylesEditor.selectedSubtitles.map(
						(s) => s.id
					);
				if (styles.getKeyframeTimes(opts.horizontalStyleId, selectedIds).length > 0) {
					styles.setKeyframe(
						opts.horizontalStyleId,
						globalState.getTimelineState.cursorPosition,
						horizontalVal,
						selectedIds
					);
				} else if (selectedIds.length > 0) {
					styles.setStyleForClips(selectedIds, opts.horizontalStyleId, horizontalVal);
				} else styles.setStyle(opts.horizontalStyleId, horizontalVal);
			} else if (opts.applyHorizontal) {
				opts.applyHorizontal(horizontalVal);
			}
		}
		scheduleSubtitleCollisionPreview();
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
		clearSubtitleCollisionPreview();
		if (
			!subtitlePositionDragContainer &&
			(opts.verticalStyleId === 'vertical-position' ||
				opts.verticalStyleId === 'horizontal-position' ||
				opts.horizontalStyleId === 'vertical-position' ||
				opts.horizontalStyleId === 'horizontal-position')
		) {
			globalState.updateVideoPreviewUI();
		}
		updateSnapGuides(null, null);
		if (
			hasMoved &&
			runtimeVerticalOffset !== 0 &&
			opts.target &&
			opts.verticalStyleId === 'vertical-position'
		) {
			const style = globalState.getVideoStyle
				.getStylesOfTarget(opts.target)
				.findStyle(opts.verticalStyleId)!;
			let committedVertical = lastVerticalValue + runtimeVerticalOffset;
			if (typeof style.valueMin === 'number')
				committedVertical = Math.max(style.valueMin, committedVertical);
			if (typeof style.valueMax === 'number')
				committedVertical = Math.min(style.valueMax, committedVertical);
			if (opts.round !== false) committedVertical = Math.round(committedVertical);
			applyAutomaticVertical(committedVertical);
			node.style.setProperty('--reactive-y-position', '0px');
		}
		ProjectHistoryManager.commit();
		if (subtitlePositionDragContainer) {
			delete subtitlePositionDragContainer.dataset.positionDragTarget;
			subtitlePositionDragContainer.dataset.positionDragCommit = 'true';
			subtitlePositionDragContainer = null;
			globalState.updateVideoPreviewUI();
		}
	}

	node.dataset.previewDraggable = 'true';
	node.addEventListener('pointerdown', pointerdown);
	node.classList.add('touch-none');
	if (!node.style.cursor) node.style.cursor = 'move';

	return {
		update(newOptions: VerticalDragOptions) {
			opts = newOptions;
		},
		destroy() {
			globalState.getVideoPreviewState.showAlignmentGridWhileDragging = false;
			updateSnapGuides(null, null);
			delete node.dataset.previewDraggable;
			clearSubtitleCollisionPreview();
			node.removeEventListener('pointerdown', pointerdown);
			document.removeEventListener('pointermove', pointermove);
			document.removeEventListener('pointerup', pointerup);
			document.removeEventListener('pointercancel', pointerup);
			if (!hadTouchNone) node.classList.remove('touch-none');
			if (subtitlePositionDragContainer) {
				delete subtitlePositionDragContainer.dataset.positionDragTarget;
				delete subtitlePositionDragContainer.dataset.positionDragCommit;
			}
			ProjectHistoryManager.cancel();
		}
	};
}
