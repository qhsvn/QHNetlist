// Phân tích và định dạng giá trị SI. "4.7k" -> 4700, "10u" -> 1e-5, "1meg" -> 1e6, "2k2" -> 2200

const PREFIX: Record<string, number> = {
  f: 1e-15, p: 1e-12, n: 1e-9, u: 1e-6, 'µ': 1e-6, m: 1e-3,
  k: 1e3, meg: 1e6, g: 1e9, t: 1e12,
};

export function parseValue(input: string | number | undefined): number | null {
  if (input === undefined || input === null) return null;
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  let s = String(input).trim().toLowerCase().replace(',', '.');
  if (!s) return null;
  // bỏ đơn vị đuôi: ohm, Ω, Hz, F (sau tiền tố), V, A, H, s
  s = s.replace(/\s+/g, '').replace(/(ohms?|Ω|hz)$/, '');
  if (/[pnuµm]f$/.test(s)) s = s.slice(0, -1);
  if (/(\d|\.|[fpnuµmkgt])[vahs]$/.test(s)) s = s.slice(0, -1);
  // ký hiệu kiểu "2k2", "4u7"
  const rkm = s.match(/^(\d+)(meg|[fpnuµmkgt])(\d+)$/);
  if (rkm) {
    const mult = PREFIX[rkm[2]];
    return parseFloat(`${rkm[1]}.${rkm[3]}`) * mult;
  }
  const m = s.match(/^([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)\s*(meg|[fpnuµmkgt])?$/);
  if (!m) return null;
  const base = parseFloat(m[1]);
  if (!Number.isFinite(base)) return null;
  return m[2] ? base * PREFIX[m[2]] : base;
}

/** Định dạng số theo kỹ thuật: 0.0025 -> "2.5m" */
export function formatSI(v: number, unit = '', digits = 3): string {
  if (!Number.isFinite(v)) return 'NaN';
  if (v === 0) return `0 ${unit}`.trim();
  const abs = Math.abs(v);
  const table: [number, string][] = [
    [1e12, 'T'], [1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''],
    [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p'], [1e-15, 'f'],
  ];
  for (const [mult, sym] of table) {
    if (abs >= mult * 0.9995) {
      const n = v / mult;
      return `${parseFloat(n.toPrecision(digits))} ${sym}${unit}`.trim();
    }
  }
  return `${v.toExponential(2)} ${unit}`.trim();
}

/** Chuyển một giá trị người dùng sang chuỗi số SPICE an toàn (không ghép chuỗi tuỳ ý). */
export function toSpiceNumber(input: string): string | null {
  const v = parseValue(input);
  if (v === null) return null;
  return Number(v.toPrecision(12)).toString();
}
