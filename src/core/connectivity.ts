// Đồ thị kết nối: union-find trên endpoint. Dây chéo nhau KHÔNG tự nối; junction là thao tác tường minh.
import { endpointKey } from './document';
import { LIBRARY, isLabelType, isSymbolOnly } from './library';
import type { CircuitDocument, Connectivity, Net } from './types';

class DSU {
  parent = new Map<string, string>();
  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let r = x;
    while (this.parent.get(r) !== r) r = this.parent.get(r)!;
    let c = x;
    while (this.parent.get(c) !== r) {
      const n = this.parent.get(c)!;
      this.parent.set(c, r);
      c = n;
    }
    return r;
  }
  union(a: string, b: string) {
    const ra = this.find(a), rb = this.find(b);
    if (ra !== rb) this.parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
  }
}

export function sanitizeNetName(name: string): string {
  const s = name.trim().replace(/[^A-Za-z0-9_]/g, '_').toLowerCase();
  if (!s) return 'n';
  return /^[a-z_]/.test(s) ? s : `n${s}`;
}

export function computeConnectivity(doc: CircuitDocument): Connectivity {
  const dsu = new DSU();
  const GROUND = '__ground__';
  const labelKey = (name: string) => `label:${sanitizeNetName(name)}`;
  const byId = new Map(doc.components.map((c) => [c.id, c]));

  for (const c of doc.components) {
    for (const p of LIBRARY[c.type].pins) {
      const k = `c:${c.id}:${p.id}`;
      dsu.find(k);
      if (c.type === 'ground') dsu.union(k, GROUND);
      if (isLabelType(c.type) && c.params.name?.trim()) {
        const lk = labelKey(c.params.name);
        const n = sanitizeNetName(c.params.name);
        if (n === 'gnd' || n === '0') dsu.union(k, GROUND);
        else dsu.union(k, lk);
      }
    }
  }
  for (const j of doc.junctions) dsu.find(`j:${j.id}`);
  for (const w of doc.wires) dsu.union(endpointKey(w.a), endpointKey(w.b));

  const groups = new Map<string, string[]>();
  for (const k of dsu.parent.keys()) {
    const r = dsu.find(k);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(k);
  }

  const readable = (k: string): string | null => {
    if (!k.startsWith('c:')) return null;
    const [, id, pin] = k.split(':');
    const c = byId.get(id);
    if (!c || isSymbolOnly(c.type)) return null;
    return `${c.ref}.${pin}`;
  };

  type G = { keys: string[]; endpoints: string[]; isGround: boolean; label?: string };
  const list: G[] = [];
  for (const keys of groups.values()) {
    const real = keys.filter((k) => k.startsWith('c:') || k.startsWith('j:'));
    if (real.length === 0) continue;
    const isGround = keys.includes(GROUND);
    const lbl = keys.find((k) => k.startsWith('label:'));
    const endpoints = real.map(readable).filter((x): x is string => !!x).sort(natCompare);
    list.push({ keys: real, endpoints, isGround, label: lbl?.slice(6) });
  }
  // thứ tự xác định: theo endpoint đầu tiên
  list.sort((a, b) => natCompare(a.endpoints[0] ?? a.keys[0], b.endpoints[0] ?? b.keys[0]));

  const used = new Set<string>(['0']);
  const nets: Net[] = [];
  let auto = 1;
  for (const g of list) {
    let name: string;
    if (g.isGround) name = '0';
    else if (g.label && !used.has(g.label)) name = g.label;
    else {
      do name = `n${String(auto++).padStart(3, '0')}`; while (used.has(name));
    }
    used.add(name);
    nets.push({ name, isGround: g.isGround, endpoints: g.endpoints, keys: g.keys.sort() });
  }
  const netOf = new Map<string, string>();
  for (const n of nets) for (const k of n.keys) netOf.set(k, n.name);
  return { nets, netOf };
}

export function natCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

/** Tên net của chân "R1.2" */
export function netOfPin(doc: CircuitDocument, conn: Connectivity, compId: string, pin: string): string | undefined {
  return conn.netOf.get(`c:${compId}:${pin}`);
}
