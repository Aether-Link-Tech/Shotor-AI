import * as AuthSession from 'expo-auth-session';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import { notify, setSetting } from '../db';

WebBrowser.maybeCompleteAuthSession();

/**
 * Google sign-in runs entirely on the phone (OAuth 2 + PKCE, no client secret, no server).
 * It uses one "iOS" type OAuth client ID on both platforms, whose reversed ID is the app's redirect scheme.
 * See mobile/README.md → "Gmail setup".
 */
const discovery: AuthSession.DiscoveryDocument = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  revocationEndpoint: 'https://oauth2.googleapis.com/revoke',
};

export const GMAIL_SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send'];

const KEY_REFRESH = 'google.refreshToken';
const KEY_ACCESS = 'google.accessToken';
const KEY_EXPIRES = 'google.expiresAt';

export function googleClientId(): string {
  return ((Constants.expoConfig?.extra as Record<string, unknown> | undefined)?.googleClientId as string) || '';
}

export function isGmailConfigured() {
  return /\.apps\.googleusercontent\.com$/.test(googleClientId());
}

function redirectUri() {
  const reversed = googleClientId().split('.').reverse().join('.');
  return `${reversed}:/oauthredirect`;
}

export async function isGmailConnected() {
  return !!(await SecureStore.getItemAsync(KEY_REFRESH));
}

export async function connectGmail(): Promise<string> {
  if (!isGmailConfigured()) throw new Error('Gmail is not set up in this build. Add a Google client ID (see README).');
  const clientId = googleClientId();
  const request = new AuthSession.AuthRequest({
    clientId,
    scopes: GMAIL_SCOPES,
    redirectUri: redirectUri(),
    usePKCE: true,
    extraParams: { access_type: 'offline', prompt: 'consent' },
  });
  const result = await request.promptAsync(discovery);
  if (result.type !== 'success') throw new Error(result.type === 'error' ? result.error?.message || 'Google sign-in failed' : 'Sign-in cancelled');
  const tokens = await AuthSession.exchangeCodeAsync(
    { clientId, code: result.params.code, redirectUri: redirectUri(), extraParams: { code_verifier: request.codeVerifier ?? '' } },
    discovery,
  );
  if (!tokens.refreshToken) throw new Error('Google did not return offline access. Remove the app from your Google account permissions and try again.');
  await SecureStore.setItemAsync(KEY_REFRESH, tokens.refreshToken);
  await saveAccess(tokens);
  const profile = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
    headers: { Authorization: `Bearer ${tokens.accessToken}` },
  }).then((r) => r.json());
  setSetting('google.email', profile.emailAddress ?? '');
  notify('emails');
  return profile.emailAddress ?? '';
}

async function saveAccess(t: AuthSession.TokenResponse) {
  await SecureStore.setItemAsync(KEY_ACCESS, t.accessToken);
  const expiresAt = (t.issuedAt ?? Math.floor(Date.now() / 1000)) + (t.expiresIn ?? 3600);
  await SecureStore.setItemAsync(KEY_EXPIRES, String(expiresAt));
}

export class AuthExpiredError extends Error {}

/** Returns a valid access token, refreshing it if needed (requires internet). */
export async function accessToken(): Promise<string> {
  const refresh = await SecureStore.getItemAsync(KEY_REFRESH);
  if (!refresh) throw new AuthExpiredError('Gmail is not connected.');
  const access = await SecureStore.getItemAsync(KEY_ACCESS);
  const exp = Number((await SecureStore.getItemAsync(KEY_EXPIRES)) || 0);
  if (access && exp - 120 > Date.now() / 1000) return access;
  try {
    const t = await AuthSession.refreshAsync({ clientId: googleClientId(), refreshToken: refresh }, discovery);
    if (t.refreshToken) await SecureStore.setItemAsync(KEY_REFRESH, t.refreshToken);
    await saveAccess(t);
    return t.accessToken;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/invalid_grant/i.test(msg)) {
      await disconnectGmail(false);
      throw new AuthExpiredError('Google sign-in expired. Please reconnect Gmail in Settings.');
    }
    throw e;
  }
}

export async function disconnectGmail(revoke = true) {
  const refresh = await SecureStore.getItemAsync(KEY_REFRESH);
  if (revoke && refresh) {
    await AuthSession.revokeAsync({ token: refresh, clientId: googleClientId() }, discovery).catch(() => {});
  }
  await SecureStore.deleteItemAsync(KEY_REFRESH);
  await SecureStore.deleteItemAsync(KEY_ACCESS);
  await SecureStore.deleteItemAsync(KEY_EXPIRES);
  setSetting('google.email', null);
  notify('emails');
}
