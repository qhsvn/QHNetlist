// Mô hình 3D thủ tục cho từng loại linh kiện. Đơn vị: mm. Trục Y hướng lên, bo mạch nằm ở y = 0.
// Đây là hình minh hoạ để quan sát, không phải footprint/STEP chế tạo.
import * as THREE from 'three';
import { LIBRARY, modelLabel } from '../../core/library';
import { parseValue } from '../../core/units';
import type { ComponentInstance } from '../../core/types';

/** 1 px schematic = 0.254 mm (lưới 10 px = 2,54 mm) */
export const MM_PER_PX = 0.254;
export const BOARD_TOP = 1.6;

const mats = new Map<string, THREE.Material>();
/** Vật liệu vật lý có lớp phủ bóng (clearcoat) để linh kiện trông như nhựa/men thật. */
export function mat(color: string | number, opts: Partial<THREE.MeshPhysicalMaterialParameters> = {}): THREE.MeshPhysicalMaterial {
  const key = `${color}|${JSON.stringify(opts)}`;
  if (!mats.has(key)) {
    const metal = (opts.metalness ?? 0) > 0.5;
    mats.set(key, new THREE.MeshPhysicalMaterial({ color, roughness: 0.45, metalness: 0.05, clearcoat: metal ? 0 : 0.6, clearcoatRoughness: 0.25, ...opts }));
  }
  return mats.get(key) as THREE.MeshPhysicalMaterial;
}

/** Mặt chip có chữ in (ref + giá trị) */
export function chipTopTexture(lines: string[], bg = '#141419', fg = '#c9c9d4'): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = 256; c.height = 160;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = bg; ctx.fillRect(0, 0, 256, 160);
  ctx.fillStyle = fg; ctx.textAlign = 'center';
  ctx.font = '700 46px ui-monospace, Consolas, monospace'; ctx.fillText(lines[0] ?? '', 128, 72);
  ctx.font = '28px ui-monospace, Consolas, monospace'; ctx.fillText(lines[1] ?? '', 128, 116);
  ctx.beginPath(); ctx.arc(26, 26, 9, 0, Math.PI * 2); ctx.fillStyle = '#2e2e36'; ctx.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const METAL = () => mat('#d8d8de', { metalness: 0.9, roughness: 0.28 });
const GOLD = () => mat('#d4a93a', { metalness: 0.85, roughness: 0.3 });
const BLACK = () => mat('#16161b', { roughness: 0.45 });

function mesh(geo: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Dây chân kim loại đi qua các điểm (tube gấp khúc). */
export function lead(points: [number, number, number][], radius = 0.28, material: THREE.Material = METAL()): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < points.length - 1; i++) {
    const a = new THREE.Vector3(...points[i]), b = new THREE.Vector3(...points[i + 1]);
    const len = a.distanceTo(b);
    if (len < 1e-6) continue;
    const c = mesh(new THREE.CylinderGeometry(radius, radius, len, 10), material);
    c.position.copy(a).add(b).multiplyScalar(0.5);
    c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    g.add(c);
    if (i > 0) g.add(mesh(new THREE.SphereGeometry(radius, 10, 8), material, a.x, a.y, a.z));
  }
  return g;
}

// Mã màu điện trở 4 vạch
const BAND = ['#111111', '#7a3b12', '#d62020', '#f27c13', '#f2d013', '#1f9e3a', '#1f4fd6', '#8a2be2', '#8a8a8a', '#f5f5f5'];
export function resistorBands(value: string): string[] {
  const v = parseValue(value);
  if (v === null || v <= 0) return ['#888', '#888', '#888', '#c9a227'];
  let exp = Math.floor(Math.log10(v)) - 1;
  let digits = Math.round(v / Math.pow(10, exp));
  if (digits >= 100) { digits = Math.round(digits / 10); exp += 1; }
  const d1 = Math.floor(digits / 10), d2 = digits % 10;
  const mult = exp >= 0 && exp <= 9 ? BAND[exp] : exp === -1 ? '#c9a227' : '#c0c0c0';
  return [BAND[d1], BAND[d2], mult, '#c9a227'];
}

/** Toạ độ pin (mm, cục bộ khi rot = 0) */
export function pinLocal(c: ComponentInstance, id: string): [number, number] {
  const p = LIBRARY[c.type].pins.find((p) => p.id === id)!;
  return [p.x * MM_PER_PX, p.y * MM_PER_PX];
}

export interface ScreenInfo { kind: 'lcd' | 'oled'; canvas: HTMLCanvasElement; tex: THREE.CanvasTexture; mat: THREE.MeshStandardMaterial; ver: string; blue?: boolean }
export interface ModelInfo {
  group: THREE.Group;
  led?: { material: THREE.MeshStandardMaterial; light: THREE.PointLight; scale?: number };
  /** vật liệu từng đoạn LED 7 đoạn, khoá "số:đoạn" */
  segs?: Record<string, THREE.MeshStandardMaterial>;
  screen?: ScreenInfo;
}
export { mesh };

