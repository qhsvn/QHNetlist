// Thiết bị 3D minh hoạ: kiểm tra dữ liệu (AI có thể gửi sai) và tính mức chuyển động từ kết quả mạch.
import { computeConnectivity } from './connectivity';
import { findComp } from './document';
import { LIBRARY, resistiveValue } from './library';
import type {
  CircuitDocument, DeviceBinding, DeviceModel, DeviceMotion, DevicePart, DeviceQuantity, DeviceShape, DeviceMaterial, SimResult,
} from './types';
import { parseValue } from './units';

export const DEVICE_SHAPES: DeviceShape[] = ['box', 'cylinder', 'sphere', 'cone', 'torus', 'capsule', 'wheel'];
export const DEVICE_MATERIALS: DeviceMaterial[] = ['plastic', 'paint', 'metal', 'chrome', 'rubber', 'glass', 'light'];
const MOTIONS: DeviceMotion['type'][] = ['spin', 'slide', 'swing', 'glow', 'shake'];
const QUANTITIES: DeviceQuantity[] = ['current', 'voltage', 'power'];
const SIZE_LEN: Record<DeviceShape, number> = { box: 3, cylinder: 2, sphere: 1, cone: 2, torus: 2, capsule: 2, wheel: 2 };
export const MAX_DEVICE_PARTS = 400;

const num = (v: unknown, what: string, min = -1e3, max = 1e3): number => {
  const x = typeof v === 'string' ? Number(v) : v;
  if (typeof x !== 'number' || !Number.isFinite(x)) throw new Error(`${what} phải là số`);
  if (x < min || x > max) throw new Error(`${what} = ${x} ngoài khoảng ${min}…${max}`);
  return x;
};
const vec3 = (v: unknown, what: string): [number, number, number] => {
  if (!Array.isArray(v) || v.length !== 3) throw new Error(`${what} phải là mảng [x, y, z]`);
  return [num(v[0], what), num(v[1], what), num(v[2], what)];
};
const colorOk = (c: unknown) => typeof c === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c);

function binding(raw: Record<string, unknown>, where: string): DeviceBinding {
  const ref = String(raw.ref ?? '').trim();
  if (!ref) throw new Error(`${where}: thiếu "ref" (linh kiện điều khiển chuyển động)`);
  const out: DeviceBinding = { ref };
  if (raw.quantity !== undefined) {
    if (!QUANTITIES.includes(raw.quantity as DeviceQuantity)) throw new Error(`${where}: quantity phải là ${QUANTITIES.join(' | ')}`);
    out.quantity = raw.quantity as DeviceQuantity;
  }
  if (raw.max !== undefined) out.max = num(raw.max, `${where}.max`, 1e-9, 1e9);
  return out;
}

