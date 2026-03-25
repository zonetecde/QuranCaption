import { mount, unmount } from 'svelte';
import OnboardingTour from './OnboardingTour.svelte';
import { globalState } from '$lib/runes/main.svelte';

export default class TourManager {
	private static _component: ReturnType<typeof mount> | null = null;
	private static _container: HTMLDivElement | null = null;

	static start(force = false) {
		if (this._container && !force) return;
		if (this._container) this.stop();

		const container = document.createElement('div');
		container.id = 'onboarding-tour-container';
		document.body.appendChild(container);
		this._container = container;

		globalState.uiState.isTourActive = true;

		this._component = mount(OnboardingTour, {
			target: container,
			props: {
				close: () => TourManager.stop()
			}
		});
	}

	static stop() {
		if (this._component) {
			unmount(this._component);
			this._component = null;
		}
		if (this._container) {
			this._container.remove();
			this._container = null;
		}
		globalState.uiState.isTourActive = false;
	}
}
