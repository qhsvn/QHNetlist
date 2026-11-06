import { useMemo, useState } from 'react';
import { compileSpice } from '../core/spice';
import { formatSI } from '../core/units';
import { exportWaveform } from './actions';
import { setState, useStore } from './store';

const COLORS = ['#ff4fa3', '#36d6ff', '#ffc94a', '#7cff6b', '#b28cff', '#ff7a45', '#45ffd0', '#ff5d5d'];

function Waveform({ time, series }: { time: number[]; series: Record<string, number[]> }) {
  const names = Object.keys(series);
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const [hoverX, setHoverX] = useState<number | null>(null);
  const W = 900, H = 200, L = 52, R = 12, T = 10, B = 24;
  const visible = names.filter((n) => !hidden[n]);
  const t0 = time[0] ?? 0, t1 = time[time.length - 1] ?? 1;
  let vmin = Infinity, vmax = -Infinity;
  for (const n of visible) for (const v of series[n]) { if (v < vmin) vmin = v; if (v > vmax) vmax = v; }
  if (!Number.isFinite(vmin)) { vmin = 0; vmax = 1; }
  if (vmax - vmin < 1e-9) { vmax += 0.5; vmin -= 0.5; }
  const pad = (vmax - vmin) * 0.08; vmin -= pad; vmax += pad;
  const sx = (t: number) => L + ((t - t0) / (t1 - t0 || 1)) * (W - L - R);
  const sy = (v: number) => T + (1 - (v - vmin) / (vmax - vmin)) * (H - T - B);
  // decimate chỉ để hiển thị; dữ liệu gốc giữ nguyên để xuất CSV
  const stride = Math.max(1, Math.floor(time.length / 1500));
  const paths = useMemo(() => Object.fromEntries(names.map((n) => {
    let d = '';
    for (let i = 0; i < time.length; i += stride) d += `${i ? 'L' : 'M'}${sx(time[i]).toFixed(1)} ${sy(series[n][i]).toFixed(1)}`;
    return [n, d];
  })), [time, series, vmin, vmax, stride]); // eslint-disable-line
  const hi = hoverX !== null ? Math.min(time.length - 1, Math.max(0, time.findIndex((t) => sx(t) >= hoverX))) : -1;
  const ticks = 5;
  return (
    <div className="wave">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" onMouseMove={(e) => {
        const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
        setHoverX(((e.clientX - r.left) / r.width) * W);
      }} onMouseLeave={() => setHoverX(null)}>
        {Array.from({ length: ticks + 1 }, (_, i) => {
          const v = vmin + ((vmax - vmin) * i) / ticks;
          const t = t0 + ((t1 - t0) * i) / ticks;
          return (
            <g key={i}>
              <line x1={L} x2={W - R} y1={sy(v)} y2={sy(v)} className="grid" />
              <text x={L - 6} y={sy(v) + 3} textAnchor="end">{formatSI(v, 'V', 2)}</text>
              <text x={sx(t)} y={H - 6} textAnchor="middle">{formatSI(t, 's', 2)}</text>
            </g>
          );
        })}
        {visible.map((n) => <path key={n} d={paths[n]} stroke={COLORS[names.indexOf(n) % COLORS.length]} fill="none" strokeWidth={1.6} vectorEffect="non-scaling-stroke" />)}
        {hi >= 0 && <line x1={sx(time[hi])} x2={sx(time[hi])} y1={T} y2={H - B} className="cross" />}
      </svg>
      <div className="wave-legend">
        {names.map((n, i) => (
          <button key={n} className={hidden[n] ? 'off' : ''} onClick={() => setHidden({ ...hidden, [n]: !hidden[n] })}>
            <i style={{ background: COLORS[i % COLORS.length] }} />v({n}){hi >= 0 && !hidden[n] ? ` = ${formatSI(series[n][hi], 'V', 4)}` : ''}
          </button>
        ))}
        {hi >= 0 && <span className="muted">t = {formatSI(time[hi], 's', 4)}</span>}
        <button onClick={exportWaveform}>Xuất CSV</button>
      </div>
    </div>
  );
}

