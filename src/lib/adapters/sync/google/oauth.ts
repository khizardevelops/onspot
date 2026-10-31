// SPDX-License-Identifier: AGPL-3.0-or-later

import { get } from 'svelte/store';
import { currentRuntime, isTauri } from '#lib/platform/runtime.js';
import { googleRefreshToken } from '#lib/stores/secrets.js';
import { httpRequest, readErrorBody } from '../http.js';
import { SyncError, type SyncAccount } from '../types.js';

/**
 * Google Drive authorization.
 *
 * Desktop uses the installed-app flow: a loopback listener in Rust receives the
 * redirect and the PKCE verifier is exchanged in the webview. The browser uses
 * Google Identity Services, whose token model is the only public-client flow
 * Google supports on the web without a client secret.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';
const GIS_SCRIPT_URL = 'https://accounts.google.com/gsi/client';

/** App-private folder: the learner's normal Drive listing never shows the backup. */
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const IDENTITY_SCOPES = ['openid', 'email'];
const SCOPES = [...IDENTITY_SCOPES, DRIVE_SCOPE].join(' ');

/** Refresh a minute early so an in-flight upload cannot start with a dead token. */
const TOKEN_EXPIRY_MARGIN_MS = 60_000;

/** Loopback and popup both need a human; 5 minutes is generous without hanging forever. */
const AUTHORIZATION_TIMEOUT_MS = 5 * 60_000;

const ACCOUNT_LABEL_KEY = 'onspot.sync.google.account';

/** The subset of the Google Identity Services API this app uses. */
interface GoogleTokenResponse {
	access_token?: string;
	expires_in?: number;
	refresh_token?: string;
	error?: string;
	error_description?: string;
}

interface GoogleTokenClient {
	requestAccessToken(options?: { prompt?: string }): void;
}

interface GoogleOAuth2 {
	initTokenClient(config: {
		client_id: string;
		scope: string;
		callback: (response: GoogleTokenResponse) => void;
		error_callback?: (error: { type?: string; message?: string }) => void;
	}): GoogleTokenClient;
}

interface AccessToken {
	value: string;
	expiresAt: number;
}

let cachedAccessToken: AccessToken | null = null;

function desktopClientId(): string {
	return import.meta.env.VITE_GOOGLE_CLIENT_ID_DESKTOP ?? '';
}

function webClientId(): string {
	return import.meta.env.VITE_GOOGLE_CLIENT_ID_WEB ?? '';
}

/**
 * Resolves the OAuth client id for the running build.
 *
 * @returns The client id compiled for this runtime.
 */
export function googleClientIdForRuntime(): string {
	const clientId = isTauri() ? desktopClientId() : webClientId();

	if (!clientId) {
		throw new SyncError(
			'No Google client id is configured for this build. Set VITE_GOOGLE_CLIENT_ID_DESKTOP or VITE_GOOGLE_CLIENT_ID_WEB.'
		);
	}

	return clientId;
}

function readAccountLabel(): string | null {
	if (typeof localStorage === 'undefined') return null;

	try {
		return localStorage.getItem(ACCOUNT_LABEL_KEY);
	} catch {
		return null;
	}
}

function writeAccountLabel(label: string): void {
	if (typeof localStorage === 'undefined') return;

	try {
		localStorage.setItem(ACCOUNT_LABEL_KEY, label);
	} catch {
		// The label is cosmetic; authorization itself does not depend on it.
	}
}

function clearAccountLabel(): void {
	if (typeof localStorage === 'undefined') return;

	try {
		localStorage.removeItem(ACCOUNT_LABEL_KEY);
	} catch {
		// Nothing to do.
	}
}

function cacheToken(response: GoogleTokenResponse): AccessToken {
	const accessToken = response.access_token;
	if (!accessToken) {
		throw new SyncError('Google did not return an access token. Connect again.');
	}

	const lifetimeMs = (response.expires_in ?? 3600) * 1000;
	const token = { value: accessToken, expiresAt: Date.now() + lifetimeMs };
	cachedAccessToken = token;

	if (response.refresh_token) googleRefreshToken.set(response.refresh_token);

	return token;
}

