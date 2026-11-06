// Trình vẽ schematic SVG: pan/zoom, kéo thả, nối dây, junction tường minh, hiển thị kết quả mô phỏng.
import { useEffect, useMemo, useRef, useState } from 'react';
import { addComponent, addWire, moveComponent, moveJunction, splitWire } from '../core/commands';
import { computeConnectivity } from '../core/connectivity';
import { buildObstacles, documentBounds, endpointKey, endpointPosition, makeComponent, pinPosition, snap, wireRoute } from '../core/document';
import { LIBRARY, compExtent, isLabelType, modelLabel, rotatePoint } from '../core/library';
import type { ComponentInstance, ComponentType, Endpoint } from '../core/types';
import { formatSI } from '../core/units';
import { commit, getState, preview, setState, useStore } from './store';
import { livePress } from './actions';
import { SymbolBody, ledColor } from './Symbols';

type Pt = { x: number; y: number };
type View = { x: number; y: number; k: number };

type Drag =
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number }
  | { kind: 'comp'; id: string; dx: number; dy: number; start: ReturnType<typeof getState>['doc']; moved: boolean }
  | { kind: 'junction'; id: string; start: ReturnType<typeof getState>['doc']; moved: boolean };

type Target =
  | { kind: 'pin'; ep: Endpoint; pos: Pt }
  | { kind: 'junction'; ep: Endpoint; pos: Pt }
  | { kind: 'wire'; wireId: string; pos: Pt };

function distToSeg(p: Pt, a: Pt, b: Pt) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len));
  const q = { x: a.x + t * dx, y: a.y + t * dy };
  return { d: Math.hypot(p.x - q.x, p.y - q.y), q };
}

function voltageColor(v: number, vmax: number) {
  const t = Math.max(0, Math.min(1, vmax > 0 ? v / vmax : 0));
  // xanh (0 V) → tím → hồng/đỏ (cao)
  const h = 220 - t * 220;
  return `hsl(${h < 0 ? h + 360 : h} 85% ${45 + t * 8}%)`;
}

