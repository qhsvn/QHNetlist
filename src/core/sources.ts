// Phân tích chuỗi nguồn: "5", "DC 5", "PULSE(v1 v2 td tr tf pw per)", "SIN(vo va f td)"
import { parseValue } from './units';

export type SourceSpec =
  | { kind: 'dc'; dc: number }
  | { kind: 'pulse'; v1: number; v2: number; td: number; tr: number; tf: number; pw: number; per: number }
  | { kind: 'sin'; vo: number; va: number; freq: number; td: number };

export function parseSource(value: string): SourceSpec | null {
  const s = (value ?? '').trim();
  const dcOnly = parseValue(s);
  if (dcOnly !== null) return { kind: 'dc', dc: dcOnly };
  const dc = s.match(/^dc\s+(\S+)$/i);
  if (dc) {
    const v = parseValue(dc[1]);
    return v === null ? null : { kind: 'dc', dc: v };
  }
  const fn = s.match(/^(pulse|sin)\s*\(([^)]*)\)$/i);
  if (!fn) return null;
  const args = fn[2].split(/[\s,]+/).filter(Boolean).map((a) => parseValue(a));
  if (args.some((a) => a === null)) return null;
  const n = args as number[];
  if (fn[1].toLowerCase() === 'pulse') {
    if (n.length < 2) return null;
    const [v1, v2, td = 0, tr = 1e-9, tf = 1e-9, pw = Infinity, per = Infinity] = n;
    return { kind: 'pulse', v1, v2, td, tr: tr || 1e-9, tf: tf || 1e-9, pw, per };
  }
  if (n.length < 3) return null;
  const [vo, va, freq, td = 0] = n;
  return { kind: 'sin', vo, va, freq, td };
}

export function sourceAt(spec: SourceSpec, t: number): number {
  switch (spec.kind) {
    case 'dc': return spec.dc;
    case 'sin': return t < spec.td ? spec.vo : spec.vo + spec.va * Math.sin(2 * Math.PI * spec.freq * (t - spec.td));
    case 'pulse': {
      const { v1, v2, td, tr, tf, pw, per } = spec;
      if (t < td) return v1;
      let tt = t - td;
      if (Number.isFinite(per) && per > 0) tt = tt % per;
      if (tt < tr) return v1 + ((v2 - v1) * tt) / tr;
      if (tt < tr + pw) return v2;
      if (tt < tr + pw + tf) return v2 + ((v1 - v2) * (tt - tr - pw)) / tf;
      return v1;
    }
  }
}

/** Giá trị DC dùng cho điểm làm việc (t = 0) */
export function sourceDC(spec: SourceSpec): number {
  return sourceAt(spec, 0);
}

/** Chuỗi SPICE đã chuẩn hoá từ spec (không ghép chuỗi người dùng). */
export function sourceToSpice(spec: SourceSpec): string {
  const f = (v: number) => (Number.isFinite(v) ? Number(v.toPrecision(12)).toString() : '1e30');
  switch (spec.kind) {
    case 'dc': return `DC ${f(spec.dc)}`;
    case 'sin': return `DC ${f(spec.vo)} SIN(${f(spec.vo)} ${f(spec.va)} ${f(spec.freq)} ${f(spec.td)})`;
    case 'pulse':
      return `DC ${f(spec.v1)} PULSE(${f(spec.v1)} ${f(spec.v2)} ${f(spec.td)} ${f(spec.tr)} ${f(spec.tf)} ${f(spec.pw)} ${f(spec.per)})`;
  }
}

/** Nguồn xung vuông từ tham số clock (freq, high, duty). */
export function clockSpec(params: Record<string, string>): SourceSpec | null {
  const f = parseValue(params.freq ?? ''), hi = parseValue(params.high ?? ''), duty = parseValue(params.duty ?? '0.5');
  if (f === null || hi === null || duty === null || f <= 0 || duty <= 0 || duty >= 1) return null;
  const per = 1 / f, edge = Math.max(1e-9, per / 1000);
  return { kind: 'pulse', v1: 0, v2: hi, td: 0, tr: edge, tf: edge, pw: per * duty - edge, per };
}
