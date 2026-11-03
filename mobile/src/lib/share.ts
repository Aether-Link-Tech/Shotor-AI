import { requireOptionalNativeModule } from 'expo-modules-core';
import type { EventSubscription } from 'expo-modules-core';

/**
 * "Share → Shotor AI" from other apps (Android). The native side copies a shared file into the
 * app cache, or passes shared text; the New report screen picks it up from here.
 */
export type SharedItem = { uri?: string; name?: string; mimeType?: string | null; text?: string; subject?: string | null; error?: string };

type NativeShare = {
  takeShared(): SharedItem | null;
  addListener(event: 'onShare', fn: () => void): EventSubscription;
};
const Native = requireOptionalNativeModule<NativeShare>('ShotorBackground');

let pending: SharedItem | null = null;

/** Checks for a new share; returns true if there is one waiting for the New report screen. */
export function checkForShare(): boolean {
  try {
    const item = Native?.takeShared() ?? null;
    if (item && (item.uri || item.text || item.error)) pending = item;
  } catch {}
  return !!pending;
}

/** Hands the waiting share to the screen (once). */
export function takePendingShare(): SharedItem | null {
  const p = pending;
  pending = null;
  return p;
}

export function onShare(fn: () => void): () => void {
  try {
    const sub = Native?.addListener('onShare', fn);
    return () => sub?.remove();
  } catch {
    return () => {};
  }
}
