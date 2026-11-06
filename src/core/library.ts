// Thư viện linh kiện: chân logic ổn định, tham số có kiểu, ánh xạ SPICE tường minh (xem spice.ts, spiceLib.ts).
import { GATE_FUNCS, OPAMP_PARAMS, RELAY_PARAMS, SPICE_MODELS, VREG_PARAMS } from './spiceLib';
import type { ComponentType } from './types';

export { SPICE_MODELS, DIODE_PARAMS } from './spiceLib';

export const GRID = 10;

export interface PinDef {
  id: string;
  name: string;
  /** offset so với tâm linh kiện khi rot = 0 */
  x: number;
  y: number;
}

export type SimSupport = 'verified' | 'model' | 'display';

export interface ParamDef {
  key: string;
  label: string;
  kind: 'value' | 'text' | 'select' | 'bool' | 'firmware';
  /** không hiện trong bảng thuộc tính / không gửi cho AI */
  hidden?: boolean;
  unit?: string;
  options?: string[];
  help?: string;
}

export type Category = 'Nguồn' | 'Thụ động' | 'Cơ điện' | 'Bán dẫn' | 'Tích hợp' | 'Hiển thị' | 'Vi điều khiển & mô-đun' | 'Kết nối';
export const CATEGORIES: Category[] = ['Nguồn', 'Thụ động', 'Cơ điện', 'Bán dẫn', 'Tích hợp', 'Hiển thị', 'Vi điều khiển & mô-đun', 'Kết nối'];

export interface ComponentDef {
  type: ComponentType;
  name: string;
  category: Category;
  prefix: string;
  pins: PinDef[];
  params: ParamDef[];
  defaults: Record<string, string>;
  /** Trạng thái mô phỏng: đã kiểm chứng / có mô hình / chỉ hiển thị */
  sim: SimSupport;
  /** Bộ giải tích hợp hỗ trợ (ngoài ngspice) */
  builtin: boolean;
  description: string;
  /** Ký hiệu dạng hộp IC: nửa rộng/nửa cao thân và nhãn */
  box?: { hw: number; hh: number; label: string };
  /** từ khoá tìm kiếm thêm (mã linh kiện…) */
  keywords?: string;
}

const twoPinH: PinDef[] = [
  { id: '1', name: '1', x: -40, y: 0 },
  { id: '2', name: '2', x: 40, y: 0 },
];
const twoPinV = (p = 'p', n = 'n'): PinDef[] => [
  { id: p, name: '+', x: 0, y: -40 },
  { id: n, name: '−', x: 0, y: 40 },
];
const diodePins: PinDef[] = [{ id: 'a', name: 'A', x: -40, y: 0 }, { id: 'k', name: 'K', x: 40, y: 0 }];
const fetPins = (topId: string, botId: string, topName: string, botName: string): PinDef[] => [
  { id: topId, name: topName, x: 20, y: -40 },
  { id: 'g', name: 'G', x: -40, y: 0 },
  { id: botId, name: botName, x: 20, y: 40 },
];

type PinSpec = [id: string, name: string];
/** Chân cho ký hiệu hộp: trái/phải cách thân 20, khoảng cách chân 20. */
function boxPins(o: { left?: PinSpec[]; right?: PinSpec[]; top?: PinSpec[]; bottom?: PinSpec[]; hw?: number; label: string; minHh?: number }): { pins: PinDef[]; box: ComponentDef['box'] } {
  const hw = o.hw ?? 40;
  const nSide = Math.max(o.left?.length ?? 0, o.right?.length ?? 0, 1);
  const hh = Math.max(o.minHh ?? 30, nSide * 10 + 10);
  const pins: PinDef[] = [];
  const col = (list: PinSpec[] | undefined, x: number) => list?.forEach(([id, name], i) => pins.push({ id, name, x, y: (i - (list.length - 1) / 2) * 20 }));
  const row = (list: PinSpec[] | undefined, y: number) => list?.forEach(([id, name], i) => pins.push({ id, name, x: (i - (list.length - 1) / 2) * 20, y }));
  col(o.left, -(hw + 20));
  col(o.right, hw + 20);
  row(o.top, -(hh + 20));
  row(o.bottom, hh + 20);
  return { pins, box: { hw, hh, label: o.label } };
}

const MODEL_SEL = (label: string, options: string[]): ParamDef => ({ key: 'model', label, kind: 'select', options });
const sel = (key: string, label: string, options: readonly string[], help?: string): ParamDef => ({ key, label, kind: 'select', options: [...options], help });

