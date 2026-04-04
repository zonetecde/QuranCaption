import { browser } from '$app/environment';
import { invoke } from '@tauri-apps/api/core';
import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { openUrl } from '@tauri-apps/plugin-opener';
import toast from 'svelte-5-french-toast';
import type {
	QuranAuthPublicState,
	QuranAuthSession,
	QuranAuthUser,
	QuranCollection
} from '$lib/types/quranAuth';

const BRIDGE_BASE_URL = 'https://qurancaption.com';
const USER_API_BASE_URL = 'https://apis.quran.foundation';
// const BRIDGE_BASE_URL = 'http://localhost:5174';
const SESSION_STORAGE_KEY = 'quran_auth_session';
const PENDING_VERIFIER_STORAGE_KEY = 'quran_auth_pending_verifier';
const REFRESH_SKEW_MS = 60_000;
const QURAN_MUSHAF_ID = 4;

type RefreshRequestBody = {
	refreshToken: string;
	currentUser: QuranAuthUser;
	currentScopes: string[];
};

type PersistedQuranAuthSession = Omit<QuranAuthSession, 'accessToken'> & {
	accessToken: string;
};

type QuranCollectionsResponse = {
	success: boolean;
	data: QuranCollection[];
	pagination?: {
		startCursor: string;
		endCursor: string;
		hasNextPage: boolean;
		hasPreviousPage: boolean;
	};
};

type QuranCollectionResponse = {
	success: boolean;
	data: QuranCollection;
};

