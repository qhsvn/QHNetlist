// Chạy thời gian thực: vi điều khiển (avr8js) + mạch điện (bộ giải tích hợp) + thiết bị hiển thị.
// Mỗi khi chân vi điều khiển đổi trạng thái, mạch được giải lại (có bộ nhớ đệm theo trạng thái chân),
// dòng qua LED/đoạn LED được tích phân theo thời gian để ra độ sáng trung bình (thấy được LED quét).
import { computeConnectivity } from '../core/connectivity';
import { LIBRARY } from '../core/library';
import { simulateBuiltin, type PinDrive } from '../core/solver';
import type { CircuitDocument, ComponentInstance } from '../core/types';
import { AvrMachine, MCU_HZ, PinState, atmegaPin, nanoPin, type PortName } from './avr';
import { Lcd1602, Ssd1306 } from './i2cDevices';

export interface LiveFrame {
  /** dòng trung bình (A) qua LED/đoạn LED/đèn, khoá = ref hoặc "ref:số:đoạn" */
  brightness: Record<string, number>;
  /** điện áp nút trung bình gần nhất */
  nodes: Record<string, number>;
  lcd: Record<string, { lines: string[]; backlight: boolean; connected: boolean }>;
  oled: Record<string, { fb: Uint8Array; on: boolean; invert: boolean; connected: boolean; version: number }>;
  pressed: Record<string, boolean>;
  /** tốc độ so với thời gian thực (1 = 100 %) */
  speed: number;
  /** thời gian mô phỏng (s) */
  simTime: number;
  serial: string;
  mcu: string | null;
  notes: string[];
  error?: string;
}

interface Solved { currents: Record<string, number>; nodes: Record<string, number>; inputs: [PortName, number, boolean, number | undefined, number][] }
type PinMap = { id: string; port: PortName; bit: number; adc?: number };

const DRIVE_R = 25;      // điện trở ra của chân GPIO (Ω)
const PULLUP_R = 35_000; // điện trở kéo lên nội (Ω)

export class LiveSession {
  private machine: AvrMachine | null = null;
  private mcu: ComponentInstance | null = null;
  private pins: PinMap[] = [];
  private cache = new Map<string, Solved>();
  private cur: Solved | null = null;
  private acc: Record<string, number> = {};
  /** tích phân điện áp nút theo chu kỳ → trung bình mỗi khung (PWM ra giá trị trung bình) */
  private accN: Record<string, number> = {};
  private lastCycles = 0;
  private frameStart = 0;
  private raf = 0;
  private lastWall = 0;
  private pressed: Record<string, boolean> = {};
  private lcds: { ref: string; dev: Lcd1602; connected: boolean }[] = [];
  private oleds: { ref: string; dev: Ssd1306; connected: boolean }[] = [];
  private notes: string[] = [];
  private error: string | undefined;
  private speedAvg = 1;
  running = false;

  constructor(private doc: CircuitDocument, private onFrame: (f: LiveFrame) => void) {
    const conn = computeConnectivity(doc);
    const mcus = doc.components.filter((c) => (c.type === 'arduino_nano' || c.type === 'atmega328p'));
    this.mcu = mcus.find((c) => c.params.firmware?.trim()) ?? null;
    if (mcus.length && !this.mcu) this.notes.push(`${mcus[0].ref}: chưa nạp chương trình (.hex) — chọn vi điều khiển rồi bấm "Nạp chương trình".`);
    if (mcus.filter((c) => c.params.firmware?.trim()).length > 1) this.notes.push('Chỉ chạy vi điều khiển đầu tiên có chương trình.');
    if (this.mcu) {
      this.machine = new AvrMachine(this.mcu.params.firmware);
      const map = this.mcu.type === 'arduino_nano' ? nanoPin : atmegaPin;
      for (const p of LIBRARY[this.mcu.type].pins) {
        const m = map(p.id);
        if (m) this.pins.push({ id: p.id, ...m });
      }
      const netOf = (c: ComponentInstance, pin: string) => conn.netOf.get(`c:${c.id}:${pin}`);
      const sdaPin = this.mcu.type === 'arduino_nano' ? 'a4' : 'p27', sclPin = this.mcu.type === 'arduino_nano' ? 'a5' : 'p28';
      const sda = netOf(this.mcu, sdaPin), scl = netOf(this.mcu, sclPin);
      const wired = (c: ComponentInstance) => {
        const ok = netOf(c, 'sda') === sda && netOf(c, 'scl') === scl && sda !== undefined && scl !== undefined;
        const ownSda = conn.nets.find((n) => n.name === sda);
        return ok && (ownSda?.endpoints.length ?? 0) >= 2;
      };
      for (const c of doc.components) {
        if (c.type === 'lcd1602') {
          const dev = new Lcd1602(parseInt(c.params.address, 16) || 0x27);
          const connected = wired(c);
          if (connected) this.machine.i2c.devices.set(dev.address, dev);
          else this.notes.push(`${c.ref}: SDA/SCL chưa nối vào ${this.mcu.ref}.${sdaPin.toUpperCase()}/${sclPin.toUpperCase()}`);
          this.lcds.push({ ref: c.ref, dev, connected });
        }
        if (c.type === 'oled_i2c') {
          const dev = new Ssd1306(parseInt(c.params.address, 16) || 0x3c);
          const connected = wired(c);
          if (connected) this.machine.i2c.devices.set(dev.address, dev);
          else this.notes.push(`${c.ref}: SDA/SCL chưa nối vào ${this.mcu.ref}.${sdaPin.toUpperCase()}/${sclPin.toUpperCase()}`);
          this.oleds.push({ ref: c.ref, dev, connected });
        }
      }
      for (const port of ['B', 'C', 'D'] as const) this.machine.ports[port].addListener(() => this.onPins());
    }
  }

