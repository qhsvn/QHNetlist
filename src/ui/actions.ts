// Hành động cấp ứng dụng: mô phỏng, AI, dựng mạch từng bước, lưu/mở/xuất.
import { buildContext, buildSystemPrompt } from '../ai/prompt';
import { PROVIDERS } from '../ai/providers';
import { bomCsv, parseProject, serializeProject, waveformCsv } from '../core/exporters';
import { applyOperations, opToCode, parseProposal } from '../core/patch';
import { simulateBuiltin } from '../core/solver';
import { compileSpice } from '../core/spice';
import { formatSI } from '../core/units';
import type { SimResult } from '../core/types';
import { aiStream, openText, runNgspice, saveBlob, saveText } from './bridge';
import { commit, getState, loadDocument, log, preview, setState, subscribe, toast } from './store';
import { LiveSession } from '../sim/live';
import { updateComponent } from '../core/commands';
import { parseIntelHex } from '../sim/hex';

// ---------------- Mô phỏng ----------------
export async function simulate(analysis?: 'op' | 'tran') {
  const s = getState();
  if (s.simRunning || s.build) return;
  const doc = s.doc;
  const a = analysis ?? doc.sim.analysis;
  const errors = s.issues.filter((i) => i.severity === 'error');
  if (errors.length) {
    setState({ bottomTab: 'erc' });
    toast(`Còn ${errors.length} lỗi kiểm tra — sửa trước khi chạy`);
    return;
  }
  setState({ simRunning: true });
  log('info', `sim.run(${a}) · revision ${doc.revision}`, 'SIM');
  let result: SimResult | null = await runNgspice(doc, a, `run${Date.now()}`).catch((e): SimResult => ({
    source: 'ngspice', analysis: a, revision: doc.revision, ok: false, error: String(e), log: '', elapsedMs: 0,
  }));
  if (!result || result.error === 'NGSPICE_NOT_FOUND') {
    result = simulateBuiltin(doc, a);
    result.log = (result.log ?? '') + '\n(ngspice chưa được cấu hình — dùng bộ giải tích hợp)';
  }
  setState({ result, simRunning: false, bottomTab: 'results' });
  if (result.ok) {
    const nodes = Object.entries(result.op?.nodes ?? {}).slice(0, 6).map(([k, v]) => `${k}=${formatSI(v, 'V')}`).join('  ');
    log('ok', `${result.source} · ${a} · ${result.elapsedMs.toFixed(0)} ms  ${nodes}`, 'SIM');
  } else {
    log('err', `${result.source}: ${result.error}`, 'SIM');
  }
}

// ---------------- AI ----------------
let activeCancel: (() => void) | null = null;

export function cancelAI() {
  activeCancel?.();
}

