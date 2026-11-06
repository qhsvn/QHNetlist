// Kiểu dữ liệu cốt lõi của Netlist. Không phụ thuộc UI, Electron hay React.

export type Rotation = 0 | 90 | 180 | 270;

export type ComponentType =
  // thụ động
  | 'resistor' | 'capacitor' | 'capacitor_pol' | 'inductor' | 'potentiometer' | 'fuse' | 'crystal' | 'transformer'
  | 'ldr' | 'thermistor'
  // cơ điện
  | 'switch' | 'pushbutton' | 'relay' | 'lamp' | 'buzzer' | 'speaker' | 'motor'
  // nguồn
  | 'vsource' | 'isource' | 'battery' | 'clock' | 'vcvs' | 'vccs'
  // bán dẫn
  | 'diode' | 'led' | 'zener' | 'schottky' | 'bridge' | 'npn' | 'pnp' | 'nmos' | 'pmos' | 'njfet' | 'pjfet'
  | 'scr' | 'optocoupler'
  // tích hợp
  | 'opamp' | 'opamp_ic' | 'comparator' | 'timer555' | 'vreg' | 'lm317' | 'logic_gate' | 'logic_not'
  // vi điều khiển & mô-đun (chỉ hiển thị)
  | 'seg7' | 'seg7x4' | 'lcd1602'
  | 'arduino_nano' | 'esp32' | 'atmega328p' | 'dht22' | 'hcsr04' | 'oled_i2c' | 'servo'
  // kết nối
  | 'ground' | 'netlabel' | 'power' | 'header2' | 'header3' | 'header4' | 'usb_c';

export interface ComponentInstance {
  /** ID ổn định (UUID-like). Không dùng ref làm ID. */
  id: string;
  /** Tên hiển thị dễ đọc: R1, C1, V1... */
  ref: string;
  type: ComponentType;
  params: Record<string, string>;
  /** Toạ độ schematic, đơn vị lưới 1 = 1px ở zoom 1, luôn bội số của GRID */
  x: number;
  y: number;
  rot: Rotation;
}

export interface Junction {
  id: string;
  x: number;
  y: number;
}

export type Endpoint =
  | { kind: 'pin'; comp: string; pin: string }
  | { kind: 'junction'; id: string };

export interface Wire {
  id: string;
  a: Endpoint;
  b: Endpoint;
}

export interface SimProfile {
  analysis: 'op' | 'tran';
  tranStep: string;
  tranStop: string;
}

export interface CircuitDocument {
  schemaVersion: 1;
  name: string;
  revision: number;
  components: ComponentInstance[];
  wires: Wire[];
  junctions: Junction[];
  sim: SimProfile;
  /** Thiết bị 3D minh hoạ (xe, quạt, robot...) do AI hoặc người dùng dựng, chuyển động theo kết quả mạch */
  device?: DeviceModel;
}

export type DeviceShape = 'box' | 'cylinder' | 'sphere' | 'cone' | 'torus' | 'capsule' | 'wheel';
export type DeviceMaterial = 'plastic' | 'paint' | 'metal' | 'chrome' | 'rubber' | 'glass' | 'light';
export type DeviceQuantity = 'current' | 'voltage' | 'power';

/** Gắn một đại lượng điện của linh kiện vào chuyển động: mức = |giá trị| / max, kẹp 0..1 */
export interface DeviceBinding {
  ref: string;
  quantity?: DeviceQuantity;
  max?: number;
}

export interface DeviceMotion extends DeviceBinding {
  type: 'spin' | 'slide' | 'swing' | 'glow' | 'shake';
  axis?: 'x' | 'y' | 'z';
  /** spin: vòng/giây ở mức 100 % */
  speed?: number;
  /** slide: mét; swing: độ (ở mức 100 %) */
  range?: number;
}

export interface DevicePart {
  id: string;
  name?: string;
  shape: DeviceShape;
  /** box [rộng x, cao y, sâu z]; cylinder [bán kính, cao]; sphere [r]; cone [r, cao]; torus [R, ống]; capsule [r, dài]; wheel [bán kính, bề rộng] (mét) */
  size: number[];
  pos?: [number, number, number];
  /** độ, quay theo thứ tự XYZ */
  rot?: [number, number, number];
  color?: string;
  material?: DeviceMaterial;
  /** id khối cha: khối con đi theo chuyển động của cha, pos tính tương đối với cha */
  parent?: string;
  motion?: DeviceMotion;
}

export interface DeviceModel {
  name: string;
  description?: string;
  /** nền: road = đường chạy (cuộn theo tốc độ), floor = sàn, none */
  environment?: 'road' | 'floor' | 'none';
  /** tốc độ đường chạy (m/s ở mức 100 %) gắn với linh kiện */
  road?: DeviceBinding & { speed?: number };
  parts: DevicePart[];
}

export interface Net {
  name: string;
  isGround: boolean;
  /** Endpoint dễ đọc: "R1.1", "V1.p" */
  endpoints: string[];
  /** Khoá nội bộ: "c:<id>:<pin>" hoặc "j:<id>" */
  keys: string[];
}

export interface Connectivity {
  nets: Net[];
  /** khoá endpoint -> tên net */
  netOf: Map<string, string>;
}

export interface SimResult {
  source: 'ngspice' | 'builtin';
  analysis: 'op' | 'tran';
  revision: number;
  ok: boolean;
  error?: string;
  log: string;
  op?: { nodes: Record<string, number>; currents: Record<string, number> };
  tran?: { time: number[]; series: Record<string, number[]> };
  elapsedMs: number;
}

export interface Issue {
  severity: 'error' | 'warning' | 'info';
  message: string;
  ref?: string;
  net?: string;
}
