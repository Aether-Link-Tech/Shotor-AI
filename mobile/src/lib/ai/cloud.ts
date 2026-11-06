import * as SecureStore from 'expo-secure-store';
import { getSetting, notify, setSetting } from '../db';
import { generate, type ChatMessage, type GenerateOptions } from './engine';

/**
 * Fast online AI for email and chat (Cloudflare Workers AI, Llama 3.3 70B).
 *
 * The key is typed in once on each phone (Settings → Online AI) and kept in secure storage;
 * it is never built into the app. Only email and chat text go online: reports, proposals and
 * attachments always use the on-phone AI. When the key is missing, the internet is down, the
 * service fails or the free daily allowance is used up, the on-phone AI is used instead.
 */

export const CLOUD_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const KEY_ACCOUNT = 'cloud.accountId';
const KEY_TOKEN = 'cloud.token';
const TIMEOUT_MS = 45000;

export type CloudKey = { accountId: string; token: string };
export type CloudStatus = 'off' | 'on' | 'limit' | 'invalid';

export async function cloudKey(): Promise<CloudKey | null> {
  const accountId = (await SecureStore.getItemAsync(KEY_ACCOUNT)) ?? '';
  const token = (await SecureStore.getItemAsync(KEY_TOKEN)) ?? '';
  return accountId && token ? { accountId, token } : null;
}

/** Status for Settings, without reading the key. */
export function cloudStatus(): CloudStatus {
  if (getSetting('cloud.enabled', '0') !== '1') return 'off';
  if (getSetting('cloud.invalid', '0') === '1') return 'invalid';
  if (Number(getSetting('cloud.limitUntil', '0')) > Date.now()) return 'limit';
  return 'on';
}

export class CloudError extends Error {
  constructor(
    message: string,
    readonly kind: 'invalid' | 'limit' | 'network' | 'server',
  ) {
    super(message);
  }
}

function nextUtcMidnight() {
  const d = new Date();
  d.setUTCHours(24, 0, 0, 0);
  return d.getTime();
}

/** One request to Workers AI. JSON schemas return parsed JSON, which is turned back into text. */
async function callCloud(key: CloudKey, messages: ChatMessage[], opts: GenerateOptions): Promise<string> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(key.accountId)}/ai/run/${CLOUD_MODEL}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages,
        max_tokens: opts.maxTokens ?? 700,
        temperature: opts.temperature ?? 0.4,
        ...(opts.jsonSchema ? { response_format: { type: 'json_schema', json_schema: opts.jsonSchema } } : {}),
      }),
      signal: abort.signal,
    });
  } catch {
    throw new CloudError('No connection to the online AI.', 'network');
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401 || res.status === 403) throw new CloudError('The online AI key is not valid.', 'invalid');
  if (res.status === 429) throw new CloudError('The free daily online AI allowance is used up.', 'limit');
  let body: { success?: boolean; result?: { response?: unknown }; errors?: { code?: number; message?: string }[] };
  try {
    body = await res.json();
  } catch {
    throw new CloudError(`Online AI error ${res.status}.`, 'server');
  }
  const errorText = (body.errors ?? []).map((e) => e.message ?? '').join(' ');
  if (/allocation|quota|neurons|limit/i.test(errorText)) throw new CloudError('The free daily online AI allowance is used up.', 'limit');
  if (!res.ok || !body.success) throw new CloudError(`Online AI error ${res.status}${errorText ? ': ' + errorText.slice(0, 120) : ''}`, 'server');
  const out = body.result?.response;
  return typeof out === 'string' ? out.trim() : JSON.stringify(out ?? '');
}

/** Saves the key after one real test request. Throws a readable message if it does not work. */
export async function saveCloudKey(accountId: string, token: string) {
  const key = { accountId: accountId.trim(), token: token.trim() };
  if (!key.accountId || !key.token) throw new Error('Enter both the account ID and the token.');
  try {
    await callCloud(key, [{ role: 'user', content: 'Reply with the single word OK.' }], { maxTokens: 5, temperature: 0 });
  } catch (e) {
    if (e instanceof CloudError && e.kind === 'invalid') throw new Error('Cloudflare did not accept this account ID and token. Check both and try again.');
    if (e instanceof CloudError && e.kind === 'network') throw new Error('No internet connection. Try again when online.');
    if (!(e instanceof CloudError && e.kind === 'limit')) throw e; // a used-up allowance still means the key is right
  }
  await SecureStore.setItemAsync(KEY_ACCOUNT, key.accountId);
  await SecureStore.setItemAsync(KEY_TOKEN, key.token);
  setSetting('cloud.enabled', '1');
  setSetting('cloud.invalid', '0');
  setSetting('cloud.limitUntil', null);
  notify('settings');
}

export async function removeCloudKey() {
  await SecureStore.deleteItemAsync(KEY_ACCOUNT);
  await SecureStore.deleteItemAsync(KEY_TOKEN);
  setSetting('cloud.enabled', '0');
  setSetting('cloud.invalid', '0');
  setSetting('cloud.limitUntil', null);
  notify('settings');
}

/**
 * For email and chat: the online AI when available, otherwise the on-phone AI.
 * Never use this for reports, proposals or attachments.
 */
export async function fastGenerate(messages: ChatMessage[], opts: GenerateOptions = {}): Promise<string> {
  const key = cloudStatus() === 'on' ? await cloudKey() : null;
  if (key) {
    try {
      const text = await callCloud(key, messages, opts);
      opts.onToken?.(text);
      return text;
    } catch (e) {
      if (e instanceof CloudError && e.kind === 'limit') setSetting('cloud.limitUntil', String(nextUtcMidnight()));
      if (e instanceof CloudError && e.kind === 'invalid') setSetting('cloud.invalid', '1');
      if (e instanceof CloudError && (e.kind === 'limit' || e.kind === 'invalid')) notify('settings');
      // Any failure: fall through to the phone.
    }
  }
  return generate(messages, opts);
}
