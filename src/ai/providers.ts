// Adapter AI đa nhà cung cấp. Chạy trong Electron main process (giữ API key ngoài renderer)
// hoặc trực tiếp trong trình duyệt ở chế độ web.
import Anthropic from '@anthropic-ai/sdk';

export type ProviderId = 'anthropic' | 'openai' | 'gemini' | 'ollama' | 'compatible';

export interface ChatMessage { role: 'user' | 'assistant'; content: string }

export interface ChatRequest {
  provider: ProviderId;
  model: string;
  baseUrl?: string;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  system: string;
  messages: ChatMessage[];
  /** Có giá trị trong main process hoặc chế độ web; renderer desktop không gửi key */
  apiKey?: string;
}

export interface Usage { input?: number; output?: number }
export interface ChatResult { text: string; usage: Usage; model: string; elapsedMs: number }
export interface StreamHandlers { onText: (delta: string) => void; onStatus?: (s: string) => void }

export interface ProviderInfo {
  id: ProviderId;
  name: string;
  needsKey: boolean;
  defaultModel: string;
  suggestedModels: string[];
  defaultBaseUrl?: string;
  keyHelp: string;
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  anthropic: {
    id: 'anthropic', name: 'Anthropic Claude', needsKey: true, defaultModel: 'claude-opus-5-5',
    suggestedModels: ['claude-opus-5-5', 'claude-fable-5-1', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
    keyHelp: 'Tạo key tại console.anthropic.com → API Keys',
  },
  openai: {
    id: 'openai', name: 'OpenAI', needsKey: true, defaultModel: 'gpt-5',
    suggestedModels: ['gpt-5', 'gpt-5-mini'], defaultBaseUrl: 'https://api.openai.com/v1',
    keyHelp: 'Tạo key tại platform.openai.com → API keys. Bấm "Tải danh sách" để lấy model mới nhất.',
  },
  gemini: {
    id: 'gemini', name: 'Google Gemini', needsKey: true, defaultModel: 'gemini-2.5-pro',
    suggestedModels: ['gemini-2.5-pro', 'gemini-2.5-flash'], defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    keyHelp: 'Tạo key tại aistudio.google.com → Get API key. Bấm "Tải danh sách" để lấy model mới nhất.',
  },
  ollama: {
    id: 'ollama', name: 'Ollama (cục bộ)', needsKey: false, defaultModel: 'qwen2.5:7b',
    suggestedModels: ['qwen2.5:7b', 'llama3.1:8b'], defaultBaseUrl: 'http://localhost:11434',
    keyHelp: 'Cài Ollama, chạy "ollama pull qwen2.5:7b". Chế độ web cần đặt OLLAMA_ORIGINS=*.',
  },
  compatible: {
    id: 'compatible', name: 'OpenAI-compatible (OpenRouter, DeepSeek, LM Studio…)', needsKey: false, defaultModel: '',
    suggestedModels: [], defaultBaseUrl: 'https://openrouter.ai/api/v1',
    keyHelp: 'Nhập Base URL có đuôi /v1 và key (nếu dịch vụ yêu cầu).',
  },
};

const isClaude5 = (m: string) => /^claude-(opus|sonnet|fable|haiku|mythos)-5/.test(m);
const supportsFallback = (m: string) => /^claude-(opus-5-5|opus-5|fable-5-1|sonnet-5-5)$/.test(m);

async function* sseEvents(res: Response, signal?: AbortSignal): AsyncGenerator<string> {
  if (!res.body) throw new Error('Phản hồi không có body');
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    if (signal?.aborted) { reader.cancel().catch(() => {}); throw new DOMException('Đã huỷ', 'AbortError'); }
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.search(/\r?\n\r?\n/)) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx).replace(/^\r?\n\r?\n/, '');
      const data = chunk.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
      if (data) yield data;
    }
  }
  if (buf.trim().startsWith('data:')) yield buf.trim().slice(5).trimStart();
}

