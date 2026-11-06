// Command thuần: nhận document, trả document mới. UI và AI dùng chung các hàm này.
import { endpointKey, endpointPosition, newId, sameEndpoint, snap } from './document';
import type { CircuitDocument, ComponentInstance, Endpoint, Rotation, Wire } from './types';

export function addComponent(doc: CircuitDocument, c: ComponentInstance): CircuitDocument {
  return { ...doc, components: [...doc.components, c] };
}

export function updateComponent(
  doc: CircuitDocument,
  id: string,
  patch: Partial<Omit<ComponentInstance, 'id'>>,
): CircuitDocument {
  return {
    ...doc,
    components: doc.components.map((c) =>
      c.id === id ? { ...c, ...patch, params: patch.params ? { ...c.params, ...patch.params } : c.params } : c,
    ),
  };
}

export function moveComponent(doc: CircuitDocument, id: string, x: number, y: number): CircuitDocument {
  return updateComponent(doc, id, { x: snap(x), y: snap(y) });
}

export function rotateComponent(doc: CircuitDocument, id: string): CircuitDocument {
  const c = doc.components.find((c) => c.id === id);
  if (!c) return doc;
  return updateComponent(doc, id, { rot: (((c.rot + 90) % 360) as Rotation) });
}

export function removeComponent(doc: CircuitDocument, id: string): CircuitDocument {
  const wires = doc.wires.filter(
    (w) => !(w.a.kind === 'pin' && w.a.comp === id) && !(w.b.kind === 'pin' && w.b.comp === id),
  );
  return pruneJunctions({ ...doc, components: doc.components.filter((c) => c.id !== id), wires });
}

export function addWire(doc: CircuitDocument, a: Endpoint, b: Endpoint): { doc: CircuitDocument; wire?: Wire } {
  if (sameEndpoint(a, b)) return { doc };
  const exists = doc.wires.some(
    (w) => (sameEndpoint(w.a, a) && sameEndpoint(w.b, b)) || (sameEndpoint(w.a, b) && sameEndpoint(w.b, a)),
  );
  if (exists) return { doc };
  const wire: Wire = { id: newId('w'), a, b };
  return { doc: { ...doc, wires: [...doc.wires, wire] }, wire };
}

export function removeWire(doc: CircuitDocument, id: string): CircuitDocument {
  return pruneJunctions({ ...doc, wires: doc.wires.filter((w) => w.id !== id) });
}

export function addJunction(doc: CircuitDocument, x: number, y: number): { doc: CircuitDocument; id: string } {
  const id = newId('j');
  return { doc: { ...doc, junctions: [...doc.junctions, { id, x: snap(x), y: snap(y) }] }, id };
}

export function moveJunction(doc: CircuitDocument, id: string, x: number, y: number): CircuitDocument {
  return { ...doc, junctions: doc.junctions.map((j) => (j.id === id ? { ...j, x: snap(x), y: snap(y) } : j)) };
}

export function removeJunction(doc: CircuitDocument, id: string): CircuitDocument {
  return {
    ...doc,
    junctions: doc.junctions.filter((j) => j.id !== id),
    wires: doc.wires.filter(
      (w) => !(w.a.kind === 'junction' && w.a.id === id) && !(w.b.kind === 'junction' && w.b.id === id),
    ),
  };
}

/** Tách dây tại một điểm, tạo junction tường minh. Trả về id junction. */
export function splitWire(doc: CircuitDocument, wireId: string, x: number, y: number): { doc: CircuitDocument; junctionId: string } {
  const w = doc.wires.find((w) => w.id === wireId);
  if (!w) throw new Error('Không tìm thấy dây');
  const { doc: d1, id } = addJunction(doc, x, y);
  const j: Endpoint = { kind: 'junction', id };
  const rest = d1.wires.filter((x) => x.id !== wireId);
  return {
    doc: { ...d1, wires: [...rest, { id: newId('w'), a: w.a, b: j }, { id: newId('w'), a: j, b: w.b }] },
    junctionId: id,
  };
}

/** Xoá junction không còn dây nào. */
export function pruneJunctions(doc: CircuitDocument): CircuitDocument {
  const used = new Set<string>();
  for (const w of doc.wires) {
    used.add(endpointKey(w.a));
    used.add(endpointKey(w.b));
  }
  const junctions = doc.junctions.filter((j) => used.has(`j:${j.id}`));
  return junctions.length === doc.junctions.length ? doc : { ...doc, junctions };
}

/** Xoá dây có endpoint không còn tồn tại. */
export function sanitize(doc: CircuitDocument): CircuitDocument {
  const wires = doc.wires.filter((w) => endpointPosition(doc, w.a) && endpointPosition(doc, w.b));
  return pruneJunctions({ ...doc, wires });
}
