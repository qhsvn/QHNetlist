// Kiểm thử thư viện linh kiện mở rộng: dữ liệu thư viện, biên dịch SPICE, ngspice và bộ giải tích hợp.
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { COMPONENT_TYPES, GRID, LIBRARY, isSymbolOnly } from '../src/core/library';
import { emptyDocument } from '../src/core/document';
import { applyOperations, type DesignOperation } from '../src/core/patch';
import { compileSpice } from '../src/core/spice';
import { simulateBuiltin } from '../src/core/solver';
import { parseNgspiceOp, parseWrdata } from '../src/core/ngspiceParse';
import { runChecks } from '../src/core/erc';
import type { CircuitDocument, ComponentType } from '../src/core/types';

const hasNgspice = (() => { try { execFileSync('ngspice', ['-v'], { stdio: 'ignore' }); return true; } catch { return false; } })();

function build(ops: DesignOperation[], sim?: Partial<CircuitDocument['sim']>): CircuitDocument {
  const { doc } = applyOperations(emptyDocument('t'), ops);
  return { ...doc, sim: { ...doc.sim, ...sim } };
}

function ngspiceOp(doc: CircuitDocument) {
  const dir = mkdtempSync(join(tmpdir(), 'nlp-'));
  const c = compileSpice(doc, { analysis: 'op', control: {} });
  expect(c.errors).toEqual([]);
  const f = join(dir, 'c.cir');
  writeFileSync(f, c.text);
  const out = execFileSync('ngspice', ['-b', f], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  expect(out).not.toMatch(/could not be simulated|Error:/);
  return parseNgspiceOp(out, c.elementMap);
}

function ngspiceTran(doc: CircuitDocument) {
  const dir = mkdtempSync(join(tmpdir(), 'nlp-'));
  const data = join(dir, 'tran.txt');
  const c = compileSpice(doc, { analysis: 'tran', control: { tranFile: data } });
  expect(c.errors).toEqual([]);
  const f = join(dir, 'c.cir');
  writeFileSync(f, c.text);
  execFileSync('ngspice', ['-b', f], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return parseWrdata(readFileSync(data, 'utf8'));
}

/** Mạch khói: mỗi chân nối qua 10k tới nguồn 5 V (chân chẵn) hoặc ground (chân lẻ). */
function smoke(type: ComponentType): CircuitDocument {
  const def = LIBRARY[type];
  const ops: DesignOperation[] = [
    { op: 'add_component', type: 'vsource', ref: 'VS', params: { value: '5' }, x: -300, y: 0 },
    { op: 'add_component', type: 'ground', ref: 'GND1', x: -300, y: 100 },
    { op: 'add_component', type: 'netlabel', ref: 'NLV', params: { name: 'vcc' }, x: -300, y: -100 },
    { op: 'connect', from: 'VS.n', to: 'GND1.g' },
    { op: 'connect', from: 'VS.p', to: 'NLV.n' },
  ];
  if (isSymbolOnly(type)) {
    ops.push({ op: 'add_component', type, ref: 'X1', x: 0, y: 0 });
    if (type !== 'ground') ops.push({ op: 'add_component', type: 'resistor', ref: 'RL', x: 100, y: 0 }, { op: 'connect', from: 'X1.n', to: 'RL.1' }, { op: 'connect', from: 'RL.2', to: 'VS.n' });
    return build(ops);
  }
  ops.push({ op: 'add_component', type, ref: 'DUT', x: 0, y: 0 });
  def.pins.forEach((p, i) => {
    ops.push({ op: 'add_component', type: 'resistor', ref: `R${i + 1}`, params: { value: '10k' }, x: 300, y: i * 60 });
    ops.push({ op: 'connect', from: `DUT.${p.id}`, to: `R${i + 1}.1` });
    ops.push({ op: 'connect', from: `R${i + 1}.2`, to: i % 2 === 0 ? 'NLV.n' : 'GND1.g' });
  });
  return build(ops);
}

describe('thư viện linh kiện', () => {
  it('có hơn 50 loại linh kiện, mỗi loại dữ liệu hợp lệ', () => {
    expect(COMPONENT_TYPES.length).toBeGreaterThanOrEqual(55);
    for (const t of COMPONENT_TYPES) {
      const d = LIBRARY[t];
      expect(d.type).toBe(t);
      const ids = d.pins.map((p) => p.id);
      expect(new Set(ids).size, `${t} trùng id chân`).toBe(ids.length);
      for (const p of d.pins) {
        expect(Math.abs(p.x % GRID), `${t}.${p.id} lệch lưới`).toBe(0);
        expect(Math.abs(p.y % GRID), `${t}.${p.id} lệch lưới`).toBe(0);
        expect(p.id).toMatch(/^[A-Za-z0-9_+-]+$/);
      }
      for (const pd of d.params) {
        expect(pd.key in d.defaults, `${t}: thiếu mặc định ${pd.key}`).toBe(true);
        if (pd.kind === 'select') expect(pd.options, `${t}.${pd.key}`).toContain(d.defaults[pd.key]);
      }
    }
  });

  it('mọi linh kiện biên dịch SPICE không lỗi với tham số mặc định', () => {
    for (const t of COMPONENT_TYPES) {
      const c = compileSpice(smoke(t));
      expect(c.errors, t).toEqual([]);
    }
  });

  it('mọi linh kiện hỗ trợ bộ giải tích hợp chạy được điểm làm việc', () => {
    for (const t of COMPONENT_TYPES.filter((t) => LIBRARY[t].builtin)) {
      const r = simulateBuiltin(smoke(t), 'op');
      expect(r.ok, `${t}: ${r.error}`).toBe(true);
    }
  });

  it('linh kiện chỉ hiển thị không báo chân hở hàng loạt', () => {
    const doc = build([{ op: 'add_component', type: 'arduino_nano', ref: 'U1', x: 0, y: 0 }, { op: 'add_component', type: 'ground', ref: 'G', x: 0, y: 300 }]);
    expect(runChecks(doc).filter((i) => i.severity === 'warning')).toEqual([]);
  });
});

describe('bộ giải tích hợp — linh kiện mới', () => {
  it('Zener 5V1 ghim áp từ 12 V qua 1k', () => {
    const doc = build([
      { op: 'add_component', type: 'vsource', ref: 'V1', params: { value: '12' }, x: 0, y: 0 },
      { op: 'add_component', type: 'resistor', ref: 'R1', params: { value: '1k' }, x: 120, y: -60 },
      { op: 'add_component', type: 'zener', ref: 'D1', params: { model: 'DZ5V1' }, x: 240, y: 0, rot: 270 },
      { op: 'add_component', type: 'ground', ref: 'G', x: 120, y: 100 },
      { op: 'add_component', type: 'netlabel', ref: 'NL', params: { name: 'z' }, x: 240, y: -100 },
      { op: 'connect', from: 'V1.p', to: 'R1.1' }, { op: 'connect', from: 'R1.2', to: 'D1.k' }, { op: 'connect', from: 'D1.k', to: 'NL.n' },
      { op: 'connect', from: 'D1.a', to: 'G.g' }, { op: 'connect', from: 'V1.n', to: 'G.g' },
    ]);
    const r = simulateBuiltin(doc, 'op');
    expect(r.ok, r.error).toBe(true);
    expect(r.op!.nodes.z).toBeGreaterThan(4.8);
    expect(r.op!.nodes.z).toBeLessThan(5.5);
    if (hasNgspice) expect(Math.abs(ngspiceOp(doc).nodes.z - r.op!.nodes.z)).toBeLessThan(0.3);
  });

  it('biến trở ở giữa chia đôi điện áp; pin 9V có nội trở', () => {
    const doc = build([
      { op: 'add_component', type: 'battery', ref: 'BT1', params: { kind: '9V', rint: '1' }, x: 0, y: 0 },
      { op: 'add_component', type: 'potentiometer', ref: 'RV1', params: { value: '10k', pos: '0.5' }, x: 120, y: 0 },
      { op: 'add_component', type: 'ground', ref: 'G', x: 0, y: 100 },
      { op: 'add_component', type: 'netlabel', ref: 'NL', params: { name: 'w' }, x: 120, y: -80 },
      { op: 'connect', from: 'BT1.p', to: 'RV1.1' }, { op: 'connect', from: 'RV1.2', to: 'G.g' }, { op: 'connect', from: 'BT1.n', to: 'G.g' },
      { op: 'connect', from: 'RV1.w', to: 'NL.n' },
    ]);
    const r = simulateBuiltin(doc, 'op');
    expect(r.ok, r.error).toBe(true);
    expect(Math.abs(r.op!.nodes.w - 4.4996)).toBeLessThan(1e-3);
  });

  it('nguồn E (VCVS) 4 chân: hệ số 3', () => {
    const doc = build([
      { op: 'add_component', type: 'vsource', ref: 'V1', params: { value: '1' }, x: 0, y: 0 },
      { op: 'add_component', type: 'vcvs', ref: 'E1', params: { gain: '3' }, x: 120, y: 0 },
      { op: 'add_component', type: 'resistor', ref: 'R1', x: 240, y: 0, rot: 90 },
      { op: 'add_component', type: 'ground', ref: 'G', x: 0, y: 120 },
      { op: 'add_component', type: 'netlabel', ref: 'NL', params: { name: 'o' }, x: 240, y: -80 },
      { op: 'connect', from: 'V1.p', to: 'E1.cp' }, { op: 'connect', from: 'E1.cn', to: 'G.g' }, { op: 'connect', from: 'V1.n', to: 'G.g' },
      { op: 'connect', from: 'E1.p', to: 'R1.1' }, { op: 'connect', from: 'R1.2', to: 'G.g' }, { op: 'connect', from: 'E1.n', to: 'G.g' },
      { op: 'connect', from: 'E1.p', to: 'NL.n' },
    ]);
    const r = simulateBuiltin(doc, 'op');
    expect(r.ok, r.error).toBe(true);
    expect(Math.abs(r.op!.nodes.o - 3)).toBeLessThan(1e-6);
  });
});

describe.skipIf(!hasNgspice)('ngspice — linh kiện mới', () => {
  it('mọi linh kiện mô phỏng được: ngspice hội tụ điểm làm việc', () => {
    for (const t of COMPONENT_TYPES) {
      if (t === 'ground') continue;
      try { ngspiceOp(smoke(t)); } catch (e) { throw new Error(`${t}: ${(e as Error).message}`); }
    }
  }, 60000);

  it('7805: 12 V vào → 5 V ra; LM317 240/720 → ~5 V', () => {
    const doc = build([
      { op: 'add_component', type: 'vsource', ref: 'V1', params: { value: '12' }, x: 0, y: 0 },
      { op: 'add_component', type: 'vreg', ref: 'U1', params: { model: '7805' }, x: 160, y: -40 },
      { op: 'add_component', type: 'resistor', ref: 'RL', params: { value: '100' }, x: 320, y: 0, rot: 90 },
      { op: 'add_component', type: 'lm317', ref: 'U2', x: 160, y: 200 },
      { op: 'add_component', type: 'resistor', ref: 'R1', params: { value: '240' }, x: 320, y: 200, rot: 90 },
      { op: 'add_component', type: 'resistor', ref: 'R2', params: { value: '720' }, x: 320, y: 320, rot: 90 },
      { op: 'add_component', type: 'ground', ref: 'G', x: 0, y: 420 },
      { op: 'add_component', type: 'netlabel', ref: 'N1', params: { name: 'v5' }, x: 260, y: -100 },
      { op: 'add_component', type: 'netlabel', ref: 'N2', params: { name: 'vadj' }, x: 260, y: 140 },
      { op: 'connect', from: 'V1.p', to: 'U1.in' }, { op: 'connect', from: 'U1.gnd', to: 'G.g' }, { op: 'connect', from: 'V1.n', to: 'G.g' },
      { op: 'connect', from: 'U1.out', to: 'RL.1' }, { op: 'connect', from: 'RL.2', to: 'G.g' }, { op: 'connect', from: 'U1.out', to: 'N1.n' },
      { op: 'connect', from: 'V1.p', to: 'U2.in' }, { op: 'connect', from: 'U2.out', to: 'R1.1' }, { op: 'connect', from: 'R1.2', to: 'U2.adj' },
      { op: 'connect', from: 'U2.adj', to: 'R2.1' }, { op: 'connect', from: 'R2.2', to: 'G.g' }, { op: 'connect', from: 'U2.out', to: 'N2.n' },
    ]);
    const op = ngspiceOp(doc);
    expect(Math.abs(op.nodes.v5 - 5)).toBeLessThan(0.02);
    expect(Math.abs(op.nodes.vadj - 5.04)).toBeLessThan(0.1);
  });

  it('op-amp LM358 khuếch đại không đảo ×2 và bão hoà theo nguồn', () => {
    const mk = (vin: string) => build([
      { op: 'add_component', type: 'vsource', ref: 'VCC', params: { value: '9' }, x: -200, y: 0 },
      { op: 'add_component', type: 'vsource', ref: 'VIN', params: { value: vin }, x: -100, y: 100 },
      { op: 'add_component', type: 'opamp_ic', ref: 'U1', params: { model: 'LM358' }, x: 100, y: 0 },
      { op: 'add_component', type: 'resistor', ref: 'RF', params: { value: '10k' }, x: 200, y: -80 },
      { op: 'add_component', type: 'resistor', ref: 'RG', params: { value: '10k' }, x: 0, y: -120, rot: 90 },
      { op: 'add_component', type: 'ground', ref: 'G', x: -100, y: 220 },
      { op: 'add_component', type: 'netlabel', ref: 'NO', params: { name: 'vo' }, x: 200, y: 40 },
      { op: 'connect', from: 'VCC.p', to: 'U1.vcc' }, { op: 'connect', from: 'VCC.n', to: 'G.g' }, { op: 'connect', from: 'U1.vee', to: 'G.g' },
      { op: 'connect', from: 'VIN.p', to: 'U1.inp' }, { op: 'connect', from: 'VIN.n', to: 'G.g' },
      { op: 'connect', from: 'U1.out', to: 'RF.2' }, { op: 'connect', from: 'RF.1', to: 'U1.inn' }, { op: 'connect', from: 'U1.inn', to: 'RG.2' }, { op: 'connect', from: 'RG.1', to: 'G.g' },
      { op: 'connect', from: 'U1.out', to: 'NO.n' },
    ]);
    expect(Math.abs(ngspiceOp(mk('2')).nodes.vo - 4)).toBeLessThan(0.01);
    expect(Math.abs(ngspiceOp(mk('6')).nodes.vo - 7.5)).toBeLessThan(0.05);
  });

  it('NE555 astable 10k/47k/100n dao động ~6,9 Hz… (chu kỳ ≈ 7,2 ms)', () => {
    const doc = build([
      { op: 'add_component', type: 'vsource', ref: 'V1', params: { value: '9' }, x: -200, y: 0 },
      { op: 'add_component', type: 'timer555', ref: 'U1', x: 100, y: 0 },
      { op: 'add_component', type: 'resistor', ref: 'RA', params: { value: '10k' }, x: -60, y: -120, rot: 90 },
      { op: 'add_component', type: 'resistor', ref: 'RB', params: { value: '47k' }, x: -60, y: 0, rot: 90 },
      { op: 'add_component', type: 'capacitor', ref: 'C1', params: { value: '100n' }, x: -60, y: 140, rot: 90 },
      { op: 'add_component', type: 'capacitor', ref: 'C2', params: { value: '10n' }, x: 260, y: 120, rot: 90 },
      { op: 'add_component', type: 'ground', ref: 'G', x: 100, y: 260 },
      { op: 'add_component', type: 'netlabel', ref: 'NO', params: { name: 'out' }, x: 260, y: -60 },
      { op: 'connect', from: 'V1.p', to: 'U1.vcc' }, { op: 'connect', from: 'V1.n', to: 'G.g' }, { op: 'connect', from: 'U1.gnd', to: 'G.g' },
      { op: 'connect', from: 'U1.vcc', to: 'U1.reset' }, { op: 'connect', from: 'V1.p', to: 'RA.1' },
      { op: 'connect', from: 'RA.2', to: 'U1.dis' }, { op: 'connect', from: 'U1.dis', to: 'RB.1' }, { op: 'connect', from: 'RB.2', to: 'U1.thr' },
      { op: 'connect', from: 'U1.thr', to: 'U1.trig' }, { op: 'connect', from: 'U1.trig', to: 'C1.1' }, { op: 'connect', from: 'C1.2', to: 'G.g' },
      { op: 'connect', from: 'U1.ctrl', to: 'C2.1' }, { op: 'connect', from: 'C2.2', to: 'G.g' }, { op: 'connect', from: 'U1.out', to: 'NO.n' },
    ], { analysis: 'tran', tranStep: '10u', tranStop: '40m' });
    const tr = ngspiceTran(doc);
    const v = tr.series.out;
    const rises: number[] = [];
    for (let i = 1; i < v.length; i++) if (v[i - 1] < 4 && v[i] >= 4) rises.push(tr.time[i]);
    expect(rises.length).toBeGreaterThanOrEqual(3);
    const per = rises[rises.length - 1] - rises[rises.length - 2];
    expect(Math.abs(per - 7.2e-3)).toBeLessThan(0.6e-3);
  }, 30000);

  it('MOSFET IRLZ44N đóng tải khi VGS = 5 V; NAND 2 vào đúng bảng chân lý', () => {
    const doc = build([
      { op: 'add_component', type: 'vsource', ref: 'V1', params: { value: '12' }, x: -200, y: 0 },
      { op: 'add_component', type: 'vsource', ref: 'VG', params: { value: '5' }, x: -100, y: 100 },
      { op: 'add_component', type: 'nmos', ref: 'Q1', params: { model: 'MIRLZ44N' }, x: 100, y: 100 },
      { op: 'add_component', type: 'lamp', ref: 'LA1', params: { voltage: '12', power: '5' }, x: 120, y: -40, rot: 90 },
      { op: 'add_component', type: 'logic_gate', ref: 'U1', params: { gate: 'NAND', vdd: '5' }, x: 300, y: 100 },
      { op: 'add_component', type: 'ground', ref: 'G', x: 0, y: 260 },
      { op: 'add_component', type: 'netlabel', ref: 'ND', params: { name: 'drain' }, x: 200, y: 20 },
      { op: 'add_component', type: 'netlabel', ref: 'NY', params: { name: 'y' }, x: 400, y: 100 },
      { op: 'connect', from: 'V1.p', to: 'LA1.1' }, { op: 'connect', from: 'LA1.2', to: 'Q1.d' }, { op: 'connect', from: 'Q1.s', to: 'G.g' },
      { op: 'connect', from: 'VG.p', to: 'Q1.g' }, { op: 'connect', from: 'VG.n', to: 'G.g' }, { op: 'connect', from: 'V1.n', to: 'G.g' },
      { op: 'connect', from: 'Q1.d', to: 'ND.n' },
      { op: 'connect', from: 'VG.p', to: 'U1.a' }, { op: 'connect', from: 'VG.p', to: 'U1.b' }, { op: 'connect', from: 'U1.y', to: 'NY.n' },
    ]);
    const op = ngspiceOp(doc);
    expect(op.nodes.drain).toBeLessThan(0.2);
    expect(op.nodes.y).toBeLessThan(0.1);
  });
});

describe('mạch mẫu mới', () => {
  it('các mạch mẫu không có lỗi ERC', async () => {
    const { FIXTURES } = await import('../src/core/fixtures');
    for (const [k, f] of Object.entries(FIXTURES)) {
      const errs = runChecks(f.make()).filter((i) => i.severity !== 'info');
      expect(errs, k).toEqual([]);
    }
  });
  it.skipIf(!hasNgspice)('nguồn 7805 ra 5 V, LED xanh có dòng (đầu dò ngspice)', async () => {
    const { FIXTURES } = await import('../src/core/fixtures');
    const op = ngspiceOp(FIXTURES.psu7805.make());
    expect(Math.abs(op.nodes.v5 - 5)).toBeLessThan(0.05);
    expect(op.currents.D2).toBeGreaterThan(1e-3);
  });
  it.skipIf(!hasNgspice)('động cơ PWM: drain dao động giữa ~0 và ≥ 12 V', async () => {
    const { FIXTURES } = await import('../src/core/fixtures');
    const tr = ngspiceTran(FIXTURES.motorpwm.make());
    const d = tr.series.drain;
    expect(Math.min(...d)).toBeLessThan(0.5);
    expect(Math.max(...d)).toBeGreaterThan(11.5);
  }, 30000);
});

describe.skipIf(!hasNgspice)('linh kiện chỉ hiển thị trong ngspice', () => {
  it('mạch Arduino chạy op và transient không lỗi (chân MCU bỏ qua)', async () => {
    const { FIXTURES } = await import('../src/core/fixtures');
    const doc = FIXTURES.nano.make();
    const op = ngspiceOp(doc);
    expect(Math.abs(op.nodes.dht - 5)).toBeLessThan(1e-3);
    const tr = ngspiceTran({ ...doc, sim: { analysis: 'tran', tranStep: '10u', tranStop: '1m' } });
    expect(tr.time.length).toBeGreaterThan(10);
  });
});
