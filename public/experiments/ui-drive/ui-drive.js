/* Витрина «3D-дорога» — three.js (вендорен, importmap в index.html).
   Диорама: плита-подиум, дорога-«гребёнка» (вертикальный ствол справа +
   три горизонтальных ответвления), объёмная вывеска, машинка на примитивах.
   Разделы сайта — три полосы между дорогами: клик → подсветка → машинка
   едет по графу дорог к разделу (разворот «как танк» при смене направления).
   Рендер: rAF только пока сцена на экране (машинка вибрирует постоянно),
   DPR-кап 2, пауза в скрытой вкладке; prefers-reduced-motion — статика
   и телепорт вместо поездки. Сервер не участвует. */

import * as THREE from 'three';

/* ---------- константы поля ---------- */

const HALF_X = 11.3;           // плита: x ∈ [-11.3, 11.3]
const HALF_Z = 5.7;            // z ∈ [-5.7, 5.7]
const ROAD_Z = [-2.6, 0.5, 3.6]; // три горизонтальные дороги
const TRUNK_X = 4.6;           // вертикальный ствол, смещён вправо
const TRUNK_Z = 5.5;           // ствол почти через всё поле
const BRANCH_X0 = -10.4;       // ответвления до почти левого края
const ANCHOR_DX = 0.85;        // машинка паркуется чуть внутрь от конца дороги

const ANCHORS = ROAD_Z.map((z) => ({ x: BRANCH_X0 + ANCHOR_DX, z }));
// полосы-разделы между дорогами (кликабельные зоны 3D)
const BANDS = [
  { z0: -HALF_Z, z1: ROAD_Z[0] - 0.4 },
  { z0: ROAD_Z[0] + 0.4, z1: ROAD_Z[1] - 0.4 },
  { z0: ROAD_Z[1] + 0.4, z1: ROAD_Z[2] - 0.4 },
];
// панели зигзагом, чтобы не наезжали друг на друга и на парковки слева
const PANEL_X = [[-6.6, -3.0], [-2.6, 1.0], [-6.6, -3.0]];

const V_CRUISE = 3.3;  // путь между соседними разделами ≈ 10 с, «не молниеносно»
const V_CORNER = 1.35;
const ACCEL = 3.4;
const DECEL = 3.0;
const TANK_TIME = 0.9; // разворот на месте

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- рендерер, сцена, камера ---------- */

const stage = document.getElementById('ud-stage');
const canvas = document.getElementById('ud-canvas');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf3f5fa);

const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 120);
const CAM_DIR = new THREE.Vector3(0, 0.75, 0.66).normalize(); // наклон диорамы
let camDist = 16;
const camLook = new THREE.Vector3(0, 0, 0.15);
const parallax = { x: 0, y: 0, tx: 0, ty: 0 };

function fitCamera() {
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // узкий экран: показываем всё поле целиком (мелко, но машина и дороги видны)
  const halfSpan = camera.aspect < 1 ? 11.3 : 11.9;
  const hFov = 2 * Math.atan(Math.tan((camera.fov * Math.PI) / 360) * camera.aspect);
  camDist = halfSpan / Math.tan(hFov / 2) * 1.02;
  camera.updateProjectionMatrix();
}

function placeCamera() {
  camera.position.set(
    parallax.x,
    CAM_DIR.y * camDist + parallax.y,
    CAM_DIR.z * camDist,
  );
  camera.lookAt(camLook);
}

/* ---------- свет ---------- */

const hemi = new THREE.HemisphereLight(0xffffff, 0xbfc8d8, 1.15);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(6, 10, 4);
scene.add(sun);

/* ---------- солнышко: таскается мышью, направленный свет следует ---------- */

const glowTex = canvasTexture(128, 128, (ctx, w, h) => {
  const g = ctx.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
});

const sunGizmo = new THREE.Group();
const sunBall = new THREE.Mesh(
  new THREE.SphereGeometry(0.55, 20, 16),
  new THREE.MeshStandardMaterial({ color: 0xffd23c, emissive: 0xffc93c, emissiveIntensity: 1.1, roughness: 0.4 }),
);
const sunGlow = new THREE.Sprite(
  new THREE.SpriteMaterial({ map: glowTex, color: 0xffd23c, transparent: true, opacity: 0.5, depthWrite: false }),
);
sunGlow.scale.set(3.6, 3.6, 1);
sunGizmo.add(sunBall, sunGlow);
sunGizmo.position.set(5.0, 3.6, -4.2); // ниже кромки шапки, чтобы за него хваталась мышь
scene.add(sunGizmo);