export function buildModel(c: ComponentInstance): ModelInfo {
  const g = new THREE.Group();
  const T = BOARD_TOP;
  const info: ModelInfo = { group: g };
  const twoPin = () => [pinLocal(c, LIBRARY[c.type].pins[0].id), pinLocal(c, LIBRARY[c.type].pins[1].id)] as const;

  switch (c.type) {
    case 'resistor': {
      const [[x1], [x2]] = twoPin();
      const y = T + 2.2;
      const body = mesh(new THREE.CapsuleGeometry(1.25, 4.6, 6, 16), mat('#d8c19a', { roughness: 0.7 }), 0, y, 0);
      body.rotation.z = Math.PI / 2;
      g.add(body);
      resistorBands(c.params.value).forEach((col, i) => {
        const b = mesh(new THREE.CylinderGeometry(1.3, 1.3, 0.55, 20), mat(col, { roughness: 0.5 }), -1.9 + i * 1.15 + (i === 3 ? 0.6 : 0), y, 0);
        b.rotation.z = Math.PI / 2;
        g.add(b);
      });
      g.add(lead([[x1, T, 0], [x1, y, 0], [-3, y, 0]]), lead([[3, y, 0], [x2, y, 0], [x2, T, 0]]));
      break;
    }
    case 'capacitor': case 'capacitor_pol': {
      const [[x1], [x2]] = twoPin();
      const farad = parseValue(c.params.value) ?? 1e-6;
      if (farad >= 1e-6 || c.type === 'capacitor_pol') {
        // tụ hoá dựng đứng
        const h = Math.min(11, 5 + Math.log10(farad * 1e6 + 1) * 3);
        g.add(mesh(new THREE.CylinderGeometry(2.6, 2.6, h, 28), mat('#1d3fa8', { roughness: 0.35 }), 0, T + 0.6 + h / 2, 0));
        const stripe = mesh(new THREE.CylinderGeometry(2.62, 2.62, h * 0.98, 28, 1, true, Math.PI * 0.75, Math.PI * 0.5), mat('#cfd8ee'), 0, T + 0.6 + h / 2, 0);
        g.add(stripe);
        g.add(mesh(new THREE.CylinderGeometry(2.4, 2.4, 0.15, 28), METAL(), 0, T + 0.6 + h + 0.05, 0));
        g.add(lead([[-1, T + 0.6, 0], [-1, T + 0.4, 0], [x1, T + 0.4, 0], [x1, T, 0]]), lead([[1, T + 0.6, 0], [1, T + 0.4, 0], [x2, T + 0.4, 0], [x2, T, 0]]));
      } else {
        // tụ gốm dạng đĩa
        const disc = mesh(new THREE.CylinderGeometry(2.6, 2.6, 1.3, 28), mat('#e0a530', { roughness: 0.6 }), 0, T + 5, 0);
        disc.rotation.x = Math.PI / 2;
        g.add(disc);
        g.add(lead([[-1.2, T + 3, 0], [-1.2, T + 0.5, 0], [x1, T + 0.5, 0], [x1, T, 0]]), lead([[1.2, T + 3, 0], [1.2, T + 0.5, 0], [x2, T + 0.5, 0], [x2, T, 0]]));
      }
      break;
    }
    case 'inductor': {
      const [[x1], [x2]] = twoPin();
      const tor = mesh(new THREE.TorusGeometry(3.4, 1.5, 14, 36), mat('#b8692e', { metalness: 0.7, roughness: 0.35 }), 0, T + 5.2, 0);
      g.add(tor);
      const core = mesh(new THREE.TorusGeometry(3.4, 1.2, 10, 36), mat('#2a5a2a'), 0, T + 5.2, 0);
      core.scale.set(0.98, 0.98, 1.05);
      g.add(core);
      g.add(lead([[-3.4, T + 4, 0], [-3.4, T + 0.5, 0], [x1, T + 0.5, 0], [x1, T, 0]]), lead([[3.4, T + 4, 0], [3.4, T + 0.5, 0], [x2, T + 0.5, 0], [x2, T, 0]]));
      break;
    }
    case 'diode': case 'zener': case 'schottky': {
      const [[x1], [x2]] = twoPin();
      const y = T + 1.6;
      const glass = c.params.model === 'D1N4148' || c.type === 'zener' || c.params.model === 'DBAT54';
      const body = mesh(new THREE.CylinderGeometry(1, 1, 4.2, 20), glass ? mat(c.type === 'zener' ? '#d9772b' : '#c2452d', { transparent: true, opacity: 0.85, roughness: 0.15 }) : BLACK(), 0, y, 0);
      body.rotation.z = Math.PI / 2;
      g.add(body);
      const band = mesh(new THREE.CylinderGeometry(1.03, 1.03, 0.6, 20), mat('#e6e6e6'), 1.4, y, 0);
      band.rotation.z = Math.PI / 2;
      g.add(band);
      g.add(lead([[x1, T, 0], [x1, y, 0], [-2.1, y, 0]], 0.25), lead([[2.1, y, 0], [x2, y, 0], [x2, T, 0]], 0.25));
      break;
    }
    case 'led': {
      const [[x1], [x2]] = twoPin();
      const color = ({ LED_GREEN: '#22e07a', LED_BLUE: '#3a8dff', LED_YELLOW: '#ffc21a', LED_WHITE: '#e8efff' } as Record<string, string>)[c.params.model] ?? '#ff2b45';
      const m = new THREE.MeshPhysicalMaterial({ color, transparent: true, opacity: 0.85, roughness: 0.08, transmission: 0.2, thickness: 2, clearcoat: 1, emissive: color, emissiveIntensity: 0 });
      const y0 = T + 3.2;
      g.add(mesh(new THREE.CylinderGeometry(2.5, 2.5, 3.6, 28), m, 0, y0 + 1.8, 0));
      g.add(mesh(new THREE.SphereGeometry(2.5, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), m, 0, y0 + 3.6, 0));
      g.add(mesh(new THREE.CylinderGeometry(2.9, 2.9, 0.6, 28), m, 0, y0 + 0.3, 0));
      const light = new THREE.PointLight(color, 0, 40, 2);
      light.position.set(0, y0 + 4, 0);
      g.add(light);
      // chân A dài hơn (anot)
      g.add(lead([[-1.27, y0, 0], [-1.27, T + 0.5, 0], [x1, T + 0.5, 0], [x1, T, 0]]), lead([[1.27, y0, 0], [1.27, T + 0.5, 0], [x2, T + 0.5, 0], [x2, T, 0]]));
      info.led = { material: m, light };
      break;
    }
    case 'vsource': case 'isource': case 'battery': case 'clock': {
      const [, z1] = pinLocal(c, 'p'), [, z2] = pinLocal(c, 'n');
      const v = (c.params.value ?? '').toLowerCase();
      if ((c.type === 'vsource' && !v.startsWith('pulse') && !v.startsWith('sin')) || c.type === 'battery') {
        // pin dạng khối 9 V
        const h = 7;
        g.add(mesh(new THREE.BoxGeometry(8, h, 13, 2, 2, 2), mat('#202024', { roughness: 0.4 }), 0, T + h / 2 + 0.3, 0));
        g.add(mesh(new THREE.BoxGeometry(8.05, h * 0.55, 13.05), mat('#ff8a1f'), 0, T + h * 0.45 + 0.3, 0));
        const face = mesh(new THREE.PlaneGeometry(12.6, h * 0.5), new THREE.MeshPhysicalMaterial({ map: chipTopTexture([c.type === 'battery' ? String(c.params.kind).replace(/^.*?(\d+(?:\.\d+)?V)$/, '$1') : String(c.params.value).replace(/^dc\s*/i, '') + ' V', c.ref], '#ff8a1f', '#1a1206'), roughness: 0.4, clearcoat: 0.6 }), 4.04, T + h * 0.45 + 0.3, 0);
        face.rotation.y = Math.PI / 2;
        g.add(face);
        g.add(mesh(new THREE.CylinderGeometry(1.1, 1.1, 1.2, 16), METAL(), 0, T + h + 0.9, -3.2));
        g.add(mesh(new THREE.CylinderGeometry(1.3, 1.3, 1.2, 6), METAL(), 0, T + h + 0.9, 3.2));
        g.add(lead([[0, T + h + 1.4, -3.2], [0, T + h + 2.6, -3.2], [0, T + h + 2.6, z1], [0, T, z1]], 0.35, mat('#d01f2f')));
        g.add(lead([[0, T + h + 1.4, 3.2], [0, T + h + 2.6, 3.2], [0, T + h + 2.6, z2], [0, T, z2]], 0.35, mat('#18181c')));
      } else {
        // mô-đun phát tín hiệu / nguồn dòng
        g.add(mesh(new THREE.BoxGeometry(11, 5, 13), mat(c.type === 'isource' ? '#3b2a6b' : '#1b2b3a', { roughness: 0.35 }), 0, T + 2.8, 0));
        const screen = mesh(new THREE.PlaneGeometry(8, 5.5), new THREE.MeshStandardMaterial({ color: '#04121a', emissive: c.type === 'isource' ? '#b28cff' : '#36d6ff', emissiveIntensity: 0.55 }), 0, T + 5.32, -1.5);
        screen.rotation.x = -Math.PI / 2;
        g.add(screen);
        g.add(mesh(new THREE.CylinderGeometry(1.2, 1.2, 1.4, 18), METAL(), 2.5, T + 5.9, 4));
        g.add(mesh(new THREE.CylinderGeometry(1.2, 1.2, 1.4, 18), mat('#555'), -2.5, T + 5.9, 4));
        g.add(lead([[0, T + 0.5, -6.5], [0, T + 0.5, z1], [0, T, z1]], 0.35, mat('#d01f2f')));
        g.add(lead([[0, T + 0.5, 6.5], [0, T + 0.5, z2], [0, T, z2]], 0.35, mat('#18181c')));
      }
      break;
    }
    case 'ground': {
      const [, z] = pinLocal(c, 'g');
      g.add(mesh(new THREE.CylinderGeometry(2.2, 2.6, 1, 6), BLACK(), 0, T + 0.5, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.7, 0.7, 4, 12), GOLD(), 0, T + 3, 0));
      g.add(mesh(new THREE.SphereGeometry(1.1, 14, 10), GOLD(), 0, T + 5.2, 0));
      g.add(lead([[0, T + 0.4, 0], [0, T + 0.4, z], [0, T, z]], 0.3, GOLD()));
      break;
    }
    case 'switch': {
      const [[x1], [x2]] = twoPin();
      const closed = c.params.closed === '1';
      g.add(mesh(new THREE.BoxGeometry(6, 3.5, 6), BLACK(), 0, T + 1.75, 0));
      g.add(mesh(new THREE.BoxGeometry(6.1, 0.3, 6.1), METAL(), 0, T + 3.6, 0));
      g.add(mesh(new THREE.CylinderGeometry(1.75, 1.75, closed ? 0.6 : 1.8, 22), mat(closed ? '#ff3fa4' : '#3a3a40'), 0, T + 3.75 + (closed ? 0.3 : 0.9), 0));
      g.add(lead([[-3, T + 0.6, 0], [x1, T + 0.6, 0], [x1, T, 0]], 0.3), lead([[3, T + 0.6, 0], [x2, T + 0.6, 0], [x2, T, 0]], 0.3));
      break;
    }
    case 'npn': case 'pnp': {
      // TO-92
      const body = mesh(new THREE.CylinderGeometry(2.3, 2.3, 4.6, 24, 1, false, 0, Math.PI), BLACK(), 0, T + 6, 0);
      g.add(body);
      g.add(mesh(new THREE.BoxGeometry(4.6, 4.6, 0.05), BLACK(), 0, T + 6, 0));
      for (const id of ['e', 'b', 'c'] as const) {
        const [px, pz] = pinLocal(c, id);
        const lx = id === 'e' ? -1.27 : id === 'b' ? 0 : 1.27;
        g.add(lead([[lx, T + 3.7, 0], [lx, T + 1, 0], [px, T + 1, pz], [px, T, pz]], 0.22));
      }
      break;
    }
    case 'opamp': {
      // DIP-8
      g.add(mesh(new THREE.BoxGeometry(9.6, 3.2, 6.4), BLACK(), 0, T + 2.3, 0));
      const top = mesh(new THREE.PlaneGeometry(9.4, 6.2), new THREE.MeshPhysicalMaterial({ map: chipTopTexture([c.ref, 'OP-AMP']), roughness: 0.5, clearcoat: 0.4 }), 0, T + 3.91, 0);
      top.rotation.x = -Math.PI / 2;
      g.add(top);
      for (let i = 0; i < 4; i++) {
        for (const s of [-1, 1]) {
          g.add(lead([[-3.81 + i * 2.54, T + 1.6, s * 3.2], [-3.81 + i * 2.54, T + 1.6, s * 3.9], [-3.81 + i * 2.54, T, s * 3.9]], 0.25));
        }
      }
      const route: [string, [number, number, number]][] = [['inn', [-3.81 + 1 * 2.54, T + 0.05, -3.9]], ['inp', [-3.81 + 2 * 2.54, T + 0.05, 3.9]], ['out', [-3.81 + 0 * 2.54, T + 0.05, -3.9]]];
      for (const [id, from] of route) {
        const [px, pz] = pinLocal(c, id);
        g.add(lead([from, [from[0], T + 0.05, pz], [px, T + 0.05, pz]], 0.22, GOLD()));
      }
      break;
    }
    default:
      buildExtra(c, g, info);
      break;
    case 'netlabel': {
      g.add(mesh(new THREE.CylinderGeometry(0.6, 0.6, 6, 10), GOLD(), 0, T + 3, 0));
      const flag = mesh(new THREE.BoxGeometry(5, 2.6, 0.3), mat('#ff3fa4'), 2.8, T + 4.8, 0);
      g.add(flag);
      break;
    }
  }
  // Pad mạ vàng ở mỗi chân
  for (const p of LIBRARY[c.type].pins) {
    const pad = mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.12, 18), GOLD(), p.x * MM_PER_PX, T + 0.06, p.y * MM_PER_PX);
    g.add(pad);
  }
  g.rotation.y = -(c.rot * Math.PI) / 180; // rot theo chiều kim đồng hồ khi nhìn từ trên (Z hướng xuống màn hình)
  return info;
}

