import { cleanup, render } from 'vitest-browser-svelte';
import { page } from '@vitest/browser/context';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import '../../../../src/app.css';

const mocks = vi.hoisted(() => ({ prepend: vi.fn(), success: vi.fn() }));
vi.mock('$lib/services/RecitationIntroService', async (original) => ({
	...(await original<typeof import('$lib/services/RecitationIntroService')>()),
	prependRecitationIntro: mocks.prepend
}));
vi.mock('svelte-5-french-toast', () => ({ default: { success: mocks.success } }));

import RecitationIntroModal from '$lib/components/projectEditor/tabs/subtitlesEditor/modal/RecitationIntroModal.svelte';
import { setLocale } from '$lib/i18n/i18n-svelte';
import { loadLocale } from '$lib/i18n/i18n-util.sync';

describe('recitation introduction dialog', () => {
	beforeEach(async () => {
		await page.viewport(390, 844);
		vi.clearAllMocks();
		loadLocale('en');
		setLocale('en');
		mocks.prepend.mockResolvedValue(undefined);
	});
	afterEach(cleanup);

	test('offers 13 reciters, switches preview and sends the selected formula and paddings', async () => {
		const close = vi.fn();
		const { container } = render(RecitationIntroModal, { close });
		await vi.waitFor(() => expect(container.querySelector('dialog')?.open).toBe(true));
		expect(container.querySelectorAll('option')).toHaveLength(13);
		expect(container.querySelectorAll('audio')).toHaveLength(2);
		const buttons = container.querySelectorAll<HTMLButtonElement>('[aria-pressed]');
		buttons[1].click();
		const select = container.querySelector('select')!;
		select.value = 'shatri';
		select.dispatchEvent(new Event('change', { bubbles: true }));
		container.querySelector<HTMLInputElement>('#intro-add-padding')!.click();
		await vi.waitFor(() => expect(container.querySelector('#intro-padding-start')).not.toBeNull());
		for (const [id, value] of [
			['intro-padding-start', '1.2'],
			['intro-padding-end', '2.3']
		]) {
			const input = container.querySelector<HTMLInputElement>(`#${id}`)!;
			input.value = value;
			input.dispatchEvent(new Event('input', { bubbles: true }));
		}
		await vi.waitFor(() => expect(container.querySelectorAll('audio')).toHaveLength(1));
		expect(container.querySelector('audio')?.src).toContain(
			'Abu_Bakr_Ash-Shaatree_128kbps/bismillah.mp3'
		);
		container.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
		await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
		expect(mocks.prepend).toHaveBeenCalledExactlyOnceWith({
			reciterId: 'shatri',
			formulas: ['Basmala'],
			paddingStartMs: 1200,
			paddingEndMs: 2300
		});
		expect(mocks.success).toHaveBeenCalledOnce();
	});

	test.each([false, true])(
		'sends zero padding when unchecked (previously enabled: %s)',
		async (previouslyEnabled) => {
			const close = vi.fn();
			const { container } = render(RecitationIntroModal, { close });
			const checkbox = container.querySelector<HTMLInputElement>('#intro-add-padding')!;
			expect(checkbox.checked).toBe(false);
			expect(container.querySelector('#intro-padding-start')).toBeNull();
			expect(container.querySelector('#intro-padding-end')).toBeNull();
			if (previouslyEnabled) {
				checkbox.click();
				await vi.waitFor(() =>
					expect(container.querySelector('#intro-padding-start')).not.toBeNull()
				);
				const input = container.querySelector<HTMLInputElement>('#intro-padding-start')!;
				input.value = '-1';
				input.dispatchEvent(new Event('input', { bubbles: true }));
				await vi.waitFor(() =>
					expect(
						container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled
					).toBe(true)
				);
				checkbox.click();
				await vi.waitFor(() => expect(container.querySelector('#intro-padding-start')).toBeNull());
			}
			container.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
			await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
			expect(mocks.prepend).toHaveBeenCalledExactlyOnceWith({
				reciterId: 'husary',
				formulas: ["Isti'adha", 'Basmala'],
				paddingStartMs: 0,
				paddingEndMs: 0
			});
		}
	);

	test('locks the dialog during import and allows retry after a localized failure', async () => {
		let rejectImport!: (reason: Error) => void;
		mocks.prepend.mockReturnValueOnce(
			new Promise((_resolve, reject) => {
				rejectImport = reject;
			})
		);
		const close = vi.fn();
		const { container } = render(RecitationIntroModal, { close });
		container.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
		await vi.waitFor(() => expect(container.querySelector('fieldset')?.disabled).toBe(true));
		expect(container.querySelectorAll('button:enabled')).toHaveLength(0);
		const cancel = new Event('cancel', { cancelable: true });
		container.querySelector('dialog')!.dispatchEvent(cancel);
		expect(cancel.defaultPrevented).toBe(true);
		vi.spyOn(console, 'error').mockImplementation(() => {});
		rejectImport(new Error('offline'));
		await vi.waitFor(() =>
			expect(container.querySelector('[role="alert"]')?.textContent).toContain(
				'Check your connection'
			)
		);
		expect(close).not.toHaveBeenCalled();
		expect(container.querySelector('fieldset')?.disabled).toBe(false);
		container.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
		await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
		vi.restoreAllMocks();
	});

	test.each(['en', 'fr', 'ar', 'de', 'es', 'id', 'zh'] as const)(
		'renders all controls in %s without horizontal overflow',
		async (locale) => {
			loadLocale(locale);
			setLocale(locale);
			document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
			const { container } = render(RecitationIntroModal, { close: vi.fn() });
			await vi.waitFor(() => expect(container.querySelector('dialog')?.open).toBe(true));
			const dialog = container.querySelector('dialog')!;
			expect(dialog.textContent).not.toContain('editor.recitationIntro');
			expect(container.querySelector('h2')?.textContent?.trim().length).toBeGreaterThan(0);
			expect(container.querySelectorAll('option')).toHaveLength(13);
			expect(container.querySelector<HTMLInputElement>('#intro-add-padding')!.checked).toBe(false);
			container.querySelector<HTMLInputElement>('#intro-add-padding')!.click();
			await vi.waitFor(() =>
				expect(container.querySelector('#intro-padding-start')).not.toBeNull()
			);
			expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
			if (locale === 'fr')
				await page.screenshot({ path: '__screenshots__/recitation-intro-fr.png', element: dialog });
			document.documentElement.dir = 'ltr';
		}
	);
});