/* ---------- дождь: 1800 капель одним LineSegments (1 draw call) ---------- */

const RAIN_N = 1800;
const RAIN_AREA = { x: 13.5, z: 7.5, top: 13 };
const rainPos = new Float32Array(RAIN_N * 6); // две вершины на каплю-штрих
const rainSpeed = new Float32Array(RAIN_N);
function seedDrop(i) {
  const x = (Math.random() * 2 - 1) * RAIN_AREA.x;
  const z = (Math.random() * 2 - 1) * RAIN_AREA.z;
  const y = Math.random() * RAIN_AREA.top;
  const o = i * 6;
  rainPos[o] = x; rainPos[o + 1] = y + 0.26; rainPos[o + 2] = z;
  rainPos[o + 3] = x + 0.06; rainPos[o + 4] = y; rainPos[o + 5] = z; // лёгкий наклон «ветра»
  rainSpeed[i] = 9 + Math.random() * 5;
}
for (let i = 0; i < RAIN_N; i++) seedDrop(i);
const rainGeo = new THREE.BufferGeometry();
rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
const rainMat = new THREE.LineBasicMaterial({ color: 0x8fb0d8, transparent: true, opacity: 0 });
const rain = new THREE.LineSegments(rainGeo, rainMat);
rain.visible = false;
scene.add(rain);

const DRY_BG = new THREE.Color(0xf3f5fa);
const WET_BG = new THREE.Color(0xbcc8dc);
let rainTarget = 0;
let rainLevel = 0;

/* ---------- вспомогательные текстуры ---------- */

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const concreteTex = canvasTexture(512, 512, (ctx, w, h) => {
  ctx.fillStyle = '#e6eaf1';
  ctx.fillRect(0, 0, w, h);
  // лёгкий шум
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = 'rgba(24,32,46,' + (Math.random() * 0.035) + ')';
    ctx.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5);
  }
  // швы плит
  ctx.strokeStyle = 'rgba(24,32,46,0.09)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 0.5); ctx.lineTo(w, 0.5);
  ctx.moveTo(0.5, 0); ctx.lineTo(0.5, h);
  ctx.stroke();
});
concreteTex.wrapS = concreteTex.wrapT = THREE.RepeatWrapping;
concreteTex.repeat.set(5, 2.6);

const shadowTex = canvasTexture(128, 128, (ctx, w, h) => {
  const g = ctx.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w / 2);
  g.addColorStop(0, 'rgba(15,20,32,0.55)');
  g.addColorStop(1, 'rgba(15,20,32,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
});

function flatShadow(sx, sz, opacity, x, z) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(sx, sz),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, opacity, depthWrite: false }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, 0.058, z);
  scene.add(m);
}

/* ---------- поле: плита, дороги, разметка, площадки ---------- */

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(HALF_X * 2, HALF_Z * 2),
  new THREE.MeshStandardMaterial({ map: concreteTex, roughness: 0.95 }),
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const plinth = new THREE.Mesh(
  new THREE.BoxGeometry(HALF_X * 2, 0.4, HALF_Z * 2),
  new THREE.MeshStandardMaterial({ color: 0xc7cfdb, roughness: 0.9 }),
);
plinth.position.y = -0.201;
scene.add(plinth);

const asphaltMat = new THREE.MeshStandardMaterial({ color: 0x2c3342, roughness: 0.85 });

for (const z of ROAD_Z) {
  const road = new THREE.Mesh(new THREE.BoxGeometry(TRUNK_X - BRANCH_X0, 0.05, 0.72), asphaltMat);
  road.position.set((TRUNK_X + BRANCH_X0) / 2, 0.02, z);
  scene.add(road);
}

const trunk = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.05, TRUNK_Z * 2), asphaltMat);
trunk.position.set(TRUNK_X, 0.02, 0);
scene.add(trunk);

