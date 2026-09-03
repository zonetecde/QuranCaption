<script lang="ts">
	import LL from '$lib/i18n/i18n-svelte';
	import { getStyleName } from '$lib/i18n/styleMapper';
	import { get } from 'svelte/store';

	type NoticeCopy = {
		antiCollisionNotice(): string;
		antiCollisionNoticeHelpEnabled(): string;
		antiCollisionNoticeHelpAlternative(): string;
		antiCollisionNoticeHelpAnd(): string;
		antiCollisionNoticeHelpTargets(): string;
	};

	let {
		copy,
		onDismiss
	}: {
		copy: NoticeCopy;
		onDismiss: () => void;
	} = $props();
</script>

<div
	class="absolute left-6 top-6 z-30 flex max-w-[calc(100%_-_3rem)] items-center gap-4 rounded-lg border border-amber-500/45 bg-slate-900/85 px-5 py-3 text-[28px] leading-tight text-white/90 shadow-md backdrop-blur-sm"
>
	<span class="material-icons-outlined text-4xl text-amber-500" aria-hidden="true">
		warning_amber
	</span>
	<span>{copy.antiCollisionNotice()}</span>
	<span class="group relative">
		<button
			type="button"
			class="flex h-10 w-10 items-center justify-center rounded-full text-[28px] text-white/70 hover:bg-white/10 hover:text-white focus-visible:bg-white/10 focus-visible:text-white border-2 border-amber-500/70"
			aria-label={get(LL).common.question()}
			aria-describedby="anti-collision-notice-tooltip"
		>
			?
		</button>
		<span
			id="anti-collision-notice-tooltip"
			class="absolute left-[-16px] top-[calc(100%+16px)] hidden w-[min(840px,80vw)] rounded-lg border border-white/15 bg-slate-900/95 px-6 py-5 text-[26px] leading-relaxed text-white shadow-lg group-hover:block group-focus-within:block"
			role="tooltip"
		>
			<span class="font-mono font-semibold text-amber-300">{$LL.status.video()}</span>
			→
			<span class="font-mono font-semibold text-amber-300">
				{getStyleName('general', $LL)}
			</span>
			→
			<span class="font-mono font-semibold text-amber-300">
				{getStyleName('anti-collision', $LL)}
			</span>
			{copy.antiCollisionNoticeHelpEnabled()}
			<br /><br />
			{copy.antiCollisionNoticeHelpAlternative()}
			<span class="font-mono font-semibold text-amber-300">
				{getStyleName('max-height', $LL)}
			</span>
			{copy.antiCollisionNoticeHelpAnd()}
			<span class="font-mono font-semibold text-amber-300">
				{getStyleName('vertical-text-alignment', $LL)}
			</span>
			{copy.antiCollisionNoticeHelpTargets()}
		</span>
	</span>
	<button
		type="button"
		class="flex h-10 w-10 items-center justify-center rounded-full text-white/70 hover:bg-white/10 hover:text-white focus-visible:bg-white/10 focus-visible:text-white"
		onclick={onDismiss}
		aria-label={get(LL).common.dismiss()}
		title={get(LL).common.dismiss()}
	>
		<span class="material-icons-outlined text-3xl" aria-hidden="true">close</span>
	</button>
</div>
