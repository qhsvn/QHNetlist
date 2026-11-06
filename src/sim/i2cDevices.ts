// Thiết bị I²C giả lập: LCD 1602 qua PCF8574 (HD44780 4 bit) và OLED SSD1306 128×64.

export interface I2CDevice {
  address: number;
  start(): void;
  write(b: number): void;
  read(): number;
  stop(): void;
}

/** LCD 16×2 HD44780 qua bộ mở rộng PCF8574 (P0=RS, P1=RW, P2=E, P3=đèn nền, P4..P7=D4..D7). */
export class Lcd1602 implements I2CDevice {
  ddram = new Uint8Array(0x80).fill(0x20);
  addr = 0;
  fourBit = false;
  half: number | null = null;
  backlight = true;
  displayOn = false;
  private last = 0;
  version = 0;
  constructor(public address = 0x27) {}
  start() {}
  stop() {}
  read() { return this.last; }
  write(b: number) {
    const prevE = this.last & 0x04;
    this.last = b;
    this.backlight = !!(b & 0x08);
    if (prevE && !(b & 0x04)) this.latch((b >> 4) & 0x0f, !!(b & 0x01));
  }
  private latch(nib: number, rs: boolean) {
    if (!this.fourBit) {
      // chế độ 8 bit: D0..D3 không nối, chỉ nhận nibble cao
      const v = nib << 4;
      if (!rs && (v & 0xe0) === 0x20) { this.fourBit = !(v & 0x10); this.half = null; }
      return;
    }
    if (this.half === null) { this.half = nib; return; }
    const v = (this.half << 4) | nib;
    this.half = null;
    if (rs) this.data(v); else this.command(v);
  }
  private command(v: number) {
    if (v & 0x80) this.addr = v & 0x7f;
    else if (v & 0x40) { /* CGRAM: bỏ qua */ }
    else if (v & 0x20) this.fourBit = !(v & 0x10);
    else if (v & 0x08) this.displayOn = !!(v & 0x04);
    else if (v === 0x01) { this.ddram.fill(0x20); this.addr = 0; }
    else if ((v & 0xfe) === 0x02) this.addr = 0;
    this.version++;
  }
  private data(v: number) {
    this.ddram[this.addr & 0x7f] = v;
    this.addr = (this.addr + 1) & 0x7f;
    this.version++;
  }
  lines(): string[] {
    const row = (base: number) => Array.from(this.ddram.slice(base, base + 16), (c) => (c >= 32 && c < 127 ? String.fromCharCode(c) : c === 0xdf ? '°' : ' ')).join('');
    return this.displayOn ? [row(0), row(0x40)] : ['', ''];
  }
}

const SSD_ARGS: Record<number, number> = { 0x20: 1, 0x21: 2, 0x22: 2, 0x81: 1, 0x8d: 1, 0xa8: 1, 0xd3: 1, 0xd5: 1, 0xd9: 1, 0xda: 1, 0xdb: 1, 0x26: 6, 0x27: 6, 0x29: 5, 0x2a: 5, 0xa3: 2 };

/** OLED SSD1306 128×64, chế độ địa chỉ ngang/trang. */
export class Ssd1306 implements I2CDevice {
  fb = new Uint8Array(128 * 8);
  on = false;
  invert = false;
  mode = 2; // 0 ngang, 1 dọc, 2 trang
  col = 0; page = 0;
  c0 = 0; c1 = 127; p0 = 0; p1 = 7;
  version = 0;
  private first = true;
  private dataMode = false;
  private cont = true;
  private pending: number[] = [];
  private need = 0;
  constructor(public address = 0x3c) {}
  start() { this.first = true; }
  stop() {}
  read() { return 0; }
  write(b: number) {
    if (this.first) {
      this.first = false;
      this.dataMode = !!(b & 0x40);
      this.cont = !(b & 0x80);
      return;
    }
    if (!this.cont) {
      // Co = 1: mỗi byte có byte điều khiển riêng
      this.first = true;
    }
    if (this.dataMode) this.data(b); else this.cmd(b);
  }
  private cmd(b: number) {
    if (this.need > 0) {
      this.pending.push(b);
      if (--this.need === 0) this.apply(this.pending[0], this.pending.slice(1));
      return;
    }
    if (SSD_ARGS[b]) { this.pending = [b]; this.need = SSD_ARGS[b]; return; }
    this.apply(b, []);
  }
  private apply(c: number, a: number[]) {
    if (c === 0xae) this.on = false;
    else if (c === 0xaf) this.on = true;
    else if (c === 0xa6) this.invert = false;
    else if (c === 0xa7) this.invert = true;
    else if (c === 0x20) this.mode = a[0] & 3;
    else if (c === 0x21) { this.c0 = a[0] & 127; this.c1 = a[1] & 127; this.col = this.c0; }
    else if (c === 0x22) { this.p0 = a[0] & 7; this.p1 = a[1] & 7; this.page = this.p0; }
    else if (c >= 0xb0 && c <= 0xb7) this.page = c & 7;
    else if (c <= 0x0f) this.col = (this.col & 0xf0) | c;
    else if (c >= 0x10 && c <= 0x1f) this.col = (this.col & 0x0f) | ((c & 0x0f) << 4);
    this.version++;
  }
  private data(b: number) {
    this.fb[this.page * 128 + (this.col & 127)] = b;
    if (this.mode === 0) {
      if (++this.col > this.c1) { this.col = this.c0; if (++this.page > this.p1) this.page = this.p0; }
    } else if (this.mode === 1) {
      if (++this.page > this.p1) { this.page = this.p0; if (++this.col > this.c1) this.col = this.c0; }
    } else this.col = (this.col + 1) & 127;
    this.version++;
  }
  pixel(x: number, y: number): boolean {
    const on = !!(this.fb[(y >> 3) * 128 + x] & (1 << (y & 7)));
    return this.invert ? !on : on;
  }
}
