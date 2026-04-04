export type QuranAuthStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface QuranAuthUser {
	sub: string;
	name?: string | null;
	preferredUsername?: string | null;
	email?: string | null;
}

export interface QuranAuthSession {
	accessToken: string;
	refreshToken: string;
	tokenType: string;
	expiresAt: string;
	grantedScopes: string[];
	user: QuranAuthUser;
}

export interface QuranAuthPublicState {
	status: QuranAuthStatus;
	user: QuranAuthUser | null;
	grantedScopes: string[];
	expiresAt: string | null;
	errorMessage: string | null;
}
