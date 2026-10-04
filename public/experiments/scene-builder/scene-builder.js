/* 3D-конструктор сцены: единое 3D-полотно-сетка 24×16, слева палитра.
   Клик — поставить элемент, ПКМ — стереть, ЛКМ-драг — вращение камеры,
   колесо — зум. Плитка «поворот» сама ориентируется на соседние дороги.
   Рендер: rAF с паузой вне экрана и в скрытой вкладке. */

import * as THREE from 'three';

/* ---------- поле ---------- */

const W = 24, H = 16;            // клетки
const HALF_W = W / 2, HALF_H = H / 2;
const gx2wx = (gx) => gx - HALF_W + 0.5;
const gz2wz = (gz) => gz - HALF_H + 0.5;

const grid = new Array(W * H).fill(null); // {type, part?, rot?}
const idx = (x, z) => z * W + x;
const inField = (x, z) => x >= 0 && x < W && z >= 0 && z < H;
const cellAt = (x, z) => (inField(x, z) ? grid[idx(x, z)] : null);
const isRoad = (c) => c && (c.type === 'road-h' || c.type === 'road-v' || c.type === 'turn');

/* ---------- сцена ---------- */

const stage = document.getElementById('sb-stage');
const canvas = document.getElementById('sb-canvas');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xe9eef7);

const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
const camState = { yaw: -0.6, pitch: 0.62, dist: 22 };
const camGoal = { ...camState };
const TARGET = new THREE.Vector3(0, 0, 0);

scene.add(new THREE.HemisphereLight(0xffffff, 0xb9c4d6, 1.05));
const sunLight = new THREE.DirectionalLight(0xfff4e0, 1.6);
sunLight.position.set(-8, 10, -6);
scene.add(sunLight);

/* ---------- текстуры ---------- */

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const grassTex = canvasTexture(768, 512, (ctx, w, h) => {
  ctx.fillStyle = '#a9d18e';
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(40,80,40,0.06)';
    ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }
  // сетка клеток 32px = 1 клетка мира
  ctx.strokeStyle = 'rgba(24,32,46,0.14)';
  ctx.lineWidth = 1.5;
  for (let x = 0; x <= w; x += 32) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  for (let y = 0; y <= h; y += 32) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
});

const shadowTex = canvasTexture(128, 128, (ctx, w, h) => {
  const g = ctx.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w / 2);
  g.addColorStop(0, 'rgba(15,20,32,0.4)');
  g.addColorStop(1, 'rgba(15,20,32,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
});

/* ---------- земля, подиум ---------- */

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(W, H),
  new THREE.MeshStandardMaterial({ map: grassTex, roughness: 0.95 }),
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const plinth = new THREE.Mesh(
  new THREE.BoxGeometry(W + 0.4, 0.5, H + 0.4),
  new THREE.MeshStandardMaterial({ color: 0xc7cfdb, roughness: 0.9 }),
);
plinth.position.y = -0.251;
scene.add(plinth);

// плоскость для рейкаста (клики идут «сквозь» объекты в клетку)
const pickPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(W, H),
  new THREE.MeshBasicMaterial({ visible: false }),
);
pickPlane.rotation.x = -Math.PI / 2;
scene.add(pickPlane);

/* ---------- материалы-константы ---------- */

const M = {
  asphalt: new THREE.MeshStandardMaterial({ color: 0x2c3342, roughness: 0.85 }),
  paint: new THREE.MeshBasicMaterial({ color: 0xf2f5fa }),
  trunk: new THREE.MeshStandardMaterial({ color: 0x6b5138, roughness: 0.9 }),
  crown: new THREE.MeshStandardMaterial({ color: 0x2f8f6e, roughness: 0.85 }),
  crown2: new THREE.MeshStandardMaterial({ color: 0x3aa87e, roughness: 0.85 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 0.8 }),
  wall: new THREE.MeshStandardMaterial({ color: 0xf6e7c8, roughness: 0.85 }),
  roof: new THREE.MeshStandardMaterial({ color: 0xd6604a, roughness: 0.8 }),
  door: new THREE.MeshStandardMaterial({ color: 0x2e62e8, roughness: 0.6 }),
  sign: new THREE.MeshStandardMaterial({ color: 0xff6b3d, emissive: 0xff6b3d, emissiveIntensity: 0.35 }),
  sun: new THREE.MeshStandardMaterial({ color: 0xffd23c, emissive: 0xffc93c, emissiveIntensity: 1.2 }),
};