async function httpError(res: Response): Promise<Error> {
  let body = '';
  try { body = await res.text(); } catch { /* bỏ qua */ }
  let msg = body;
  try { const j = JSON.parse(body); msg = j.error?.message ?? j.message ?? body; } catch { /* không phải JSON */ }
  return new Error(`HTTP ${res.status}: ${String(msg).slice(0, 400)}`);
}

async function streamAnthropic(req: ChatRequest, h: StreamHandlers, signal?: AbortSignal): Promise<{ text: string; usage: Usage; model: string }> {
  const client = new Anthropic({ apiKey: req.apiKey, baseURL: req.baseUrl || undefined, dangerouslyAllowBrowser: true });
  const params: Record<string, unknown> = {
    model: req.model,
    max_tokens: 32000,
    system: req.system,
    messages: req.messages,
  };
  if (isClaude5(req.model)) {
    params.thinking = { type: 'adaptive' };
    params.output_config = { effort: req.effort ?? 'high' };
  }
  const run = async (withFallback: boolean) => {
    // Fallback phía server khi bộ lọc an toàn từ chối (khuyến nghị cho Opus 5.5 / Fable 5.1 / Sonnet 5.5)
    if (withFallback) {
      const stream = client.beta.messages.stream({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } as never, { signal });
      stream.on('text', (d: string) => h.onText(d));
      return (await stream.finalMessage()) as unknown as Anthropic.Message;
    }
    const stream = client.messages.stream(params as never, { signal });
    stream.on('text', (d: string) => h.onText(d));
    return stream.finalMessage();
  };
  let msg: Anthropic.Message;
  try {
    msg = await run(supportsFallback(req.model));
  } catch (e) {
    if (e instanceof Anthropic.BadRequestError && /fallback|beta/i.test(e.message)) {
      h.onStatus?.('Tài khoản chưa hỗ trợ fallback, thử lại không dùng fallback…');
      msg = await run(false);
    } else throw e;
  }
  if (msg.stop_reason === 'refusal') throw new Error('Model từ chối yêu cầu này (stop_reason = refusal).');
  const text = msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  return { text, usage: { input: msg.usage.input_tokens, output: msg.usage.output_tokens }, model: msg.model };
}

async function streamOpenAI(req: ChatRequest, h: StreamHandlers, signal?: AbortSignal) {
  const base = (req.baseUrl || PROVIDERS.openai.defaultBaseUrl!).replace(/\/+$/, '');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (req.apiKey) headers.Authorization = `Bearer ${req.apiKey}`;
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST', headers, signal,
    body: JSON.stringify({
      model: req.model,
      stream: true,
      stream_options: req.provider === 'openai' ? { include_usage: true } : undefined,
      messages: [{ role: 'system', content: req.system }, ...req.messages],
    }),
  });
  if (!res.ok) throw await httpError(res);
  let text = '';
  const usage: Usage = {};
  let model = req.model;
  for await (const data of sseEvents(res, signal)) {
    if (data === '[DONE]') break;
    try {
      const j = JSON.parse(data);
      model = j.model ?? model;
      const d = j.choices?.[0]?.delta?.content;
      if (d) { text += d; h.onText(d); }
      if (j.usage) { usage.input = j.usage.prompt_tokens; usage.output = j.usage.completion_tokens; }
    } catch { /* bỏ dòng hỏng */ }
  }
  return { text, usage, model };
}

async function streamGemini(req: ChatRequest, h: StreamHandlers, signal?: AbortSignal) {
  const base = (req.baseUrl || PROVIDERS.gemini.defaultBaseUrl!).replace(/\/+$/, '');
  const res = await fetch(`${base}/models/${encodeURIComponent(req.model)}:streamGenerateContent?alt=sse`, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': req.apiKey ?? '' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: req.system }] },
      contents: req.messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      generationConfig: { responseMimeType: 'application/json' },
    }),
  });
  if (!res.ok) throw await httpError(res);
  let text = '';
  const usage: Usage = {};
  for await (const data of sseEvents(res, signal)) {
    try {
      const j = JSON.parse(data);
      const parts = j.candidates?.[0]?.content?.parts ?? [];
      for (const p of parts) if (p.text && !p.thought) { text += p.text; h.onText(p.text); }
      if (j.usageMetadata) { usage.input = j.usageMetadata.promptTokenCount; usage.output = j.usageMetadata.candidatesTokenCount; }
    } catch { /* bỏ qua */ }
  }
  return { text, usage, model: req.model };
}

