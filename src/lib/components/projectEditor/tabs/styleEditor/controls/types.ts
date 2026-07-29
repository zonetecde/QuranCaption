import type { Style } from '$lib/classes/VideoStyle.svelte';

export type StyleControlValue = Style['value'];
export type ApplyStyleControlValue = (value: StyleControlValue) => void;
