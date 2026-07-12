#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';

const folder = 'C:\\Users\\zonedetec\\Documents\\source\\tauri\\MinbarStudio-2\\static\\surah-imgs';
const renderScale = 4; // augmente la précision du calcul (4x)

function parseViewBox(svg) {
	const vbMatch = svg.match(/viewBox\s*=\s*["']([^"']+)["']/i);
	if (vbMatch) {
		const parts = vbMatch[1]
			.trim()
			.split(/[\s,]+/)
			.map(Number);
		if (parts.length === 4 && parts.every((n) => !Number.isNaN(n))) {
			return { x: parts[0], y: parts[1], width: parts[2], height: parts[3], raw: vbMatch[0] };
		}
	}
	// try width/height fallback (px only)
	const wMatch = svg.match(/width\s*=\s*["']([\d.]+)(px)?["']/i);
	const hMatch = svg.match(/height\s*=\s*["']([\d.]+)(px)?["']/i);
	if (wMatch && hMatch) {
		const w = parseFloat(wMatch[1]),
			h = parseFloat(hMatch[1]);
		return { x: 0, y: 0, width: w, height: h, raw: null };
	}
	return null;
}

async function processFile(filePath) {
	try {
		const data = await fs.readFile(filePath, 'utf8');
		const vb = parseViewBox(data);
		if (!vb) {
			console.log(`Skipping (no viewBox and no px width/height): ${path.basename(filePath)}`);
			return;
		}

		// render size in pixels
		const renderW = Math.max(256, Math.round(vb.width * renderScale));
		const renderH = Math.max(64, Math.round(vb.height * renderScale));

		// render SVG to RGBA raw buffer
		const svgBuffer = Buffer.from(data, 'utf8');
		const { data: imgBuffer, info } = await sharp(svgBuffer)
			.resize(renderW, renderH, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
			.ensureAlpha()
			.raw()
			.toBuffer({ resolveWithObject: true });

		const channels = info.channels; // should be 4 (RGBA)
		if (channels < 4) {
			console.log(`Unexpected channels (${channels}), skipping: ${path.basename(filePath)}`);
			return;
		}

		const width = info.width;
		const height = info.height;
		const alphaThreshold = 10; // 0..255

		// find leftmost and rightmost columns that contain any non-transparent pixel
		let minCol = width,
			maxCol = -1;
		for (let x = 0; x < width; x++) {
			let colHas = false;
			for (let y = 0; y < height; y++) {
				const idx = (y * width + x) * channels;
				const a = imgBuffer[idx + 3];
				if (a > alphaThreshold) {
					colHas = true;
					break;
				}
			}
			if (colHas) {
				if (x < minCol) minCol = x;
				if (x > maxCol) maxCol = x;
			}
		}

		if (maxCol === -1) {
			console.log(`No visible pixels found, skipping: ${path.basename(filePath)}`);
			return;
		}

		// compute trims in SVG units
		const pxToSvg = vb.width / width;
		const leftTrimPx = minCol;
		const rightTrimPx = width - 1 - maxCol;
		const leftTrimUnits = leftTrimPx * pxToSvg;
		const rightTrimUnits = rightTrimPx * pxToSvg;

		// If trims are negligible, skip
		if (leftTrimUnits < 0.5 && rightTrimUnits < 0.5) {
			console.log(
				`No significant horizontal transparent margin to trim for: ${path.basename(filePath)}`
			);
			return;
		}

		const newX = vb.x + leftTrimUnits;
		const newWidth = vb.width - leftTrimUnits - rightTrimUnits;
		if (newWidth <= 0) {
			console.log(`Computed invalid new width for ${path.basename(filePath)}, skipping.`);
			return;
		}

		const fmt = (n) => Number.parseFloat(n.toFixed(6));

		const newViewBox = `${fmt(newX)} ${fmt(vb.y)} ${fmt(newWidth)} ${fmt(vb.height)}`;

		let newSvg;
		if (vb.raw) {
			// replace existing viewBox attribute (preserve quoting style)
			newSvg = data.replace(/viewBox\s*=\s*["'][^"']+["']/i, `viewBox="${newViewBox}"`);
		} else {
			// insert viewBox into <svg ...> after the tag name
			newSvg = data.replace(/<svg(\s+)/i, `<svg$1viewBox="${newViewBox}" `);
		}

		// backup and write
		await fs.copyFile(filePath, `${filePath}.bak`);
		await fs.writeFile(filePath, newSvg, 'utf8');
		console.log(
			`Cropped sides: ${path.basename(filePath)} (left ${fmt(leftTrimUnits)} , right ${fmt(rightTrimUnits)} units)`
		);
	} catch (err) {
		console.error(`Error processing ${filePath}:`, err.message || err);
	}
}

async function walkDir(dir) {
	const entries = await fs.readdir(dir, { withFileTypes: true });
	for (const e of entries) {
		const full = path.join(dir, e.name);
		if (e.isDirectory()) {
			await walkDir(full);
		} else if (e.isFile() && full.toLowerCase().endsWith('.svg')) {
			await processFile(full);
		}
	}
}

(async () => {
	try {
		await walkDir(folder);
		console.log('Done.');
	} catch (err) {
		console.error('Fatal:', err);
	}
})();
