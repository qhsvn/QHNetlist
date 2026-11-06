import { useState } from 'react';
import { CATEGORIES, COMPONENT_TYPES, LIBRARY, compExtent } from '../core/library';
import type { ComponentInstance } from '../core/types';
import { setState, useStore } from './store';
import { SymbolBody } from './Symbols';

const SIM_LABEL = { verified: 'đã kiểm chứng', model: 'có mô hình', display: 'chỉ hiển thị' } as const;

export function Library() {
  const tool = useStore((s) => s.tool);
  const [q, setQ] = useState('');
  const cats = CATEGORIES;
  const qq = q.trim().toLowerCase();
  const list = COMPONENT_TYPES.filter((t) => {
    if (!qq) return true;
    const d = LIBRARY[t];
    return `${d.name} ${t} ${d.keywords ?? ''} ${d.params.flatMap((p) => p.options ?? []).join(' ')}`.toLowerCase().includes(qq);
  });
  return (
    <div className="library">
      <div className="panel-title">Thư viện</div>
      <input className="search" placeholder="Tìm linh kiện…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
      {cats.map((cat) => {
        const items = list.filter((t) => LIBRARY[t].category === cat);
        if (!items.length) return null;
        return (
          <div key={cat} className="lib-cat">
            <div className="lib-cat-title">{cat} <small>{items.length}</small></div>
            <div className="lib-grid">
              {items.map((t) => {
                const def = LIBRARY[t];
                const fake: ComponentInstance = { id: 'x', ref: '', type: t, params: def.defaults, x: 0, y: 0, rot: 0 };
                const active = tool.kind === 'place' && tool.type === t;
                return (
                  <button
                    key={t}
                    className={`lib-item${active ? ' active' : ''}`}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData('application/x-netlist-type', t)}
                    onClick={() => setState({ tool: { kind: 'place', type: t, rot: 0 } })}
                    title={`${def.description}\nMô phỏng: ${SIM_LABEL[def.sim]}${def.builtin ? '' : ' (cần ngspice)'}`}
                  >
                    <svg viewBox={iconBox(t)} className="lib-icon"><g className="sym"><SymbolBody c={fake} /></g></svg>
                    <span>{def.name}</span>
                    <i className={`sim-dot sim-${def.sim}`} />
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function iconBox(t: Parameters<typeof compExtent>[0]): string {
  const e = compExtent(t);
  const r = Math.max(50, e.hw + 6, e.hh + 6);
  return `${-r} ${-r} ${2 * r} ${2 * r}`;
}
