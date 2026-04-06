/// <reference types="@vitest/browser/matchers" />
/// <reference types="@vitest/browser/providers/playwright" />

type SvelteKitDevGlobal = {
	env?: Record<string, string>;
};

const svelteKitDevGlobal = (
	globalThis as typeof globalThis & {
		__sveltekit_dev?: SvelteKitDevGlobal;
	}
).__sveltekit_dev;

if (!svelteKitDevGlobal) {
	(globalThis as typeof globalThis & { __sveltekit_dev: SvelteKitDevGlobal }).__sveltekit_dev = {
		env: {}
	};
} else if (!svelteKitDevGlobal.env) {
	svelteKitDevGlobal.env = {};
}
