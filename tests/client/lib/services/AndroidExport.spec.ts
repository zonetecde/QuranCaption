import { afterEach, describe, expect, it, vi } from 'vitest';
import { createContext, destroyContext, type Context } from 'modern-screenshot';
import {
	prepareAndroidOverlay,
	runAndroidCapturePipeline
} from '../../../../src/routes/exporter/AndroidExport';

const elements: HTMLElement[] = [];
const contexts: Context<HTMLElement>[] = [];

/**
 * Contrôle la fin d'une écriture pour vérifier l'ordre et la borne du pipeline.
 * @returns {{promise: Promise<void>, resolve: () => void, reject: (error: Error) => void}} Écriture contrôlée.
 */
function pendingWrite() {
	let resolve!: () => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<void>((done, fail) => {
		resolve = done;
		reject = fail;
	});
	return { promise, resolve, reject };
}

describe('pipeline de capture Android', () => {
	it('attend la copie du DOM et prépare une seule image en avance', async () => {
		const writes = [pendingWrite(), pendingWrite(), pendingWrite()];
		const started: number[] = [];
		const prepared: (() => void)[] = [];
		const completed: number[] = [];
		const run = runAndroidCapturePipeline(
			[0, 1, 2],
			async (job, onPrepared) => {
				started.push(job);
				prepared.push(onPrepared);
				await writes[job].promise;
				return job;
			},
			(result) => {
				completed.push(result);
			}
		);
		await expect.poll(() => started.length).toBe(1);
		prepared[0]();
		await expect.poll(() => started.length).toBe(2);
		prepared[1]();
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(started).toEqual([0, 1]);
		expect(completed).toEqual([]);
		writes[0].resolve();
		await expect.poll(() => started.length).toBe(3);
		prepared[2]();
		writes[2].resolve();
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(completed).toEqual([0]);
		writes[1].resolve();
		await run;
		expect(completed).toEqual([0, 1, 2]);
	});

	it('attend les écritures en cours avant de signaler une erreur ou une annulation', async () => {
		for (const failingJob of [0, 1]) {
			const writes = [pendingWrite(), pendingWrite()];
			const started: number[] = [];
			let settled = false;
			const error = new Error(failingJob === 0 ? 'native write failed' : 'EXPORT_CANCELLED');
			const run = runAndroidCapturePipeline([0, 1, 2], async (job, onPrepared) => {
				started.push(job);
				onPrepared();
				await writes[job].promise;
			});
			const result = run.catch((failure) => {
				settled = true;
				return failure;
			});
			await expect.poll(() => started.length).toBe(2);
			writes[failingJob].reject(error);
			await new Promise((resolve) => setTimeout(resolve, 20));
			expect(settled).toBe(false);
			expect(started).toEqual([0, 1]);
			writes[1 - failingJob].resolve();
			expect(await result).toBe(error);
			expect(started).toEqual([0, 1]);
		}
	});

	it('attend la dernière écriture et accepte une liste vide', async () => {
		const write = pendingWrite();
		let settled = false;
		const run = runAndroidCapturePipeline([0], async (_, onPrepared) => {
			onPrepared();
			await write.promise;
		}).then(() => {
			settled = true;
		});
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(settled).toBe(false);
		write.resolve();
		await run;
		expect(settled).toBe(true);
		await runAndroidCapturePipeline([], async () => {
			throw new Error('unexpected capture');
		});
	});
});

/**
 * Prépare un overlay arabe avec une police locale et un pseudo-élément.
 * @returns {Promise<Context<HTMLElement>>} Contexte de capture sans incorporation des polices.
 */
async function createOverlay(): Promise<Context<HTMLElement>> {
	const style = document.createElement('style');
	style.textContent = `
		@font-face { font-family: QCNativeCapture; src: url('/Hafs.ttf') format('truetype'); }
		.native-capture-fixture { width: 320px; height: 160px; position: relative; background: transparent; }
		.native-capture-fixture p { font: 32px QCNativeCapture; line-height: 1.5; margin: 0; direction: rtl; }
		.native-capture-fixture p::before { content: '﴿'; color: red; }
	`;
	const root = document.createElement('div');
	root.className = 'native-capture-fixture';
	root.innerHTML = '<p>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</p>';
	document.head.append(style);
	document.body.append(root);
	elements.push(style, root);
	await document.fonts.load('32px QCNativeCapture');
	const context = await createContext(root, { font: false, autoDestruct: false });
	contexts.push(context);
	return context;
}

afterEach(() => {
	vi.restoreAllMocks();
	for (const context of contexts.splice(0)) destroyContext(context);
	for (const element of elements.splice(0)) element.remove();
});