// пунктирная разметка
const dashMat = new THREE.MeshBasicMaterial({ color: 0xeef2f8 });
function addDash(x, z) {
  const d = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.012, 0.05), dashMat);
  d.position.set(x, 0.052, z);
  scene.add(d);
}
for (const z of ROAD_Z) {
  for (let x = BRANCH_X0 + 1.6; x < TRUNK_X - 0.9; x += 0.85) addDash(x, z);
}
for (let z = -TRUNK_Z + 1.0; z < TRUNK_Z - 0.8; z += 0.85) {
  if (ROAD_Z.every((rz) => Math.abs(z - rz) > 0.75)) addDash(TRUNK_X, z);
}

// парковочные площадки у левых концов дорог + кольца-маячки
const padMat = new THREE.MeshStandardMaterial({ color: 0xd4dbe6, roughness: 0.9 });
const beacons = [];
ANCHORS.forEach((a, i) => {
  const pad = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.012, 1.0), padMat);
  pad.position.set(a.x, 0.048, a.z);
  scene.add(pad);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.014, 0.05), dashMat);
    c.position.set(a.x + sx * 0.68, 0.056, a.z + sz * 0.42);
    scene.add(c);
  }
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.34, 0.46, 40),
    new THREE.MeshBasicMaterial({ color: 0x2e62e8, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(a.x, 0.06, a.z);
  scene.add(ring);
  beacons.push(ring);
});

// кликабельные полосы-разделы (прозрачные плоскости над полем, до ствола)
const BAND_W = HALF_X + TRUNK_X + 0.4;
const bandMeshes = BANDS.map((b) => {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(BAND_W, b.z1 - b.z0),
    new THREE.MeshBasicMaterial({ color: 0x2e62e8, transparent: true, opacity: 0, depthWrite: false }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.set((TRUNK_X + 0.4 - HALF_X) / 2, 0.065, (b.z0 + b.z1) / 2);
  m.userData.band = true;
  scene.add(m);
  return m;
});

// пара деревьев для масштаба
function tree(x, z) {
  const g = new THREE.Group();
  const trunkT = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.35), new THREE.MeshStandardMaterial({ color: 0x6b5138 }));
  trunkT.position.y = 0.17;
  const crown = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.35, 7), new THREE.MeshStandardMaterial({ color: 0x2f8f7a, roughness: 0.9 }));
  crown.position.y = 0.95;
  g.add(trunkT, crown);
  g.position.set(x, 0, z);
  scene.add(g);
  flatShadow(1.0, 1.0, 0.3, x, z);
}
tree(-10.7, -5.1);
tree(10.6, 4.9);

/* ---------- вывеска «ГАРАЖ 46» ---------- */

const signCanvas = document.createElement('canvas');
signCanvas.width = 1024;
signCanvas.height = 320;
function drawSign() {
  const ctx = signCanvas.getContext('2d');
  ctx.clearRect(0, 0, 1024, 320);
  ctx.fillStyle = '#16202f';
  ctx.fillRect(0, 0, 1024, 320);
  ctx.strokeStyle = '#33425c';
  ctx.lineWidth = 14;
  ctx.strokeRect(10, 10, 1004, 300);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 118px Montserrat, sans-serif';
  ctx.fillText('ГАРАЖ', 330, 130);
  ctx.fillStyle = '#ff6b3d';
  ctx.fillText('46', 700, 130);
  ctx.fillStyle = '#9fb0c8';
  ctx.font = '700 44px Montserrat, sans-serif';
  ctx.fillText('А В Т О С Е Р В И С   ·   К У Р С К', 512, 246);
}
drawSign();
const signTex = new THREE.CanvasTexture(signCanvas);
signTex.colorSpace = THREE.SRGBColorSpace;
document.fonts.load('800 118px Montserrat').then(() => {
  drawSign();
  signTex.needsUpdate = true;
});