/** Nhãn dạng sprite (ref, giá trị) */
export function labelSprite(text: string, sub = '', color = '#17141f', screenSpace = true): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const scale = 2;
  canvas.width = 256 * scale; canvas.height = 96 * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.font = '700 34px ui-monospace, Consolas, monospace';
  const w = Math.max(ctx.measureText(text).width, sub ? (ctx.font = '26px ui-monospace, Consolas, monospace', ctx.measureText(sub).width) : 0) + 24;
  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  const x0 = (256 - w) / 2;
  ctx.beginPath();
  ctx.roundRect(x0, 8, w, sub ? 80 : 50, 10);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.font = '700 34px ui-monospace, Consolas, monospace';
  ctx.fillText(text, 128, 44);
  if (sub) { ctx.fillStyle = '#6b4a8a'; ctx.font = '26px ui-monospace, Consolas, monospace'; ctx.fillText(sub, 128, 76); }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  // screenSpace: kích thước cố định trên màn hình, luôn đọc được khi zoom
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, sizeAttenuation: !screenSpace }));
  if (screenSpace) s.scale.set(0.1, 0.0375, 1); else s.scale.set(12, 4.5, 1);
  s.renderOrder = 10;
  return s;
}

// ───────────────────────── Linh kiện mở rộng ─────────────────────────
const TR = () => GOLD();
const PCB_BLUE = () => mat('#1d4fa8', { roughness: 0.55, clearcoat: 0.3 });
const PCB_BLACK = () => mat('#18191f', { roughness: 0.55, clearcoat: 0.3 });

