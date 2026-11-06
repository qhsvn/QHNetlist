import { describe, expect, it } from 'vitest';
import { FIXTURES } from '../src/core/fixtures';
import { simulateBuiltin } from '../src/core/solver';
import { evalBinding, normalizeDevice, snapshotFromResult } from '../src/core/device';
import { applyOperations } from '../src/core/patch';
import { parseProject, serializeProject } from '../src/core/exporters';
import { LiveSession } from '../src/sim/live';

describe('thiết bị 3D', () => {
  it('xe máy điện: tốc độ theo dòng động cơ, tay ga tăng tốc, đèn sáng', () => {
    const doc = FIXTURES.scooter.make();
    expect(doc.device?.parts.length).toBeGreaterThan(20);
    const r = simulateBuiltin(doc, 'op');
    expect(r.ok).toBe(true);
    const snap = snapshotFromResult(r);
    const m = evalBinding(doc, doc.device!.road!, snap);
    expect(m.value).toBeGreaterThan(2.3);
    expect(m.value).toBeLessThan(3.3);
    expect(m.level).toBeGreaterThan(0.2);
    expect(m.level).toBeLessThan(0.4);
    const lamp = doc.device!.parts.find((p) => p.id === 'lamp')!.motion!;
    expect(evalBinding(doc, lamp, snap).level).toBeGreaterThan(0.5);
    // nhấn tay ga (SW2) → gần hết tốc
    const sw2 = doc.components.find((c) => c.ref === 'SW2')!;
    const pressed = { ...doc, components: doc.components.map((c) => (c.id === sw2.id ? { ...c, params: { ...c.params, pressed: '1' } } : c)) };
    const full = evalBinding(pressed, doc.device!.road!, snapshotFromResult(simulateBuiltin(pressed, 'op')));
    expect(full.level).toBeGreaterThan(0.9);
    // tắt khoá → dừng
    const sw1 = doc.components.find((c) => c.ref === 'SW1')!;
    const off = { ...doc, components: doc.components.map((c) => (c.id === sw1.id ? { ...c, params: { ...c.params, closed: '0' } } : c)) };
    expect(evalBinding(off, doc.device!.road!, snapshotFromResult(simulateBuiltin(off, 'op'))).level).toBeLessThan(0.01);
  });

  it('chạy thật không vi điều khiển: nhấn SW2 tăng tốc', () => {
    const doc = FIXTURES.scooter.make();
    let frame: any = null;
    const s = new LiveSession(doc, (f) => { frame = f; });
    s.step(0.01);
    const lv0 = evalBinding(doc, doc.device!.road!, { nodes: frame.nodes }).level;
    s.press(doc.components.find((c) => c.ref === 'SW2')!.id, true);
    s.step(0.01);
    const lv1 = evalBinding(doc, doc.device!.road!, { nodes: frame.nodes }).level;
    expect(lv0).toBeLessThan(0.4);
    expect(lv1).toBeGreaterThan(0.9);
  });

  it('lưu/mở giữ thiết bị; patch sai bị từ chối', () => {
    const doc = FIXTURES.scooter.make();
    const back = parseProject(serializeProject(doc));
    expect(back.device?.parts.length).toBe(doc.device!.parts.length);
    expect(() => applyOperations(doc, [{ op: 'set_device', device: { name: 'x', parts: [{ id: 'a', shape: 'box', size: [1, 1, 1], motion: { type: 'spin', ref: 'M9' } }] } as any }])).toThrow(/M9/);
    expect(() => normalizeDevice({ name: 'x', parts: [{ id: 'a', shape: 'blob', size: [1] }] })).toThrow(/shape/);
    expect(() => normalizeDevice({ name: 'x', parts: [{ id: 'a', shape: 'box', size: [1, 1, 1], parent: 'b' }, { id: 'b', shape: 'box', size: [1, 1, 1], parent: 'a' }] })).toThrow(/vòng/);
    const renamed = applyOperations(doc, [{ op: 'rename', ref: 'M1', newRef: 'M10' }]).doc;
    expect(renamed.device!.road!.ref).toBe('M10');
    expect(applyOperations(doc, [{ op: 'remove_device' }]).doc.device).toBeUndefined();
  });
});