function base64Url(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);

	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function randomVerifier(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(64));
	return base64Url(bytes);
}

async function challengeFor(verifier: string): Promise<string> {
	const encoded = new TextEncoder().encode(verifier);
	const digest = await crypto.subtle.digest('SHA-256', encoded);

	return base64Url(new Uint8Array(digest));
}

function randomState(): string {
	return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

function buildAuthorizationUrl(
	clientId: string,
	redirectUri: string,
	challenge: string,
	state: string
): string {
	const parameters = new URLSearchParams({
		client_id: clientId,
		redirect_uri: redirectUri,
		response_type: 'code',
		scope: SCOPES,
		code_challenge: challenge,
		code_challenge_method: 'S256',
		access_type: 'offline',
		prompt: 'consent',
		state
	});

	return `${AUTH_URL}?${parameters.toString()}`;
}

async function readTokenResponse(response: Response): Promise<GoogleTokenResponse> {
	if (!response.ok) {
		const body = await readErrorBody(response);
		const detail = body ? `: ${body}` : '.';

		throw new SyncError(`Google sign-in failed (HTTP ${response.status})${detail}`, true);
	}

	const token = (await response.json()) as GoogleTokenResponse;

	if (token.error) {
		const detail = token.error_description ? `: ${token.error_description}` : '.';
		throw new SyncError(`Google sign-in failed (${token.error})${detail}`, true);
	}

	return token;
}

async function exchangeAuthorizationCode(
	code: string,
	verifier: string,
	clientId: string,
	redirectUri: string
): Promise<AccessToken> {
	const body = new URLSearchParams({
		code,
		client_id: clientId,
		redirect_uri: redirectUri,
		grant_type: 'authorization_code',
		code_verifier: verifier
	});

	const response = await httpRequest(TOKEN_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: body.toString()
	});

	return cacheToken(await readTokenResponse(response));
}

async function fetchAccountLabel(accessToken: string): Promise<string> {
	try {
		const response = await httpRequest(USERINFO_URL, {
			headers: { Authorization: `Bearer ${accessToken}` }
		});

		if (!response.ok) return 'Google Drive';

		const profile = (await response.json()) as { email?: string; name?: string };
		return profile.email ?? profile.name ?? 'Google Drive';
	} catch {
		return 'Google Drive';
	}
}

async function connectOnDesktop(clientId: string): Promise<AccessToken> {
	const { invoke } = await import('@tauri-apps/api/core');
	const { openUrl } = await import('@tauri-apps/plugin-opener');

	const verifier = randomVerifier();
	const challenge = await challengeFor(verifier);
	const state = randomState();

	const port = await invoke<number>('oauth_loopback_start');
	const redirectUri = `http://127.0.0.1:${port}`;
	const authorizationUrl = buildAuthorizationUrl(clientId, redirectUri, challenge, state);

	await openUrl(authorizationUrl);

	const callback = await invoke<{ code?: string; state?: string; error?: string }>(
		'oauth_loopback_wait',
		{ timeoutMs: AUTHORIZATION_TIMEOUT_MS }
	);

	if (callback.error) {
		throw new SyncError(`Google sign-in failed: ${callback.error}.`);
	}

	if (!callback.code || callback.state !== state) {
		throw new SyncError('Google sign-in returned an unexpected response. Try again.');
	}

	return exchangeAuthorizationCode(callback.code, verifier, clientId, redirectUri);
}

function getGoogleOAuth2(): GoogleOAuth2 | null {
	const google = (window as unknown as { google?: { accounts?: { oauth2?: GoogleOAuth2 } } }).google;
	return google?.accounts?.oauth2 ?? null;
}

