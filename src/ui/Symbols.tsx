// Ký hiệu schematic vẽ bằng SVG, toạ độ cục bộ khi rot = 0 (chân khớp library.ts).
import { LIBRARY } from '../core/library';
import type { ComponentInstance } from '../core/types';
import type { LiveFrame } from '../sim/live';

const LED_COLORS: Record<string, string> = { LED_RED: '#ff3b5c', LED_GREEN: '#2fe38a', LED_BLUE: '#3fa2ff', LED_YELLOW: '#ffc400', LED_WHITE: '#c9d8ff' };
export const ledColor = (model: string) => LED_COLORS[model] ?? '#ff3b5c';

export function SymbolBody({ c, live }: { c: ComponentInstance; live?: LiveFrame | null }) {
  switch (c.type) {
    case 'seg7':
    case 'seg7x4':
      return <g><BoxSymbol c={c} /><SegDisplay c={c} live={live} /></g>;
    case 'lcd1602':
      return <g><BoxSymbol c={c} /><LcdScreen c={c} live={live} /></g>;
    case 'oled_i2c':
      return <g><BoxSymbol c={c} /><OledScreen c={c} live={live} /></g>;
    case 'resistor':
      return (
        <g>
          <path d="M-40 0H-22 L-18 -8 L-11 8 L-4 -8 L3 8 L10 -8 L17 8 L21 0 H40" />
        </g>
      );
    case 'capacitor':
      return (
        <g>
          <path d="M-40 0H-5 M5 0H40" />
          <path d="M-5 -16V16 M5 -16V16" strokeWidth={3} />
        </g>
      );
    case 'inductor':
      return <path d="M-40 0H-24 a6 6 0 0 1 12 0 a6 6 0 0 1 12 0 a6 6 0 0 1 12 0 a6 6 0 0 1 12 0 H40" />;
    case 'zener':
    case 'schottky':
      return (
        <g>
          <path d="M-40 0H-12 M12 0H40" />
          <path d="M-12 -12 L12 0 L-12 12 Z" />
          <path d={c.type === 'zener' ? 'M6 -16 L12 -12 V12 L18 16' : 'M17 -8 V-12 H12 V12 H7 V8'} strokeWidth={2.4} />
        </g>
      );
    case 'diode':
    case 'led':
      return (
        <g>
          <path d="M-40 0H-12 M12 0H40" />
          <path d="M-12 -12 L12 0 L-12 12 Z" fill={c.type === 'led' ? ledColor(c.params.model) + '33' : 'none'} />
          <path d="M12 -12V12" strokeWidth={2.4} />
          {c.type === 'led' && (
            <g strokeWidth={1.4}>
              <path d="M2 -16 L10 -26 M6 -26 H10 V-22" />
              <path d="M10 -14 L18 -24 M14 -24 H18 V-20" />
            </g>
          )}
        </g>
      );
    case 'vsource': {
      const v = (c.params.value ?? '').toLowerCase();
      return (
        <g>
          <path d="M0 -40V-20 M0 20V40" />
          <circle r={20} fill="var(--sym-fill)" />
          {v.startsWith('pulse') ? (
            <path d="M-11 6 H-5 V-6 H3 V6 H11" strokeWidth={1.6} />
          ) : v.startsWith('sin') ? (
            <path d="M-11 0 C-7 -12 -3 -12 0 0 C3 12 7 12 11 0" strokeWidth={1.6} />
          ) : (
            <g strokeWidth={1.6}><path d="M0 -14V-4 M-5 -9H5" /><path d="M-5 10H5" /></g>
          )}
        </g>
      );
    }
    case 'isource':
      return (
        <g>
          <path d="M0 -40V-20 M0 20V40" />
          <circle r={20} fill="var(--sym-fill)" />
          <path d="M0 12V-10 M-6 -4 L0 -12 L6 -4" strokeWidth={1.8} />
        </g>
      );
    case 'ground':
      return <path d="M0 -20V0 M-14 0H14 M-9 6H9 M-4 12H4" />;
    case 'switch': {
      const closed = (c.params.closed === '1') !== !!live?.pressed[c.ref];
      return (
        <g>
          <path d="M-40 0H-18 M18 0H40" />
          <circle cx={-16} cy={0} r={2.5} fill="currentColor" />
          <circle cx={16} cy={0} r={2.5} fill="currentColor" />
          <path d={closed ? 'M-16 0 L16 -2' : 'M-16 0 L13 -16'} strokeWidth={2.2} />
        </g>
      );
    }
    case 'npn':
    case 'pnp': {
      const npn = c.type === 'npn';
      const cy = npn ? -1 : 1; // hướng chân C
      return (
        <g>
          <circle cx={4} cy={0} r={26} fill="var(--sym-fill)" />
          <path d="M-40 0H-8 M-8 -16V16" />
          <path d={`M-8 ${-8 * cy} L20 ${-24 * cy} V${-40 * cy}`} />
          <path d={`M-8 ${8 * cy} L20 ${24 * cy} V${40 * cy}`} />
          {npn ? (
            <path d="M10 18 L20 24 L13 14" fill="currentColor" strokeWidth={1} />
          ) : (
            <path d="M-2 -12 L-8 -8 L1 -6" fill="currentColor" strokeWidth={1} transform="translate(4 -2)" />
          )}
        </g>
      );
    }
    case 'opamp':
      return (
        <g>
          <path d="M-40 20H-30 M-40 -20H-30 M34 0H40" />
          <path d="M-30 -34 L34 0 L-30 34 Z" fill="var(--sym-fill)" />
          <path d="M-25 -20 H-17 M-25 20 H-17 M-21 16 V24" strokeWidth={1.6} />
        </g>
      );
    case 'capacitor_pol':
      return (
        <g>
          <path d="M-40 0H-5 M5 0H40" />
          <path d="M-5 -16V16" strokeWidth={3} />
          <path d="M9 -16 Q3 0 9 16" strokeWidth={3} />
          <path d="M-16 -14H-10 M-13 -17V-11" strokeWidth={1.4} />
        </g>
      );
    case 'potentiometer':
      return (
        <g>
          <path d="M-40 0H-22 L-18 -8 L-11 8 L-4 -8 L3 8 L10 -8 L17 8 L21 0 H40" />
          <path d="M0 -30 V-12 M-5 -18 L0 -11 L5 -18" strokeWidth={1.8} />
        </g>
      );
    case 'fuse':
      return (
        <g>
          <path d="M-40 0H-20 M20 0H40" />
          <rect x={-20} y={-8} width={40} height={16} rx={2} fill="var(--sym-fill)" />
          <path d="M-20 0 H20" strokeWidth={1.4} />
        </g>
      );
    case 'crystal':
      return (
        <g>
          <path d="M-40 0H-14 M14 0H40 M-14 -14V14 M14 -14V14" />
          <rect x={-8} y={-16} width={16} height={32} fill="var(--sym-fill)" />
        </g>
      );
    case 'transformer':
      return (
        <g>
          <path d="M-40 -30 H-16 V-24 a6 6 0 0 1 0 12 a6 6 0 0 1 0 12 a6 6 0 0 1 0 12 a6 6 0 0 1 0 12 V30 H-40" />
          <path d="M40 -30 H16 V-24 a6 6 0 0 0 0 12 a6 6 0 0 0 0 12 a6 6 0 0 0 0 12 a6 6 0 0 0 0 12 V30 H40" />
          <path d="M-3 -26 V26 M3 -26 V26" strokeWidth={1.6} />
        </g>
      );
    case 'ldr':
    case 'thermistor':
      return (
        <g>
          <path d="M-40 0H-20 M20 0H40" />
          <rect x={-20} y={-8} width={40} height={16} fill="var(--sym-fill)" />
          {c.type === 'ldr' ? (
            <g strokeWidth={1.4}><path d="M-14 -26 L-6 -14 M-10 -15 H-6 V-19" /><path d="M0 -26 L8 -14 M4 -15 H8 V-19" /></g>
          ) : (
            <path d="M-22 16 L22 -16 H30" strokeWidth={1.4} />
          )}
        </g>
      );
    case 'pushbutton': {
      const on = c.params.pressed === '1' || !!live?.pressed[c.ref];
      return (
        <g>
          <path d="M-40 0H-18 M18 0H40" />
          <circle cx={-16} cy={0} r={2.5} fill="currentColor" />
          <circle cx={16} cy={0} r={2.5} fill="currentColor" />
          <path d={on ? 'M-18 -3 H18' : 'M-18 -10 H18'} strokeWidth={2.2} />
          <path d={on ? 'M0 -3 V-16 M-6 -16 H6' : 'M0 -10 V-22 M-6 -22 H6'} strokeWidth={1.8} />
        </g>
      );
    }
    case 'lamp':
      return (
        <g>
          <path d="M-40 0H-16 M16 0H40" />
          <circle r={16} fill="var(--sym-fill)" />
          <path d="M-11 -11 L11 11 M-11 11 L11 -11" strokeWidth={1.6} />
        </g>
      );
    case 'buzzer':
      return (
        <g>
          <path d="M-40 0H-14 M14 0H40" />
          <path d="M-14 6 V-4 A14 14 0 0 1 14 -4 V6 Z" fill="var(--sym-fill)" />
          <path d="M-22 -10 H-16 M-19 -13 V-7" strokeWidth={1.4} />
        </g>
      );
    case 'speaker':
      return (
        <g>
          <path d="M-40 0H-12 M12 0H40" />
          <path d="M-12 0 V-6 H-4 L8 -18 V6 L-4 -6" fill="var(--sym-fill)" />
          <path d="M-12 0 V6 H-4" />
        </g>
      );
    case 'motor':
      return (
        <g>
          <path d="M-40 0H-18 M18 0H40" />
          <circle r={18} fill="var(--sym-fill)" />
          <text x={0} y={6} textAnchor="middle" className="sym-text big">M</text>
        </g>
      );
    case 'battery':
      return (
        <g>
          <path d="M0 -40V-10 M0 10V40" />
          <path d="M-18 -10 H18 M-9 -3 H9 M-18 4 H18 M-9 11 H9" strokeWidth={2.4} />
          <path d="M8 -22 H14 M11 -25 V-19" strokeWidth={1.4} />
        </g>
      );
    case 'clock':
      return (
        <g>
          <path d="M0 -40V-20 M0 20V40" />
          <circle r={20} fill="var(--sym-fill)" />
          <path d="M-12 6 H-6 V-6 H0 V6 H6 V-6 H12" strokeWidth={1.6} />
        </g>
      );
    case 'vcvs':
    case 'vccs':
      return (
        <g>
          <path d="M20 -40 V-18 M20 18 V40 M-40 -20 H-22 M-40 20 H-22" />
          <path d="M20 -18 L38 0 L20 18 L2 0 Z" fill="var(--sym-fill)" />
          {c.type === 'vcvs' ? <path d="M20 -11 V-3 M16 -7 H24 M16 8 H24" strokeWidth={1.4} /> : <path d="M20 10 V-10 M16 -5 L20 -11 L24 -5" strokeWidth={1.4} />}
          <path d="M-30 -26 V-20 M-33 -23 H-27 M-33 26 H-27" strokeWidth={1.2} />
        </g>
      );
    case 'bridge':
      return (
        <g>
          <path d="M-40 0 H-24 M24 0 H40 M0 -40 V-24 M0 24 V40" />
          <path d="M-24 0 L0 -24 L24 0 L0 24 Z" fill="var(--sym-fill)" />
          {[[-12, -12, -45], [12, -12, -135], [-12, 12, -135], [12, 12, -45]].map(([x, y, r], i) => (
            <path key={i} d="M-4 -4 L4 0 L-4 4 Z M4 -4 V4" strokeWidth={1.2} transform={`translate(${x} ${y}) rotate(${r})`} />
          ))}
        </g>
      );
    case 'nmos':
    case 'pmos': {
      const n = c.type === 'nmos';
      return (
        <g>
          <circle cx={6} cy={0} r={26} fill="var(--sym-fill)" />
          <path d="M-40 0 H-10 M-10 -16 V16" />
          <path d="M-4 -18 V-10 M-4 -4 V4 M-4 10 V18" strokeWidth={2.4} />
          <path d="M-4 -14 H20 V-40 M-4 14 H20 V40 M-4 0 H20 V14" />
          {n ? <path d="M2 0 L9 -4 V4 Z" fill="currentColor" strokeWidth={1} /> : <path d="M12 0 L5 -4 V4 Z" fill="currentColor" strokeWidth={1} />}
        </g>
      );
    }
    case 'njfet':
    case 'pjfet': {
      const n = c.type === 'njfet';
      return (
        <g>
          <circle cx={6} cy={0} r={26} fill="var(--sym-fill)" />
          <path d="M-40 0 H-6 M-6 -18 V18" strokeWidth={2.4} />
          <path d="M-6 -12 H20 V-40 M-6 12 H20 V40" />
          {n ? <path d="M-14 0 L-21 -4 V4 Z" fill="currentColor" strokeWidth={1} transform="translate(6 0)" /> : <path d="M-22 0 L-15 -4 V4 Z" fill="currentColor" strokeWidth={1} transform="translate(6 0)" />}
        </g>
      );
    }
    case 'scr':
      return (
        <g>
          <path d="M-40 0H-12 M12 0H40" />
          <path d="M-12 -12 L12 0 L-12 12 Z" fill="var(--sym-fill)" />
          <path d="M12 -12V12" strokeWidth={2.4} />
          <path d="M12 6 L20 16 V30" />
        </g>
      );
    case 'opamp_ic':
    case 'comparator':
      return (
        <g>
          <path d="M-40 20H-30 M-40 -20H-30 M34 0H40 M0 -40 V-17 M0 40 V17" />
          <path d="M-30 -34 L34 0 L-30 34 Z" fill="var(--sym-fill)" />
          <path d="M-25 -20 H-17 M-25 20 H-17 M-21 16 V24" strokeWidth={1.6} />
          <text x={-4} y={4} textAnchor="middle" className="sym-text" transform={c.rot ? `rotate(${-c.rot} -4 0)` : undefined}>{c.type === 'comparator' ? 'LM393' : c.params.model}</text>
        </g>
      );
    case 'logic_gate':
      return <GateSymbol gate={c.params.gate} />;
    case 'logic_not':
      return (
        <g>
          <path d="M-40 0 H-16 M24 0 H40" />
          <path d="M-16 -16 L16 0 L-16 16 Z" fill="var(--sym-fill)" />
          <circle cx={20} cy={0} r={4} fill="var(--sym-fill)" />
        </g>
      );
    case 'power':
      return (
        <g>
          <path d="M0 20 V0" />
          <path d="M-14 0 H14" strokeWidth={2.6} />
          <path d="M-6 -8 L0 -16 L6 -8" strokeWidth={1.6} />
        </g>
      );
    case 'netlabel': {
      return (
        <g>
          <path d="M0 0 L8 -9 H46 V9 H8 Z" fill="var(--label-fill)" strokeWidth={1.4} />
        </g>
      );
    }
      default:
      return LIBRARY[c.type].box ? <BoxSymbol c={c} /> : null;
  }
}

