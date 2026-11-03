import { Platform } from 'react-native';
import { initLlama, type LlamaContext } from 'llama.rn';
import { activeModel, type ModelInfo } from './models';
import { getSetting, notify, setSetting } from '../db';

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

const STOP_WORDS = ['</s>', '<|end|>', '<|eot_id|>', '<|end_of_text|>', '<|im_end|>', '<|EOT|>', '<|END_OF_TURN_TOKEN|>', '<|end_of_turn|>', '<|endoftext|>', '<end_of_turn>'];

/** Context window. 4096 tokens fits a 3–4B model comfortably in phone RAM. */
export const N_CTX = 4096;

/** One completion at a time: the model context is single-threaded. */
let queue: Promise<unknown> = Promise.resolve();

type Loaded = { ctx: LlamaContext; path: string; info: ModelInfo };
let loaded: Loaded | null = null;
let loading: Promise<Loaded> | null = null;
export type EngineStatus = 'no-model' | 'idle' | 'loading' | 'ready' | 'busy' | 'error';
let status: EngineStatus = 'idle';
let lastError = '';
const statusListeners = new Set<(s: EngineStatus) => void>();

function setStatus(s: EngineStatus) {
  status = s;
  statusListeners.forEach((fn) => fn(s));
}
export function engineStatus() {
  return { status, error: lastError, model: loaded?.info.name ?? activeModel()?.info.name ?? null };
}
export function onEngineStatus(fn: (s: EngineStatus) => void) {
  statusListeners.add(fn);
  return () => {
    statusListeners.delete(fn);
  };
}

/** Speed settings, tuned per phone by the speed test (Settings → AI speed). */
export type SpeedConfig = { threads: number; gpu: boolean };
export function speedConfig(): SpeedConfig {
  return {
    threads: Number(getSetting('ai.threads', Platform.OS === 'android' ? '4' : '0')) || 4,
    // Metal on iPhone is always used; Android GPU (OpenCL on Snapdragon/Adreno) only if the speed test found it faster.
    gpu: Platform.OS === 'ios' ? true : getSetting('ai.gpu', '0') === '1',
  };
}

async function loadContext(path: string, cfg: SpeedConfig) {
  return initLlama({
    model: path,
    n_ctx: N_CTX,
    n_batch: 512,
    n_ubatch: 512,
    use_mlock: false,
    // Phone CPUs mix fast and slow cores; more threads than fast cores makes every token wait on the slowest one.
    n_threads: Platform.OS === 'android' ? cfg.threads : undefined,
    n_gpu_layers: cfg.gpu ? 99 : 0,
    flash_attn_type: 'auto',
    // 8-bit attention cache: half the memory traffic of the default, with no visible quality change.
    cache_type_k: 'q8_0',
    cache_type_v: 'q8_0',
  });
}

async function ensureLoaded(): Promise<Loaded> {
  const model = activeModel();
  if (!model) {
    setStatus('no-model');
    throw new Error('No AI model installed yet. Open Settings → AI model to download one.');
  }
  if (loaded && loaded.path === model.path) return loaded;
  if (loading) return loading;
  loading = (async () => {
    if (loaded) {
      await loaded.ctx.release().catch(() => {});
      loaded = null;
    }
    setStatus('loading');
    try {
      const ctx = await loadContext(model.path, speedConfig());
      loaded = { ctx, path: model.path, info: model.info };
      lastError = '';
      setStatus('ready');
      notify('model');
      return loaded;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      setStatus('error');
      throw new Error(`Could not load the AI model: ${lastError}. The phone may not have enough free memory.`);
    } finally {
      loading = null;
    }
  })();
  return loading;
}

/* ------------------------------- speed test ------------------------------- */

export type SpeedResult = {
  threads: number;
  gpu: boolean;
  /** Tokens per second reading the document (prompt) and writing the answer. */
  readTps: number;
  writeTps: number;
  /** CPU-optimised engine build that Android loaded (e.g. rnllama_jni_v8_2_dotprod). */
  engine: string;
  gpuNote: string;
  /** Estimated seconds for a 600-word report summary. */
  estimate600: number;
};

/** A 600-word report is about 900 tokens to read and ~350 tokens to write. */
const estimate = (readTps: number, writeTps: number) => 900 / Math.max(readTps, 0.1) + 350 / Math.max(writeTps, 0.1);

async function benchOnce(path: string, cfg: SpeedConfig): Promise<SpeedResult> {
  const ctx = await loadContext(path, cfg);
  try {
    const b = await ctx.bench(256, 48, 1, 1);
    return {
      threads: cfg.threads,
      gpu: cfg.gpu && ctx.gpu,
      readTps: b.speedPp,
      writeTps: b.speedTg,
      engine: String(ctx.androidLib ?? (Platform.OS === 'ios' ? 'iOS (Metal)' : 'unknown')),
      gpuNote: ctx.gpu ? 'GPU in use' : ctx.reasonNoGPU || 'CPU only',
      estimate600: estimate(b.speedPp, b.speedTg),
    };
  } finally {
    await ctx.release().catch(() => {});
  }
}