async function streamOllama(req: ChatRequest, h: StreamHandlers, signal?: AbortSignal) {
  const base = (req.baseUrl || PROVIDERS.ollama.defaultBaseUrl!).replace(/\/+$/, '');
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: req.model, stream: true, format: 'json', messages: [{ role: 'system', content: req.system }, ...req.messages] }),
  });
  if (!res.ok) throw await httpError(res);
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '', text = '';
  const usage: Usage = {};
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      try {
        const j = JSON.parse(line);
        const d = j.message?.content;
        if (d) { text += d; h.onText(d); }
        if (j.done) { usage.input = j.prompt_eval_count; usage.output = j.eval_count; }
      } catch { /* bỏ qua */ }
    }
  }
  return { text, usage, model: req.model };
}

export async function streamChat(req: ChatRequest, h: StreamHandlers, signal?: AbortSignal): Promise<ChatResult> {
  const t0 = Date.now();
  if (!req.model) throw new Error('Chưa chọn model.');
  if (PROVIDERS[req.provider].needsKey && !req.apiKey) throw new Error(`Chưa nhập API key cho ${PROVIDERS[req.provider].name}.`);
  let r: { text: string; usage: Usage; model: string };
  switch (req.provider) {
    case 'anthropic': r = await streamAnthropic(req, h, signal); break;
    case 'openai': case 'compatible': r = await streamOpenAI(req, h, signal); break;
    case 'gemini': r = await streamGemini(req, h, signal); break;
    case 'ollama': r = await streamOllama(req, h, signal); break;
    default: throw new Error('Nhà cung cấp không hỗ trợ');
  }
  return { ...r, elapsedMs: Date.now() - t0 };
}

export async function listModels(provider: ProviderId, apiKey?: string, baseUrl?: string): Promise<string[]> {
  switch (provider) {
    case 'anthropic': {
      const client = new Anthropic({ apiKey, baseURL: baseUrl || undefined, dangerouslyAllowBrowser: true });
      const ids: string[] = [];
      for await (const m of client.models.list()) ids.push(m.id);
      return ids;
    }
    case 'openai': case 'compatible': {
      const base = (baseUrl || PROVIDERS[provider].defaultBaseUrl!).replace(/\/+$/, '');
      const res = await fetch(`${base}/models`, { headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {} });
      if (!res.ok) throw await httpError(res);
      const j = await res.json();
      return (j.data ?? []).map((m: { id: string }) => m.id).sort();
    }
    case 'gemini': {
      const base = (baseUrl || PROVIDERS.gemini.defaultBaseUrl!).replace(/\/+$/, '');
      const res = await fetch(`${base}/models?pageSize=200`, { headers: { 'x-goog-api-key': apiKey ?? '' } });
      if (!res.ok) throw await httpError(res);
      const j = await res.json();
      return (j.models ?? [])
        .filter((m: { supportedGenerationMethods?: string[] }) => m.supportedGenerationMethods?.includes('generateContent'))
        .map((m: { name: string }) => m.name.replace(/^models\//, ''));
    }
    case 'ollama': {
      const base = (baseUrl || PROVIDERS.ollama.defaultBaseUrl!).replace(/\/+$/, '');
      const res = await fetch(`${base}/api/tags`);
      if (!res.ok) throw await httpError(res);
      const j = await res.json();
      return (j.models ?? []).map((m: { name: string }) => m.name);
    }
  }
}
