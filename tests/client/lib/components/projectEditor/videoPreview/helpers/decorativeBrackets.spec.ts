import { describe, expect, test } from 'vitest';
import {
	getDecorativeBracketCss,
	getDecorativeBracketGlyphs
} from '$lib/components/projectEditor/videoPreview/helpers/decorativeBrackets';

describe('decorativeBrackets', () => {
	describe('getDecorativeBracketCss', () => {
		test('retourne le CSS inline utilisant la police QPC2BSML', () => {
			const css = getDecorativeBracketCss();
			expect(css).toContain("font-family: 'QPC2BSML'");
			expect(css).toContain('display: inline-block');
		});

		test('retourne toujours la même valeur (fonction pure)', () => {
			expect(getDecorativeBracketCss()).toBe(getDecorativeBracketCss());
		});
	});

	describe('getDecorativeBracketGlyphs', () => {
		test('retourne LM pour la paire par défaut', () => {
			const result = getDecorativeBracketGlyphs('LM');
			expect(result).toEqual({ opening: 'L', closing: 'M' });
		});

		test('retourne NO pour la paire NO', () => {
			const result = getDecorativeBracketGlyphs('NO');
			expect(result).toEqual({ opening: 'N', closing: 'O' });
		});

		test('retourne RS pour la paire R/S avec slash', () => {
			const result = getDecorativeBracketGlyphs('R/S');
			expect(result).toEqual({ opening: 'R', closing: 'S' });
		});

		test('nettoie les espaces dans la paire brute', () => {
			const result = getDecorativeBracketGlyphs('T U');
			expect(result).toEqual({ opening: 'T', closing: 'U' });
		});

		test('nettoie les tirets dans la paire brute', () => {
			const result = getDecorativeBracketGlyphs('V-W');
			expect(result).toEqual({ opening: 'V', closing: 'W' });
		});

		test('retourne la paire par défaut LM pour une valeur invalide', () => {
			const result = getDecorativeBracketGlyphs('INVALID');
			expect(result).toEqual({ opening: 'L', closing: 'M' });
		});

		test('retourne la paire par défaut LM pour une chaîne vide', () => {
			const result = getDecorativeBracketGlyphs('');
			expect(result).toEqual({ opening: 'L', closing: 'M' });
		});

		test('supporte la paire parenthèses ()', () => {
			const result = getDecorativeBracketGlyphs('()');
			expect(result).toEqual({ opening: '(', closing: ')' });
		});

		test('supporte la paire Z:', () => {
			const result = getDecorativeBracketGlyphs('Z:');
			expect(result).toEqual({ opening: 'Z', closing: ':' });
		});

		test('supporte XY', () => {
			const result = getDecorativeBracketGlyphs('XY');
			expect(result).toEqual({ opening: 'X', closing: 'Y' });
		});
	});
});
