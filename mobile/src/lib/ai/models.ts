import { Directory, File, Paths } from 'expo-file-system';
import type { DownloadTask } from 'expo-file-system';
import { getSetting, notify, setSetting } from '../db';

export type ModelInfo = {
  id: string;
  name: string;
  file: string;
  url: string;
  sizeBytes: number;
  ramGb: number;
  description: string;
  /** Qwen3 is a reasoning model; we switch thinking off for fast, short answers. */
  disableThinking?: boolean;
};

/**
 * Open-weight models in GGUF format (the same files Ollama uses), 4-bit quantized.
 * Downloaded once over the internet, then everything runs offline on the phone.
 */
export const MODELS: ModelInfo[] = [
  {
    id: 'llama-3.2-3b',
    name: 'Llama 3.2 3B (recommended)',
    file: 'Llama-3.2-3B-Instruct-Q4_K_M.gguf',
    url: 'https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf',
    sizeBytes: 2019377696,
    ramGb: 6,
    description: 'Good summaries and email replies. For phones with 6 GB RAM or more.',
  },
  {
    id: 'gemma-3-4b',
    name: 'Gemma 3 4B',
    file: 'google_gemma-3-4b-it-Q4_K_M.gguf',
    url: 'https://huggingface.co/bartowski/google_gemma-3-4b-it-GGUF/resolve/main/google_gemma-3-4b-it-Q4_K_M.gguf',
    sizeBytes: 2489758112,
    ramGb: 8,
    description: 'Strongest writing quality. For flagship phones with 8 GB RAM or more.',
  },
  {
    id: 'qwen3-4b',
    name: 'Qwen 3 4B',
    file: 'Qwen3-4B-Q4_K_M.gguf',
    url: 'https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf',
    sizeBytes: 2497280256,
    ramGb: 8,
    description: 'Strong at structured reports and many languages. 8 GB RAM or more.',
    disableThinking: true,
  },
  {
    id: 'llama-3.2-1b',
    name: 'Llama 3.2 1B (light)',
    file: 'Llama-3.2-1B-Instruct-Q4_K_M.gguf',
    url: 'https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf',
    sizeBytes: 807694464,
    ramGb: 3,
    description: 'Fast and small. Simpler summaries. Works on older phones.',
  },
];

export const CUSTOM_MODEL_ID = 'custom';

export function modelsDir() {
  const dir = new Directory(Paths.document, 'models');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

export function modelFile(file: string) {
  return new File(modelsDir(), file);
}

export function isDownloaded(m: ModelInfo) {
  const f = modelFile(m.file);
  return f.exists && (f.size ?? 0) >= m.sizeBytes * 0.98;
}

/** The model the user picked, if its file is on the device. */
export function activeModel(): { info: ModelInfo; path: string } | null {
  const id = getSetting('model.active');
  if (!id) return null;
  if (id === CUSTOM_MODEL_ID) {
    const name = getSetting('model.customFile');
    if (!name) return null;
    const f = modelFile(name);
    if (!f.exists) return null;
    return {
      info: { id, name: name.replace(/\.gguf$/i, ''), file: name, url: '', sizeBytes: f.size ?? 0, ramGb: 0, description: 'Imported model' },
      path: f.uri,
    };
  }
  const info = MODELS.find((m) => m.id === id);
  if (!info || !isDownloaded(info)) return null;
  return { info, path: modelFile(info.file).uri };
}

export function setActiveModel(id: string) {
  setSetting('model.active', id);
  notify('model');
}

/* ---------- downloading ---------- */

export type DownloadState = { modelId: string; written: number; total: number; status: 'downloading' | 'paused' | 'error'; error?: string };
let current: { task: DownloadTask; state: DownloadState } | null = null;
const downloadListeners = new Set<(s: DownloadState | null) => void>();

export function onDownload(fn: (s: DownloadState | null) => void) {
  downloadListeners.add(fn);
  fn(current?.state ?? null);
  return () => {
    downloadListeners.delete(fn);
  };
}
function emit() {
  downloadListeners.forEach((fn) => fn(current?.state ?? null));
}

export async function downloadModel(m: ModelInfo) {
  if (current && current.state.status === 'downloading') throw new Error('Another model is already downloading.');
  const free = Paths.availableDiskSpace;
  if (free && free < m.sizeBytes * 1.1) {
    throw new Error(`Not enough storage. Need about ${(m.sizeBytes / 1e9).toFixed(1)} GB free.`);
  }
  const part = modelFile(m.file + '.part');
  if (part.exists) part.delete();
  const task = File.createDownloadTask(m.url, part, {
    onProgress: ({ bytesWritten, totalBytes }) => {
      if (!current) return;
      current.state = { ...current.state, written: bytesWritten, total: totalBytes || m.sizeBytes };
      emit();
    },
  });
  current = { task, state: { modelId: m.id, written: 0, total: m.sizeBytes, status: 'downloading' } };
  emit();
  try {
    const result = await task.downloadAsync();
    if (!result) return; // paused or cancelled
    const target = modelFile(m.file);
    if (target.exists) target.delete();
    part.move(target);
    current = null;
    emit();
    if (!getSetting('model.active') || !activeModel()) setActiveModel(m.id);
    notify('model');
  } catch (e) {
    if (current) {
      current.state = { ...current.state, status: 'error', error: e instanceof Error ? e.message : String(e) };
      emit();
    }
    throw e;
  }
}

export async function pauseDownload() {
  if (!current) return;
  await current.task.pauseAsync();
  current.state = { ...current.state, status: 'paused' };
  emit();
}

export async function resumeDownload() {
  if (!current) return;
  const m = MODELS.find((x) => x.id === current!.state.modelId)!;
  current.state = { ...current.state, status: 'downloading' };
  emit();
  try {
    const result = await current.task.resumeAsync();
    if (!result) return;
    const part = modelFile(m.file + '.part');
    const target = modelFile(m.file);
    if (target.exists) target.delete();
    part.move(target);
    current = null;
    emit();
    if (!activeModel()) setActiveModel(m.id);
    notify('model');
  } catch (e) {
    if (current) {
      current.state = { ...current.state, status: 'error', error: e instanceof Error ? e.message : String(e) };
      emit();
    }
  }
}

export function cancelDownload() {
  if (!current) return;
  const m = current.state.modelId;
  try {
    current.task.pause();
  } catch {}
  current = null;
  emit();
  const info = MODELS.find((x) => x.id === m);
  if (info) {
    const part = modelFile(info.file + '.part');
    if (part.exists) part.delete();
  }
}

/** Copy a .gguf file from the phone's storage (e.g. sent by USB/AirDrop) — fully offline install. */
export async function importModelFromDevice(): Promise<string | null> {
  const picked = await File.pickFileAsync({});
  if (picked.canceled || !picked.result) return null;
  const src = picked.result;
  const name = (src.name || 'model.gguf').replace(/[^A-Za-z0-9._-]/g, '_');
  if (!/\.gguf$/i.test(name)) throw new Error('Please choose a .gguf model file.');
  const dest = modelFile(name);
  if (dest.exists) dest.delete();
  await src.copy(dest);
  setSetting('model.customFile', name);
  setActiveModel(CUSTOM_MODEL_ID);
  return name;
}

export function deleteModel(m: ModelInfo) {
  const f = modelFile(m.file);
  if (f.exists) f.delete();
  if (getSetting('model.active') === m.id) setSetting('model.active', null);
  notify('model');
}

export function formatBytes(n: number) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(0)} MB`;
  return `${Math.round(n / 1e3)} KB`;
}
