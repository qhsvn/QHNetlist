// Patch thiết kế do AI (hoặc script) đề xuất. Được kiểm tra trên bản sao trước khi áp dụng nguyên tử.
import { addComponent, addWire, removeComponent, removeWire, updateComponent } from './commands';
import { documentBounds, findComp, makeComponent, snap } from './document';
import { COMPONENT_TYPES, LIBRARY } from './library';
import { parseSource } from './sources';
import type { CircuitDocument, ComponentType, DeviceModel, Endpoint, Rotation } from './types';
import { checkDeviceRefs, normalizeDevice } from './device';
import { parseValue } from './units';

export type DesignOperation =
  | { op: 'add_component'; ref?: string; type: ComponentType; params?: Record<string, string>; x?: number; y?: number; rot?: number }
  | { op: 'remove_component'; ref: string }
  | { op: 'set_params'; ref: string; params: Record<string, string> }
  | { op: 'move_component'; ref: string; x?: number; y?: number; rot?: number }
  | { op: 'rename'; ref: string; newRef: string }
  | { op: 'connect'; from: string; to: string }
  | { op: 'disconnect'; from: string; to: string }
  | { op: 'clear' }
  | { op: 'set_device'; device: DeviceModel }
  | { op: 'remove_device' };

export interface DesignProposal {
  baseRevision: number;
  explanation: string;
  assumptions: string[];
  operations: DesignOperation[];
}

export interface PatchStep {
  op: DesignOperation;
  label: string;
  doc: CircuitDocument; // trạng thái sau bước này (để dựng từng bước)
  focusRef?: string;
}

const ROTS = [0, 90, 180, 270];

function parsePinRef(doc: CircuitDocument, s: string): Endpoint {
  const m = String(s ?? '').trim().match(/^([A-Za-z_][\w]*)\.([A-Za-z0-9_+-]+)$/);
  if (!m) throw new Error(`Tham chiếu chân "${s}" phải có dạng REF.PIN, ví dụ R1.1`);
  const c = findComp(doc, m[1]);
  if (!c) throw new Error(`Không có linh kiện ${m[1]}`);
  const def = LIBRARY[c.type];
  const alias: Record<string, string> = { '+': 'p', '-': 'n', A: 'a', K: 'k', C: 'c', B: 'b', E: 'e', OUT: 'out', IN_P: 'inp', IN_N: 'inn' };
  let pin = m[2];
  if (!def.pins.some((p) => p.id === pin)) pin = alias[pin] ?? alias[pin.toUpperCase()] ?? pin.toLowerCase();
  if (!def.pins.some((p) => p.id === pin)) {
    throw new Error(`${c.ref} (${def.name}) không có chân "${m[2]}". Chân hợp lệ: ${def.pins.map((p) => p.id).join(', ')}`);
  }
  return { kind: 'pin', comp: c.id, pin };
}

function validateParams(type: ComponentType, params: Record<string, string>, ref: string) {
  const def = LIBRARY[type];
  for (const [k, v] of Object.entries(params)) {
    const pd = def.params.find((p) => p.key === k);
    if (!pd) throw new Error(`${ref}: tham số "${k}" không có trong ${def.name}`);
    if (typeof v !== 'string' && typeof v !== 'number') throw new Error(`${ref}: tham số ${k} phải là chuỗi`);
    const sv = String(v);
    if (pd.kind === 'value' && sv.trim() && parseValue(sv) === null) throw new Error(`${ref}: giá trị ${k}="${sv}" không hợp lệ`);
    if (pd.kind === 'select' && !pd.options!.includes(sv)) throw new Error(`${ref}: ${k} phải là một trong ${pd.options!.join(', ')}`);
    if (pd.kind === 'text' && (type === 'vsource' || type === 'isource') && !parseSource(sv)) throw new Error(`${ref}: giá trị nguồn "${sv}" không hợp lệ`);
  }
}

/** Tìm chỗ trống trên lưới cho linh kiện không có toạ độ. */
function autoPlace(doc: CircuitDocument): { x: number; y: number } {
  const b = documentBounds(doc);
  const occupied = (x: number, y: number) => doc.components.some((c) => Math.abs(c.x - x) < 100 && Math.abs(c.y - y) < 100);
  const startX = doc.components.length ? b.minX + 50 : 0;
  const startY = doc.components.length ? b.minY + 50 : 0;
  for (let row = 0; row < 40; row++) {
    for (let col = 0; col < 8; col++) {
      const x = startX + col * 140, y = startY + row * 140;
      if (!occupied(x, y)) return { x, y };
    }
  }
  return { x: b.maxX + 140, y: startY };
}