type QuranCollectionItemsResponse = {
	success: boolean;
	data: {
		collection: QuranCollection;
		bookmarks: Array<{
			id: string;
			type?: string;
			key: number;
			verseNumber?: number;
		}>;
	};
	pagination?: {
		startCursor: string;
		endCursor: string;
		hasNextPage: boolean;
		hasPreviousPage: boolean;
	};
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

	/** Initialise le service une seule fois et branche l'écoute des deep links OAuth. */
	async init(): Promise<void> {
		if (!browser) return;
		if (this.initPromise) return this.initPromise;

		this.initPromise = this.performInit();
		return this.initPromise;
	}

	/** Lance le flux de connexion Quran.com via le bridge OAuth. */
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

	/** Termine le flux OAuth quand l'application reçoit le deep link de retour. */
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

		if (this.activeHandoffToken === handoffToken || this.handledHandoffTokens.has(handoffToken)) {
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

	/** Rafraîchit la session si le token est manquant ou presque expiré. */
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
			refreshed.clientId ??=
				this.session?.clientId ??
				(refreshed.accessToken ? this.getSessionClientId(refreshed, refreshed.accessToken) : null);

			this.applySession(refreshed);
			await this.persistSession(refreshed);
			return refreshed;
		} catch (error) {
			await this.disconnect();
			this.setError(error, 'Your Quran.com session expired and could not be refreshed.');
			return null;
		}
	}

	/** Efface complètement la session locale Quran.com. */
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

	/** Récupère toutes les collections Quran.com de l'utilisateur connecté. */
	async getCollections(): Promise<QuranCollection[]> {
		const collections: QuranCollection[] = [];
		let after: string | null = null;

		do {
			const searchParams = new URLSearchParams({
				first: '20',
				sortBy: 'alphabetical',
				type: 'ayah'
			});
			if (after) {
				searchParams.set('after', after);
			}

			const response = await this.fetchUserApi<QuranCollectionsResponse>(
				`/auth/v1/collections?${searchParams.toString()}`
			);
			collections.push(...response.data);

			after =
				response.pagination?.hasNextPage && response.pagination.endCursor
					? response.pagination.endCursor
					: null;
		} while (after);

		return collections;
	}

	/** Ajoute un verset dans une collection Quran.com. */
	async addVerseToCollection(collectionId: string, surah: number, verse: number): Promise<void> {
		await this.fetchUserApi(`/auth/v1/collections/${collectionId}/bookmarks`, {
			method: 'POST',
			body: JSON.stringify({
				type: 'ayah',
				key: surah,
				verseNumber: verse,
				mushaf: QURAN_MUSHAF_ID
			})
		});
	}

	/** Crée une nouvelle collection Quran.com. */
	async createCollection(name: string): Promise<QuranCollection> {
		const trimmedName = name.trim();
		if (!trimmedName) {
			throw new Error('Collection name cannot be empty.');
		}

		const response = await this.fetchUserApi<QuranCollectionResponse>('/auth/v1/collections', {
			method: 'POST',
			body: JSON.stringify({
				name: trimmedName
			})
		});

		return response.data;
	}

	/** Cherche si un verset précis existe déjà dans une collection et renvoie son bookmark id. */
	async getCollectionBookmarkId(
		collectionId: string,
		surah: number,
		verse: number
	): Promise<string | null> {
		let after: string | null = null;

		do {
			const searchParams = new URLSearchParams({
				sortBy: 'verseKey',
				first: '20'
			});
			if (after) {
				searchParams.set('after', after);
			}

			const response = await this.fetchUserApi<QuranCollectionItemsResponse>(
				`/auth/v1/collections/${collectionId}?${searchParams.toString()}`
			);

			// Certaines réponses Quran.com n'exposent pas `type`, donc on accepte aussi ce cas.
			const bookmark = response.data.bookmarks.find(
				(item) =>
					(item.type === undefined || item.type === 'ayah') &&
					item.key === surah &&
					item.verseNumber === verse
			);
			if (bookmark) {
				return bookmark.id;
			}

			after =
				response.pagination?.hasNextPage && response.pagination.endCursor
					? response.pagination.endCursor
					: null;
		} while (after);

		return null;
	}

	/** Parcourt toutes les collections pour savoir lesquelles contiennent déjà ce verset. */
	async getCollectionsContainingVerse(
		surah: number,
		verse: number
	): Promise<{
		selectedCollectionIds: string[];
		bookmarkIdsByCollectionId: Record<string, string>;
	}> {
		const collections = await this.getCollections();
		const bookmarkEntries = await Promise.all(
			collections.map(async (collection) => ({
				collectionId: collection.id,
				bookmarkId: await this.getCollectionBookmarkId(collection.id, surah, verse)
			}))
		);

		const selectedCollectionIds: string[] = [];
		const bookmarkIdsByCollectionId: Record<string, string> = {};

		for (const entry of bookmarkEntries) {
			if (!entry.bookmarkId) continue;
			selectedCollectionIds.push(entry.collectionId);
			bookmarkIdsByCollectionId[entry.collectionId] = entry.bookmarkId;
		}

		return { selectedCollectionIds, bookmarkIdsByCollectionId };
	}

	/** Retire un verset d'une collection via son bookmark id. */
	async removeVerseFromCollection(collectionId: string, bookmarkId: string): Promise<void> {
		await this.fetchUserApi(`/auth/v1/collections/${collectionId}/bookmarks/${bookmarkId}`, {
			method: 'DELETE'
		});
	}

	/** Recharge la session persistée localement au démarrage de l'app. */
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

	/** Fait l'initialisation réelle une seule fois. */
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

	/** Applique la session en mémoire et met à jour l'état public exposé à l'UI. */
	private applySession(session: QuranAuthSession): void {
		session.clientId ??=
			session.accessToken?.trim().length > 0
				? this.getSessionClientId(session, session.accessToken)
				: (this.session?.clientId ?? null);
		this.session = session;
		this.status = 'connected';
		this.user = session.user;
		this.grantedScopes = [...session.grantedScopes];
		this.expiresAt = session.expiresAt;
		this.errorMessage = null;
	}

	/** Persiste une version légère de la session pour éviter de stocker un gros access token. */
	private async persistSession(session: QuranAuthSession): Promise<void> {
		const clientId =
			session.clientId ??
			(session.accessToken?.trim().length > 0
				? this.getSessionClientId(session, session.accessToken)
				: null);
		const persistedSession: PersistedQuranAuthSession = {
			accessToken: '',
			refreshToken: session.refreshToken,
			tokenType: session.tokenType,
			// Force a refresh on the next app start instead of persisting a large access token.
			expiresAt: new Date(0).toISOString(),
			grantedScopes: [...session.grantedScopes],
			user: session.user,
			clientId
		};

		await this.setSecureValue(SESSION_STORAGE_KEY, JSON.stringify(persistedSession));
	}

	/** Supprime le verifier PKCE temporaire après succès ou annulation. */
	private async clearPendingVerifier(): Promise<void> {
		await this.deleteSecureValue(PENDING_VERIFIER_STORAGE_KEY);
	}

	/** Nettoie le message d'erreur sans casser une session encore valide. */
	private clearError(): void {
		this.errorMessage = null;
		if (this.status === 'error') {
			this.status = this.session ? 'connected' : 'disconnected';
		}
	}

	/** Centralise l'affichage des erreurs Quran.com côté UI. */
	private setError(error: unknown, fallbackMessage: string): void {
		console.error('Quran auth error:', error);
		this.errorMessage =
			error instanceof Error && error.message.trim().length > 0 ? error.message : fallbackMessage;
		this.status = 'error';
		toast.error(this.errorMessage);
	}

	/** Appelle le bridge Qurancaption.com pour les étapes OAuth qui ne passent pas directement côté client. */
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

	/** Appelle l'API Quran Foundation avec les headers d'auth attendus. */
	private async fetchUserApi<TResponse>(path: string, init: RequestInit = {}): Promise<TResponse> {
		const { accessToken, clientId } = await this.getUserApiCredentials();
		const response = await fetch(new URL(path, USER_API_BASE_URL), {
			method: init.method ?? 'GET',
			headers: {
				'content-type': 'application/json',
				'x-auth-token': accessToken,
				'x-client-id': clientId,
				...(init.headers ?? {})
			},
			body: init.body
		});

		const payload = (await response.json().catch(() => null)) as
			| { message?: string; error?: string; type?: string; success?: boolean }
			| TResponse
			| null;

		if (!response.ok) {
			const apiError =
				payload &&
				typeof payload === 'object' &&
				'message' in payload &&
				typeof payload.message === 'string'
					? payload.message
					: payload &&
						  typeof payload === 'object' &&
						  'error' in payload &&
						  typeof payload.error === 'string'
						? payload.error
						: `HTTP ${response.status}`;
			throw new Error(apiError);
		}

		if (!payload) {
			throw new Error('Quran Foundation API response was empty.');
		}

		return payload as TResponse;
	}

	/** Récupère un access token valide et le client id nécessaire aux endpoints Quran Foundation. */
	private async getUserApiCredentials(): Promise<{ accessToken: string; clientId: string }> {
		let session = this.session ?? (await this.refreshIfNeeded());
		if (!session) {
			throw new Error('Connect your Quran.com account first.');
		}

		if (!session.accessToken?.trim()) {
			session.expiresAt = new Date(0).toISOString();
			session = await this.refreshIfNeeded();
		}

		const accessToken = session?.accessToken?.trim();
		if (!accessToken) {
			throw new Error('Quran.com access token is unavailable. Please reconnect.');
		}

		if (!session) {
			throw new Error('Connect your Quran.com account first.');
		}

		const clientId = this.getSessionClientId(session, accessToken);
		if (!clientId) {
			throw new Error(
				'Quran Foundation client id is missing from the current session. Please reconnect.'
			);
		}

		return { accessToken, clientId };
	}

	/** Extrait le client id depuis la session ou depuis les claims du JWT si besoin. */
	private getSessionClientId(session: QuranAuthSession, accessToken: string): string | null {
		if (typeof session.clientId === 'string' && session.clientId.trim().length > 0) {
			return session.clientId.trim();
		}

		const payload = decodeJwtPayload(accessToken);
		if (!payload) return null;

		const claimCandidates = ['client_id', 'clientId', 'azp'] as const;
		for (const claim of claimCandidates) {
			const value = payload[claim];
			if (typeof value === 'string' && value.trim().length > 0) {
				return value.trim();
			}
		}

		if (typeof payload.aud === 'string' && payload.aud.trim().length > 0) {
			return payload.aud.trim();
		}

		return null;
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

function decodeJwtPayload(token: string): Record<string, unknown> | null {
	const parts = token.split('.');
	if (parts.length < 2) return null;

	try {
		const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
		const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
		const decoded = atob(padded);
		return JSON.parse(decoded) as Record<string, unknown>;
	} catch {
		return null;
	}
}

export const quranAuthService = new QuranAuthService();
