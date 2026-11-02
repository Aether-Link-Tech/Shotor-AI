import * as Notifications from 'expo-notifications';
import { db, notify } from './db';
import { summarizeReport } from './ai/tasks';
import { beginWork, endWork, updateWork } from './background';

/**
 * Report summaries run as a queue, independent of any screen: the user can leave the report,
 * open other tabs, or (on Android) leave the app; a notification says when the summary is ready.
 */

export type ReportStatus = 'queued' | 'running' | 'done' | 'error';

/** Live text being written for the running report (not stored until finished). */
const partials = new Map<number, string>();
const partialListeners = new Set<() => void>();
export function partialSummary(id: number) {
  return partials.get(id) ?? '';
}
export function onPartial(fn: () => void) {
  partialListeners.add(fn);
  return () => {
    partialListeners.delete(fn);
  };
}

/** Title from the file name, else the first line of the text — no AI call (that used to cost a full extra pass). */
export function titleFor(text: string, fileName?: string) {
  if (fileName) return fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 80) || 'Untitled report';
  const first = text.split('\n').map((l) => l.trim()).find((l) => l.length > 3) ?? '';
  const words = first.split(/\s+/).slice(0, 10).join(' ');
  return (words.length > 70 ? words.slice(0, 70) + '…' : words) || 'Untitled report';
}

/** Saves the report and queues its summary. Returns the report id immediately. */
export function addReport(title: string, source: string, text: string): number {
  const r = db.runSync(
    `INSERT INTO reports (title, source, original_text, created_at, status, progress) VALUES (?, ?, ?, ?, 'queued', 'Waiting…')`,
    title,
    source,
    text,
    Date.now(),
  );
  notify('reports');
  runQueue();
  return Number(r.lastInsertRowId);
}

export function resummarize(id: number) {
  db.runSync(`UPDATE reports SET status = 'queued', progress = 'Waiting…', error = NULL WHERE id = ?`, id);
  notify('reports');
  runQueue();
}

export function cancelReport(id: number) {
  db.runSync(`UPDATE reports SET status = 'error', error = 'Cancelled', progress = NULL WHERE id = ? AND status = 'queued'`, id);
  notify('reports');
}

let running = false;

/** Processes queued reports one at a time (the model can only do one thing at once). */
export async function runQueue() {
  if (running) return;
  running = true;
  try {
    // A summary interrupted by the app being closed starts again from the beginning.
    db.runSync(`UPDATE reports SET status = 'queued' WHERE status = 'running'`);
    for (;;) {
      const next = db.getFirstSync<{ id: number; title: string; original_text: string }>(
        `SELECT id, title, original_text FROM reports WHERE status = 'queued' ORDER BY created_at LIMIT 1`,
      );
      if (!next) break;
      await runOne(next.id, next.title, next.original_text);
    }
  } finally {
    running = false;
  }
}

async function runOne(id: number, title: string, text: string) {
  const key = `report:${id}`;
  const setProgress = (msg: string, pct: number) => {
    db.runSync(`UPDATE reports SET progress = ? WHERE id = ?`, msg, id);
    notify('reports');
    updateWork(key, msg, pct);
  };
  db.runSync(`UPDATE reports SET status = 'running', progress = 'Starting…', error = NULL WHERE id = ?`, id);
  notify('reports');
  beginWork(key, `Summarising: ${title}`, 'Starting…');
  try {
    const summary = await summarizeReport(title, text, (p) => {
      const pct = Math.round((Math.min(p.done, p.total) / Math.max(p.total, 1)) * 100);
      if (p.partial !== undefined) {
        partials.set(id, p.partial);
        partialListeners.forEach((fn) => fn());
      }
      const msg = p.total > 1 ? `${p.step} (${Math.min(p.done + 1, p.total)}/${p.total})` : p.step;
      setProgress(msg, pct);
    });
    db.runSync(`UPDATE reports SET summary = ?, status = 'done', progress = NULL WHERE id = ?`, summary, id);
    await Notifications.scheduleNotificationAsync({
      content: { title: 'Summary ready ✓', body: title, data: { kind: 'report', url: `/report/${id}` } },
      trigger: null,
    }).catch(() => {});
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    db.runSync(`UPDATE reports SET status = 'error', error = ?, progress = NULL WHERE id = ?`, msg, id);
  } finally {
    partials.delete(id);
    partialListeners.forEach((fn) => fn());
    endWork(key);
    notify('reports');
  }
}
