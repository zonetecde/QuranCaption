<script lang="ts">
	import { Quran } from '$lib/classes/Quran';

	type TranslationVerse = [number, string];
	type MustafaKhattabSurah = [{ ayahs: number }, ...TranslationVerse[]];
	type PreviewVerse = {
		id: number;
		arabic: string;
		translation: string;
	};

	type Props = {
		surahId: number;
		startAyah: number;
		endAyah: number;
		isVisible: boolean;
	};

	let { surahId, startAyah, endAyah, isVisible }: Props = $props();

	let previewVerses: PreviewVerse[] = $state([]);
	let isLoading = $state(false);
	let loadError = $state('');

	const isInvalidRange = $derived(endAyah < startAyah);

	/**
	 * Charge le texte arabe et la traduction locale Mustafa Khattab pour la plage sélectionnée.
	 */
	async function loadPreviewVerses() {
		if (!isVisible || isInvalidRange) {
			previewVerses = [];
			return;
		}

		isLoading = true;
		loadError = '';

		try {
			const [surah, translationResponse] = await Promise.all([
				Quran.getSurah(surahId),
				fetch(`/translations/en-mustafakhattab/${surahId}.json`)
			]);

			if (!translationResponse.ok) {
				throw new Error('Unable to load Mustafa Khattab translation.');
			}

			const translationData = (await translationResponse.json()) as MustafaKhattabSurah;
			const translations = new Map<number, string>(
				(translationData.slice(1) as TranslationVerse[]).map(([verse, text]) => [verse, text])
			);

			previewVerses = surah.verses
				.filter((verse) => verse.id >= startAyah && verse.id <= endAyah)
				.map((verse) => ({
					id: verse.id,
					arabic: verse.words.map((word) => word.arabic).join(' '),
					translation: translations.get(verse.id) ?? ''
				}));
		} catch (error) {
			console.error('AI video verse preview failed:', error);
			loadError = 'Unable to load verse preview.';
			previewVerses = [];
		} finally {
			isLoading = false;
		}
	}

	$effect(() => {
		surahId;
		startAyah;
		endAyah;
		isVisible;
		void loadPreviewVerses();
	});
</script>

{#if isVisible}
	<aside
		class="flex min-h-0 flex-col rounded-[32px] border border-color bg-[color-mix(in_srgb,var(--bg-secondary)_88%,transparent)] p-4 shadow-2xl shadow-black/35 backdrop-blur-md"
	>
		<div class="mb-3 flex items-center justify-between gap-3">
			<div>
				<h3 class="text-sm font-semibold text-primary">Verse preview</h3>
				<p class="mt-1 text-xs text-thirdly">Mustafa Khattab English translation</p>
			</div>
			<span class="rounded-full border border-color bg-primary px-3 py-1 text-xs text-secondary">
				{surahId}:{startAyah}-{endAyah}
			</span>
		</div>

		{#if isInvalidRange}
			<div
				class="rounded-lg border border-danger-color/50 bg-danger-color/10 p-4 text-sm text-primary"
			>
				Invalid range: the end verse must be greater than or equal to the start verse.
			</div>
		{:else if isLoading}
			<div class="rounded-lg border border-color bg-primary p-4 text-sm text-thirdly">
				Loading preview...
			</div>
		{:else if loadError}
			<div
				class="rounded-lg border border-danger-color/50 bg-danger-color/10 p-4 text-sm text-primary"
			>
				{loadError}
			</div>
		{:else}
			<div class="flex max-h-[28rem] flex-col gap-3 overflow-y-auto pr-1">
				{#each previewVerses as verse (verse.id)}
					<article class="rounded-lg border border-color bg-primary p-4">
						<p class="arabic text-right text-2xl leading-10 text-primary" dir="rtl">
							{verse.arabic}
						</p>
						<p class="mt-3 text-sm leading-6 text-secondary">
							<span class="font-semibold text-accent-primary">{surahId}:{verse.id}</span>
							{verse.translation}
						</p>
					</article>
				{/each}
			</div>
		{/if}
	</aside>
{/if}