function fakeShadow(sx, sz, opacity, group) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(sx, sz),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, opacity, depthWrite: false }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.02;
  group.add(m);
}

/* ---------- фабрики объектов ---------- */

function makeTree() {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 0.4, 8), M.trunk);
  trunk.position.y = 0.2;
  const crown = new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 12), M.crown);
  crown.position.y = 0.85;
  const crown2 = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 10), M.crown2);
  crown2.position.set(0.16, 1.12, 0.1);
  g.add(trunk, crown, crown2);
  fakeShadow(1.1, 1.1, 0.32, g);
  g.userData.sway = crown;
  return g;
}

function roadDashesH(g) { // разметка вдоль x
  for (const dx of [-0.3, 0, 0.3]) {
    const d = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.01, 0.06), M.paint);
    d.position.set(dx, 0.032, 0);
    g.add(d);
  }
}

function roadDashesV(g) {
  for (const dz of [-0.3, 0, 0.3]) {
    const d = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.01, 0.2), M.paint);
    d.position.set(0, 0.032, dz);
    g.add(d);
  }
}

function makeRoadH() {
  const g = new THREE.Group();
  const a = new THREE.Mesh(new THREE.BoxGeometry(1, 0.02, 1), M.asphalt);
  a.position.y = 0.01;
  g.add(a);
  roadDashesH(g);
  return g;
}

function makeRoadV() {
  const g = new THREE.Group();
  const a = new THREE.Mesh(new THREE.BoxGeometry(1, 0.02, 1), M.asphalt);
  a.position.y = 0.01;
  g.add(a);
  roadDashesV(g);
  return g;
}

// дуга-разметка от стороны A к стороне B; контрольная точка — угол клетки
function arcPoints(dirA, dirB) {
  const side = { n: [0, -0.5], e: [0.5, 0], s: [0, 0.5], w: [-0.5, 0] };
  const [ax, az] = side[dirA];
  const [bx, bz] = side[dirB];
  const kx = bx, kz = az;
  const pts = [];
  for (let i = 0; i <= 8; i++) {
    const u = i / 8, iu = 1 - u;
    pts.push([iu * iu * ax + 2 * iu * u * kx + u * u * bx, iu * iu * az + 2 * iu * u * kz + u * u * bz]);
  }
  return pts;
}

function makeTurn(rot) {
  const pairs = { ne: ['n', 'e'], nw: ['n', 'w'], se: ['s', 'e'], sw: ['s', 'w'] };
  const [a, b] = pairs[rot];
  const g = new THREE.Group();
  const a2 = new THREE.Mesh(new THREE.BoxGeometry(1, 0.02, 1), M.asphalt);
  a2.position.y = 0.01;
  g.add(a2);
  const pts = arcPoints(a, b);
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, z1] = pts[i], [x2, z2] = pts[i + 1];
    const len = Math.hypot(x2 - x1, z2 - z1);
    const d = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.01, 0.055), M.paint);
    d.position.set((x1 + x2) / 2, 0.032, (z1 + z2) / 2);
    d.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
    d.scale.x = len / 0.16 * 0.72;
    g.add(d);
  }
  return g;
}

// авто-ориентация поворота по дорожным соседям
function autoTurnRot(x, z) {
  const n = isRoad(cellAt(x, z - 1)), s = isRoad(cellAt(x, z + 1));
  const e = isRoad(cellAt(x + 1, z)), w = isRoad(cellAt(x - 1, z));
  if (n && e) return 'ne';
  if (n && w) return 'nw';
  if (s && e) return 'se';
  if (s && w) return 'sw';
  if (n) return 'ne';
  if (s) return 'se';
  if (w) return 'nw';
  return 'ne';
}

