// Store tối giản (useSyncExternalStore) với undo/redo dựa trên snapshot document.
import { useSyncExternalStore } from 'react';
import { sanitize } from '../core/commands';
import { emptyDocument } from '../core/document';
import { runChecks } from '../core/erc';
import type { LiveFrame } from '../sim/live';
import { FIXTURES } from '../core/fixtures';
import type { DesignProposal, PatchStep } from '../core/patch';
import type { CircuitDocument, ComponentType, Issue, Rotation, SimResult } from '../core/types';
import { PROVIDERS, type ChatMessage, type ProviderId } from '../ai/providers';
import { parseProject } from '../core/exporters';

export type Selection = { kind: 'comp' | 'wire' | 'junction'; id: string } | null;
export type Tool = { kind: 'select' } | { kind: 'wire' } | { kind: 'place'; type: ComponentType; rot: Rotation };

export type LogKind = 'user' | 'ai' | 'code' | 'ok' | 'err' | 'info' | 'model' | 'explain';
export interface LogLine { id: number; t: number; kind: LogKind; text: string; tag?: string }

export interface AISettings {
  provider: ProviderId;
  models: Record<ProviderId, string>;
  baseUrls: Partial<Record<ProviderId, string>>;
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
}

export interface BuildState {
  steps: PatchStep[];
  index: number; // số bước đã dựng
  base: CircuitDocument;
  final: CircuitDocument;
  title: string;
}

export interface PendingProposal {
  proposal: DesignProposal;
  steps: PatchStep[] | null;
  error: string | null;
}

export interface State {
  doc: CircuitDocument;
  past: CircuitDocument[];
  future: CircuitDocument[];
  savedRevision: number;
  filePath: string | null;
  selection: Selection;
  tool: Tool;
  result: SimResult | null;
  simRunning: boolean;
  issues: Issue[];
  bottomTab: 'netlist' | 'results' | 'erc' | 'log' | 'serial';
  /** khung hình chạy thời gian thực (null = không chạy) */
  live: LiveFrame | null;
  view: '2d' | '3d' | 'split' | 'device';
  // AI
  ai: AISettings;
  chat: ChatMessage[];
  log: LogLine[];
  streamText: string;
  busy: boolean;
  pending: PendingProposal | null;
  build: BuildState | null;
  highlight: string[]; // ref vừa được AI đặt
  tokens: { input: number; output: number; requests: number; lastLatencyMs: number; live: number };
  settingsOpen: boolean;
  toast: string | null;
}

const sessionStart = Date.now();
let logSeq = 0;

function loadAI(): AISettings {
  const def: AISettings = {
    provider: 'anthropic',
    models: Object.fromEntries(Object.values(PROVIDERS).map((p) => [p.id, p.defaultModel])) as Record<ProviderId, string>,
    baseUrls: {},
    effort: 'high',
  };
  try {
    const s = JSON.parse(localStorage.getItem('netlist.ai') ?? 'null');
    if (s) return { ...def, ...s, models: { ...def.models, ...s.models } };
  } catch { /* mặc định */ }
  return def;
}

function loadDraft(): CircuitDocument {
  try {
    const s = localStorage.getItem('netlist.draft');
    if (s) return parseProject(s);
  } catch { /* bản nháp hỏng: bỏ qua */ }
  return FIXTURES.divider.make();
}

const initialDoc = loadDraft();

let state: State = {
  doc: initialDoc,
  past: [],
  future: [],
  savedRevision: initialDoc.revision,
  filePath: null,
  selection: null,
  tool: { kind: 'select' },
  result: null,
  simRunning: false,
  issues: runChecks(initialDoc),
  bottomTab: 'results',
  live: null,
  view: (localStorage.getItem('netlist.view') as State['view']) || 'split',
  ai: loadAI(),
  chat: [],
  log: [],
  streamText: '',
  busy: false,
  pending: null,
  build: null,
  highlight: [],
  tokens: { input: 0, output: 0, requests: 0, lastLatencyMs: 0, live: 0 },
  settingsOpen: false,
  toast: null,
};

const listeners = new Set<() => void>();
export function getState() { return state; }
export function setState(patch: Partial<State> | ((s: State) => Partial<State>)) {
  const p = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...p };
  if ('doc' in p || 'result' in p) state.issues = runChecks(state.doc, state.result);
  if ('view' in p) localStorage.setItem('netlist.view', state.view);
  if ('ai' in p) localStorage.setItem('netlist.ai', JSON.stringify(state.ai));
  listeners.forEach((l) => l());
}
export function subscribe(l: () => void) { listeners.add(l); return () => listeners.delete(l); }
export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => sel(state));
}

let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleAutosave() {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    try { localStorage.setItem('netlist.draft', JSON.stringify(state.doc)); } catch { /* đầy bộ nhớ */ }
  }, 400);
}

/** Ghi một mục lịch sử. `from` cho phép gộp một thao tác kéo dài thành một mục. */
export function commit(next: CircuitDocument, from?: CircuitDocument) {
  const base = from ?? state.doc;
  const clean = sanitize(next);
  const doc = { ...clean, revision: Math.max(base.revision, state.doc.revision) + 1 };
  setState({ doc, past: [...state.past.slice(-199), base], future: [] });
  scheduleAutosave();
}

/** Cập nhật tạm (khi đang kéo) — không tạo lịch sử. */
export function preview(next: CircuitDocument) {
  setState({ doc: next });
}

export function undo() {
  const prev = state.past[state.past.length - 1];
  if (!prev || state.build) return;
  setState({ doc: { ...prev, revision: state.doc.revision + 1 }, past: state.past.slice(0, -1), future: [state.doc, ...state.future], selection: null });
  scheduleAutosave();
}
export function redo() {
  const next = state.future[0];
  if (!next || state.build) return;
  setState({ doc: { ...next, revision: state.doc.revision + 1 }, future: state.future.slice(1), past: [...state.past, state.doc], selection: null });
  scheduleAutosave();
}

export function loadDocument(doc: CircuitDocument, filePath: string | null = null) {
  setState({ doc, past: [], future: [], selection: null, result: null, savedRevision: doc.revision, filePath });
  scheduleAutosave();
}
export function newDocument() {
  commit(emptyDocument());
  setState({ result: null, filePath: null });
}

export function log(kind: LogKind, text: string, tag?: string) {
  const line: LogLine = { id: logSeq++, t: (Date.now() - sessionStart) / 1000, kind, text, tag };
  setState((s) => ({ log: [...s.log.slice(-1500), line] }));
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;
export function toast(msg: string) {
  if (toastTimer) clearTimeout(toastTimer);
  setState({ toast: msg });
  toastTimer = setTimeout(() => setState({ toast: null }), 3500);
}
