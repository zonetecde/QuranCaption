import { globalState } from '$lib/runes/main.svelte';
import { invoke } from '@tauri-apps/api/core';

interface DiscordActivity {
	details?: string;
	state?: string;
	large_image_key?: string;
	large_image_text?: string;
	small_image_key?: string;
	small_image_text?: string;
	start_timestamp?: number;
}

class DiscordService {
	private isInitialized = false;
	private readonly APP_ID = '1413639399584956486';
	private startTimestamp: number | null = null;

	async init(): Promise<void> {
		if (this.isInitialized) return;

		invoke('init_discord_rpc', { appId: this.APP_ID }).then(() => {
			this.isInitialized = true;
			this.startTimestamp = Math.floor(Date.now() / 1000); // Timestamp en secondes
			console.log('Discord Rich Presence initialisé');
		});
	}

	async updateActivity(activity: DiscordActivity): Promise<void> {
		if (!this.isInitialized) {
			await this.init();
		}

		try {
			await invoke('update_discord_activity', { activityData: activity });
		} catch (error) {
			console.error("Erreur lors de la mise à jour de l'activité Discord:", error);
		}
	}

	async clearActivity(): Promise<void> {
		if (!this.isInitialized) return;

		try {
			await invoke('clear_discord_activity');
		} catch (error) {
			console.error("Erreur lors de la suppression de l'activité Discord:", error);
		}
	}

	async close(): Promise<void> {
		if (!this.isInitialized) return;

		try {
			await invoke('close_discord_rpc');
			this.isInitialized = false;
		} catch (error) {
			console.error('Erreur lors de la fermeture de Discord RPC:', error);
		}
	}

	// Méthodes prédéfinies pour différents états
	async setIdleState(): Promise<void> {
		await this.updateActivity({
			details: 'Using Quran Caption',
			state: 'At the Home Menu',
			large_image_key: 'logo',
			large_image_text: 'Quran Caption',
			small_image_key: 'idle',
			small_image_text: 'Idle',
			start_timestamp: this.startTimestamp || undefined
		});
	}

	async setEditingState(): Promise<void> {
		if (!globalState.currentProject) return;

		const { name, reciter } = globalState.currentProject.detail;
		await this.updateActivity({
			details: 'Creating a Quran video',
			state:
				reciter && reciter !== 'not set' ? `Working on ${name} (${reciter})` : `Working on ${name}`,
			large_image_key: 'logo',
			large_image_text: 'Quran Caption',
			small_image_key: 'edit',
			small_image_text: 'Captioning',
			start_timestamp: this.startTimestamp || undefined
		});
	}

	// Méthode pour réinitialiser le timer
	resetTimer(): void {
		this.startTimestamp = Math.floor(Date.now() / 1000);
	}
}

// Instance singleton
export const discordService = new DiscordService();
