// Bộ giải MNA tích hợp: DC (Newton cho diode) và transient (Euler lùi).
// Dùng khi chưa có ngspice. Kết quả ghi rõ nguồn "builtin"; ngspice là tham chiếu chính thức.
import { computeConnectivity } from './connectivity';
import { DIODE_PARAMS, LIBRARY, batteryVoltage, resistiveValue, segmentDiodes } from './library';
import { clockSpec, parseSource, sourceAt, type SourceSpec } from './sources';
import type { CircuitDocument, SimResult } from './types';
import { parseValue } from './units';

const VT = 0.025852; // kT/q ở 27 °C
const GMIN = 1e-12;

type Elem =
  | { k: 'R'; ref: string; a: number; b: number; g: number }
  | { k: 'C'; ref: string; a: number; b: number; c: number; ic?: number }
  | { k: 'L'; ref: string; a: number; b: number; l: number; br: number }
  | { k: 'V'; ref: string; a: number; b: number; src: SourceSpec; br: number }
  | { k: 'I'; ref: string; a: number; b: number; src: SourceSpec }
  | { k: 'D'; ref: string; a: number; b: number; is: number; n: number; rs: number; inner: number }
  | { k: 'E'; ref: string; out: number; outn: number; inp: number; inn: number; gain: number; br: number }
  | { k: 'G'; ref: string; a: number; b: number; inp: number; inn: number; gm: number };

interface Circuit {
  nodeNames: string[]; // index 1..N (0 = ground)
  elems: Elem[];
  size: number;
}

export class SolverError extends Error {}

/** Chân vi điều khiển được lái khi chạy thời gian thực: nguồn v (V) qua điện trở r (Ω). Khoá: "compId:pinId". */
export type PinDrive = Record<string, { v: number; r: number }>;

