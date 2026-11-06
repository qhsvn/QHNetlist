// Lớp trừu tượng: Electron (IPC, key mã hoá trong main) hoặc trình duyệt (key trong localStorage).
import { listModels as webListModels, streamChat, type ChatRequest, type ChatResult, type ProviderId, type StreamHandlers } from '../ai/providers';
import type { CircuitDocument, SimResult } from '../core/types';

interface DesktopApi {
  platform: string;
  hasKey(p: string): Promise<boolean>;
  setKey(p: string, k: string): Promise<boolean>;
  listModels(p: string, baseUrl?: string): Promise<string[]>;
  aiStart(id: string, req: unknown, h: (type: string, payload: unknown) => void): void;
  aiCancel(id: string): void;
  aiRelease(id: string): void;
  simStatus(force?: boolean): Promise<NgspiceStatus>;
  simSetPath(p: string): Promise<NgspiceStatus>;
  simBrowse(): Promise<string | null>;
  simRun(doc: CircuitDocument, analysis: string, runId: string): Promise<SimResult>;
  simCancel(runId: string): void;
  saveFile(name: string, content: string, ext: string): Promise<string | null>;
  saveBinary(name: string, base64: string, ext: string): Promise<string | null>;
  openFile(): Promise<{ name: string; content: string } | null>;
  compileArduino?(fqbn: string): Promise<{ ok: boolean; name?: string; hex?: string; log: string } | null>;
}

export interface NgspiceStatus { available: boolean; path: string | null; version?: string; configured: string | null }

declare global { interface Window { netlistDesktop?: DesktopApi } }

const desktop = typeof window !== 'undefined' ? window.netlistDesktop : undefined;
export const isDesktop = !!desktop;

const KEY_PREFIX = 'netlist.key.';

export async function hasKey(p: ProviderId): Promise<boolean> {
  return desktop ? desktop.hasKey(p) : !!localStorage.getItem(KEY_PREFIX + p);
}
export async function setKey(p: ProviderId, key: string): Promise<void> {
  if (desktop) { await desktop.setKey(p, key); return; }
  if (key.trim()) localStorage.setItem(KEY_PREFIX + p, key.trim()); else localStorage.removeItem(KEY_PREFIX + p);
}
export async function fetchModels(p: ProviderId, baseUrl?: string): Promise<string[]> {
  return desktop ? desktop.listModels(p, baseUrl) : webListModels(p, localStorage.getItem(KEY_PREFIX + p) ?? undefined, baseUrl);
}

let seq = 0;
export function aiStream(req: Omit<ChatRequest, 'apiKey'>, h: StreamHandlers): { promise: Promise<ChatResult>; cancel: () => void } {
  if (desktop) {
    const id = `ai${Date.now()}_${seq++}`;
    const promise = new Promise<ChatResult>((resolve, reject) => {
      desktop.aiStart(id, req, (type, payload) => {
        if (type === 'text') h.onText(String(payload));
        else if (type === 'status') h.onStatus?.(String(payload));
        else if (type === 'done') { desktop.aiRelease(id); resolve(payload as ChatResult); }
        else if (type === 'error') { desktop.aiRelease(id); reject(new Error(String(payload))); }
      });
    });
    return { promise, cancel: () => desktop.aiCancel(id) };
  }
  const ctrl = new AbortController();
  const apiKey = localStorage.getItem(KEY_PREFIX + req.provider) ?? undefined;
  return { promise: streamChat({ ...req, apiKey }, h, ctrl.signal), cancel: () => ctrl.abort() };
}

export async function ngspiceStatus(force = false): Promise<NgspiceStatus> {
  return desktop ? desktop.simStatus(force) : { available: false, path: null, configured: null };
}
export const setNgspicePath = (p: string) => desktop!.simSetPath(p);
export const browseNgspice = () => desktop!.simBrowse();
export async function runNgspice(doc: CircuitDocument, analysis: 'op' | 'tran', runId: string): Promise<SimResult | null> {
  return desktop ? desktop.simRun(doc, analysis, runId) : null;
}
export const cancelNgspice = (runId: string) => desktop?.simCancel(runId);

function download(name: string, blob: Blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export async function saveText(name: string, content: string, ext: string, mime = 'text/plain'): Promise<string | null> {
  if (desktop) return desktop.saveFile(name, content, ext);
  download(name, new Blob([content], { type: mime }));
  return name;
}

export async function saveBlob(name: string, blob: Blob, ext: string): Promise<string | null> {
  if (desktop) {
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return desktop.saveBinary(name, btoa(bin), ext);
  }
  download(name, blob);
  return name;
}

export async function openText(): Promise<{ name: string; content: string } | null> {
  if (desktop) return desktop.openFile();
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const f = input.files?.[0];
      resolve(f ? { name: f.name, content: await f.text() } : null);
    };
    input.click();
  });
}

/** Biên dịch .ino bằng arduino-cli (chỉ bản desktop) */
export const canCompileArduino = !!desktop?.compileArduino;
export function compileArduino(fqbn: string) {
  if (!desktop?.compileArduino) return Promise.reject(new Error('Chỉ có trong bản desktop'));
  return desktop.compileArduino(fqbn);
}
