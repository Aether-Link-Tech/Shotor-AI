import { requireOptionalNativeModule } from 'expo-modules-core';
import { AppState } from 'react-native';

/**
 * Keeps long work (report summaries, model download) running when the user leaves the app.
 * Android: a foreground service with an ongoing notification + partial wake lock (local module
 * modules/shotor-background). iOS has no equivalent for long work, so there the job pauses in the
 * background and continues when the app is opened again.
 */
type NativeBackground = {
  start(title: string, text: string, progress: number): void;
  update(title: string, text: string, progress: number): void;
  stop(): void;
  isRunning(): boolean;
};
const Native = requireOptionalNativeModule<NativeBackground>('ShotorBackground');

const active = new Map<string, { title: string; text: string; progress: number }>();

function show() {
  if (!Native) return;
  const items = [...active.values()];
  if (!items.length) {
    try {
      Native.stop();
    } catch {}
    return;
  }
  const top = items[items.length - 1];
  const title = items.length > 1 ? `${top.title} (+${items.length - 1} more)` : top.title;
  try {
    if (Native.isRunning()) Native.update(title, top.text, top.progress);
    else if (AppState.currentState === 'active') Native.start(title, top.text, top.progress);
  } catch {
    // Starting can fail if the app is already in the background; the work still runs while the app lives.
  }
}

/** Marks a piece of work as running (key identifies it, e.g. "report:12"). Progress 0–100, or -1 for unknown. */
export function beginWork(key: string, title: string, text = 'Working…', progress = -1) {
  active.set(key, { title, text, progress });
  show();
}

export function updateWork(key: string, text: string, progress = -1) {
  const w = active.get(key);
  if (!w) return;
  w.text = text;
  w.progress = progress;
  show();
}

export function endWork(key: string) {
  active.delete(key);
  show();
}