export function describeOp(op: DesignOperation): string {
  switch (op.op) {
    case 'add_component': return `Thêm ${op.ref ?? ''} ${LIBRARY[op.type]?.name ?? op.type}${op.params ? ' ' + Object.values(op.params).join(' ') : ''}`;
    case 'remove_component': return `Xoá ${op.ref}`;
    case 'set_params': return `Đặt ${op.ref}: ${Object.entries(op.params).map(([k, v]) => `${k}=${v}`).join(', ')}`;
    case 'move_component': return `Di chuyển ${op.ref}`;
    case 'rename': return `Đổi tên ${op.ref} → ${op.newRef}`;
    case 'connect': return `Nối ${op.from} — ${op.to}`;
    case 'disconnect': return `Tháo ${op.from} — ${op.to}`;
    case 'clear': return 'Xoá toàn bộ mạch';
    case 'set_device': {
      const d = op.device as Partial<DeviceModel> | undefined;
      return `Dựng thiết bị 3D "${d?.name ?? '?'}" (${Array.isArray(d?.parts) ? d!.parts!.length : 0} khối)`;
    }
    case 'remove_device': return 'Bỏ thiết bị 3D';
  }
}

/** Dạng "code" để hiển thị trong console AI */
export function opToCode(op: DesignOperation): string {
  const q = (s: string) => JSON.stringify(s);
  switch (op.op) {
    case 'add_component': {
      const p = op.params ? Object.entries(op.params).map(([k, v]) => `${k}=${q(String(v))}`).join(', ') : '';
      const at = op.x !== undefined ? `, at=(${op.x}, ${op.y})` : '';
      return `netlist.place(${op.type}(${q(op.ref ?? '?')}${p ? ', ' + p : ''})${at}${op.rot ? `, rot=${op.rot}` : ''})`;
    }
    case 'remove_component': return `netlist.remove(${q(op.ref)})`;
    case 'set_params': return `netlist.set(${q(op.ref)}, ${Object.entries(op.params).map(([k, v]) => `${k}=${q(String(v))}`).join(', ')})`;
    case 'move_component': return `netlist.move(${q(op.ref)}, at=(${op.x}, ${op.y}))`;
    case 'rename': return `netlist.rename(${q(op.ref)}, ${q(op.newRef)})`;
    case 'connect': return `netlist.wire(${q(op.from)}, ${q(op.to)})`;
    case 'disconnect': return `netlist.unwire(${q(op.from)}, ${q(op.to)})`;
    case 'clear': return 'netlist.clear()';
    case 'set_device': {
      const d = op.device as Partial<DeviceModel> | undefined;
      const moving = Array.isArray(d?.parts) ? d!.parts!.filter((p) => p?.motion).map((p) => `${p.id}.${p.motion!.type}(${q(p.motion!.ref)})`) : [];
      return `device.build(${q(d?.name ?? '?')}, parts=${Array.isArray(d?.parts) ? d!.parts!.length : 0}${moving.length ? ', motion=[' + moving.join(', ') + ']' : ''})`;
    }
    case 'remove_device': return 'device.remove()';
  }
}

/**
 * Áp dụng patch trên bản sao. Ném lỗi (và mạch giữ nguyên) nếu bất kỳ thao tác nào không hợp lệ.
 * Trả về các bước trung gian để UI có thể dựng mạch từng bước.
 */