/** Đường mạch vàng từ chân linh kiện (x, z tại mặt bo) tới pad của chân schematic. */
function trace(g: THREE.Group, c: ComponentInstance, pinId: string, from: [number, number]) {
  const [px, pz] = pinLocal(c, pinId);
  const y = BOARD_TOP + 0.05;
  g.add(lead([[from[0], y, from[1]], [from[0], y, pz], [px, y, pz]], 0.2, TR()));
}

/** Mặt in chữ */
function printedTop(w: number, d: number, y: number, lines: string[], bg = '#141419', fg = '#c9c9d4', x = 0, z = 0): THREE.Mesh {
  const top = mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshPhysicalMaterial({ map: chipTopTexture(lines, bg, fg), roughness: 0.5, clearcoat: 0.4 }), x, y, z);
  top.rotation.x = -Math.PI / 2;
  return top;
}

/** Vỏ DIP n chân; map: id chân schematic → số chân vật lý (1 ở góc trái dưới, đếm ngược chiều kim đồng hồ). */
function dip(g: THREE.Group, c: ComponentInstance, n: number, map: Record<string, number>, lines: string[]) {
  const T = BOARD_TOP, half = n / 2, pitch = 2.54;
  const len = half * pitch + 0.8, w = 6.4;
  g.add(mesh(new THREE.BoxGeometry(len, 3.2, w), BLACK(), 0, T + 2.3, 0));
  g.add(printedTop(len - 0.3, w - 0.2, T + 3.91, lines));
  const foot = new Map<number, [number, number]>();
  for (let i = 0; i < half; i++) {
    const x = -((half - 1) / 2) * pitch + i * pitch;
    for (const [num, s] of [[i + 1, 1], [n - i, -1]] as const) {
      g.add(lead([[x, T + 1.6, s * 3.2], [x, T + 1.6, s * 3.9], [x, T, s * 3.9]], 0.25));
      foot.set(num, [x, s * 3.9]);
    }
  }
  for (const [id, num] of Object.entries(map)) trace(g, c, id, foot.get(num)!);
}

/** Vỏ TO-220 đứng (ổn áp, MOSFET công suất, SCR); order: id chân theo thứ tự chân 1-2-3. */
function to220(g: THREE.Group, c: ComponentInstance, order: [string, string, string], lines: string[], heatsink = false) {
  const T = BOARD_TOP, y0 = T + 3.2;
  g.add(mesh(new THREE.BoxGeometry(10, 9, 4.4), BLACK(), 0, y0 + 4.5, 0.4));
  g.add(mesh(new THREE.BoxGeometry(10, 15, 1.3), METAL(), 0, y0 + 7.5, -2.4));
  const hole = mesh(new THREE.CylinderGeometry(1.8, 1.8, 1.5, 20), mat('#0b0b0d'), 0, y0 + 12, -2.4);
  hole.rotation.x = Math.PI / 2;
  g.add(hole);
  const face = mesh(new THREE.PlaneGeometry(9.6, 6), new THREE.MeshPhysicalMaterial({ map: chipTopTexture(lines), roughness: 0.5, clearcoat: 0.4 }), 0, y0 + 4.5, 2.61);
  g.add(face);
  if (heatsink) {
    for (let i = 0; i < 6; i++) g.add(mesh(new THREE.BoxGeometry(1, 16, 12), mat('#2a2d34', { metalness: 0.7, roughness: 0.4 }), -6.25 + i * 2.5, y0 + 8, -9));
    g.add(mesh(new THREE.BoxGeometry(14, 16, 1.4), mat('#2a2d34', { metalness: 0.7, roughness: 0.4 }), 0, y0 + 8, -3.8));
  }
  order.forEach((id, i) => {
    const x = (i - 1) * 2.54;
    g.add(lead([[x, y0, 0.4], [x, T, 0.4]], 0.4, METAL()));
    trace(g, c, id, [x, 0.4]);
  });
}

/** Vỏ TO-92; order: id chân từ trái sang phải khi nhìn mặt phẳng. */
function to92(g: THREE.Group, c: ComponentInstance, order: [string, string, string], lines: string[]) {
  const T = BOARD_TOP;
  g.add(mesh(new THREE.CylinderGeometry(2.3, 2.3, 4.6, 24, 1, false, 0, Math.PI), BLACK(), 0, T + 6, 0));
  const face = mesh(new THREE.PlaneGeometry(4.6, 4.6), new THREE.MeshPhysicalMaterial({ map: chipTopTexture(lines), roughness: 0.5 }), 0, T + 6, -0.01);
  face.rotation.y = Math.PI;
  g.add(face);
  order.forEach((id, i) => {
    const x = (i - 1) * 1.27;
    g.add(lead([[x, T + 3.7, 0], [x, T + 1, 0]], 0.22));
    trace(g, c, id, [x, 0]);
  });
}

/** Bo mô-đun (Arduino, cảm biến...) cắm trên header tại đúng vị trí các chân schematic. */
function moduleBoard(g: THREE.Group, c: ComponentInstance, pcb: THREE.Material, height = 9, pad = 2.2) {
  const T = BOARD_TOP;
  const pins = LIBRARY[c.type].pins.map((p) => [p.x * MM_PER_PX, p.y * MM_PER_PX] as const);
  const xs = pins.map((p) => p[0]), zs = pins.map((p) => p[1]);
  const box = LIBRARY[c.type].box;
  const bx = box ? (box.hw + 20) * MM_PER_PX : 5, bz = box ? box.hh * MM_PER_PX : 5;
  const x0 = Math.min(-bx, ...xs) - pad, x1 = Math.max(bx, ...xs) + pad, z0 = Math.min(-bz, ...zs) - pad, z1 = Math.max(bz, ...zs) + pad;
  const w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const top = T + height + 1.6;
  g.add(mesh(new THREE.BoxGeometry(w, 1.6, d), pcb, cx, T + height + 0.8, cz));
  for (const [px, pz] of pins) {
    g.add(mesh(new THREE.BoxGeometry(2.4, 2.5, 2.4), BLACK(), px, T + 1.25, pz));
    g.add(mesh(new THREE.BoxGeometry(0.64, height + 3, 0.64), GOLD(), px, T + (height + 3) / 2, pz));
    g.add(mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.1, 14), GOLD(), px, top + 0.05, pz));
  }
  return { top, w, d, cx, cz };
}