const nano = boxPins({
  hw: 50, label: 'ARDUINO NANO',
  left: [['vin', 'VIN'], ['5v', '5V'], ['3v3', '3V3'], ['gnd', 'GND'], ['a0', 'A0'], ['a1', 'A1'], ['a2', 'A2'], ['a3', 'A3'], ['a4', 'A4/SDA'], ['a5', 'A5/SCL'], ['a6', 'A6'], ['a7', 'A7'], ['rst', 'RST']],
  right: [['d0', 'D0/RX'], ['d1', 'D1/TX'], ['d2', 'D2'], ['d3', 'D3~'], ['d4', 'D4'], ['d5', 'D5~'], ['d6', 'D6~'], ['d7', 'D7'], ['d8', 'D8'], ['d9', 'D9~'], ['d10', 'D10~'], ['d11', 'D11/MOSI'], ['d12', 'D12/MISO'], ['d13', 'D13/SCK']],
});
const esp32 = boxPins({
  hw: 50, label: 'ESP32 DEVKIT',
  left: [['3v3', '3V3'], ['en', 'EN'], ['io36', 'IO36'], ['io39', 'IO39'], ['io34', 'IO34'], ['io35', 'IO35'], ['io32', 'IO32'], ['io33', 'IO33'], ['io25', 'IO25'], ['io26', 'IO26'], ['io27', 'IO27'], ['io14', 'IO14'], ['io12', 'IO12'], ['gnd', 'GND'], ['vin', 'VIN 5V']],
  right: [['io23', 'IO23'], ['io22', 'IO22/SCL'], ['tx', 'TX0'], ['rx', 'RX0'], ['io21', 'IO21/SDA'], ['io19', 'IO19'], ['io18', 'IO18'], ['io5', 'IO5'], ['io17', 'IO17'], ['io16', 'IO16'], ['io4', 'IO4'], ['io2', 'IO2/LED'], ['io15', 'IO15'], ['io13', 'IO13'], ['gnd2', 'GND']],
});
const mega = boxPins({
  hw: 40, label: 'ATmega328P',
  left: [['p1', 'RST'], ['p2', 'PD0/RX'], ['p3', 'PD1/TX'], ['p4', 'PD2'], ['p5', 'PD3'], ['p6', 'PD4'], ['p7', 'VCC'], ['p8', 'GND'], ['p9', 'XTAL1'], ['p10', 'XTAL2'], ['p11', 'PD5'], ['p12', 'PD6'], ['p13', 'PD7'], ['p14', 'PB0']],
  right: [['p28', 'PC5/SCL'], ['p27', 'PC4/SDA'], ['p26', 'PC3'], ['p25', 'PC2'], ['p24', 'PC1'], ['p23', 'PC0'], ['p22', 'GND'], ['p21', 'AREF'], ['p20', 'AVCC'], ['p19', 'PB5/SCK'], ['p18', 'PB4/MISO'], ['p17', 'PB3/MOSI'], ['p16', 'PB2'], ['p15', 'PB1']],
});
const t555 = boxPins({ hw: 40, label: 'NE555', left: [['dis', 'DIS'], ['thr', 'THR'], ['trig', 'TRIG']], right: [['out', 'OUT'], ['reset', 'RST'], ['ctrl', 'CV']], top: [['vcc', 'VCC']], bottom: [['gnd', 'GND']] });
const vregB = boxPins({ hw: 40, minHh: 20, label: '78xx', left: [['in', 'IN']], right: [['out', 'OUT']], bottom: [['gnd', 'GND']] });
const lm317B = boxPins({ hw: 40, minHh: 20, label: 'LM317', left: [['in', 'IN']], right: [['out', 'OUT']], bottom: [['adj', 'ADJ']] });
const relayB = boxPins({ hw: 40, label: 'RELAY', left: [['c1', 'A1'], ['c2', 'A2']], right: [['no', 'NO'], ['com', 'COM'], ['nc', 'NC']] });
const optoB = boxPins({ hw: 30, minHh: 20, label: 'PC817', left: [['a', 'A'], ['k', 'K']], right: [['c', 'C'], ['e', 'E']] });
const mod = (label: string, left: PinSpec[], hw = 40) => boxPins({ hw, label, left });
const hdr = (n: number) => boxPins({ hw: 10, minHh: 10, label: '', left: Array.from({ length: n }, (_, i) => [String(i + 1), String(i + 1)] as PinSpec) });
const SEGS: PinSpec[] = [['a', 'a'], ['b', 'b'], ['c', 'c'], ['d', 'd'], ['e', 'e'], ['f', 'f'], ['g', 'g'], ['dp', 'dp']];
const seg1 = boxPins({ hw: 30, label: '', left: SEGS, bottom: [['com', 'COM']] });
const seg4 = boxPins({ hw: 80, label: '', left: SEGS, bottom: [['d1', 'D1'], ['d2', 'D2'], ['d3', 'D3'], ['d4', 'D4']] });
const lcdB = boxPins({ hw: 90, minHh: 40, label: 'LCD1602 I²C', left: [['gnd', 'GND'], ['vcc', 'VCC'], ['sda', 'SDA'], ['scl', 'SCL']] });
const FIRMWARE: ParamDef[] = [
  { key: 'firmware', label: 'Chương trình (.hex)', kind: 'firmware', help: 'Nạp file .hex xuất từ Arduino IDE (Sketch → Export Compiled Binary) hoặc biên dịch .ino bằng arduino-cli' },
  { key: 'firmwareName', label: 'Tên chương trình', kind: 'text', hidden: true },
];
const usb = boxPins({ hw: 30, label: 'USB-C', right: [['vbus', 'VBUS'], ['dp', 'D+'], ['dn', 'D−'], ['gnd', 'GND']] });

const LED_MODELS = ['LED_RED', 'LED_GREEN', 'LED_BLUE', 'LED_YELLOW', 'LED_WHITE'];

