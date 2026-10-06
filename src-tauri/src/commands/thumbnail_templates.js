(() => {
	/**
	 * Capture un aperçu HTML sans image, tel que le canevas vierge.
	 * @param {HTMLElement} node Carte d'aperçu du site.
	 * @returns {string} Image SVG autonome avec les styles calculés du site.
	 */
	function snapshot(node) {
		const clone = node.cloneNode(true);
		const originals = [node, ...node.querySelectorAll('*')];
		const copies = [clone, ...clone.querySelectorAll('*')];
		originals.forEach((original, index) => {
			const style = getComputedStyle(original);
			copies[index].setAttribute(
				'style',
				Array.from(style, (key) => `${key}:${style.getPropertyValue(key)}`).join(';')
			);
		});
		const { width, height } = node.getBoundingClientRect();
		const content = new XMLSerializer().serializeToString(clone);
		return (
			'data:image/svg+xml;charset=utf-8,' +
			encodeURIComponent(
				`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%">${content}</foreignObject></svg>`
			)
		);
	}

	window.addEventListener(
		'load',
		async () => {
			try {
				await document.fonts.ready;
				window.updateTemplatePreview?.();
				const templates = Array.from(
					document.querySelectorAll('#templates .tile-grid a.tile')
				).flatMap((tile) => {
					const href = tile.getAttribute('href') ?? '';
					const hash = href.includes('#') ? href.slice(href.indexOf('#')) : '';
					const name = tile.querySelector('h3')?.textContent?.trim();
					const thumbnail = tile.querySelector('.tile-thumb');
					const image = thumbnail?.querySelector('img');
					if (!/^#[a-z0-9-]+$/.test(hash) || !name || !thumbnail) return [];
					return [{ hash, name, preview: image?.src || snapshot(thumbnail) }];
				});
				location.href =
					'qurancaption-templates://result/?data=' + encodeURIComponent(JSON.stringify(templates));
			} catch {
				location.href = 'qurancaption-templates://result/?data=[]';
			}
		},
		{ once: true }
	);
})();
