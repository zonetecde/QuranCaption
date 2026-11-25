declare module 'harfbuzzjs/hb.js' {
	export default function createHarfBuzz(options: {
		locateFile: (file: string) => string;
	}): Promise<unknown>;
}

declare module 'harfbuzzjs/hbjs.js' {
	type Resource = { destroy(): void };
	type Blob = Resource;
	type Face = Resource & { upem: number };
	export type Font = Resource & { glyphToPath(glyphId: number): string };
	type Buffer = Resource & {
		addText(text: string): void;
		guessSegmentProperties(): void;
		setLanguage(language: string): void;
		json(): { g: number; ax: number; dx: number; dy: number }[];
	};
	export type HarfBuzz = {
		createBlob(bytes: ArrayBuffer): Blob;
		createFace(blob: Blob, index: number): Face;
		createFont(face: Face): Font;
		createBuffer(): Buffer;
		shape(font: Font, buffer: Buffer): void;
	};
	export default function wrapHarfBuzz(module: unknown): HarfBuzz;
}
