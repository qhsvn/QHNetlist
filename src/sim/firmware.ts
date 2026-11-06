// Chương trình mẫu đã biên dịch sẵn (mã nguồn trong thư mục firmware/).
import clockHex from '../../firmware/clock/clock.hex?raw';

export const SAMPLE_FIRMWARE: Record<string, { name: string; hex: string; description: string }> = {
  clock: {
    name: 'dong-ho.hex',
    hex: clockHex,
    description: 'Đồng hồ: LED 7 đoạn 4 số quét ở D2–D13, LCD I²C 0x27 ở A4/A5, nút A0 tăng giờ, A1 tăng phút',
  },
};