/** Ký hiệu dạng hộp IC/mô-đun: thân chữ nhật, chân có tên. */
function BoxSymbol({ c }: { c: ComponentInstance }) {
  const def = LIBRARY[c.type];
  const { hw, hh, label } = def.box!;
  const header = c.type.startsWith('header');
  return (
    <g>
      {def.pins.map((p) => {
        const left = p.x < -hw, right = p.x > hw, top = p.y < -hh;
        const ex = left ? -hw : right ? hw : p.x, ey = left || right ? p.y : top ? -hh : hh;
        return (
          <g key={p.id}>
            <path d={`M${p.x} ${p.y} L${ex} ${ey}`} />
          </g>
        );
      })}
      <rect x={-hw} y={-hh} width={hw * 2} height={hh * 2} rx={header ? 2 : 4} fill="var(--sym-fill)" />
      {header && def.pins.map((p) => <rect key={p.id} x={-5} y={p.y - 5} width={10} height={10} strokeWidth={1.2} />)}
      {def.pins.map((p) => {
        const left = p.x < -hw, right = p.x > hw, top = p.y < -hh;
        if (header) return null;
        const tx = left ? -hw + 4 : right ? hw - 4 : p.x, ty = left || right ? p.y + 3.5 : top ? -hh + 11 : hh - 5;
        return <text key={p.id} x={tx} y={ty} textAnchor={left ? 'start' : right ? 'end' : 'middle'} className="pin-name">{p.name}</text>;
      })}
      {label && !SCREEN_TYPES.has(c.type) && (
        <text x={0} y={4} textAnchor="middle" className="sym-text" transform={c.rot ? `rotate(${-c.rot})` : undefined}>
          {c.type === 'vreg' ? c.params.model : label}
        </text>
      )}
    </g>
  );
}

