import { describe, expect, it } from 'vitest';

import { Category, Style, StylesData, VideoStyle } from '$lib/classes/VideoStyle.svelte';
import { applyStyleMutation } from '$lib/services/StyleMutationService';

describe('Style keyframes', () => {
	it('keeps the base value until the first keyframe is reached', () => {
		const style = new Style({ id: 'vertical-position', value: 10 });

		style.setKeyframe(2000, 80);

		expect(style.getValueAt(1999)).toBe(10);
		expect(style.getValueAt(2000)).toBe(80);
	});

	it('applies a keyframe immediately at a fractional cursor time', () => {
		const style = new Style({ id: 'font-size', value: 10 });

		style.setKeyframe(2000.75, 80);

		expect(style.getValueAt(2000.75)).toBe(80);
	});

	it('previews color and opacity fades ending exactly on the keyframe', () => {
		const color = new Style({ id: 'text-color', value: '#000000', valueType: 'color' });
		const opacity = new Style({ id: 'opacity', value: 0, valueType: 'number' });
		const fontSize = new Style({ id: 'font-size', value: 40, valueType: 'number' });
		color.setKeyframe(2000, '#ffffff');
		opacity.setKeyframe(2000, 1);
		fontSize.setKeyframe(2000, 80);

		expect(color.getValueAt(1500, 1000)).toBe('rgba(128, 128, 128, 1)');
		expect(color.getValueAt(2000, 1000)).toBe('#ffffff');
		expect(opacity.getValueAt(1500, 1000)).toBe(0.5);
		expect(opacity.getValueAt(2000, 1000)).toBe(1);
		expect(fontSize.getValueAt(1500, 1000)).toBe(40);
	});

	it('previews visibility fades for global and clip keyframes', () => {
		const show = new Style({ id: 'show-subtitles', value: false, valueType: 'boolean' });
		const styles = new StylesData('arabic', [new Category({ id: 'general', styles: [show] })]);
		show.setKeyframe(2000, true);
		styles.setKeyframe('show-subtitles', 4000, false, [101]);

		expect(styles.getEffectiveVisibilityOpacity('show-subtitles', undefined, 1500, 1000)).toBe(0.5);
		expect(styles.getEffectiveVisibilityOpacity('show-subtitles', undefined, 2000, 1000)).toBe(1);
		expect(styles.getEffectiveVisibilityOpacity('show-subtitles', 101, 3500, 1000)).toBe(0.5);
		expect(styles.getEffectiveVisibilityOpacity('show-subtitles', 101, 4000, 1000)).toBe(0);
	});

	it('replaces, removes and navigates keyframes in timeline order', () => {
		const style = new Style({ id: 'vertical-position', value: 10 });
		style.setKeyframe(4000, 40);
		style.setKeyframe(1000, 20);
		style.setKeyframe(4000, 60);

		expect(style.getPreviousKeyframeTime(4000)).toBe(1000);
		expect(style.getNextKeyframeTime(1000)).toBe(4000);
		expect(style.hasKeyframeAt(4000)).toBe(true);

		style.removeKeyframe(4000);

		expect(style.hasKeyframeAt(4000)).toBe(false);
		expect(style.getValueAt(5000)).toBe(20);
	});

	it('resolves clip keyframes independently from global keyframes', () => {
		const style = new Style({ id: 'font-size', value: 50 });
		const styles = new StylesData('arabic', [new Category({ id: 'text', styles: [style] })]);
		style.setKeyframe(2000, 90);

		styles.setKeyframe('font-size', 1000, 70, [101]);

		expect(styles.getEffectiveValue('font-size', 101, 500)).toBe(50);
		expect(styles.getEffectiveValue('font-size', 101, 1500)).toBe(70);
		expect(styles.getEffectiveValue('font-size', 102, 2500)).toBe(90);
		expect(styles.getEffectiveValue('font-size', 101, 2500)).toBe(70);
	});

	it('collects and removes keyframes across a clip selection', () => {
		const style = new Style({ id: 'font-size', value: 50 });
		const styles = new StylesData('arabic', [new Category({ id: 'text', styles: [style] })]);
		styles.setKeyframe('font-size', 1000, 70, [101]);
		styles.setKeyframe('font-size', 2000, 80, [102]);

		expect(styles.getKeyframeTimes('font-size', [101, 102])).toEqual([1000, 2000]);
		expect(styles.hasKeyframeAt('font-size', 1000, [101, 102])).toBe(true);

		styles.removeKeyframe('font-size', 1000, [101, 102]);

		expect(styles.getKeyframeTimes('font-size', [101, 102])).toEqual([2000]);
	});

	it('creates a new keyframe when an animated style changes at another time', () => {
		const style = new Style({ id: 'font-size', value: 50, valueType: 'number' });
		const styles = new StylesData('arabic', [new Category({ id: 'text', styles: [style] })]);
		const videoStyle = new VideoStyle();
		videoStyle.styles = [styles];
		style.setKeyframe(1000, 60);

		applyStyleMutation({
			videoStyle,
			style,
			target: 'arabic',
			clipIds: [],
			time: 2000,
			value: 80,
			applyBaseValue: (value) => (style.value = value)
		});

		expect(style.value).toBe(50);
		expect(style.getValueAt(1500)).toBe(60);
		expect(style.getValueAt(2000)).toBe(80);
	});

	it('collects every keyframe timing needed by the video export', () => {
		const style = new Style({ id: 'font-size', value: 50 });
		const compositeChild = new Style({ id: 'text-color', value: '#fff' });
		const composite = new Style({
			id: 'surah-latin-text-style',
			valueType: 'composite',
			value: [compositeChild]
		});
		const styles = new StylesData('arabic', [
			new Category({ id: 'text', styles: [style, composite] })
		]);
		const videoStyle = new VideoStyle();
		videoStyle.styles = [styles];
		style.setKeyframe(1000, 60);
		styles.setKeyframe('font-size', 2000, 70, [101]);
		compositeChild.setKeyframe(3000, '#000');

		expect(videoStyle.getAllKeyframeTimes()).toEqual([1000, 2000, 3000]);
	});

	it('preserves global and clip keyframes when reopening a project', () => {
		const style = new Style({ id: 'font-size', value: 50 });
		const styles = new StylesData('arabic', [new Category({ id: 'text', styles: [style] })]);
		const videoStyle = new VideoStyle();
		videoStyle.styles = [styles];
		style.setKeyframe(1000, 60);
		styles.setKeyframe('font-size', 2000, 70, [101]);

		const reopened = VideoStyle.fromJSON(JSON.parse(JSON.stringify(videoStyle))) as VideoStyle;
		const reopenedStyles = reopened.getStylesOfTarget('arabic');

		expect(reopenedStyles.getEffectiveValue('font-size', undefined, 1500)).toBe(60);
		expect(reopenedStyles.getEffectiveValue('font-size', 101, 2500)).toBe(70);
	});
});
