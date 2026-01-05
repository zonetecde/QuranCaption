import fs from 'fs';
import path from 'path';
import { DOMParser, XMLSerializer } from 'xmldom';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Fonction pour calculer la bounding box d'un élément SVG
function getBoundingBox(element) {
	let minX = Infinity,
		minY = Infinity,
		maxX = -Infinity,
		maxY = -Infinity;

	function processElement(el) {
		const tagName = el.tagName;

		if (!tagName) return;

		switch (tagName.toLowerCase()) {
			case 'path': {
				const d = el.getAttribute('d');
				if (d) {
					const pathBounds = getPathBounds(d);
					if (pathBounds) {
						minX = Math.min(minX, pathBounds.minX);
						minY = Math.min(minY, pathBounds.minY);
						maxX = Math.max(maxX, pathBounds.maxX);
						maxY = Math.max(maxY, pathBounds.maxY);
					}
				}
				break;
			}

			case 'rect': {
				const x = parseFloat(el.getAttribute('x') || '0');
				const y = parseFloat(el.getAttribute('y') || '0');
				const width = parseFloat(el.getAttribute('width') || '0');
				const height = parseFloat(el.getAttribute('height') || '0');
				minX = Math.min(minX, x);
				minY = Math.min(minY, y);
				maxX = Math.max(maxX, x + width);
				maxY = Math.max(maxY, y + height);
				break;
			}

			case 'circle': {
				const cx = parseFloat(el.getAttribute('cx') || '0');
				const cy = parseFloat(el.getAttribute('cy') || '0');
				const r = parseFloat(el.getAttribute('r') || '0');
				minX = Math.min(minX, cx - r);
				minY = Math.min(minY, cy - r);
				maxX = Math.max(maxX, cx + r);
				maxY = Math.max(maxY, cy + r);
				break;
			}

			case 'ellipse': {
				const ecx = parseFloat(el.getAttribute('cx') || '0');
				const ecy = parseFloat(el.getAttribute('cy') || '0');
				const rx = parseFloat(el.getAttribute('rx') || '0');
				const ry = parseFloat(el.getAttribute('ry') || '0');
				minX = Math.min(minX, ecx - rx);
				minY = Math.min(minY, ecy - ry);
				maxX = Math.max(maxX, ecx + rx);
				maxY = Math.max(maxY, ecy + ry);
				break;
			}

			case 'line': {
				const x1 = parseFloat(el.getAttribute('x1') || '0');
				const y1 = parseFloat(el.getAttribute('y1') || '0');
				const x2 = parseFloat(el.getAttribute('x2') || '0');
				const y2 = parseFloat(el.getAttribute('y2') || '0');
				minX = Math.min(minX, x1, x2);
				minY = Math.min(minY, y1, y2);
				maxX = Math.max(maxX, x1, x2);
				maxY = Math.max(maxY, y1, y2);
				break;
			}

			case 'polygon':
			case 'polyline': {
				const points = el.getAttribute('points');
				if (points) {
					const coords = points
						.trim()
						.split(/[\s,]+/)
						.map(parseFloat);
					for (let i = 0; i < coords.length; i += 2) {
						if (i + 1 < coords.length) {
							minX = Math.min(minX, coords[i]);
							minY = Math.min(minY, coords[i + 1]);
							maxX = Math.max(maxX, coords[i]);
							maxY = Math.max(maxY, coords[i + 1]);
						}
					}
				}
				break;
			}
		}

		// Traiter les éléments enfants
		if (el.childNodes) {
			for (let i = 0; i < el.childNodes.length; i++) {
				const child = el.childNodes[i];
				if (child.nodeType === 1) {
					// ELEMENT_NODE
					processElement(child);
				}
			}
		}
	}

	processElement(element);

	return {
		minX: isFinite(minX) ? minX : 0,
		minY: isFinite(minY) ? minY : 0,
		maxX: isFinite(maxX) ? maxX : 0,
		maxY: isFinite(maxY) ? maxY : 0
	};
}

