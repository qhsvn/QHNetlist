import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { AvrMachine, MCU_HZ } from '../src/sim/avr';
import { Lcd1602 } from '../src/sim/i2cDevices';

const hex = readFileSync(new URL('../firmware/clock/clock.hex', import.meta.url), 'utf8');

describe('giả lập ATmega328P', () => {
  it('firmware đồng hồ: LCD I²C hiện giờ, giây tăng theo thời gian thật', () => {
    const m = new AvrMachine(hex);
    const lcd = new Lcd1602(0x27);
    m.i2c.devices.set(0x27, lcd);
    m.setInput('C', 0, true); m.setInput('C', 1, true);
    const t0 = performance.now();
    m.runUntil(MCU_HZ * 2.1);
    const dt = performance.now() - t0;
    const lines = lcd.lines();
    expect(lines[0]).toBe('DONG HO NETLIST ');
    expect(lines[1].trim()).toBe('12:00:02');
    console.log(`2,1 s mô phỏng mất ${dt.toFixed(0)} ms`);
  });
  it('quét LED 7 đoạn: mỗi lúc chỉ một chữ số bật', () => {
    const m = new AvrMachine(hex);
    const seen = new Set<number>();
    m.ports.B.addListener((v) => { const d = (~v >> 2) & 0x0f; if (d) seen.add(d); });
    m.runUntil(MCU_HZ * 0.1);
    expect([...seen].sort()).toEqual([1, 2, 4, 8]);
  });
});

describe('chạy thời gian thực: mạch đồng hồ mẫu', () => {
  it('LED 7 đoạn hiện 12:00, LCD hiện giờ, nút tăng phút hoạt động', async () => {
    const { FIXTURES } = await import('../src/core/fixtures');
    const { LiveSession } = await import('../src/sim/live');
    const doc = FIXTURES.clock.make();
    let frame: import('../src/sim/live').LiveFrame | null = null;
    const s = new LiveSession(doc, (f) => { frame = f; });
    expect(s).toBeTruthy();
    s.step(0.3); // khởi động, LCD init
    s.step(1.9);
    const f = frame!;
    expect(f.error).toBeUndefined();
    expect(f.notes).toEqual([]);
    expect(f.lcd.LCD1.lines[0]).toBe('DONG HO NETLIST ');
    expect(f.lcd.LCD1.lines[1].trim()).toBe('12:00:02');
    const lit = (d: number) => ['a', 'b', 'c', 'd', 'e', 'f', 'g'].filter((sg) => (f.brightness[`DS1:${d}:${sg}`] ?? 0) > 5e-4).join('');
    expect(lit(0)).toBe('bc');      // 1
    expect(lit(1)).toBe('abdeg');   // 2
    expect(lit(2)).toBe('abcdef');  // 0
    expect(lit(3)).toBe('abcdef');  // 0
    // nhấn nút tăng phút
    const sw2 = doc.components.find((c) => c.ref === 'SW2')!;
    s.press(sw2.id, true);
    s.step(0.1);
    s.press(sw2.id, false);
    s.step(0.3);
    expect(frame!.lcd.LCD1.lines[1].trim()).toBe('12:01:00');
  }, 30000);
});
