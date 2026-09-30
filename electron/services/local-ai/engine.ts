import type * as NodeLlamaCpp from 'node-llama-cpp';
import type { LocalAIRequest } from '@shared/local-ai';

/**
 * The Local AI engine (DesktopLocalAIService's inside, LAI-DSK): llama.cpp through node-llama-cpp's native
 * binding (in-process libllama, LAI-DSK-004 — no server, no port). Runs in the `ws-local-ai` utility process;
 * this module has no Electron in it, so the tests drive it with a real (tiny) model.
 *
 * One model is loaded at a time. Generation streams text pieces and stops on the request's signal.
 */
type NodeLlama = typeof NodeLlamaCpp;
type Llama = Awaited<ReturnType<NodeLlama['getLlama']>>;
type Model = Awaited<ReturnType<Llama['loadModel']>>;

export interface EngineInfo {
  gpu: string | false;
  vramBytes: number;
  cpuCores: number;
  mmap: boolean;
}

export class LocalAIEngine {
  private lib: NodeLlama | null = null;
  private llama: Llama | null = null;
  private model: Model | null = null;
  private modelPath: string | null = null;
  private busy: Promise<unknown> = Promise.resolve();

  /** Starts llama.cpp: the GPU backend when one works (Metal, CUDA, Vulkan), otherwise the CPU (LAI-DSK-006). */
  async init(opts: { gpu?: 'auto' | false } = {}): Promise<EngineInfo> {
    if (!this.llama) {
      this.lib ??= await import('node-llama-cpp');
      // Prebuilt binaries only: an app never compiles llama.cpp on a person's computer.
      this.llama = await this.lib.getLlama({ gpu: opts.gpu ?? 'auto', build: 'never', logLevel: this.lib.LlamaLogLevel.error, progressLogs: false }).catch(async () =>
        // A GPU backend that will not start falls back to the CPU.
        this.lib!.getLlama({ gpu: false, build: 'never', logLevel: this.lib!.LlamaLogLevel.error, progressLogs: false }),
      );
    }
    const vram = await this.llama.getVramState().catch(() => ({ total: 0 }));
    return { gpu: this.llama.gpu, vramBytes: vram.total, cpuCores: this.llama.cpuMathCores, mmap: this.llama.supportsMmap };
  }

  /** Loads a model (unloading the one before), memory-mapped where the system allows (LAI-DSK-007). */
  async load(path: string): Promise<{ contextLength: number }> {
    if (!this.llama) await this.init();
    if (this.modelPath === path && this.model) return { contextLength: this.model.trainContextSize };
    await this.unload();
    this.model = await this.llama!.loadModel({ modelPath: path, useMmap: this.llama!.supportsMmap, gpuLayers: 'auto' });
    this.modelPath = path;
    return { contextLength: this.model.trainContextSize };
  }

  loaded(): string | null {
    return this.modelPath;
  }

  async unload(): Promise<void> {
    const m = this.model;
    this.model = null;
    this.modelPath = null;
    if (m) await m.dispose();
  }

  /**
   * Answers a chat: the conversation's system text, earlier turns, and the last user message. One request at a
   * time (a second waits its turn); `onChunk` gets the text as it comes; the signal stops it early.
   */
  generate(req: LocalAIRequest, onChunk: (text: string) => void, signal: AbortSignal): Promise<{ text: string; tokens: number; ms: number; cancelled: boolean }> {
    const run = async () => {
      if (!this.model || !this.lib) throw new Error('No model is loaded.');
      const started = Date.now();
      const ctx = await this.model.createContext({ contextSize: { max: Math.min(8192, this.model.trainContextSize) } });
      try {
        const system = req.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
        const turns = req.messages.filter((m) => m.role !== 'system');
        const last = turns.at(-1);
        if (!last || last.role !== 'user') throw new Error('The conversation must end with the question.');
        const session = new this.lib.LlamaChatSession({ contextSequence: ctx.getSequence(), systemPrompt: system || undefined });
        // Earlier turns, as the chat history the model sees.
        const history = session.getChatHistory();
        for (const t of turns.slice(0, -1)) history.push(t.role === 'user' ? { type: 'user', text: t.content } : { type: 'model', response: [t.content] });
        session.setChatHistory(history);
        let text = '';
        let tokens = 0;
        let cancelled = false;
        try {
          await session.prompt(last.content, {
            maxTokens: req.maxTokens ?? 1024,
            temperature: req.temperature ?? 0.6,
            signal,
            stopOnAbortSignal: true,
            onTextChunk: (c) => {
              text += c;
              onChunk(c);
            },
            onToken: (t) => {
              tokens += t.length;
            },
          });
        } catch (e) {
          if (!signal.aborted) throw e;
        }
        cancelled = signal.aborted;
        return { text, tokens, ms: Date.now() - started, cancelled };
      } finally {
        await ctx.dispose();
      }
    };
    const next = this.busy.then(run, run);
    this.busy = next.catch(() => undefined);
    return next;
  }

  async dispose(): Promise<void> {
    await this.unload();
    await this.llama?.dispose();
    this.llama = null;
  }
}
