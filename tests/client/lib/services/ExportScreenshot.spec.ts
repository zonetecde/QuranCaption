import { afterEach, describe, expect, it, vi } from 'vitest';
import { domToBlob } from 'modern-screenshot';
import {
	captureExportOverlayBlob,
	releaseExportScreenshotContext
} from '../../../../src/routes/exporter/ExportScreenshot';
import { captureMacOsOverlayPngBytes } from '../../../../src/routes/exporter/MacOSExport';
import { getSystemFontSubsetDataUrl } from '$lib/services/SystemFontSubset';

const elements: HTMLElement[] = [];

/**
 * Prépare un overlay avec polices locales, halo arabe et fond de traduction par ligne.
 * @returns {Promise<HTMLElement>} Overlay chargé et prêt à capturer.
 */
async function createOverlay(): Promise<HTMLElement> {
	const style = document.createElement('style');
	style.textContent = `
		@font-face { font-family: QCExportHafs; src: url('/Hafs.ttf') format('truetype'); }
		@font-face { font-family: QCExportQpc; src: url('/QPC2/fonts/QPC2_p293.woff2') format('woff2'); }
	`;
	const root = document.createElement('div');
	root.style.cssText = 'position:relative;width:320px;height:180px;background:transparent';
	root.innerHTML = `
		<p class="arabic" dir="rtl" style="margin:0;font:32px QCExportHafs;line-height:1.6;text-align:center;color:#ddd">
			بِسْمِ <span style="color:cyan;text-shadow:0 0 4px cyan,0 0 8px cyan">اللَّهِ</span> الرَّحْمَٰنِ
		</p>
		<p class="translation" style="margin:10px 20px;font:22px Georgia;color:white;text-align:center">
			<span style="background:#231908;border-radius:10px;box-decoration-break:clone;-webkit-box-decoration-break:clone;padding:0 10px">All praise is for Allah Who has revealed the Book</span>
		</p>
	`;
	document.head.append(style);
	document.body.append(root);
	elements.push(style, root);
	await document.fonts.load('32px QCExportHafs');
	await document.fonts.load('32px QCExportQpc');
	return root;
}

/**
 * Décode un PNG pour comparer ses pixels sans dépendre des métadonnées du fichier.
 * @param {Blob} blob Capture PNG à décoder.
 * @returns {Promise<ImageData>} Dimensions et pixels de la capture.
 */
async function readPixels(blob: Blob): Promise<ImageData> {
	const image = await createImageBitmap(blob);
	const canvas = document.createElement('canvas');
	try {
		canvas.width = image.width;
		canvas.height = image.height;
		const context = canvas.getContext('2d')!;
		context.drawImage(image, 0, 0);
		return context.getImageData(0, 0, image.width, image.height);
	} finally {
		image.close();
		canvas.width = canvas.height = 0;
	}
}

/**
 * Vérifie l'égalité des captures pixel par pixel.
 * @param {Blob} expected Capture de référence avec un contexte neuf.
 * @param {Blob} actual Capture utilisant le cache du worker.
 * @returns {Promise<void>} Résolution après comparaison.
 */
async function expectSamePixels(expected: Blob, actual: Blob): Promise<void> {
	const [first, second] = await Promise.all([readPixels(expected), readPixels(actual)]);
	expect([second.width, second.height]).toEqual([first.width, first.height]);
	let differences = 0;
	for (let index = 0; index < first.data.length; index++) {
		if (first.data[index] !== second.data[index]) differences++;
	}
	expect(differences).toBe(0);
}

afterEach(() => {
	releaseExportScreenshotContext();
	for (const element of elements.splice(0)) element.remove();
	vi.restoreAllMocks();
});