const sign = new THREE.Group();
const boardFace = new THREE.MeshStandardMaterial({
  map: signTex, emissiveMap: signTex, emissive: 0xffffff, emissiveIntensity: 0.38, roughness: 0.6,
});
const boardEdge = new THREE.MeshStandardMaterial({ color: 0x111a28, roughness: 0.7 });
const board = new THREE.Mesh(new THREE.BoxGeometry(3.7, 1.16, 0.14), [boardEdge, boardEdge, boardEdge, boardEdge, boardFace, boardEdge]);
board.position.y = 2.1;
const poleMat = new THREE.MeshStandardMaterial({ color: 0x39445a, roughness: 0.6, metalness: 0.4 });
for (const px of [-1.4, 1.4]) {
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 2.1, 12), poleMat);
  pole.position.set(px, 1.05, 0);
  sign.add(pole);
}
sign.add(board);
sign.position.set(8.2, 0, -4.7);
sign.rotation.y = -0.16;
scene.add(sign);
flatShadow(4.4, 1.6, 0.28, 8.2, -4.7);

/* ---------- машинка ---------- */

const car = new THREE.Group();
const bodyGroup = new THREE.Group(); // вибрирует, как заведённая
const paint = new THREE.MeshStandardMaterial({ color: 0xff6b3d, roughness: 0.4, metalness: 0.15 });
const dark = new THREE.MeshStandardMaterial({ color: 0x1c2432, roughness: 0.5 });

const body = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.26, 0.54), paint);
body.position.y = 0.31;
const hood = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.5), paint);
hood.position.set(0.42, 0.42, 0);
const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.24, 0.48), dark);
cabin.position.set(-0.08, 0.55, 0);
for (const lx of [0.57, 0.57]) for (const lz of [-0.17, 0.17]) {
  const light = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.09),
    new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xffe9a8, emissiveIntensity: 0.9 }));
  light.position.set(lx, 0.4, lz);
  bodyGroup.add(light);
}
for (const lz of [-0.2, 0.2]) {
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.08),
    new THREE.MeshStandardMaterial({ color: 0x7a1616, emissive: 0xd23b3b, emissiveIntensity: 0.5 }));
  tail.position.set(-0.57, 0.38, lz);
  bodyGroup.add(tail);
}
bodyGroup.add(body, hood, cabin);
car.add(bodyGroup);

const wheelGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.1, 18);
wheelGeo.rotateX(Math.PI / 2); // ось колеса — поперёк (Z), нос машинки — +X
const wheels = [];
for (const wx of [0.36, -0.36]) for (const wz of [0.3, -0.3]) {
  const wg = new THREE.Group();
  const tire = new THREE.Mesh(wheelGeo, new THREE.MeshStandardMaterial({ color: 0x14181f, roughness: 0.9 }));
  const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.2, 0.06),
    new THREE.MeshStandardMaterial({ color: 0x8b96a8, roughness: 0.6 }));
  wg.add(tire, spoke);
  wg.position.set(wx, 0.14, wz);
  car.add(wg);
  wheels.push(wg);
}

car.position.set(ANCHORS[0].x, 0, ANCHORS[0].z);
scene.add(car);
flatShadow(1.7, 1.1, 0.34, ANCHORS[0].x, ANCHORS[0].z);
const carShadow = scene.children[scene.children.length - 1];

/* ---------- граф дорог: маршрутизация ---------- */

const SEGMENTS = [
  ...ROAD_Z.map((z) => ({ ax: BRANCH_X0, az: z, bx: TRUNK_X, bz: z, branch: true, idx: ROAD_Z.indexOf(z) })),
  { ax: TRUNK_X, az: -TRUNK_Z, bx: TRUNK_X, bz: TRUNK_Z, branch: false, idx: -1 },
];

function projectOnSegments(p) {
  let best = null;
  for (const s of SEGMENTS) {
    const dx = s.bx - s.ax, dz = s.bz - s.az;
    const len2 = dx * dx + dz * dz;
    const t = Math.max(0, Math.min(1, ((p.x - s.ax) * dx + (p.z - s.az) * dz) / len2));
    const qx = s.ax + dx * t, qz = s.az + dz * t;
    const d = (p.x - qx) ** 2 + (p.z - qz) ** 2;
    if (!best || d < best.d) best = { s, t, d, q: { x: qx, z: qz } };
  }
  return best;
}