function makeBench() {
  const g = new THREE.Group();
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.05, 0.26), M.wood);
  seat.position.y = 0.22;
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.26, 0.05), M.wood);
  back.position.set(0, 0.36, -0.13);
  for (const lx of [-0.28, 0.28]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.2, 0.22), M.wood);
    leg.position.set(lx, 0.1, 0);
    g.add(leg);
  }
  g.add(seat, back);
  fakeShadow(0.9, 0.6, 0.3, g);
  return g;
}

// магазинчик 2×1: корпус, двускатная крыша, дверь, витрина, вывеска
function makeShop() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.72, 0.94), M.wall);
  body.position.y = 0.36;
  const roofL = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.05, 1.06), M.roof);
  roofL.position.set(-0.42, 0.9, 0);
  roofL.rotation.z = 0.62;
  const roofR = roofL.clone();
  roofR.position.x = 0.42;
  roofR.rotation.z = -0.62;
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.42, 0.03), M.door);
  door.position.set(-0.45, 0.21, 0.48);
  const window1 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.03),
    new THREE.MeshStandardMaterial({ color: 0xbfe0f5, roughness: 0.2, metalness: 0.1 }));
  window1.position.set(0.3, 0.34, 0.48);
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.14, 0.04), M.sign);
  board.position.set(0, 0.6, 0.49);
  g.add(body, roofL, roofR, door, window1, board);
  fakeShadow(2.2, 1.2, 0.3, g);
  return g;
}

function makeSun() {
  const g = new THREE.Group();
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.45, 20, 16), M.sun);
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(2.6, 2.6),
    new THREE.MeshBasicMaterial({ map: shadowTex, color: 0xffd23c, transparent: true, opacity: 0.55, depthWrite: false }),
  );
  glow.userData.isGlow = true;
  g.add(ball, glow);
  g.userData.ball = ball;
  g.userData.glow = glow;
  return g;
}

/* ---------- реестр мешей и операции поля ---------- */

const meshes = new Map(); // key "x,z" -> group
let sunCell = null;

function place(x, z, type) {
  if (!inField(x, z)) return false;
  if (type === 'erase') return erase(x, z);

  if (type === 'shop') {
    // занимает 2 клетки: пробуем вправо, потом влево
    let bx = inField(x + 1, z) && !cellAt(x + 1, z) && !cellAt(x, z) ? x + 1
      : (inField(x - 1, z) && !cellAt(x - 1, z) && !cellAt(x, z) ? x - 1 : null);
    if (bx === null) return false;
    const group = makeShop();
    group.position.set((gx2wx(x) + gx2wx(bx)) / 2, 0, gz2wz(z));
    scene.add(group);
    meshes.set(x + ',' + z, group);
    grid[idx(x, z)] = { type: 'shop', part: 'a' };
    grid[idx(bx, z)] = { type: 'shop', part: 'b' };
    bump();
    return true;
  }

  if (cellAt(x, z)) return false;

  if (type === 'sun') {
    if (sunCell) erase(sunCell.x, sunCell.z);
  }

  const group =
    type === 'tree' ? makeTree() :
    type === 'road-h' ? makeRoadH() :
    type === 'road-v' ? makeRoadV() :
    type === 'turn' ? makeTurn(autoTurnRot(x, z)) :
    type === 'bench' ? makeBench() :
    type === 'sun' ? makeSun() : null;
  if (!group) return false;

  if (type === 'sun') {
    group.position.set(gx2wx(x), 4.6, gz2wz(z));
    sunCell = { x, z };
    sunLight.position.set(gx2wx(x) * 1.2, 10, gz2wz(z) * 1.2);
  } else {
    group.position.set(gx2wx(x), 0, gz2wz(z));
  }
  scene.add(group);
  meshes.set(x + ',' + z, group);
  grid[idx(x, z)] = { type };
  bump();
  return true;
}

