// Đồng hồ điện tử mẫu cho Netlist: ATmega328P 16 MHz (Arduino Nano).
// - LED 7 đoạn 4 số, katốt chung, quét: đoạn a..g = D2..D8, dp = D9, chữ số 1..4 = D10..D13 (mức thấp = bật)
// - LCD 1602 qua I2C (PCF8574, địa chỉ 0x27) ở A4/A5: dòng 1 "DONG HO NETLIST", dòng 2 "HH:MM:SS"
// - Nút A0 = tăng giờ, A1 = tăng phút (nối xuống GND, dùng điện trở kéo lên nội)
// - D13... không dùng LED tích hợp vì là chân chữ số 4.
// Biên dịch: avr-gcc -mmcu=atmega328p -DF_CPU=16000000UL -Os clock.c -o clock.elf && avr-objcopy -O ihex clock.elf clock.hex
#include <avr/io.h>
#include <avr/interrupt.h>
#include <util/twi.h>

static volatile uint32_t ms = 0;
static volatile uint8_t h = 12, m = 0, s = 0;
static volatile uint8_t digit = 0;
static volatile uint8_t colon = 1;

// a b c d e f g (bit0 = a)
static const uint8_t SEG[10] = { 0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F };

static void show(uint8_t pattern, uint8_t dp, uint8_t which) {
  // tắt mọi chữ số trước (D10..D13 = PB2..PB5 lên cao)
  PORTB |= 0x3C;
  // đoạn a..f = PD2..PD7, g = PB0, dp = PB1
  PORTD = (PORTD & 0x03) | ((pattern & 0x3F) << 2);
  PORTB = (PORTB & ~0x03) | ((pattern >> 6) & 1) | (dp ? 2 : 0);
  // bật chữ số đang quét
  PORTB &= ~(1 << (2 + which));
}

ISR(TIMER1_COMPA_vect) {
  ms++;
  if (ms % 1000 == 0) {
    if (++s >= 60) { s = 0; if (++m >= 60) { m = 0; if (++h >= 24) h = 0; } }
  }
  colon = (ms % 1000) < 500;
  if (ms % 3 == 0) {
    uint8_t v;
    switch (digit) {
      case 0: v = h / 10; break;
      case 1: v = h % 10; break;
      case 2: v = m / 10; break;
      default: v = m % 10; break;
    }
    show(SEG[v], digit == 1 && colon, digit);
    digit = (digit + 1) & 3;
  }
}

// ---------- I2C + LCD (PCF8574: P0=RS P1=RW P2=E P3=đèn nền P4..P7=D4..D7) ----------
static void i2c_start(uint8_t addr) {
  TWCR = (1 << TWINT) | (1 << TWSTA) | (1 << TWEN);
  while (!(TWCR & (1 << TWINT)));
  TWDR = addr << 1;
  TWCR = (1 << TWINT) | (1 << TWEN);
  while (!(TWCR & (1 << TWINT)));
}
static void i2c_write(uint8_t b) {
  TWDR = b;
  TWCR = (1 << TWINT) | (1 << TWEN);
  while (!(TWCR & (1 << TWINT)));
}
static void i2c_stop(void) { TWCR = (1 << TWINT) | (1 << TWSTO) | (1 << TWEN); }

static void delay_ms(uint16_t d) { uint32_t t = ms; while (ms - t < d); }

static void lcd_nibble(uint8_t n, uint8_t rs) {
  uint8_t b = (n << 4) | 0x08 | (rs ? 1 : 0);
  i2c_write(b | 0x04);
  i2c_write(b);
}
static void lcd_byte(uint8_t v, uint8_t rs) {
  i2c_start(0x27);
  lcd_nibble(v >> 4, rs);
  lcd_nibble(v & 0x0F, rs);
  i2c_stop();
}
static void lcd_init(void) {
  delay_ms(50);
  i2c_start(0x27);
  lcd_nibble(0x3, 0); lcd_nibble(0x3, 0); lcd_nibble(0x3, 0); lcd_nibble(0x2, 0);
  i2c_stop();
  lcd_byte(0x28, 0); // 4 bit, 2 dòng
  lcd_byte(0x0C, 0); // bật màn, tắt con trỏ
  lcd_byte(0x06, 0); // tự tăng địa chỉ
  lcd_byte(0x01, 0); // xoá
  delay_ms(2);
}
static void lcd_at(uint8_t col, uint8_t row) { lcd_byte(0x80 | (col + (row ? 0x40 : 0)), 0); }
static void lcd_print(const char *t) { while (*t) lcd_byte(*t++, 1); }
static void lcd_2d(uint8_t v) { lcd_byte('0' + v / 10, 1); lcd_byte('0' + v % 10, 1); }

int main(void) {
  PORTB |= 0x3C;         // chữ số tắt trước khi bật chế độ ra
  DDRD |= 0xFC;          // D2..D7 ra
  DDRB |= 0x3F;          // D8..D13 ra
  DDRC &= ~0x03;         // A0, A1 vào
  PORTC |= 0x03;         // kéo lên nội
  TWBR = 72;             // I2C 100 kHz
  TCCR1A = 0;
  TCCR1B = (1 << WGM12) | (1 << CS11) | (1 << CS10); // CTC, chia 64
  OCR1A = 249;           // 1 ms
  TIMSK1 = (1 << OCIE1A);
  sei();

  lcd_init();
  lcd_at(0, 0); lcd_print("DONG HO NETLIST");
  uint8_t lastS = 255, lastA = 1, lastB = 1;
  for (;;) {
    uint8_t a = PINC & 1, b = (PINC >> 1) & 1;
    if (!a && lastA) { h = (h + 1) % 24; lastS = 255; }
    if (!b && lastB) { m = (m + 1) % 60; s = 0; lastS = 255; }
    lastA = a; lastB = b;
    if (s != lastS) {
      lastS = s;
      lcd_at(4, 1); lcd_2d(h); lcd_byte(':', 1); lcd_2d(m); lcd_byte(':', 1); lcd_2d(s);
    }
    delay_ms(20);
  }
}
