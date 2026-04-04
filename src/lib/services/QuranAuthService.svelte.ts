import { browser } from '$app/environment';
import { invoke } from '@tauri-apps/api/core';
import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { openUrl } from '@tauri-apps/plugin-opener';
import toast from 'svelte-5-french-toast';
import type { QuranAuthPublicState, QuranAuthSession, QuranAuthUser } from '$lib/types/quranAuth';

const BRIDGE_BASE_URL = 'https://qurancaption.com';
// const BRIDGE_BASE_URL = 'http://localhost:5174';
const SESSION_STORAGE_KEY = 'quran_auth_session';
const PENDING_VERIFIER_STORAGE_KEY = 'quran_auth_pending_verifier';
const REFRESH_SKEW_MS = 60_000;

type RefreshRequestBody = {
	refreshToken: string;
	currentUser: QuranAuthUser;
	currentScopes: string[];
};

type PersistedQuranAuthSession = Omit<QuranAuthSession, 'accessToken'> & {
	accessToken: string;
};

class QuranAuthService {
	status = $state<QuranAuthPublicState['status']>('disconnected');
	user = $state<QuranAuthUser | null>(null);
	grantedScopes = $state<string[]>([]);
	expiresAt = $state<string | null>(null);
	errorMessage = $state<string | null>(null);

	private initialized = false;
	private initPromise: Promise<void> | null = null;
	private session: QuranAuthSession | null = null;
	private unlistenOpenUrl: (() => void) | null = null;
	private activeHandoffToken: string | null = null;
	private handledHandoffTokens = new Set<string>();

	get publicState(): QuranAuthPublicState {
		return {
			status: this.status,
			user: this.user,
			grantedScopes: this.grantedScopes,
			expiresAt: this.expiresAt,
			errorMessage: this.errorMessage
		};
	}

	async init(): Promise<void> {
		if (!browser) return;
		if (this.initPromise) return this.initPromise;

		this.initPromise = this.performInit();
		return this.initPromise;
	}

	async beginLogin(): Promise<void> {
		await this.init();

		try {
			this.clearError();
			this.status = 'connecting';
			this.activeHandoffToken = null;
			this.handledHandoffTokens.clear();

			const { verifier, challenge } = await generatePkcePair();
			await this.setSecureValue(PENDING_VERIFIER_STORAGE_KEY, verifier);

			const authorizationUrl = new URL('/oauth/quran/start', BRIDGE_BASE_URL);
			authorizationUrl.searchParams.set('handoff_challenge', challenge);

			await openUrl(authorizationUrl.toString());
		} catch (error) {
			await this.clearPendingVerifier();
			this.setError(error, 'Unable to start Quran.com sign-in.');
			throw error;
		}
	}

	async handleDeepLink(url: string): Promise<void> {
		const parsedUrl = new URL(url);
		if (!isQuranAuthCallbackUrl(parsedUrl)) return;

		const handoffToken = parsedUrl.searchParams.get('handoff_token');
		if (!handoffToken) {
			this.setError(
				new Error('Missing handoff token in deep link.'),
				'Authentication data is incomplete.'
			);
			return;
		}

		if (
			this.activeHandoffToken === handoffToken ||
			this.handledHandoffTokens.has(handoffToken)
		) {
			return;
		}

		this.clearError();
		this.status = 'connecting';
		this.activeHandoffToken = handoffToken;

		try {
			const verifier = await this.getSecureValue(PENDING_VERIFIER_STORAGE_KEY);
			if (!verifier) {
				throw new Error('Missing saved verifier for the OAuth handoff.');
			}

			const response = await this.postBridge<QuranAuthSession>('/api/quran/oauth/redeem', {
				handoffToken,
				handoffVerifier: verifier
			});

			this.applySession(response);
			await this.persistSession(response);
			await this.clearPendingVerifier();
			this.handledHandoffTokens.add(handoffToken);
			toast.success('Connected to Quran.com.');
		} catch (error) {
			this.setError(error, 'Unable to complete Quran.com sign-in.');
			throw error;
		} finally {
			if (this.activeHandoffToken === handoffToken) {
				this.activeHandoffToken = null;
			}
		}
	}

	async refreshIfNeeded(): Promise<QuranAuthSession | null> {
		if (!this.session) return null;
		if (!this.session.refreshToken) return this.session;
		if (!isExpiringSoon(this.session.expiresAt)) return this.session;

		try {
			const refreshed = await this.postBridge<QuranAuthSession, RefreshRequestBody>(
				'/api/quran/oauth/refresh',
				{
					refreshToken: this.session.refreshToken,
					currentUser: this.session.user,
					currentScopes: this.session.grantedScopes
				}
			);

			this.applySession(refreshed);
			await this.persistSession(refreshed);
			return refreshed;
		} catch (error) {
			await this.disconnect();
			this.setError(error, 'Your Quran.com session expired and could not be refreshed.');
			return null;
		}
	}

