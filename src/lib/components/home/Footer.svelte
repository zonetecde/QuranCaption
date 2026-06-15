<script lang="ts">
	import LL from '$lib/i18n/i18n-svelte';
	import ClickableLink from './ClickableLink.svelte';
</script>

<footer class="w-screen border-t border-color py-8">
	<div class="container mx-auto px-4 sm:px-6 lg:px-8 text-center text-secondary text-sm">
		<div
			class="flex flex-col sm:flex-row justify-center items-center space-y-2 sm:space-y-0 sm:space-x-6 mb-4"
		>
			<ClickableLink
				url="https://github.com/zonetecde/QuranCaption-2"
				label={$LL.home.githubRepo()}
			/>

			<ClickableLink
				url="https://qurancaption-project.vercel.app/documentation"
				label={$LL.home.documentation()}
			/>
			<ClickableLink url="https://discord.gg/Hxfqq2QA2J" label={$LL.home.discord()} />

			<ClickableLink
				url="https://www.paypal.me/rayanestaszewski"
				label={$LL.home.donateViaPaypal()}
			/>
		</div>
		<p class="mb-1">© 2026 Quran Caption. Made by Rayane STASZEWSKI.</p>
	</div>
</footer>
