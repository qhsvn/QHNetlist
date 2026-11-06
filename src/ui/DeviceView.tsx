// Tab "Thiết bị": mô hình 3D của thiết bị (xe, quạt, robot...) do AI dựng, chuyển động theo kết quả mạch.
// Chỉ đọc document + kết quả; không sửa mạch.
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { computeConnectivity } from '../core/connectivity';
import { evalBinding, snapshotFromResult, type ElectricalSnapshot } from '../core/device';
import type { CircuitDocument, DeviceModel, DeviceMotion, DevicePart } from '../core/types';
import { formatSI } from '../core/units';
import { FIXTURES } from '../core/fixtures';
import { getState, loadDocument, subscribe } from './store';

const DEG = Math.PI / 180;

function material(part: DevicePart): THREE.MeshPhysicalMaterial {
  const color = new THREE.Color(part.color ?? '#9aa0aa');
  const base = { color };
  switch (part.material ?? 'plastic') {
    case 'paint': return new THREE.MeshPhysicalMaterial({ ...base, roughness: 0.32, metalness: 0.25, clearcoat: 1, clearcoatRoughness: 0.08 });
    case 'metal': return new THREE.MeshPhysicalMaterial({ ...base, roughness: 0.35, metalness: 0.85 });
    case 'chrome': return new THREE.MeshPhysicalMaterial({ ...base, roughness: 0.08, metalness: 1 });
    case 'rubber': return new THREE.MeshPhysicalMaterial({ ...base, roughness: 0.92, metalness: 0 });
    case 'glass': return new THREE.MeshPhysicalMaterial({ ...base, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.45, clearcoat: 1 });
    case 'light': return new THREE.MeshPhysicalMaterial({ ...base, roughness: 0.2, emissive: color, emissiveIntensity: 0.15, clearcoat: 1 });
    default: return new THREE.MeshPhysicalMaterial({ ...base, roughness: 0.5, metalness: 0.05, clearcoat: 0.3, clearcoatRoughness: 0.3 });
  }
}

function shapeObject(part: DevicePart, m: THREE.MeshPhysicalMaterial): THREE.Object3D {
  const s = part.size;
  const mk = (g: THREE.BufferGeometry, mm: THREE.Material = m) => { const x = new THREE.Mesh(g, mm); x.castShadow = true; x.receiveShadow = true; return x; };
  switch (part.shape) {
    case 'box': {
      const r = Math.min(s[0], s[1], s[2]) * 0.18;
      return mk(new RoundedBoxGeometry(s[0], s[1], s[2], 3, r));
    }
    case 'cylinder': return mk(new THREE.CylinderGeometry(s[0], s[0], s[1], 40));
    case 'sphere': return mk(new THREE.SphereGeometry(s[0], 40, 20));
    case 'cone': return mk(new THREE.ConeGeometry(s[0], s[1], 40));
    case 'torus': return mk(new THREE.TorusGeometry(s[0], s[1], 20, 64));
    case 'capsule': return mk(new THREE.CapsuleGeometry(s[0], Math.max(0, s[1] - 2 * s[0]), 10, 24));
    case 'wheel': {
      // lốp (xuyến) + vành + nan: trục bánh theo z, nhìn được khi quay
      const R = s[0], w = s[1];
      const t = Math.min(w / 2, R * 0.28);
      const g = new THREE.Group();
      const tire = mk(new THREE.TorusGeometry(R - t, t, 24, 72));
      tire.scale.z = w / (2 * t);
      g.add(tire);
      const rimM = new THREE.MeshPhysicalMaterial({ color: '#b9bec7', metalness: 0.9, roughness: 0.25 });
      const rimR = R - 1.7 * t;
      const rim = mk(new THREE.CylinderGeometry(rimR, rimR, w * 0.55, 48, 1, true), rimM);
      rim.rotation.x = Math.PI / 2;
      (rim.material as THREE.MeshPhysicalMaterial).side = THREE.DoubleSide;
      g.add(rim);
      for (let i = 0; i < 5; i++) {
        const sp = mk(new THREE.BoxGeometry(rimR * 2, rimR * 0.16, w * 0.2), rimM);
        sp.rotation.z = (i * Math.PI) / 5;
        g.add(sp);
      }
      // vạch trắng trên lốp để thấy rõ chiều quay
      const mark = mk(new THREE.BoxGeometry(t * 0.5, t * 0.4, w * 1.02), new THREE.MeshStandardMaterial({ color: '#e8e8e8', roughness: 0.6 }));
      mark.position.set(0, R - t * 0.15, 0);
      g.add(mark);
      return g;
    }
  }
}

