import { domToBlob } from 'modern-screenshot';

const EXPORT_TEXT_WEIGHT_COMPENSATION_MAX_PX = 0.45;
const EXPORT_TEXT_WEIGHT_COMPENSATION_RATIO = 0.0125;
const EXPORT_TEXT_SHADOW_OPACITY = 0.75;

type ParsedTextShadow = {
	color: string;
	offsetX: number;
	offsetY: number;
	blur: number;
};

type TextDrawRun = {
	text: string;
	x: number;
	y: number;
	font: string;
	color: string;
	opacity: number;
	direction: CanvasDirection;
	align: CanvasTextAlign;
	letterSpacing: string;
	fontKerning: string;
	fontStretch: string;
	fontVariantCaps: string;
	shadows: ParsedTextShadow[];
};

type TextTokenRect = {
	start: number;
	end: number;
	rect: DOMRect;
};

type TextLineRect = {
	start: number;
	end: number;
	rect: DOMRect;
};

/**
 * Indique si l'optimisation de rendu texte d'export doit etre activee.
 * @returns `true` si l'agent utilisateur courant est macOS.
 */
export function shouldRedrawExportTextWithCanvas(): boolean {
	return navigator.userAgent.toLowerCase().includes('mac');
}

/**
 * Capture l'overlay en PNG en reappliquant le texte en canvas pour macOS.
 * @param root Element racine de l'overlay export.
 * @param scale Echelle de capture calculee depuis la cible d'export.
 * @param targetWidth Largeur de sortie en pixels.
 * @param targetHeight Hauteur de sortie en pixels.
 * @returns Les octets PNG du frame final.
 */
export async function captureMacOsOverlayPngBytes(
	root: HTMLElement,
	scale: number,
	targetWidth: number,
	targetHeight: number
): Promise<Uint8Array> {
	const roundedTargetWidth = Math.round(targetWidth);
	const roundedTargetHeight = Math.round(targetHeight);
	const textRuns = collectLiveTextDrawRuns(root);
	const restoreCaptureEffects = inlineComputedCaptureEffects(root);
	const restoreHiddenText = hideTextForOverlayCapture(root);
	let blob: Blob | null = null;

	try {
		blob = await domToBlob(root, {
			width: root.clientWidth,
			height: root.clientHeight,
			scale,
			quality: 1
		});
	} finally {
		restoreHiddenText();
		restoreCaptureEffects();
	}

	if (!blob) throw new Error('domToBlob returned null');

	return await blobToExactPngBytesWithLiveText(
		blob,
		textRuns,
		root.clientWidth,
		root.clientHeight,
		roundedTargetWidth,
		roundedTargetHeight
	);
}

/**
 * Encode un canvas en PNG.
 * @param canvas Canvas source.
 * @returns Les octets PNG.
 */
async function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
	const blob = await new Promise<Blob>((resolve, reject) => {
		canvas.toBlob((value) => {
			if (value) resolve(value);
			else reject(new Error('Could not encode export frame as PNG.'));
		}, 'image/png');
	});

	return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Decode un blob image en element HTMLImageElement.
 * @param blob Blob PNG source.
 * @returns L'image decodee.
 */
async function decodeBlobAsImage(blob: Blob): Promise<HTMLImageElement> {
	const url = URL.createObjectURL(blob);
	const image = new Image();

	try {
		await new Promise<void>((resolve, reject) => {
			image.onload = () => resolve();
			image.onerror = () => reject(new Error('Could not decode export frame PNG.'));
			image.src = url;
		});
		return image;
	} finally {
		URL.revokeObjectURL(url);
	}
}

/**
 * Fige les ombres calculees pour garantir une capture visuelle stable.
 * @param root Element racine de capture.
 * @returns Une fonction de restauration des styles.
 */
function inlineComputedCaptureEffects(root: HTMLElement): () => void {
	const changedElements: Array<{
		element: HTMLElement;
		textShadow: string;
		boxShadow: string;
	}> = [];

	for (const element of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
		const computedStyle = getComputedStyle(element);
		const textShadow = computedStyle.textShadow;
		const boxShadow = computedStyle.boxShadow;
		const hasTextShadow = textShadow && textShadow !== 'none';
		const hasBoxShadow = boxShadow && boxShadow !== 'none';

		if (!hasTextShadow && !hasBoxShadow) continue;

		changedElements.push({
			element,
			textShadow: element.style.textShadow,
			boxShadow: element.style.boxShadow
		});

		if (hasTextShadow) element.style.textShadow = textShadow;
		if (hasBoxShadow) element.style.boxShadow = boxShadow;
	}

	return () => {
		for (const { element, textShadow, boxShadow } of changedElements) {
			element.style.textShadow = textShadow;
			element.style.boxShadow = boxShadow;
		}
	};
}