  /** Trạng thái chân hiện tại + nút đang nhấn → khoá bộ nhớ đệm */
  private signature(): string {
    let s = '';
    if (this.machine) for (const p of this.pins) s += this.machine.pinState(p.port, p.bit);
    return s + '|' + Object.keys(this.pressed).filter((k) => this.pressed[k]).sort().join(',');
  }

  private solve(): Solved {
    const sig = this.signature();
    const hit = this.cache.get(sig);
    if (hit) return hit;
    const drive: PinDrive = {};
    if (this.machine && this.mcu) {
      for (const p of this.pins) {
        const st = this.machine.pinState(p.port, p.bit);
        if (st === PinState.Low) drive[`${this.mcu.id}:${p.id}`] = { v: 0, r: DRIVE_R };
        else if (st === PinState.High) drive[`${this.mcu.id}:${p.id}`] = { v: 5, r: DRIVE_R };
        else if (st === PinState.InputPullUp) drive[`${this.mcu.id}:${p.id}`] = { v: 5, r: PULLUP_R };
      }
    }
    const doc: CircuitDocument = {
      ...this.doc,
      components: this.doc.components.map((c) => {
        if (c.type === 'pushbutton') return { ...c, params: { ...c.params, pressed: this.pressed[c.id] ? '1' : '0' } };
        if (c.type === 'switch' && this.pressed[c.id]) return { ...c, params: { ...c.params, closed: c.params.closed === '1' ? '0' : '1' } };
        return c;
      }),
    };
    const r = simulateBuiltin(doc, 'op', { drive });
    let solved: Solved;
    if (!r.ok || !r.op) {
      this.error = `Mạch: ${r.error ?? 'không giải được'} (chế độ thời gian thực dùng bộ giải tích hợp)`;
      solved = { currents: {}, nodes: {}, inputs: [] };
    } else {
      const conn = computeConnectivity(this.doc);
      const inputs: Solved['inputs'] = [];
      if (this.mcu) for (const p of this.pins) {
        const net = conn.netOf.get(`c:${this.mcu.id}:${p.id}`);
        const v = net === '0' ? 0 : net ? r.op.nodes[net] ?? 0 : 0;
        const st = this.machine!.pinState(p.port, p.bit);
        const isInput = st === PinState.Input || st === PinState.InputPullUp;
        // chân vào thả nổi có kéo lên thì đọc mức cao
        const floating = !net || (conn.nets.find((n) => n.name === net)?.endpoints.length ?? 0) < 2;
        const level = floating ? st === PinState.InputPullUp : v > 2.5;
        if (isInput || p.adc !== undefined) inputs.push([p.port, p.bit, level, p.adc, floating && st === PinState.InputPullUp ? 5 : v]);
      }
      const currents: Record<string, number> = {};
      for (const [k, i] of Object.entries(r.op.currents)) {
        const ref = k.split(':')[0];
        const c = this.doc.components.find((x) => x.ref === ref);
        if (c && (c.type === 'led' || c.type === 'lamp' || c.type === 'seg7' || c.type === 'seg7x4')) currents[k] = Math.max(0, i);
      }
      solved = { currents, nodes: r.op.nodes, inputs };
    }
    if (this.cache.size > 2000) this.cache.clear();
    this.cache.set(sig, solved);
    return solved;
  }