function build(doc: CircuitDocument, drive?: PinDrive): Circuit {
  const conn = computeConnectivity(doc);
  const nodeIndex = new Map<string, number>([['0', 0]]);
  const nodeNames: string[] = ['0'];
  const idx = (net: string | undefined): number => {
    if (!net) throw new SolverError('Chân chưa được gán net');
    if (!nodeIndex.has(net)) { nodeIndex.set(net, nodeNames.length); nodeNames.push(net); }
    return nodeIndex.get(net)!;
  };
  const nodeOf = (id: string, pin: string) => idx(conn.netOf.get(`c:${id}:${pin}`));
  if (!conn.nets.some((n) => n.isGround)) throw new SolverError('Thiếu ground (node 0).');

  const pending: Array<(base: number) => Elem> = [];
  const elems: Elem[] = [];
  let branches = 0;
  for (const c of doc.components) {
    const def = LIBRARY[c.type];
    if (!def.builtin) throw new SolverError(`${c.ref}: ${def.name} cần ngspice để mô phỏng.`);
    const val = (k: string) => {
      const v = parseValue(c.params[k]);
      if (v === null) throw new SolverError(`${c.ref}: giá trị "${c.params[k]}" không hợp lệ`);
      return v;
    };
    const inner = (tag: string) => { const i = nodeNames.length; nodeNames.push(`${c.ref}#${tag}`); return i; };
    const addV = (ref: string, a: number, bb: number, src: SourceSpec) => { const b = branches++; pending.push((base) => ({ k: 'V', ref, a, b: bb, src, br: base + b })); };
    const addD = (ref: string, a: number, k: number, model: string) => {
      const p = DIODE_PARAMS[model];
      if (!p) throw new SolverError(`${c.ref}: thiếu mô hình ${model}`);
      elems.push({ k: 'D', ref, a, b: k, is: p.IS, n: p.N, rs: p.RS, inner: inner(ref) });
      if (p.BV) {
        // đánh thủng ngược của zener: nhánh diode ngược nối tiếp nguồn áp bù (BV − ~0,75 V)
        const m = inner(`${ref}z`);
        addV(`${ref}#bv`, m, a, { kind: 'dc', dc: p.BV - 0.75 });
        elems.push({ k: 'D', ref: `${ref}#rev`, a: k, b: m, is: 1e-11, n: 1.5, rs: Math.max(p.RS, 0.5), inner: inner(`${ref}r`) });
      }
    };
    const def0 = def.pins[0]?.id, def1 = def.pins[1]?.id;
    switch (c.type) {
      case 'resistor': case 'buzzer': case 'speaker': case 'fuse': case 'lamp': case 'ldr': case 'thermistor': {
        const r = resistiveValue(c.type, c.params, parseValue);
        if (r === null || !(r > 0)) throw new SolverError(`${c.ref}: tham số không hợp lệ`);
        elems.push({ k: 'R', ref: c.ref, a: nodeOf(c.id, def0), b: nodeOf(c.id, def1), g: 1 / r });
        break;
      }
      case 'potentiometer': {
        const r = val('value'), k = Math.min(1, Math.max(0, val('pos')));
        const w = nodeOf(c.id, 'w');
        elems.push({ k: 'R', ref: `${c.ref}#a`, a: nodeOf(c.id, '1'), b: w, g: 1 / Math.max(r * k, 1e-3) });
        elems.push({ k: 'R', ref: `${c.ref}#b`, a: w, b: nodeOf(c.id, '2'), g: 1 / Math.max(r * (1 - k), 1e-3) });
        break;
      }
      case 'switch': elems.push({ k: 'R', ref: c.ref, a: nodeOf(c.id, '1'), b: nodeOf(c.id, '2'), g: c.params.closed === '1' ? 1e3 : 1e-9 }); break;
      case 'pushbutton': elems.push({ k: 'R', ref: c.ref, a: nodeOf(c.id, '1'), b: nodeOf(c.id, '2'), g: c.params.pressed === '1' ? 1e3 : 1e-9 }); break;
      case 'capacitor': case 'capacitor_pol': {
        const ic = c.params.ic?.trim() ? val('ic') : undefined;
        elems.push({ k: 'C', ref: c.ref, a: nodeOf(c.id, def0), b: nodeOf(c.id, def1), c: val('value'), ic });
        break;
      }
      case 'inductor': { const b = branches++; const a = nodeOf(c.id, '1'), bb = nodeOf(c.id, '2'); const l = val('value'); pending.push((base) => ({ k: 'L', ref: c.ref, a, b: bb, l, br: base + b })); break; }
      case 'motor': {
        const m = inner('m'); const a = nodeOf(c.id, 'p'), bb = nodeOf(c.id, 'n');
        elems.push({ k: 'R', ref: c.ref, a, b: m, g: 1 / val('r') });
        const b = branches++; const l = val('l');
        pending.push((base) => ({ k: 'L', ref: `${c.ref}#l`, a: m, b: bb, l, br: base + b }));
        break;
      }
      case 'vsource': {
        const src = parseSource(c.params.value); if (!src) throw new SolverError(`${c.ref}: nguồn không hợp lệ`);
        addV(c.ref, nodeOf(c.id, 'p'), nodeOf(c.id, 'n'), src);
        break;
      }
      case 'clock': {
        const src = clockSpec(c.params); if (!src) throw new SolverError(`${c.ref}: tham số xung không hợp lệ`);
        addV(c.ref, nodeOf(c.id, 'p'), nodeOf(c.id, 'n'), src);
        break;
      }
      case 'battery': {
        const rint = val('rint'), v = batteryVoltage(c.params.kind);
        const p = nodeOf(c.id, 'p'), nn = nodeOf(c.id, 'n');
        if (rint > 0) {
          const m = inner('int');
          addV(c.ref, m, nn, { kind: 'dc', dc: v });
          elems.push({ k: 'R', ref: `${c.ref}#r`, a: p, b: m, g: 1 / rint });
        } else addV(c.ref, p, nn, { kind: 'dc', dc: v });
        break;
      }
      case 'isource': {
        const src = parseSource(c.params.value); if (!src) throw new SolverError(`${c.ref}: nguồn không hợp lệ`);
        elems.push({ k: 'I', ref: c.ref, a: nodeOf(c.id, 'p'), b: nodeOf(c.id, 'n'), src });
        break;
      }
      case 'vcvs': {
        const b = branches++; const out = nodeOf(c.id, 'p'), outn = nodeOf(c.id, 'n'), inp = nodeOf(c.id, 'cp'), inn = nodeOf(c.id, 'cn'); const gain = val('gain');
        pending.push((base) => ({ k: 'E', ref: c.ref, out, outn, inp, inn, gain, br: base + b }));
        break;
      }
      case 'vccs': elems.push({ k: 'G', ref: c.ref, a: nodeOf(c.id, 'p'), b: nodeOf(c.id, 'n'), inp: nodeOf(c.id, 'cp'), inn: nodeOf(c.id, 'cn'), gm: val('gain') }); break;
      case 'diode': case 'led': case 'zener': case 'schottky':
        addD(c.ref, nodeOf(c.id, 'a'), nodeOf(c.id, 'k'), c.params.model);
        break;
      case 'seg7': case 'seg7x4':
        for (const d of segmentDiodes(c.type, c.params.common)) addD(`${c.ref}:${d.key}`, nodeOf(c.id, d.a), nodeOf(c.id, d.k), c.params.model);
        break;
      case 'bridge': {
        const ac1 = nodeOf(c.id, 'ac1'), ac2 = nodeOf(c.id, 'ac2'), p = nodeOf(c.id, 'p'), nn = nodeOf(c.id, 'n');
        addD(`${c.ref}#1`, ac1, p, c.params.model); addD(`${c.ref}#2`, ac2, p, c.params.model);
        addD(`${c.ref}#3`, nn, ac1, c.params.model); addD(`${c.ref}#4`, nn, ac2, c.params.model);
        break;
      }
      case 'opamp': {
        const b = branches++; const out = nodeOf(c.id, 'out'), inp = nodeOf(c.id, 'inp'), inn = nodeOf(c.id, 'inn'); const gain = val('gain');
        pending.push((base) => ({ k: 'E', ref: c.ref, out, outn: 0, inp, inn, gain, br: base + b }));
        break;
      }
      case 'ground': case 'netlabel': case 'power': break;
      default:
        if (def.sim === 'display') {
          // linh kiện chỉ hiển thị: bỏ qua; riêng chân vi điều khiển đang chạy chương trình thì lái bằng nguồn + điện trở
          if (drive) for (const p of def.pins) {
            const d = drive[`${c.id}:${p.id}`];
            if (!d) continue;
            const m = inner(`drv_${p.id}`);
            addV(`${c.ref}#v_${p.id}`, m, 0, { kind: 'dc', dc: d.v });
            elems.push({ k: 'R', ref: `${c.ref}#r_${p.id}`, a: m, b: nodeOf(c.id, p.id), g: 1 / d.r });
          }
          break;
        }
        throw new SolverError(`${c.ref}: ${def.name} cần ngspice.`);
    }
  }
  // các net chỉ chứa nhãn/ground không ảnh hưởng; đảm bảo mọi net có chỉ số
  const byId = new Map(doc.components.map((c) => [c.id, c]));
  for (const n of conn.nets) {
    // bỏ net chỉ gồm chân của linh kiện "chỉ hiển thị" (không có phần tử điện)
    const real = n.keys.some((k) => { const cc = k.startsWith('c:') ? byId.get(k.split(':')[1]) : undefined; return cc && (LIBRARY[cc.type].sim !== 'display' || !!drive?.[`${cc.id}:${k.split(':')[2]}`]); });
    if (n.endpoints.length && real) idx(n.name);
  }
  const N = nodeNames.length - 1;
  for (const p of pending) elems.push(p(N));
  return { nodeNames, elems, size: N + branches };
}