describe('contexte de capture réutilisé par worker', () => {
	it('conserve le rendu quand le texte, la police, le halo et la visibilité changent', async () => {
		const root = await createOverlay();
		const arabic = root.querySelector<HTMLElement>('.arabic')!;
		const translation = root.querySelector<HTMLElement>('.translation span')!;
		const options = { width: 320, height: 180, quality: 1 };
		for (let frame = 0; frame < 12; frame++) {
			arabic.style.visibility = frame % 4 === 2 ? 'hidden' : 'visible';
			arabic.style.fontFamily = frame < 6 ? 'QCExportHafs' : 'QCExportQpc';
			arabic.innerHTML = (frame < 6 ? ['بِسْمِ', 'اللَّهِ', 'الرَّحْمَٰنِ'] : ['ﲭ', 'ﲮ', 'ﲯ'])
				.map(
					(word, index) =>
						`<span style="color:${index === frame % 3 ? 'cyan' : '#ddd'};text-shadow:${index === frame % 3 ? '0 0 4px cyan,0 0 8px cyan' : 'none'}">${word}</span>`
				)
				.join(' ');
			translation.textContent =
				frame % 2 ? 'A short translation' : 'All praise is for Allah Who has revealed the Book';
			await expectSamePixels(
				await domToBlob(root, options),
				await captureExportOverlayBlob(root, options)
			);
		}
	});

	it('garde le cache de polices, le borne sur les longs exports et le libère à la fin', async () => {
		const root = await createOverlay();
		const fetchSpy = vi.spyOn(window, 'fetch');
		const options = { width: 320, height: 180 };
		for (let frame = 0; frame < 65; frame++) await captureExportOverlayBlob(root, options);
		expect(fetchSpy.mock.calls.filter(([url]) => String(url).endsWith('/Hafs.ttf'))).toHaveLength(
			2
		);
		expect(document.querySelectorAll('iframe[id^="__SANDBOX__"]')).toHaveLength(1);
		releaseExportScreenshotContext();
		expect(document.querySelectorAll('iframe[id^="__SANDBOX__"]')).toHaveLength(0);
		await captureExportOverlayBlob(root, options);
		expect(fetchSpy.mock.calls.filter(([url]) => String(url).endsWith('/Hafs.ttf'))).toHaveLength(
			3
		);
	});

	it('renouvelle le contexte pour une autre racine ou une autre résolution', async () => {
		const root = await createOverlay();
		await captureExportOverlayBlob(root, { width: 320, height: 180 });
		const scaled = {
			width: 160,
			height: 90,
			style: { transform: 'scale(0.5)', transformOrigin: 'top left' }
		};
		await expectSamePixels(
			await domToBlob(root, scaled),
			await captureExportOverlayBlob(root, scaled)
		);
		const otherRoot = await createOverlay();
		otherRoot.querySelector('.translation span')!.textContent = 'Another overlay';
		await expectSamePixels(
			await domToBlob(otherRoot, scaled),
			await captureExportOverlayBlob(otherRoot, scaled)
		);
	});

	it('utilise le nouveau sous-ensemble quand une même police change de caractères', async () => {
		const root = await createOverlay();
		const style = document.createElement('style');
		document.head.append(style);
		elements.push(style);
		const arabic = root.querySelector<HTMLElement>('.arabic')!;
		arabic.style.fontFamily = 'QCExportSubset';
		const options = { width: 320, height: 180 };
		for (const text of ['بِسْمِ اللَّهِ', 'الرَّحْمَٰنِ الرَّحِيمِ', 'بِسْمِ اللَّهِ']) {
			const url = await getSystemFontSubsetDataUrl(
				new URL('/Hafs.ttf', document.baseURI).href,
				0,
				text
			);
			style.textContent = `@font-face { font-family: QCExportSubset; src: url('${url}') format('opentype'); }`;
			arabic.textContent = text;
			await document.fonts.load('32px QCExportSubset', text);
			await expectSamePixels(
				await domToBlob(root, options),
				await captureExportOverlayBlob(root, options)
			);
		}
	});

	it('libère le contexte en erreur et permet la capture suivante', async () => {
		const root = await createOverlay();
		const options = { width: 320, height: 180 };
		await expect(
			captureExportOverlayBlob(root, {
				...options,
				onCloneNode: () => {
					throw new Error('capture failed');
				}
			})
		).rejects.toThrow('capture failed');
		expect(document.querySelectorAll('iframe[id^="__SANDBOX__"]')).toHaveLength(0);
		await expectSamePixels(
			await domToBlob(root, options),
			await captureExportOverlayBlob(root, options)
		);
	});

	it('préserve la capture macOS et son masquage du texte dans le clone', async () => {
		const root = await createOverlay();
		for (const text of ['A short translation', 'The text changes between captures']) {
			root.querySelector('.translation span')!.textContent = text;
			releaseExportScreenshotContext();
			const fresh = await captureMacOsOverlayPngBytes(root, 1, 320, 180);
			const reused = await captureMacOsOverlayPngBytes(root, 1, 320, 180);
			await expectSamePixels(new Blob([fresh]), new Blob([reused]));
			expect(root.querySelector<HTMLElement>('.translation')!.style.visibility).not.toBe('hidden');
		}
	});
});
