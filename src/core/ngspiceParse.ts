// Phân tích output của ngspice batch (không phụ thuộc Node/Electron).

export function parseNgspiceOp(stdout: string, elementMap: Record<string, string> = {}) {
  const nodes: Record<string, number> = {};
  const currents: Record<string, number> = {};
  const start = stdout.indexOf('NETLIST_OP_BEGIN');
  const end = stdout.indexOf('NETLIST_OP_END');
  const section = start >= 0 ? stdout.slice(start, end > start ? end : undefined) : stdout;
  const upperMap = Object.fromEntries(Object.entries(elementMap).map(([k, v]) => [k.toLowerCase(), v]));
  for (const line of section.split(/\r?\n/)) {
    const m = line.match(/^\s*([^\s=]+)\s*=\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s*$/);
    if (!m) continue;
    const name = m[1].toLowerCase();
    const val = parseFloat(m[2]);
    const probe = name.match(/^@(\w+)\[(?:id|i)\]$/);
    if (probe) { currents[upperMap[probe[1]] ?? probe[1].toUpperCase()] = val; continue; }
    const br = name.match(/^(.+)#branch$/);
    // bỏ nút/nhánh nội bộ của subcircuit (x1.n1) và nút trong do Netlist sinh (int_*)
    if (name.includes('.') || /^(v\()?int_/.test(name)) continue;
    if (br) currents[upperMap[br[1]] ?? br[1].toUpperCase()] = val;
    else if (/^v\((.+)\)$/.test(name)) nodes[name.slice(2, -1)] = val;
    else if (!name.startsWith('@')) nodes[name] = val;
  }
  return { nodes, currents };
}

/** Đọc file wrdata với wr_singlescale + wr_vecnames */
export function parseWrdata(text: string) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const header = lines[0].trim().split(/\s+/);
  const names = header.slice(1).map((h) => h.replace(/^v\((.*)\)$/i, '$1').toLowerCase());
  const time: number[] = [];
  const series: Record<string, number[]> = Object.fromEntries(names.map((n) => [n, [] as number[]]));
  for (const l of lines.slice(1)) {
    const cols = l.trim().split(/\s+/).map(Number);
    if (cols.some((c) => Number.isNaN(c))) continue;
    time.push(cols[0]);
    names.forEach((n, i) => series[n].push(cols[i + 1]));
  }
  return { time, series };
}