function solveLinear(A: Float64Array[], z: Float64Array): Float64Array {
  const n = z.length;
  for (let col = 0; col < n; col++) {
    let piv = col, best = Math.abs(A[col][col]);
    for (let r = col + 1; r < n; r++) { const v = Math.abs(A[r][col]); if (v > best) { best = v; piv = r; } }
    if (best < 1e-18) throw new SolverError('Ma trận suy biến: có nút thả nổi, vòng nguồn áp hoặc cuộn cảm nối tắt nguồn.');
    if (piv !== col) { [A[piv], A[col]] = [A[col], A[piv]]; const t = z[piv]; z[piv] = z[col]; z[col] = t; }
    const pr = A[col], pv = pr[col];
    for (let r = col + 1; r < n; r++) {
      const f = A[r][col] / pv;
      if (f === 0) continue;
      const row = A[r];
      for (let k = col; k < n; k++) row[k] -= f * pr[k];
      z[r] -= f * z[col];
    }
  }
  const x = new Float64Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let s = z[r];
    for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k];
    x[r] = s / A[r][r];
  }
  return x;
}

interface StepCtx { t: number; h: number | null; prev: Float64Array | null; dc: boolean }

function stamp(ckt: Circuit, x: Float64Array, ctx: StepCtx) {
  const n = ckt.size;
  const A = Array.from({ length: n }, () => new Float64Array(n));
  const z = new Float64Array(n);
  const at = (i: number) => i - 1; // node i (1..N) -> hàng i-1
  const G = (a: number, b: number, g: number) => {
    if (a) A[at(a)][at(a)] += g;
    if (b) A[at(b)][at(b)] += g;
    if (a && b) { A[at(a)][at(b)] -= g; A[at(b)][at(a)] -= g; }
  };
  const I = (a: number, b: number, i: number) => { // dòng i chảy từ a qua phần tử sang b => rút khỏi a
    if (a) z[at(a)] -= i;
    if (b) z[at(b)] += i;
  };
  const v = (i: number) => (i ? x[at(i)] : 0);
  const vp = (i: number) => (i && ctx.prev ? ctx.prev[at(i)] : 0);
  for (let i = 1; i < ckt.nodeNames.length; i++) A[at(i)][at(i)] += GMIN;

  for (const e of ckt.elems) {
    switch (e.k) {
      case 'R': G(e.a, e.b, e.g); break;
      case 'C':
        if (!ctx.dc && ctx.h) { const g = e.c / ctx.h; G(e.a, e.b, g); I(e.a, e.b, -g * (vp(e.a) - vp(e.b))); }
        break;
      case 'I': I(e.a, e.b, sourceAt(e.src, ctx.t)); break;
      case 'V': {
        const row = e.br; // br = chỉ số hàng 0-based của dòng nhánh
        if (e.a) { A[at(e.a)][row] += 1; A[row][at(e.a)] += 1; }
        if (e.b) { A[at(e.b)][row] -= 1; A[row][at(e.b)] -= 1; }
        z[row] += sourceAt(e.src, ctx.t);
        break;
      }
      case 'L': {
        const row = e.br;
        if (e.a) { A[at(e.a)][row] += 1; A[row][at(e.a)] += 1; }
        if (e.b) { A[at(e.b)][row] -= 1; A[row][at(e.b)] -= 1; }
        if (!ctx.dc && ctx.h) { const req = e.l / ctx.h; A[row][row] -= req; z[row] -= req * (ctx.prev ? ctx.prev[row] : 0); }
        break;
      }
      case 'G': {
        // dòng gm·V(inp,inn) chảy từ a qua nguồn sang b
        for (const [node, sign] of [[e.a, 1], [e.b, -1]] as const) {
          if (!node) continue;
          if (e.inp) A[at(node)][at(e.inp)] += sign * e.gm;
          if (e.inn) A[at(node)][at(e.inn)] -= sign * e.gm;
        }
        break;
      }
      case 'E': {
        const row = e.br;
        if (e.out) { A[at(e.out)][row] += 1; A[row][at(e.out)] += 1; }
        if (e.outn) { A[at(e.outn)][row] -= 1; A[row][at(e.outn)] -= 1; }
        if (e.inp) A[row][at(e.inp)] -= e.gain;
        if (e.inn) A[row][at(e.inn)] += e.gain;
        break;
      }
      case 'D': {
        // RS giữa a và nút trong
        G(e.a, e.inner, 1 / Math.max(e.rs, 1e-6));
        const nvt = e.n * VT;
        const vd = v(e.inner) - v(e.b);
        const ex = Math.exp(Math.min(vd / nvt, 80));
        const id = e.is * (ex - 1);
        const gd = (e.is / nvt) * ex + GMIN;
        G(e.inner, e.b, gd);
        I(e.inner, e.b, id - gd * vd);
        break;
      }
    }
  }
  return { A, z };
}

