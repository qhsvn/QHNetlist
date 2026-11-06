import { useEffect, useRef, useState } from 'react';
import { removeComponent, removeJunction, removeWire, rotateComponent, updateComponent } from '../core/commands';
import { LIBRARY, modelLabel } from '../core/library';
import { formatSI, parseValue } from '../core/units';
import { PROVIDERS } from '../ai/providers';
import { canCompileArduino, compileArduino, isDesktop, ngspiceStatus, type NgspiceStatus } from './bridge';
import { commit, getState, log, setState, toast, useStore } from './store';
import { loadFirmware } from './actions';
import { SAMPLE_FIRMWARE } from '../sim/firmware';

function ParamField({ label, value, onCommit, help, unit, invalid }: { label: string; value: string; onCommit: (v: string) => void; help?: string; unit?: string; invalid?: boolean }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <label className="field">
      <span>{label}{unit ? ` (${unit})` : ''}</span>
      <input
        value={v}
        className={invalid ? 'invalid' : ''}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => v !== value && onCommit(v)}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      />
      {help && <small>{help}</small>}
    </label>
  );
}

export function Inspector() {
  const doc = useStore((s) => s.doc);
  const selection = useStore((s) => s.selection);
  const ai = useStore((s) => s.ai);
  const tokens = useStore((s) => s.tokens);
  const result = useStore((s) => s.result);
  const issues = useStore((s) => s.issues);
  const build = useStore((s) => s.build);
  const [ng, setNg] = useState<NgspiceStatus | null>(null);
  useEffect(() => { ngspiceStatus().then(setNg); }, []);

  const comp = selection?.kind === 'comp' ? doc.components.find((c) => c.id === selection.id) : undefined;
  const def = comp ? LIBRARY[comp.type] : undefined;
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;

  const setParam = (key: string, value: string) => comp && commit(updateComponent(getState().doc, comp.id, { params: { [key]: value } }));

  return (
    <aside className="inspector">
      <div className="card">
        <div className="card-title">■ {PROVIDERS[ai.provider].name.split(' ')[0].toUpperCase()} · {ai.models[ai.provider] || '—'}</div>
        <div className="kv"><span>lượt</span><b>{tokens.requests}</b></div>
        <div className="kv"><span>token vào / ra</span><b>{tokens.input.toLocaleString('vi-VN')} / {tokens.output.toLocaleString('vi-VN')}</b></div>
        <div className="kv"><span>độ trễ</span><b>{(tokens.lastLatencyMs / 1000).toFixed(2)} s</b></div>
        <div className="bars">
          {[tokens.input, tokens.output, tokens.live].map((v, i) => (
            <i key={i} style={{ height: `${Math.min(100, 6 + Math.log10(1 + v) * 20)}%` }} />
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-title">■ MÔ PHỎNG</div>
        <div className="kv"><span>bộ giải</span><b>{ng?.available ? 'ngspice' : 'tích hợp (MNA)'}</b></div>
        {ng?.available ? <div className="kv small"><span>{ng.version}</span></div> : <div className="kv small"><span>{isDesktop ? 'Chưa thấy ngspice — cấu hình trong ⚙' : 'Chế độ web: chỉ bộ giải tích hợp'}</span></div>}
        <div className="kv"><span>lần chạy</span><b>{result ? `${result.analysis} · ${result.ok ? 'OK' : 'lỗi'} · ${result.elapsedMs.toFixed(0)} ms` : '—'}</b></div>
        <div className="kv"><span>trạng thái</span><b className={result && result.revision !== doc.revision ? 'warn' : ''}>{result ? (result.revision === doc.revision ? 'mới' : 'cũ (stale)') : 'chưa chạy'}</b></div>
        <div className="kv"><span>ERC</span><b className={errors ? 'err' : warnings ? 'warn' : 'ok'}>{errors} lỗi · {warnings} cảnh báo</b></div>
      </div>

      <div className="card grow">
        <div className="card-title">■ THUỘC TÍNH</div>
        {build ? (
          <p className="muted">Đang dựng mạch theo patch của AI…</p>
        ) : comp && def ? (
          <>
            <div className="comp-head">
              <b>{def.name}</b>
              <span className={`sim-badge sim-${def.sim}`}>{def.sim === 'verified' ? 'đã kiểm chứng' : def.sim === 'model' ? 'có mô hình' : 'chỉ hiển thị'}</span>
            </div>
            {comp.type !== 'ground' && (
              <ParamField label="Tham chiếu" value={comp.ref} onCommit={(v) => {
                const ref = v.trim();
                if (!/^[A-Za-z_]\w*$/.test(ref) || doc.components.some((c) => c.ref === ref && c.id !== comp.id)) return;
                commit(updateComponent(getState().doc, comp.id, { ref }));
              }} />
            )}
            {def.params.filter((p) => !p.hidden).map((p) =>
              p.kind === 'firmware' ? (
                <FirmwareField key={p.key} compId={comp.id} type={comp.type} hex={comp.params.firmware ?? ''} name={comp.params.firmwareName ?? ''} />
              ) : p.kind === 'select' ? (
                <label key={p.key} className="field">
                  <span>{p.label}</span>
                  <select value={comp.params[p.key]} onChange={(e) => setParam(p.key, e.target.value)}>
                    {p.options!.map((o) => <option key={o} value={o}>{p.key === 'model' && modelLabel(o) !== o ? `${modelLabel(o)} (${o})` : o}</option>)}
                  </select>
                </label>
              ) : p.kind === 'bool' ? (
                <label key={p.key} className="field row">
                  <input type="checkbox" checked={comp.params[p.key] === '1'} onChange={(e) => setParam(p.key, e.target.checked ? '1' : '0')} />
                  <span>{p.label}</span>
                </label>
              ) : (
                <ParamField
                  key={p.key}
                  label={p.label}
                  unit={p.unit}
                  help={p.help ?? (p.kind === 'value' && parseValue(comp.params[p.key]) !== null ? `= ${formatSI(parseValue(comp.params[p.key])!, p.unit ?? '')}` : undefined)}
                  value={comp.params[p.key] ?? ''}
                  invalid={p.kind === 'value' && !!comp.params[p.key]?.trim() && parseValue(comp.params[p.key]) === null}
                  onCommit={(v) => setParam(p.key, v)}
                />
              ),
            )}
            <p className="muted">{def.description}</p>
            {result?.op && result.revision === doc.revision && result.op.currents[comp.ref] !== undefined && (
              <div className="kv"><span>dòng</span><b>{formatSI(result.op.currents[comp.ref], 'A', 4)}</b></div>
            )}
            <div className="btn-row">
              <button onClick={() => commit(rotateComponent(getState().doc, comp.id))}>⟳ Xoay (R)</button>
              <button className="danger" onClick={() => { commit(removeComponent(getState().doc, comp.id)); setState({ selection: null }); }}>Xoá</button>
            </div>
          </>
        ) : selection?.kind === 'wire' ? (
          <div className="btn-row"><span className="muted">Dây đã chọn</span><button className="danger" onClick={() => { commit(removeWire(getState().doc, selection.id)); setState({ selection: null }); }}>Xoá dây</button></div>
        ) : selection?.kind === 'junction' ? (
          <div className="btn-row"><span className="muted">Junction</span><button className="danger" onClick={() => { commit(removeJunction(getState().doc, selection.id)); setState({ selection: null }); }}>Xoá</button></div>
        ) : (
          <>
            <ParamField label="Tên mạch" value={doc.name} onCommit={(v) => commit({ ...getState().doc, name: v || 'Mạch' })} />
            <label className="field">
              <span>Phân tích</span>
              <select value={doc.sim.analysis} onChange={(e) => commit({ ...getState().doc, sim: { ...getState().doc.sim, analysis: e.target.value as 'op' | 'tran' } })}>
                <option value="op">DC — điểm làm việc (.op)</option>
                <option value="tran">Transient (.tran)</option>
              </select>
            </label>
            {doc.sim.analysis === 'tran' && (
              <div className="two">
                <ParamField label="Bước" unit="s" value={doc.sim.tranStep} onCommit={(v) => commit({ ...getState().doc, sim: { ...getState().doc.sim, tranStep: v } })} invalid={parseValue(doc.sim.tranStep) === null} />
                <ParamField label="Dừng" unit="s" value={doc.sim.tranStop} onCommit={(v) => commit({ ...getState().doc, sim: { ...getState().doc.sim, tranStop: v } })} invalid={parseValue(doc.sim.tranStop) === null} />
              </div>
            )}
            <p className="muted">Chọn linh kiện để sửa. Phím: V chọn · W nối dây · R xoay · Del xoá · F vừa khung · Ctrl+Z/Y · Ctrl+S lưu · F5 chạy.</p>
          </>
        )}
      </div>
    </aside>
  );
}

function FirmwareField({ compId, type, hex, name }: { compId: string; type: string; hex: string; name: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const bytes = hex ? Math.round(hex.split(/\r?\n/).filter((l) => l.startsWith(':')).reduce((a, l) => a + (parseInt(l.slice(1, 3), 16) || 0), 0)) : 0;
  const compile = async () => {
    setBusy(true);
    try {
      const r = await compileArduino(type === 'atmega328p' ? 'arduino:avr:uno' : 'arduino:avr:nano');
      if (!r) return;
      if (r.ok && r.hex) loadFirmware(compId, r.name ?? 'sketch.ino', r.hex);
      else { log('err', r.log, 'MCU'); toast('Biên dịch lỗi — xem log'); }
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="field firmware">
      <span>Chương trình</span>
      <div className="fw-box">
        {hex ? <b>{name || 'chương trình.hex'} · {bytes} byte</b> : <i>chưa nạp — vi điều khiển chỉ hiển thị</i>}
      </div>
      <div className="btn-row">
        <button onClick={() => fileRef.current?.click()}>Nạp .hex</button>
        {canCompileArduino && <button onClick={compile} disabled={busy}>{busy ? 'Đang biên dịch…' : 'Biên dịch .ino'}</button>}
        <button onClick={() => loadFirmware(compId, SAMPLE_FIRMWARE.clock.name, SAMPLE_FIRMWARE.clock.hex)} title={SAMPLE_FIRMWARE.clock.description}>Mẫu đồng hồ</button>
        {hex && <button className="danger" onClick={() => commit(updateComponent(getState().doc, compId, { params: { firmware: '', firmwareName: '' } }))}>Gỡ</button>}
      </div>
      <input ref={fileRef} type="file" accept=".hex,.ihex" hidden onChange={async (e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (f) loadFirmware(compId, f.name, await f.text());
      }} />
      <small className="muted">Arduino IDE: Sketch → Export Compiled Binary → chọn file <code>.ino.hex</code> (không chọn bản with_bootloader). Sau đó bấm ⚡ Chạy thật.</small>
    </div>
  );
}
