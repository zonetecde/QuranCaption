import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

const vitestBrowserHeadless =
	Reflect.get(globalThis, 'process')?.env?.VITEST_BROWSER_HEADLESS !== 'false';
const tauriDevHost = Reflect.get(globalThis, 'process')?.env?.TAURI_DEV_HOST;

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	server: {
		port: 5173,
		strictPort: true,
		host: tauriDevHost || '0.0.0.0',
		hmr: tauriDevHost
			? {
					protocol: 'ws',
					host: tauriDevHost
				}
			: undefined
	},
	test: {
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'client',
					environment: 'browser',
					browser: {
						enabled: true,
						headless: vitestBrowserHeadless,
						provider: 'playwright',
						instances: [{ browser: 'chromium' }]
					},
					include: ['tests/client/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**'],
					setupFiles: ['./vitest-setup-client.ts']
				}
			},
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['tests/server/**/*.{test,spec}.{js,ts}'],
					exclude: ['tests/client/**/*.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