async function loadIdentityServices(): Promise<void> {
	if (getGoogleOAuth2()) return;

	await new Promise<void>((resolve, reject) => {
		const existing = document.querySelector<HTMLScriptElement>(
			`script[src="${GIS_SCRIPT_URL}"]`
		);

		if (existing) {
			const timer = setTimeout(
				() => reject(new SyncError('Google sign-in timed out while loading.')),
				AUTHORIZATION_TIMEOUT_MS
			);

			existing.addEventListener('load', () => {
				clearTimeout(timer);
				resolve();
			});
			existing.addEventListener('error', () => {
				clearTimeout(timer);
				reject(new SyncError('Google sign-in could not be loaded. Check your connection.'));
			});
			return;
		}

		const script = document.createElement('script');
		script.src = GIS_SCRIPT_URL;
		script.async = true;
		script.defer = true;
		script.addEventListener('load', () => resolve());
		script.addEventListener('error', () =>
			reject(new SyncError('Google sign-in could not be loaded. Check your connection.'))
		);

		document.head.append(script);
	});
}

async function requestWebToken(clientId: string): Promise<AccessToken> {
	await loadIdentityServices();

	const oauth2 = getGoogleOAuth2();
	if (!oauth2) {
		throw new SyncError('Google sign-in is unavailable in this browser.');
	}

	const response = await new Promise<GoogleTokenResponse>((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new SyncError('Google sign-in timed out. Try again.')),
			AUTHORIZATION_TIMEOUT_MS
		);

		const client = oauth2.initTokenClient({
			client_id: clientId,
			scope: SCOPES,
			callback: (token) => {
				clearTimeout(timer);
				resolve(token);
			},
			error_callback: (error) => {
				clearTimeout(timer);
				reject(new SyncError(error.message ?? 'Google sign-in was cancelled.'));
			}
		});

		client.requestAccessToken({ prompt: 'consent' });
	});

	return cacheToken(response);
}

async function refreshToken(clientId: string): Promise<AccessToken> {
	const refreshTokenValue = get(googleRefreshToken);
	if (!refreshTokenValue) {
		throw new SyncError('Connect Google Drive first.', true);
	}

	const body = new URLSearchParams({
		client_id: clientId,
		refresh_token: refreshTokenValue,
		grant_type: 'refresh_token'
	});

	const response = await httpRequest(TOKEN_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: body.toString()
	});

	if (response.status === 400) {
		googleRefreshToken.set('');
		throw new SyncError('Google Drive authorization expired. Connect again.', true);
	}

	return cacheToken(await readTokenResponse(response));
}

/**
 * Returns a usable access token, refreshing it when possible.
 *
 * @param forceRefresh Ignore a still-valid cached token (used after a 401).
 * @returns A bearer token for the Drive and user-info APIs.
 */
export async function googleAccessToken(forceRefresh = false): Promise<string> {
	const isCachedTokenFresh =
		!forceRefresh &&
		cachedAccessToken !== null &&
		cachedAccessToken.expiresAt > Date.now() + TOKEN_EXPIRY_MARGIN_MS;

	if (isCachedTokenFresh) return cachedAccessToken!.value;

	return (await refreshToken(googleClientIdForRuntime())).value;
}

/** Reports the connected Google account, or null when this device must reconnect. */
export function googleAccount(): SyncAccount | null {
	// The browser's token flow has no refresh token, so an expired in-memory
	// token is no longer a usable connection and must offer Connect again.
	const hasFreshToken =
		cachedAccessToken !== null && cachedAccessToken.expiresAt > Date.now();
	const hasAuthorization = Boolean(get(googleRefreshToken)) || hasFreshToken;

	if (!hasAuthorization) return null;

	return { label: readAccountLabel() ?? 'Google Drive' };
}

/**
 * Runs the platform's authorization flow.
 *
 * @returns The connected account's display label.
 */
export async function connectGoogleDrive(): Promise<SyncAccount> {
	const runtime = currentRuntime();
	if (runtime === 'android' || runtime === 'ios') {
		throw new SyncError(
			'Google Drive sync is not available in the mobile builds yet. Use WebDAV for now.'
		);
	}

	const clientId = googleClientIdForRuntime();
	const token = isTauri() ? await connectOnDesktop(clientId) : await requestWebToken(clientId);
	const label = await fetchAccountLabel(token.value);

	writeAccountLabel(label);

	return { label };
}

/** Forgets this device's Google authorization. The Drive file is untouched. */
export function disconnectGoogleDrive(): void {
	googleRefreshToken.set('');
	cachedAccessToken = null;
	clearAccountLabel();
}