// Fonction simplifiée pour obtenir les bounds d'un path
function getPathBounds(pathData) {
	const coords = [];
	const commands = pathData.match(/[MmLlHhVvCcSsQqTtAaZz][^MmLlHhVvCcSsQqTtAaZz]*/g);

	if (!commands) return null;

	let currentX = 0,
		currentY = 0;

	commands.forEach((command) => {
		const type = command[0];
		const args = command
			.slice(1)
			.trim()
			.split(/[\s,]+/)
			.map(parseFloat)
			.filter((n) => !isNaN(n));

		switch (type.toLowerCase()) {
			case 'm':
			case 'l':
				for (let i = 0; i < args.length; i += 2) {
					if (i + 1 < args.length) {
						if (type === type.toLowerCase()) {
							// relative
							currentX += args[i];
							currentY += args[i + 1];
						} else {
							// absolute
							currentX = args[i];
							currentY = args[i + 1];
						}
						coords.push(currentX, currentY);
					}
				}
				break;
			case 'h':
				for (let i = 0; i < args.length; i++) {
					if (type === type.toLowerCase()) {
						currentX += args[i];
					} else {
						currentX = args[i];
					}
					coords.push(currentX, currentY);
				}
				break;
			case 'v':
				for (let i = 0; i < args.length; i++) {
					if (type === type.toLowerCase()) {
						currentY += args[i];
					} else {
						currentY = args[i];
					}
					coords.push(currentX, currentY);
				}
				break;
			case 'c':
				for (let i = 0; i < args.length; i += 6) {
					if (i + 5 < args.length) {
						if (type === type.toLowerCase()) {
							coords.push(currentX + args[i], currentY + args[i + 1]);
							coords.push(currentX + args[i + 2], currentY + args[i + 3]);
							currentX += args[i + 4];
							currentY += args[i + 5];
						} else {
							coords.push(args[i], args[i + 1]);
							coords.push(args[i + 2], args[i + 3]);
							currentX = args[i + 4];
							currentY = args[i + 5];
						}
						coords.push(currentX, currentY);
					}
				}
				break;
		}
	});

	if (coords.length === 0) return null;

	let minX = coords[0],
		minY = coords[1],
		maxX = coords[0],
		maxY = coords[1];
	for (let i = 2; i < coords.length; i += 2) {
		if (i + 1 < coords.length) {
			minX = Math.min(minX, coords[i]);
			maxX = Math.max(maxX, coords[i]);
			minY = Math.min(minY, coords[i + 1]);
			maxY = Math.max(maxY, coords[i + 1]);
		}
	}

	return { minX, minY, maxX, maxY };
}

// Fonction pour recadrer un SVG
function cropSVG(svgContent) {
	try {
		const parser = new DOMParser();
		const doc = parser.parseFromString(svgContent, 'image/svg+xml');
		const svgElement = doc.documentElement;

		if (!svgElement || svgElement.tagName !== 'svg') {
			throw new Error('Invalid SVG');
		}

		// Calculer la bounding box du contenu
		const bounds = getBoundingBox(svgElement);

		if (bounds.minX === bounds.maxX || bounds.minY === bounds.maxY) {
			console.log('SVG appears to be empty or has no visible content');
			return svgContent;
		}

		// Ajouter une petite marge
		const margin = 2;
		const newMinX = bounds.minX - margin;
		const newMinY = bounds.minY - margin;
		const newWidth = bounds.maxX - bounds.minX + 2 * margin;
		const newHeight = bounds.maxY - bounds.minY + 2 * margin;

		// Mettre à jour les attributs du SVG
		svgElement.setAttribute('viewBox', `${newMinX} ${newMinY} ${newWidth} ${newHeight}`);
		svgElement.setAttribute('width', newWidth.toString());
		svgElement.setAttribute('height', newHeight.toString());

		// Sérialiser le SVG modifié
		const serializer = new XMLSerializer();
		return serializer.serializeToString(doc);
	} catch (error) {
		console.error('Error processing SVG:', error);
		return svgContent; // Retourner le contenu original en cas d'erreur
	}
}

// Fonction principale
async function cropAllSVGs() {
	const svgDir = path.join(__dirname, '..', 'static', 'surah-imgs');
	const buildSvgDir = path.join(__dirname, '..', 'build', 'surah-imgs');

	console.log(`Processing SVGs in: ${svgDir}`);
	console.log(`Output directory: ${buildSvgDir}`);

	try {
		// Créer le dossier de sortie s'il n'existe pas
		if (!fs.existsSync(buildSvgDir)) {
			fs.mkdirSync(buildSvgDir, { recursive: true });
		}

		// Lire tous les fichiers SVG
		const files = fs.readdirSync(svgDir).filter((file) => file.endsWith('.svg'));

		console.log(`Found ${files.length} SVG files to process`);

		let processedCount = 0;
		let errorCount = 0;

		for (const file of files) {
			try {
				const inputPath = path.join(svgDir, file);
				const outputPath = path.join(buildSvgDir, file);

				console.log(`Processing: ${file}`);

				const svgContent = fs.readFileSync(inputPath, 'utf8');
				const croppedSVG = cropSVG(svgContent);

				fs.writeFileSync(outputPath, croppedSVG, 'utf8');
				processedCount++;
			} catch (error) {
				console.error(`Error processing ${file}:`, error.message);
				errorCount++;
			}
		}

		console.log(`\nProcessing complete!`);
		console.log(`Successfully processed: ${processedCount} files`);
		console.log(`Errors: ${errorCount} files`);

		if (processedCount > 0) {
			console.log(`\nCropped SVG files saved to: ${buildSvgDir}`);
			console.log(
				`\nTo use the cropped versions, update your app to load SVGs from the build directory instead of static.`
			);
		}
	} catch (error) {
		console.error('Error:', error.message);
	}
}

// Exécuter le script
cropAllSVGs();

export { cropSVG, cropAllSVGs };
