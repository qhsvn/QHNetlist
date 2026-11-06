import { useEffect, useState } from 'react';
import { PROVIDERS, type ProviderId } from '../ai/providers';
import { browseNgspice, fetchModels, hasKey, isDesktop, ngspiceStatus, setKey, setNgspicePath, type NgspiceStatus } from './bridge';
import { getState, setState, toast, useStore } from './store';

export function SettingsModal() {
  const open = useStore((s) => s.settingsOpen);
  const ai = useStore((s) => s.ai);
  const [keyInput, setKeyInput] = useState('');
  const [keySet, setKeySet] = useState<Record<string, boolean>>({});
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [ng, setNg] = useState<NgspiceStatus | null>(null);
  const [ngPath, setNgPath] = useState('');
  const p = PROVIDERS[ai.provider];

  useEffect(() => {
    if (!open) return;
    Promise.all((Object.keys(PROVIDERS) as ProviderId[]).map(async (id) => [id, await hasKey(id)] as const)).then((r) => setKeySet(Object.fromEntries(r)));
    ngspiceStatus().then((s) => { setNg(s); setNgPath(s.configured ?? ''); });
  }, [open]);
  useEffect(() => { setModels([]); setKeyInput(''); }, [ai.provider]);
  if (!open) return null;

  const update = (patch: Partial<typeof ai>) => setState({ ai: { ...getState().ai, ...patch } });

  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && setState({ settingsOpen: false })}>
      <div className="modal" onKeyDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <b>Cài đặt</b>
          <button onClick={() => setState({ settingsOpen: false })}>✕</button>
        </div>
        <h3>AI</h3>
        <div className="provider-tabs">
          {(Object.keys(PROVIDERS) as ProviderId[]).map((id) => (
            <button key={id} className={ai.provider === id ? 'active' : ''} onClick={() => update({ provider: id })}>
              {PROVIDERS[id].name.split(' (')[0]}{keySet[id] ? ' ✓' : ''}
            </button>
          ))}
        </div>
        <p className="muted">{p.keyHelp}</p>
        <label className="field">
          <span>API key {keySet[ai.provider] ? '(đã lưu — nhập để thay)' : p.needsKey ? '(bắt buộc)' : '(không bắt buộc)'}</span>
          <div className="row">
            <input type="password" value={keyInput} placeholder={keySet[ai.provider] ? '••••••••' : 'dán key vào đây'} onChange={(e) => setKeyInput(e.target.value)} />
            <button onClick={async () => { await setKey(ai.provider, keyInput); setKeySet({ ...keySet, [ai.provider]: !!keyInput.trim() }); setKeyInput(''); toast(keyInput.trim() ? 'Đã lưu key' : 'Đã xoá key'); }}>{keyInput.trim() ? 'Lưu' : 'Xoá'}</button>
          </div>
          <small>{isDesktop ? 'Key được mã hoá bằng kho bảo mật của hệ điều hành (Electron safeStorage) và chỉ dùng trong main process.' : 'Chế độ web: key lưu trong localStorage của trình duyệt này. Dùng bản desktop để mã hoá key.'}</small>
        </label>
        <label className="field">
          <span>Model</span>
          <div className="row">
            <input list="model-list" value={ai.models[ai.provider]} onChange={(e) => update({ models: { ...ai.models, [ai.provider]: e.target.value } })} />
            <datalist id="model-list">{[...new Set([...p.suggestedModels, ...models])].map((m) => <option key={m} value={m} />)}</datalist>
            <button disabled={loading} onClick={async () => {
              setLoading(true);
              try { const m = await fetchModels(ai.provider, ai.baseUrls[ai.provider]); setModels(m); toast(`Tìm thấy ${m.length} model`); }
              catch (e) { toast(`Không tải được danh sách: ${e instanceof Error ? e.message : e}`); }
              finally { setLoading(false); }
            }}>{loading ? '…' : 'Tải danh sách'}</button>
          </div>
          {models.length > 0 && (
            <div className="chips">{models.slice(0, 40).map((m) => <button key={m} className={m === ai.models[ai.provider] ? 'active' : ''} onClick={() => update({ models: { ...ai.models, [ai.provider]: m } })}>{m}</button>)}</div>
          )}
        </label>
        {p.defaultBaseUrl !== undefined && (
          <label className="field">
            <span>Base URL</span>
            <input value={ai.baseUrls[ai.provider] ?? ''} placeholder={p.defaultBaseUrl} onChange={(e) => update({ baseUrls: { ...ai.baseUrls, [ai.provider]: e.target.value } })} />
          </label>
        )}
        {ai.provider === 'anthropic' && (
          <label className="field">
            <span>Mức nỗ lực suy nghĩ (effort)</span>
            <select value={ai.effort} onChange={(e) => update({ effort: e.target.value as typeof ai.effort })}>
              {['low', 'medium', 'high', 'xhigh', 'max'].map((x) => <option key={x}>{x}</option>)}
            </select>
            <small>Cao hơn = thiết kế kỹ hơn nhưng chậm và tốn token hơn. Adaptive thinking bật sẵn cho Claude thế hệ 5.</small>
          </label>
        )}

        <h3>Bộ giải ngspice</h3>
        {isDesktop ? (
          <>
            <p className="muted">{ng?.available ? `Đang dùng: ${ng.path} (${ng.version ?? 'ngspice'})` : 'Chưa tìm thấy ngspice. Tải bản Windows tại ngspice.sourceforge.io (gói ngspice-xx_64.7z), giải nén vào C:\\Spice64 hoặc chọn đường dẫn ngspice_con.exe bên dưới. Khi chưa có, Netlist dùng bộ giải tích hợp.'}</p>
            <div className="row">
              <input value={ngPath} placeholder="C:\\Spice64\\bin\\ngspice_con.exe" onChange={(e) => setNgPath(e.target.value)} />
              <button onClick={async () => { const f = await browseNgspice(); if (f) setNgPath(f); }}>Chọn…</button>
              <button onClick={async () => { const s = await setNgspicePath(ngPath); setNg(s); toast(s.available ? 'Đã kết nối ngspice' : 'Không chạy được ngspice ở đường dẫn này'); }}>Kiểm tra</button>
            </div>
          </>
        ) : (
          <p className="muted">Chế độ web không chạy được tiến trình ngspice. Dùng bản desktop (npm run dev) để mô phỏng bằng ngspice.</p>
        )}
      </div>
    </div>
  );
}