function erase(x, z) {
  const c = cellAt(x, z);
  if (!c) return false;
  if (c.type === 'shop') {
    // ищем вторую половину и убираем обе
    for (const dx of [-1, 1]) {
      if (cellAt(x + dx, z)?.type === 'shop') grid[idx(x + dx, z)] = null;
    }
    const g = meshes.get(x + ',' + z) || meshes.get((x + (c.part === 'a' ? 1 : -1)) + ',' + z);
    if (g) { scene.remove(g); meshes.delete(x + ',' + z); }
    grid[idx(x, z)] = null;
    bump();
    return true;
  }
  if (c.type === 'sun') sunCell = null;
  const g = meshes.get(x + ',' + z);
  if (g) { scene.remove(g); meshes.delete(x + ',' + z); }
  grid[idx(x, z)] = null;
  bump();
  return true;
}

function clearAll() {
  for (const g of meshes.values()) scene.remove(g);
  meshes.clear();
  grid.fill(null);
  sunCell = null;
  sunLight.position.set(-8, 10, -6);
  bump();
}

/* ---------- камера: орбита, зум, виды ---------- */

function placeCamera() {
  const { yaw, pitch, dist } = camState;
  camera.position.set(
    TARGET.x + dist * Math.sin(yaw) * Math.cos(pitch),
    TARGET.y + dist * Math.sin(pitch),
    TARGET.z + dist * Math.cos(yaw) * Math.cos(pitch),
  );
  camera.lookAt(TARGET);
}

function fitCamera() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

const VIEWS = {
  persp: { pitch: 0.62, yaw: -0.6, dist: 22 },
  top: { pitch: 1.45, yaw: 0, dist: 26 }, // азимут выравниваем — сетка ровно под курсором
};

function setView(name) {
  const v = VIEWS[name];
  camGoal.pitch = v.pitch;
  camGoal.dist = v.dist;
  if (v.yaw !== undefined) camGoal.yaw = v.yaw;
  document.getElementById('sb-view-persp').classList.toggle('is-active', name === 'persp');
  document.getElementById('sb-view-top').classList.toggle('is-active', name === 'top');
}

/* ---------- ввод: инструменты, рейкаст, мышь ---------- */

let tool = 'tree';
const toolsBox = document.getElementById('sb-tools');
toolsBox.addEventListener('click', (e) => {
  const btn = e.target.closest('.sb-tool');
  if (!btn) return;
  tool = btn.dataset.tool;
  toolsBox.querySelectorAll('.sb-tool').forEach((b) => b.classList.toggle('is-active', b === btn));
});

document.getElementById('sb-view-persp').addEventListener('click', () => setView('persp'));
document.getElementById('sb-view-top').addEventListener('click', () => setView('top'));
document.getElementById('sb-clear').addEventListener('click', clearAll);

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let hoverCell = null;