function limitDiodes(ckt: Circuit, xOld: Float64Array, xNew: Float64Array) {
  for (const e of ckt.elems) {
    if (e.k !== 'D') continue;
    const nvt = e.n * VT;
    const vcrit = nvt * Math.log(nvt / (Math.SQRT2 * e.is));
    const get = (arr: Float64Array, i: number) => (i ? arr[i - 1] : 0);
    const vold = get(xOld, e.inner) - get(xOld, e.b);
    let vnew = get(xNew, e.inner) - get(xNew, e.b);
    if (vnew > vcrit && Math.abs(vnew - vold) > 2 * nvt) {
      if (vold > 0) {
        const arg = 1 + (vnew - vold) / nvt;
        vnew = arg > 0 ? vold + nvt * Math.log(arg) : vcrit;
      } else {
        vnew = nvt * Math.log(vnew / nvt);
      }
      // dời nút trong để đạt vnew
      if (e.inner) xNew[e.inner - 1] = get(xNew, e.b) + vnew;
    }
  }
}

function newton(ckt: Circuit, guess: Float64Array, ctx: StepCtx): Float64Array {
  let x = guess;
  const nonlinear = ckt.elems.some((e) => e.k === 'D');
  for (let it = 0; it < 300; it++) {
    const { A, z } = stamp(ckt, x, ctx);
    const xn = solveLinear(A, z);
    if (!nonlinear) return xn;
    limitDiodes(ckt, x, xn);
    let maxd = 0;
    for (let i = 0; i < xn.length; i++) maxd = Math.max(maxd, Math.abs(xn[i] - x[i]) / (1e-3 + Math.abs(xn[i]) * 1e-3));
    x = xn;
    if (maxd < 1 && it > 0) return x;
  }
  throw new SolverError('Không hội tụ sau 300 vòng Newton. Thử ngspice hoặc kiểm tra mạch.');
}

