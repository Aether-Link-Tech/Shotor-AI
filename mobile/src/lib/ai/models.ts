import { Directory, File, FileMode, Paths } from 'expo-file-system';
import NetInfo from '@react-native-community/netinfo';
import { getSetting, notify, setSetting } from '../db';
import { beginWork, endWork, updateWork } from '../background';

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
    id: 'qwen3-1.7b',
    name: 'Qwen 3 1.7B (fast)',
    file: 'Qwen_Qwen3-1.7B-Q4_K_M.gguf',
    url: 'https://huggingface.co/bartowski/Qwen_Qwen3-1.7B-GGUF/resolve/main/Qwen_Qwen3-1.7B-Q4_K_M.gguf',
    sizeBytes: 1282439584,
    ramGb: 4,
    description: 'About 2x faster than the 3B model with good summaries. Best choice if reports feel slow.',
    disableThinking: true,
  },
  {
    id: 'llama-3.2-1b',
    name: 'Llama 3.2 1B (basic — older phones only)',
    file: 'Llama-3.2-1B-Instruct-Q4_K_M.gguf',
    url: 'https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf',
    sizeBytes: 807694464,
    ramGb: 3,
    description: 'Very small. In testing it sometimes invented figures in summaries — use only if the phone cannot run the larger models.',
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

/* ---------- downloading (resumable) ---------- */

/**
 * The model is downloaded in 32 MB pieces with HTTP Range requests and appended to a ".part" file.
 * If the connection drops, the app is closed or the phone restarts, the download continues from the
 * last saved byte instead of starting over. It waits for the internet and retries by itself.
 */
const CHUNK = 32 * 1024 * 1024;

export type DownloadState = {
  modelId: string;
  written: number;
  total: number;
  status: 'downloading' | 'paused' | 'waiting' | 'error';
  error?: string;
};

let current: { state: DownloadState; abort: AbortController | null; stop: boolean } | null = null;
const downloadListeners = new Set<(s: DownloadState | null) => void>();

export function onDownload(fn: (s: DownloadState | null) => void) {
  downloadListeners.add(fn);
  fn(current?.state ?? null);
  return () => {
    downloadListeners.delete(fn);
  };
}

function emit() {
  const s = current?.state ?? null;
  downloadListeners.forEach((fn) => fn(s));
  if (s) {
    const pct = Math.floor((s.written / Math.max(s.total, 1)) * 100);
    const text =
      s.status === 'waiting'
        ? `${pct}% · waiting for internet`
        : s.status === 'paused'
          ? `${pct}% · paused`
          : `${pct}% · ${formatBytes(s.written)} of ${formatBytes(s.total)}`;
    updateWork('download', text, pct);
  }
}

function partFile(m: ModelInfo) {
  return modelFile(m.file + '.part');
}

/** Bytes already saved for an unfinished download (survives app restarts). */
export function partialBytes(m: ModelInfo) {
  const f = partFile(m);
  return f.exists ? (f.size ?? 0) : 0;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForInternet(job: { stop: boolean }) {
  for (;;) {
    const n = await NetInfo.fetch();
    if (n.isConnected && n.isInternetReachable !== false) return;
    if (job.stop) return;
    await sleep(3000);
  }
}

export async function downloadModel(m: ModelInfo) {
  if (current && !current.stop && current.state.modelId !== m.id) throw new Error('Another model is already downloading.');
  if (current && !current.stop && current.state.modelId === m.id) return;
  const done = partialBytes(m);
  const free = Paths.availableDiskSpace;
  if (free && free < (m.sizeBytes - done) * 1.05) {
    throw new Error(`Not enough storage. Need about ${((m.sizeBytes - done) / 1e9).toFixed(1)} GB free.`);
  }
  const job = { state: { modelId: m.id, written: done, total: m.sizeBytes, status: 'downloading' } as DownloadState, abort: null as AbortController | null, stop: false };
  current = job;
  setSetting('model.downloading', m.id); // resume automatically on next app start
  beginWork('download', `Downloading AI model: ${m.name}`, 'Starting…', Math.floor((done / m.sizeBytes) * 100));
  emit();
  let failures = 0;
  try {
    const part = partFile(m);
    if (!part.exists) part.create();
    const tmp = modelFile(m.file + '.chunk');
    while (!job.stop) {
      const offset = part.size ?? 0;
      if (offset >= m.sizeBytes) break;
      const last = Math.min(offset + CHUNK, m.sizeBytes) - 1;
      job.state = { ...job.state, written: offset, status: 'downloading', error: undefined };
      emit();
      try {
        if (tmp.exists) tmp.delete();
        job.abort = new AbortController();
        await File.downloadFileAsync(m.url, tmp, {
          headers: { Range: `bytes=${offset}-${last}` },
          idempotent: true,
          signal: job.abort.signal,
          onProgress: ({ bytesWritten }) => {
            job.state = { ...job.state, written: offset + bytesWritten };
            emit();
          },
        });
        const expected = last - offset + 1;
        if ((tmp.size ?? 0) !== expected) throw new Error(`Incomplete piece (${tmp.size} of ${expected} bytes)`);
        // Append the piece, then drop it. Only complete pieces are added, so the .part file is always valid.
        const bytes = await tmp.bytes();
        const h = part.open(FileMode.Append);
        try {
          await h.writeBytes(bytes);
        } finally {
          h.close();
        }
        tmp.delete();
        failures = 0;
      } catch (e) {
        if (job.stop) break;
        failures++;
        job.state = { ...job.state, status: 'waiting', error: e instanceof Error ? e.message : String(e) };
        emit();
        await waitForInternet(job);
        // Back off on repeated failures (4 s … 60 s), then retry the same piece.
        await sleep(Math.min(60000, 2000 * 2 ** Math.min(failures, 5)));
      }
    }
    if (job.stop) return;
    const target = modelFile(m.file);
    if (target.exists) target.delete();
    part.move(target);
    setSetting('model.downloading', null);
    if (current === job) current = null;
    emit();
    if (!getSetting('model.active') || !activeModel()) setActiveModel(m.id);
    notify('model');
  } finally {
    endWork('download');
  }
}

/** Pauses, keeping everything downloaded so far; resume continues from the same byte. */
export function pauseDownload() {
  if (!current) return;
  current.stop = true;
  current.abort?.abort();
  current.state = { ...current.state, status: 'paused' };
  emit();
}

export async function resumeDownload() {
  const id = current?.state.modelId ?? getSetting('model.downloading');
  const m = MODELS.find((x) => x.id === id);
  if (!m) return;
  if (current) current.stop = true;
  current = null;
  await downloadModel(m);
}

/** Stops and deletes the partial file. */
export function cancelDownload() {
  const id = current?.state.modelId ?? getSetting('model.downloading');
  if (current) {
    current.stop = true;
    current.abort?.abort();
  }
  current = null;
  setSetting('model.downloading', null);
  endWork('download');
  emit();
  const m = MODELS.find((x) => x.id === id);
  if (m) {
    for (const f of [partFile(m), modelFile(m.file + '.chunk')]) if (f.exists) f.delete();
  }
}

/** Called at app start: continue a download that was running when the app closed. */
export function resumeInterruptedDownload() {
  const id = getSetting('model.downloading');
  const m = MODELS.find((x) => x.id === id);
  if (!m || isDownloaded(m)) {
    if (id) setSetting('model.downloading', null);
    return;
  }
  downloadModel(m).catch(() => {});
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