function knob(g: THREE.Group, x: number, y: number, z: number, r: number, color = '#f2f2f2') {
  g.add(mesh(new THREE.CylinderGeometry(r, r, 1.2, 24), mat(color), x, y + 0.6, z));
  g.add(mesh(new THREE.BoxGeometry(r * 1.6, 0.3, 0.5), mat('#333'), x, y + 1.3, z));
}

function axial(g: THREE.Group, c: ComponentInstance, body: THREE.Object3D, y: number, halfLen: number) {
  const [x1] = pinLocal(c, LIBRARY[c.type].pins[0].id), [x2] = pinLocal(c, LIBRARY[c.type].pins[1].id);
  g.add(body);
  g.add(lead([[x1, BOARD_TOP, 0], [x1, y, 0], [-halfLen, y, 0]]), lead([[halfLen, y, 0], [x2, y, 0], [x2, BOARD_TOP, 0]]));
}

/** Chân thẳng đứng từ thân xuống bo rồi chạy mạch tới pad */
function legs(g: THREE.Group, c: ComponentInstance, list: [string, number, number][], fromY: number) {
  for (const [id, x, z] of list) {
    g.add(lead([[x, fromY, z], [x, BOARD_TOP, z]], 0.28));
    trace(g, c, id, [x, z]);
  }
}

