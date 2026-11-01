import { Platform } from 'react-native';
import { initLlama, type LlamaContext } from 'llama.rn';
import { activeModel, type ModelInfo } from './models';
import { notify } from '../db';

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

const STOP_WORDS = ['</s>', '<|end|>', '<|eot_id|>', '<|end_of_text|>', '<|im_end|>', '<|EOT|>', '<|END_OF_TURN_TOKEN|>', '<|end_of_turn|>', '<|endoftext|>', '<end_of_turn>'];

/** Context window. 4096 tokens fits a 3–4B model comfortably in phone RAM. */
export const N_CTX = 4096;

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
      const ctx = await initLlama({
        model: model.path,
        n_ctx: N_CTX,
        n_batch: 512,
        use_mlock: false,
        // Phone CPUs mix fast and slow cores; more threads than fast cores makes every token wait
        // on the slowest thread. 4 matches the performance cores of current Android chips.
        n_threads: Platform.OS === 'android' ? 4 : undefined,
        // Metal on iPhone is reliable; Android stays on CPU for broad device support.
        n_gpu_layers: Platform.OS === 'ios' ? 99 : 0,
      });
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

/** One completion at a time: the model context is single-threaded. */
let queue: Promise<unknown> = Promise.resolve();

export type GenerateOptions = {
  maxTokens?: number;
  temperature?: number;
  onToken?: (textSoFar: string) => void;
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
          enable_thinking: info.disableThinking ? false : undefined,
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
    .trim();
}
