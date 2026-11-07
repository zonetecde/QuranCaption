import { cleanup, render } from 'vitest-browser-svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { get } from 'svelte/store';
import { currentMenu } from 'svelte-contextmenu/stores';
import { addAssetToTimeline } from '$lib/components/projectEditor/tabs/videoEditor/assetsManager/assetTimelineActions';
import AssetViewer from '$lib/components/projectEditor/tabs/videoEditor/assetsManager/AssetViewer.svelte';
import { Asset, AssetType, Duration, Project, ProjectDetail } from '$lib/classes';
import { globalState } from '$lib/runes/main.svelte';
import { loadLocale } from '$lib/i18n/i18n-util.sync';
import { setLocale } from '$lib/i18n/i18n-svelte';

vi.mock(
	'$lib/components/projectEditor/tabs/videoEditor/assetsManager/assetTimelineActions',
	() => ({ addAssetToTimeline: vi.fn(async () => undefined) })
);

describe('asset timeline menu', () => {
	const originalProject = globalState.currentProject;
	let asset: Asset;

	beforeEach(() => {
		loadLocale('en');
		setLocale('en');
		globalState.currentProject = new Project(new ProjectDetail('Cursor test', ''));
		globalState.getTimelineState.cursorPosition = 12345;
		asset = new Asset();
		asset.type = AssetType.Video;
		asset.duration = new Duration(2000);
		vi.spyOn(asset, 'checkExistence').mockResolvedValue(undefined);
	});

	afterEach(() => {
		cleanup();
		document.getElementById('context-menu-portal')?.replaceChildren();
		globalState.currentProject = originalProject;
		vi.restoreAllMocks();
	});

	it.each([false, true])('passes the cursor only when Ctrl is held (%s)', async (ctrlKey) => {
		const component = render(AssetViewer, { asset, onToggleSelection: vi.fn() });
		await component.getByRole('button', { name: 'Add to Timeline', exact: true }).click();
		await tick();
		const menu = get(currentMenu) as HTMLElement | null;
		if (!menu) throw new Error('Timeline menu did not open');
		const option = Array.from(menu.querySelectorAll<HTMLButtonElement>('.context-menu-item')).find(
			(button) => button.textContent?.includes('Video Only')
		)!;
		expect(option).toBeDefined();
		option.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0, ctrlKey }));
		expect(addAssetToTimeline).toHaveBeenCalledWith(
			globalState.currentProject,
			asset,
			true,
			false,
			false,
			ctrlKey ? 12345 : undefined
		);
		const hint = Array.from(menu.querySelectorAll('li')).find((item) =>
			item.textContent?.includes('Hold Ctrl while clicking')
		)!;
		expect(hint.previousElementSibling?.tagName).toBe('HR');
		expect(hint.classList.contains('text-xs')).toBe(true);
	});
});
