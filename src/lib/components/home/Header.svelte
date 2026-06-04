<script lang="ts">
	import 'material-icons/iconfont/material-icons.css';
	import LL from '$lib/i18n/i18n-svelte';
</script>

<div
	class="w-screen h-24 bg-secondary flex items-center px-8 xl:px-12 flex-row rounded-b-2xl border-color border-b"
>
	<h1 class="text-3xl font-extrabold tracking-tight">Quran Caption</h1>

	<button class="btn ml-auto btn-icon px-6 py-3">
		<span class="material-icons-outlined mr-2 text-base">settings</span> {$LL.settings.settings()}
	</button>
</div>