/** Kiểm tra và chuẩn hoá thiết bị (ném lỗi tiếng Việt nếu sai). Không kiểm tra ref có trong mạch: xem checkDeviceRefs. */
export function normalizeDevice(raw: unknown): DeviceModel {
  if (!raw || typeof raw !== 'object') throw new Error('device phải là đối tượng');
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.parts) || r.parts.length === 0) throw new Error('device.parts phải là mảng khối, ít nhất 1 khối');
  if (r.parts.length > MAX_DEVICE_PARTS) throw new Error(`tối đa ${MAX_DEVICE_PARTS} khối`);
  const ids = new Set<string>();
  const parts: DevicePart[] = r.parts.map((pr: unknown, i: number) => {
    if (!pr || typeof pr !== 'object') throw new Error(`khối #${i + 1} không hợp lệ`);
    const p = pr as Record<string, unknown>;
    const id = String(p.id ?? `p${i + 1}`).trim();
    const where = `khối "${id}"`;
    if (!/^[\w.-]{1,40}$/.test(id)) throw new Error(`${where}: id chỉ gồm chữ, số, _ . -`);
    if (ids.has(id)) throw new Error(`${where}: id bị trùng`);
    ids.add(id);
    const shape = p.shape as DeviceShape;
    if (!DEVICE_SHAPES.includes(shape)) throw new Error(`${where}: shape phải là ${DEVICE_SHAPES.join(' | ')}`);
    if (!Array.isArray(p.size) || p.size.length < SIZE_LEN[shape]) throw new Error(`${where}: size của ${shape} cần ${SIZE_LEN[shape]} số`);
    const size = p.size.slice(0, SIZE_LEN[shape]).map((x: unknown) => num(x, `${where}.size`, 1e-4, 100));
    const part: DevicePart = { id, shape, size };
    if (p.name !== undefined) part.name = String(p.name).slice(0, 80);
    if (p.pos !== undefined) part.pos = vec3(p.pos, `${where}.pos`);
    if (p.rot !== undefined) part.rot = vec3(p.rot, `${where}.rot`);
    if (p.color !== undefined) { if (!colorOk(p.color)) throw new Error(`${where}: color phải dạng "#rrggbb"`); part.color = String(p.color); }
    if (p.material !== undefined) {
      if (!DEVICE_MATERIALS.includes(p.material as DeviceMaterial)) throw new Error(`${where}: material phải là ${DEVICE_MATERIALS.join(' | ')}`);
      part.material = p.material as DeviceMaterial;
    }
    if (p.parent !== undefined && p.parent !== null && p.parent !== '') part.parent = String(p.parent);
    if (p.motion !== undefined && p.motion !== null) {
      const m = p.motion as Record<string, unknown>;
      if (!MOTIONS.includes(m.type as DeviceMotion['type'])) throw new Error(`${where}: motion.type phải là ${MOTIONS.join(' | ')}`);
      const mo: DeviceMotion = { ...binding(m, `${where}.motion`), type: m.type as DeviceMotion['type'] };
      if (m.axis !== undefined) { if (!['x', 'y', 'z'].includes(String(m.axis))) throw new Error(`${where}: motion.axis phải là x | y | z`); mo.axis = m.axis as 'x' | 'y' | 'z'; }
      if (m.speed !== undefined) mo.speed = num(m.speed, `${where}.motion.speed`, -200, 200);
      if (m.range !== undefined) mo.range = num(m.range, `${where}.motion.range`, -1000, 1000);
      part.motion = mo;
    }
    return part;
  });
  for (const p of parts) {
    if (p.parent && !ids.has(p.parent)) throw new Error(`khối "${p.id}": không có khối cha "${p.parent}"`);
  }
  // chống vòng lặp cha–con
  const parentOf = new Map(parts.map((p) => [p.id, p.parent]));
  for (const p of parts) {
    let cur = p.parent, n = 0;
    while (cur) { if (cur === p.id || ++n > MAX_DEVICE_PARTS) throw new Error(`khối "${p.id}": quan hệ cha–con bị vòng`); cur = parentOf.get(cur); }
  }
  const dev: DeviceModel = { name: String(r.name ?? 'Thiết bị').slice(0, 80) || 'Thiết bị', parts };
  if (r.description !== undefined) dev.description = String(r.description).slice(0, 400);
  if (r.environment !== undefined) {
    if (!['road', 'floor', 'none'].includes(String(r.environment))) throw new Error('environment phải là road | floor | none');
    dev.environment = r.environment as DeviceModel['environment'];
  }
  if (r.road !== undefined && r.road !== null) {
    const rd = r.road as Record<string, unknown>;
    dev.road = { ...binding(rd, 'road'), ...(rd.speed !== undefined ? { speed: num(rd.speed, 'road.speed', -200, 200) } : {}) };
  }
  return dev;
}