export function BottomPanel() {
  const tab = useStore((s) => s.bottomTab);
  const doc = useStore((s) => s.doc);
  const result = useStore((s) => s.result);
  const issues = useStore((s) => s.issues);
  const live = useStore((s) => s.live);
  const netlist = useMemo(() => compileSpice(doc), [doc]);
  const stale = result && result.revision !== doc.revision;
  const tabs: [typeof tab, string][] = [
    ['results', 'Kết quả'],
    ['netlist', 'Netlist SPICE'],
    ['erc', `Kiểm tra (${issues.filter((i) => i.severity !== 'info').length})`],
    ['log', 'Log bộ giải'],
    ['serial', live ? `Serial · ${live.mcu ?? '—'}` : 'Serial'],
  ];
  return (
    <section className="bottom">
      <div className="tabs">
        {tabs.map(([k, label]) => (
          <button key={k} className={tab === k ? 'active' : ''} onClick={() => setState({ bottomTab: k })}>{label}</button>
        ))}
      </div>
      <div className="tab-body">
        {tab === 'netlist' && <pre className="code-block">{netlist.text}{netlist.errors.length ? `\n* LỖI:\n${netlist.errors.map((e) => '* ' + e).join('\n')}` : ''}</pre>}
        {tab === 'erc' && (
          <ul className="issues">
            {issues.length === 0 && <li className="ok">Không phát hiện vấn đề. (ERC không thay thế phân tích điện và không khẳng định an toàn thực tế.)</li>}
            {issues.map((i, k) => <li key={k} className={i.severity}><b>{i.severity === 'error' ? 'Lỗi' : i.severity === 'warning' ? 'Cảnh báo' : 'Thông tin'}</b> {i.message}</li>)}
          </ul>
        )}
        {tab === 'serial' && (
          <pre className="code-block serial">{live ? (live.serial || `(${live.mcu ?? 'vi điều khiển'} chưa gửi gì qua Serial — dùng Serial.begin(9600); Serial.println(...))`) : 'Bấm ⚡ Chạy thật để chạy vi điều khiển; dữ liệu Serial.print sẽ hiện ở đây.'}</pre>
        )}
        {tab === 'log' && <pre className="code-block">{result?.log ?? 'Chưa chạy mô phỏng.'}</pre>}
        {tab === 'results' && (
          !result ? <div className="muted pad">Bấm ▶ Chạy (F5) để mô phỏng. Kết quả gắn với revision của mạch và sẽ báo "cũ" khi bạn sửa mạch.</div> :
          !result.ok ? <div className="issues"><li className="error"><b>Lỗi</b> {result.error}</li></div> :
          <div className={`results${stale ? ' is-stale' : ''}`}>
            <div className="results-meta">
              {result.source === 'ngspice' ? 'ngspice' : 'Bộ giải tích hợp'} · {result.analysis === 'op' ? 'DC .op' : 'transient'} · revision {result.revision} · {result.elapsedMs.toFixed(0)} ms
              {stale && <b className="warn"> · CŨ: mạch đã thay đổi</b>}
            </div>
            {result.tran ? <Waveform time={result.tran.time} series={result.tran.series} /> : (
              <div className="op-tables">
                <table><thead><tr><th>Nút</th><th>Điện áp</th></tr></thead><tbody>
                  {Object.entries(result.op?.nodes ?? {}).map(([k, v]) => <tr key={k}><td>{k}</td><td>{formatSI(v, 'V', 5)}</td></tr>)}
                </tbody></table>
                <table><thead><tr><th>Phần tử</th><th>Dòng (quy ước SPICE)</th></tr></thead><tbody>
                  {Object.entries(result.op?.currents ?? {}).filter(([k]) => !k.includes(':')).map(([k, v]) => <tr key={k}><td>{k}</td><td>{formatSI(v, 'A', 5)}</td></tr>)}
                </tbody></table>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