export async function sendToAI(userText: string) {
  const s = getState();
  if (s.busy || !userText.trim()) return;
  const { provider, models, baseUrls, effort } = s.ai;
  const model = models[provider];
  const doc = s.doc;
  const selected = s.selection?.kind === 'comp' ? doc.components.find((c) => c.id === s.selection!.id)?.ref : undefined;
  const context = buildContext(doc, s.result, s.issues, selected);
  const content = `${context}\n\n## YÊU CẦU\n${userText.trim()}`;
  const messages = [...s.chat, { role: 'user' as const, content }];
  setState({ busy: true, streamText: '', pending: null, tokens: { ...s.tokens, live: 0 } });
  log('user', userText.trim(), 'YOU');
  log('model', `${PROVIDERS[provider].name} · ${model}${provider === 'anthropic' ? ` · effort ${effort}` : ''}`, 'AI');

  const { promise, cancel } = aiStream(
    { provider, model, baseUrl: baseUrls[provider], effort, system: buildSystemPrompt(), messages },
    {
      onText: (d) => setState((st) => ({ streamText: st.streamText + d, tokens: { ...st.tokens, live: Math.round((st.streamText.length + d.length) / 3.6) } })),
      onStatus: (m) => log('info', m, 'AI'),
    },
  );
  activeCancel = cancel;
  try {
    const r = await promise;
    const proposal = parseProposal(r.text, doc.revision);
    setState((st) => ({
      chat: [...st.chat, { role: 'user' as const, content: userText.trim() }, { role: 'assistant' as const, content: r.text }].slice(-16),
      streamText: '',
      tokens: {
        input: st.tokens.input + (r.usage.input ?? 0),
        output: st.tokens.output + (r.usage.output ?? Math.round(r.text.length / 3.6)),
        requests: st.tokens.requests + 1,
        lastLatencyMs: r.elapsedMs,
        live: 0,
      },
    }));
    log('ai', `${r.model} · ${(r.usage.output ?? 0).toLocaleString('vi-VN')} tok · ${(r.elapsedMs / 1000).toFixed(1)} s`, 'AI');
    if (proposal.explanation) log('explain', proposal.explanation);
    for (const a of proposal.assumptions) log('info', `giả định: ${a}`);
    if (proposal.operations.length) {
      let steps = null, error = null;
      try { steps = applyOperations(getState().doc, proposal.operations).steps; } catch (e) { error = e instanceof Error ? e.message : String(e); }
      proposal.operations.forEach((op, i) => log('code', `${opToCode(op)}  # ${i + 1}`));
      if (error) log('err', `Patch không hợp lệ: ${error}`, 'CHK');
      else log('info', `Patch hợp lệ: ${proposal.operations.length} thao tác — chờ bạn duyệt`, 'CHK');
      setState({ pending: { proposal, steps, error } });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log('err', msg, 'AI');
    setState({ streamText: '' });
  } finally {
    activeCancel = null;
    setState({ busy: false });
  }
}

export function rejectProposal() {
  if (!getState().pending) return;
  log('info', 'Đã từ chối patch. Mạch giữ nguyên.', 'CHK');
  setState({ pending: null });
}

export function askAIToFix() {
  const p = getState().pending;
  if (!p?.error) return;
  setState({ pending: null });
  sendToAI(`Patch trước bị từ chối khi kiểm tra: ${p.error}. Hãy sửa và gửi lại patch đầy đủ.`);
}

let buildTimer: ReturnType<typeof setInterval> | null = null;

/** Dựng mạch từng bước để người dùng quan sát. Cuối cùng commit nguyên tử một mục lịch sử. */
export function approveProposal(speedMs = 380) {
  const s = getState();
  const p = s.pending;
  if (!p || !p.steps || s.build) return;
  if (p.proposal.baseRevision !== s.doc.revision) {
    // mạch đã thay đổi: kiểm tra lại trên revision mới, có thông báo
    try {
      const re = applyOperations(s.doc, p.proposal.operations);
      p.steps = re.steps;
      log('info', `Mạch đã đổi (rev ${p.proposal.baseRevision} → ${s.doc.revision}); patch vẫn hợp lệ trên bản mới.`, 'CHK');
    } catch (e) {
      log('err', `Patch lệch revision và không còn hợp lệ: ${e instanceof Error ? e.message : e}`, 'CHK');
      setState({ pending: { ...p, steps: null, error: String(e) } });
      return;
    }
  }
  const base = s.doc;
  const final = p.steps[p.steps.length - 1].doc;
  setState({ pending: null, build: { steps: p.steps, index: 0, base, final, title: p.proposal.explanation.split('\n')[0].slice(0, 80) }, selection: null, tool: { kind: 'select' } });
  log('info', `ASSEMBLING · ${p.steps.length} thao tác`, 'BUILD');
  const tick = () => {
    const b = getState().build;
    if (!b) return;
    if (b.index >= b.steps.length) { finishBuild(); return; }
    const step = b.steps[b.index];
    preview({ ...step.doc, revision: b.base.revision });
    setState({ build: { ...b, index: b.index + 1 }, highlight: step.focusRef ? [step.focusRef] : [] });
    log('ok', `${step.label}`, `${b.index + 1}/${b.steps.length}`);
    // AI vừa dựng thiết bị 3D: mở tab Thiết bị để người dùng xem
    if (step.op.op === 'set_device' && getState().view !== 'device') setState({ view: 'device' });
  };
  tick();
  buildTimer = setInterval(tick, speedMs);
}

export function finishBuild() {
  const b = getState().build;
  if (buildTimer) { clearInterval(buildTimer); buildTimer = null; }
  if (!b) return;
  setState({ build: null, highlight: [] });
  commit(b.final, b.base);
  log('ok', `Hoàn tất dựng mạch · revision ${getState().doc.revision} · Ctrl+Z để hoàn tác toàn bộ`, 'BUILD');
  const errs = getState().issues.filter((i) => i.severity === 'error');
  if (errs.length) log('err', `ERC: ${errs.length} lỗi — xem tab Kiểm tra`, 'ERC');
}

// ---------------- Tệp ----------------
export async function saveProject() {
  const s = getState();
  const name = `${s.doc.name.replace(/[^\p{L}\p{N}_ -]/gu, '').trim() || 'mach'}.netlist.json`;
  const path = await saveText(name, serializeProject(s.doc), 'json', 'application/json');
  if (path) { setState({ savedRevision: s.doc.revision, filePath: path }); toast(`Đã lưu ${path}`); }
}

export async function openProject() {
  try {
    const f = await openText();
    if (!f) return;
    loadDocument(parseProject(f.content), f.name);
    toast(`Đã mở ${f.name}`);
  } catch (e) {
    toast(`Không mở được: ${e instanceof Error ? e.message : e}`);
  }
}

export async function exportSpice() {
  const doc = getState().doc;
  const c = compileSpice(doc);
  if (c.errors.length) toast(`Cảnh báo: ${c.errors[0]}`);
  await saveText(`${doc.name || 'mach'}.cir`, c.text, 'cir');
}

export async function exportBom() {
  const doc = getState().doc;
  await saveText(`${doc.name || 'mach'}-BOM.csv`, '﻿' + bomCsv(doc), 'csv', 'text/csv');
}

export async function exportWaveform() {
  const r = getState().result;
  if (!r?.tran) { toast('Chưa có dữ liệu transient'); return; }
  await saveText('waveform.csv', `# source=${r.source} revision=${r.revision}\r\n` + waveformCsv(r.tran.time, r.tran.series), 'csv', 'text/csv');
}

export async function exportImage(kind: 'svg' | 'png') {
  const svg = document.querySelector<SVGSVGElement>('#schematic-svg');
  if (!svg) return;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.querySelectorAll('[data-noexport]').forEach((n) => n.remove());
  const vp = clone.querySelector('#viewport') as SVGGElement | null;
  const content = svg.querySelector('#content') as SVGGElement | null;
  const bb = content?.getBBox() ?? { x: -200, y: -200, width: 400, height: 400 };
  const pad = 40;
  vp?.setAttribute('transform', '');
  clone.setAttribute('viewBox', `${bb.x - pad} ${bb.y - pad} ${bb.width + pad * 2} ${bb.height + pad * 2}`);
  clone.setAttribute('width', String(Math.round(bb.width + pad * 2)));
  clone.setAttribute('height', String(Math.round(bb.height + pad * 2)));
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  bg.setAttribute('x', String(bb.x - pad)); bg.setAttribute('y', String(bb.y - pad));
  bg.setAttribute('width', String(bb.width + pad * 2)); bg.setAttribute('height', String(bb.height + pad * 2));
  bg.setAttribute('fill', '#fbfaf7');
  clone.insertBefore(bg, clone.firstChild);
  const text = new XMLSerializer().serializeToString(clone);
  const name = getState().doc.name || 'mach';
  if (kind === 'svg') { await saveText(`${name}.svg`, text, 'svg', 'image/svg+xml'); return; }
  const img = new Image();
  const scale = 2;
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(text);
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = img.width * scale; canvas.height = img.height * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0);
  const blob = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), 'image/png'));
  await saveBlob(`${name}.png`, blob, 'png');
}