/** Các ref mà thiết bị dùng phải có trong mạch */
export function checkDeviceRefs(dev: DeviceModel, doc: CircuitDocument) {
  const refs = [...dev.parts.filter((p) => p.motion).map((p) => [p.id, p.motion!.ref] as const), ...(dev.road ? [['road', dev.road.ref] as const] : [])];
  for (const [id, ref] of refs) if (!findComp(doc, ref)) throw new Error(`khối "${id}" gắn với ${ref} nhưng mạch không có linh kiện này`);
}

// ---------- giá trị điện cho chuyển động ----------

export interface ElectricalSnapshot {
  nodes: Record<string, number>;
  currents?: Record<string, number>;
}

/** Lấy trạng thái điện từ kết quả mô phỏng. Transient: trung bình nửa sau (trạng thái xác lập, PWM ra giá trị trung bình). */
export function snapshotFromResult(r: SimResult | null): ElectricalSnapshot | null {
  if (!r || !r.ok) return null;
  if (r.tran && r.tran.time.length) {
    const nodes: Record<string, number> = {};
    for (const [k, arr] of Object.entries(r.tran.series)) {
      const from = Math.floor(arr.length / 2);
      let s = 0;
      for (let i = from; i < arr.length; i++) s += arr[i];
      nodes[k] = s / Math.max(1, arr.length - from);
    }
    return { nodes };
  }
  if (r.op) return { nodes: r.op.nodes, currents: r.op.currents };
  return null;
}

const CURRENT_TYPES = new Set(['motor', 'lamp', 'led', 'resistor', 'buzzer', 'speaker', 'fuse', 'diode', 'zener', 'schottky']);

export function defaultQuantity(type: string): DeviceQuantity {
  return CURRENT_TYPES.has(type) ? 'current' : 'voltage';
}

export interface BindingValue { value: number; level: number; unit: string; quantity: DeviceQuantity }

/** Tính đại lượng và mức 0..1 cho một liên kết. */
export function evalBinding(doc: CircuitDocument, b: DeviceBinding, snap: ElectricalSnapshot | null, conn = computeConnectivity(doc)): BindingValue {
  const c = findComp(doc, b.ref);
  const quantity = b.quantity ?? (c ? defaultQuantity(c.type) : 'voltage');
  const unit = quantity === 'current' ? 'A' : quantity === 'voltage' ? 'V' : 'W';
  if (!c || !snap) return { value: 0, level: 0, unit, quantity };
  const pins = LIBRARY[c.type].pins;
  const nv = (pin: string | undefined) => {
    if (!pin) return 0;
    const net = conn.netOf.get(`c:${c.id}:${pin}`);
    return !net || net === '0' ? 0 : snap.nodes[net] ?? 0;
  };
  const pa = c.type === 'motor' ? 'p' : pins[0]?.id, pb = c.type === 'motor' ? 'n' : pins[1]?.id;
  const v = nv(pa) - nv(pb);
  let rEq: number | null = null;
  if (c.type === 'motor') rEq = parseValue(c.params.r ?? '');
  else rEq = resistiveValue(c.type, c.params, parseValue);
  let i: number;
  if (rEq !== null && rEq > 0) i = v / rEq;
  else i = snap.currents?.[c.ref] ?? 0;
  const value = quantity === 'current' ? i : quantity === 'voltage' ? v : Math.abs(v * i);
  let max = b.max;
  if (!max) {
    // mặc định: mức 100 % khi linh kiện nhận toàn bộ điện áp lớn nhất trong mạch
    const vmax = Math.max(1e-9, ...Object.values(snap.nodes).map(Math.abs));
    if (quantity === 'voltage') max = vmax;
    else if (c.type === 'led') max = quantity === 'current' ? 0.02 : 0.04;
    else if (rEq && rEq > 0) max = quantity === 'current' ? vmax / rEq : (vmax * vmax) / rEq;
    else max = quantity === 'current' ? 1 : 1;
  }
  const level = Math.max(0, Math.min(1, Math.abs(value) / max));
  return { value, level, unit, quantity };
}

