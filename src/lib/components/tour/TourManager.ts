import { mount, unmount } from 'svelte';
import OnboardingTour from './OnboardingTour.svelte';
import { globalState } from '$lib/runes/main.svelte';
import { AnalyticsService, type AnalyticsWorkflow } from '$lib/services/AnalyticsService';
import { locale } from '$lib/i18n/i18n-svelte';
import { get } from 'svelte/store';

export default class TourManager {
	private static _component: ReturnType<typeof mount> | null = null;
	private static _container: HTMLDivElement | null = null;
	private static _analyticsWorkflow: AnalyticsWorkflow | null = null;
	private static _analyticsLocale: string | undefined;

	static start(force = false): void {
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
				close: (outcome: 'completed' | 'skipped', lastStep: number) =>
					TourManager.stop(outcome, lastStep)
			}
		});
		this._analyticsLocale = get(locale);
		this._analyticsWorkflow = AnalyticsService.trackOnboardingStarted(this._analyticsLocale);
	}

	static stop(outcome: 'completed' | 'skipped' = 'skipped', lastStep = 0): void {
		if (this._analyticsWorkflow) {
			AnalyticsService.trackOnboardingFinished(
				this._analyticsWorkflow,
				outcome,
				this._analyticsLocale,
				lastStep
			);
			this._analyticsWorkflow = null;
			this._analyticsLocale = undefined;
		}
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