export const LIBRARY: Record<ComponentType, ComponentDef> = {
  // ───────── Thụ động ─────────
  resistor: {
    type: 'resistor', name: 'Điện trở', category: 'Thụ động', prefix: 'R', pins: twoPinH,
    params: [{ key: 'value', label: 'Điện trở', kind: 'value', unit: 'Ω' }],
    defaults: { value: '1k' }, sim: 'verified', builtin: true,
    description: 'Điện trở tuyến tính lý tưởng.',
  },
  capacitor: {
    type: 'capacitor', name: 'Tụ điện', category: 'Thụ động', prefix: 'C', pins: twoPinH,
    params: [
      { key: 'value', label: 'Điện dung', kind: 'value', unit: 'F' },
      { key: 'ic', label: 'Điện áp ban đầu', kind: 'value', unit: 'V', help: 'Để trống = tính từ điểm làm việc' },
    ],
    defaults: { value: '1u', ic: '' }, sim: 'verified', builtin: true,
    description: 'Tụ không phân cực (gốm/film) lý tưởng. Hở mạch ở DC.',
  },
  capacitor_pol: {
    type: 'capacitor_pol', name: 'Tụ hoá', category: 'Thụ động', prefix: 'C',
    pins: [{ id: 'p', name: '+', x: -40, y: 0 }, { id: 'n', name: '−', x: 40, y: 0 }],
    params: [
      { key: 'value', label: 'Điện dung', kind: 'value', unit: 'F' },
      { key: 'voltage', label: 'Điện áp định mức', kind: 'value', unit: 'V' },
      { key: 'ic', label: 'Điện áp ban đầu', kind: 'value', unit: 'V' },
    ],
    defaults: { value: '100u', voltage: '25', ic: '' }, sim: 'verified', builtin: true,
    description: 'Tụ hoá có cực (+/−). ERC cảnh báo khi phân cực ngược hoặc quá áp.', keywords: 'electrolytic',
  },
  inductor: {
    type: 'inductor', name: 'Cuộn cảm', category: 'Thụ động', prefix: 'L', pins: twoPinH,
    params: [{ key: 'value', label: 'Độ tự cảm', kind: 'value', unit: 'H' }],
    defaults: { value: '1m' }, sim: 'model', builtin: true,
    description: 'Cuộn cảm lý tưởng. Ngắn mạch ở DC.',
  },
  potentiometer: {
    type: 'potentiometer', name: 'Biến trở', category: 'Thụ động', prefix: 'RV',
    pins: [{ id: '1', name: '1', x: -40, y: 0 }, { id: 'w', name: 'W', x: 0, y: -30 }, { id: '2', name: '2', x: 40, y: 0 }],
    params: [
      { key: 'value', label: 'Tổng trở', kind: 'value', unit: 'Ω' },
      { key: 'pos', label: 'Vị trí con trượt (0–1)', kind: 'value', help: '0 = sát chân 1, 1 = sát chân 2' },
    ],
    defaults: { value: '10k', pos: '0.5' }, sim: 'verified', builtin: true,
    description: 'Chiết áp 3 chân: hai điện trở nối tiếp, con trượt W ở giữa.', keywords: 'pot trimmer chiết áp',
  },
  fuse: {
    type: 'fuse', name: 'Cầu chì', category: 'Thụ động', prefix: 'F', pins: twoPinH,
    params: [{ key: 'rating', label: 'Dòng định mức', kind: 'value', unit: 'A' }],
    defaults: { rating: '1' }, sim: 'model', builtin: true,
    description: 'Mô phỏng như điện trở 10 mΩ; ERC cảnh báo khi dòng vượt định mức.', keywords: 'fuse',
  },
  crystal: {
    type: 'crystal', name: 'Thạch anh', category: 'Thụ động', prefix: 'Y', pins: twoPinH,
    params: [{ key: 'freq', label: 'Tần số', kind: 'value', unit: 'Hz' }],
    defaults: { freq: '16meg' }, sim: 'model', builtin: false,
    description: 'Mô hình Butterworth–Van Dyke (RLC nối tiếp // C0). Cần ngspice.', keywords: 'xtal crystal',
  },
  transformer: {
    type: 'transformer', name: 'Biến áp', category: 'Thụ động', prefix: 'T',
    pins: [{ id: 'p1', name: 'P1', x: -40, y: -30 }, { id: 'p2', name: 'P2', x: -40, y: 30 }, { id: 's1', name: 'S1', x: 40, y: -30 }, { id: 's2', name: 'S2', x: 40, y: 30 }],
    params: [
      { key: 'ratio', label: 'Tỉ số vòng Ns/Np', kind: 'value' },
      { key: 'lp', label: 'Cảm kháng sơ cấp', kind: 'value', unit: 'H' },
      { key: 'k', label: 'Hệ số ghép', kind: 'value' },
    ],
    defaults: { ratio: '0.1', lp: '1', k: '0.99' }, sim: 'model', builtin: false,
    description: 'Biến áp hai cuộn ghép hỗ cảm, có điện trở dây 0,5 Ω. Chỉ truyền tín hiệu AC. Cần ngspice.', keywords: 'transformer',
  },
  ldr: {
    type: 'ldr', name: 'Quang trở (LDR)', category: 'Thụ động', prefix: 'R', pins: twoPinH,
    params: [{ key: 'lux', label: 'Độ rọi', kind: 'value', unit: 'lux', help: 'R ≈ 10 kΩ ở 10 lux, giảm khi sáng hơn (GL5528)' }],
    defaults: { lux: '100' }, sim: 'model', builtin: true,
    description: 'Quang trở GL5528: R = 10k·(lux/10)^−0,7.', keywords: 'ldr photoresistor cảm biến ánh sáng',
  },
  thermistor: {
    type: 'thermistor', name: 'Nhiệt điện trở NTC', category: 'Thụ động', prefix: 'TH', pins: twoPinH,
    params: [
      { key: 'r25', label: 'R ở 25 °C', kind: 'value', unit: 'Ω' },
      { key: 'beta', label: 'Hệ số B', kind: 'value', unit: 'K' },
      { key: 'temp', label: 'Nhiệt độ', kind: 'value', unit: '°C' },
    ],
    defaults: { r25: '10k', beta: '3950', temp: '25' }, sim: 'model', builtin: true,
    description: 'NTC: R = R25·exp(B·(1/T − 1/298,15)). Đổi nhiệt độ để xem điện trở thay đổi.', keywords: 'ntc thermistor cảm biến nhiệt',
  },

  // ───────── Cơ điện ─────────
  switch: {
    type: 'switch', name: 'Công tắc', category: 'Cơ điện', prefix: 'SW', pins: twoPinH,
    params: [{ key: 'closed', label: 'Đóng', kind: 'bool' }],
    defaults: { closed: '1' }, sim: 'model', builtin: true,
    description: 'Công tắc lý tưởng: 1 mΩ khi đóng, 1 GΩ khi mở.',
  },
  pushbutton: {
    type: 'pushbutton', name: 'Nút nhấn', category: 'Cơ điện', prefix: 'SW', pins: twoPinH,
    params: [{ key: 'pressed', label: 'Đang nhấn', kind: 'bool' }],
    defaults: { pressed: '0' }, sim: 'model', builtin: true,
    description: 'Nút nhấn thường hở (tact switch). Bật "Đang nhấn" để mô phỏng khi giữ nút.', keywords: 'button tact',
  },
  relay: {
    type: 'relay', name: 'Relay', category: 'Cơ điện', prefix: 'K', pins: relayB.pins, box: relayB.box,
    params: [sel('coil', 'Điện áp cuộn', Object.keys(RELAY_PARAMS))],
    defaults: { coil: '5V' }, sim: 'model', builtin: false,
    description: 'Relay 1 tiếp điểm chuyển (COM/NO/NC), cuộn A1–A2 có trễ đóng/nhả. Nhớ diode chống ngược song song cuộn. Cần ngspice.', keywords: 'relay srd-05vdc',
  },
  lamp: {
    type: 'lamp', name: 'Bóng đèn', category: 'Cơ điện', prefix: 'LA', pins: twoPinH,
    params: [{ key: 'voltage', label: 'Điện áp định mức', kind: 'value', unit: 'V' }, { key: 'power', label: 'Công suất', kind: 'value', unit: 'W' }],
    defaults: { voltage: '12', power: '5' }, sim: 'model', builtin: true,
    description: 'Đèn sợi đốt, mô phỏng như điện trở nóng R = V²/P.', keywords: 'lamp bulb',
  },
  buzzer: {
    type: 'buzzer', name: 'Còi chip (buzzer)', category: 'Cơ điện', prefix: 'BZ',
    pins: [{ id: 'p', name: '+', x: -40, y: 0 }, { id: 'n', name: '−', x: 40, y: 0 }],
    params: [{ key: 'value', label: 'Trở kháng tương đương', kind: 'value', unit: 'Ω' }],
    defaults: { value: '200' }, sim: 'model', builtin: true,
    description: 'Còi có mạch dao động trong (active buzzer) ~25 mA ở 5 V, mô phỏng như điện trở.', keywords: 'buzzer',
  },
  speaker: {
    type: 'speaker', name: 'Loa', category: 'Cơ điện', prefix: 'LS',
    pins: [{ id: 'p', name: '+', x: -40, y: 0 }, { id: 'n', name: '−', x: 40, y: 0 }],
    params: [{ key: 'value', label: 'Trở kháng', kind: 'value', unit: 'Ω' }],
    defaults: { value: '8' }, sim: 'model', builtin: true,
    description: 'Loa điện động, mô phỏng như điện trở danh định.', keywords: 'speaker loa',
  },
  motor: {
    type: 'motor', name: 'Động cơ DC', category: 'Cơ điện', prefix: 'M',
    pins: [{ id: 'p', name: '+', x: -40, y: 0 }, { id: 'n', name: '−', x: 40, y: 0 }],
    params: [{ key: 'r', label: 'Điện trở cuộn', kind: 'value', unit: 'Ω' }, { key: 'l', label: 'Độ tự cảm', kind: 'value', unit: 'H' }],
    defaults: { r: '5', l: '1m' }, sim: 'model', builtin: true,
    description: 'Động cơ DC đứng yên (R + L nối tiếp). Cần diode dập xung khi đóng ngắt bằng transistor.', keywords: 'motor',
  },

  // ───────── Nguồn ─────────
  vsource: {
    type: 'vsource', name: 'Nguồn áp', category: 'Nguồn', prefix: 'V', pins: twoPinV(),
    params: [{ key: 'value', label: 'Giá trị', kind: 'text', help: 'Ví dụ: 5 | DC 5 | PULSE(0 5 0 1u 1u 5m 10m) | SIN(0 1 1k)' }],
    defaults: { value: '5' }, sim: 'verified', builtin: true,
    description: 'Nguồn áp DC, PULSE hoặc SIN.',
  },
  isource: {
    type: 'isource', name: 'Nguồn dòng', category: 'Nguồn', prefix: 'I', pins: twoPinV(),
    params: [{ key: 'value', label: 'Giá trị', kind: 'text', help: 'Dòng chảy từ + qua nguồn ra −, theo quy ước SPICE' }],
    defaults: { value: '1m' }, sim: 'model', builtin: true,
    description: 'Nguồn dòng DC/PULSE/SIN.',
  },
  battery: {
    type: 'battery', name: 'Pin', category: 'Nguồn', prefix: 'BT', pins: twoPinV(),
    params: [
      sel('kind', 'Loại pin', ['AA 1.5V', '2xAA 3V', '4xAA 6V', '9V', 'CR2032 3V', 'Li-ion 3.7V', '2S Li-ion 7.4V', '3S LiPo 11.1V', 'Ắc quy 12V']),
      { key: 'rint', label: 'Nội trở', kind: 'value', unit: 'Ω' },
    ],
    defaults: { kind: '9V', rint: '1' }, sim: 'verified', builtin: true,
    description: 'Pin/ắc quy: nguồn áp danh định nối tiếp nội trở. Cẩn thận với pin Li-ion: không đoản mạch.', keywords: 'battery pin 18650 lipo',
  },
  clock: {
    type: 'clock', name: 'Xung vuông (clock)', category: 'Nguồn', prefix: 'V', pins: twoPinV(),
    params: [
      { key: 'freq', label: 'Tần số', kind: 'value', unit: 'Hz' },
      { key: 'high', label: 'Mức cao', kind: 'value', unit: 'V' },
      { key: 'duty', label: 'Độ rộng xung (0–1)', kind: 'value' },
    ],
    defaults: { freq: '1k', high: '5', duty: '0.5' }, sim: 'verified', builtin: true,
    description: 'Máy phát xung vuông 0 → mức cao, dùng cho mạch số và PWM.', keywords: 'clock pwm square',
  },
  vcvs: {
    type: 'vcvs', name: 'Nguồn áp điều khiển áp (E)', category: 'Nguồn', prefix: 'E',
    pins: [{ id: 'p', name: '+', x: 20, y: -40 }, { id: 'n', name: '−', x: 20, y: 40 }, { id: 'cp', name: 'C+', x: -40, y: -20 }, { id: 'cn', name: 'C−', x: -40, y: 20 }],
    params: [{ key: 'gain', label: 'Hệ số', kind: 'value', unit: 'V/V' }],
    defaults: { gain: '10' }, sim: 'verified', builtin: true,
    description: 'V(+,−) = hệ số · V(C+,C−). Dùng để dựng mô hình lý tưởng.', keywords: 'vcvs dependent',
  },
  vccs: {
    type: 'vccs', name: 'Nguồn dòng điều khiển áp (G)', category: 'Nguồn', prefix: 'G',
    pins: [{ id: 'p', name: '+', x: 20, y: -40 }, { id: 'n', name: '−', x: 20, y: 40 }, { id: 'cp', name: 'C+', x: -40, y: -20 }, { id: 'cn', name: 'C−', x: -40, y: 20 }],
    params: [{ key: 'gain', label: 'Hỗ dẫn', kind: 'value', unit: 'A/V' }],
    defaults: { gain: '1m' }, sim: 'verified', builtin: true,
    description: 'Dòng từ + qua nguồn ra − bằng hỗ dẫn · V(C+,C−).', keywords: 'vccs transconductance',
  },

  // ───────── Bán dẫn ─────────
  diode: {
    type: 'diode', name: 'Diode', category: 'Bán dẫn', prefix: 'D', pins: diodePins,
    params: [MODEL_SEL('Mô hình', ['D1N4148', 'D1N4007', 'D1N5408'])],
    defaults: { model: 'D1N4148' }, sim: 'model', builtin: true,
    description: 'Diode tín hiệu 1N4148, chỉnh lưu 1N4007 (1 A) / 1N5408 (3 A).', keywords: '1n4148 1n4007 1n5408',
  },
  led: {
    type: 'led', name: 'LED', category: 'Bán dẫn', prefix: 'D', pins: diodePins,
    params: [MODEL_SEL('Màu / mô hình', LED_MODELS)],
    defaults: { model: 'LED_RED' }, sim: 'model', builtin: true,
    description: 'LED 5 mm, mô hình diode xấp xỉ (đỏ ~1,9 V, xanh lá ~2,1 V, xanh dương/trắng ~3 V). Độ sáng hiển thị chỉ là minh hoạ.',
  },
  zener: {
    type: 'zener', name: 'Diode Zener', category: 'Bán dẫn', prefix: 'D', pins: diodePins,
    params: [MODEL_SEL('Điện áp Zener', ['DZ3V3', 'DZ5V1', 'DZ9V1', 'DZ12V', 'DZ15V'])],
    defaults: { model: 'DZ5V1' }, sim: 'model', builtin: true,
    description: 'Zener (1N4728A…1N4744A). Mắc ngược: K về phía dương để ghim áp.', keywords: 'zener 1n4733 1n4742',
  },
  schottky: {
    type: 'schottky', name: 'Diode Schottky', category: 'Bán dẫn', prefix: 'D', pins: diodePins,
    params: [MODEL_SEL('Mô hình', ['D1N5819', 'D1N5822', 'DBAT54'])],
    defaults: { model: 'D1N5819' }, sim: 'model', builtin: true,
    description: 'Schottky sụt áp thấp (~0,3–0,45 V): 1N5819 1 A, 1N5822 3 A, BAT54 tín hiệu.', keywords: 'schottky 1n5819 ss14',
  },
  bridge: {
    type: 'bridge', name: 'Cầu diode', category: 'Bán dẫn', prefix: 'BR',
    pins: [{ id: 'ac1', name: '~', x: -40, y: 0 }, { id: 'ac2', name: '~', x: 40, y: 0 }, { id: 'p', name: '+', x: 0, y: -40 }, { id: 'n', name: '−', x: 0, y: 40 }],
    params: [MODEL_SEL('Diode', ['D1N4007', 'D1N5408'])],
    defaults: { model: 'D1N4007' }, sim: 'model', builtin: true,
    description: 'Cầu chỉnh lưu toàn sóng 4 diode (DB107/KBP).', keywords: 'bridge rectifier db107',
  },
  npn: {
    type: 'npn', name: 'Transistor NPN', category: 'Bán dẫn', prefix: 'Q',
    pins: [{ id: 'c', name: 'C', x: 20, y: -40 }, { id: 'b', name: 'B', x: -40, y: 0 }, { id: 'e', name: 'E', x: 20, y: 40 }],
    params: [MODEL_SEL('Mô hình', ['Q2N3904', 'Q2N2222A', 'QBC547B', 'QTIP31C'])],
    defaults: { model: 'Q2N3904' }, sim: 'model', builtin: false,
    description: 'BJT NPN: 2N3904, 2N2222A, BC547B (tín hiệu), TIP31C (công suất). Cần ngspice.', keywords: '2n3904 2n2222 bc547 tip31',
  },
  pnp: {
    type: 'pnp', name: 'Transistor PNP', category: 'Bán dẫn', prefix: 'Q',
    pins: [{ id: 'c', name: 'C', x: 20, y: 40 }, { id: 'b', name: 'B', x: -40, y: 0 }, { id: 'e', name: 'E', x: 20, y: -40 }],
    params: [MODEL_SEL('Mô hình', ['Q2N3906', 'Q2N2907A', 'QBC557B', 'QTIP32C'])],
    defaults: { model: 'Q2N3906' }, sim: 'model', builtin: false,
    description: 'BJT PNP: 2N3906, 2N2907A, BC557B, TIP32C. Cần ngspice.', keywords: '2n3906 2n2907 bc557 tip32',
  },
  nmos: {
    type: 'nmos', name: 'MOSFET kênh N', category: 'Bán dẫn', prefix: 'Q', pins: fetPins('d', 's', 'D', 'S'),
    params: [MODEL_SEL('Mô hình', ['M2N7000', 'MBS170', 'MIRF540N', 'MIRLZ44N', 'MIRF3205'])],
    defaults: { model: 'M2N7000' }, sim: 'model', builtin: false,
    description: 'MOSFET tăng cường kênh N (có diode thân): 2N7000/BS170 tín hiệu, IRF540N/IRF3205 công suất, IRLZ44N logic-level. Cần ngspice.', keywords: 'mosfet irf540 irlz44 2n7000 irf3205',
  },
  pmos: {
    type: 'pmos', name: 'MOSFET kênh P', category: 'Bán dẫn', prefix: 'Q', pins: fetPins('s', 'd', 'S', 'D'),
    params: [MODEL_SEL('Mô hình', ['MBS250', 'MIRF9540', 'MIRF4905'])],
    defaults: { model: 'MIRF9540' }, sim: 'model', builtin: false,
    description: 'MOSFET kênh P: BS250, IRF9540, IRF4905 (high-side switch). Cần ngspice.', keywords: 'mosfet irf9540 irf4905',
  },
  njfet: {
    type: 'njfet', name: 'JFET kênh N', category: 'Bán dẫn', prefix: 'J', pins: fetPins('d', 's', 'D', 'S'),
    params: [MODEL_SEL('Mô hình', ['J2N5457', 'JJ310'])],
    defaults: { model: 'J2N5457' }, sim: 'model', builtin: false,
    description: 'JFET kênh N (2N5457, J310). Cần ngspice.', keywords: 'jfet 2n5457 j310',
  },
  pjfet: {
    type: 'pjfet', name: 'JFET kênh P', category: 'Bán dẫn', prefix: 'J', pins: fetPins('s', 'd', 'S', 'D'),
    params: [MODEL_SEL('Mô hình', ['J2N5460'])],
    defaults: { model: 'J2N5460' }, sim: 'model', builtin: false,
    description: 'JFET kênh P (2N5460). Cần ngspice.', keywords: 'jfet 2n5460',
  },
  scr: {
    type: 'scr', name: 'Thyristor (SCR)', category: 'Bán dẫn', prefix: 'SCR',
    pins: [{ id: 'a', name: 'A', x: -40, y: 0 }, { id: 'k', name: 'K', x: 40, y: 0 }, { id: 'g', name: 'G', x: 20, y: 30 }],
    params: [], defaults: {}, sim: 'model', builtin: false,
    description: 'SCR mô hình hai transistor; kích bằng dòng cổng G vài mA, tự giữ khi đã dẫn. Cần ngspice.', keywords: 'scr thyristor',
  },
  optocoupler: {
    type: 'optocoupler', name: 'Opto (PC817)', category: 'Bán dẫn', prefix: 'U', pins: optoB.pins, box: optoB.box,
    params: [{ key: 'ctr', label: 'Hệ số truyền CTR', kind: 'value', help: 'Ic/If, PC817 khoảng 0,5–6' }],
    defaults: { ctr: '1' }, sim: 'model', builtin: false,
    description: 'Opto cách ly: LED hồng ngoại A–K điều khiển phototransistor C–E. Cần ngspice.', keywords: 'optocoupler pc817 opto',
  },

  // ───────── Tích hợp ─────────
  opamp: {
    type: 'opamp', name: 'Op-amp lý tưởng', category: 'Tích hợp', prefix: 'U',
    pins: [{ id: 'inp', name: '+', x: -40, y: 20 }, { id: 'inn', name: '−', x: -40, y: -20 }, { id: 'out', name: 'OUT', x: 40, y: 0 }],
    params: [{ key: 'gain', label: 'Hệ số khuếch đại hở', kind: 'value' }],
    defaults: { gain: '100k' }, sim: 'model', builtin: true,
    description: 'Nguồn áp điều khiển bằng áp (VCVS), không bão hoà theo nguồn.',
  },
  opamp_ic: {
    type: 'opamp_ic', name: 'Op-amp (IC thật)', category: 'Tích hợp', prefix: 'U',
    pins: [{ id: 'inp', name: '+', x: -40, y: 20 }, { id: 'inn', name: '−', x: -40, y: -20 }, { id: 'out', name: 'OUT', x: 40, y: 0 }, { id: 'vcc', name: 'V+', x: 0, y: -40 }, { id: 'vee', name: 'V−', x: 0, y: 40 }],
    params: [MODEL_SEL('Mã IC', Object.keys(OPAMP_PARAMS))],
    defaults: { model: 'LM358' }, sim: 'model', builtin: false,
    description: 'Op-amp có chân nguồn V+/V−, băng thông và bão hoà theo nguồn: ' + Object.entries(OPAMP_PARAMS).map(([k, v]) => `${k} (${v.note})`).join(', ') + '. Cần ngspice.', keywords: 'lm358 lm741 tl072 ne5532 lm324 mcp6002',
  },
  comparator: {
    type: 'comparator', name: 'So sánh (LM393)', category: 'Tích hợp', prefix: 'U',
    pins: [{ id: 'inp', name: '+', x: -40, y: 20 }, { id: 'inn', name: '−', x: -40, y: -20 }, { id: 'out', name: 'OUT', x: 40, y: 0 }, { id: 'vcc', name: 'V+', x: 0, y: -40 }, { id: 'gnd', name: 'GND', x: 0, y: 40 }],
    params: [], defaults: {}, sim: 'model', builtin: false,
    description: 'Bộ so sánh ngõ ra cực thu hở (open-collector): cần điện trở kéo lên. OUT kéo xuống khi V− > V+. Cần ngspice.', keywords: 'lm393 lm339 comparator',
  },
  timer555: {
    type: 'timer555', name: 'Timer 555', category: 'Tích hợp', prefix: 'U', pins: t555.pins, box: t555.box,
    params: [], defaults: {}, sim: 'model', builtin: false,
    description: 'NE555 mô hình hành vi: ngưỡng 1/3 và 2/3 VCC, chân DIS xả tụ. Astable: f ≈ 1,44/((Ra+2Rb)·C). Cần ngspice + transient.', keywords: 'ne555 555 timer',
  },
  vreg: {
    type: 'vreg', name: 'Ổn áp cố định', category: 'Tích hợp', prefix: 'U', pins: vregB.pins, box: vregB.box,
    params: [MODEL_SEL('Mã IC', Object.keys(VREG_PARAMS))],
    defaults: { model: '7805' }, sim: 'model', builtin: false,
    description: 'Ổn áp tuyến tính 78xx / AMS1117 có sụt áp (dropout). Thêm tụ lọc vào/ra. Cần ngspice.', keywords: '7805 7812 ams1117 lm7805 regulator',
  },
  lm317: {
    type: 'lm317', name: 'Ổn áp chỉnh được LM317', category: 'Tích hợp', prefix: 'U', pins: lm317B.pins, box: lm317B.box,
    params: [], defaults: {}, sim: 'model', builtin: false,
    description: 'Vout = 1,25·(1 + R2/R1), R1 (240 Ω) nối OUT–ADJ, R2 nối ADJ–GND. Cần ngspice.', keywords: 'lm317 adjustable',
  },
  logic_gate: {
    type: 'logic_gate', name: 'Cổng logic 2 vào', category: 'Tích hợp', prefix: 'U',
    pins: [{ id: 'a', name: 'A', x: -40, y: -20 }, { id: 'b', name: 'B', x: -40, y: 20 }, { id: 'y', name: 'Y', x: 40, y: 0 }],
    params: [sel('gate', 'Loại cổng', GATE_FUNCS), { key: 'vdd', label: 'Nguồn logic', kind: 'value', unit: 'V' }],
    defaults: { gate: 'NAND', vdd: '5' }, sim: 'model', builtin: false,
    description: 'Cổng 74HC (AND/NAND/OR/NOR/XOR/XNOR), nguồn VDD ngầm, ngưỡng VDD/2. Cần ngspice.', keywords: '74hc00 74hc08 74hc32 74hc86 nand and or xor',
  },
  logic_not: {
    type: 'logic_not', name: 'Cổng NOT', category: 'Tích hợp', prefix: 'U',
    pins: [{ id: 'a', name: 'A', x: -40, y: 0 }, { id: 'y', name: 'Y', x: 40, y: 0 }],
    params: [{ key: 'vdd', label: 'Nguồn logic', kind: 'value', unit: 'V' }],
    defaults: { vdd: '5' }, sim: 'model', builtin: false,
    description: 'Cổng đảo 74HC04, nguồn VDD ngầm. Cần ngspice.', keywords: '74hc04 inverter not',
  },

  // ───────── Hiển thị ─────────
  seg7: {
    type: 'seg7', name: 'LED 7 đoạn', category: 'Hiển thị', prefix: 'DS', pins: seg1.pins, box: seg1.box,
    params: [MODEL_SEL('Màu', LED_MODELS), sel('common', 'Kiểu chung', ['CC', 'CA'], 'CC = katốt chung (COM nối GND), CA = anốt chung (COM nối VCC)')],
    defaults: { model: 'LED_RED', common: 'CC' }, sim: 'model', builtin: true,
    description: 'LED 7 đoạn 1 số (8 LED a–g, dp). Mỗi đoạn cần điện trở hạn dòng ~220–330 Ω. Đoạn sáng theo dòng điện mô phỏng.', keywords: '7 segment seven 7seg',
  },
  seg7x4: {
    type: 'seg7x4', name: 'LED 7 đoạn 4 số', category: 'Hiển thị', prefix: 'DS', pins: seg4.pins, box: seg4.box,
    params: [MODEL_SEL('Màu', LED_MODELS), sel('common', 'Kiểu chung', ['CC', 'CA'])],
    defaults: { model: 'LED_RED', common: 'CC' }, sim: 'model', builtin: true,
    description: 'LED 7 đoạn 4 số kiểu quét (5641AS/3461BS): 8 chân đoạn dùng chung, D1–D4 là chân chung của từng số. Dùng với vi điều khiển quét nhanh; dấu ":" là dp của số 2. Chạy thời gian thực để thấy số hiện.', keywords: '7 segment 4 digit clock đồng hồ',
  },
  lcd1602: {
    type: 'lcd1602', name: 'LCD 1602 I²C', category: 'Hiển thị', prefix: 'LCD', pins: lcdB.pins, box: lcdB.box,
    params: [sel('address', 'Địa chỉ I²C', ['0x27', '0x3F']), sel('color', 'Màu nền', ['Xanh lá', 'Xanh dương'])],
    defaults: { address: '0x27', color: 'Xanh dương' }, sim: 'display', builtin: true,
    description: 'LCD 16×2 ký tự (HD44780) với module I²C PCF8574. Nối SDA→A4, SCL→A5 của Arduino; hiện chữ khi chạy chương trình (thư viện LiquidCrystal_I2C).', keywords: 'lcd 1602 i2c hd44780 display',
  },

  // ───────── Vi điều khiển & mô-đun ─────────
  arduino_nano: {
    type: 'arduino_nano', name: 'Arduino Nano', category: 'Vi điều khiển & mô-đun', prefix: 'U', pins: nano.pins, box: nano.box,
    params: FIRMWARE, defaults: { firmware: '', firmwareName: '' }, sim: 'display', builtin: true,
    description: 'Board Arduino Nano (ATmega328P 16 MHz, 5 V). Nạp file .hex rồi bấm "Chạy thời gian thực" để chạy chương trình: GPIO, timer, UART (Serial), I²C, ADC được giả lập; LED, LED 7 đoạn, LCD, OLED, nút nhấn hoạt động như thật.', keywords: 'arduino nano uno atmega mcu',
  },
  esp32: {
    type: 'esp32', name: 'ESP32 DevKit', category: 'Vi điều khiển & mô-đun', prefix: 'U', pins: esp32.pins, box: esp32.box,
    params: [], defaults: {}, sim: 'display', builtin: true,
    description: 'ESP32 DevKit V1 (WiFi/BLE, logic 3,3 V — không cấp 5 V vào GPIO). Chỉ hiển thị.', keywords: 'esp32 wifi mcu',
  },
  atmega328p: {
    type: 'atmega328p', name: 'ATmega328P (DIP-28)', category: 'Vi điều khiển & mô-đun', prefix: 'U', pins: mega.pins, box: mega.box,
    params: FIRMWARE, defaults: { firmware: '', firmwareName: '' }, sim: 'display', builtin: true,
    description: 'Vi điều khiển AVR rời (thực tế cần thạch anh 16 MHz + 2 tụ 22 pF, tụ 100 nF ở VCC, trở 10k kéo RST). Nạp .hex để chạy thời gian thực như Arduino Nano.', keywords: 'atmega328 avr mcu',
  },
  dht22: {
    type: 'dht22', name: 'Cảm biến DHT22', category: 'Vi điều khiển & mô-đun', prefix: 'U', ...(() => { const m = mod('DHT22', [['vcc', 'VCC'], ['data', 'DATA'], ['gnd', 'GND']]); return { pins: m.pins, box: m.box }; })(),
    params: [], defaults: {}, sim: 'display', builtin: true,
    description: 'Cảm biến nhiệt độ/độ ẩm 1 dây, cần trở kéo lên 10k ở DATA. Chỉ hiển thị.', keywords: 'dht22 dht11 sensor',
  },
  hcsr04: {
    type: 'hcsr04', name: 'Siêu âm HC-SR04', category: 'Vi điều khiển & mô-đun', prefix: 'U', ...(() => { const m = mod('HC-SR04', [['vcc', 'VCC'], ['trig', 'TRIG'], ['echo', 'ECHO'], ['gnd', 'GND']]); return { pins: m.pins, box: m.box }; })(),
    params: [], defaults: {}, sim: 'display', builtin: true,
    description: 'Cảm biến khoảng cách siêu âm 5 V. ECHO ra 5 V: cần chia áp khi nối ESP32. Chỉ hiển thị.', keywords: 'hcsr04 ultrasonic sensor',
  },
  oled_i2c: {
    type: 'oled_i2c', name: 'Màn OLED I²C', category: 'Hiển thị', prefix: 'U', ...(() => { const m = boxPins({ hw: 70, minHh: 40, label: 'OLED 0.96"', left: [['gnd', 'GND'], ['vcc', 'VCC'], ['scl', 'SCL'], ['sda', 'SDA']] }); return { pins: m.pins, box: m.box }; })(),
    params: [sel('address', 'Địa chỉ I²C', ['0x3C', '0x3D'])], defaults: { address: '0x3C' }, sim: 'display', builtin: true,
    description: 'Màn OLED SSD1306 128×64 giao tiếp I²C. Hiện hình khi vi điều khiển chạy chương trình (thư viện Adafruit_SSD1306/U8g2).', keywords: 'oled ssd1306 display i2c',
  },
  servo: {
    type: 'servo', name: 'Servo SG90', category: 'Vi điều khiển & mô-đun', prefix: 'M', ...(() => { const m = mod('SG90', [['gnd', 'GND'], ['vcc', '5V'], ['sig', 'PWM']]); return { pins: m.pins, box: m.box }; })(),
    params: [], defaults: {}, sim: 'display', builtin: true,
    description: 'Servo SG90 điều khiển PWM 50 Hz (xung 1–2 ms). Chỉ hiển thị.', keywords: 'servo sg90 mg996',
  },

  // ───────── Kết nối ─────────
  ground: {
    type: 'ground', name: 'Ground (0)', category: 'Kết nối', prefix: 'GND',
    pins: [{ id: 'g', name: 'GND', x: 0, y: -20 }],
    params: [], defaults: {}, sim: 'verified', builtin: true,
    description: 'Nút tham chiếu 0 V. Mọi ground cùng một net.',
  },
  netlabel: {
    type: 'netlabel', name: 'Nhãn net', category: 'Kết nối', prefix: 'NL',
    pins: [{ id: 'n', name: 'N', x: 0, y: 0 }],
    params: [{ key: 'name', label: 'Tên net', kind: 'text' }],
    defaults: { name: 'VCC' }, sim: 'verified', builtin: true,
    description: 'Các nhãn cùng tên nối chung một net.',
  },
  power: {
    type: 'power', name: 'Ký hiệu nguồn', category: 'Kết nối', prefix: 'PWR',
    pins: [{ id: 'n', name: 'N', x: 0, y: 20 }],
    params: [{ key: 'name', label: 'Tên net', kind: 'text', help: 'Ví dụ +5V, +3V3, VCC, +12V' }],
    defaults: { name: '+5V' }, sim: 'verified', builtin: true,
    description: 'Ký hiệu thanh nguồn: mọi ký hiệu cùng tên nối chung (giống nhãn net). Vẫn cần một nguồn áp thật cấp cho net này.', keywords: 'vcc vdd power rail',
  },
  header2: {
    type: 'header2', name: 'Đầu nối 2 chân', category: 'Kết nối', prefix: 'J', ...(() => { const m = hdr(2); return { pins: m.pins, box: m.box }; })(),
    params: [], defaults: {}, sim: 'display', builtin: true,
    description: 'Header/terminal 2 chân 2,54 mm (nối ra ngoài bo). Chỉ hiển thị.', keywords: 'header connector terminal jst',
  },
  header3: {
    type: 'header3', name: 'Đầu nối 3 chân', category: 'Kết nối', prefix: 'J', ...(() => { const m = hdr(3); return { pins: m.pins, box: m.box }; })(),
    params: [], defaults: {}, sim: 'display', builtin: true,
    description: 'Header 3 chân 2,54 mm. Chỉ hiển thị.', keywords: 'header connector',
  },
  header4: {
    type: 'header4', name: 'Đầu nối 4 chân', category: 'Kết nối', prefix: 'J', ...(() => { const m = hdr(4); return { pins: m.pins, box: m.box }; })(),
    params: [], defaults: {}, sim: 'display', builtin: true,
    description: 'Header 4 chân 2,54 mm (ví dụ I²C, UART). Chỉ hiển thị.', keywords: 'header connector i2c uart',
  },
  usb_c: {
    type: 'usb_c', name: 'Cổng USB-C', category: 'Kết nối', prefix: 'J', pins: usb.pins, box: usb.box,
    params: [], defaults: {}, sim: 'display', builtin: true,
    description: 'Cổng USB-C (VBUS 5 V, D+, D−, GND). Để mô phỏng, đặt thêm nguồn áp 5 V vào VBUS. Chỉ hiển thị.', keywords: 'usb type-c connector',
  },
};

