// Kiểm tra trước khi chạy (ERC tối thiểu). Không thay thế phân tích điện, không khẳng định an toàn thực tế.
import { computeConnectivity } from './connectivity';
import { LIBRARY, isSymbolOnly } from './library';
import { compileSpice } from './spice';
import { VREG_PARAMS } from './spiceLib';
import type { CircuitDocument, Issue, SimResult } from './types';
import { formatSI, parseValue } from './units';

/** Chân được phép để hở mà không cảnh báo */
const OPTIONAL_PINS: Partial<Record<string, string[]>> = { timer555: ['ctrl'], relay: ['no', 'nc'], potentiometer: ['w'] };

export function runChecks(doc: CircuitDocument, result?: SimResult | null): Issue[] {
  const issues: Issue[] = [];
  if (doc.components.filter((c) => !isSymbolOnly(c.type)).length === 0) {
    issues.push({ severity: 'info', message: 'Mạch đang trống. Kéo linh kiện từ thư viện hoặc nhờ AI tạo mạch.' });
    return issues;
  }
  const conn = computeConnectivity(doc);
  const compiled = compileSpice(doc);
  for (const e of compiled.errors) issues.push({ severity: 'error', message: e, ref: e.split(':')[0] });

  const refs = new Map<string, number>();
  for (const c of doc.components) if (!isSymbolOnly(c.type)) refs.set(c.ref, (refs.get(c.ref) ?? 0) + 1);
  for (const [r, n] of refs) if (n > 1) issues.push({ severity: 'error', message: `Trùng tên tham chiếu ${r} (${n} lần)`, ref: r });

  if (!conn.nets.some((n) => n.isGround)) {
    issues.push({ severity: 'error', message: 'Thiếu ground (node 0). SPICE cần một nút tham chiếu.' });
  }

  // Chân hở: net chỉ có 1 endpoint linh kiện và không có dây
  const wiredKeys = new Set<string>();
  for (const w of doc.wires) {
    wiredKeys.add(w.a.kind === 'pin' ? `c:${w.a.comp}:${w.a.pin}` : `j:${w.a.id}`);
    wiredKeys.add(w.b.kind === 'pin' ? `c:${w.b.comp}:${w.b.pin}` : `j:${w.b.id}`);
  }
  for (const net of conn.nets) {
    const compPins = net.keys.filter((k) => k.startsWith('c:'));
    const realPins = net.endpoints.length;
    const only = net.keys.find((k) => k.startsWith('c:'));
    const oc = only ? doc.components.find((c) => c.id === only.split(':')[1]) : undefined;
    const skip = realPins === 1 && oc && (LIBRARY[oc.type].sim === 'display' || OPTIONAL_PINS[oc.type]?.includes(only!.split(':')[2]));
    if (realPins === 1 && !net.isGround && skip) continue;
    if (realPins === 1 && !net.isGround) {
      issues.push({ severity: 'warning', message: `Chân ${net.endpoints[0]} để hở (net ${net.name} chỉ có một đầu nối)`, net: net.name, ref: net.endpoints[0].split('.')[0] });
    } else if (realPins === 0 && compPins.length > 0 && !net.isGround) {
      issues.push({ severity: 'info', message: `Nhãn/ground không nối với linh kiện nào (net ${net.name})`, net: net.name });
    }
  }

  // Nguồn áp nối tắt hai cực
  for (const c of doc.components) {
    if (c.type === 'vsource' || c.type === 'battery' || c.type === 'clock') {
      const p = conn.netOf.get(`c:${c.id}:p`), n = conn.netOf.get(`c:${c.id}:n`);
      if (p && p === n) issues.push({ severity: 'error', message: `${c.ref}: hai cực nguồn áp bị nối tắt`, ref: c.ref });
    }
    if (!LIBRARY[c.type].builtin && LIBRARY[c.type].sim !== 'display') {
      issues.push({ severity: 'info', message: `${c.ref}: chỉ mô phỏng được bằng ngspice (bộ giải tích hợp chưa hỗ trợ ${LIBRARY[c.type].name})`, ref: c.ref });
    }
  }
  const display = doc.components.filter((c) => LIBRARY[c.type].sim === 'display');
  if (display.length) {
    issues.push({ severity: 'info', message: `${display.map((c) => c.ref).join(', ')}: chỉ hiển thị (vi điều khiển, mô-đun, đầu nối), bỏ qua khi mô phỏng điện` });
  }
  if (result && result.ok && result.op && result.revision === doc.revision) issues.push(...resultChecks(doc, conn, result));
  const caps = doc.components.filter((c) => c.type === 'capacitor' || c.type === 'capacitor_pol');
  if (doc.sim.analysis === 'tran' && caps.length && !doc.components.some((c) => c.type === 'clock' || ((c.type === 'vsource' || c.type === 'isource') && /pulse|sin/i.test(c.params.value ?? '')))) {
    issues.push({ severity: 'info', message: 'Transient với nguồn DC đã ổn định sẽ không thấy tụ nạp. Dùng PULSE(...) hoặc đặt IC cho tụ.' });
  }
  return issues;
}

