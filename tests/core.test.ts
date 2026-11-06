import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeConnectivity } from '../src/core/connectivity';
import { emptyDocument } from '../src/core/document';
import { removeComponent, splitWire, addWire } from '../src/core/commands';
import { FIXTURES } from '../src/core/fixtures';
import { applyOperations, parseProposal } from '../src/core/patch';
import { simulateBuiltin } from '../src/core/solver';
import { compileSpice } from '../src/core/spice';
import { parseValue } from '../src/core/units';
import { bomCsv, parseProject, serializeProject } from '../src/core/exporters';
import { runChecks } from '../src/core/erc';
import { parseNgspiceOp, parseWrdata } from '../src/core/ngspiceParse';

describe('units', () => {
  it('parses SI values', () => {
    expect(parseValue('4.7k')).toBeCloseTo(4700);
    expect(parseValue('10u')).toBeCloseTo(1e-5);
    expect(parseValue('1meg')).toBeCloseTo(1e6);
    expect(parseValue('2k2')).toBeCloseTo(2200);
    expect(parseValue('100nF')).toBeCloseTo(1e-7);
    expect(parseValue('5V')).toBe(5);
    expect(parseValue('abc')).toBeNull();
  });
});

describe('connectivity & compiler', () => {
  it('voltage divider compiles deterministically', () => {
    const doc = FIXTURES.divider.make();
    const a = compileSpice(doc).text;
    const b = compileSpice(doc).text;
    expect(a).toBe(b);
    expect(a).toMatch(/^V1 n001 0 DC 5$/m);
    expect(a).toMatch(/^R1 n001 out 1000$/m);
    expect(a).toMatch(/^R2 out 0 1000$/m);
    expect(compileSpice(doc).errors).toEqual([]);
  });

  it('junction split keeps the net, delete removes wires', () => {
    let doc = FIXTURES.divider.make();
    const w = doc.wires[0];
    const before = computeConnectivity(doc).nets.length;
    doc = splitWire(doc, w.id, 50, 50).doc;
    expect(computeConnectivity(doc).nets.length).toBe(before + 0);
    const r1 = doc.components.find((c) => c.ref === 'R1')!;
    doc = removeComponent(doc, r1.id);
    expect(doc.wires.some((x) => (x.a.kind === 'pin' && x.a.comp === r1.id) || (x.b.kind === 'pin' && x.b.comp === r1.id))).toBe(false);
  });

  it('save/load round-trip keeps connectivity', () => {
    const doc = FIXTURES.led.make();
    const re = parseProject(serializeProject(doc));
    expect(compileSpice(re).text).toBe(compileSpice(doc).text);
  });

  it('ERC flags missing ground', () => {
    const { doc } = applyOperations(emptyDocument(), [
      { op: 'add_component', type: 'resistor', ref: 'R1' },
      { op: 'add_component', type: 'vsource', ref: 'V1' },
      { op: 'connect', from: 'V1.p', to: 'R1.1' },
      { op: 'connect', from: 'V1.n', to: 'R1.2' },
    ]);
    expect(runChecks(doc).some((i) => i.severity === 'error' && /ground/.test(i.message))).toBe(true);
  });

  it('BOM groups by value and escapes CSV', () => {
    const csv = bomCsv(FIXTURES.divider.make());
    expect(csv).toContain('R1 R2,Điện trở,1k,2');
  });
});

describe('builtin solver', () => {
  it('divider gives 2.5 V and 2.5 mA', () => {
    const r = simulateBuiltin(FIXTURES.divider.make(), 'op');
    expect(r.ok).toBe(true);
    expect(Math.abs(r.op!.nodes.out - 2.5)).toBeLessThan(1e-6);
    expect(Math.abs(r.op!.currents.R1) - 2.5e-3).toBeLessThan(1e-9);
    expect(r.op!.currents.V1).toBeCloseTo(-2.5e-3, 9);
  });

  it('RC reaches ~63.2% at one tau', () => {
    const r = simulateBuiltin(FIXTURES.rc.make(), 'tran');
    expect(r.ok).toBe(true);
    const { time, series } = r.tran!;
    const i = time.findIndex((t) => t >= 1e-3);
    const v = series.vc[i];
    expect(Math.abs(v - 5 * 0.632)).toBeLessThan(0.05); // 1% của 5 V
  });

  it('LED forward voltage is plausible and current flows', () => {
    const r = simulateBuiltin(FIXTURES.led.make(), 'op');
    expect(r.ok).toBe(true);
    const i = r.op!.currents.D1;
    expect(i).toBeGreaterThan(5e-3);
    expect(i).toBeLessThan(12e-3);
  });

  it('rejects BJT gracefully', () => {
    const { doc } = applyOperations(emptyDocument(), [{ op: 'add_component', type: 'npn', ref: 'Q1' }, { op: 'add_component', type: 'ground' }]);
    const r = simulateBuiltin(doc, 'op');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ngspice/);
  });
});

describe('AI patch', () => {
  it('rejects invalid refs and keeps circuit intact', () => {
    const doc = FIXTURES.divider.make();
    expect(() => applyOperations(doc, [{ op: 'set_params', ref: 'R9', params: { value: '1k' } }])).toThrow(/R9/);
    expect(() => applyOperations(doc, [{ op: 'connect', from: 'R1.9', to: 'R2.1' }])).toThrow(/chân/);
    expect(() => applyOperations(doc, [{ op: 'set_params', ref: 'R1', params: { value: 'xyz' } }])).toThrow();
    expect(doc.components.find((c) => c.ref === 'R1')!.params.value).toBe('1k');
  });

  it('parses fenced JSON proposals', () => {
    const p = parseProposal('Đây:\n```json\n{"explanation":"ok","operations":[{"op":"clear"}]}\n```', 3);
    expect(p.operations).toHaveLength(1);
    expect(p.baseRevision).toBe(3);
  });

  it('accepts pin aliases', () => {
    const { doc } = applyOperations(emptyDocument(), [
      { op: 'add_component', type: 'vsource', ref: 'V1' },
      { op: 'add_component', type: 'led', ref: 'D1' },
      { op: 'connect', from: 'V1.+', to: 'D1.A' },
    ]);
    expect(doc.wires).toHaveLength(1);
    void addWire;
  });
});

function hasNgspice(): boolean {
  try { execFileSync('ngspice', ['-v'], { stdio: 'ignore' }); return true; } catch { return false; }
}

describe.skipIf(!hasNgspice())('ngspice integration', () => {
  it('divider via ngspice = 2.5 V', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nl-'));
    const doc = FIXTURES.divider.make();
    const c = compileSpice(doc, { analysis: 'op', control: {} });
    const f = join(dir, 'c.cir');
    writeFileSync(f, c.text);
    const out = execFileSync('ngspice', ['-b', f], { encoding: 'utf8' });
    const op = parseNgspiceOp(out, c.elementMap);
    expect(Math.abs(op.nodes.out - 2.5)).toBeLessThan(1e-6);
  });

  it('RC via ngspice ~63.2% at tau', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nl-'));
    const doc = FIXTURES.rc.make();
    const data = join(dir, 'tran.txt');
    const c = compileSpice(doc, { analysis: 'tran', control: { tranFile: data } });
    const f = join(dir, 'c.cir');
    writeFileSync(f, c.text);
    execFileSync('ngspice', ['-b', f], { encoding: 'utf8' });
    const tr = parseWrdata(readFileSync(data, 'utf8'));
    const i = tr.time.findIndex((t) => t >= 1e-3);
    expect(Math.abs(tr.series.vc[i] - 3.16)).toBeLessThan(0.05);
  });
});