/** Loại dùng tên net (nhãn): nhãn net và ký hiệu nguồn */
export const isLabelType = (t: ComponentType) => t === 'netlabel' || t === 'power';
/** Loại không phải linh kiện thật (không tính ref/BOM) */
export const isSymbolOnly = (t: ComponentType) => t === 'ground' || isLabelType(t);

/** Nửa kích thước vùng chiếm chỗ của linh kiện khi rot = 0 (để chọn, tránh dây, fit view). */
export function compExtent(type: ComponentType): { hw: number; hh: number } {
  const def = LIBRARY[type];
  if (type === 'ground') return { hw: 16, hh: 24 };
  if (isLabelType(type)) return { hw: 30, hh: 14 };
  let hw = def.box ? def.box.hw : 24, hh = def.box ? def.box.hh : 24;
  for (const p of def.pins) { hw = Math.max(hw, Math.abs(p.x)); hh = Math.max(hh, Math.abs(p.y)); }
  return { hw: hw + 4, hh: hh + 4 };
}

/** Thân linh kiện (không gồm chân) dùng để tránh dây đi xuyên qua. */
export function compBody(type: ComponentType): { hw: number; hh: number } {
  const def = LIBRARY[type];
  if (def.box) return { hw: def.box.hw, hh: def.box.hh };
  if (type === 'ground') return { hw: 14, hh: 14 };
  return { hw: 28, hh: 28 };
}