// путь от текущей позиции до раздела i: список промежуточных точек по графу
function routeWaypoints(p, targetIdx) {
  const { s, t } = projectOnSegments(p);
  const wps = [];
  if (s.branch && s.idx === targetIdx) {
    wps.push(ANCHORS[targetIdx]);
  } else if (!s.branch) {
    wps.push({ x: TRUNK_X, z: ROAD_Z[targetIdx] }, ANCHORS[targetIdx]);
  } else {
    wps.push({ x: TRUNK_X, z: ROAD_Z[s.idx] }, { x: TRUNK_X, z: ROAD_Z[targetIdx] }, ANCHORS[targetIdx]);
  }
  return wps;
}

// скругление внутренних углов маршрута четверть-безье
function buildPath(p0, wps) {
  const pts = [{ x: p0.x, z: p0.z }, ...wps];
  const out = [pts[0]];
  for (let k = 1; k < pts.length - 1; k++) {
    const vIn = norm2(pts[k].x - pts[k - 1].x, pts[k].z - pts[k - 1].z);
    const vOut = norm2(pts[k + 1].x - pts[k].x, pts[k + 1].z - pts[k].z);
    const r = Math.min(0.6,
      dist2(pts[k - 1], pts[k]) * 0.42,
      dist2(pts[k], pts[k + 1]) * 0.42);
    const entry = { x: pts[k].x - vIn.x * r, z: pts[k].z - vIn.z * r };
    const exit = { x: pts[k].x + vOut.x * r, z: pts[k].z + vOut.z * r };
    out.push(entry);
    for (let j = 1; j <= 8; j++) {
      const u = j / 8, iu = 1 - u;
      out.push({
        x: iu * iu * entry.x + 2 * iu * u * pts[k].x + u * u * exit.x,
        z: iu * iu * entry.z + 2 * iu * u * pts[k].z + u * u * exit.z,
      });
    }
  }
  out.push(pts[pts.length - 1]);
  const lens = [0];
  for (let k = 1; k < out.length; k++) lens.push(lens[k - 1] + dist2(out[k - 1], out[k]));
  return { pts: out, lens, total: lens[lens.length - 1] };
}

function norm2(x, z) { const l = Math.hypot(x, z) || 1; return { x: x / l, z: z / l }; }
function dist2(a, b) { return Math.hypot(b.x - a.x, b.z - a.z); }
function wrapPi(a) { return Math.atan2(Math.sin(a), Math.cos(a)); }

/* ---------- контроллер движения ---------- */

const carState = {
  yaw: 0,                 // нос вдоль +X (направо)
  v: 0,
  mode: 'idle',           // idle | drive | turn
  path: null,
  s: 0,
  turnT: 0,
  turnFrom: 0,
  target: 0,
  section: 0,             // у какого раздела стоит
};

function yawVec() { return { x: Math.cos(carState.yaw), z: -Math.sin(carState.yaw) }; }

function driveTo(targetIdx) {
  carState.target = targetIdx;
  if (reduceMotion) {
    carState.section = targetIdx;
    carState.mode = 'idle';
    car.position.set(ANCHORS[targetIdx].x, 0, ANCHORS[targetIdx].z);
    carShadow.position.set(car.position.x, 0.058, car.position.z);
    syncPanels();
    renderOnce();
    return;
  }
  const p = { x: car.position.x, z: car.position.z };
  const wps = routeWaypoints(p, targetIdx);
  const first = wps[0];
  const d = dist2(p, first);
  const dir = norm2(first.x - p.x, first.z - p.z);
  const yv = yawVec();
  if (d > 0.25 && dir.x * yv.x + dir.z * yv.z < -0.3) {
    // цель сзади: разворот «как танк» на месте, потом поездка
    carState.mode = 'turn';
    carState.v = 0;
    carState.turnT = 0;
    carState.turnFrom = carState.yaw;
  } else {
    carState.mode = 'drive';
    carState.path = buildPath(p, wps);
    carState.s = 0;
  }
  syncPanels();
}

