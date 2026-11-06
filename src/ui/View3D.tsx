// Khung nhìn 3D (Three.js): bo mạch, linh kiện thủ tục, đường mạch đồng bộ với schematic.
// Chỉ đọc document và gửi lệnh chọn; không tự sửa đồ thị điện.
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { boardTextures } from './three/boardTexture';
import { computeConnectivity } from '../core/connectivity';
import { buildObstacles, documentBounds, endpointKey, endpointPosition, wireRoute } from '../core/document';
import { LIBRARY, isLabelType, modelLabel } from '../core/library';
import type { CircuitDocument, ComponentInstance, SimResult } from '../core/types';
import { formatSI } from '../core/units';
import { BOARD_TOP, MM_PER_PX, buildModel, drawScreen, labelSprite, mat, type ScreenInfo } from './three/models';
import { glowLevel } from './Symbols';
import { livePress } from './actions';
import type { LiveFrame } from '../sim/live';
import { getState, setState, subscribe } from './store';

interface Entry {
  key: string; // thay đổi => dựng lại mô hình
  obj: THREE.Group;
  label: THREE.Sprite;
  led?: { material: THREE.MeshStandardMaterial; light: THREE.PointLight; scale?: number };
  segs?: Record<string, THREE.MeshStandardMaterial>;
  screen?: ScreenInfo;
  ref: string;
  type: string;
  target: THREE.Vector3;
  born: number;
}

let exportRoot: THREE.Object3D | null = null;

/** Xuất GLB đúng tỷ lệ: document lưu mm, glTF dùng mét. */
export async function exportGLB(): Promise<Blob | null> {
  if (!exportRoot) return null;
  const wrapper = new THREE.Group();
  const clone = exportRoot.clone(true);
  clone.traverse((o) => { if ((o as THREE.Sprite).isSprite || (o as THREE.Light).isLight) o.parent?.remove(o); });
  wrapper.add(clone);
  wrapper.scale.setScalar(0.001);
  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(wrapper, { binary: true });
  return new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' });
}

function voltageColor(v: number, vmax: number) {
  const t = Math.max(0, Math.min(1, vmax > 0 ? v / vmax : 0));
  const h = (220 - t * 220 + 360) % 360;
  return new THREE.Color(`hsl(${Math.round(h)}, 85%, 50%)`);
}

const toWorld = (x: number, y: number) => new THREE.Vector3(x * MM_PER_PX, 0, y * MM_PER_PX);

function compKey(c: ComponentInstance) {
  return `${c.type}|${c.rot}|${JSON.stringify(c.params)}|${c.ref}`;
}

