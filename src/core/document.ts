import { GRID, LIBRARY, compBody, compExtent, isLabelType, rotatePoint } from './library';
import type { CircuitDocument, ComponentInstance, ComponentType, Endpoint, Rotation } from './types';

let counter = 0;
export function newId(prefix = 'id'): string {
  const rnd =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  counter = (counter + 1) % 1e6;
  return `${prefix}_${rnd}${counter.toString(36)}`;
}

export function snap(v: number): number {
  return Math.round(v / GRID) * GRID;
}

export function emptyDocument(name = 'Mạch mới'): CircuitDocument {
  return {
    schemaVersion: 1,
    name,
    revision: 0,
    components: [],
    wires: [],
    junctions: [],
    sim: { analysis: 'op', tranStep: '10u', tranStop: '5m' },
  };
}

export function findComp(doc: CircuitDocument, idOrRef: string): ComponentInstance | undefined {
  return doc.components.find((c) => c.id === idOrRef) ?? doc.components.find((c) => c.ref === idOrRef);
}

export function pinPosition(c: ComponentInstance, pinId: string): { x: number; y: number } | null {
  const def = LIBRARY[c.type];
  const pin = def?.pins.find((p) => p.id === pinId);
  if (!pin) return null;
  const r = rotatePoint(pin.x, pin.y, c.rot);
  return { x: c.x + r.x, y: c.y + r.y };
}

export function endpointPosition(doc: CircuitDocument, e: Endpoint): { x: number; y: number } | null {
  if (e.kind === 'junction') {
    const j = doc.junctions.find((j) => j.id === e.id);
    return j ? { x: j.x, y: j.y } : null;
  }
  const c = doc.components.find((c) => c.id === e.comp);
  return c ? pinPosition(c, e.pin) : null;
}

export function endpointKey(e: Endpoint): string {
  return e.kind === 'pin' ? `c:${e.comp}:${e.pin}` : `j:${e.id}`;
}

export function sameEndpoint(a: Endpoint, b: Endpoint): boolean {
  return endpointKey(a) === endpointKey(b);
}

export function nextRef(doc: CircuitDocument, type: ComponentType): string {
  const prefix = LIBRARY[type].prefix;
  let max = 0;
  for (const c of doc.components) {
    const m = c.ref.match(/^([A-Za-z_]+)(\d+)$/);
    if (m && m[1].toUpperCase() === prefix.toUpperCase()) max = Math.max(max, parseInt(m[2], 10));
  }
  return `${prefix}${max + 1}`;
}

export function makeComponent(
  doc: CircuitDocument,
  type: ComponentType,
  x: number,
  y: number,
  rot: Rotation = 0,
  params?: Record<string, string>,
  ref?: string,
): ComponentInstance {
  return {
    id: newId(type.slice(0, 3)),
    ref: ref ?? nextRef(doc, type),
    type,
    params: { ...LIBRARY[type].defaults, ...(params ?? {}) },
    x: snap(x),
    y: snap(y),
    rot,
  };
}

type P = { x: number; y: number };

/**
 * Polyline trực giao giữa hai điểm. Khi có danh sách vật cản (thân linh kiện, chân khác),
 * chọn hướng gấp (ngang-trước hoặc dọc-trước) cắt ít vật cản nhất. Chỉ là hiển thị;
 * kết nối điện chỉ phụ thuộc endpoint.
 */
export function wireRoute(a: P, b: P, obstacles?: RouteObstacles): P[] {
  if (a.x === b.x || a.y === b.y) return [a, b];
  const h = [a, { x: b.x, y: a.y }, b];
  if (!obstacles) return h;
  const v = [a, { x: a.x, y: b.y }, b];
  return routeCost(v, obstacles) < routeCost(h, obstacles) ? v : h;
}

export interface RouteObstacles { boxes: { x0: number; y0: number; x1: number; y1: number }[]; pins: P[] }

export function buildObstacles(doc: CircuitDocument): RouteObstacles {
  const boxes = doc.components
    .filter((c) => !isLabelType(c.type))
    .map((c) => {
      const b = compBody(c.type);
      const r = c.rot === 90 || c.rot === 270;
      const hw = r ? b.hh : b.hw, hh = r ? b.hw : b.hh;
      return { x0: c.x - hw, y0: c.y - hh, x1: c.x + hw, y1: c.y + hh };
    });
  const pins: P[] = [];
  for (const c of doc.components) for (const p of LIBRARY[c.type].pins) pins.push(pinPosition(c, p.id)!);
  return { boxes, pins };
}

function segHitsBox(p: P, q: P, b: { x0: number; y0: number; x1: number; y1: number }) {
  const minX = Math.min(p.x, q.x), maxX = Math.max(p.x, q.x), minY = Math.min(p.y, q.y), maxY = Math.max(p.y, q.y);
  return maxX > b.x0 && minX < b.x1 && maxY > b.y0 && minY < b.y1;
}

function routeCost(pts: P[], o: RouteObstacles): number {
  let cost = 0;
  const a = pts[0], z = pts[pts.length - 1];
  for (let i = 0; i < pts.length - 1; i++) {
    const p = pts[i], q = pts[i + 1];
    for (const b of o.boxes) if (segHitsBox(p, q, b)) cost += 3;
    for (const pin of o.pins) {
      if ((pin.x === a.x && pin.y === a.y) || (pin.x === z.x && pin.y === z.y)) continue;
      const onH = p.y === q.y && pin.y === p.y && pin.x > Math.min(p.x, q.x) && pin.x < Math.max(p.x, q.x);
      const onV = p.x === q.x && pin.x === p.x && pin.y > Math.min(p.y, q.y) && pin.y < Math.max(p.y, q.y);
      if (onH || onV) cost += 5; // đi qua chân khác dễ gây hiểu nhầm là có nối
    }
  }
  return cost;
}

/** Khung bao của toàn bộ mạch (để fit view, xuất ảnh) */
export function documentBounds(doc: CircuitDocument) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = (x: number, y: number) => {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  };
  for (const c of doc.components) {
    const e = compExtent(c.type);
    const r = c.rot === 90 || c.rot === 270;
    const hw = Math.max(50, (r ? e.hh : e.hw) + 10), hh = Math.max(50, (r ? e.hw : e.hh) + 10);
    add(c.x - hw, c.y - hh); add(c.x + hw, c.y + hh);
  }
  for (const j of doc.junctions) add(j.x, j.y);
  if (!Number.isFinite(minX)) return { minX: -200, minY: -150, maxX: 200, maxY: 150 };
  return { minX, minY, maxX, maxY };
}