	async disconnect(): Promise<void> {
		this.session = null;
		this.status = 'disconnected';
		this.user = null;
		this.grantedScopes = [];
		this.expiresAt = null;
		this.errorMessage = null;
		this.activeHandoffToken = null;
		this.handledHandoffTokens.clear();

		await Promise.all([
			this.deleteSecureValue(SESSION_STORAGE_KEY),
			this.deleteSecureValue(PENDING_VERIFIER_STORAGE_KEY)
		]);
	}

	async hydrateFromSecureStore(): Promise<void> {
		const sessionJson = await this.getSecureValue(SESSION_STORAGE_KEY);
		if (!sessionJson) {
			this.session = null;
			if (this.status !== 'error') {
				this.status = 'disconnected';
			}
			return;
		}

		const parsed = JSON.parse(sessionJson) as QuranAuthSession;
		this.applySession(parsed);
	}

	private async performInit(): Promise<void> {
		if (this.initialized) return;
		this.initialized = true;

		this.unlistenOpenUrl = await onOpenUrl((urls) => {
			for (const url of urls) {
				void this.handleDeepLink(url);
			}
		});

		const currentUrls = (await getCurrent()) ?? [];
		const currentAuthUrl = currentUrls.find((url) => {
			try {
				return isQuranAuthCallbackUrl(new URL(url));
			} catch {
				return false;
			}
		});

		if (currentAuthUrl) {
			await this.handleDeepLink(currentAuthUrl);
			return;
		}

		await this.hydrateFromSecureStore();
		await this.refreshIfNeeded();
	}

	private applySession(session: QuranAuthSession): void {
		this.session = session;
		this.status = 'connected';
		this.user = session.user;
		this.grantedScopes = [...session.grantedScopes];
		this.expiresAt = session.expiresAt;
		this.errorMessage = null;
	}

	private async persistSession(session: QuranAuthSession): Promise<void> {
		const persistedSession: PersistedQuranAuthSession = {
			accessToken: '',
			refreshToken: session.refreshToken,
			tokenType: session.tokenType,
			// Force a refresh on the next app start instead of persisting a large access token.
			expiresAt: new Date(0).toISOString(),
			grantedScopes: [...session.grantedScopes],
			user: session.user
		};

		await this.setSecureValue(SESSION_STORAGE_KEY, JSON.stringify(persistedSession));
	}

	private async clearPendingVerifier(): Promise<void> {
		await this.deleteSecureValue(PENDING_VERIFIER_STORAGE_KEY);
	}

	private clearError(): void {
		this.errorMessage = null;
		if (this.status === 'error') {
			this.status = this.session ? 'connected' : 'disconnected';
		}
	}

	private setError(error: unknown, fallbackMessage: string): void {
		console.error('Quran auth error:', error);
		this.errorMessage =
			error instanceof Error && error.message.trim().length > 0 ? error.message : fallbackMessage;
		this.status = 'error';
		toast.error(this.errorMessage);
	}

	private async postBridge<
		TResponse,
		TBody extends Record<string, unknown> = Record<string, unknown>
	>(path: string, body: TBody): Promise<TResponse> {
		const endpoint = new URL(path, BRIDGE_BASE_URL);
		const response = await fetch(endpoint, {
			method: 'POST',
			headers: {
				'content-type': 'application/json'
			},
			body: JSON.stringify(body)
		});

		const payload = (await response.json().catch(() => null)) as
			| { error?: string; details?: string }
			| TResponse
			| null;

		if (!response.ok) {
			const bridgeError =
				payload &&
				typeof payload === 'object' &&
				'error' in payload &&
				typeof payload.error === 'string'
					? payload.error
					: `HTTP ${response.status}`;
			throw new Error(bridgeError);
		}

		if (!payload) {
			throw new Error('Bridge response was empty.');
		}

		return payload as TResponse;
	}

	private async setSecureValue(key: string, value: string): Promise<void> {
		await invoke('quran_auth_secure_set', { key, value });
	}

	private async getSecureValue(key: string): Promise<string | null> {
		return (await invoke('quran_auth_secure_get', { key })) as string | null;
	}

	private async deleteSecureValue(key: string): Promise<void> {
		await invoke('quran_auth_secure_delete', { key });
	}
}

function isQuranAuthCallbackUrl(url: URL): boolean {
	return (
		url.protocol === 'qurancaption:' && url.hostname === 'oauth' && url.pathname === '/callback'
	);
}

function isExpiringSoon(expiresAt: string): boolean {
	const expiresAtMs = new Date(expiresAt).getTime();
	return Number.isNaN(expiresAtMs) || expiresAtMs - Date.now() <= REFRESH_SKEW_MS;
}

async function generatePkcePair(): Promise<{ verifier: string; challenge: string }> {
	const verifierBytes = new Uint8Array(32);
	crypto.getRandomValues(verifierBytes);

	const verifier = toBase64Url(verifierBytes);
	const verifierEncoded = new TextEncoder().encode(verifier);
	const challengeBytes = await crypto.subtle.digest('SHA-256', verifierEncoded);

	return {
		verifier,
		challenge: toBase64Url(new Uint8Array(challengeBytes))
	};
}

function toBase64Url(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}

	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export const quranAuthService = new QuranAuthService();