/**
 * Tries a few thread counts (and the GPU where available) on this phone, keeps the fastest
 * and saves it. Takes about a minute; the model is reloaded with the winner afterwards.
 */
export function runSpeedTest(onStep?: (msg: string) => void): Promise<{ best: SpeedResult; all: SpeedResult[] }> {
  // Runs in the same queue as generate(), so it never fights a report or chat for the model.
  const p = queue.then(() => speedTestNow(onStep), () => speedTestNow(onStep));
  queue = p.catch(() => {});
  return p;
}

let tuning: Promise<unknown> | null = null;
/**
 * Runs the speed test once per installed model, by itself, so every phone gets its fastest settings
 * without anyone opening Settings. Called at app start and after a model download finishes.
 */
export function autoTune() {
  const model = activeModel();
  if (!model || tuning || getSetting('ai.tunedFor') === model.info.id) return;
  tuning = runSpeedTest()
    .then(() => setSetting('ai.tunedFor', model.info.id))
    .catch(() => {})
    .finally(() => {
      tuning = null;
      notify('model');
    });
}

async function speedTestNow(onStep?: (msg: string) => void): Promise<{ best: SpeedResult; all: SpeedResult[] }> {
  const model = activeModel();
  if (!model) throw new Error('Install an AI model first.');
  await unloadModel();
  setStatus('busy');
  const configs: SpeedConfig[] =
    Platform.OS === 'android'
      ? [{ threads: 4, gpu: false }, { threads: 6, gpu: false }, { threads: 2, gpu: false }, { threads: 4, gpu: true }]
      : [{ threads: 0, gpu: true }];
  const all: SpeedResult[] = [];
  try {
    for (const [i, cfg] of configs.entries()) {
      onStep?.(`Testing ${i + 1} of ${configs.length}${cfg.gpu ? ' (graphics chip)' : ` (${cfg.threads} cores)`}…`);
      try {
        const r = await benchOnce(model.path, cfg);
        if (cfg.gpu && !r.gpu && Platform.OS === 'android') continue; // GPU not available on this phone
        all.push(r);
      } catch {
        // A configuration this phone cannot run (e.g. GPU driver problem) is simply skipped.
      }
    }
    if (!all.length) throw new Error('The speed test could not run. The phone may be low on memory.');
    const best = all.reduce((a, b) => (b.estimate600 < a.estimate600 ? b : a));
    if (Platform.OS === 'android') {
      setSetting('ai.threads', String(best.threads));
      setSetting('ai.gpu', best.gpu ? '1' : '0');
    }
    setSetting('ai.speed', JSON.stringify(best));
    setSetting('ai.tunedFor', model.info.id);
    return { best, all };
  } finally {
    setStatus('idle');
  }
}

export function lastSpeedResult(): SpeedResult | null {
  try {
    const v = getSetting('ai.speed');
    return v ? (JSON.parse(v) as SpeedResult) : null;
  } catch {
    return null;
  }
}


export type GenerateOptions = {
  maxTokens?: number;
  temperature?: number;
  onToken?: (textSoFar: string) => void;
  /** Constrain the output to JSON matching this schema (grammar-based, so it always parses). */
  jsonSchema?: object;
};

export function generate(messages: ChatMessage[], opts: GenerateOptions = {}): Promise<string> {
  const run = async () => {
    const { ctx, info } = await ensureLoaded();
    setStatus('busy');
    let acc = '';
    try {
      const result = await ctx.completion(
        {
          messages,
          n_predict: opts.maxTokens ?? 700,
          temperature: opts.temperature ?? 0.4,
          top_p: 0.9,
          penalty_repeat: 1.1,
          stop: STOP_WORDS,
          jinja: true,
          // Only pass optional fields when set: some engine builds reject keys whose value is undefined.
          ...(info.disableThinking ? { enable_thinking: false } : {}),
          ...(opts.jsonSchema ? { response_format: { type: 'json_schema' as const, json_schema: { strict: true, schema: opts.jsonSchema } } } : {}),
        },
        (data) => {
          if (!opts.onToken) return;
          acc = data.accumulated_text ?? acc + data.token;
          opts.onToken(cleanOutput(acc));
        },
      );
      return cleanOutput(result.content || result.text);
    } finally {
      setStatus('ready');
    }
  };
  const p = queue.then(run, run);
  queue = p.catch(() => {});
  return p;
}

export async function stopGenerating() {
  await loaded?.ctx.stopCompletion().catch(() => {});
}

/** Free model memory (e.g. after switching models). */
export async function unloadModel() {
  if (loaded) await loaded.ctx.release().catch(() => {});
  loaded = null;
  setStatus('idle');
}

/** Rough token estimate (about 4 characters per token for English). */
export function estimateTokens(text: string) {
  return Math.ceil(text.length / 3.6);
}

function cleanOutput(text: string) {
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/^<think>[\s\S]*$/, '')
    // Small models sometimes echo the fences we put around untrusted text.
    .replace(/<\/?(document|email|data)(\s[^>]*)?>/gi, '')
    .trim();
}