interface Mover {
  part: DevicePart;
  motion: DeviceMotion;
  obj: THREE.Group;
  mat: THREE.MeshPhysicalMaterial;
  light?: THREE.PointLight;
  level: number; // đã làm mượt
  target: number;
  angle: number;
}

function buildDevice(dev: DeviceModel) {
  const root = new THREE.Group();
  const nodes = new Map<string, { pivot: THREE.Group; mover: THREE.Group }>();
  const movers: Mover[] = [];
  const pickable: THREE.Object3D[] = [];
  for (const p of dev.parts) {
    const pivot = new THREE.Group();
    const mover = new THREE.Group();
    pivot.add(mover);
    if (p.pos) pivot.position.set(...p.pos);
    if (p.rot) pivot.rotation.set(p.rot[0] * DEG, p.rot[1] * DEG, p.rot[2] * DEG);
    const m = material(p);
    const o = shapeObject(p, m);
    o.traverse((x) => { x.userData.partName = p.name ?? p.id; });
    pickable.push(o);
    mover.add(o);
    nodes.set(p.id, { pivot, mover });
    if (p.motion) {
      const mv: Mover = { part: p, motion: p.motion, obj: mover, mat: m, level: 0, target: 0, angle: 0 };
      if (p.motion.type === 'glow' && p.material === 'light') {
        mv.light = new THREE.PointLight(new THREE.Color(p.color ?? '#ffffff'), 0, 4, 2);
        mover.add(mv.light);
      }
      movers.push(mv);
    }
  }
  for (const p of dev.parts) {
    const n = nodes.get(p.id)!;
    (p.parent ? nodes.get(p.parent)!.mover : root).add(n.pivot);
  }
  return { root, movers, pickable };
}

function roadTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const x = c.getContext('2d')!;
  x.fillStyle = '#3b3d42'; x.fillRect(0, 0, 512, 256);
  for (let i = 0; i < 1400; i++) { x.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`; x.fillRect(Math.random() * 512, Math.random() * 256, 2, 2); }
  x.fillStyle = '#f2f2f2'; x.fillRect(0, 10, 512, 6); x.fillRect(0, 240, 512, 6);
  x.fillStyle = '#f5d24a'; for (let i = 0; i < 2; i++) x.fillRect(i * 256 + 20, 124, 150, 8);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

function currentSnapshot(): ElectricalSnapshot | null {
  const s = getState();
  if (s.live) return { nodes: s.live.nodes, currents: s.live.brightness };
  return snapshotFromResult(s.result);
}

interface Readout { name: string; text: string; level: number }

export function DeviceView() {
  const host = useRef<HTMLDivElement>(null);
  const [dev, setDev] = useState<DeviceModel | undefined>(getState().doc.device);
  const [readouts, setReadouts] = useState<Readout[]>([]);
  const [status, setStatus] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [kmh, setKmh] = useState<number | null>(null);

  useEffect(() => {
    const unsub = subscribe(() => {
      const d = getState().doc.device;
      setDev((old) => (old === d ? old : d));
    });
    return () => { unsub(); };
  }, []);

  useEffect(() => {
    const el = host.current;
    if (!el || !dev) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const sky = dev.environment === 'road' ? '#cfe3f3' : '#eef0f4';
    scene.background = new THREE.Color(sky);
    scene.fog = new THREE.Fog(sky, 12, 60);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.55;
    const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 200);
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.35, 0.3, 1.6));
    composer.addPass(new OutputPass());
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI * 0.495;

    scene.add(new THREE.HemisphereLight('#ffffff', '#6f7480', 0.45));
    const sun = new THREE.DirectionalLight('#fff6e8', 1.9);
    scene.add(sun, sun.target);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;

    const { root, movers, pickable } = buildDevice(dev);
    scene.add(root);
    // đặt thiết bị chạm đất và lấy kích thước để chỉnh camera, bóng
    const box = new THREE.Box3().setFromObject(root);
    if (Number.isFinite(box.min.y)) root.position.y -= Math.min(0, box.min.y);
    box.setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const span = Math.max(size.x, size.y, size.z, 0.05);
    sun.position.set(center.x + span * 1.5, span * 3, center.z + span * 2);
    sun.target.position.copy(center);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -span * 1.5; sc.right = sc.top = span * 1.5; sc.near = 0.01; sc.far = span * 8;
    sc.updateProjectionMatrix();
    controls.minDistance = span * 0.3;
    controls.maxDistance = span * 12;
    const radius = Math.max(size.length() / 2, 0.05);
    const fit = () => {
      // khoảng cách đủ để cả thiết bị nằm gọn trong khung (tính cả khung hẹp khi chia đôi màn hình)
      const v = camera.fov * DEG;
      const h = 2 * Math.atan(Math.tan(v / 2) * camera.aspect);
      const dist = (radius / Math.sin(Math.min(v, h) / 2)) * 1.3;
      const dir = new THREE.Vector3(0.55, 0.32, 0.77).normalize();
      camera.position.copy(center).addScaledVector(dir, dist);
      controls.target.copy(center);
      controls.update();
    };
    fit();
    scene.fog.near = span * 6; scene.fog.far = span * 30;

    let roadTex: THREE.CanvasTexture | null = null;
    const env = dev.environment ?? (dev.road ? 'road' : 'floor');
    if (env === 'road') {
      roadTex = roadTexture();
      const roadW = Math.max(3, size.z * 6);
      const tile = roadW;
      roadTex.repeat.set(80 / tile, 1);
      const road = new THREE.Mesh(new THREE.PlaneGeometry(80, roadW), new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.9 }));
      road.rotation.x = -Math.PI / 2;
      road.position.set(center.x, 0, center.z);
      road.receiveShadow = true;
      road.userData.tile = tile;
      scene.add(road);
      const grass = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: '#7fae5b', roughness: 1 }));
      grass.rotation.x = -Math.PI / 2;
      grass.position.y = -0.005;
      grass.receiveShadow = true;
      scene.add(grass);
    } else if (env === 'floor') {
      const floor = new THREE.Mesh(new THREE.CircleGeometry(span * 6, 64), new THREE.MeshStandardMaterial({ color: '#dfe2e8', roughness: 0.8 }));
      floor.rotation.x = -Math.PI / 2;
      floor.receiveShadow = true;
      scene.add(floor);
      const grid = new THREE.GridHelper(span * 12, 24, '#c3c7cf', '#d3d6dc');
      grid.position.y = 0.001;
      scene.add(grid);
    }

    // ---- giá trị điện → mức chuyển động ----
    let roadTarget = 0, roadLevel = 0, roadOffset = 0;
    const update = () => {
      const s = getState();
      const doc: CircuitDocument = s.doc;
      const snap = currentSnapshot();
      const conn = computeConnectivity(doc);
      const outs: Readout[] = [];
      const seen = new Set<string>();
      for (const mv of movers) {
        const b = evalBinding(doc, mv.motion, snap, conn);
        mv.target = b.level;
        const key = `${mv.motion.ref}|${b.quantity}|${mv.motion.type}`;
        if (seen.has(key)) continue;
        seen.add(key);
        outs.push({ name: `${mv.part.name ?? mv.part.id} ← ${mv.motion.ref}`, text: `${formatSI(b.value, b.unit, 3)} · ${Math.round(b.level * 100)}%`, level: b.level });
      }
      if (dev.road) {
        const b = evalBinding(doc, dev.road, snap, conn);
        roadTarget = b.level;
        setKmh(Math.abs(b.level * (dev.road.speed ?? 10) * 3.6));
      } else setKmh(null);
      setReadouts(outs);
      setStatus(s.live ? '⚡ Đang chạy thật' : snap ? `Theo kết quả ${s.result?.source ?? ''} ${s.result?.analysis === 'tran' ? '(trung bình transient)' : '(DC)'}${s.result && s.result.revision !== doc.revision ? ' · CŨ, bấm ▶ Chạy lại' : ''}` : 'Chưa có kết quả: bấm ▶ Chạy hoặc ⚡ Chạy thật');
    };
    update();
    let lastResult = getState().result, lastLive = getState().live, lastDoc = getState().doc;
    const unsub = subscribe(() => {
      const s = getState();
      if (s.result !== lastResult || s.live !== lastLive || s.doc !== lastDoc) {
        lastResult = s.result; lastLive = s.live; lastDoc = s.doc;
        update();
      }
    });

    const ray = new THREE.Raycaster();
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; };
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) { down = null; return; }
      down = null;
      const r = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
      const hit = ray.intersectObjects(pickable, true)[0];
      setPicked(hit ? String(hit.object.userData.partName ?? '') : null);
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);
    const onFit = () => fit();
    window.addEventListener('netlist:fitdevice', onFit);

    const ro = new ResizeObserver(() => {
      const w = el.clientWidth, h = el.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      composer.setSize(w, h);
      composer.setPixelRatio(renderer.getPixelRatio());
      const first = !camera.userData.sized;
      camera.userData.sized = true;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      if (first) fit();
    });
    ro.observe(el);

    const clock = new THREE.Clock();
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(clock.getDelta(), 0.1);
      const t = clock.elapsedTime;
      for (const mv of movers) {
        // quán tính: quay/trượt tăng giảm từ từ, đèn phản ứng nhanh
        const tau = mv.motion.type === 'glow' ? 0.05 : mv.motion.type === 'spin' ? 0.6 : 0.25;
        mv.level += (mv.target - mv.level) * (1 - Math.exp(-dt / tau));
        const axis = mv.motion.axis ?? (mv.part.shape === 'wheel' ? 'z' : 'y');
        const o = mv.obj;
        switch (mv.motion.type) {
          case 'spin':
            mv.angle += mv.level * (mv.motion.speed ?? 3) * Math.PI * 2 * dt;
            o.rotation[axis] = mv.angle % (Math.PI * 2);
            break;
          case 'slide':
            o.position[axis] = mv.level * (mv.motion.range ?? 0.1);
            break;
          case 'swing':
            o.rotation[axis] = mv.level * (mv.motion.range ?? 45) * DEG;
            break;
          case 'shake': {
            const a = mv.level * Math.max(0.0015, span * 0.004);
            o.position.set(Math.sin(t * 91) * a, Math.sin(t * 73 + 1) * a, Math.sin(t * 67 + 2) * a);
            break;
          }
          case 'glow':
            mv.mat.emissiveIntensity = mv.part.material === 'light' ? 0.15 + mv.level * 5 : mv.level * 2;
            if (mv.light) mv.light.intensity = mv.level * span * 0.35;
            break;
        }
      }
      if (roadTex && dev.road) {
        roadLevel += (roadTarget - roadLevel) * (1 - Math.exp(-dt / 0.6));
        const tile = (scene.children.find((c) => c.userData.tile) as THREE.Mesh | undefined)?.userData.tile ?? 4;
        roadOffset += (roadLevel * (dev.road.speed ?? 10) * dt) / tile;
        roadTex.offset.x = roadOffset % 1;
      }
      controls.update();
      composer.render();
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      unsub();
      ro.disconnect();
      window.removeEventListener('netlist:fitdevice', onFit);
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      controls.dispose();
      composer.dispose();
      pmrem.dispose();
      roadTex?.dispose();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) { m.geometry.dispose(); (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => x.dispose()); }
      });
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, [dev]);

  if (!dev) {
    return (
      <div className="view3d device-empty">
        <div className="device-empty-card">
          <div className="device-empty-icon">🛵</div>
          <h3>Chưa có thiết bị 3D</h3>
          <p>Mô tả thiết bị cho AI, ví dụ: <i>"thiết kế động cơ xe máy điện và dựng chiếc xe 3D"</i>. AI sẽ vẽ mạch và dựng thiết bị; bánh xe, cánh quạt, đèn... chuyển động theo kết quả mô phỏng.</p>
          <button className="btn-primary" onClick={() => loadDocument(FIXTURES.scooter.make())}>Mở mẫu xe máy điện</button>
        </div>
      </div>
    );
  }

  return (
    <div className="view3d device-view">
      <div ref={host} className="view3d-host" />
      <div className="device-panel">
        <div className="device-title">{dev.name}</div>
        {dev.description && <div className="device-desc">{dev.description}</div>}
        <div className="device-status">{status}</div>
        {kmh !== null && <div className="device-speed"><b>{kmh.toFixed(0)}</b> km/h</div>}
        {readouts.map((r) => (
          <div key={r.name} className="device-readout">
            <span>{r.name}</span><span>{r.text}</span>
            <i style={{ width: `${Math.round(r.level * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className="view3d-hud">
        <span className="tag3d">Thiết bị · {dev.parts.length} khối{picked ? ` · ${picked}` : ''}</span>
        <button onClick={() => window.dispatchEvent(new Event('netlist:fitdevice'))} title="Vừa khung">⤢</button>
      </div>
      <div className="view3d-help">Kéo: xoay · Lăn: zoom · Bấm vào khối để xem tên · Chạy ▶ / ⚡ để thiết bị hoạt động</div>
    </div>
  );
}