export async function exportGlb() {
  const { exportGLB } = await import('./View3D');
  const blob = await exportGLB();
  if (!blob) { toast('Mở khung 3D trước khi xuất GLB'); return; }
  await saveBlob(`${getState().doc.name || 'mach'}.glb`, blob, 'glb');
}

// ---------------- Chạy thời gian thực (vi điều khiển + hiển thị) ----------------
let live: LiveSession | null = null;
let liveDoc: unknown = null;
let lastNoteKey = '';

export function startLive() {
  stopLive(true);
  const doc = getState().doc;
  try {
    live = new LiveSession(doc, (f) => {
      const key = [...f.notes, f.error ?? ''].join('|');
      if (key !== lastNoteKey) {
        lastNoteKey = key;
        for (const n of f.notes) log('err', n, 'LIVE');
        if (f.error) log('err', f.error, 'LIVE');
      }
      setState({ live: f });
    });
  } catch (e) {
    toast(`Không chạy được: ${(e as Error).message}`);
    log('err', (e as Error).message, 'LIVE');
    return;
  }
  liveDoc = doc;
  lastNoteKey = '';
  const mcu = doc.components.find((c) => (c.type === 'arduino_nano' || c.type === 'atmega328p') && c.params.firmware);
  log('ok', mcu ? `▶ ${mcu.ref} chạy ${mcu.params.firmwareName || 'chương trình'} ở 16 MHz — bấm nút nhấn trên sơ đồ để tương tác` : '▶ chạy thời gian thực (không có vi điều khiển có chương trình): bấm nút nhấn để thử mạch', 'LIVE');
  setState({ selection: null, tool: { kind: 'select' } });
  live.start();
}

export function stopLive(silent = false) {
  if (!live) return;
  live.stop();
  live = null;
  liveDoc = null;
  setState({ live: null });
  if (!silent) log('info', '■ dừng chạy thời gian thực', 'LIVE');
}

export function livePress(compId: string, down: boolean) { live?.press(compId, down); }

// sửa mạch khi đang chạy → dừng để tránh hiển thị sai
subscribe(() => {
  if (live && liveDoc && getState().doc !== liveDoc) { stopLive(); toast('Mạch đã thay đổi — đã dừng chạy thời gian thực'); }
});

/** Nạp chương trình .hex cho vi điều khiển */
export function loadFirmware(compId: string, name: string, text: string) {
  try {
    const mem = parseIntelHex(text);
    let used = mem.length; while (used > 0 && mem[used - 1] === 0) used--;
    commit(updateComponent(getState().doc, compId, { params: { firmware: text.trim(), firmwareName: name } }));
    log('ok', `nạp ${name}: ${used} byte flash`, 'MCU');
    toast(`Đã nạp ${name} (${used} byte)`);
  } catch (e) {
    toast(`File không hợp lệ: ${(e as Error).message}`);
  }
}
