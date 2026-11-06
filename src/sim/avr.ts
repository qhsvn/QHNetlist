// Máy ảo ATmega328P (Arduino Nano/Uno) dựa trên avr8js: GPIO, timer, UART, I²C, ADC.
import {
  AVRADC, AVRIOPort, AVRTimer, AVRTWI, AVRUSART, CPU, PinState, adcConfig, avrInstruction,
  portBConfig, portCConfig, portDConfig, timer0Config, timer1Config, timer2Config, twiConfig, usart0Config,
  type TWIEventHandler,
} from 'avr8js';
import { parseIntelHex } from './hex';
import type { I2CDevice } from './i2cDevices';

export const MCU_HZ = 16_000_000;

/** Bus I²C chia sẻ: chuyển sự kiện TWI tới thiết bị theo địa chỉ. */
class I2CBus implements TWIEventHandler {
  devices = new Map<number, I2CDevice>();
  private cur: I2CDevice | null = null;
  constructor(private twi: AVRTWI) {}
  start() { this.twi.completeStart(); }
  stop() { this.cur?.stop(); this.cur = null; this.twi.completeStop(); }
  connectToSlave(addr: number, write: boolean) {
    const d = this.devices.get(addr) ?? null;
    this.cur = d;
    d?.start();
    void write;
    this.twi.completeConnect(!!d);
  }
  writeByte(v: number) {
    if (!this.cur) { this.twi.completeWrite(false); return; }
    this.cur.write(v);
    this.twi.completeWrite(true);
  }
  readByte() { this.twi.completeRead(this.cur ? this.cur.read() : 0xff); }
}

export type PortName = 'B' | 'C' | 'D';

export class AvrMachine {
  cpu: CPU;
  ports: Record<PortName, AVRIOPort>;
  adc: AVRADC;
  i2c: I2CBus;
  serial = '';
  onSerial?: (ch: string) => void;
  constructor(hex: string) {
    const bytes = parseIntelHex(hex);
    this.cpu = new CPU(new Uint16Array(bytes.buffer));
    new AVRTimer(this.cpu, timer0Config);
    new AVRTimer(this.cpu, timer1Config);
    new AVRTimer(this.cpu, timer2Config);
    this.ports = { B: new AVRIOPort(this.cpu, portBConfig), C: new AVRIOPort(this.cpu, portCConfig), D: new AVRIOPort(this.cpu, portDConfig) };
    this.adc = new AVRADC(this.cpu, adcConfig);
    const usart = new AVRUSART(this.cpu, usart0Config, MCU_HZ);
    usart.onByteTransmit = (b) => {
      const ch = String.fromCharCode(b);
      this.serial = (this.serial + ch).slice(-4000);
      this.onSerial?.(ch);
    };
    const twi = new AVRTWI(this.cpu, twiConfig, MCU_HZ);
    this.i2c = new I2CBus(twi);
    twi.eventHandler = this.i2c;
  }
  /** Chạy tới khi bộ đếm chu kỳ đạt target. */
  runUntil(target: number) {
    const cpu = this.cpu;
    while (cpu.cycles < target) {
      avrInstruction(cpu);
      cpu.tick();
    }
  }
  pinState(port: PortName, bit: number): PinState { return this.ports[port].pinState(bit); }
  setInput(port: PortName, bit: number, high: boolean) { this.ports[port].setPin(bit, high); }
}

/** Chân Arduino Nano → cổng/bit của ATmega328P. */
export function nanoPin(id: string): { port: PortName; bit: number; adc?: number } | null {
  let m = id.match(/^d(\d+)$/);
  if (m) { const n = +m[1]; return n <= 7 ? { port: 'D', bit: n } : n <= 13 ? { port: 'B', bit: n - 8 } : null; }
  m = id.match(/^a(\d)$/);
  if (m) { const n = +m[1]; return n <= 5 ? { port: 'C', bit: n, adc: n } : null; }
  return null;
}

/** Chân DIP-28 ATmega328P (p1..p28) → cổng/bit. */
const DIP: Record<number, [PortName, number]> = {
  2: ['D', 0], 3: ['D', 1], 4: ['D', 2], 5: ['D', 3], 6: ['D', 4], 11: ['D', 5], 12: ['D', 6], 13: ['D', 7],
  14: ['B', 0], 15: ['B', 1], 16: ['B', 2], 17: ['B', 3], 18: ['B', 4], 19: ['B', 5],
  23: ['C', 0], 24: ['C', 1], 25: ['C', 2], 26: ['C', 3], 27: ['C', 4], 28: ['C', 5],
};
export function atmegaPin(id: string): { port: PortName; bit: number; adc?: number } | null {
  const m = id.match(/^p(\d+)$/);
  const e = m ? DIP[+m[1]] : undefined;
  return e ? { port: e[0], bit: e[1], adc: e[0] === 'C' ? e[1] : undefined } : null;
}

export { PinState };