export function applyOperations(base: CircuitDocument, operations: DesignOperation[]): { doc: CircuitDocument; steps: PatchStep[] } {
  if (!Array.isArray(operations)) throw new Error('operations phải là mảng');
  let doc = base;
  const steps: PatchStep[] = [];
  operations.forEach((op, i) => {
    const where = `Thao tác #${i + 1} (${(op as { op?: string })?.op ?? '?'})`;
    try {
      let focusRef: string | undefined;
      switch (op?.op) {
        case 'add_component': {
          if (!COMPONENT_TYPES.includes(op.type)) throw new Error(`loại "${op.type}" không có trong thư viện`);
          const params = Object.fromEntries(Object.entries(op.params ?? {}).map(([k, v]) => [k, String(v)]));
          let ref = op.ref?.trim();
          if (ref && findComp(doc, ref)) throw new Error(`${ref} đã tồn tại`);
          if (ref && !/^[A-Za-z_][\w]*$/.test(ref)) throw new Error(`tên "${ref}" không hợp lệ`);
          validateParams(op.type, params, ref ?? op.type);
          const pos = op.x !== undefined && op.y !== undefined && Number.isFinite(+op.x) && Number.isFinite(+op.y)
            ? { x: snap(+op.x), y: snap(+op.y) } : autoPlace(doc);
          const rot = (ROTS.includes(Number(op.rot)) ? Number(op.rot) : 0) as Rotation;
          const c = makeComponent(doc, op.type, pos.x, pos.y, rot, params, ref || undefined);
          doc = addComponent(doc, c);
          focusRef = c.ref;
          break;
        }
        case 'remove_component': {
          const c = findComp(doc, op.ref); if (!c) throw new Error(`không có ${op.ref}`);
          doc = removeComponent(doc, c.id); break;
        }
        case 'set_params': {
          const c = findComp(doc, op.ref); if (!c) throw new Error(`không có ${op.ref}`);
          const params = Object.fromEntries(Object.entries(op.params ?? {}).map(([k, v]) => [k, String(v)]));
          validateParams(c.type, params, c.ref);
          doc = updateComponent(doc, c.id, { params }); focusRef = c.ref; break;
        }
        case 'move_component': {
          const c = findComp(doc, op.ref); if (!c) throw new Error(`không có ${op.ref}`);
          const rot = op.rot !== undefined && ROTS.includes(Number(op.rot)) ? (Number(op.rot) as Rotation) : c.rot;
          doc = updateComponent(doc, c.id, { x: op.x !== undefined ? snap(+op.x) : c.x, y: op.y !== undefined ? snap(+op.y) : c.y, rot });
          focusRef = c.ref; break;
        }
        case 'rename': {
          const c = findComp(doc, op.ref); if (!c) throw new Error(`không có ${op.ref}`);
          if (!/^[A-Za-z_][\w]*$/.test(op.newRef)) throw new Error(`tên "${op.newRef}" không hợp lệ`);
          if (findComp(doc, op.newRef)) throw new Error(`${op.newRef} đã tồn tại`);
          doc = updateComponent(doc, c.id, { ref: op.newRef }); focusRef = op.newRef;
          if (doc.device) {
            const fix = <T extends { ref: string }>(b: T): T => (b.ref === op.ref ? { ...b, ref: op.newRef } : b);
            doc = { ...doc, device: { ...doc.device, road: doc.device.road && fix(doc.device.road), parts: doc.device.parts.map((p) => (p.motion ? { ...p, motion: fix(p.motion) } : p)) } };
          }
          break;
        }
        case 'connect': {
          const a = parsePinRef(doc, op.from), b = parsePinRef(doc, op.to);
          doc = addWire(doc, a, b).doc; break;
        }
        case 'disconnect': {
          const a = parsePinRef(doc, op.from), b = parsePinRef(doc, op.to);
          const key = (e: Endpoint) => (e.kind === 'pin' ? `${e.comp}:${e.pin}` : e.id);
          const w = doc.wires.find((w) => (key(w.a) === key(a) && key(w.b) === key(b)) || (key(w.a) === key(b) && key(w.b) === key(a)));
          if (!w) throw new Error(`không có dây trực tiếp giữa ${op.from} và ${op.to}`);
          doc = removeWire(doc, w.id); break;
        }
        case 'clear': {
          const { device: _d, ...rest } = doc;
          doc = { ...rest, components: [], wires: [], junctions: [] }; break;
        }
        case 'set_device': {
          const dev = normalizeDevice(op.device);
          checkDeviceRefs(dev, doc);
          doc = { ...doc, device: dev }; break;
        }
        case 'remove_device': {
          const { device: _d, ...rest } = doc;
          doc = rest; break;
        }
        default:
          throw new Error('thao tác không được hỗ trợ');
      }
      steps.push({ op, label: describeOp(op), doc, focusRef });
    } catch (e) {
      throw new Error(`${where}: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
  return { doc, steps };
}

/** Trích JSON đề xuất từ văn bản model trả về (chịu được ```json fences và chữ thừa). */
export function parseProposal(text: string, baseRevision: number): DesignProposal {
  const tryParse = (s: string) => { try { return JSON.parse(s); } catch { return undefined; } };
  let obj = tryParse(text.trim());
  if (!obj) {
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) obj = tryParse(fence[1].trim());
  }
  if (!obj) {
    const start = text.indexOf('{'), end = text.lastIndexOf('}');
    if (start >= 0 && end > start) obj = tryParse(text.slice(start, end + 1));
  }
  if (!obj || typeof obj !== 'object') {
    return { baseRevision, explanation: text.trim(), assumptions: [], operations: [] };
  }
  return {
    baseRevision,
    explanation: String(obj.explanation ?? obj.message ?? ''),
    assumptions: Array.isArray(obj.assumptions) ? obj.assumptions.map(String) : [],
    operations: Array.isArray(obj.operations) ? obj.operations : [],
  };
}
