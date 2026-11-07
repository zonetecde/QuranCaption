import { applyTextTransform, getTextLineRects } from './TextLayout';

const renderers = new Map<HTMLElement, () => void>();
const svgNamespace = 'http://www.w3.org/2000/svg';

/**
 * Actualise les contours avant une capture, sans attendre la prochaine frame.
 * @param {HTMLElement} root Racine de la capture.
 * @returns {void} Rien.
 */
export function refreshRoundedTextOutlines(root: HTMLElement): void {
	for (const [element, render] of renderers) {
		if (root.contains(element)) render();
	}
}

/**
 * Trace un contour SVG arrondi sous le texte HTML, sans modifier sa mise en page.
 * @param {HTMLElement} node Calque de remplissage du texte.
 * @param {string} _css Styles dont les changements déclenchent une actualisation.
 * @returns {{ update: (css: string) => void; destroy: () => void }} Cycle de vie de l'action.
 */
export function roundedTextOutline(node: HTMLElement, _css: string) {
	const svg = document.createElementNS(svgNamespace, 'svg');
	svg.classList.add('rounded-text-outline');
	svg.setAttribute('aria-hidden', 'true');
	svg.setAttribute('width', '100%');
	svg.setAttribute('height', '100%');
	svg.style.cssText =
		'position:absolute;left:0;top:0;overflow:visible;pointer-events:none;z-index:-1;';
	node.append(svg);
	const context = document.createElement('canvas').getContext('2d')!;
	let frame = 0;
	let destroyed = false;
	const observer = new MutationObserver(handleMutations);
	const resizeObserver = new ResizeObserver(schedule);

	/**
	 * Ignore les styles temporairement neutralisés puis restaurés par une autre mesure.
	 * @param {MutationRecord[]} records Changements observés depuis la dernière mesure.
	 * @returns {void} Rien.
	 */
	function handleMutations(records: MutationRecord[]): void {
		const attributes = new Map<Node, Set<string>>();
		for (const record of records) {
			if (record.type !== 'attributes') {
				schedule();
				return;
			}
			const name = record.attributeName!;
			const seen = attributes.get(record.target) ?? new Set<string>();
			if (seen.has(name)) continue;
			seen.add(name);
			attributes.set(record.target, seen);
			if (record.oldValue !== (record.target as Element).getAttribute(name)) {
				schedule();
				return;
			}
		}
	}

	/**
	 * Observe le contenu et les styles hérités, hors mutations du tracé lui-même.
	 * @returns {void} Rien.
	 */
	function observe(): void {
		observer.observe(node, {
			subtree: true,
			childList: true,
			characterData: true,
			attributes: true,
			attributeOldValue: true
		});
		for (let ancestor = node.parentElement; ancestor; ancestor = ancestor.parentElement) {
			observer.observe(ancestor, { attributes: true, attributeOldValue: true });
		}
	}

	/**
	 * Regroupe les changements DOM dans la prochaine frame.
	 * @returns {void} Rien.
	 */
	function schedule(): void {
		if (!destroyed && !frame) frame = requestAnimationFrame(render);
	}

	/**
	 * Mesure les lignes HTML et reconstruit uniquement leur tracé extérieur.
	 * @returns {void} Rien.
	 */
	function render(): void {
		cancelAnimationFrame(frame);
		frame = 0;
		observer.disconnect();
		const transforms = new Map<
			HTMLElement,
			{
				value: string;
				rotate: string;
				priority: string;
				rotatePriority: string;
				matrix: DOMMatrix;
				transform?: DOMMatrix;
			}
		>();
		try {
			// Mesurer avant les transformations évite les rectangles englobants des textes tournés.
			const elements: HTMLElement[] = Array.from(node.querySelectorAll<HTMLElement>('*')).filter(
				(element) => element instanceof HTMLElement
			);
			for (let ancestor: HTMLElement | null = node; ancestor; ancestor = ancestor.parentElement)
				elements.push(ancestor);
			for (const element of elements) {
				const style = getComputedStyle(element);
				if (style.transform === 'none' && (style.rotate === 'none' || style.rotate === '0deg'))
					continue;
				transforms.set(element, {
					value: element.style.getPropertyValue('transform'),
					rotate: element.style.getPropertyValue('rotate'),
					priority: element.style.getPropertyPriority('transform'),
					rotatePriority: element.style.getPropertyPriority('rotate'),
					matrix: new DOMMatrix()
						.rotate(Number.parseFloat(style.rotate) || 0)
						.multiply(new DOMMatrix(style.transform === 'none' ? undefined : style.transform))
				});
				element.style.setProperty('transform', 'matrix(1, 0, 0, 1, 0, 0)', 'important');
				element.style.setProperty('rotate', 'none', 'important');
			}
			const rootRect = node.getBoundingClientRect();
			for (const [element, entry] of transforms) {
				if (!node.contains(element) || element === node) continue;
				const rect = element.getBoundingClientRect();
				const [originX, originY] = getComputedStyle(element)
					.transformOrigin.split(' ')
					.map(Number.parseFloat);
				const x = rect.left - rootRect.left + originX;
				const y = rect.top - rootRect.top + originY;
				entry.transform = new DOMMatrix().translate(x, y).multiply(entry.matrix).translate(-x, -y);
			}
			const strokeStyle = getComputedStyle(node.parentElement!);
			const fragment = document.createDocumentFragment();
			const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
			while (walker.nextNode()) {
				const textNode = walker.currentNode as Text;
				const parent = textNode.parentElement;
				if (!parent || svg.contains(parent) || !textNode.data.trim()) continue;
				const style = getComputedStyle(parent);
				if (style.visibility !== 'visible' || style.display === 'none') continue;
				let opacity = 1;
				let transform = new DOMMatrix();
				const filters: string[] = [];
				for (
					let element: HTMLElement | null = parent;
					element && element !== node;
					element = element.parentElement
				) {
					const ancestorStyle = getComputedStyle(element);
					opacity *= Number(ancestorStyle.opacity);
					if (ancestorStyle.filter !== 'none') filters.push(ancestorStyle.filter);
					const matrix = transforms.get(element)?.transform;
					if (matrix) transform = matrix.multiply(transform);
				}
				if (!opacity) continue;
				context.font = style.font;
				context.textBaseline = 'alphabetic';
				for (const line of getTextLineRects(textNode, 1, style.textAlign === 'justify')) {
					const raw = textNode.data.slice(line.start, line.end);
					const text = applyTextTransform(raw.trim(), style.textTransform);
					if (!text) continue;
					const range = document.createRange();
					range.setStart(textNode, line.start + raw.length - raw.trimStart().length);
					range.setEnd(textNode, line.end - (raw.length - raw.trimEnd().length));
					const rect = range.getBoundingClientRect();
					const outline = document.createElementNS(svgNamespace, 'text');
					outline.textContent = text;
					for (const property of [
						'font-family',
						'font-size',
						'font-weight',
						'font-style',
						'font-stretch',
						'font-kerning',
						'font-variant',
						'font-feature-settings',
						'font-variation-settings',
						'letter-spacing',
						'word-spacing',
						'direction'
					]) {
						outline.style.setProperty(property, style.getPropertyValue(property));
					}
					outline.style.whiteSpace = style.whiteSpace;
					outline.setAttribute(
						'x',
						String((style.direction === 'rtl' ? rect.right : rect.left) - rootRect.left)
					);
					outline.setAttribute(
						'y',
						String(rect.top - rootRect.top + context.measureText(text).fontBoundingBoxAscent)
					);
					outline.setAttribute('fill', 'none');
					outline.setAttribute('stroke', strokeStyle.webkitTextStrokeColor);
					outline.setAttribute('stroke-width', strokeStyle.webkitTextStrokeWidth);
					outline.setAttribute('stroke-linejoin', 'round');
					outline.setAttribute('stroke-linecap', 'round');
					outline.setAttribute('transform', transform.toString());
					outline.style.opacity = String(opacity);
					outline.style.filter = filters.join(' ') || 'none';
					fragment.append(outline);
				}
			}
			svg.replaceChildren(fragment);
			// WebKit peut découper les débordements SVG lors d'une capture en foreignObject.
			const bounds = svg.getBBox();
			const padding = Number.parseFloat(strokeStyle.webkitTextStrokeWidth) / 2 + 1;
			const left = Math.min(0, bounds.x) - padding;
			const top = Math.min(0, bounds.y) - padding;
			const width = Math.max(rootRect.width, bounds.x + bounds.width) + padding - left;
			const height = Math.max(rootRect.height, bounds.y + bounds.height) + padding - top;
			svg.style.left = `${left}px`;
			svg.style.top = `${top}px`;
			svg.setAttribute('width', String(width));
			svg.setAttribute('height', String(height));
			svg.setAttribute('viewBox', `${left} ${top} ${width} ${height}`);
		} finally {
			for (const [element, entry] of transforms) {
				if (entry.value) element.style.setProperty('transform', entry.value, entry.priority);
				else element.style.removeProperty('transform');
				if (entry.rotate) element.style.setProperty('rotate', entry.rotate, entry.rotatePriority);
				else element.style.removeProperty('rotate');
			}
			observe();
		}
	}

	observe();
	resizeObserver.observe(node);
	document.fonts.addEventListener('loadingdone', schedule);
	renderers.set(node, render);
	schedule();
	return {
		update: schedule,
		/** Libère les observateurs et le tracé. @returns {void} Rien. */
		destroy: () => {
			destroyed = true;
			cancelAnimationFrame(frame);
			observer.disconnect();
			resizeObserver.disconnect();
			document.fonts.removeEventListener('loadingdone', schedule);
			renderers.delete(node);
			svg.remove();
		}
	};
}