/**
 * Separe proprement une liste CSS d'ombres en tenant compte des parenthèses.
 * @param value Valeur CSS brute.
 * @returns Liste des ombres individuelles.
 */
function splitCssShadowList(value: string): string[] {
	const shadows: string[] = [];
	let depth = 0;
	let current = '';

	for (const char of value) {
		if (char === '(') depth += 1;
		if (char === ')') depth = Math.max(0, depth - 1);
		if (char === ',' && depth === 0) {
			shadows.push(current.trim());
			current = '';
			continue;
		}
		current += char;
	}

	if (current.trim()) shadows.push(current.trim());
	return shadows;
}

/**
 * Parse une ombre texte CSS simple vers un format exploitable en canvas.
 * @param shadow Ombre CSS.
 * @param fallbackColor Couleur par defaut.
 * @returns L'ombre parsee ou `null` si invalide.
 */
function parseTextShadow(shadow: string, fallbackColor: string): ParsedTextShadow | null {
	const colorMatch = shadow.match(/(?:rgba?|hsla?)\([^)]*\)|#[0-9a-fA-F]{3,8}|[a-zA-Z]+/);
	const color = colorMatch?.[0] ?? fallbackColor;
	const numericPart = colorMatch ? shadow.replace(colorMatch[0], ' ') : shadow;
	const numbers = Array.from(numericPart.matchAll(/-?\d*\.?\d+px/g)).map((match) =>
		Number.parseFloat(match[0])
	);

	if (numbers.length < 2) return null;

	return {
		color,
		offsetX: numbers[0],
		offsetY: numbers[1],
		blur: numbers[2] ?? 0
	};
}

/**
 * Parse toutes les ombres texte d'un style CSS.
 * @param textShadow Valeur de `text-shadow`.
 * @param fallbackColor Couleur de repli.
 * @returns La liste des ombres parsees.
 */
function parseTextShadows(textShadow: string, fallbackColor: string): ParsedTextShadow[] {
	if (!textShadow || textShadow === 'none') return [];
	return splitCssShadowList(textShadow)
		.map((shadow) => parseTextShadow(shadow, fallbackColor))
		.filter((shadow): shadow is ParsedTextShadow => shadow !== null);
}

/**
 * Applique une opacite a une couleur CSS normalisee.
 * @param color Couleur source.
 * @param opacity Opacite cible entre 0 et 1.
 * @returns Une couleur rgba ou la couleur d'origine si conversion impossible.
 */