function cellUnder(cx, cy) {
  const rect = canvas.getBoundingClientRect();
  ndc.x = ((cx - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((cy - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObject(pickPlane, false)[0];
  if (!hit) return null;
  const gx = Math.floor(hit.point.x + HALF_W);
  const gz = Math.floor(hit.point.z + HALF_H);
  return inField(gx, gz) ? { x: gx, z: gz } : null;
}

// рамка-курсор на клетке
const hoverFrame = new THREE.LineLoop(
  new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-0.5, 0.04, -0.5), new THREE.Vector3(0.5, 0.04, -0.5),
    new THREE.Vector3(0.5, 0.04, 0.5), new THREE.Vector3(-0.5, 0.04, 0.5),
  ]),
  new THREE.LineBasicMaterial({ color: 0x2e62e8 }),
);
hoverFrame.visible = false;
scene.add(hoverFrame);

function applyTool(x, z) {
  if (tool === 'erase') return erase(x, z);
  return place(x, z, tool);
}

/* мышь: клик — инструмент, драг — орбита, ПКМ — стереть, колесо — зум */

let drag = null; // { x0, y0, yaw0, pitch0, moved }

canvas.addEventListener('pointerdown', (e) => {
  drag = { x0: e.clientX, y0: e.clientY, yaw0: camGoal.yaw, pitch0: camGoal.pitch, moved: false, button: e.button };
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener('pointermove', (e) => {
  if (drag) {
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    if (Math.hypot(dx, dy) > 6) drag.moved = true;
    if (drag.moved && drag.button === 0) {
      camGoal.yaw = drag.yaw0 + dx * 0.006;
      camGoal.pitch = Math.max(0.12, Math.min(1.5, drag.pitch0 + dy * 0.005));
    }
  } else {
    const c = cellUnder(e.clientX, e.clientY);
    hoverCell = c;
    hoverFrame.visible = !!c;
    if (c) {
      hoverFrame.position.set(gx2wx(c.x), 0, gz2wz(c.z));
      hoverFrame.material.color.set(tool === 'erase' ? 0xd23b3b : 0x2e62e8);
    }
    canvas.style.cursor = c ? 'crosshair' : 'default';
  }
});

canvas.addEventListener('pointerup', (e) => {
  if (!drag) return;
  const wasClick = !drag.moved;
  const rightClick = drag.button === 2;
  drag = null;
  if (!wasClick) return;
  const c = cellUnder(e.clientX, e.clientY);
  if (!c) return;
  if (rightClick) erase(c.x, c.z);
  else applyTool(c.x, c.z);
});

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  camGoal.dist = Math.max(8, Math.min(45, camGoal.dist * (e.deltaY > 0 ? 1.1 : 0.9)));
}, { passive: false });

/* ---------- счётчик, отладка ---------- */

const countEl = document.getElementById('sb-count');
function bump() {
  countEl.textContent = String(meshes.size);
}

/* ---------- цикл ---------- */

let visible = true;
let rafId = null;
let last = performance.now();
let time = 0;

function frame(now) {
  rafId = null;
  if (!visible || document.hidden) return;
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  time += dt;

  // плавная камера
  camState.yaw += (camGoal.yaw - camState.yaw) * Math.min(1, dt * 8);
  camState.pitch += (camGoal.pitch - camState.pitch) * Math.min(1, dt * 8);
  camState.dist += (camGoal.dist - camState.dist) * Math.min(1, dt * 8);
  placeCamera();

  // солнце пульсирует, кроны чуть дышат
  for (const [key, g] of meshes) {
    const c = grid[Number(key.split(',')[1]) * W + Number(key.split(',')[0])];
    if (!c) continue;
    if (c.type === 'sun' && g.userData.ball) {
      const p = 1 + Math.sin(time * 3) * 0.06;
      g.userData.ball.scale.set(p, p, p);
      g.userData.glow.material.opacity = 0.45 + 0.15 * Math.sin(time * 3);
    }
    if (c.type === 'tree' && g.userData.sway) {
      g.userData.sway.rotation.z = Math.sin(time * 1.3 + g.position.x) * 0.03;
    }
  }

  renderer.render(scene, camera);
  rafId = requestAnimationFrame(frame);
}

function play() {
  if (rafId === null && visible && !document.hidden) {
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

if ('IntersectionObserver' in window) {
  new IntersectionObserver((entries) => {
    visible = entries[0].isIntersecting;
    if (visible) play(); else pause();
  }, { threshold: 0.02 }).observe(canvas);
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pause(); else play();
});

window.addEventListener('resize', () => { fitCamera(); placeCamera(); });

/* ---------- старт: демо-рассадка (повороты — после соседей) ---------- */

fitCamera();
placeCamera();
[[6, 4, 'road-h'], [7, 4, 'road-h'], [8, 5, 'road-v'], [8, 6, 'road-v'],
 [5, 6, 'tree'], [4, 3, 'bench'], [10, 5, 'shop'], [13, 2, 'sun'], [3, 10, 'tree'],
 [11, 10, 'road-h'], [12, 10, 'road-h'], [11, 9, 'tree'], [14, 12, 'bench'],
 [8, 4, 'turn'],
].forEach(([x, z, t]) => place(x, z, t));
bump();

// отладочный доступ: window.__sb.place(3,3,'bench'), window.__sb.state()
window.__sb = {
  tool: (t) => { tool = t; },
  place: (x, z, t) => place(x, z, t),
  erase: (x, z) => erase(x, z),
  setView: (v) => setView(v),
  state: () => ({ count: meshes.size, cells: grid.filter(Boolean).length, sun: sunCell, tool }),
};