export function describeDevice(dev: DeviceModel): string {
  const moving = dev.parts.filter((p) => p.motion).map((p) => `${p.name ?? p.id} ${p.motion!.type} ← ${p.motion!.ref}`);
  return `${dev.name}: ${dev.parts.length} khối${moving.length ? '; chuyển động: ' + moving.join(', ') : ''}${dev.road ? `; đường chạy ← ${dev.road.ref}` : ''}`;
}

// ---------- mẫu xe máy điện (dùng cho mạch mẫu, không cần AI) ----------

export function scooterDevice(motorRef: string, lightRef: string, maxCurrent: number): DeviceModel {
  const R = 0.27, W = 0.12; // bánh 12 inch
  const rps = -(12 / (2 * Math.PI * R)); // 12 m/s ở mức 100 %, lăn về +x
  const paint = '#d8343a', dark = '#24262b', chrome = '#c9ccd2';
  const spin = { type: 'spin' as const, axis: 'z' as const, ref: motorRef, quantity: 'current' as const, max: maxCurrent, speed: rps };
  const parts: DevicePart[] = [
    { id: 'wheel_r', name: 'Bánh sau', shape: 'wheel', size: [R, W], pos: [-0.62, R, 0], color: dark, material: 'rubber', motion: spin },
    { id: 'hub', name: 'Động cơ trục bánh (hub motor)', shape: 'cylinder', size: [0.12, 0.14], pos: [0, 0, 0], rot: [90, 0, 0], color: '#5a5f68', material: 'metal', parent: 'wheel_r' },
    { id: 'hub_cap', name: 'Nắp động cơ', shape: 'cylinder', size: [0.05, 0.16], rot: [90, 0, 0], color: chrome, material: 'chrome', parent: 'wheel_r' },
    { id: 'wheel_f', name: 'Bánh trước', shape: 'wheel', size: [R, W - 0.01], pos: [0.68, R, 0], color: dark, material: 'rubber', motion: spin },
    { id: 'disc', name: 'Đĩa phanh', shape: 'cylinder', size: [0.11, 0.008], pos: [0, 0, 0.075], rot: [90, 0, 0], color: chrome, material: 'chrome', parent: 'wheel_f' },
    { id: 'swingarm', name: 'Càng sau', shape: 'box', size: [0.5, 0.07, 0.05], pos: [-0.4, 0.31, 0.1], rot: [0, 0, 8], color: '#3a3d44', material: 'metal' },
    { id: 'shock', name: 'Phuộc sau', shape: 'cylinder', size: [0.025, 0.34], pos: [-0.5, 0.48, 0.1], rot: [0, 0, 30], color: '#e0b030', material: 'metal' },
    { id: 'battery', name: 'Pin xe (ắc quy)', shape: 'box', size: [0.46, 0.14, 0.26], pos: [0.05, 0.27, 0], color: '#2c5fa8', material: 'plastic' },
    { id: 'floor', name: 'Sàn để chân', shape: 'box', size: [0.66, 0.06, 0.36], pos: [0.06, 0.37, 0], color: dark, material: 'rubber' },
    { id: 'body_rear', name: 'Thân sau', shape: 'capsule', size: [0.17, 0.62], pos: [-0.42, 0.6, 0], rot: [0, 0, 92], color: paint, material: 'paint' },
    { id: 'body_skirt', name: 'Ốp sườn', shape: 'box', size: [0.7, 0.18, 0.36], pos: [-0.4, 0.47, 0], color: paint, material: 'paint' },
    { id: 'seat', name: 'Yên xe', shape: 'capsule', size: [0.12, 0.5], pos: [-0.36, 0.8, 0], rot: [0, 0, 90], color: '#1b1b1d', material: 'plastic' },
    { id: 'tail', name: 'Đèn hậu', shape: 'box', size: [0.05, 0.06, 0.2], pos: [-0.86, 0.66, 0], color: '#ff2a2a', material: 'light', motion: { type: 'glow', ref: lightRef } },
    { id: 'fender_r', name: 'Chắn bùn sau', shape: 'box', size: [0.32, 0.03, 0.14], pos: [-0.78, 0.55, 0], rot: [0, 0, -18], color: dark, material: 'plastic' },
    { id: 'apron', name: 'Yếm trước', shape: 'box', size: [0.12, 0.62, 0.4], pos: [0.42, 0.63, 0], rot: [0, 0, -16], color: paint, material: 'paint' },
    { id: 'column', name: 'Cổ lái', shape: 'cylinder', size: [0.035, 0.6], pos: [0.53, 0.86, 0], rot: [0, 0, -20], color: '#3a3d44', material: 'metal' },
    { id: 'fork_l', name: 'Phuộc trước trái', shape: 'cylinder', size: [0.022, 0.56], pos: [0.6, 0.5, 0.075], rot: [0, 0, -20], color: chrome, material: 'chrome' },
    { id: 'fork_r', name: 'Phuộc trước phải', shape: 'cylinder', size: [0.022, 0.56], pos: [0.6, 0.5, -0.075], rot: [0, 0, -20], color: chrome, material: 'chrome' },
    { id: 'fender_f', name: 'Chắn bùn trước', shape: 'box', size: [0.34, 0.03, 0.14], pos: [0.68, 0.59, 0], rot: [0, 0, -6], color: paint, material: 'paint' },
    { id: 'head', name: 'Đầu xe', shape: 'box', size: [0.2, 0.14, 0.32], pos: [0.46, 1.14, 0], color: paint, material: 'paint' },
    { id: 'bar', name: 'Ghi đông', shape: 'cylinder', size: [0.016, 0.7], pos: [0.42, 1.2, 0], rot: [90, 0, 0], color: chrome, material: 'chrome' },
    { id: 'grip_l', name: 'Tay ga', shape: 'cylinder', size: [0.022, 0.12], pos: [0.42, 1.2, -0.3], rot: [90, 0, 0], color: '#111', material: 'rubber' },
    { id: 'grip_r', name: 'Tay phanh', shape: 'cylinder', size: [0.022, 0.12], pos: [0.42, 1.2, 0.3], rot: [90, 0, 0], color: '#111', material: 'rubber' },
    { id: 'dash', name: 'Đồng hồ', shape: 'box', size: [0.1, 0.02, 0.16], pos: [0.41, 1.22, 0], rot: [0, 0, 25], color: '#0b2030', material: 'glass' },
    { id: 'lamp', name: 'Đèn pha', shape: 'sphere', size: [0.075], pos: [0.56, 1.1, 0], color: '#fff6d8', material: 'light', motion: { type: 'glow', ref: lightRef } },
    { id: 'mirror_l', name: 'Gương trái', shape: 'sphere', size: [0.05], pos: [0.38, 1.38, -0.28], color: chrome, material: 'chrome' },
    { id: 'mirror_r', name: 'Gương phải', shape: 'sphere', size: [0.05], pos: [0.38, 1.38, 0.28], color: chrome, material: 'chrome' },
    { id: 'stalk_l', name: 'Chân gương trái', shape: 'cylinder', size: [0.008, 0.2], pos: [0.4, 1.29, -0.27], color: chrome, material: 'chrome' },
    { id: 'stalk_r', name: 'Chân gương phải', shape: 'cylinder', size: [0.008, 0.2], pos: [0.4, 1.29, 0.27], color: chrome, material: 'chrome' },
  ];
  return {
    name: 'Xe máy điện',
    description: 'Động cơ trục bánh sau, tốc độ bánh và đường chạy theo dòng qua động cơ; đèn pha và đèn hậu theo LED.',
    environment: 'road',
    road: { ref: motorRef, quantity: 'current', max: maxCurrent, speed: 12 },
    parts,
  };
}
