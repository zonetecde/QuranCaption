import { cleanup, render } from 'vitest-browser-svelte';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { tick } from 'svelte';

import AutocompleteInput from '$lib/components/misc/AutocompleteInput.svelte';

function renderAutocomplete(
	props: Partial<{
		value: string;
		suggestions: { label: string; isCustom: boolean }[] | string[];
		showEverything: boolean;
		clearOnFocus: boolean;
		placeholder: string;
		maxlength: number;
		label: string;
		icon: string;
		focusOnMount: boolean;
		onEnterPress: () => void;
		onSelect: (value: string) => void;
	}> = {}
) {
	return render(AutocompleteInput, {
		value: '',
		suggestions: ['Alpha', 'Beta', 'Gamma'],
		placeholder: 'Search here',
		icon: 'search',
		...props
	});
}

function getInput(container: HTMLElement): HTMLInputElement {
	const input = container.querySelector('input');
	if (!(input instanceof HTMLInputElement)) {
		throw new Error('Autocomplete input was not rendered.');
	}

	return input;
}

function getDropdownButtons(container: HTMLElement): HTMLButtonElement[] {
	return Array.from(container.querySelectorAll('.autocomplete-dropdown button'));
}

async function waitForBlurDelay() {
	await new Promise((resolve) => window.setTimeout(resolve, 170));
	await tick();
}

describe('AutocompleteInput', () => {
	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	test('renders label, icon and maxlength counter when provided', async () => {
		const component = renderAutocomplete({
			value: 'Ab',
			label: 'Reciter',
			maxlength: 10
		});

		await expect.element(component.getByText('Reciter')).toBeVisible();
		await expect.element(component.getByText('search')).toBeVisible();
		await expect.element(component.getByText('2/10')).toBeVisible();
	});

	test('does not render optional label or counter when not provided', () => {
		const component = renderAutocomplete();

		expect(component.container.querySelector('label')).toBeNull();
		expect(component.container.textContent).not.toContain('/NaN');
		expect(component.container.querySelector('.absolute.right-3')).toBeNull();
	});

	test('filters string suggestions with normalized matching and hides dropdown without results', async () => {
		const component = renderAutocomplete({
			suggestions: ["Al-Fatihah", "Al Baqarah", "An.Nisa'"]
		});

		const input = component.getByRole('textbox');
		await input.fill('annisa');

		await expect.element(component.getByText("An.Nisa'")).toBeVisible();
		expect(component.container.textContent).not.toContain('Al-Fatihah');

		await input.fill('zzz');
		await tick();

		expect(component.container.querySelector('.autocomplete-dropdown')).toBeNull();
	});

	test('shows all suggestions on focus when showEverything is enabled', async () => {
		const component = renderAutocomplete({
			showEverything: true,
			suggestions: ['Alpha', 'Beta', 'Gamma']
		});

		getInput(component.container).focus();
		await tick();

		expect(getDropdownButtons(component.container)).toHaveLength(3);
		await expect.element(component.getByText('Alpha')).toBeVisible();
	});

	test('clears the field on focus and on click when clearOnFocus is enabled', async () => {
		const component = renderAutocomplete({
			value: 'Filled',
			clearOnFocus: true,
			showEverything: true
		});

		const inputElement = getInput(component.container);
		inputElement.focus();
		await tick();
		expect(inputElement.value).toBe('');

		await component.getByRole('textbox').fill('Again');
		inputElement.blur();
		await waitForBlurDelay();
		await component.getByRole('textbox').click();
		await tick();

		expect(inputElement.value).toBe('');
	});

	test('does not clear the field on focus when clearOnFocus is disabled', async () => {
		const component = renderAutocomplete({
			value: 'Persist',
			clearOnFocus: false,
			showEverything: true
		});

		getInput(component.container).focus();
		await tick();

		await expect.element(component.getByRole('textbox')).toHaveValue('Persist');
	});

	test('selects a suggestion with the mouse and calls onSelect', async () => {
		const onSelect = vi.fn();
		const component = renderAutocomplete({
			showEverything: true,
			onSelect
		});

		getInput(component.container).focus();
		await tick();
		await component.getByText('Beta').click();
		await tick();

		await expect.element(component.getByRole('textbox')).toHaveValue('Beta');
		expect(onSelect).toHaveBeenCalledWith('Beta');
		expect(component.container.querySelector('.autocomplete-dropdown')).toBeNull();
	});

	test('supports keyboard navigation and enter selection', async () => {
		const component = renderAutocomplete({
			showEverything: true
		});

		const input = getInput(component.container);
		input.focus();
		await tick();

		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
		await tick();
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		await tick();

		expect(input.value).toBe('Beta');
		expect(component.container.querySelector('.autocomplete-dropdown')).toBeNull();
	});

	test('calls onEnterPress when enter is pressed without an active suggestion', async () => {
		const onEnterPress = vi.fn();
		const component = renderAutocomplete({
			value: 'Typed value',
			onEnterPress
		});

		const input = getInput(component.container);
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		await tick();

		expect(onEnterPress).toHaveBeenCalledTimes(1);

		input.focus();
		await tick();
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
		await tick();
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		await tick();

		expect(onEnterPress).toHaveBeenCalledTimes(2);
	});

	test('closes the dropdown on escape and after blur delay', async () => {
		const component = renderAutocomplete({
			showEverything: true
		});

		const input = getInput(component.container);
		input.focus();
		await tick();
		expect(getDropdownButtons(component.container)).toHaveLength(3);

		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		await tick();
		expect(component.container.querySelector('.autocomplete-dropdown')).toBeNull();

		input.blur();
		await waitForBlurDelay();
		input.focus();
		await tick();
		expect(getDropdownButtons(component.container)).toHaveLength(3);

		input.blur();
		await waitForBlurDelay();
		expect(component.container.querySelector('.autocomplete-dropdown')).toBeNull();
	});

	test('focuses and selects the input value on mount when requested', async () => {
		const component = renderAutocomplete({
			value: 'Prefilled',
			focusOnMount: true
		});

		await tick();

		const input = getInput(component.container);
		expect(document.activeElement).toBe(input);
		expect(input.selectionStart).toBe(0);
		expect(input.selectionEnd).toBe('Prefilled'.length);
	});

	test('renders custom suggestion icons correctly in object mode', async () => {
		const component = renderAutocomplete({
			showEverything: true,
			suggestions: [
				{ label: 'Built-in', isCustom: false },
				{ label: 'Custom', isCustom: true }
			],
			icon: 'person'
		});

		getInput(component.container).focus();
		await tick();

		const buttons = getDropdownButtons(component.container);
		expect(buttons).toHaveLength(2);
		expect(buttons[0].textContent).toContain('person');
		expect(buttons[1].textContent).toContain('star');
	});
});