export function Canvas() {
  const doc = useStore((s) => s.doc);
  const selection = useStore((s) => s.selection);
  const tool = useStore((s) => s.tool);
  const result = useStore((s) => s.result);
  const highlight = useStore((s) => s.highlight);
  const build = useStore((s) => s.build);
  const live = useStore((s) => s.live);
  const pressedRef = useRef<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const [cursor, setCursor] = useState<Pt>({ x: 0, y: 0 });
  const [hover, setHover] = useState<Target | null>(null);
  const [wireStart, setWireStart] = useState<Endpoint | null>(null);
  const [showVoltColors, setShowVoltColors] = useState(true);
  const drag = useRef<Drag | null>(null);
  const fitted = useRef(false);

  const conn = useMemo(() => computeConnectivity(doc), [doc]);
  const obstacles = useMemo(() => buildObstacles(doc), [doc]);
  const fresh = result && result.ok && result.analysis === 'op' && result.revision === doc.revision ? result : null;
  const stale = result && result.ok && result.revision !== doc.revision;
  const vmax = fresh?.op ? Math.max(0.001, ...Object.values(fresh.op.nodes)) : 1;

  // Đếm số dây chạm mỗi endpoint (để vẽ chấm junction và chân hở)
  const degree = useMemo(() => {
    const m = new Map<string, number>();
    for (const w of doc.wires) for (const e of [w.a, w.b]) m.set(endpointKey(e), (m.get(endpointKey(e)) ?? 0) + 1);
    return m;
  }, [doc.wires]);

  const fit = (target = getState().build?.final ?? getState().doc) => {
    const svg = svgRef.current;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    const b = documentBounds(target);
    const w = b.maxX - b.minX + 160, h = b.maxY - b.minY + 160;
    const k = Math.min(2, Math.max(0.3, Math.min(r.width / w, r.height / h)));
    setView({ k, x: r.width / 2 - ((b.minX + b.maxX) / 2) * k, y: r.height / 2 - ((b.minY + b.maxY) / 2) * k });
  };
  const lastSize = useRef({ w: 0, h: 0 });
  useEffect(() => {
    const el = svgRef.current!;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth, h = el.clientHeight;
      const l = lastSize.current;
      if (w && h && (Math.abs(w - l.w) / Math.max(1, l.w) > 0.25 || Math.abs(h - l.h) / Math.max(1, l.h) > 0.25)) fit();
      lastSize.current = { w, h };
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []); // eslint-disable-line
  useEffect(() => {
    if (!fitted.current) { fitted.current = true; requestAnimationFrame(() => fit()); }
    const h = () => fit();
    window.addEventListener('netlist:fit', h);
    return () => window.removeEventListener('netlist:fit', h);
  });
  // tự fit khi bắt đầu dựng bằng AI và khi linh kiện ra ngoài khung
  const building = !!build;
  useEffect(() => { if (building) requestAnimationFrame(() => fit()); }, [building]); // eslint-disable-line
  useEffect(() => { if (tool.kind !== 'wire') setWireStart(null); }, [tool.kind]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setWireStart(null); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, []);

  const toWorld = (e: { clientX: number; clientY: number }): Pt => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left - view.x) / view.k, y: (e.clientY - r.top - view.y) / view.k };
  };

  const findTarget = (p: Pt): Target | null => {
    const tol = 9 / view.k;
    let best: Target | null = null, bd = tol;
    for (const c of doc.components) {
      for (const pin of LIBRARY[c.type].pins) {
        const pos = pinPosition(c, pin.id)!;
        const d = Math.hypot(pos.x - p.x, pos.y - p.y);
        if (d < bd) { bd = d; best = { kind: 'pin', ep: { kind: 'pin', comp: c.id, pin: pin.id }, pos }; }
      }
    }
    for (const j of doc.junctions) {
      const d = Math.hypot(j.x - p.x, j.y - p.y);
      if (d < bd) { bd = d; best = { kind: 'junction', ep: { kind: 'junction', id: j.id }, pos: { x: j.x, y: j.y } }; }
    }
    if (best) return best;
    let wd = 6 / view.k;
    for (const w of doc.wires) {
      const a = endpointPosition(doc, w.a), b = endpointPosition(doc, w.b);
      if (!a || !b) continue;
      const pts = wireRoute(a, b, obstacles);
      for (let i = 0; i < pts.length - 1; i++) {
        const { d, q } = distToSeg(p, pts[i], pts[i + 1]);
        if (d < wd) { wd = d; best = { kind: 'wire', wireId: w.id, pos: { x: snap(q.x), y: snap(q.y) } }; }
      }
    }
    return best;
  };

  const locked = !!build;

  const onPointerDown = (e: React.PointerEvent) => {
    if (locked) return;
    const p = toWorld(e);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    if (e.button === 1 || e.button === 2 || (e.button === 0 && e.altKey)) {
      drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
      return;
    }
    const s = getState();
    if (tool.kind === 'place') {
      const c = makeComponent(s.doc, tool.type, p.x, p.y, tool.rot);
      commit(addComponent(s.doc, c));
      setState({ selection: { kind: 'comp', id: c.id } });
      if (!e.shiftKey) setState({ tool: { kind: 'select' } });
      return;
    }
    if (tool.kind === 'wire') {
      const t = findTarget(p);
      let ep: Endpoint;
      let d = s.doc;
      if (t?.kind === 'pin' || t?.kind === 'junction') ep = t.ep;
      else if (t?.kind === 'wire') {
        const r = splitWire(d, t.wireId, t.pos.x, t.pos.y);
        d = r.doc; ep = { kind: 'junction', id: r.junctionId };
      } else if (wireStart) {
        // điểm gấp: tạo junction tự do và tiếp tục
        const sp = endpointPosition(d, wireStart)!;
        let x = snap(p.x), y = snap(p.y);
        if (Math.abs(x - sp.x) < Math.abs(y - sp.y)) x = sp.x; else y = sp.y; // giữ trực giao
        const id = `j_${Math.random().toString(36).slice(2, 10)}`;
        d = { ...d, junctions: [...d.junctions, { id, x, y }] };
        ep = { kind: 'junction', id };
      } else {
        drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
        return;
      }
      if (wireStart) {
        d = addWire(d, wireStart, ep).doc;
        commit(d);
        // kết thúc khi chạm chân/junction có sẵn; tiếp tục khi là điểm gấp mới
        setWireStart(t ? null : ep);
      } else {
        if (d !== s.doc) commit(d);
        setWireStart(ep);
      }
      return;
    }
    // select
    const el = (e.target as Element).closest('[data-kind]') as HTMLElement | null;
    const kind = el?.dataset.kind;
    const id = el?.dataset.id;
    if (kind === 'comp' && id) {
      const c = s.doc.components.find((c) => c.id === id)!;
      if (s.live) {
        // đang chạy thật: bấm nút nhấn / gạt công tắc, không kéo linh kiện
        if (c.type === 'pushbutton') { livePress(id, true); pressedRef.current = id; }
        else if (c.type === 'switch') livePress(id, !s.live.pressed[c.ref]);
        else setState({ selection: { kind: 'comp', id } });
        return;
      }
      setState({ selection: { kind: 'comp', id } });
      drag.current = { kind: 'comp', id, dx: p.x - c.x, dy: p.y - c.y, start: s.doc, moved: false };
    } else if (kind === 'junction' && id) {
      setState({ selection: { kind: 'junction', id } });
      drag.current = { kind: 'junction', id, start: s.doc, moved: false };
    } else if (kind === 'wire' && id) {
      setState({ selection: { kind: 'wire', id } });
    } else {
      setState({ selection: null });
      drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = toWorld(e);
    setCursor({ x: snap(p.x), y: snap(p.y) });
    if (tool.kind === 'wire') setHover(findTarget(p));
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'pan') setView((v) => ({ ...v, x: d.vx + e.clientX - d.sx, y: d.vy + e.clientY - d.sy }));
    else if (d.kind === 'comp') {
      const nx = snap(p.x - d.dx), ny = snap(p.y - d.dy);
      const c = getState().doc.components.find((c) => c.id === d.id);
      if (c && (c.x !== nx || c.y !== ny)) { d.moved = true; preview(moveComponent(getState().doc, d.id, nx, ny)); }
    } else if (d.kind === 'junction') {
      d.moved = true;
      preview(moveJunction(getState().doc, d.id, p.x, p.y));
    }
  };

  const onPointerUp = () => {
    if (pressedRef.current) { livePress(pressedRef.current, false); pressedRef.current = null; }
    const d = drag.current;
    drag.current = null;
    if (d && (d.kind === 'comp' || d.kind === 'junction') && d.moved) commit(getState().doc, d.start);
  };

  const onWheel = (e: React.WheelEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const k = Math.min(4, Math.max(0.2, view.k * Math.exp(-e.deltaY * 0.0015)));
    setView({ k, x: mx - ((mx - view.x) * k) / view.k, y: my - ((my - view.y) * k) / view.k });
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const type = e.dataTransfer.getData('application/x-netlist-type') as ComponentType;
    if (!type || !LIBRARY[type] || locked) return;
    const p = toWorld(e);
    const s = getState();
    const c = makeComponent(s.doc, type, p.x, p.y, 0);
    commit(addComponent(s.doc, c));
    setState({ selection: { kind: 'comp', id: c.id }, tool: { kind: 'select' } });
  };

  // ---------- render helpers ----------
  const labelFor = (c: ComponentInstance) => {
    const def = LIBRARY[c.type];
    if (c.type === 'ground') return null;
    if (isLabelType(c.type)) {
      const mid = c.type === 'power' ? rotatePoint(0, -24, c.rot) : rotatePoint(27, 0, c.rot);
      return (
        <text x={c.x + mid.x} y={c.y + mid.y + 4} textAnchor="middle" className="label-text">{c.params.name}</text>
      );
    }
    const value = valueText(c);
    const e = rotExtent(c);
    const vertical = c.rot === 90 || c.rot === 270;
    const isTwoPinVert = def.pins.length === 2 && def.pins[0].y !== def.pins[1].y;
    const side = !def.box && vertical !== isTwoPinVert; // linh kiện 2 chân đang đứng dọc
    return side ? (
      <g className="comp-text">
        <text x={c.x + 26} y={c.y - 4} className="ref">{c.ref}</text>
        <text x={c.x + 26} y={c.y + 11} className="val">{value}</text>
      </g>
    ) : (
      <g className="comp-text">
        <text x={c.x} y={c.y - Math.max(26, e.hh - (def.box ? 0 : 14)) - 4} textAnchor="middle" className="ref">{c.ref}</text>
        {value && <text x={c.x} y={c.y + Math.max(34, e.hh - (def.box ? 0 : 10)) + 10} textAnchor="middle" className="val">{value}</text>}
      </g>
    );
  };

  const wireColor = (w: { a: Endpoint }) => {
    if (!fresh?.op || !showVoltColors) return undefined;
    const net = conn.netOf.get(endpointKey(w.a));
    if (!net) return undefined;
    const v = net === '0' ? 0 : fresh.op.nodes[net];
    return v === undefined ? undefined : voltageColor(v, vmax);
  };

  const ghost = tool.kind === 'place' ? { ...makeComponent(doc, tool.type, cursor.x, cursor.y, tool.rot), id: '__ghost' } : null;
  const wireStartPos = wireStart ? endpointPosition(doc, wireStart) : null;

  // Thẻ điện áp: một thẻ cho mỗi net (trừ ground) tại chân đầu tiên
  const voltageTags = fresh?.op
    ? conn.nets.filter((n) => !n.isGround && n.endpoints.length >= 2 && fresh.op!.nodes[n.name] !== undefined).map((n) => {
        const key = n.keys.find((k) => k.startsWith('c:'))!;
        const [, id, pin] = key.split(':');
        const c = doc.components.find((c) => c.id === id);
        const pos = c ? pinPosition(c, pin) : null;
        return pos ? { net: n.name, pos, v: fresh.op!.nodes[n.name] } : null;
      }).filter(Boolean) as { net: string; pos: Pt; v: number }[]
    : [];

  return (
    <div className={`canvas-wrap tool-${tool.kind}${locked ? ' locked' : ''}${live ? ' live-mode' : ''}`}>
      <svg
        id="schematic-svg"
        ref={svgRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setHover(null)}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
      >
        <defs>
          <pattern id="grid-minor" width={10} height={10} patternUnits="userSpaceOnUse">
            <circle cx={0} cy={0} r={0.7} fill="var(--grid-dot)" />
          </pattern>
          <pattern id="grid-major" width={100} height={100} patternUnits="userSpaceOnUse">
            <rect width={100} height={100} fill="url(#grid-minor)" />
            <path d="M100 0H0V100" fill="none" stroke="var(--grid-line)" strokeWidth={0.6} />
          </pattern>
          <filter id="glow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="6" />
          </filter>
        </defs>
        <g id="viewport" transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          <rect data-noexport x={-20000} y={-20000} width={40000} height={40000} fill="url(#grid-major)" />
          <g id="content">
            {/* dây */}
            {doc.wires.map((w) => {
              const a = endpointPosition(doc, w.a), b = endpointPosition(doc, w.b);
              if (!a || !b) return null;
              const pts = wireRoute(a, b, obstacles).map((p) => `${p.x},${p.y}`).join(' ');
              const sel = selection?.kind === 'wire' && selection.id === w.id;
              const col = wireColor(w);
              return (
                <g key={w.id} data-kind="wire" data-id={w.id} className={`wire${sel ? ' selected' : ''}`}>
                  <polyline points={pts} className="wire-hit" />
                  <polyline points={pts} className="wire-line" style={col ? { stroke: col } : undefined} />
                </g>
              );
            })}
            {/* junction */}
            {doc.junctions.map((j) => {
              const deg = degree.get(`j:${j.id}`) ?? 0;
              const sel = selection?.kind === 'junction' && selection.id === j.id;
              return (
                <g key={j.id} data-kind="junction" data-id={j.id} className={`junction${sel ? ' selected' : ''}`}>
                  <circle cx={j.x} cy={j.y} r={8} className="hit" />
                  {deg >= 3 ? <circle cx={j.x} cy={j.y} r={3.6} className="dot" /> : <circle cx={j.x} cy={j.y} r={1.6} className="bend" />}
                </g>
              );
            })}
            {/* linh kiện */}
            {doc.components.map((c) => {
              const sel = selection?.kind === 'comp' && selection.id === c.id;
              const hl = highlight.includes(c.ref);
              const ledI = c.type === 'led' || c.type === 'lamp' ? (live ? live.brightness[c.ref] ?? 0 : fresh?.op ? fresh.op.currents[c.ref] ?? 0 : 0) : 0;
              return (
                <g key={c.id} data-kind="comp" data-id={c.id} className={`comp comp-${c.type}${sel ? ' selected' : ''}${hl ? ' placed' : ''}`}>
                  {ledI > 2e-4 && (
                    <circle cx={c.x} cy={c.y} r={c.type === 'lamp' ? 28 : 22} fill={c.type === 'lamp' ? '#ffcc66' : ledColor(c.params.model)} opacity={Math.min(0.9, 0.15 + ledI / (c.type === 'lamp' ? 0.4 : live ? 0.008 : 0.02))} filter="url(#glow)" />
                  )}
                  {(() => { const e = rotExtent(c); return <rect x={c.x - e.hw} y={c.y - e.hh} width={e.hw * 2} height={e.hh * 2} className="comp-hit" rx={8} />; })()}
                  <g transform={`translate(${c.x} ${c.y}) rotate(${c.rot})`} className="sym">
                    <SymbolBody c={c} live={live} />
                  </g>
                  {LIBRARY[c.type].pins.map((p) => {
                    const pos = pinPosition(c, p.id)!;
                    const open = !degree.get(`c:${c.id}:${p.id}`) && !isLabelType(c.type) && LIBRARY[c.type].sim !== 'display';
                    return <circle key={p.id} cx={pos.x} cy={pos.y} r={open ? 2.6 : 1.8} className={open ? 'pin open' : 'pin'} />;
                  })}
                  {labelFor(c)}
                </g>
              );
            })}
            {/* thẻ điện áp */}
            {voltageTags.map((t) => (
              <g key={t.net} className="vtag" transform={`translate(${t.pos.x + 6} ${t.pos.y - 14})`}>
                <rect x={0} y={-9} rx={4} width={formatSI(t.v, 'V').length * 6.4 + 10} height={15} />
                <text x={5} y={2}>{formatSI(t.v, 'V')}</text>
              </g>
            ))}
          </g>
          {/* lớp tương tác */}
          <g data-noexport>
            {ghost && (
              <g className="comp ghost" transform={`translate(${ghost.x} ${ghost.y}) rotate(${ghost.rot})`}>
                <SymbolBody c={ghost} />
              </g>
            )}
            {tool.kind === 'wire' && hover && (
              <circle cx={hover.pos.x} cy={hover.pos.y} r={6} className={`snap-ring ${hover.kind}`} />
            )}
            {wireStartPos && (
              <polyline
                className="rubber"
                points={wireRoute(wireStartPos, hover && hover.kind !== 'wire' ? hover.pos : hover ? hover.pos : cursor).map((p) => `${p.x},${p.y}`).join(' ')}
              />
            )}
          </g>
        </g>
      </svg>
      <div className="canvas-hud" data-noexport>
        <span>{cursor.x}, {cursor.y}</span>
        <span>{Math.round(view.k * 100)}%</span>
        {stale && <span className="stale">kết quả cũ — chạy lại</span>}
        {fresh?.op && (
          <label className="hud-toggle"><input type="checkbox" checked={showVoltColors} onChange={(e) => setShowVoltColors(e.target.checked)} /> tô màu theo điện áp</label>
        )}
        <button onClick={() => fit()} title="Vừa khung (F)">⤢</button>
      </div>
      {tool.kind === 'wire' && (
        <div className="canvas-hint">Nối dây: bấm chân → bấm chân/dây đích. Bấm chỗ trống để tạo điểm gấp. Esc để dừng.</div>
      )}
      {tool.kind === 'place' && <div className="canvas-hint">Bấm để đặt {LIBRARY[tool.type].name} · R xoay · Shift giữ công cụ · Esc huỷ</div>}
    </div>
  );
}

