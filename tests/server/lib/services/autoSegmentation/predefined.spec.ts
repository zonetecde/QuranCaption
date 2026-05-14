import { describe, expect, it } from 'vitest';

import { getPredefinedType } from '$lib/services/AutoSegmentation';

describe('getPredefinedType', () => {
	it('returns Basmala when ref contains "basmala"', () => {
		expect(getPredefinedType('basmala')).toBe('Basmala');
		expect(getPredefinedType('BASMALA')).toBe('Basmala');
	});

	it("returns Isti'adha when ref contains isti patterns", () => {
		expect(getPredefinedType("isti'adha")).toBe("Isti'adha");
		expect(getPredefinedType('istiadha')).toBe("Isti'adha");
		expect(getPredefinedType('isti')).toBe("Isti'adha");
	});

	it('returns Amin when ref contains amin/ameen', () => {
		expect(getPredefinedType('amin')).toBe('Amin');
		expect(getPredefinedType('ameen')).toBe('Amin');
	});

	it('returns Takbir when ref contains takbir', () => {
		expect(getPredefinedType('takbir')).toBe('Takbir');
	});

	it('returns Tahmeed when ref contains tahmeed/hamidah', () => {
		expect(getPredefinedType('tahmeed')).toBe('Tahmeed');
		expect(getPredefinedType('hamidah')).toBe('Tahmeed');
	});

	it('returns Tasleem when ref contains tasleem/salam', () => {
		expect(getPredefinedType('tasleem')).toBe('Tasleem');
		expect(getPredefinedType('salam')).toBe('Tasleem');
	});

	it('returns Sadaqa when ref contains sadaqa patterns', () => {
		expect(getPredefinedType('sadaqa')).toBe('Sadaqa');
		expect(getPredefinedType('sadaqallah')).toBe('Sadaqa');
	});

	it('returns null for unrecognized refs', () => {
		expect(getPredefinedType('unknown')).toBeNull();
		expect(getPredefinedType('')).toBeNull();
		expect(getPredefinedType(undefined)).toBeNull();
	});

	it('returns the explicit special type when canonicalizable', () => {
		expect(getPredefinedType(undefined, 'Basmala')).toBe('Basmala');
		expect(getPredefinedType('anything', "Isti'adha")).toBe("Isti'adha");
	});
});