/** Ký hiệu cổng logic kiểu ANSI */
function GateSymbol({ gate }: { gate: string }) {
  const inv = gate === 'NAND' || gate === 'NOR' || gate === 'XNOR';
  const orish = gate.includes('OR');
  const xor = gate.startsWith('X');
  const body = orish
    ? 'M-18 -20 Q-6 0 -18 20 Q8 20 22 0 Q8 -20 -18 -20 Z'
    : 'M-18 -20 H4 A20 20 0 0 1 4 20 H-18 Z';
  const outX = inv ? 30 : 24;
  return (
    <g>
      <path d={`M-40 -20 H${orish ? -14 : -18} M-40 20 H${orish ? -14 : -18} M${outX} 0 H40`} />
      <path d={body} fill="var(--sym-fill)" />
      {xor && <path d="M-24 -20 Q-12 0 -24 20" />}
      {inv && <circle cx={27} cy={0} r={3.5} fill="var(--sym-fill)" />}
      <text x={-2} y={4} textAnchor="middle" className="pin-name">{gate}</text>
    </g>
  );
}

const SCREEN_TYPES = new Set(['seg7', 'seg7x4', 'lcd1602', 'oled_i2c']);

/** Độ sáng cảm nhận từ dòng trung bình (A) */
export function glowLevel(i: number | undefined, full = 0.004): number {
  if (!i || i < 1e-4) return 0;
  return Math.min(1, Math.pow(i / full, 0.6));
}