export function View3D() {
  const host = useRef<HTMLDivElement>(null);
  const [showLabels, setShowLabels] = useState(true);
  const [voltColors, setVoltColors] = useState(true);
  const [decor, setDecor] = useState(true);
  const opts = useRef({ showLabels, voltColors, decor });
  opts.current = { showLabels, voltColors, decor };
  const refresh = useRef<() => void>(() => {});

  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#f3f1f6');
    scene.fog = new THREE.Fog('#f3f1f6', 400, 1200);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.75;
    const camera = new THREE.PerspectiveCamera(38, 1, 1, 4000);
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    // chỉ vật phát sáng (emissive > 1) mới loé; nền sáng không bị loé
    const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.7, 0.4, 1.1);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    camera.position.set(60, 140, 160);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.minDistance = 20;
    controls.maxDistance = 900;

    scene.add(new THREE.HemisphereLight('#ffffff', '#b9b0c9', 0.6));
    const sun = new THREE.DirectionalLight('#ffffff', 2.4);
    sun.position.set(80, 200, 120);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0005;
    sun.shadow.radius = 4;
    scene.add(sun, sun.target);
    const rim = new THREE.DirectionalLight('#ff7ac8', 0.6);
    rim.position.set(-150, 60, -120);
    scene.add(rim);

    const root = new THREE.Group();
    scene.add(root);
    exportRoot = root;
    const boardGroup = new THREE.Group();
    const traceGroup = new THREE.Group();
    const compGroup = new THREE.Group();
    root.add(boardGroup, traceGroup, compGroup);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.ShadowMaterial({ opacity: 0.12 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.01;
    ground.receiveShadow = true;
    scene.add(ground);

    const entries = new Map<string, Entry>();
    let selBox: THREE.Box3Helper | null = null;
    let selObj: THREE.Object3D | null = null;
    const selBounds = new THREE.Box3();
    const boundsOf = (o: THREE.Object3D) => {
      selBounds.makeEmpty();
      o.updateWorldMatrix(true, true);
      o.traverse((m) => { if ((m as THREE.Mesh).isMesh) selBounds.expandByObject(m, false); });
      selBounds.expandByScalar(0.8);
      return selBounds;
    };
    let lastDocRef: CircuitDocument | null = null;
    let lastResult: SimResult | null = null;
    let boardKey = '';
    let firstFit = true;
    let prevIds = new Set<string>();

    const fitCamera = (doc: CircuitDocument) => {
      const b = documentBounds(doc);
      const cx = ((b.minX + b.maxX) / 2) * MM_PER_PX, cz = ((b.minY + b.maxY) / 2) * MM_PER_PX;
      const wmm = (b.maxX - b.minX) * MM_PER_PX + 26, dmm = (b.maxY - b.minY) * MM_PER_PX + 26;
      const span = Math.max(wmm, dmm);
      const fov = (camera.fov * Math.PI) / 180;
      const need = Math.max(dmm * 1.15, wmm / Math.max(0.3, camera.aspect));
      const dist = (need / 2 / Math.tan(fov / 2)) * 1.05;
      controls.target.set(cx, 0, cz);
      const dir = new THREE.Vector3(-0.22, 0.66, 0.72).normalize();
      camera.position.set(cx + dir.x * dist, dir.y * dist, cz + dir.z * dist);
      sun.position.set(cx + 80, 220, cz + 120);
      sun.target.position.set(cx, 0, cz);
      const r = span;
      Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: 800 });
      sun.shadow.camera.updateProjectionMatrix();
      controls.update();
    };

    const buildBoard = (doc: CircuitDocument) => {
      const target = getState().build?.final ?? doc;
      const b = documentBounds(target);
      const pad = 45;
      const x0 = (b.minX - pad) * MM_PER_PX, x1 = (b.maxX + pad) * MM_PER_PX, z0 = (b.minY - pad) * MM_PER_PX, z1 = (b.maxY + pad) * MM_PER_PX;
      const key = [x0, x1, z0, z1].map((v) => Math.round(v / 5)).join(',');
      if (key === boardKey) return;
      boardKey = key;
      boardGroup.clear();
      const w = x1 - x0, d = z1 - z0;
      const shape = new THREE.Shape();
      const r = 4;
      shape.moveTo(x0 + r, z0); shape.lineTo(x1 - r, z0); shape.quadraticCurveTo(x1, z0, x1, z0 + r);
      shape.lineTo(x1, z1 - r); shape.quadraticCurveTo(x1, z1, x1 - r, z1); shape.lineTo(x0 + r, z1);
      shape.quadraticCurveTo(x0, z1, x0, z1 - r); shape.lineTo(x0, z0 + r); shape.quadraticCurveTo(x0, z0, x0 + r, z0);
      const geo = new THREE.ExtrudeGeometry(shape, { depth: BOARD_TOP, bevelEnabled: false });
      geo.rotateX(Math.PI / 2);
      geo.translate(0, BOARD_TOP, 0);
      const tex = boardTextures(opts.current.decor);
      const top = new THREE.MeshPhysicalMaterial({ color: '#6a6a70', map: tex.map, roughnessMap: tex.rough, roughness: 1, metalness: 0, clearcoat: 0.25, clearcoatRoughness: 0.5, envMapIntensity: 0.08 });
      const board = new THREE.Mesh(geo, [top, mat('#2b2a24', { roughness: 0.7 })]);
      board.receiveShadow = true;
      board.castShadow = true;
      boardGroup.add(board);
      // viền vàng kép + lỗ bắt vít mạ vàng ở bốn góc
      const goldEdge = new THREE.MeshStandardMaterial({ color: '#e0b04a', metalness: 0.9, roughness: 0.25, emissive: '#7a5410', emissiveIntensity: 0.15 });
      for (const [inset, width] of [[3, 0.7], [5.2, 0.35]] as const) {
        const ring = new THREE.Shape();
        const rr = (sh: THREE.Shape | THREE.Path, i: number) => {
          const a0 = x0 + i, a1 = x1 - i, b0 = z0 + i, b1 = z1 - i, q = 6;
          sh.moveTo(a0 + q, b0); sh.lineTo(a1 - q, b0); sh.lineTo(a1, b0 + q); sh.lineTo(a1, b1 - q); sh.lineTo(a1 - q, b1);
          sh.lineTo(a0 + q, b1); sh.lineTo(a0, b1 - q); sh.lineTo(a0, b0 + q); sh.lineTo(a0 + q, b0);
        };
        rr(ring, inset);
        const hole = new THREE.Path(); rr(hole, inset + width); ring.holes.push(hole);
        const rg = new THREE.Mesh(new THREE.ShapeGeometry(ring).rotateX(Math.PI / 2), goldEdge);
        rg.position.y = BOARD_TOP + 0.03;
        boardGroup.add(rg);
      }
      for (const [hx, hz] of [[x0 + 9, z0 + 9], [x1 - 9, z0 + 9], [x0 + 9, z1 - 9], [x1 - 9, z1 - 9]]) {
        const ringG = new THREE.Mesh(new THREE.RingGeometry(1.6, 3, 28).rotateX(-Math.PI / 2), goldEdge);
        ringG.position.set(hx, BOARD_TOP + 0.04, hz);
        const hole = new THREE.Mesh(new THREE.CircleGeometry(1.6, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#f3f1f6' }));
        hole.position.set(hx, BOARD_TOP + 0.045, hz);
        boardGroup.add(ringG, hole);
      }
      const title = labelSprite('NETLIST', target.name, '#b0186e', false);
      title.position.set(x0 + 14, BOARD_TOP + 0.5, z1 - 6);
      title.scale.set(18, 6.75, 1);
      boardGroup.add(title);
    };

    const traceMats: THREE.MeshStandardMaterial[] = [];
    const buildTraces = (doc: CircuitDocument, result: SimResult | null) => {
      traceGroup.clear();
      traceMats.length = 0;
      const conn = computeConnectivity(doc);
      const obstacles = buildObstacles(doc);
      const fresh = result && result.ok && result.analysis === 'op' && result.revision === doc.revision && result.op ? result.op : null;
      const vmax = fresh ? Math.max(0.001, ...Object.values(fresh.nodes)) : 1;
      const y = BOARD_TOP + 0.06;
      for (const w of doc.wires) {
        const a = endpointPosition(doc, w.a), b = endpointPosition(doc, w.b);
        if (!a || !b) continue;
        const net = conn.netOf.get(endpointKey(w.a));
        const v = fresh && net ? (net === '0' ? 0 : fresh.nodes[net]) : undefined;
        const energized = v !== undefined && opts.current.voltColors;
        const color = energized ? voltageColor(v!, vmax) : new THREE.Color('#f0c050');
        const m = new THREE.MeshStandardMaterial({ color, metalness: 0.85, roughness: 0.22, emissive: energized ? color : new THREE.Color('#8a5d10'), emissiveIntensity: energized ? 2.6 : 0.12 });
        m.userData.base = m.emissiveIntensity;
        m.userData.breath = energized ? 0.35 + 0.65 * Math.min(1, Math.abs(v!) / vmax) : 0;
        traceMats.push(m);
        const pts = wireRoute(a, b, obstacles).map((p) => toWorld(p.x, p.y));
        for (let i = 0; i < pts.length - 1; i++) {
          const p = pts[i], q = pts[i + 1];
          const len = p.distanceTo(q);
          if (len < 1e-6) continue;
          const seg = new THREE.Mesh(new THREE.BoxGeometry(len + 1.2, 0.14, 1.2), m);
          seg.position.set((p.x + q.x) / 2, y, (p.z + q.z) / 2);
          seg.rotation.y = -Math.atan2(q.z - p.z, q.x - p.x);
          seg.receiveShadow = true;
          traceGroup.add(seg);
        }
        for (const p of pts) {
          const via = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.16, 16), m);
          via.position.set(p.x, y, p.z);
          traceGroup.add(via);
        }
      }
      for (const j of doc.junctions) {
        const deg = doc.wires.filter((w) => (w.a.kind === 'junction' && w.a.id === j.id) || (w.b.kind === 'junction' && w.b.id === j.id)).length;
        if (deg < 3) continue;
        const p = toWorld(j.x, j.y);
        const dot = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.2, 18), mat('#d4a93a', { metalness: 0.85, roughness: 0.3 }));
        dot.position.set(p.x, y + 0.05, p.z);
        traceGroup.add(dot);
      }
      // thẻ điện áp nổi trên mỗi net
      if (fresh && opts.current.showLabels) {
        for (const n of conn.nets) {
          if (n.isGround || !n.endpoints.length || fresh.nodes[n.name] === undefined) continue;
          const key = n.keys.find((k) => k.startsWith('c:'))!;
          const [, id, pin] = key.split(':');
          const c = doc.components.find((c) => c.id === id);
          const pd = c && LIBRARY[c.type].pins.find((p) => p.id === pin);
          if (!c || !pd) continue;
          const r = (c.rot * Math.PI) / 180;
          const px = c.x + pd.x * Math.cos(r) - pd.y * Math.sin(r), py = c.y + pd.x * Math.sin(r) + pd.y * Math.cos(r);
          const s = labelSprite(formatSI(fresh.nodes[n.name], 'V'), '', '#0b8a5a');
          const p = toWorld(px, py);
          s.position.set(p.x, 12, p.z);
          s.scale.set(0.075, 0.028, 1);
          traceGroup.add(s);
        }
      }
    };

    const syncComponents = (doc: CircuitDocument, result: SimResult | null) => {
      const now = performance.now();
      const seen = new Set<string>();
      const fresh = result && result.ok && result.analysis === 'op' && result.revision === doc.revision ? result.op : null;
      for (const c of doc.components) {
        seen.add(c.id);
        const key = compKey(c);
        let e = entries.get(c.id);
        const target = toWorld(c.x, c.y);
        if (!e || e.key !== key) {
          const isNew = !e;
          if (e) compGroup.remove(e.obj);
          const info = buildModel(c);
          info.group.userData.compId = c.id;
          info.group.traverse((o) => { o.userData.compId = c.id; });
          const def = LIBRARY[c.type];
          const lbl = isLabelType(c.type);
          const sub = lbl || c.type === 'ground' ? '' : c.params.model ? modelLabel(c.params.model) : c.params.value ?? '';
          const label = labelSprite(lbl ? c.params.name : c.ref, sub);
          label.position.set(0, c.type === 'servo' ? 32 : 18, 0);
          label.userData.compId = c.id;
          info.group.add(label);
          void def;
          e = { key, obj: info.group, label, led: info.led, segs: info.segs, screen: info.screen, ref: c.ref, type: c.type, target, born: isNew && !firstFit ? now : (e?.born ?? 0) };
          liveApplied = null;
          if (isNew && !firstFit) info.group.position.set(target.x, 60, target.z);
          else info.group.position.copy(target);
          compGroup.add(info.group);
          entries.set(c.id, e);
        }
        e.target = target;
        e.label.visible = opts.current.showLabels;
        // LED sáng theo dòng (minh hoạ, không phải mô phỏng quang học)
        if (e.led) {
          const i = fresh ? Math.max(0, fresh.currents[c.ref] ?? 0) : 0;
          const k = Math.min(1, i / (e.led.scale ?? 0.02));
          e.led.material.emissiveIntensity = k * 2.2;
          e.led.light.intensity = k * 900;
        }
      }
      for (const [id, e] of entries) if (!seen.has(id)) { compGroup.remove(e.obj); entries.delete(id); }
    };

    const frames = new THREE.Group();
    scene.add(frames);
    const neon = new THREE.MeshStandardMaterial({ color: '#36d6ff', emissive: '#36d6ff', emissiveIntensity: 4, toneMapped: false });
    const neonPink = new THREE.MeshStandardMaterial({ color: '#ff3fa4', emissive: '#ff3fa4', emissiveIntensity: 4, toneMapped: false });
    const makeFrame = (o: THREE.Object3D, material: THREE.Material) => {
      const b = boundsOf(o).clone();
      const g = new THREE.Group();
      const w = b.max.x - b.min.x + 3, d = b.max.z - b.min.z + 3;
      const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
      for (const [k, t] of [[0, 0.5], [2.2, 0.25]] as const) {
        const outer = new THREE.Shape();
        outer.moveTo(-w / 2 - k, -d / 2 - k); outer.lineTo(w / 2 + k, -d / 2 - k); outer.lineTo(w / 2 + k, d / 2 + k); outer.lineTo(-w / 2 - k, d / 2 + k);
        const inner = new THREE.Path();
        inner.moveTo(-w / 2 - k + t, -d / 2 - k + t); inner.lineTo(w / 2 + k - t, -d / 2 - k + t); inner.lineTo(w / 2 + k - t, d / 2 + k - t); inner.lineTo(-w / 2 - k + t, d / 2 + k - t);
        outer.holes.push(inner);
        const m = new THREE.Mesh(new THREE.ShapeGeometry(outer).rotateX(Math.PI / 2), material);
        m.position.set(cx, BOARD_TOP + 0.2, cz);
        g.add(m);
      }
      const light = new THREE.PointLight((material as THREE.MeshStandardMaterial).color, 300, 30, 2);
      light.position.set(cx, BOARD_TOP + 6, cz);
      g.add(light);
      return g;
    };

    const updateSelection = () => {
      const s = getState();
      frames.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
      frames.clear();
      if (selBox) { scene.remove(selBox); selBox.dispose(); selBox = null; selObj = null; }
      const highlightRefs = new Set(s.highlight);
      for (const e of entries.values()) {
        const c = s.doc.components.find((c) => c.id === e.obj.userData.compId);
        e.obj.userData.glow = c ? highlightRefs.has(c.ref) : false;
        if (e.obj.userData.glow) frames.add(makeFrame(e.obj, neonPink));
      }
      if (s.selection?.kind === 'comp') {
        const e = entries.get(s.selection.id);
        if (e) {
          selObj = e.obj;
          frames.add(makeFrame(e.obj, neon));
        }
      }
    };

    const sync = () => {
      const s = getState();
      if (s.doc === lastDocRef && s.result === lastResult) { updateSelection(); return; }
      lastDocRef = s.doc; lastResult = s.result;
      buildBoard(s.doc);
      buildTraces(s.doc, s.result);
      syncComponents(s.doc, s.result);
      updateSelection();
      // fit lại khi mở mạch khác hẳn (không còn linh kiện nào trùng id)
      const ids = s.doc.components.map((c) => c.id);
      const overlap = ids.some((id) => prevIds.has(id));
      if (firstFit || (!overlap && ids.length && !s.build)) { fitCamera(s.build?.final ?? s.doc); }
      firstFit = false;
      prevIds = new Set(ids);
    };
    // cập nhật trực tiếp khi ⚡ Chạy thật: LED, đoạn LED, màn hình
    let liveApplied: LiveFrame | null | undefined = undefined;
    const applyLive = () => {
      const lv = getState().live;
      if (lv === liveApplied) return;
      const was = liveApplied;
      liveApplied = lv;
      if (!lv) {
        if (was) refresh.current();
        for (const e of entries.values()) {
          if (e.segs) for (const m of Object.values(e.segs)) m.emissiveIntensity = 0;
          if (e.screen && e.screen.ver !== '') { e.screen.ver = ''; drawScreen(e.screen, null); }
        }
        return;
      }
      for (const e of entries.values()) {
        if (e.led) {
          const k = glowLevel(lv.brightness[e.ref], e.type === 'lamp' ? 0.4 : 0.006);
          e.led.material.emissiveIntensity = k * 2.2;
          e.led.light.intensity = k * 900;
        }
        if (e.segs) for (const [key, m] of Object.entries(e.segs)) {
          const k = glowLevel(lv.brightness[`${e.ref}:${key}`]);
          m.emissiveIntensity = k * 3;
          m.color.set(k > 0 ? '#3a2a30' : '#2a2630');
        }
        if (e.screen) {
          if (e.screen.kind === 'lcd') {
            const st = lv.lcd[e.ref];
            const ver = st ? `${st.backlight}|${st.lines.join('|')}` : '-';
            if (ver !== e.screen.ver) { e.screen.ver = ver; drawScreen(e.screen, st ?? { lines: ['', ''], backlight: false }); }
          } else {
            const st = lv.oled[e.ref];
            const ver = st ? `${st.on}|${st.invert}|${st.version}` : '-';
            if (ver !== e.screen.ver) { e.screen.ver = ver; drawScreen(e.screen, st ?? { on: false }); }
          }
        }
      }
    };
    refresh.current = () => { lastDocRef = null; boardKey = ''; sync(); };
    sync();
    applyLive();
    let wasBuilding = false;
    const unsub = subscribe(() => {
      const building = !!getState().build;
      if (building && !wasBuilding) { boardKey = ''; fitCamera(getState().build!.final); }
      wasBuilding = building;
      sync();
      applyLive();
    });
    const onFit = () => fitCamera(getState().doc);
    window.addEventListener('netlist:fit3d', onFit);

    // chọn bằng click (không phải kéo xoay)
    const ray = new THREE.Raycaster();
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; };
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) { down = null; return; }
      down = null;
      const r = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
      const hit = ray.intersectObjects(compGroup.children, true).find((h) => h.object.userData.compId && !(h.object as THREE.Sprite).isSprite);
      const st = getState();
      const hc = hit ? st.doc.components.find((c) => c.id === hit.object.userData.compId) : undefined;
      if (st.live && hc && (hc.type === 'pushbutton' || hc.type === 'switch')) {
        // đang chạy thật: bấm nút trong 3D
        if (hc.type === 'switch') livePress(hc.id, !st.live.pressed[hc.ref]);
        else { livePress(hc.id, true); setTimeout(() => livePress(hc.id, false), 180); }
        return;
      }
      setState({ selection: hit ? { kind: 'comp', id: hit.object.userData.compId } : null });
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);

    let lastW = 0, lastH = 0;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth, h = el.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      composer.setSize(w, h);
      composer.setPixelRatio(renderer.getPixelRatio());
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      // fit lại khi khung đổi kích thước đáng kể (chuyển 2D | 3D ↔ 3D)
      if (Math.abs(w - lastW) / Math.max(1, lastW) > 0.25 || Math.abs(h - lastH) / Math.max(1, lastH) > 0.25) fitCamera(getState().build?.final ?? getState().doc);
      lastW = w; lastH = h;
    });
    ro.observe(el);

    let raf = 0;
    const clock = new THREE.Clock();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const t = clock.getElapsedTime();
      const now = performance.now();
      for (const e of entries.values()) {
        const o = e.obj;
        // rơi xuống và nảy nhẹ khi vừa được đặt
        const age = (now - e.born) / 1000;
        if (e.born && age < 0.7) {
          const k = age / 0.7;
          const bounce = Math.abs(Math.sin(k * Math.PI * 2.5)) * (1 - k) * 6;
          o.position.set(e.target.x, (1 - k) * (1 - k) * 60 + bounce, e.target.z);
        } else {
          o.position.lerp(e.target, 0.35);
          if (o.position.distanceTo(e.target) < 0.01) o.position.copy(e.target);
        }
        const glow = o.userData.glow as boolean;
        o.scale.setScalar(glow ? 1 + Math.sin(t * 10) * 0.04 + 0.04 : 1);
      }
      for (const m of traceMats) if (m.userData.breath) m.emissiveIntensity = m.userData.base * (1 - 0.35 * m.userData.breath + 0.35 * m.userData.breath * Math.sin(t * 3));
      neon.emissiveIntensity = neonPink.emissiveIntensity = 3 + Math.sin(t * 6) * 1.2;
      controls.update();
      composer.render();
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      unsub();
      ro.disconnect();
      window.removeEventListener('netlist:fit3d', onFit);
      controls.dispose();
      composer.dispose();
      pmrem.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
      if (exportRoot === root) exportRoot = null;
    };
  }, []);

  useEffect(() => { refresh.current(); }, [showLabels, voltColors, decor]);

  return (
    <div className="view3d">
      <div ref={host} className="view3d-host" />
      <div className="view3d-hud">
        <span className="tag3d">3D · minh hoạ bố trí theo sơ đồ</span>
        <label><input type="checkbox" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} /> nhãn</label>
        <label title="Hoạ tiết trang trí, không phải kết nối điện"><input type="checkbox" checked={decor} onChange={(e) => setDecor(e.target.checked)} /> hoạ tiết bo</label>
        <label><input type="checkbox" checked={voltColors} onChange={(e) => setVoltColors(e.target.checked)} /> màu điện áp</label>
        <button onClick={() => window.dispatchEvent(new Event('netlist:fit3d'))} title="Vừa khung">⤢</button>
      </div>
      <div className="view3d-help">Kéo trái: xoay · Kéo phải: dời · Lăn: zoom · Bấm: chọn linh kiện</div>
    </div>
  );
}