  private account(cycles: number) {
    const dt = cycles - this.lastCycles;
    if (dt > 0 && this.cur) {
      for (const [k, i] of Object.entries(this.cur.currents)) this.acc[k] = (this.acc[k] ?? 0) + i * dt;
      for (const [k, v] of Object.entries(this.cur.nodes)) this.accN[k] = (this.accN[k] ?? 0) + v * dt;
    }
    this.lastCycles = cycles;
  }

  private apply(s: Solved) {
    this.cur = s;
    if (!this.machine) return;
    for (const [port, bit, level, adc, v] of s.inputs) {
      this.machine.setInput(port, bit, level);
      if (adc !== undefined) this.machine.adc.channelValues[adc] = Math.max(0, Math.min(5, v));
    }
  }

  private onPins() {
    if (!this.machine) return;
    this.account(this.machine.cpu.cycles);
    this.apply(this.solve());
  }

  press(compId: string, down: boolean) {
    if (!!this.pressed[compId] === down) return;
    this.pressed[compId] = down;
    if (this.machine) this.account(this.machine.cpu.cycles);
    this.apply(this.solve());
    if (!this.machine) this.emit(1);
  }

  start() {
    this.running = true;
    this.apply(this.solve());
    this.frameStart = this.machine?.cpu.cycles ?? 0;
    this.lastWall = performance.now();
    if (!this.machine) { this.emit(1); return; }
    const loop = () => {
      if (!this.running || !this.machine) return;
      const now = performance.now();
      const wall = Math.min(now - this.lastWall, 100);
      this.lastWall = now;
      const want = (wall / 1000) * MCU_HZ;
      const cpu = this.machine.cpu;
      const start = cpu.cycles;
      const deadline = now + 14;
      try {
        // chạy từng lát nhỏ để không treo giao diện khi máy chậm
        while (cpu.cycles - start < want && performance.now() < deadline) this.machine.runUntil(Math.min(start + want, cpu.cycles + 20000));
      } catch (e) {
        this.error = `Vi điều khiển dừng: ${(e as Error).message}`;
        this.running = false;
      }
      const ran = cpu.cycles - start;
      this.speedAvg = this.speedAvg * 0.85 + (want > 0 ? ran / want : 1) * 0.15;
      this.emit(this.speedAvg);
      if (this.running) this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  /** Chạy đồng bộ một khoảng thời gian mô phỏng (dùng cho kiểm thử, không cần trình duyệt) */
  step(seconds: number) {
    if (!this.cur) this.apply(this.solve());
    if (this.machine) this.machine.runUntil(this.machine.cpu.cycles + seconds * MCU_HZ);
    this.emit(1);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private emit(speed: number) {
    const cycles = this.machine?.cpu.cycles ?? 0;
    this.account(cycles);
    const span = cycles - this.frameStart;
    const brightness: Record<string, number> = {};
    if (this.machine && span > 0) for (const [k, v] of Object.entries(this.acc)) brightness[k] = v / span;
    else if (this.cur) Object.assign(brightness, this.cur.currents);
    const nodes: Record<string, number> = {};
    if (this.machine && span > 0 && Object.keys(this.accN).length) for (const [k, v] of Object.entries(this.accN)) nodes[k] = v / span;
    else Object.assign(nodes, this.cur?.nodes ?? {});
    this.acc = {};
    this.accN = {};
    this.frameStart = cycles;
    const lcd: LiveFrame['lcd'] = {};
    for (const l of this.lcds) lcd[l.ref] = { lines: l.connected ? l.dev.lines() : ['', ''], backlight: l.connected && l.dev.backlight, connected: l.connected };
    const oled: LiveFrame['oled'] = {};
    for (const o of this.oleds) oled[o.ref] = { fb: o.dev.fb.slice(), on: o.connected && o.dev.on, invert: o.dev.invert, connected: o.connected, version: o.dev.version };
    const pressedRefs: Record<string, boolean> = {};
    for (const c of this.doc.components) if (this.pressed[c.id]) pressedRefs[c.ref] = true;
    this.onFrame({
      brightness, nodes, lcd, oled, pressed: pressedRefs, speed,
      simTime: cycles / MCU_HZ, serial: this.machine?.serial ?? '', mcu: this.mcu?.ref ?? null, notes: this.notes, error: this.error,
    });
  }
}