function update(dt, time) {
  // маячки и подсветка полос
  beacons.forEach((r, i) => {
    const active = i === carState.target;
    const target = active ? 0.75 + 0.25 * Math.sin(time * 3.6) : 0.22;
    r.material.opacity += (target - r.material.opacity) * Math.min(1, dt * 6);
    const sc = active ? 1 + 0.1 * Math.sin(time * 3.6) : 1;
    r.scale.set(sc, sc, 1);
  });
  bandMeshes.forEach((m, i) => {
    const target = i === carState.target ? 0.055 : (i === hoverBand ? 0.03 : 0);
    m.material.opacity += (target - m.material.opacity) * Math.min(1, dt * 7);
  });

  if (carState.mode === 'turn') {
    carState.turnT += dt / TANK_TIME;
    const u = Math.min(1, carState.turnT);
    const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
    carState.yaw = carState.turnFrom + Math.PI * e;
    if (u >= 1) {
      carState.yaw = wrapPi(carState.turnFrom + Math.PI);
      driveTo(carState.target); // теперь маршрут без разворота
    }
  } else if (carState.mode === 'drive') {
    const { pts, lens, total } = carState.path;
    // ограничения скорости: перед углами и в конце
    let targetV = V_CRUISE;
    for (let k = 0; k < pts.length; k++) {
      const isEnd = k === pts.length - 1;
      const corner = !isEnd && k > 0 && k < pts.length - 1 &&
        k % 9 === 1 && lens[k] > carState.s; // точки излома после безье
      if (corner) {
        targetV = Math.min(targetV, Math.sqrt(V_CORNER * V_CORNER + 2 * DECEL * Math.max(0, lens[k] - carState.s)));
      }
      if (isEnd) {
        targetV = Math.min(targetV, Math.sqrt(2 * DECEL * Math.max(0, total - carState.s)));
      }
    }
    carState.v += Math.max(-DECEL * dt * 1.25, Math.min(ACCEL * dt, targetV - carState.v));
    carState.s = Math.min(total, carState.s + carState.v * dt);
    // позиция по дуге
    let k = 1;
    while (k < lens.length - 1 && lens[k] < carState.s) k++;
    const segLen = lens[k] - lens[k - 1] || 1;
    const u = (carState.s - lens[k - 1]) / segLen;
    car.position.x = pts[k - 1].x + (pts[k].x - pts[k - 1].x) * u;
    car.position.z = pts[k - 1].z + (pts[k].z - pts[k - 1].z) * u;
    const ahead = pts[Math.min(k + 1, pts.length - 1)];
    const tangent = norm2(ahead.x - car.position.x, ahead.z - car.position.z);
    if (carState.v > 0.05) {
      const yawTarget = Math.atan2(-tangent.z, tangent.x);
      carState.yaw += wrapPi(yawTarget - carState.yaw) * Math.min(1, dt * 8);
    }
    wheels.forEach((w) => { w.rotation.z += (carState.v * dt) / 0.14; });
    if (carState.s >= total - 0.002 && carState.v < 0.05) {
      carState.mode = 'idle';
      carState.section = carState.target;
      syncPanels();
    }
  }

  car.rotation.y = carState.yaw;
  carShadow.position.set(car.position.x, 0.058, car.position.z);

  // вибрация заведённого двигателя
  if (!reduceMotion) {
    const amp = carState.mode === 'drive' ? 0.0022 : 0.0038;
    bodyGroup.position.y = (Math.sin(time * 43) + Math.sin(time * 29 + 1.3)) * amp;
    bodyGroup.rotation.z = Math.sin(time * 37 + 0.6) * amp * 1.2;
    bodyGroup.rotation.x = Math.sin(time * 31 + 2.1) * amp;
  }
  // лёгкое покачивание вывески
  if (!reduceMotion) sign.rotation.z = Math.sin(time * 0.7) * 0.008;

  // параллакс камеры
  parallax.x += (parallax.tx - parallax.x) * Math.min(1, dt * 3);
  parallax.y += (parallax.ty - parallax.y) * Math.min(1, dt * 3);
  placeCamera();

  // погода: уровень дождя плавно едет к цели, фон и свет приглушаются
  rainLevel += (rainTarget - rainLevel) * Math.min(1, dt * 2);
  rain.visible = rainLevel > 0.02;
  if (rain.visible) {
    for (let i = 0; i < RAIN_N; i++) {
      const o = i * 6;
      let y = rainPos[o + 4] - rainSpeed[i] * dt;
      if (y < 0.05) {
        y = RAIN_AREA.top * (0.85 + Math.random() * 0.15);
        const x = (Math.random() * 2 - 1) * RAIN_AREA.x;
        const z = (Math.random() * 2 - 1) * RAIN_AREA.z;
        rainPos[o] = x; rainPos[o + 2] = z;
        rainPos[o + 3] = x + 0.06; rainPos[o + 5] = z;
      }
      rainPos[o + 1] = y + 0.26;
      rainPos[o + 4] = y;
    }
    rainGeo.attributes.position.needsUpdate = true;
  }
  rainMat.opacity = 0.45 * rainLevel;
  scene.background.copy(DRY_BG).lerp(WET_BG, rainLevel);
  sun.intensity = 1.5 - 0.85 * rainLevel;
  hemi.intensity = 1.15 - 0.3 * rainLevel;

  // солнце пульсирует и прячется в дождь
  const pulse = 1 + Math.sin(time * 2.6) * 0.04;
  sunBall.scale.set(pulse, pulse, pulse);
  sunGlow.material.opacity = (0.4 + 0.12 * Math.sin(time * 2.6)) * (1 - rainLevel * 0.9);
  sunBall.material.emissiveIntensity = 1.1 * (1 - rainLevel * 0.8);
}