/** Vùng chiếm chỗ đã xoay */
function rotExtent(c: ComponentInstance) {
  const e = compExtent(c.type);
  return c.rot === 90 || c.rot === 270 ? { hw: e.hh, hh: e.hw } : e;
}

/** Chuỗi giá trị ngắn hiển thị dưới linh kiện */
function valueText(c: ComponentInstance): string {
  const p = c.params;
  switch (c.type) {
    case 'switch': return p.closed === '1' ? 'đóng' : 'mở';
    case 'pushbutton': return p.pressed === '1' ? 'đang nhấn' : 'nhả';
    case 'potentiometer': return `${p.value} · ${Math.round((Number(p.pos) || 0) * 100)}%`;
    case 'capacitor_pol': return `${p.value} ${p.voltage}V`;
    case 'fuse': return `${p.rating}A`;
    case 'crystal': return `${p.freq}Hz`;
    case 'transformer': return `1:${p.ratio}`;
    case 'ldr': return `${p.lux} lux`;
    case 'thermistor': return `${p.r25} · ${p.temp}°C`;
    case 'relay': return p.coil;
    case 'lamp': return `${p.voltage}V ${p.power}W`;
    case 'motor': return `${p.r}Ω`;
    case 'battery': return p.kind;
    case 'clock': return `${p.freq}Hz ${p.high}V`;
    case 'optocoupler': return `CTR ${p.ctr}`;
    case 'logic_gate': return p.gate;
    case 'logic_not': return 'NOT';
    case 'vcvs': case 'vccs': case 'opamp': return p.gain;
    case 'timer555': case 'lm317': case 'comparator': return '';
  }
  if (LIBRARY[c.type].box) return '';
  return p.model ? modelLabel(p.model) : p.value ?? '';
}
