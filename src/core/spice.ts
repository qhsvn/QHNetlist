// Biên dịch document -> netlist SPICE bằng template tin cậy. Không chèn chuỗi thô từ người dùng/AI.
import { computeConnectivity } from './connectivity';
import { LIBRARY, SPICE_MODELS, batteryVoltage, isSymbolOnly, resistiveValue, segmentDiodes } from './library';
import { OPAMP_PARAMS, RELAY_PARAMS, SUBCKTS, VREG_PARAMS } from './spiceLib';
import { clockSpec, parseSource, sourceToSpice } from './sources';
import type { CircuitDocument, ComponentInstance, Connectivity } from './types';
import { parseValue, toSpiceNumber } from './units';

export interface CompiledNetlist {
  text: string;
  errors: string[];
  /** tên phần tử SPICE -> ref UI */
  elementMap: Record<string, string>;
  nets: string[];
  conn: Connectivity;
}

export interface CompileOptions {
  analysis?: 'op' | 'tran';
  /** chèn khối .control để chạy batch và ghi kết quả */
  control?: { tranFile?: string };
}

function elementName(c: ComponentInstance, letter: string): string {
  const clean = c.ref.replace(/[^A-Za-z0-9_]/g, '_');
  return clean.toUpperCase().startsWith(letter) ? clean : `${letter}${clean}`;
}