function colorWithOpacity(color: string, opacity: number): string {
	const canvas = document.createElement('canvas');
	const context = canvas.getContext('2d');
	if (!context) return color;

	context.fillStyle = color;
	const normalized = context.fillStyle;
	const hexMatch = normalized.match(/^#([0-9a-f]{6})$/i);
	if (!hexMatch) return color;

	const hex = hexMatch[1];
	const red = Number.parseInt(hex.slice(0, 2), 16);
	const green = Number.parseInt(hex.slice(2, 4), 16);
	const blue = Number.parseInt(hex.slice(4, 6), 16);
	return `rgba(${red}, ${green}, ${blue}, ${opacity})`;
}

/**
 * Traduit une direction CSS vers `CanvasDirection`.
 * @param value Direction CSS.
 * @returns Direction canvas.
 */
function toCanvasDirection(value: string): CanvasDirection {
	return value === 'rtl' ? 'rtl' : 'ltr';
}

/**
 * Traduit une direction canvas vers alignement texte.
 * @param direction Direction canvas.
 * @returns Alignement canvas.
 */
function toCanvasTextAlign(direction: CanvasDirection): CanvasTextAlign {
	return direction === 'rtl' ? 'right' : 'left';
}

/**
 * Reproduit le comportement de `text-transform` pour le texte capture.
 * @param text Texte source.
 * @param transform Valeur CSS `text-transform`.
 * @returns Texte transforme.
 */
function applyTextTransform(text: string, transform: string): string {
	if (transform === 'uppercase') return text.toUpperCase();
	if (transform === 'lowercase') return text.toLowerCase();
	if (transform === 'capitalize') {
		return text.replace(/\b\S/g, (char) => char.toUpperCase());
	}
	return text;
}

/**
 * Extrait les bornes de chaque token visible pour reconstruire les lignes.
 * @param text Texte brut.
 * @returns Tableau des bornes de tokens.
 */
function getTextTokenRanges(text: string): Array<{ start: number; end: number }> {
	const tokens: Array<{ start: number; end: number }> = [];
	const tokenPattern = /\S+\s*/g;
	let match: RegExpExecArray | null;

	while ((match = tokenPattern.exec(text)) !== null) {
		tokens.push({
			start: match.index,
			end: match.index + match[0].length
		});
	}

	return tokens;
}

/**
 * Calcule un identifiant de ligne stable base sur la position verticale.
 * @param rect Rectangle du token.
 * @param rootScaleY Echelle verticale locale.
 * @returns Bucket de ligne.
 */
function getLineBucket(rect: DOMRect, rootScaleY: number): number {
	return Math.round(rect.top * rootScaleY);
}

/**
 * Reconstruit des lignes de texte depuis les rects DOM de tokens.
 * @param textNode Noeud texte source.
 * @param rootScaleY Echelle verticale locale.
 * @returns Liste des lignes detectees.
 */
function getTextLineRects(textNode: Text, rootScaleY: number): TextLineRect[] {
	const tokenRects: TextTokenRect[] = [];

	for (const token of getTextTokenRanges(textNode.data)) {
		const range = document.createRange();
		range.setStart(textNode, token.start);
		range.setEnd(textNode, token.end);
		const rects = Array.from(range.getClientRects());
		range.detach();

		for (const rect of rects) {
			if (!rect.width || !rect.height) continue;
			tokenRects.push({ ...token, rect });
		}
	}

	const lineGroups = new Map<number, TextTokenRect[]>();
	for (const tokenRect of tokenRects) {
		const bucket = getLineBucket(tokenRect.rect, rootScaleY);
		const group = lineGroups.get(bucket);
		if (group) group.push(tokenRect);
		else lineGroups.set(bucket, [tokenRect]);
	}

	return Array.from(lineGroups.values()).map((group) => {
		const start = Math.min(...group.map((token) => token.start));
		const end = Math.max(...group.map((token) => token.end));
		const left = Math.min(...group.map((token) => token.rect.left));
		const right = Math.max(...group.map((token) => token.rect.right));
		const top = Math.min(...group.map((token) => token.rect.top));
		const bottom = Math.max(...group.map((token) => token.rect.bottom));

		return {
			start,
			end,
			rect: new DOMRect(left, top, right - left, bottom - top)
		};
	});
}

/**
 * Calcule l'opacite cumulée du noeud jusqu'a la racine de capture.
 * @param element Element courant.
 * @param root Racine de capture.
 * @returns Opacite cumulee.
 */
function getCumulativeOpacity(element: HTMLElement, root: HTMLElement): number {
	let opacity = 1;
	let current: HTMLElement | null = element;

	while (current && current !== root.parentElement) {
		const currentOpacity = Number(getComputedStyle(current).opacity);
		if (Number.isFinite(currentOpacity)) opacity *= currentOpacity;
		if (current === root) break;
		current = current.parentElement;
	}

	return opacity;
}

/**
 * Extrait les runs texte visibles a redessiner en canvas.
 * @param root Racine de capture.
 * @returns Liste des runs texte.
 */
function collectLiveTextDrawRuns(root: HTMLElement): TextDrawRun[] {
	const rootRect = root.getBoundingClientRect();
	const localScaleX = root.clientWidth / rootRect.width;
	const localScaleY = root.clientHeight / rootRect.height;
	const runs: TextDrawRun[] = [];
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

	while (walker.nextNode()) {
		const textNode = walker.currentNode as Text;
		const parent = textNode.parentElement;
		if (!parent || !textNode.data.trim()) continue;

		const computedStyle = getComputedStyle(parent);
		if (computedStyle.display === 'none' || computedStyle.visibility === 'hidden') continue;

		const opacity = getCumulativeOpacity(parent, root);
		if (opacity <= 0) continue;

		const direction = toCanvasDirection(computedStyle.direction);
		const align = toCanvasTextAlign(direction);
		const shadows = parseTextShadows(computedStyle.textShadow, computedStyle.color);

		for (const line of getTextLineRects(textNode, localScaleY)) {
			const text = textNode.data.slice(line.start, line.end).trim();
			if (!text) continue;

			const x =
				direction === 'rtl'
					? (line.rect.right - rootRect.left) * localScaleX
					: (line.rect.left - rootRect.left) * localScaleX;

			runs.push({
				text: applyTextTransform(text, computedStyle.textTransform),
				x,
				y: (line.rect.top - rootRect.top) * localScaleY,
				font: computedStyle.font,
				color: computedStyle.color,
				opacity,
				direction,
				align,
				letterSpacing: computedStyle.letterSpacing,
				fontKerning: computedStyle.fontKerning,
				fontStretch: computedStyle.fontStretch,
				fontVariantCaps: computedStyle.fontVariantCaps,
				shadows
			});
		}
	}

	return runs;
}

/**
 * Masque temporairement le texte DOM pour eviter un double rendu.
 * @param root Racine de capture.
 * @returns Une fonction de restauration des styles.
 */
function hideTextForOverlayCapture(root: HTMLElement): () => void {
	const changedElements: Array<{
		element: HTMLElement;
		color: string;
		textFillColor: string;
		textShadow: string;
		textDecorationColor: string;
	}> = [];

	for (const element of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
		if (!element.textContent?.trim()) continue;

		changedElements.push({
			element,
			color: element.style.color,
			textFillColor: element.style.webkitTextFillColor,
			textShadow: element.style.textShadow,
			textDecorationColor: element.style.textDecorationColor
		});

		element.style.color = 'transparent';
		element.style.webkitTextFillColor = 'transparent';
		element.style.textShadow = 'none';
		element.style.textDecorationColor = 'transparent';
	}

	return () => {
		for (const {
			element,
			color,
			textFillColor,
			textShadow,
			textDecorationColor
		} of changedElements) {
			element.style.color = color;
			element.style.webkitTextFillColor = textFillColor;
			element.style.textShadow = textShadow;
			element.style.textDecorationColor = textDecorationColor;
		}
	};
}

/**
 * Applique une mise a l'echelle au premier `font-size` d'une declaration `font` CSS.
 * @param font Shorthand CSS `font`.
 * @param scale Facteur d'echelle.
 * @returns Font redimensionnee.
 */
function scaleCanvasFont(font: string, scale: number): string {
	let replaced = false;
	return font.replace(/(\d*\.?\d+)px/, (match, size: string) => {
		if (replaced) return match;
		replaced = true;
		return `${Number.parseFloat(size) * scale}px`;
	});
}

/**
 * Extrait la taille de police en pixels depuis un shorthand CSS `font`.
 * @param font Shorthand CSS `font`.
 * @returns Taille en pixels ou `null` si absente.
 */
function getFontSizePx(font: string): number | null {
	const match = font.match(/(\d*\.?\d+)px/);
	if (!match) return null;
	const size = Number.parseFloat(match[1]);
	return Number.isFinite(size) ? size : null;
}

/**
 * Met a l'echelle chaque valeur en `px` d'une chaine CSS.
 * @param value Valeur CSS source.
 * @param scale Facteur d'echelle.
 * @returns Valeur CSS redimensionnee.
 */
function scaleCssPixelValue(value: string, scale: number): string {
	if (!value || value === 'normal') return value;
	return value.replace(/(-?\d*\.?\d+)px/g, (_match, size: string) => {
		return `${Number.parseFloat(size) * scale}px`;
	});
}

/**
 * Dessine un run texte en reconstituant le poids et les ombres.
 * @param context Contexte canvas 2D.
 * @param run Donnees de texte a dessiner.
 * @param scaleX Echelle horizontale finale.
 * @param scaleY Echelle verticale finale.
 */
function drawTextRun(
	context: CanvasRenderingContext2D,
	run: TextDrawRun,
	scaleX: number,
	scaleY: number
) {
	const x = run.x * scaleX;
	const y = run.y * scaleY;
	const fontSizePx = getFontSizePx(run.font);
	const compensationCssPx =
		fontSizePx === null
			? EXPORT_TEXT_WEIGHT_COMPENSATION_MAX_PX
			: Math.min(
					EXPORT_TEXT_WEIGHT_COMPENSATION_MAX_PX,
					fontSizePx * EXPORT_TEXT_WEIGHT_COMPENSATION_RATIO
				);
	const compensationWidth = compensationCssPx * Math.max(scaleX, scaleY);

	context.save();
	context.globalAlpha = run.opacity;
	context.font = scaleCanvasFont(run.font, scaleY);
	context.fillStyle = run.color;
	context.strokeStyle = run.color;
	context.lineJoin = 'round';
	context.miterLimit = 2;
	context.textBaseline = 'top';
	context.textAlign = run.align;
	context.direction = run.direction;
	const extendedContext = context as CanvasRenderingContext2D & {
		letterSpacing?: string;
		textRendering?: string;
	} & Record<string, string | undefined>;
	if ('letterSpacing' in extendedContext) {
		extendedContext.letterSpacing = scaleCssPixelValue(run.letterSpacing, scaleX);
	}
	if ('fontKerning' in extendedContext) {
		(extendedContext as Record<string, string | undefined>).fontKerning = run.fontKerning;
	}
	if ('fontStretch' in extendedContext) {
		(extendedContext as Record<string, string | undefined>).fontStretch = run.fontStretch;
	}
	if ('fontVariantCaps' in extendedContext) {
		(extendedContext as Record<string, string | undefined>).fontVariantCaps = run.fontVariantCaps;
	}
	if ('textRendering' in extendedContext) {
		extendedContext.textRendering = 'geometricPrecision';
	}

	const clearShadow = () => {
		context.shadowColor = 'transparent';
		context.shadowBlur = 0;
		context.shadowOffsetX = 0;
		context.shadowOffsetY = 0;
	};

	const fillCompensatedText = () => {
		clearShadow();

		if (compensationWidth > 0) {
			// Le trait leger compense la perte de poids visible sur certains rendus macOS.
			context.save();
			context.lineWidth = compensationWidth;
			context.strokeText(run.text, x, y);
			context.restore();
		}

		context.fillText(run.text, x, y);
	};

	fillCompensatedText();

	if (run.shadows.length > 0) {
		context.globalCompositeOperation = 'destination-over';
		for (const shadow of run.shadows) {
			context.save();
			context.shadowColor = colorWithOpacity(shadow.color, EXPORT_TEXT_SHADOW_OPACITY);
			context.shadowBlur = shadow.blur * Math.max(scaleX, scaleY);
			context.shadowOffsetX = shadow.offsetX * scaleX;
			context.shadowOffsetY = shadow.offsetY * scaleY;
			context.fillText(run.text, x, y);
			context.restore();
		}
	}

	context.restore();
}

/**
 * Fusionne l'image capturee avec les runs texte reconstitues au format cible.
 * @param blob Capture PNG de l'overlay sans texte.
 * @param textRuns Runs texte a dessiner.
 * @param sourceWidth Largeur source de capture.
 * @param sourceHeight Hauteur source de capture.
 * @param targetWidth Largeur cible.
 * @param targetHeight Hauteur cible.
 * @returns Les octets PNG du frame reconstruit.
 */
async function blobToExactPngBytesWithLiveText(
	blob: Blob,
	textRuns: TextDrawRun[],
	sourceWidth: number,
	sourceHeight: number,
	targetWidth: number,
	targetHeight: number
): Promise<Uint8Array> {
	const image = await decodeBlobAsImage(blob);
	const canvas = document.createElement('canvas');
	canvas.width = targetWidth;
	canvas.height = targetHeight;

	const context = canvas.getContext('2d');
	if (!context) throw new Error('Could not create export frame canvas.');

	context.imageSmoothingEnabled = true;
	context.imageSmoothingQuality = 'high';
	context.clearRect(0, 0, targetWidth, targetHeight);
	context.drawImage(image, 0, 0, targetWidth, targetHeight);

	const scaleX = targetWidth / sourceWidth;
	const scaleY = targetHeight / sourceHeight;
	for (const run of textRuns) {
		drawTextRun(context, run, scaleX, scaleY);
	}

	return await canvasToPngBytes(canvas);
}