describe('capture DOM pour le renderer Android', () => {
	it.each(['QCNativeCapture', 'Inter', 'IBM Plex Mono'])(
		'exclut les imports Google Fonts inutilisés avec %s quand leur CSSOM est inaccessible',
		async (font) => {
			const context = await createOverlay();
			context.node.querySelector('p')!.style.fontFamily = `QCNativeCapture, "${font}"`;
			const style = document.createElement('style');
			style.textContent = '@import url("data:text/css,"); @import url("data:text/css,");';
			document.head.append(style);
			elements.push(style);
			const imports = [
				'https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap',
				'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:ital,wght@0,400;1,400&display=swap'
			];
			for (const [index, rule] of Array.from(style.sheet!.cssRules).entries()) {
				vi.spyOn(rule as CSSImportRule, 'href', 'get').mockReturnValue(imports[index]);
				vi.spyOn(rule as CSSImportRule, 'styleSheet', 'get').mockImplementation(() => {
					throw new DOMException('CSSOM inaccessible', 'SecurityError');
				});
			}
			const capture = await prepareAndroidOverlay(context);
			expect(capture.fontCss.filter((css) => css.startsWith('@import'))).toEqual(
				font === 'QCNativeCapture'
					? []
					: [`@import url(${JSON.stringify(imports[font === 'Inter' ? 0 : 1])});`]
			);
			expect(capture.fontCss.join('\n')).toContain(new URL('/Hafs.ttf', document.baseURI).href);
		}
	);

	it('transmet une URL de police sans copier le fichier dans chaque image', async () => {
		const context = await createOverlay();
		const capture = await prepareAndroidOverlay(context);
		expect(capture.fontCss.join('\n')).toContain(new URL('/Hafs.ttf', document.baseURI).href);
		expect(capture.html).not.toContain('data:font');
		expect(capture.html).not.toContain('base64');
		expect(capture.html).toContain('بِسْمِ اللَّهِ');
		expect(context.requests.size).toBe(0);
	});

	it('conserve les dimensions, les positions et la police dans un document indépendant', async () => {
		const context = await createOverlay();
		const source = context.node.querySelector('p')!.getBoundingClientRect();
		const sourceRoot = context.node.getBoundingClientRect();
		const sourceRange = document.createRange();
		sourceRange.selectNodeContents(context.node.querySelector('p')!);
		const sourceText = sourceRange.getBoundingClientRect();
		const capture = await prepareAndroidOverlay(context);
		const frame = document.createElement('iframe');
		frame.width = '320';
		frame.height = '160';
		elements.push(frame);
		const loaded = new Promise<void>((resolve) =>
			frame.addEventListener('load', () => resolve(), { once: true })
		);
		frame.srcdoc = `<html><head><style>html,body{margin:0;background:transparent}</style>${capture.fontCss.map((css) => `<style>${css}</style>`).join('')}</head><body>${capture.html}</body></html>`;
		document.body.append(frame);
		await loaded;
		const target = frame.contentDocument!;
		target.body.getBoundingClientRect();
		await target.fonts.ready;
		const paragraph = target.querySelector('p')!;
		const rect = paragraph.getBoundingClientRect();
		expect(rect.width).toBeCloseTo(source.width, 1);
		expect(rect.height).toBeCloseTo(source.height, 1);
		expect(rect.left).toBeCloseTo(source.left - sourceRoot.left, 1);
		expect(rect.top).toBeCloseTo(source.top - sourceRoot.top, 1);
		const targetRange = target.createRange();
		targetRange.selectNodeContents(paragraph);
		const targetText = targetRange.getBoundingClientRect();
		expect(targetText.width).toBeCloseTo(sourceText.width, 1);
		expect(targetText.height).toBeCloseTo(sourceText.height, 1);
		expect(targetText.left).toBeCloseTo(sourceText.left - sourceRoot.left, 1);
		expect(frame.contentWindow!.getComputedStyle(paragraph).fontFamily).toContain(
			'QCNativeCapture'
		);
		expect(
			frame.contentWindow!.getComputedStyle(target.querySelector('foreignObject > div')!)
				.backgroundColor
		).toBe('rgba(0, 0, 0, 0)');
	});

	it('neutralise le flou de fond dans la copie en conservant les filtres du texte', async () => {
		const context = await createOverlay();
		context.node.style.backdropFilter = 'blur(0px)';
		context.node.querySelector('p')!.style.filter = 'blur(2px) brightness(0.9)';
		const capture = await prepareAndroidOverlay(context);
		const target = new DOMParser().parseFromString(capture.html, 'text/html');
		expect(target.querySelector<HTMLElement>('foreignObject > div')!.style.backdropFilter).toBe(
			'none'
		);
		expect(target.querySelector('p')!.style.filter).toBe('blur(2px) brightness(0.9)');
		expect(context.node.style.backdropFilter).toBe('blur(0px)');
		context.node.style.backdropFilter = 'blur(4px)';
		const next = await prepareAndroidOverlay(context);
		const nextTarget = new DOMParser().parseFromString(next.html, 'text/html');
		expect(nextTarget.querySelector<HTMLElement>('foreignObject > div')!.style.backdropFilter).toBe(
			'none'
		);
		expect(context.node.style.backdropFilter).toBe('blur(4px)');
	});

	it('réutilise le contexte sans accumuler les styles ni garder les anciennes polices', async () => {
		const context = await createOverlay();
		// La première capture initialise le cache des styles par défaut de modern-screenshot.
		await prepareAndroidOverlay(context);
		const first = await prepareAndroidOverlay(context);
		for (let index = 0; index < 24; index++) {
			const capture = await prepareAndroidOverlay(context);
			expect(capture.html.length).toBeLessThan(first.html.length + 100);
			expect(capture.fontCss).toEqual(first.fontCss);
		}
		context.node.querySelector('p')!.style.fontFamily = 'serif';
		const next = await prepareAndroidOverlay(context);
		expect(next.fontCss.join('\n')).not.toContain('QCNativeCapture');
	});

	it.each([
		{ font: 'QCNativeCapture', words: ['بِسْمِ', 'اللَّهِ', 'الرَّحْمَٰنِ', 'الرَّحِيمِ'] },
		{ font: 'QPC2_p293', words: ['ﲭ', 'ﲮ', 'ﲯ', 'ﲰ', 'ﲱ', 'ﲲ', 'ﲳ'] }
	])('conserve les mots et les lignes avec un halo en $font', async ({ font, words }) => {
		const context = await createOverlay();
		const style = document.createElement('style');
		style.textContent =
			"@font-face { font-family: QPC2_p293; src: url('/QPC2/fonts/QPC2_p293.woff2') format('woff2'); }";
		document.head.append(style);
		elements.push(style);
		const paragraph = context.node.querySelector('p')!;
		paragraph.className = 'arabic';
		paragraph.style.fontFamily = font;
		paragraph.innerHTML = `<span class="arabic-wbw-group" dir="rtl" style="unicode-bidi:isolate">${words
			.map(
				(word) =>
					`<span><span class="wbw-line-background-text" style="position:relative;z-index:1">${word}</span></span>`
			)
			.join(' ')}</span>`;
		const highlight = paragraph.querySelector<HTMLElement>('.arabic-wbw-group > span:last-child')!;
		highlight.style.color = 'white';
		highlight.style.textShadow =
			'0 0 19.5px white, 0 0 39px white, 0 0 58.5px white, 0 0 78px white';
		await document.fonts.load(`32px ${font}`);
		for (const width of [180, 95]) {
			paragraph.style.width = `${width}px`;
			paragraph.style.filter =
				width === 180 ? 'blur(0px) brightness(1) contrast(1)' : 'blur(2px) brightness(0.9)';
			const sourceRoot = context.node.getBoundingClientRect();
			const sourceWords = Array.from(paragraph.querySelectorAll('.wbw-line-background-text')).map(
				(word) => {
					const range = document.createRange();
					range.selectNodeContents(word);
					return range.getBoundingClientRect();
				}
			);
			const capture = await prepareAndroidOverlay(context);
			const frame = document.createElement('iframe');
			elements.push(frame);
			const loaded = new Promise<void>((resolve) =>
				frame.addEventListener('load', () => resolve(), { once: true })
			);
			frame.srcdoc = `<html><head><style>html,body{margin:0;background:transparent}</style>${capture.fontCss.map((css) => `<style>${css}</style>`).join('')}</head><body>${capture.html}</body></html>`;
			document.body.append(frame);
			await loaded;
			const target = frame.contentDocument!;
			target.body.getBoundingClientRect();
			await target.fonts.ready;
			const targetWords = target.querySelectorAll('.wbw-line-background-text');
			expect(targetWords.length).toBe(words.length);
			for (let index = 0; index < words.length; index++) {
				const range = target.createRange();
				range.selectNodeContents(targetWords[index]);
				const rect = range.getBoundingClientRect();
				expect(targetWords[index].textContent).toBe(words[index]);
				expect(rect.left).toBeCloseTo(sourceWords[index].left - sourceRoot.left, 1);
				expect(rect.top).toBeCloseTo(sourceWords[index].top - sourceRoot.top, 1);
				expect(rect.width).toBeCloseTo(sourceWords[index].width, 1);
				expect(rect.height).toBeCloseTo(sourceWords[index].height, 1);
			}
			const targetHighlight = targetWords[words.length - 1].parentElement!;
			const targetStyle = frame.contentWindow!.getComputedStyle(targetHighlight);
			expect(targetStyle.textShadow).toBe(getComputedStyle(highlight).textShadow);
			expect(targetStyle.color).toBe(getComputedStyle(highlight).color);
			expect(target.querySelector('p')!.style.filter).toBe(
				width === 180 ? 'none' : paragraph.style.filter
			);
			expect(paragraph.style.filter).toBe(
				width === 180 ? 'blur(0px) brightness(1) contrast(1)' : 'blur(2px) brightness(0.9)'
			);
			expect(highlight.style.display).toBe('');
			expect(targetStyle.display).toBe('inline');
			frame.remove();
		}
	});
});