/** Kiểm tra dựa trên kết quả điểm làm việc (cảnh báo thực tế, không thay thế datasheet). */
function resultChecks(doc: CircuitDocument, conn: ReturnType<typeof computeConnectivity>, result: SimResult): Issue[] {
  const out: Issue[] = [];
  const nodes = result.op!.nodes;
  const V = (id: string, pin: string): number | undefined => {
    const n = conn.netOf.get(`c:${id}:${pin}`);
    if (!n) return undefined;
    return n === '0' ? 0 : nodes[n] ?? nodes[n.toLowerCase()];
  };
  for (const c of doc.components) {
    switch (c.type) {
      case 'capacitor_pol': {
        const p = V(c.id, 'p'), n = V(c.id, 'n');
        if (p === undefined || n === undefined) break;
        const rated = parseValue(c.params.voltage ?? '');
        if (p - n < -0.3) out.push({ severity: 'warning', message: `${c.ref}: tụ hoá bị phân cực ngược (${formatSI(p - n, 'V')}). Đảo chân + / −.`, ref: c.ref });
        else if (rated && p - n > rated) out.push({ severity: 'warning', message: `${c.ref}: điện áp ${formatSI(p - n, 'V')} vượt định mức ${formatSI(rated, 'V')}.`, ref: c.ref });
        break;
      }
      case 'fuse': {
        const a = V(c.id, '1'), b = V(c.id, '2'), rating = parseValue(c.params.rating ?? '');
        if (a === undefined || b === undefined || !rating) break;
        const i = Math.abs(a - b) / 0.01;
        if (i > rating) out.push({ severity: 'warning', message: `${c.ref}: dòng ${formatSI(i, 'A')} vượt định mức cầu chì ${formatSI(rating, 'A')} (sẽ đứt).`, ref: c.ref });
        break;
      }
      case 'led': {
        const i = result.op!.currents[c.ref];
        if (i !== undefined && i > 0.03) out.push({ severity: 'warning', message: `${c.ref}: LED ${formatSI(i, 'A')} quá dòng (nên ≤ 20 mA). Tăng điện trở hạn dòng.`, ref: c.ref });
        break;
      }
      case 'vreg': {
        const vin = V(c.id, 'in'), g = V(c.id, 'gnd'), p = VREG_PARAMS[c.params.model];
        if (vin === undefined || g === undefined || !p) break;
        if (vin - g < p.vout + p.drop) out.push({ severity: 'warning', message: `${c.ref}: điện áp vào ${formatSI(vin - g, 'V')} thấp hơn ${formatSI(p.vout + p.drop, 'V')} (Vout + dropout), ổn áp không giữ được ${p.vout} V.`, ref: c.ref });
        break;
      }
      case 'esp32': {
        for (const pin of LIBRARY.esp32.pins) {
          if (['vin', 'gnd', 'gnd2', '3v3'].includes(pin.id)) continue;
          const v = V(c.id, pin.id);
          if (v !== undefined && v > 3.6) out.push({ severity: 'warning', message: `${c.ref}.${pin.name}: ${formatSI(v, 'V')} vượt 3,6 V — có thể hỏng GPIO của ESP32. Dùng chia áp hoặc chuyển mức.`, ref: c.ref });
        }
        break;
      }
    }
  }
  return out;
}