export function compileSpice(doc: CircuitDocument, opts: CompileOptions = {}): CompiledNetlist {
  const conn = computeConnectivity(doc);
  const errors: string[] = [];
  const lines: string[] = [];
  const models = new Set<string>();
  const elementMap: Record<string, string> = {};
  const node = (c: ComponentInstance, pin: string) => conn.netOf.get(`c:${c.id}:${pin}`) ?? '?';

  const subckts = new Set<string>();
  const probes: string[] = [];
  const leakNets = new Set<string>();
  const extra: string[] = [];
  const fmt = (n: number) => String(Number(n.toPrecision(6)));

  const sorted = [...doc.components].sort((a, b) => a.ref.localeCompare(b.ref, undefined, { numeric: true }));
  for (const c of sorted) {
    const def = LIBRARY[c.type];
    if (!def) { errors.push(`${c.ref}: loại linh kiện không hỗ trợ`); continue; }
    const n = (pin: string) => node(c, pin);
    const p0 = def.pins[0]?.id, p1 = def.pins[1]?.id;
    const num = (key: string, label: string): string | null => {
      const v = toSpiceNumber(c.params[key] ?? '');
      if (v === null) errors.push(`${c.ref}: ${label} "${c.params[key] ?? ''}" không hợp lệ`);
      return v;
    };
    const numv = (key: string, label: string): number | null => {
      const v = parseValue(c.params[key] ?? '');
      if (v === null) errors.push(`${c.ref}: ${label} "${c.params[key] ?? ''}" không hợp lệ`);
      return v;
    };
    const model = (): string | null => {
      const m = c.params.model;
      if (!SPICE_MODELS[m]) { errors.push(`${c.ref}: thiếu mô hình "${m}"`); return null; }
      models.add(m);
      return m;
    };
    const sub = (subName: string, pins: string[], params: Record<string, number | string> = {}) => {
      subckts.add(subName);
      const ps = Object.entries(params).map(([k, v]) => `${k}=${typeof v === 'number' ? fmt(v) : v}`).join(' ');
      return `${elementName(c, 'X')} ${pins.map(n).join(' ')} ${subName}${ps ? ' ' + ps : ''}`;
    };
    let line: string | null = null;
    let name = '';
    switch (c.type) {
      case 'resistor': case 'buzzer': case 'speaker': case 'fuse': case 'lamp': case 'ldr': case 'thermistor': {
        name = elementName(c, 'R');
        const r = resistiveValue(c.type, c.params, parseValue);
        if (r === null || !(r > 0)) { errors.push(`${c.ref}: tham số không hợp lệ (điện trở phải dương)`); break; }
        line = `${name} ${n(p0)} ${n(p1)} ${fmt(r)}`;
        break;
      }
      case 'capacitor': case 'capacitor_pol': case 'inductor': {
        name = elementName(c, c.type === 'inductor' ? 'L' : 'C');
        const v = num('value', def.params[0].label);
        if (v !== null) {
          if (Number(v) <= 0) errors.push(`${c.ref}: giá trị phải dương`);
          line = `${name} ${n(p0)} ${n(p1)} ${v}`;
          if (c.type !== 'inductor' && c.params.ic?.trim()) {
            const ic = num('ic', 'Điện áp ban đầu');
            if (ic !== null) line += ` IC=${ic}`;
          }
        }
        break;
      }
      case 'potentiometer': {
        const r = numv('value', 'Tổng trở'), pos = numv('pos', 'Vị trí');
        if (r === null || pos === null) break;
        if (r <= 0) { errors.push(`${c.ref}: tổng trở phải dương`); break; }
        const k = Math.min(1, Math.max(0, pos));
        name = elementName(c, 'R');
        line = `${name}A ${n('1')} ${n('w')} ${fmt(Math.max(r * k, 1e-3))}\n${name}B ${n('w')} ${n('2')} ${fmt(Math.max(r * (1 - k), 1e-3))}`;
        break;
      }
      case 'crystal': {
        const f = numv('freq', 'Tần số');
        if (f === null || f <= 0) break;
        const ls = 10e-3, cs = 1 / ((2 * Math.PI * f) ** 2 * ls);
        name = elementName(c, 'X');
        line = sub('NL_XTAL', ['1', '2'], { RS: 20, LS: ls, CS: cs, CP: 5e-12 });
        break;
      }
      case 'transformer': {
        const ratio = numv('ratio', 'Tỉ số'), lp = numv('lp', 'Cảm kháng'), k = numv('k', 'Hệ số ghép');
        if (ratio === null || lp === null || k === null) break;
        if (ratio <= 0 || lp <= 0 || k <= 0 || k > 1) { errors.push(`${c.ref}: tỉ số, L phải dương và 0 < k ≤ 1`); break; }
        name = elementName(c, 'X');
        line = sub('NL_XFMR', ['p1', 'p2', 's1', 's2'], { LP: lp, N: ratio, K: Math.min(k, 0.99999) });
        break;
      }
      case 'switch': case 'pushbutton': {
        name = elementName(c, 'R');
        const on = c.type === 'switch' ? c.params.closed : c.params.pressed;
        const closed = on === '1' || on === 'true';
        line = `${name} ${n('1')} ${n('2')} ${closed ? '1e-3' : '1e9'}`;
        break;
      }
      case 'relay': {
        const rp = RELAY_PARAMS[c.params.coil];
        if (!rp) { errors.push(`${c.ref}: điện áp cuộn "${c.params.coil}" không hỗ trợ`); break; }
        name = elementName(c, 'X');
        line = sub('NL_RELAY', ['c1', 'c2', 'com', 'no', 'nc'], { RCOIL: rp.rcoil, VON: rp.von, VOFF: rp.voff });
        break;
      }
      case 'motor': {
        const r = numv('r', 'Điện trở'), l = numv('l', 'Độ tự cảm');
        if (r === null || l === null) break;
        if (r <= 0 || l <= 0) { errors.push(`${c.ref}: R và L phải dương`); break; }
        name = elementName(c, 'R');
        const mid = `int_${name.toLowerCase()}`;
        line = `${name} ${n('p')} ${mid} ${fmt(r)}\nL${name} ${mid} ${n('n')} ${fmt(l)}`;
        break;
      }
      case 'vsource': case 'isource': {
        name = elementName(c, c.type === 'vsource' ? 'V' : 'I');
        const spec = parseSource(c.params.value ?? '');
        if (!spec) { errors.push(`${c.ref}: giá trị nguồn "${c.params.value}" không hợp lệ`); break; }
        line = `${name} ${n('p')} ${n('n')} ${sourceToSpice(spec)}`;
        break;
      }
      case 'battery': {
        const rint = numv('rint', 'Nội trở');
        if (rint === null) break;
        name = elementName(c, 'V');
        const v = batteryVoltage(c.params.kind);
        if (rint > 0) {
          const mid = `int_${name.toLowerCase()}`;
          line = `${name} ${mid} ${n('n')} DC ${fmt(v)}\nR${name} ${n('p')} ${mid} ${fmt(rint)}`;
        } else line = `${name} ${n('p')} ${n('n')} DC ${fmt(v)}`;
        break;
      }
      case 'clock': {
        const spec = clockSpec(c.params);
        if (!spec) { errors.push(`${c.ref}: tần số/mức/độ rộng xung không hợp lệ`); break; }
        name = elementName(c, 'V');
        line = `${name} ${n('p')} ${n('n')} ${sourceToSpice(spec)}`;
        break;
      }
      case 'vcvs': case 'vccs': {
        name = elementName(c, c.type === 'vcvs' ? 'E' : 'G');
        const g = num('gain', 'Hệ số');
        if (g !== null) line = `${name} ${n('p')} ${n('n')} ${n('cp')} ${n('cn')} ${g}`;
        break;
      }
      case 'diode': case 'led': case 'zener': case 'schottky': {
        name = elementName(c, 'D');
        const m = model();
        if (m) line = `${name} ${n('a')} ${n('k')} ${m}`;
        break;
      }
      case 'bridge': {
        name = elementName(c, 'D');
        const m = model();
        if (m) line = [`${name}1 ${n('ac1')} ${n('p')} ${m}`, `${name}2 ${n('ac2')} ${n('p')} ${m}`, `${name}3 ${n('n')} ${n('ac1')} ${m}`, `${name}4 ${n('n')} ${n('ac2')} ${m}`].join('\n');
        break;
      }
      case 'seg7': case 'seg7x4': {
        const m = model();
        if (!m) break;
        const base = elementName(c, 'D');
        for (const d of segmentDiodes(c.type, c.params.common)) {
          const dn = `${base}_${d.key.replace(':', '')}`;
          lines.push(`${dn} ${n(d.a)} ${n(d.k)} ${m}`);
          elementMap[dn] = `${c.ref}:${d.key}`;
          probes.push(`@${dn.toLowerCase()}[id]`);
        }
        break;
      }
      case 'npn': case 'pnp': {
        name = elementName(c, 'Q');
        const m = model();
        if (m) line = `${name} ${n('c')} ${n('b')} ${n('e')} ${m}`;
        break;
      }
      case 'nmos': case 'pmos': case 'njfet': case 'pjfet': {
        name = elementName(c, c.type.endsWith('mos') ? 'M' : 'J');
        const m = model();
        if (m) line = `${name} ${n('d')} ${n('g')} ${n('s')} ${m}`;
        break;
      }
      case 'scr': name = elementName(c, 'X'); line = sub('NL_SCR', ['a', 'k', 'g']); break;
      case 'optocoupler': {
        const ctr = numv('ctr', 'CTR');
        if (ctr === null) break;
        name = elementName(c, 'X');
        line = sub('NL_OPTO', ['a', 'k', 'c', 'e'], { CTR: ctr });
        break;
      }
      case 'opamp': {
        name = elementName(c, 'E');
        const g = num('gain', 'Hệ số khuếch đại');
        if (g !== null) line = `${name} ${n('out')} 0 ${n('inp')} ${n('inn')} ${g}`;
        break;
      }
      case 'opamp_ic': {
        const op = OPAMP_PARAMS[c.params.model];
        if (!op) { errors.push(`${c.ref}: mã op-amp "${c.params.model}" không hỗ trợ`); break; }
        const rg = 100e6, gm = op.gain / rg, fp = op.gbw / op.gain;
        name = elementName(c, 'X');
        line = sub('NL_OPAMP', ['inp', 'inn', 'out', 'vcc', 'vee'], { GM: gm, RG: rg, CP: 1 / (2 * Math.PI * rg * fp), VHI: op.vhi, VLO: op.vlo, RO: op.ro, RQ: 5 / op.iq });
        break;
      }
      case 'comparator': name = elementName(c, 'X'); line = sub('NL_CMP', ['inp', 'inn', 'out', 'vcc', 'gnd']); break;
      case 'timer555': name = elementName(c, 'X'); line = sub('NL_555', ['gnd', 'trig', 'out', 'reset', 'ctrl', 'thr', 'dis', 'vcc']); break;
      case 'vreg': {
        const vr = VREG_PARAMS[c.params.model];
        if (!vr) { errors.push(`${c.ref}: mã ổn áp "${c.params.model}" không hỗ trợ`); break; }
        name = elementName(c, 'X');
        line = sub('NL_VREG', ['in', 'gnd', 'out'], { VOUT: vr.vout, DROP: vr.drop, IQ: vr.iq });
        break;
      }
      case 'lm317': name = elementName(c, 'X'); line = sub('NL_LM317', ['in', 'adj', 'out']); break;
      case 'logic_gate': case 'logic_not': {
        const vdd = numv('vdd', 'Nguồn logic');
        if (vdd === null) break;
        name = elementName(c, 'X');
        if (c.type === 'logic_not') line = sub('NL_NOT', ['a', 'y'], { VDD: vdd });
        else {
          if (!SUBCKTS[`NL_${c.params.gate}`]) { errors.push(`${c.ref}: loại cổng "${c.params.gate}" không hỗ trợ`); break; }
          line = sub(`NL_${c.params.gate}`, ['a', 'b', 'y'], { VDD: vdd });
        }
        break;
      }
      case 'ground': case 'netlabel': case 'power':
        break;
      default:
        // linh kiện chỉ hiển thị: không có phần tử SPICE, chỉ giữ các net khỏi thả nổi
        if (def.sim === 'display') for (const p of def.pins) { const nn = n(p.id); if (nn !== '0') leakNets.add(nn); }
        break;
    }
    if (line) {
      lines.push(line);
      elementMap[name] = c.ref;
      // đầu dò dòng cho linh kiện hiển thị sáng (LED, đèn)
      if (c.type === 'led') probes.push(`@${name.toLowerCase()}[id]`);
      if (c.type === 'lamp') probes.push(`@${name.toLowerCase()}[i]`);
    }
  }
  // chỉ giữ net có thêm phần tử điện thật (net chỉ gồm chân "hiển thị" thì không xuất hiện trong netlist)
  const byId = new Map(doc.components.map((c) => [c.id, c]));
  const realNet = (net: { keys: string[] } | undefined) => !!net?.keys.some((k) => {
    const cc = k.startsWith('c:') ? byId.get(k.split(':')[1]) : undefined;
    return cc && LIBRARY[cc.type].sim !== 'display' && !isSymbolOnly(cc.type);
  });
  for (const nn of [...leakNets]) if (!realNet(conn.nets.find((x) => x.name === nn))) leakNets.delete(nn);
  if (leakNets.size) {
    extra.push('', '* Chân của linh kiện chỉ hiển thị: rò 1 TΩ về 0 để không có nút thả nổi');
    [...leakNets].sort().forEach((nn, i) => extra.push(`RLEAK${i + 1} ${nn} 0 1e12`));
  }

  const analysis = opts.analysis ?? doc.sim.analysis;
  const out: string[] = [];
  out.push(`* ${doc.name.replace(/[\r\n]/g, ' ')} — sinh bởi Netlist (revision ${doc.revision})`);
  out.push(...lines);
  out.push(...extra);
  if (subckts.size) {
    out.push('');
    out.push('* Subcircuit hành vi (thư viện Netlist)');
    for (const m of [...subckts].sort()) out.push(SUBCKTS[m]);
  }
  if (models.size) {
    out.push('');
    out.push('* Mô hình (phiên bản cố định trong thư viện Netlist)');
    for (const m of [...models].sort()) out.push(SPICE_MODELS[m]);
  }
  out.push('');
  const step = toSpiceNumber(doc.sim.tranStep) ?? '1e-5';
  const stop = toSpiceNumber(doc.sim.tranStop) ?? '5e-3';
  const nets = conn.nets.filter((n) => n.name !== '0' && realNet(n)).map((n) => n.name);
  if (opts.control) {
    out.push('.control');
    out.push('set wr_singlescale');
    out.push('set wr_vecnames');
    out.push('op');
    out.push('echo NETLIST_OP_BEGIN');
    out.push('print all');
    if (probes.length) out.push(`print ${probes.join(' ')}`);
    out.push('echo NETLIST_OP_END');
    if (analysis === 'tran' && opts.control.tranFile) {
      out.push(`tran ${step} ${stop} uic`.replace(' uic', hasIC(doc) ? ' uic' : ''));
      const vecs = nets.map((n) => `v(${n})`).join(' ');
      if (vecs) out.push(`wrdata ${opts.control.tranFile} ${vecs}`);
    }
    out.push('quit');
    out.push('.endc');
  } else {
    out.push(analysis === 'tran' ? `.tran ${step} ${stop}` : '.op');
  }
  out.push('.end');
  return { text: out.join('\n') + '\n', errors, elementMap, nets, conn };
}

function hasIC(doc: CircuitDocument): boolean {
  return doc.components.some((c) => (c.type === 'capacitor' || c.type === 'capacitor_pol') && c.params.ic?.trim());
}