/** Điện trở tương đương của các linh kiện dạng điện trở (null nếu tham số lỗi). */
export function resistiveValue(type: ComponentType, params: Record<string, string>, parse: (s: string) => number | null): number | null {
  switch (type) {
    case 'resistor': case 'buzzer': case 'speaker': return parse(params.value ?? '');
    case 'fuse': return 0.01;
    case 'lamp': {
      const v = parse(params.voltage ?? ''), p = parse(params.power ?? '');
      return v !== null && p !== null && p > 0 ? (v * v) / p : null;
    }
    case 'ldr': {
      const lux = parse(params.lux ?? '');
      return lux !== null && lux > 0 ? 10e3 * Math.pow(lux / 10, -0.7) : lux === 0 ? 1e6 : null;
    }
    case 'thermistor': {
      const r25 = parse(params.r25 ?? ''), b = parse(params.beta ?? ''), t = parse(params.temp ?? '');
      if (r25 === null || b === null || t === null) return null;
      return r25 * Math.exp(b * (1 / (t + 273.15) - 1 / 298.15));
    }
  }
  return null;
}

/** Điện áp danh định của pin theo loại. */
export function batteryVoltage(kind: string): number {
  const m = String(kind ?? '').match(/(\d+(?:\.\d+)?)\s*V/i);
  return m ? parseFloat(m[1]) : 9;
}

