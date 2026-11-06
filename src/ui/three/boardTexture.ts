// Hoạ tiết bo mạch thủ tục (chỉ trang trí): mặt nạ hàn đen, đường mạch vàng mờ, via, chữ silkscreen.
// Độ tương phản thấp để không bị nhầm với đường mạch thật của sơ đồ.
import * as THREE from 'three';

let cache: { map: THREE.CanvasTexture; rough: THREE.CanvasTexture } | null = null;

function rng(seed: number) {
  return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
}

export function boardTextures(decor = true) {
  if (cache && decor) return cache;
  const N = 1024;
  const c = document.createElement('canvas'); c.width = N; c.height = N;
  const r = document.createElement('canvas'); r.width = N; r.height = N;
  const ctx = c.getContext('2d')!, rc = r.getContext('2d')!;
  const rand = rng(7);
  // nền mặt nạ hàn + nhiễu
  ctx.fillStyle = '#0b0c11'; ctx.fillRect(0, 0, N, N);
  rc.fillStyle = '#9a9a9a'; rc.fillRect(0, 0, N, N);
  for (let i = 0; i < 9000; i++) {
    const g = 10 + rand() * 14;
    ctx.fillStyle = `rgb(${g},${g},${g + 4})`;
    ctx.fillRect(rand() * N, rand() * N, 2, 2);
  }
  if (decor) {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    rc.lineCap = 'round'; rc.lineJoin = 'round';
    const step = 16;
    for (let i = 0; i < 260; i++) {
      let x = Math.round((rand() * N) / step) * step, y = Math.round((rand() * N) / step) * step;
      const w = rand() < 0.75 ? 2 : 4;
      const col = rand() < 0.85 ? '#33290f' : '#3f3212';
      ctx.strokeStyle = col; ctx.lineWidth = w;
      rc.strokeStyle = '#3a3a3a'; rc.lineWidth = w;
      ctx.beginPath(); ctx.moveTo(x, y); rc.beginPath(); rc.moveTo(x, y);
      const segs = 2 + Math.floor(rand() * 4);
      let dir = Math.floor(rand() * 4);
      for (let s = 0; s < segs; s++) {
        const len = (2 + Math.floor(rand() * 8)) * step;
        const diag = rand() < 0.35;
        const dx = [1, 0, -1, 0][dir], dy = [0, 1, 0, -1][dir];
        if (diag) { x += (dx || (rand() < 0.5 ? 1 : -1)) * step * 2; y += (dy || (rand() < 0.5 ? 1 : -1)) * step * 2; }
        else { x += dx * len; y += dy * len; }
        ctx.lineTo(x, y); rc.lineTo(x, y);
        dir = (dir + (rand() < 0.5 ? 1 : 3)) % 4;
      }
      ctx.stroke(); rc.stroke();
      // via ở cuối
      ctx.fillStyle = '#4a3b17'; ctx.beginPath(); ctx.arc(x, y, w + 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#07070a'; ctx.beginPath(); ctx.arc(x, y, w - 0.5, 0, Math.PI * 2); ctx.fill();
    }
    // bus song song
    for (let b = 0; b < 6; b++) {
      const y0 = rand() * N, x0 = rand() * N * 0.6, len = 120 + rand() * 300;
      ctx.strokeStyle = '#33290f'; ctx.lineWidth = 1.5;
      for (let k = 0; k < 8; k++) { ctx.beginPath(); ctx.moveTo(x0, y0 + k * 7); ctx.lineTo(x0 + len, y0 + k * 7); ctx.lineTo(x0 + len + 20, y0 + k * 7 + 20); ctx.stroke(); }
    }
    // silkscreen
    ctx.fillStyle = 'rgba(220,215,230,0.18)';
    ctx.font = '600 14px monospace';
    for (let i = 0; i < 26; i++) ctx.fillText(['R', 'C', 'U', 'TP', 'J', 'D'][Math.floor(rand() * 6)] + Math.floor(rand() * 90 + 1), rand() * N, rand() * N);
  }
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  const rough = new THREE.CanvasTexture(r);
  for (const t of [map, rough]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / 100, 1 / 100); t.anisotropy = 8; }
  const out = { map, rough };
  if (decor) cache = out;
  return out;
}