function opResult(ckt: Circuit, x: Float64Array) {
  const nodes: Record<string, number> = {};
  for (let i = 1; i < ckt.nodeNames.length; i++) if (!ckt.nodeNames[i].includes('#')) nodes[ckt.nodeNames[i]] = x[i - 1];
  const currents: Record<string, number> = {};
  const v = (i: number) => (i ? x[i - 1] : 0);
  for (const e of ckt.elems) {
    if (e.ref.includes('#')) continue;
    if (e.k === 'R') currents[e.ref] = (v(e.a) - v(e.b)) * e.g;
    if (e.k === 'V' || e.k === 'L' || e.k === 'E') currents[e.ref] = x[e.br];
    if (e.k === 'D') currents[e.ref] = (v(e.a) - v(e.inner)) / Math.max(e.rs, 1e-6);
  }
  return { nodes, currents };
}

export function simulateBuiltin(doc: CircuitDocument, analysis: 'op' | 'tran', opts: { drive?: PinDrive } = {}): SimResult {
  const t0 = performance.now();
  const log: string[] = [`Bộ giải tích hợp Netlist (MNA${analysis === 'tran' ? ', Euler lùi' : ''})`];
  try {
    const ckt = build(doc, opts.drive);
    log.push(`${ckt.nodeNames.length - 1} nút, ${ckt.elems.length} phần tử, ma trận ${ckt.size}×${ckt.size}`);
    let x = newton(ckt, new Float64Array(ckt.size), { t: 0, h: null, prev: null, dc: true });
    // điều kiện ban đầu tụ (nếu có): ép bằng nguồn áp tạm qua tụ? Đơn giản: dùng điểm làm việc DC.
    const op = opResult(ckt, x);
    if (analysis === 'op') {
      return { source: 'builtin', analysis, revision: doc.revision, ok: true, op, log: log.join('\n'), elapsedMs: performance.now() - t0 };
    }
    const step = parseValue(doc.sim.tranStep) ?? 1e-5;
    const stop = parseValue(doc.sim.tranStop) ?? 5e-3;
    if (step <= 0 || stop <= 0 || stop / step > 200000) throw new SolverError('Thông số transient không hợp lệ (tối đa 200 000 bước).');
    // áp IC tụ: điều chỉnh trạng thái đầu bằng cách chạy bước đầu với tụ thay bằng nguồn áp IC
    const hasIC = ckt.elems.some((e) => e.k === 'C' && e.ic !== undefined);
    if (hasIC) {
      const ckt2: Circuit = { ...ckt, elems: [...ckt.elems] };
      let extra = 0;
      ckt2.elems = ckt.elems.map((e) => {
        if (e.k === 'C' && e.ic !== undefined) {
          const br = ckt.size + extra++;
          return { k: 'V', ref: e.ref, a: e.a, b: e.b, src: { kind: 'dc', dc: e.ic }, br } as Elem;
        }
        return e;
      });
      ckt2.size = ckt.size + extra;
      const x2 = newton(ckt2, new Float64Array(ckt2.size), { t: 0, h: null, prev: null, dc: true });
      x = x2.slice(0, ckt.size);
      log.push('Dùng điện áp ban đầu (IC) của tụ.');
    }
    const time: number[] = [0];
    const names = ckt.nodeNames.slice(1).filter((n) => !n.includes('#'));
    const series: Record<string, number[]> = Object.fromEntries(names.map((n) => [n, [] as number[]]));
    const record = (xx: Float64Array) => {
      for (let i = 1; i < ckt.nodeNames.length; i++) {
        const nm = ckt.nodeNames[i];
        if (!nm.includes('#')) series[nm].push(xx[i - 1]);
      }
    };
    record(x);
    const steps = Math.ceil(stop / step);
    let t = 0;
    for (let s = 1; s <= steps; s++) {
      t = Math.min(stop, s * step);
      x = newton(ckt, x, { t, h: step, prev: x, dc: false });
      time.push(t);
      record(x);
    }
    log.push(`${steps} bước, h = ${step}s`);
    return {
      source: 'builtin', analysis, revision: doc.revision, ok: true, op, tran: { time, series },
      log: log.join('\n'), elapsedMs: performance.now() - t0,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { source: 'builtin', analysis, revision: doc.revision, ok: false, error: msg, log: [...log, 'LỖI: ' + msg].join('\n'), elapsedMs: performance.now() - t0 };
  }
}