export function buildExtra(c: ComponentInstance, g: THREE.Group, info: ModelInfo) {
  const T = BOARD_TOP;
  const name = c.params.model ? modelLabel(c.params.model) : '';
  switch (c.type) {
    case 'potentiometer': {
      g.add(mesh(new THREE.BoxGeometry(9.5, 5, 9.5), mat('#2f62d6', { roughness: 0.4 }), 0, T + 2.5, 0));
      knob(g, 0, T + 5, 0, 3);
      legs(g, c, [['1', -2.54, 2.5], ['w', 0, -2.5], ['2', 2.54, 2.5]], T + 0.5);
      break;
    }
    case 'fuse': {
      const y = T + 3;
      const grp = new THREE.Group();
      const glass = mesh(new THREE.CylinderGeometry(1.5, 1.5, 14, 24), new THREE.MeshPhysicalMaterial({ color: '#e8f4ff', transmission: 0.7, transparent: true, opacity: 0.45, roughness: 0.05, clearcoat: 1 }), 0, y, 0);
      glass.rotation.z = Math.PI / 2;
      grp.add(glass);
      for (const s of [-1, 1]) { const cap = mesh(new THREE.CylinderGeometry(1.6, 1.6, 3, 24), METAL(), s * 7.5, y, 0); cap.rotation.z = Math.PI / 2; grp.add(cap); }
      const wire = mesh(new THREE.CylinderGeometry(0.12, 0.12, 13, 6), mat('#c0c0c0', { metalness: 0.8 }), 0, y, 0); wire.rotation.z = Math.PI / 2; grp.add(wire);
      axial(g, c, grp, y, 9);
      break;
    }
    case 'crystal': {
      const can = mesh(new THREE.CapsuleGeometry(1.8, 6.6, 6, 16), METAL(), 0, T + 4.5, 0);
      can.rotation.z = Math.PI / 2;
      can.scale.set(1, 1, 0.55);
      g.add(can);
      g.add(mesh(new THREE.BoxGeometry(11, 0.6, 4.6), METAL(), 0, T + 0.8, 0));
      legs(g, c, [['1', -2.44, 0], ['2', 2.44, 0]], T + 0.5);
      break;
    }
    case 'transformer': {
      g.add(mesh(new THREE.BoxGeometry(16, 13, 13), mat('#4a4d55', { metalness: 0.6, roughness: 0.45 }), 0, T + 6.5, 0));
      g.add(mesh(new THREE.BoxGeometry(9, 9.5, 14), mat('#b8692e', { metalness: 0.7, roughness: 0.35 }), 0, T + 6.5, 0));
      g.add(mesh(new THREE.BoxGeometry(9.2, 6, 14.2), mat('#e8d37a', { roughness: 0.7 }), 0, T + 6.5, 0));
      legs(g, c, [['p1', -6, -5], ['p2', -6, 5], ['s1', 6, -5], ['s2', 6, 5]], T + 0.5);
      break;
    }
    case 'ldr': {
      const y = T + 5;
      const disc = mesh(new THREE.CylinderGeometry(2.6, 2.6, 2, 28), mat('#efe7d0', { roughness: 0.3, clearcoat: 1 }), 0, y, 0);
      g.add(disc);
      g.add(printedTop(3.6, 3.6, y + 1.01, ['≈≈', ''], '#c2512a', '#6a1d08'));
      legs(g, c, [['1', -1.6, 0], ['2', 1.6, 0]], y - 1);
      break;
    }
    case 'thermistor': {
      g.add(mesh(new THREE.SphereGeometry(1.8, 20, 14), mat('#1f2a1e', { roughness: 0.3, clearcoat: 1 }), 0, T + 6, 0));
      legs(g, c, [['1', -1.27, 0], ['2', 1.27, 0]], T + 5);
      break;
    }
    case 'pushbutton': {
      const on = c.params.pressed === '1';
      g.add(mesh(new THREE.BoxGeometry(6, 3.5, 6), BLACK(), 0, T + 1.75, 0));
      g.add(mesh(new THREE.BoxGeometry(6.1, 0.3, 6.1), METAL(), 0, T + 3.6, 0));
      g.add(mesh(new THREE.CylinderGeometry(1.75, 1.75, on ? 0.5 : 1.5, 22), mat(on ? '#ff3fa4' : '#26262b'), 0, T + 3.75 + (on ? 0.25 : 0.75), 0));
      legs(g, c, [['1', -3.25, 0], ['2', 3.25, 0]], T + 0.6);
      break;
    }
    case 'relay': {
      g.add(mesh(new THREE.BoxGeometry(19, 15.5, 15.5), mat('#2f62d6', { roughness: 0.35, clearcoat: 0.8 }), 0, T + 7.75, 0));
      g.add(printedTop(17, 13, T + 15.51, ['SRD-' + (c.params.coil ?? '5V').replace('V', '') + 'VDC', '10A 250VAC'], '#2f62d6', '#e8f0ff'));
      legs(g, c, [['c1', -6, -6], ['c2', -6, 6], ['com', 8, 0], ['no', 6, -6], ['nc', 6, 6]], T + 0.5);
      break;
    }
    case 'lamp': {
      const y = T + 7;
      const glow = new THREE.MeshPhysicalMaterial({ color: '#fff4d6', transparent: true, opacity: 0.55, transmission: 0.6, roughness: 0.05, clearcoat: 1, emissive: '#ffcc66', emissiveIntensity: 0 });
      g.add(mesh(new THREE.SphereGeometry(4, 28, 20), glow, 0, y + 2, 0));
      g.add(mesh(new THREE.CylinderGeometry(2.2, 2.2, 4, 20), METAL(), 0, y - 2.4, 0));
      g.add(mesh(new THREE.TorusGeometry(1.2, 0.12, 6, 16), mat('#ffb347', { emissive: '#ff8c1a', emissiveIntensity: 0.6 }), 0, y + 2, 0));
      const light = new THREE.PointLight('#ffcc66', 0, 50, 2);
      light.position.set(0, y + 2, 0);
      g.add(light);
      info.led = { material: glow, light, scale: 0.4 };
      legs(g, c, [['1', -1.27, 0], ['2', 1.27, 0]], y - 4.4);
      break;
    }
    case 'buzzer': {
      g.add(mesh(new THREE.CylinderGeometry(6, 6, 9.5, 32), BLACK(), 0, T + 4.75, 0));
      g.add(mesh(new THREE.CylinderGeometry(1, 1, 0.2, 16), mat('#000'), 0, T + 9.55, 0));
      g.add(mesh(new THREE.TorusGeometry(4.5, 0.15, 6, 32), mat('#2a2a30'), 0, T + 9.52, 0).rotateX(Math.PI / 2));
      legs(g, c, [['p', -3.8, 0], ['n', 3.8, 0]], T + 0.5);
      break;
    }
    case 'speaker': {
      g.add(mesh(new THREE.CylinderGeometry(11, 11, 1.2, 40), mat('#2b2b31', { metalness: 0.5, roughness: 0.4 }), 0, T + 4, 0));
      g.add(mesh(new THREE.CylinderGeometry(9.5, 3, 3, 40, 1, true), mat('#3a3a42', { roughness: 0.8, side: THREE.DoubleSide }), 0, T + 5.8, 0));
      g.add(mesh(new THREE.SphereGeometry(3, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat('#111'), 0, T + 4.3, 0));
      g.add(mesh(new THREE.CylinderGeometry(5, 5, 3, 24), METAL(), 0, T + 2, 0));
      legs(g, c, [['p', -3, 4], ['n', 3, 4]], T + 0.5);
      break;
    }
    case 'motor': {
      const y = T + 6;
      const can = mesh(new THREE.CylinderGeometry(5, 5, 16, 32), METAL(), 0, y, 0); can.rotation.z = Math.PI / 2; g.add(can);
      const cap = mesh(new THREE.CylinderGeometry(5.05, 5.05, 3, 32), mat('#e0e0e0'), 9, y, 0); cap.rotation.z = Math.PI / 2; g.add(cap);
      const shaft = mesh(new THREE.CylinderGeometry(0.8, 0.8, 7, 12), METAL(), -11, y, 0); shaft.rotation.z = Math.PI / 2; g.add(shaft);
      g.add(lead([[10.5, y + 2, 0], [12, y + 2, 0], [12, T, 0]], 0.3, mat('#d01f2f')));
      g.add(lead([[10.5, y - 2, 0], [12, y - 2, 0], [12, T + 0.3, 0]], 0.3, mat('#18181c')));
      trace(g, c, 'p', [12, 0]); trace(g, c, 'n', [12, 0]);
      break;
    }
    case 'vcvs': case 'vccs': {
      g.add(mesh(new THREE.BoxGeometry(11, 5, 11), mat('#3b2a6b', { roughness: 0.35 }), 0, T + 2.8, 0));
      g.add(printedTop(10, 10, T + 5.31, [c.type === 'vcvs' ? 'E' : 'G', `×${c.params.gain}`], '#3b2a6b', '#e6dcff'));
      legs(g, c, [['p', 4, -4], ['n', 4, 4], ['cp', -4, -4], ['cn', -4, 4]], T + 0.5);
      break;
    }
    case 'bridge': {
      g.add(mesh(new THREE.BoxGeometry(8.4, 3.4, 6.4), BLACK(), 0, T + 2.2, 0));
      g.add(printedTop(8, 6, T + 3.91, ['DB107', '+ ~ ~ −']));
      legs(g, c, [['p', -3.8, 2.5], ['ac1', -1.3, 2.5], ['ac2', 1.3, 2.5], ['n', 3.8, 2.5]], T + 0.6);
      break;
    }
    case 'nmos': case 'pmos': case 'njfet': case 'pjfet': {
      const small = /2N7000|BS170|BS250|J2N|JJ/.test(c.params.model);
      if (small) to92(g, c, c.type.endsWith('jfet') ? ['d', 's', 'g'] : ['s', 'g', 'd'], [name, '']);
      else to220(g, c, ['g', 'd', 's'], [name, c.type === 'nmos' ? 'N-MOS' : 'P-MOS']);
      break;
    }
    case 'scr': to220(g, c, ['k', 'a', 'g'], ['BT151', 'SCR']); break;
    case 'optocoupler': dip(g, c, 4, { a: 1, k: 2, e: 3, c: 4 }, ['PC817', c.ref]); break;
    case 'opamp_ic': dip(g, c, 8, { out: 1, inn: 2, inp: 3, vee: 4, vcc: 8 }, [c.params.model, c.ref]); break;
    case 'comparator': dip(g, c, 8, { out: 1, inn: 2, inp: 3, gnd: 4, vcc: 8 }, ['LM393', c.ref]); break;
    case 'timer555': dip(g, c, 8, { gnd: 1, trig: 2, out: 3, reset: 4, ctrl: 5, thr: 6, dis: 7, vcc: 8 }, ['NE555', c.ref]); break;
    case 'logic_gate': {
      const chip = { AND: '74HC08', NAND: '74HC00', OR: '74HC32', NOR: '74HC02', XOR: '74HC86', XNOR: '74HC266' }[c.params.gate as 'AND'] ?? '74HC00';
      dip(g, c, 14, { a: 1, b: 2, y: 3 }, [chip, c.ref]);
      break;
    }
    case 'logic_not': dip(g, c, 14, { a: 1, y: 2 }, ['74HC04', c.ref]); break;
    case 'atmega328p': {
      const map: Record<string, number> = {};
      for (let i = 1; i <= 28; i++) map[`p${i}`] = i;
      dip(g, c, 28, map, ['ATMEGA328P', c.ref]);
      break;
    }
    case 'vreg': to220(g, c, ['in', 'gnd', 'out'], [c.params.model.startsWith('AMS') ? c.params.model : 'L' + c.params.model, c.ref], true); break;
    case 'lm317': to220(g, c, ['adj', 'out', 'in'], ['LM317', c.ref], true); break;
    case 'arduino_nano': {
      const b = moduleBoard(g, c, PCB_BLUE());
      g.add(mesh(new THREE.BoxGeometry(7, 1.2, 7), BLACK(), b.cx, b.top + 0.6, b.cz).rotateY(Math.PI / 4));
      g.add(printedTop(6, 6, b.top + 1.21, ['ATMEGA', '328P'], '#141419', '#c9c9d4', b.cx, b.cz));
      g.add(mesh(new THREE.BoxGeometry(8, 4, 9), METAL(), b.cx, b.top + 2, b.cz - b.d / 2 + 4));
      g.add(mesh(new THREE.BoxGeometry(3, 1.6, 3.5), mat('#f4f4f4'), b.cx + 5, b.top + 0.8, b.cz + b.d / 4));
      g.add(mesh(new THREE.BoxGeometry(1.2, 0.6, 0.8), mat('#22e07a', { emissive: '#22e07a', emissiveIntensity: 1.6 }), b.cx - 5, b.top + 0.3, b.cz + b.d / 4));
      g.add(printedTop(b.w * 0.5, 4, b.top + 0.02, ['ARDUINO', 'NANO'], '#1d4fa8', '#e8f0ff', b.cx, b.cz + b.d / 2 - 6));
      break;
    }
    case 'esp32': {
      const b = moduleBoard(g, c, PCB_BLACK());
      const sh = mesh(new THREE.BoxGeometry(16, 2.6, 18), mat('#c8cbd2', { metalness: 0.9, roughness: 0.25 }), b.cx, b.top + 1.3, b.cz - b.d / 2 + 14);
      g.add(sh);
      g.add(printedTop(15, 17, b.top + 2.62, ['ESP32', 'WROOM-32'], '#bfc3cb', '#30333a', b.cx, b.cz - b.d / 2 + 14));
      g.add(mesh(new THREE.BoxGeometry(16, 0.2, 5), mat('#c9a227', { metalness: 0.8 }), b.cx, b.top + 0.1, b.cz - b.d / 2 + 2.6));
      g.add(mesh(new THREE.BoxGeometry(8, 3, 6), METAL(), b.cx, b.top + 1.5, b.cz + b.d / 2 - 3));
      break;
    }
    case 'dht22': {
      const b = moduleBoard(g, c, PCB_BLUE(), 4);
      g.add(mesh(new THREE.BoxGeometry(12, 6, 15), mat('#d8d8d8', { roughness: 0.85, clearcoat: 0 }), b.cx + 2, b.top + 3, b.cz));
      for (let i = 0; i < 4; i++) for (let j = 0; j < 5; j++) g.add(mesh(new THREE.BoxGeometry(1.6, 0.4, 1.6), mat('#9aa0a8'), b.cx - 2.5 + i * 3, b.top + 6.1, b.cz - 5.6 + j * 2.8));
      break;
    }
    case 'hcsr04': {
      const b = moduleBoard(g, c, PCB_BLUE(), 4);
      for (const s of [-1, 1]) {
        const can = mesh(new THREE.CylinderGeometry(4, 4, 12, 28), METAL(), b.cx + 3, b.top + 6, b.cz + s * 6.5);
        g.add(can);
        g.add(mesh(new THREE.CylinderGeometry(3.6, 3.6, 0.2, 28), mat('#3a3a42', { roughness: 0.9 }), b.cx + 3, b.top + 12.05, b.cz + s * 6.5));
      }
      break;
    }
    case 'oled_i2c': {
      const b = moduleBoard(g, c, PCB_BLUE(), 4);
      g.add(mesh(new THREE.BoxGeometry(b.w - 3, 1.4, b.d - 3), mat('#0a0a0e', { roughness: 0.15, clearcoat: 1 }), b.cx + 1, b.top + 0.7, b.cz));
      info.screen = makeScreen('oled', 128, 64);
      const scr = mesh(new THREE.PlaneGeometry(Math.min(b.w - 6, 2 * (b.d - 6)), Math.min(b.d - 6, (b.w - 6) / 2)), info.screen.mat, b.cx + 1, b.top + 1.42, b.cz);
      scr.rotation.x = -Math.PI / 2;
      g.add(scr);
      break;
    }
    case 'lcd1602': {
      const blue = c.params.color !== 'Xanh lá';
      const b = moduleBoard(g, c, mat('#1f7a3a', { roughness: 0.55, clearcoat: 0.3 }), 4);
      g.add(mesh(new THREE.BoxGeometry(b.w - 8, 6, b.d - 6), mat('#111116', { roughness: 0.4 }), b.cx + 2, b.top + 3, b.cz));
      info.screen = makeScreen('lcd', 320, 80, blue);
      const sw = b.w - 14, sd = Math.min(b.d - 12, sw / 4);
      const scr = mesh(new THREE.PlaneGeometry(sw, sd), info.screen.mat, b.cx + 2, b.top + 6.02, b.cz);
      scr.rotation.x = -Math.PI / 2;
      g.add(scr);
      break;
    }
    case 'seg7': case 'seg7x4': {
      const n = c.type === 'seg7x4' ? 4 : 1;
      const w = n === 4 ? 40 : 12.6, d = 19, h = 8;
      const yTop = T + 3 + h;
      g.add(mesh(new THREE.BoxGeometry(w, h, d), mat('#16161b', { roughness: 0.5 }), 0, T + 3 + h / 2, 0));
      g.add(mesh(new THREE.BoxGeometry(w - 0.6, 0.05, d - 0.6), mat('#0b0b0e', { roughness: 0.25, clearcoat: 1 }), 0, yTop + 0.02, 0));
      const color = ({ LED_GREEN: '#22e07a', LED_BLUE: '#3a8dff', LED_YELLOW: '#ffc21a', LED_WHITE: '#e8efff' } as Record<string, string>)[c.params.model] ?? '#ff2b45';
      info.segs = {};
      const L = 4.2, W = 0.9;
      const bars: Record<string, [number, number, boolean]> = { a: [0, -5, true], b: [2.6, -2.5, false], c: [2.6, 2.5, false], d: [0, 5, true], e: [-2.6, 2.5, false], f: [-2.6, -2.5, false], g: [0, 0, true] };
      for (let i = 0; i < n; i++) {
        const x0 = n === 1 ? 0 : -14.4 + i * 9.6;
        for (const [sg, [bx, bz, horiz]] of Object.entries(bars)) {
          const m = new THREE.MeshStandardMaterial({ color: '#2a2630', emissive: color, emissiveIntensity: 0, roughness: 0.4 });
          const bar = mesh(new THREE.BoxGeometry(horiz ? L : W, 0.1, horiz ? W : L), m, x0 + bx - bz * 0.1, yTop + 0.08, bz);
          g.add(bar);
          info.segs[`${i}:${sg}`] = m;
        }
        const dm = new THREE.MeshStandardMaterial({ color: '#2a2630', emissive: color, emissiveIntensity: 0, roughness: 0.4 });
        g.add(mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.1, 12), dm, x0 + 3.9, yTop + 0.08, 5.2));
        info.segs[`${i}:dp`] = dm;
      }
      // chân: nửa trên một cạnh dài, nửa dưới cạnh kia
      const ids = LIBRARY[c.type].pins.map((p) => p.id);
      const half = Math.ceil(ids.length / 2);
      ids.forEach((id, k) => {
        const side = k < half ? -1 : 1, idx = k < half ? k : k - half, cnt = k < half ? half : ids.length - half;
        const x = -((cnt - 1) / 2) * 2.54 + idx * 2.54;
        g.add(lead([[x, T + 3, side * (d / 2 - 1.5)], [x, T, side * (d / 2 - 1.5)]], 0.25));
        trace(g, c, id, [x, side * (d / 2 - 1.5)]);
      });
      break;
    }
    case 'servo': {
      const b = moduleBoard(g, c, PCB_BLACK(), 4);
      g.add(mesh(new THREE.BoxGeometry(23, 22, 12.5), mat('#2f62d6', { roughness: 0.4, clearcoat: 0.6 }), b.cx + 14, T + 11, b.cz));
      g.add(mesh(new THREE.CylinderGeometry(2.4, 2.4, 4, 20), mat('#f2f2f2'), b.cx + 20, T + 24, b.cz));
      g.add(mesh(new THREE.BoxGeometry(16, 1.2, 3), mat('#f2f2f2'), b.cx + 20, T + 26.2, b.cz));
      break;
    }
    case 'header2': case 'header3': case 'header4': {
      const pins = LIBRARY[c.type].pins;
      for (const p of pins) {
        const x = p.x * MM_PER_PX, z = p.y * MM_PER_PX;
        g.add(mesh(new THREE.BoxGeometry(2.5, 2.5, 2.5), BLACK(), x, T + 1.25, z));
        g.add(mesh(new THREE.BoxGeometry(0.64, 9, 0.64), GOLD(), x, T + 4.5, z));
      }
      break;
    }
    case 'usb_c': {
      const b = moduleBoard(g, c, PCB_BLACK(), 3);
      const rc = mesh(new THREE.CapsuleGeometry(1.6, 6, 6, 16), METAL(), b.cx - b.w / 2 + 3.5, b.top + 1.6, b.cz);
      rc.rotation.x = Math.PI / 2;
      rc.scale.set(1, 1.6, 1);
      g.add(rc);
      break;
    }
    case 'power': {
      g.add(mesh(new THREE.CylinderGeometry(0.6, 0.6, 6, 10), GOLD(), 0, T + 3, 0));
      g.add(mesh(new THREE.BoxGeometry(5, 2.6, 0.3), mat('#e5484d'), 2.8, T + 4.8, 0));
      const [px, pz] = pinLocal(c, 'n');
      g.add(lead([[0, T + 0.05, 0], [px, T + 0.05, pz]], 0.2, GOLD()));
      break;
    }
    default: {
      // dự phòng: hộp đen có nhãn
      const def = LIBRARY[c.type];
      const w = def.box ? def.box.hw * 2 * MM_PER_PX : 8, d = def.box ? def.box.hh * 2 * MM_PER_PX : 8;
      g.add(mesh(new THREE.BoxGeometry(w, 3, d), BLACK(), 0, T + 1.5, 0));
      g.add(printedTop(w - 0.2, d - 0.2, T + 3.01, [def.box?.label ?? def.name, c.ref]));
    }
  }
}