const SEG_PATHS: Record<string, string> = {
  a: 'M-5 -14 H5', b: 'M7 -12 V-2', c: 'M7 2 V12', d: 'M-5 14 H5', e: 'M-7 2 V12', f: 'M-7 -12 V-2', g: 'M-5 0 H5',
};

function SegDisplay({ c, live }: { c: ComponentInstance; live?: LiveFrame | null }) {
  const color = ledColor(c.params.model);
  const n = c.type === 'seg7x4' ? 4 : 1;
  const box = c.type === 'seg7x4' ? { w: 140, h: 70 } : { w: 44, h: 70 };
  const k = (d: number, sg: string) => glowLevel(live?.brightness[`${c.ref}:${d}:${sg}`]);
  return (
    <g>
      <rect x={-box.w / 2} y={-box.h / 2} width={box.w} height={box.h} rx={3} fill="#17151c" stroke="none" />
      {Array.from({ length: n }, (_, d) => {
        const x = n === 1 ? 0 : -48 + d * 32;
        return (
          <g key={d} transform={`translate(${x} 0) scale(${n === 1 ? 1.9 : 1.6}) skewX(-6)`}>
            {Object.entries(SEG_PATHS).map(([sg, path]) => {
              const v = k(d, sg);
              return <path key={sg} d={path} stroke={v > 0 ? color : '#2c2833'} strokeOpacity={v > 0 ? 0.35 + 0.65 * v : 1} strokeWidth={2.6} style={v > 0.05 ? { filter: `drop-shadow(0 0 ${2 + 3 * v}px ${color})` } : undefined} />;
            })}
            {(() => { const v = k(d, 'dp'); return <circle cx={10.5} cy={14} r={1.5} fill={v > 0 ? color : '#2c2833'} stroke="none" fillOpacity={v > 0 ? 0.35 + 0.65 * v : 1} />; })()}
          </g>
        );
      })}
    </g>
  );
}

