import * as SQLite from 'expo-sqlite';
import { useEffect, useState } from 'react';

/**
 * All app data lives in one on-device SQLite database. Nothing is sent to a server
 * except mail going to/from Gmail when the user connects an account.
 */
export const db = SQLite.openDatabaseSync('shotor.db');

const MIGRATIONS: string[] = [
  `
  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    source TEXT NOT NULL,            -- 'pdf' | 'docx' | 'text' | 'paste'
    original_text TEXT NOT NULL,
    summary TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT NOT NULL,              -- 'user' | 'assistant'
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS emails (
    id TEXT PRIMARY KEY,             -- Gmail message id
    thread_id TEXT NOT NULL,
    from_name TEXT,
    from_addr TEXT,
    to_addr TEXT,
    subject TEXT,
    snippet TEXT,
    body TEXT,
    date INTEGER NOT NULL,
    unread INTEGER NOT NULL DEFAULT 0,
    message_id_header TEXT,
    references_header TEXT,
    replied INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS emails_date ON emails(date DESC);
  CREATE TABLE IF NOT EXISTS outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email_id TEXT,                   -- message being replied to (nullable for new mail)
    thread_id TEXT,
    to_addr TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    in_reply_to TEXT,
    references_header TEXT,
    status TEXT NOT NULL,            -- 'draft' | 'queued' | 'sending' | 'sent' | 'failed'
    error TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    sent_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS briefs (
    day TEXT PRIMARY KEY,            -- YYYY-MM-DD
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
];

export function migrate() {
  db.execSync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const row = db.getFirstSync<{ user_version: number }>('PRAGMA user_version');
  let version = row?.user_version ?? 0;
  while (version < MIGRATIONS.length) {
    db.withTransactionSync(() => {
      db.execSync(MIGRATIONS[version]);
      db.execSync(`PRAGMA user_version = ${version + 1}`);
    });
    version += 1;
  }
}

/* ---------- change notifications so screens refresh after writes ---------- */

export type Topic = 'reports' | 'chat' | 'emails' | 'outbox' | 'briefs' | 'settings' | 'model' | 'calendar';
const listeners = new Map<Topic, Set<() => void>>();

export function notify(...topics: Topic[]) {
  for (const t of topics) listeners.get(t)?.forEach((fn) => fn());
}

export function subscribe(topic: Topic, fn: () => void) {
  if (!listeners.has(topic)) listeners.set(topic, new Set());
  listeners.get(topic)!.add(fn);
  return () => {
    listeners.get(topic)!.delete(fn);
  };
}

/** Re-runs `load` whenever one of the topics changes. */
export function useLive<T>(topics: Topic[], load: () => T): T {
  const [value, setValue] = useState<T>(load);
  useEffect(() => {
    const refresh = () => setValue(load());
    refresh();
    const offs = topics.map((t) => subscribe(t, refresh));
    return () => offs.forEach((off) => off());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, topics);
  return value;
}

/* ---------- settings (small key/value store) ---------- */

export function getSetting(key: string): string | null;
export function getSetting(key: string, fallback: string): string;
export function getSetting(key: string, fallback: string | null = null): string | null {
  const row = db.getFirstSync<{ value: string }>('SELECT value FROM settings WHERE key = ?', key);
  return row ? row.value : fallback;
}

export function setSetting(key: string, value: string | null) {
  if (value === null) db.runSync('DELETE FROM settings WHERE key = ?', key);
  else db.runSync('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
  notify('settings');
}

export function dayKey(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