function makeScreen(kind: 'lcd' | 'oled', w: number, h: number, blue = true): ScreenInfo {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (kind === 'oled') { tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; }
  const m = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: '#ffffff', emissiveIntensity: kind === 'oled' ? 1.3 : 0.9, roughness: 0.3 });
  const info: ScreenInfo = { kind, canvas, tex, mat: m, ver: '', blue };
  drawScreen(info, null);
  return info;
}

/** Vẽ nội dung màn hình: LCD (2 dòng chữ) hoặc OLED (bộ đệm 128×64). */
export function drawScreen(sc: ScreenInfo, data: { lines?: string[]; backlight?: boolean; fb?: Uint8Array; on?: boolean; invert?: boolean } | null) {
  const ctx = sc.canvas.getContext('2d')!;
  const { width: w, height: h } = sc.canvas;
  if (sc.kind === 'lcd') {
    const on = !!data?.backlight;
    ctx.fillStyle = sc.blue ? (on ? '#2f6cf0' : '#14254a') : (on ? '#8fd14f' : '#33461f');
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = sc.blue ? '#f2f6ff' : '#14200b';
    ctx.font = '700 30px ui-monospace, Consolas, monospace';
    ctx.textBaseline = 'middle';
    const lines = data?.lines ?? ['', ''];
    for (let r = 0; r < 2; r++) {
      const t = (lines[r] ?? '').padEnd(16, ' ');
      for (let i = 0; i < 16; i++) {
        if (!data) { ctx.globalAlpha = 0.12; ctx.fillRect(4 + i * 19.6, 8 + r * 38, 17, 28); ctx.globalAlpha = 1; continue; }
        ctx.fillText(t[i], 6 + i * 19.6, 22 + r * 38);
      }
    }
    sc.mat.emissiveIntensity = on ? 0.9 : 0.15;
  } else {
    const img = ctx.createImageData(w, h);
    const fb = data?.on ? data.fb : undefined;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let px = fb ? !!(fb[(y >> 3) * 128 + x] & (1 << (y & 7))) : false;
      if (fb && data?.invert) px = !px;
      const i = (y * w + x) * 4;
      img.data[i] = px ? 110 : 2; img.data[i + 1] = px ? 200 : 4; img.data[i + 2] = px ? 255 : 8; img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }
  sc.tex.needsUpdate = true;
}
