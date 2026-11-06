import { useEffect } from 'react';
import { removeComponent, removeJunction, removeWire, rotateComponent } from '../core/commands';
import { FIXTURES } from '../core/fixtures';
import type { Rotation } from '../core/types';
import { exportBom, exportGlb, exportImage, exportSpice, openProject, saveProject, simulate, startLive, stopLive } from './actions';
import { AIConsole } from './AIConsole';
import { BottomPanel } from './BottomPanel';
import { Canvas } from './Canvas';
import { Inspector } from './Inspector';
import { Library } from './Library';
import { SettingsModal } from './SettingsModal';
import { View3D } from './View3D';
import { DeviceView } from './DeviceView';
import { commit, getState, loadDocument, newDocument, redo, setState, undo, useStore } from './store';
import { isDesktop } from './bridge';

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const s = getState();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveProject(); return; }
      if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); openProject(); return; }
      if (e.key === 'F5') { e.preventDefault(); simulate(); return; }
      if (e.key === 'F6') { e.preventDefault(); if (getState().live) stopLive(); else startLive(); return; }
      if (s.build || mod) return;
      switch (e.key) {
        case 'Escape': setState({ tool: { kind: 'select' }, selection: null }); break;
        case 'v': case 'V': setState({ tool: { kind: 'select' } }); break;
        case 'w': case 'W': setState({ tool: { kind: 'wire' } }); break;
        case 'f': case 'F': window.dispatchEvent(new Event('netlist:fit')); window.dispatchEvent(new Event('netlist:fit3d')); break;
        case '3': setState({ view: s.view === '3d' ? '2d' : s.view === '2d' ? 'split' : '3d' }); break;
        case '4': setState({ view: s.view === 'device' ? '2d' : 'device' }); break;
        case 'r': case 'R':
          if (s.tool.kind === 'place') setState({ tool: { ...s.tool, rot: (((s.tool.rot + 90) % 360) as Rotation) } });
          else if (s.selection?.kind === 'comp') commit(rotateComponent(s.doc, s.selection.id));
          break;
        case 'Delete': case 'Backspace':
          if (!s.selection) break;
          if (s.selection.kind === 'comp') commit(removeComponent(s.doc, s.selection.id));
          if (s.selection.kind === 'wire') commit(removeWire(s.doc, s.selection.id));
          if (s.selection.kind === 'junction') commit(removeJunction(s.doc, s.selection.id));
          setState({ selection: null });
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function TopBar() {
  const tool = useStore((s) => s.tool);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const simRunning = useStore((s) => s.simRunning);
  const dirty = useStore((s) => s.doc.revision !== s.savedRevision);
  const name = useStore((s) => s.doc.name);
  const analysis = useStore((s) => s.doc.sim.analysis);
  const build = useStore((s) => s.build);
  const view = useStore((s) => s.view);
  const live = useStore((s) => s.live);
  return (
    <div className="topbar">
      <div className="group">
        <button onClick={newDocument} title="Mạch mới">Mới</button>
        <button onClick={openProject} title="Ctrl+O">Mở</button>
        <button onClick={saveProject} title="Ctrl+S">Lưu{dirty ? ' •' : ''}</button>
        <select value="" onChange={(e) => { const f = FIXTURES[e.target.value]; if (f) loadDocument(f.make()); }} title="Mạch mẫu">
          <option value="">Mạch mẫu…</option>
          {Object.entries(FIXTURES).map(([k, f]) => <option key={k} value={k}>{f.title}</option>)}
        </select>
      </div>
      <div className="group">
        <button onClick={undo} disabled={!canUndo || !!build} title="Ctrl+Z">↶</button>
        <button onClick={redo} disabled={!canRedo || !!build} title="Ctrl+Y">↷</button>
      </div>
      <div className="group tools">
        <button className={tool.kind === 'select' ? 'active' : ''} onClick={() => setState({ tool: { kind: 'select' } })} title="Chọn / di chuyển (V)">⬚ Chọn</button>
        <button className={tool.kind === 'wire' ? 'active' : ''} onClick={() => setState({ tool: { kind: 'wire' } })} title="Nối dây (W)">╱ Dây</button>
      </div>
      <div className="group seg">
        {(['2d', 'split', '3d', 'device'] as const).map((v) => (
          <button key={v} className={view === v ? 'active' : ''} onClick={() => setState({ view: v })} title={v === 'device' ? 'Thiết bị 3D chạy theo mạch (xe, quạt, robot...) — phím 4' : 'Phím 3 để chuyển'}>{v === '2d' ? '2D' : v === '3d' ? '3D' : v === 'device' ? '🛵 Thiết bị' : '2D | 3D'}</button>
        ))}
      </div>
      <div className="group">
        <select value={analysis} onChange={(e) => commit({ ...getState().doc, sim: { ...getState().doc.sim, analysis: e.target.value as 'op' | 'tran' } })}>
          <option value="op">DC .op</option>
          <option value="tran">Transient</option>
        </select>
        <button className="btn-run" onClick={() => simulate()} disabled={simRunning || !!build || !!live} title="F5">{simRunning ? '… Đang chạy' : '▶ Chạy'}</button>
        <button className={`btn-live${live ? ' on' : ''}`} onClick={() => (live ? stopLive() : startLive())} disabled={!!build} title="Chạy thời gian thực: vi điều khiển chạy chương trình, LED/màn hình/nút nhấn hoạt động như thật (F6)">
          {live ? `■ Dừng · ${fmtTime(live.simTime)}${live.mcu ? ` · ${Math.round(live.speed * 100)}%` : ''}` : '⚡ Chạy thật'}
        </button>
      </div>
      <div className="group">
        <select value="" onChange={(e) => {
          const v = e.target.value;
          if (v === 'cir') exportSpice(); if (v === 'bom') exportBom(); if (v === 'svg') exportImage('svg'); if (v === 'png') exportImage('png'); if (v === 'glb') exportGlb();
        }}>
          <option value="">Xuất…</option>
          <option value="cir">Netlist SPICE (.cir)</option>
          <option value="bom">BOM (.csv)</option>
          <option value="png">Ảnh PNG</option>
          <option value="svg">Ảnh SVG</option>
          <option value="glb">Mô hình 3D (.glb)</option>
        </select>
      </div>
      <div className="spacer" />
      <div className="doc-name">{name}{dirty ? ' — chưa lưu' : ''}{isDesktop ? '' : ' · web'}</div>
    </div>
  );
}

function BuildBar() {
  const build = useStore((s) => s.build);
  const count = useStore((s) => s.doc.components.length);
  const total = build ? build.steps.length : 0;
  const idx = build ? build.index : 0;
  const cells = 48;
  const filled = build ? Math.round((idx / total) * cells) : cells;
  return (
    <div className="buildbar">
      <span className="fig">Fig 1 · sơ đồ nguyên lý</span>
      <span className="cells">{Array.from({ length: cells }, (_, i) => <i key={i} className={i < filled ? (build ? 'on' : 'done') : ''} />)}</span>
      <span className="state">{build ? `ASSEMBLING · thao tác ${idx} / ${total}` : `READY · ${count} linh kiện`}</span>
    </div>
  );
}

export function App() {
  useShortcuts();
  const toastMsg = useStore((s) => s.toast);
  const view = useStore((s) => s.view);
  return (
    <div className="app">
      <AIConsole />
      <main className="main">
        <TopBar />
        <BuildBar />
        <div className={`work view-${view}`}>
          <Library />
          <div className="stage">
            {view !== '3d' && <Canvas />}
            {view !== '2d' && view !== 'device' && <View3D />}
            {view === 'device' && <DeviceView />}
          </div>
        </div>
        <BottomPanel />
      </main>
      <Inspector />
      <SettingsModal />
      {toastMsg && <div className="toast">{toastMsg}</div>}
    </div>
  );
}

function fmtTime(t: number): string {
  const m = Math.floor(t / 60), s = t - m * 60;
  return m ? `${m}:${s.toFixed(0).padStart(2, '0')}` : `${s.toFixed(1)} s`;
}
