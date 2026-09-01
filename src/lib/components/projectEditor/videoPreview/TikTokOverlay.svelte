<script lang="ts">
	import LL from '$lib/i18n/i18n-svelte';
</script>

<div
	class="tiktok-overlay absolute inset-0 z-30 pointer-events-none select-none"
	aria-hidden="true"
>
	<div class="tiktok-tabs">
		<span class="tiktok-tab-muted">{$LL.editor.tiktokFollowing()}</span>
		<span class="tiktok-tab-active">{$LL.editor.tiktokForYou()}</span>
	</div>

	<div class="tiktok-action-rail">
		<div class="tiktok-profile">
			<div class="tiktok-avatar">
				<span class="material-icons-outlined">person</span>
			</div>
		</div>
		<span class="tiktok-follow-badge">+</span>

		<div class="tiktok-action tiktok-like">
			<span class="material-icons">favorite</span>
			<span class="tiktok-count">12.4K</span>
		</div>
		<div class="tiktok-action tiktok-comment">
			<span class="material-icons">comment</span>
			<span class="tiktok-count">326</span>
		</div>
		<div class="tiktok-action tiktok-favorite">
			<span class="material-icons">bookmark</span>
			<span class="tiktok-count">1.8K</span>
		</div>
		<div class="tiktok-action tiktok-share">
			<span class="material-icons">share</span>
			<span class="tiktok-count">{$LL.editor.tiktokShare()}</span>
		</div>
	</div>

	<div class="tiktok-bottom-row">
		<div class="tiktok-caption">
			<div class="tiktok-username">{$LL.editor.tiktokSampleUsername()}</div>
			<div class="tiktok-description">{$LL.editor.tiktokSampleDescription()}</div>
		</div>

		<div class="tiktok-sound-disc">
			<span class="material-icons">music_note</span>
		</div>
	</div>
</div>

<style>
	/* Référence visuelle 1080 × 1920 : les contrôles restent proportionnels à la preview. */
	.tiktok-overlay {
		--tiktok-profile-size: 80px;
		--tiktok-profile-size: 6.69cqh;
		--tiktok-plus-width: 40px;
		--tiktok-plus-width: 5.66cqw;
		--tiktok-plus-height: 41px;
		--tiktok-plus-height: 3.43cqh;
		--tiktok-sound-size: 52px;
		--tiktok-sound-size: 4.35cqh;
		--tiktok-icon-size: 48px;
		--tiktok-icon-size: 4.7cqh;
		--tiktok-label-size: 18px;
		--tiktok-label-size: 1.7cqh;
		--tiktok-caption-size: 24px;
		--tiktok-caption-size: 2.25cqh;
		--tiktok-username-size: 28px;
		--tiktok-username-size: 2.6cqh;
		container-type: size;
		color: #ffffff;
		font-family: Arial, sans-serif;
		text-shadow: 0 1px 4px rgb(0 0 0 / 85%);
	}

	.tiktok-tabs {
		position: absolute;
		top: 3.8%;
		left: 50%;
		display: flex;
		gap: 24px;
		transform: translateX(-50%);
		font-size: var(--tiktok-caption-size);
		font-weight: 700;
		white-space: nowrap;
	}

	.tiktok-tab-muted {
		opacity: 0.72;
	}

	.tiktok-tab-active {
		border-bottom: 2px solid #ffffff;
		padding-bottom: 5px;
	}

	.tiktok-action-rail {
		position: absolute;
		inset: 0;
	}

	.tiktok-profile {
		position: absolute;
		top: 48.3%;
		left: 92.3%;
		width: var(--tiktok-profile-size);
		height: var(--tiktok-profile-size);
		transform: translate(-50%, -50%);
	}

	.tiktok-avatar {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		height: 100%;
		border-radius: 50%;
	}

	.tiktok-avatar {
		border: 2px solid #ffffff;
		background: linear-gradient(145deg, #25f4ee 0%, #7d5cff 48%, #fe2c55 100%);
	}

	.tiktok-avatar .material-icons-outlined {
		font-size: calc(var(--tiktok-profile-size) * 0.65);
	}

	.tiktok-follow-badge {
		position: absolute;
		top: 51.5%;
		left: 92.3%;
		display: flex;
		align-items: center;
		justify-content: center;
		width: var(--tiktok-plus-width);
		height: var(--tiktok-plus-height);
		border-radius: 50%;
		background: #fe2c55;
		font-size: 22px;
		font-weight: 700;
		line-height: 1;
		transform: translate(-50%, -50%);
		text-shadow: none;
	}

	.tiktok-action {
		position: absolute;
		left: 92.3%;
		display: flex;
		align-items: center;
		justify-content: center;
		transform: translate(-50%, -50%);
	}

	.tiktok-like {
		top: 57.7%;
		width: 52px;
		width: 7.35cqw;
		height: 47px;
		height: 3.93cqh;
	}

	.tiktok-comment {
		top: 66.8%;
		width: 52px;
		width: 7.35cqw;
		height: 50px;
		height: 4.18cqh;
	}

	.tiktok-favorite {
		top: 75.8%;
		width: 38px;
		width: 5.38cqw;
		height: 43px;
		height: 3.6cqh;
	}

	.tiktok-share {
		top: 84.9%;
		width: 50px;
		width: 7.07cqw;
		height: 48px;
		height: 4.02cqh;
	}

	.tiktok-action .material-icons {
		font-size: var(--tiktok-icon-size);
		line-height: 1;
	}

	.tiktok-like .material-icons {
		font-size: 47px;
		font-size: 3.93cqh;
	}

	.tiktok-comment .material-icons {
		font-size: 50px;
		font-size: 4.18cqh;
	}

	.tiktok-favorite .material-icons {
		font-size: 43px;
		font-size: 3.6cqh;
	}

	.tiktok-share .material-icons {
		font-size: 48px;
		font-size: 4.02cqh;
	}

	.tiktok-count {
		position: absolute;
		top: calc(100% + 7px);
		left: 50%;
		font-size: var(--tiktok-label-size);
		font-weight: 700;
		line-height: 1.1;
		transform: translateX(-50%);
		white-space: nowrap;
	}

	.tiktok-sound-disc {
		position: absolute;
		top: 92.5%;
		left: 92.3%;
		display: flex;
		align-items: center;
		justify-content: center;
		width: var(--tiktok-sound-size);
		height: var(--tiktok-sound-size);
		border-radius: 50%;
		border: 3px solid rgb(255 255 255 / 88%);
		background: #151515;
		box-shadow: 0 0 0 4px rgb(0 0 0 / 35%);
		transform: translateX(-50%);
	}

	.tiktok-sound-disc .material-icons {
		font-size: calc(var(--tiktok-sound-size) * 0.52);
	}

	.tiktok-bottom-row {
		position: absolute;
		inset: 0;
	}

	.tiktok-caption {
		position: absolute;
		top: 89.5%;
		left: 3.3%;
		max-width: 74%;
		font-size: var(--tiktok-caption-size);
		line-height: 1.25;
	}

	.tiktok-username {
		margin-bottom: 1.3cqh;
		font-size: var(--tiktok-username-size);
		font-weight: 700;
		line-height: 1.25;
	}

	.tiktok-description {
		max-width: 100%;
		font-weight: 500;
	}
</style>