/* ---------- разделы: подсветка и клики ---------- */

const panels = [0, 1, 2].map((i) => document.getElementById('ud-panel-' + i));

function syncPanels() {
  panels.forEach((el, i) => {
    el.classList.toggle('is-active', i === carState.target);
    const here = el.querySelector('.ud-panel__here');
    here.hidden = !(i === carState.section && carState.mode === 'idle');
  });
}

panels.forEach((el) => {
  el.addEventListener('click', () => {
    const i = Number(el.dataset.section);
    if (i === carState.target && carState.mode !== 'idle') return;
    if (i === carState.section && carState.mode === 'idle') { syncPanels(); return; }
    carState.target = i;
    syncPanels();
    driveTo(i);
  });
});

let hoverBand = -1;
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function bandAt(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(bandMeshes, false)[0];
  return hit ? bandMeshes.indexOf(hit.object) : -1;
}

function sunAt(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  return raycaster.intersectObject(sunBall, false).length > 0;
}

// точка на «земле» под курсором (для перетаскивания солнца)
function groundPoint(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const o = raycaster.ray.origin, d = raycaster.ray.direction;
  if (d.y >= -1e-4) return null;
  const p = o.clone().addScaledVector(d, -o.y / d.y);
  if (Math.abs(p.x) > 12.5 || Math.abs(p.z) > 7.5) return null;
  return p;
}

let sunDrag = false;

canvas.addEventListener('pointermove', (e) => {
  if (sunDrag) {
    const p = groundPoint(e.clientX, e.clientY);
    if (p) {
      sunGizmo.position.set(p.x, 3.6, p.z);
      sun.position.set(p.x * 1.4, 11, p.z * 1.4);
    }
    return;
  }
  hoverBand = bandAt(e.clientX, e.clientY);
  const overSun = sunAt(e.clientX, e.clientY);
  canvas.style.cursor = overSun ? 'grab' : hoverBand >= 0 ? 'pointer' : 'default';
  if (!reduceMotion) {
    const rect = stage.getBoundingClientRect();
    parallax.tx = ((e.clientX - rect.left) / rect.width - 0.5) * 0.9;
    parallax.ty = -((e.clientY - rect.top) / rect.height - 0.5) * 0.4;
  }
});

canvas.addEventListener('pointerdown', (e) => {
  if (e.button === 0 && sunAt(e.clientX, e.clientY)) {
    sunDrag = true;
    canvas.style.cursor = 'grabbing';
    return;
  }
  const b = bandAt(e.clientX, e.clientY);
  if (b < 0) return;
  if (b === carState.target && carState.mode !== 'idle') return;
  if (b === carState.section && carState.mode === 'idle') return;
  carState.target = b;
  syncPanels();
  driveTo(b);
});

window.addEventListener('pointerup', () => {
  if (sunDrag) {
    sunDrag = false;
    canvas.style.cursor = 'default';
  }
});

