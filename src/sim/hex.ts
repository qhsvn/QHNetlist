// Đọc file Intel HEX thành bộ nhớ chương trình (byte).
export function parseIntelHex(text: string, size = 0x8000): Uint8Array {
  const mem = new Uint8Array(size);
  let base = 0;
  let any = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (!line.startsWith(':')) throw new Error('File không đúng định dạng Intel HEX');
    const bytes = line.slice(1).match(/../g)!.map((h) => parseInt(h, 16));
    const len = bytes[0], addr = (bytes[1] << 8) | bytes[2], type = bytes[3];
    const sum = bytes.reduce((a, b) => (a + b) & 0xff, 0);
    if (sum !== 0) throw new Error('Sai checksum trong file HEX');
    if (type === 0) {
      for (let i = 0; i < len; i++) {
        const a = base + addr + i;
        if (a >= size) throw new Error('Chương trình lớn hơn bộ nhớ flash 32 KB');
        mem[a] = bytes[4 + i];
      }
      any = true;
    } else if (type === 1) break;
    else if (type === 2) base = ((bytes[4] << 8) | bytes[5]) << 4;
    else if (type === 4) base = ((bytes[4] << 8) | bytes[5]) << 16;
  }
  if (!any) throw new Error('File HEX không có dữ liệu');
  return mem;
}
