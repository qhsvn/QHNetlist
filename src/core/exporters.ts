import { normalizeDevice } from './device';
import { natCompare } from './connectivity';
import { LIBRARY, isSymbolOnly } from './library';
import type { CircuitDocument } from './types';

function csvCell(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** BOM CSV: gộp theo loại + giá trị */
export function bomCsv(doc: CircuitDocument): string {
  const groups = new Map<string, { refs: string[]; type: string; value: string }>();
  for (const c of doc.components) {
    if (isSymbolOnly(c.type)) continue;
    const def = LIBRARY[c.type];
    const value = c.params.value ?? c.params.model ?? (c.type === 'switch' ? (c.params.closed === '1' ? 'đóng' : 'mở') : '');
    const key = `${c.type}|${value}`;
    if (!groups.has(key)) groups.set(key, { refs: [], type: def.name, value });
    groups.get(key)!.refs.push(c.ref);
  }
  const rows = [['Reference', 'Loại', 'Giá trị', 'Số lượng']];
  const sorted = [...groups.values()].sort((a, b) => natCompare(a.refs.sort(natCompare)[0], b.refs[0]));
  for (const g of sorted) rows.push([g.refs.sort(natCompare).join(' '), g.type, g.value, String(g.refs.length)]);
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function waveformCsv(time: number[], series: Record<string, number[]>): string {
  const names = Object.keys(series);
  const rows = [['time_s', ...names.map((n) => `v(${n})_V`)].join(',')];
  for (let i = 0; i < time.length; i++) rows.push([time[i], ...names.map((n) => series[n][i])].join(','));
  return rows.join('\r\n') + '\r\n';
}

export function serializeProject(doc: CircuitDocument): string {
  return JSON.stringify({ format: 'netlist-project', ...doc }, null, 2);
}

export function parseProject(text: string): CircuitDocument {
  const obj = JSON.parse(text);
  if (obj?.schemaVersion !== 1 || !Array.isArray(obj.components) || !Array.isArray(obj.wires)) {
    throw new Error('Tệp không phải dự án Netlist hợp lệ (schemaVersion 1).');
  }
  for (const c of obj.components) {
    if (!LIBRARY[c.type as keyof typeof LIBRARY]) throw new Error(`Linh kiện không hỗ trợ: ${c.type}`);
  }
  return {
    schemaVersion: 1,
    name: String(obj.name ?? 'Không tên'),
    revision: Number(obj.revision ?? 0),
    components: obj.components,
    wires: obj.wires,
    junctions: Array.isArray(obj.junctions) ? obj.junctions : [],
    sim: { analysis: obj.sim?.analysis === 'tran' ? 'tran' : 'op', tranStep: String(obj.sim?.tranStep ?? '10u'), tranStop: String(obj.sim?.tranStop ?? '5m') },
    ...(obj.device ? (() => { try { return { device: normalizeDevice(obj.device) }; } catch { return {}; } })() : {}),
  };
}