/* ---------- переключатель дождя ---------- */

const rainBtn = document.getElementById('ud-rain');
rainBtn.addEventListener('click', () => {
  rainTarget = rainTarget ? 0 : 1;
  rainBtn.classList.toggle('is-on', !!rainTarget);
  rainBtn.setAttribute('aria-pressed', String(!!rainTarget));
});

/* ---------- форма заявки (демо) ---------- */

const form = document.getElementById('ud-form');
const note = document.getElementById('ud-note');
form.addEventListener('submit', (e) => {
  e.preventDefault();
  note.hidden = false;
  form.reset();
});

/* ---------- компоновка панелей: проекция полос на экран ---------- */

function worldToScreen(v3) {
  // matrixWorldInverse живёт только после updateMatrixWorld/render:
  // без этого при чистом F5 панели считаются от «пустой» камеры и улетают
  camera.updateMatrixWorld();
  const rect = canvas.getBoundingClientRect();
  const v = v3.clone().project(camera);
  return { x: (v.x + 1) / 2 * rect.width, y: (1 - v.y) / 2 * rect.height };
}

function layoutPanels() {
  fitCamera();
  placeCamera(); // без этого проекция считается от камеры в origin
  const compact = window.matchMedia('(max-width: 760px)').matches;
  panels.forEach((el) => {
    if (compact) {
      el.style.left = el.style.top = el.style.width = '';
      return;
    }
    const b = BANDS[Number(el.dataset.section)];
    const xr = PANEL_X[Number(el.dataset.section)];
    const tl = worldToScreen(new THREE.Vector3(xr[0], 0, b.z0));
    const br = worldToScreen(new THREE.Vector3(xr[1], 0, b.z1));
    el.style.left = tl.x + 'px';
    el.style.top = tl.y + 'px';
    el.style.width = Math.min(380, br.x - tl.x) + 'px';
    el.style.height = '';
  });
}

window.addEventListener('resize', layoutPanels);

/* ---------- цикл: rAF только пока сцена видима ---------- */

let visible = true;
let rafId = null;
let last = performance.now();
let time = 0;
let firstFrame = true;

function frame(now) {
  rafId = null;
  if (!visible || document.hidden) return;
  // кап 0.25: при 60 fps это не играет роли, а при троттлинге rAF фоновой
  // вкладкой симуляция догоняет реальное время, а не превращается в слоу-мо
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  time += dt;
  update(dt, time);
  renderer.render(scene, camera);
  if (firstFrame) {
    // после первого настоящего рендера пересчитать панели — страховка
    // от расчёта позиций до инициализации камеры
    firstFrame = false;
    layoutPanels();
  }
  rafId = requestAnimationFrame(frame);
}

function play() {
  if (rafId === null && visible && !document.hidden && !reduceMotion) {
    last = performance.now();
    rafId = requestAnimationFrame(frame);
  }
}

function pause() {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

function renderOnce() {
  placeCamera();
  renderer.render(scene, camera);
}

if ('IntersectionObserver' in window) {
  new IntersectionObserver((entries) => {
    visible = entries[0].isIntersecting;
    if (visible) play(); else pause();
  }, { threshold: 0.02 }).observe(canvas);
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pause(); else play();
});

/* ---------- старт ---------- */

fitCamera();
layoutPanels();
syncPanels();
if (reduceMotion) renderOnce(); else play();

// отладочный доступ для проверок: window.__ud.select(1), window.__ud.state()
window.__ud = {
  select: (i) => {
    carState.target = i;
    syncPanels();
    driveTo(i);
  },
  state: () => ({
    mode: carState.mode,
    section: carState.section,
    target: carState.target,
    x: +car.position.x.toFixed(2),
    z: +car.position.z.toFixed(2),
    v: +carState.v.toFixed(2),
    rain: +rainLevel.toFixed(2),
    sun: { x: +sunGizmo.position.x.toFixed(1), z: +sunGizmo.position.z.toFixed(1) },
  }),
  sunScreen: () => {
    const p = worldToScreen(sunGizmo.position.clone());
    const rect = canvas.getBoundingClientRect();
    return { x: Math.round(rect.left + p.x), y: Math.round(rect.top + p.y) };
  },
};