const LED_NAMES: Record<string, string> = { LED_RED: 'đỏ', LED_GREEN: 'xanh lá', LED_BLUE: 'xanh dương', LED_YELLOW: 'vàng', LED_WHITE: 'trắng' };
/** Tên mô hình dễ đọc: D1N4148 → 1N4148, Q2N3904 → 2N3904, DZ5V1 → 5V1, LED_RED → đỏ */
export function modelLabel(model: string): string {
  if (LED_NAMES[model]) return LED_NAMES[model];
  if (/^DZ/.test(model)) return model.slice(2);
  if (/^(D1N|DBAT|Q2N|QBC|QTIP|M2N|MBS|MIR|J2N|JJ)/.test(model)) return model.slice(1);
  return model;
}

/** Các LED trong LED 7 đoạn: [số thứ tự chữ số, đoạn, chân anốt, chân katốt] */
export function segmentDiodes(type: ComponentType, common: string): { key: string; a: string; k: string }[] {
  const segs = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'];
  const commons = type === 'seg7x4' ? ['d1', 'd2', 'd3', 'd4'] : type === 'seg7' ? ['com'] : [];
  const out: { key: string; a: string; k: string }[] = [];
  commons.forEach((cm, i) => segs.forEach((sg) => out.push(common === 'CA' ? { key: `${i}:${sg}`, a: cm, k: sg } : { key: `${i}:${sg}`, a: sg, k: cm })));
  return out;
}

export function hasModel(name: string): boolean { return !!SPICE_MODELS[name]; }

export const COMPONENT_TYPES = Object.keys(LIBRARY) as ComponentType[];

export function rotatePoint(x: number, y: number, rot: number): { x: number; y: number } {
  switch (((rot % 360) + 360) % 360) {
    case 90: return { x: -y, y: x };
    case 180: return { x: -x, y: -y };
    case 270: return { x: y, y: -x };
    default: return { x, y };
  }
}