function LcdScreen({ c, live }: { c: ComponentInstance; live?: LiveFrame | null }) {
  const st = live?.lcd[c.ref];
  const blue = c.params.color !== 'Xanh lá';
  const bg = st?.backlight ? (blue ? '#2f6cf0' : '#8fd14f') : (blue ? '#1e3566' : '#4d6b2c');
  const fg = blue ? '#f2f6ff' : '#1b2a10';
  const lines = st?.lines ?? ['', ''];
  return (
    <g transform={c.rot ? `rotate(${-c.rot})` : undefined}>
      <rect x={-78} y={-28} width={156} height={56} rx={3} fill="#1a1a1f" stroke="none" />
      <rect x={-72} y={-22} width={144} height={44} rx={2} fill={bg} stroke="none" />
      {[0, 1].map((r) => (
        <text key={r} x={-68} y={-4 + r * 18} className="lcd-text" fill={fg} textLength={lines[r]?.trim() ? 136 : undefined} lengthAdjust="spacingAndGlyphs">
          {(lines[r] ?? '').padEnd(16, ' ').replace(/ /g, '\u00a0')}
        </text>
      ))}
    </g>
  );
}

const oledCache = new Map<string, { version: number; url: string }>();
function oledUrl(ref: string, fb: Uint8Array, invert: boolean, version: number): string {
  const hit = oledCache.get(ref);
  if (hit && hit.version === version) return hit.url;
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 64;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(128, 64);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 128; x++) {
    let on = !!(fb[(y >> 3) * 128 + x] & (1 << (y & 7)));
    if (invert) on = !on;
    const i = (y * 128 + x) * 4;
    img.data[i] = on ? 120 : 4; img.data[i + 1] = on ? 200 : 8; img.data[i + 2] = on ? 255 : 16; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const url = cv.toDataURL();
  oledCache.set(ref, { version, url });
  return url;
}

function OledScreen({ c, live }: { c: ComponentInstance; live?: LiveFrame | null }) {
  const st = live?.oled[c.ref];
  return (
    <g>
      <rect x={-62} y={-36} width={136} height={72} rx={3} fill="#050608" stroke="none" />
      {st?.on && <image href={oledUrl(c.ref, st.fb, st.invert, st.version)} x={-58} y={-32} width={128} height={64} style={{ imageRendering: 'pixelated' }} />}
    </g>
  );
}
