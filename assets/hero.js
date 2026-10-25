// Первый экран: 3D-комплекс кортов на закате. Скролл ведёт камеру с высоты
// птичьего полёта за заднюю линию, дальше идёт розыгрыш из четырёх ударов,
// а последний мяч летит прямо в камеру и становится фоном следующего блока.
import * as THREE from './vendor/three.module.min.js';

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const easeOut = t => 1 - Math.pow(1 - clamp(t), 3);
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// Размеры корта по правилам ITF, метры
const L = 23.77, WD = 10.97, WS = 8.23, SVC = 6.40;
const COURT_X = [-36, -18, 0, 18, 36];
const FENCE_Z = 21, CLAY_HALF_X = 45;
const R = 0.16; // мяч крупнее настоящего в 5 раз, иначе его не разглядеть
const G = 9.8;
const SUN = V(-0.78, 0.30, -0.55).normalize();

// Скролл: 0…P_TILT — облёт, P_RALLY_A…P_RALLY_B — розыгрыш, дальше мяч в камере
const P_TILT_A = 0.03, P_TILT_B = 0.19, P_RALLY_A = 0.2, P_RALLY_B = 0.94;

const CAM_POV = V(0, 1.65, 17.2), CAM_POV_LOOK = V(0, 1.0, 0);

function canvasTex(w, h, draw, { repeat, srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}

function clayTexture() {
  return canvasTex(512, 512, (g, s) => {
    const img = g.createImageData(s, s), d = img.data;
    for (let i = 0; i < s * s; i++) {
      const n = Math.random() - 0.5;
      d[i * 4] = 194 + n * 30; d[i * 4 + 1] = 92 + n * 20; d[i * 4 + 2] = 50 + n * 14; d[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    // следы от сетки-волокуши
    for (let y = 0; y < s; y += 3) {
      g.globalAlpha = 0.035 + Math.random() * 0.04;
      g.fillStyle = Math.random() < 0.5 ? '#6e2c10' : '#f2b48a';
      g.fillRect(0, y, s, 1 + Math.random() * 2);
    }
    g.globalAlpha = 0.25;
    for (let i = 0; i < 1600; i++) {
      g.fillStyle = Math.random() < 0.6 ? '#f0b58e' : '#64280f';
      g.fillRect(Math.random() * s, Math.random() * s, 1.6, 1.6);
    }
  }, { repeat: [90 / 7, 42 / 7] });
}

function ballTextures() {
  const W = 2048, H = 1024;
  // точки шва: классическая кривая мяча на единичной сфере
  const a = 0.62, b = 0.38, k = 2 * Math.sqrt(a * b), seam = [];
  for (let i = 0; i <= 2400; i++) {
    const t = (i / 2400) * Math.PI * 2;
    const x = a * Math.cos(t) + b * Math.cos(3 * t);
    const y = a * Math.sin(t) - b * Math.sin(3 * t);
    const z = k * Math.sin(2 * t);
    const theta = Math.acos(clamp(z, -1, 1));
    let phi = Math.atan2(y, -x); if (phi < 0) phi += Math.PI * 2;
    seam.push([phi / (Math.PI * 2) * W, theta / Math.PI * H, Math.max(Math.sin(theta), 0.08)]);
  }
  const stamp = (g, r, style) => {
    g.fillStyle = style;
    for (const [x, y, s] of seam) {
      const rx = r / s;
      for (const dx of [-W, 0, W]) {
        g.beginPath(); g.ellipse(x + dx, y, rx, r, 0, 0, Math.PI * 2); g.fill();
      }
    }
  };
  const fuzz = (g, n, colors, len) => {
    for (const [col, alpha] of colors) {
      g.globalAlpha = alpha; g.strokeStyle = col; g.lineWidth = 1; g.beginPath();
      for (let i = 0; i < n; i++) {
        const x = Math.random() * W, y = Math.random() * H, l = 1 + Math.random() * len, an = Math.random() * 6.283;
        g.moveTo(x, y); g.lineTo(x + Math.cos(an) * l, y + Math.sin(an) * l);
      }
      g.stroke();
    }
    g.globalAlpha = 1;
  };
  const map = canvasTex(W, H, g => {
    g.fillStyle = '#cfe33c'; g.fillRect(0, 0, W, H);
    fuzz(g, 26000, [['#f7ffb8', 0.35], ['#8ea414', 0.28], ['#e9f77a', 0.3], ['#a9bd1e', 0.22]], 6);
    stamp(g, 15, 'rgba(110,120,30,0.55)');
    stamp(g, 11, '#f3f1e2');
    fuzz(g, 3000, [['#ffffff', 0.15]], 4);
  });
  const bump = canvasTex(1024, 512, (g) => {
    g.fillStyle = '#808080'; g.fillRect(0, 0, 1024, 512);
    g.scale(0.5, 0.5);
    fuzz(g, 30000, [['#ffffff', 0.5], ['#000000', 0.5]], 5);
    stamp(g, 15, '#3a3a3a');
    stamp(g, 9, '#9a9a9a');
  }, { srgb: false });
  return { map, bump };
}

function windscreenTexture(len) {
  return canvasTex(2048, 128, (g, w, h) => {
    g.fillStyle = '#123d2b'; g.fillRect(0, 0, w, h);
    g.globalAlpha = 0.08; g.fillStyle = '#000';
    for (let x = 0; x < w; x += 4) g.fillRect(x, 0, 1, h);
    for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 1);
    g.globalAlpha = 1;
    g.fillStyle = '#0c2b1e'; g.fillRect(0, 0, w, 8); g.fillRect(0, h - 6, w, 6);
    g.font = '800 46px Unbounded, "Arial Black", sans-serif';
    g.textBaseline = 'middle';
    for (let i = 0; i < 4; i++) {
      const x = i * 512 + 70;
      g.fillStyle = '#fffbdb'; g.fillText('TENNISPARK', x + 46, h / 2 + 3);
      g.fillStyle = '#d6ea3f'; g.beginPath(); g.arc(x + 12, h / 2 + 2, 15, 0, 6.283); g.fill();
      g.strokeStyle = '#fffbdb'; g.lineWidth = 3; g.beginPath();
      g.arc(x - 2, h / 2 + 2, 12, -0.9, 0.9); g.stroke();
      g.beginPath(); g.arc(x + 26, h / 2 + 2, 12, Math.PI - 0.9, Math.PI + 0.9); g.stroke();
    }
  }, { repeat: [len / 26, 1] });
}

function netTexture() {
  const t = canvasTex(32, 32, (g, s) => {
    g.clearRect(0, 0, s, s);
    g.fillStyle = 'rgba(20,24,22,1)';
    g.fillRect(0, 0, s, 3); g.fillRect(0, 0, 3, s);
  }, { repeat: [130, 11] });
  t.anisotropy = 4;
  return t;
}

function glowTexture() {
  return canvasTex(128, 128, (g, s) => {
    const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    gr.addColorStop(0, 'rgba(255,246,220,1)');
    gr.addColorStop(0.18, 'rgba(255,226,170,0.55)');
    gr.addColorStop(1, 'rgba(255,200,140,0)');
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
  });
}

function blobTexture() {
  return canvasTex(128, 128, (g, s) => {
    const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    gr.addColorStop(0, 'rgba(40,14,4,0.75)');
    gr.addColorStop(1, 'rgba(40,14,4,0)');
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
  });
}

// ——— Траектория розыгрыша ———
function buildRally() {
  const camDir = new THREE.Vector3().subVectors(CAM_POV_LOOK, CAM_POV).normalize();
  const pts = [
    V(0.6, 1.0, 12.4),        // подброс
    V(0.6, 2.9, 12.3),        // подача
    V(-2.4, R, -4.6),         // отскок 1 — квадрат подачи
    V(-3.4, 0.95, -12.4),     // приём
    V(2.8, R, 7.8),           // отскок 2
    V(3.6, 1.0, 12.9),        // удар справа
    V(-3.9, R, -8.6),         // отскок 3 — кросс
    V(-4.4, 1.05, -12.8),     // удар
    V(0.3, R, 9.0),           // отскок 4
    CAM_POV.clone().addScaledVector(camDir, 0.16) // в камеру
  ];
  const dur = [0.55, 0.62, 0.55, 1.05, 0.5, 1.0, 0.5, 0.95, 0.5];
  const segs = [];
  let t = 0;
  const q = new THREE.Quaternion();
  for (let i = 0; i < dur.length; i++) {
    const p0 = pts[i], p1 = pts[i + 1], T = dur[i];
    const v = new THREE.Vector3().subVectors(p1, p0).divideScalar(T);
    v.y += 0.5 * G * T;
    const horiz = V(v.x, 0, v.z);
    const axis = horiz.lengthSq() > 1e-4 ? new THREE.Vector3().crossVectors(V(0, 1, 0), horiz).normalize() : V(1, 0, 0);
    const spin = i === 0 ? 4 : 38;
    segs.push({ p0, p1, T, v, t0: t, axis, spin, q0: q.clone() });
    q.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, spin * T));
    t += T;
  }
  const bounces = [2, 4, 6, 8].map(i => ({ pos: pts[i], t: segs[i].t0, dir: segs[i - 1].v.clone().setY(0).normalize() }));
  return { segs, total: t, bounces, hits: [1, 3, 5, 7].map(i => segs[i].t0) };
}

function rallyAt(r, t, out, outQ) {
  t = clamp(t, 0, r.total);
  let s = r.segs[r.segs.length - 1];
  for (const sg of r.segs) { if (t <= sg.t0 + sg.T) { s = sg; break; } }
  const dt = t - s.t0;
  out.copy(s.p0).addScaledVector(s.v, dt);
  out.y -= 0.5 * G * dt * dt;
  if (outQ) outQ.copy(s.q0).premultiply(new THREE.Quaternion().setFromAxisAngle(s.axis, s.spin * dt));
  return out;
}

export function initHero() {
  const section = document.getElementById('top');
  const canvas = document.getElementById('court3d');
  if (!section || !canvas) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch (e) {
    section.classList.add('no-webgl');
    return;
  }
  const small = Math.min(innerWidth, innerHeight) < 700;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, small ? 1.6 : 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.22;
  renderer.shadowMap.enabled = !small;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  const scene = new THREE.Scene();
  const HORIZON = new THREE.Color('#f6cf9f');
  scene.fog = new THREE.Fog(new THREE.Color('#e2bf98'), 70, 430);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 1600);

  // ——— Небо ———
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1000, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color('#4f7f9c') }, hor: { value: HORIZON }, sun: { value: SUN } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; gl_Position.z = p.w*0.99999; }',
      fragmentShader: `uniform vec3 top; uniform vec3 hor; uniform vec3 sun; varying vec3 vDir;
        void main(){
          vec3 d = normalize(vDir);
          float h = clamp(d.y, 0.0, 1.0);
          vec3 c = mix(hor, top, pow(h, 0.5));
          float s = max(dot(d, sun), 0.0);
          c += vec3(1.0, 0.72, 0.42) * (pow(s, 600.0) * 4.0 + pow(s, 24.0) * 0.55 + pow(s, 4.0) * 0.18);
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`
    })
  );
  sky.renderOrder = -1;
  scene.add(sky);

  // ——— Свет ———
  scene.add(new THREE.HemisphereLight('#cfe0f0', '#6b4a2c', 1.6));
  const sun = new THREE.DirectionalLight('#ffd3a1', 3.2);
  sun.position.copy(SUN).multiplyScalar(140);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -52, right: 52, top: 40, bottom: -40, near: 40, far: 320 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  // ——— Земля, грунт, линии ———
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), new THREE.MeshStandardMaterial({ color: '#3a5530', roughness: 1 }));
  grass.rotation.x = -Math.PI / 2; grass.position.y = -0.06;
  scene.add(grass);

  const clayGeo = new THREE.PlaneGeometry(CLAY_HALF_X * 2, FENCE_Z * 2, 180, 84);
  clayGeo.rotateX(-Math.PI / 2);
  {
    const pos = clayGeo.attributes.position, col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const lx = ((x + CLAY_HALF_X) % 18) - 9;
      const wear = Math.exp(-Math.pow(Math.abs(z) - 12.8, 2) / 5) * Math.exp(-(lx * lx) / 16);
      const edge = Math.min(Math.abs(Math.abs(lx) - 9), FENCE_Z - Math.abs(z));
      const n = Math.sin(x * 0.37 + z * 0.21) * 0.025 + Math.sin(x * 0.11 - z * 0.53) * 0.02;
      const k = (1 + wear * 0.16 + n) * (edge < 1.4 ? 0.86 + edge * 0.1 : 1);
      col[i * 3] = k; col[i * 3 + 1] = k * (1 + wear * 0.05); col[i * 3 + 2] = k * (1 + wear * 0.09);
    }
    clayGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  const clayMap = clayTexture(); clayMap.anisotropy = maxAniso;
  const clay = new THREE.Mesh(clayGeo, new THREE.MeshStandardMaterial({ map: clayMap, vertexColors: true, roughness: 0.95 }));
  clay.receiveShadow = true;
  scene.add(clay);

  const lineMat = new THREE.MeshStandardMaterial({ color: '#f4efe2', roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const lines = [];
  const addLine = (cx, x1, z1, x2, z2, order, w = 0.085) => {
    const dx = x2 - x1, dz = z2 - z1, len = Math.hypot(dx, dz);
    const geo = new THREE.PlaneGeometry(len, w);
    geo.translate(len / 2, 0, 0); geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, lineMat);
    m.position.set(cx + x1, 0.012, z1);
    m.rotation.y = Math.atan2(-dz, dx);
    m.receiveShadow = true;
    m.scale.x = 0.0001;
    scene.add(m);
    lines.push({ m, delay: order * 0.16 + Math.abs(cx) / 18 * 0.22 });
  };
  for (const cx of COURT_X) {
    const hl = L / 2, hd = WD / 2, hs = WS / 2;
    addLine(cx, -hd, hl, hd, hl, 0); addLine(cx, hd, -hl, -hd, -hl, 0);
    addLine(cx, -hd, hl, -hd, -hl, 1); addLine(cx, hd, -hl, hd, hl, 1);
    addLine(cx, -hs, hl, -hs, -hl, 2); addLine(cx, hs, -hl, hs, hl, 2);
    addLine(cx, -hs, SVC, hs, SVC, 3); addLine(cx, hs, -SVC, -hs, -SVC, 3);
    addLine(cx, 0, SVC, 0, -SVC, 4);
    addLine(cx, 0, hl, 0, hl - 0.2, 4); addLine(cx, 0, -hl, 0, -hl + 0.2, 4);
  }

  // ——— Сетки ———
  const netTex = netTexture();
  const netMat = new THREE.MeshStandardMaterial({ map: netTex, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 1, color: '#2a302c' });
  const postMat = new THREE.MeshStandardMaterial({ color: '#163a2a', roughness: 0.5, metalness: 0.3 });
  const tapeMat = new THREE.MeshStandardMaterial({ color: '#f6f2e6', roughness: 0.8 });
  const nets = [];
  const NW = WD + 2 * 0.914;
  for (const cx of COURT_X) {
    const g = new THREE.Group();
    const geo = new THREE.PlaneGeometry(NW, 1.07, 40, 1);
    const pos = geo.attributes.position;
    const sag = x => (1 - Math.pow(x / (NW / 2), 2)) * 0.156;
    for (let i = 0; i < pos.count; i++) if (pos.getY(i) > 0) pos.setY(i, pos.getY(i) - sag(pos.getX(i)));
    geo.translate(0, 0.535, 0);
    const net = new THREE.Mesh(geo, netMat); net.castShadow = true; g.add(net);
    const curve = new THREE.CatmullRomCurve3(Array.from({ length: 21 }, (_, i) => { const x = -NW / 2 + NW * i / 20; return V(x, 1.07 - sag(x), 0); }));
    const tape = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.035, 6), tapeMat); tape.castShadow = true; g.add(tape);
    const strap = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.914), tapeMat); strap.position.set(0, 0.457, 0.002); g.add(strap);
    for (const s of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.07, 12), postMat);
      p.position.set(s * NW / 2, 0.535, 0); p.castShadow = true; g.add(p);
    }
    g.position.x = cx;
    g.scale.y = 0.001;
    scene.add(g);
    nets.push({ g, delay: 0.9 + Math.abs(cx) / 18 * 0.15 });
  }

  // ——— Ограждение с ветрозащитой ———
  const FH = 3.4, FH_IN = 2.2;
  // две односторонние плоскости спиной к спине, чтобы надпись читалась с обеих сторон
  const addFence = (x1, z1, x2, z2, fh = FH) => {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const geo = new THREE.PlaneGeometry(len, fh);
    const mat = new THREE.MeshStandardMaterial({ map: windscreenTexture(len), roughness: 0.95 });
    for (const flip of [0, Math.PI]) {
      const m = new THREE.Mesh(geo, mat);
      m.position.set((x1 + x2) / 2, fh / 2, (z1 + z2) / 2);
      m.rotation.y = Math.atan2(-(z2 - z1), x2 - x1) + flip;
      m.castShadow = flip === 0; m.receiveShadow = true;
      scene.add(m);
    }
  };
  addFence(-CLAY_HALF_X, -FENCE_Z, CLAY_HALF_X, -FENCE_Z);
  addFence(CLAY_HALF_X, FENCE_Z, -CLAY_HALF_X, FENCE_Z);
  for (const x of [-45, 45]) addFence(x, FENCE_Z, x, -FENCE_Z);
  for (const x of [-27, -9, 9, 27]) addFence(x, FENCE_Z, x, -FENCE_Z, FH_IN);

  const postPos = [];
  for (let x = -45; x <= 45; x += 3) postPos.push([x, -FENCE_Z], [x, FENCE_Z]);
  for (const x of [-45, -27, -9, 9, 27, 45]) for (let z = -18; z <= 18; z += 3) postPos.push([x, z, Math.abs(x) === 45 ? FH : FH_IN]);
  const posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.045, 0.045, 1, 6), postMat, postPos.length);
  const mtx = new THREE.Matrix4();
  postPos.forEach(([x, z, h = FH], i) => posts.setMatrixAt(i, mtx.makeScale(1, h + 0.15, 1).setPosition(x, (h + 0.15) / 2, z)));
  posts.castShadow = true;
  scene.add(posts);

  // ——— Мачты освещения ———
  const glowTex = glowTexture();
  const poleXs = [-45, -27, -9, 9, 27, 45];
  const poleMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.13, 11, 8), postMat, poleXs.length * 2);
  const lampMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1.1, 0.28, 0.55), new THREE.MeshStandardMaterial({ color: '#222', emissive: '#fff1cf', emissiveIntensity: 2.2 }), poleXs.length * 2);
  let pi = 0;
  for (const x of poleXs) for (const z of [-FENCE_Z - 0.4, FENCE_Z + 0.4]) {
    poleMesh.setMatrixAt(pi, mtx.makeTranslation(x, 5.5, z));
    lampMesh.setMatrixAt(pi, mtx.makeTranslation(x, 11, z - Math.sign(z) * 0.3));
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.55, fog: false }));
    s.scale.set(5, 5, 1); s.position.set(x, 11, z - Math.sign(z) * 0.4);
    scene.add(s);
    pi++;
  }
  poleMesh.castShadow = true;
  scene.add(poleMesh, lampMesh);

  // ——— Деревья, Дон, правый берег ———
  const treeCount = small ? 170 : 320;
  const trees = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ flatShading: true, roughness: 1 }), treeCount);
  const greens = ['#2c4a26', '#365a2b', '#24402a', '#41612e', '#2f5233', '#4b6a2f'].map(c => new THREE.Color(c));
  const tq = new THREE.Quaternion(), ts = new THREE.Vector3(), tp = new THREE.Vector3();
  let placed = 0, guard = 0;
  while (placed < treeCount && guard++ < 5000) {
    const x = (Math.random() - 0.5) * 190, z = -52 + Math.random() * 100;
    const inClay = Math.abs(x) < CLAY_HALF_X + 3 && Math.abs(z) < FENCE_Z + 3;
    if (inClay) continue;
    if (z > 22 && Math.abs(x) < 16) continue; // коридор для камеры
    const poplar = Math.random() < 0.22;
    const far = Math.max(0, -z - 24) / 28;
    const sy = (poplar ? 5 + Math.random() * 2.2 : 2.6 + Math.random() * 1.8) * (1 + far * 0.2);
    const sxz = poplar ? 1.3 + Math.random() * 0.5 : 2.6 + Math.random() * 2;
    ts.set(sxz, sy, sxz * (0.85 + Math.random() * 0.3));
    tp.set(x, sy * 0.92, z);
    tq.setFromAxisAngle(V(0, 1, 0), Math.random() * 6.28);
    trees.setMatrixAt(placed, mtx.compose(tp, tq, ts));
    trees.setColorAt(placed, greens[(Math.random() * greens.length) | 0]);
    placed++;
  }
  trees.count = placed;
  trees.castShadow = true;
  scene.add(trees);

  const river = new THREE.Mesh(new THREE.PlaneGeometry(1600, 180), new THREE.MeshStandardMaterial({ color: '#3d6577', roughness: 0.16, metalness: 0.1 }));
  river.rotation.x = -Math.PI / 2; river.position.set(0, -0.02, -150);
  scene.add(river);

  const cityN = small ? 90 : 160;
  const city = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: '#8a8f92', roughness: 0.9 }), cityN);
  for (let i = 0; i < cityN; i++) {
    const h = 6 + Math.pow(Math.random(), 2.2) * 34, w = 10 + Math.random() * 22;
    tp.set((Math.random() - 0.5) * 1100, h / 2 + 4, -270 - Math.random() * 80);
    ts.set(w, h, 10 + Math.random() * 14);
    tq.identity();
    city.setMatrixAt(i, mtx.compose(tp, tq, ts));
  }
  scene.add(city);
  const bank = new THREE.Mesh(new THREE.PlaneGeometry(1600, 120), new THREE.MeshStandardMaterial({ color: '#4d5e48', roughness: 1 }));
  bank.rotation.x = -Math.PI / 2 + 0.04; bank.position.set(0, 2, -290);
  scene.add(bank);

  // ——— Мяч ———
  const { map: ballMap, bump: ballBump } = ballTextures();
  ballMap.anisotropy = maxAniso;
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(R, 64, 48),
    new THREE.MeshStandardMaterial({ map: ballMap, bumpMap: ballBump, bumpScale: 0.004, roughness: 0.92, color: '#ffffff' })
  );
  ball.castShadow = true;
  const fuzzShell = new THREE.Mesh(
    new THREE.SphereGeometry(R * 1.035, 48, 32),
    new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { c: { value: new THREE.Color('#effa9a') } },
      vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }',
      fragmentShader: 'uniform vec3 c; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.0 - abs(dot(vN, vV)), 2.2); gl_FragColor = vec4(c, f*0.6); }'
    })
  );
  ball.add(fuzzShell);
  scene.add(ball);

  const blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false }));
  blob.rotation.x = -Math.PI / 2;
  scene.add(blob);

  // ——— След мяча ———
  const TN = 26;
  const trailGeo = new THREE.BufferGeometry();
  const trailPos = new Float32Array(TN * 2 * 3), trailA = new Float32Array(TN * 2);
  const idx = [];
  for (let i = 0; i < TN - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  trailGeo.setIndex(idx);
  trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
  trailGeo.setAttribute('aA', new THREE.BufferAttribute(trailA, 1));
  const trailMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { op: { value: 0 }, c: { value: new THREE.Color('#f4ffc0') } },
    vertexShader: 'attribute float aA; varying float vA; void main(){ vA = aA; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: 'uniform float op; uniform vec3 c; varying float vA; void main(){ gl_FragColor = vec4(c, vA*op); }'
  });
  const trail = new THREE.Mesh(trailGeo, trailMat);
  trail.frustumCulled = false;
  scene.add(trail);

  // ——— Следы отскоков, пыль, кольца ———
  const rally = buildRally();
  const markMat = new THREE.MeshBasicMaterial({ color: '#7b3214', transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 });
  const marks = rally.bounces.map(b => {
    const m = new THREE.Mesh(new THREE.CircleGeometry(1, 28), markMat.clone());
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = -Math.atan2(b.dir.x, -b.dir.z);
    m.scale.set(R * 1.4, R * 3.4, 1);
    m.position.set(b.pos.x, 0.014, b.pos.z);
    m.material.opacity = 0;
    scene.add(m);
    return m;
  });

  const DUST = 46;
  const dustMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { age: { value: -1 }, origin: { value: V(0, 0, 0) }, fwd: { value: V(0, 0, -1) }, scale: { value: 600 } },
    vertexShader: `attribute vec3 aDir; attribute float aSp; uniform float age; uniform vec3 origin; uniform vec3 fwd; uniform float scale; varying float vA;
      void main(){
        float a = max(age, 0.0);
        float e = 1.0 - exp(-a*4.0);
        vec3 p = origin + (aDir*aSp + fwd*aSp*0.9) * e;
        p.y = 0.02 + aDir.y * aSp * e * 0.6 - a*a*0.15;
        p.y = max(p.y, 0.02);
        vec4 mv = modelViewMatrix*vec4(p,1.0);
        gl_PointSize = (0.06 + a*0.22) * scale / -mv.z;
        vA = (age < 0.0 || age > 1.1) ? 0.0 : pow(1.0 - a/1.1, 2.0);
        gl_Position = projectionMatrix*mv;
      }`,
    fragmentShader: 'varying float vA; void main(){ float d = length(gl_PointCoord-0.5); if(d>0.5) discard; gl_FragColor = vec4(0.93,0.62,0.42, vA*(1.0-d*2.0)*0.75); }'
  });
  const dustGeo = new THREE.BufferGeometry();
  {
    const dir = new Float32Array(DUST * 3), sp = new Float32Array(DUST);
    for (let i = 0; i < DUST; i++) {
      const an = Math.random() * 6.283;
      dir[i * 3] = Math.cos(an); dir[i * 3 + 1] = 0.4 + Math.random() * 1.2; dir[i * 3 + 2] = Math.sin(an);
      sp[i] = 0.15 + Math.random() * 0.55;
    }
    dustGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DUST * 3), 3));
    dustGeo.setAttribute('aDir', new THREE.BufferAttribute(dir, 3));
    dustGeo.setAttribute('aSp', new THREE.BufferAttribute(sp, 1));
  }
  const puffs = rally.bounces.map(b => {
    const mat = dustMat.clone();
    mat.uniforms.origin.value = b.pos.clone().setY(0);
    mat.uniforms.fwd.value = b.dir.clone();
    const pts = new THREE.Points(dustGeo, mat);
    pts.frustumCulled = false;
    scene.add(pts);
    return { pts, start: -10 };
  });
  const rings = rally.bounces.map(b => {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 64), new THREE.MeshBasicMaterial({ color: '#fffbdb', transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(b.pos.x, 0.02, b.pos.z);
    scene.add(m);
    return { m, start: -10 };
  });

  // ——— HTML поверх сцены ———
  const tags = [...section.querySelectorAll('.tag')];
  const scoreEl = section.querySelector('.score');
  const scoreYou = section.querySelector('[data-score="you"]');
  const scoreOpp = section.querySelector('[data-score="opp"]');
  const felt = section.querySelector('.hero-felt');
  const intro = section.querySelector('.hero-intro');
  const hint = section.querySelector('.hero-hint');
  const shade = section.querySelector('.hero-shade');
  const SCORES = ['0', '15', '30', '40', 'ГЕЙМ'];
  let lastScore = -1;

  // ——— Камера ———
  const tmpM = new THREE.Matrix4();
  const camQuat = (pos, look, up) => new THREE.Quaternion().setFromRotationMatrix(tmpM.lookAt(pos, look, up));
  const UP = V(0, 1, 0), UP_TOP = V(0, 0, -1);

  function broadcast(aspect) {
    const k = sstep(1.35, 0.55, aspect); // 0 — широкий экран, 1 — телефон
    // на телефоне камера выше: нижний край кадра ложится сразу за заднюю линию, ограждение уходит из кадра
    const pos = V(0, lerp(7, 14.5, k), lerp(24, 28.5, k));
    const down = THREE.MathUtils.degToRad(lerp(12, 14.6, k));
    return { pos, look: pos.clone().add(V(0, -Math.sin(down), -Math.cos(down)).multiplyScalar(30)), fov: lerp(46, 58, k) };
  }
  function topHeight(aspect, fov) {
    const t = Math.tan(THREE.MathUtils.degToRad(fov / 2));
    return clamp((aspect >= 1 ? 50 : 21) / (t * aspect), 58, 125);
  }

  let pTarget = 0, p = 0;
  const readScroll = () => {
    const r = section.getBoundingClientRect();
    const span = r.height - innerHeight;
    pTarget = span > 0 ? clamp(-r.top / span) : 0;
  };
  addEventListener('scroll', readScroll, { passive: true });
  readScroll();
  p = pTarget;

  const resize = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    dustMat.uniforms.scale.value = h;
    puffs.forEach(pf => { pf.pts.material.uniforms.scale.value = h; });
  };
  new ResizeObserver(resize).observe(canvas);
  resize();

  const ballPos = V(0, 0, 0), ballQ = new THREE.Quaternion(), tmpV = V(0, 0, 0), proj = V(0, 0, 0);
  const camPos = V(0, 0, 0), camLook = V(0, 0, 0);
  let lastRallyT = 0;
  const t0 = performance.now();
  let prev = t0, visible = true, running = false, firstFrame = true;
  const start = () => { if (!running) { running = true; prev = performance.now(); requestAnimationFrame(frame); } };

  new IntersectionObserver(es => { visible = es[0].isIntersecting; if (visible) start(); }).observe(section);

  function frame(now) {
    if (!visible) { running = false; return; }
    const dt = Math.min((now - prev) / 1000, 0.05); prev = now;
    const time = (now - t0) / 1000;
    const introT = reduce ? 99 : time;
    p += (pTarget - p) * (1 - Math.exp(-dt * (reduce ? 60 : 7)));
    if (Math.abs(pTarget - p) < 1e-5) p = pTarget;

    // линии и сетки прорисовываются при загрузке
    for (const l of lines) l.m.scale.x = Math.max(0.0001, easeOut((introT - 0.35 - l.delay) / 0.8));
    for (const n of nets) n.g.scale.y = Math.max(0.001, easeOut((introT - 0.35 - n.delay) / 0.7));

    // ——— камера ———
    const aspect = camera.aspect;
    const bc = broadcast(aspect);
    const topFov = 40;
    const H = topHeight(aspect, topFov) * lerp(1.22, 1, easeOut(introT / 3.2));
    const tilt = sstep(P_TILT_A, P_TILT_B, p);
    const rallyT = clamp((p - P_RALLY_A) / (P_RALLY_B - P_RALLY_A)) * rally.total;

    // мяч
    if (p < P_RALLY_A) {
      const ph = (time % 0.62) / 0.62;
      const idle = V(0.6, R + 4 * ph * (1 - ph) * 0.85, 12.4);
      rallyAt(rally, 0, tmpV, ballQ);
      ballPos.copy(idle).lerp(tmpV, sstep(P_RALLY_A - 0.025, P_RALLY_A, p));
    } else {
      rallyAt(rally, rallyT, ballPos, ballQ);
    }

    const track = sstep(P_TILT_B - 0.04, P_RALLY_A + 0.02, p);
    const bcPos = bc.pos.clone(); bcPos.x += ballPos.x * 0.22 * track;
    const bcLook = bc.look.clone(); bcLook.x += ballPos.x * 0.38 * track; bcLook.z += ballPos.z * 0.08 * track;
    const pov = sstep(rally.hits[3], rally.bounces[3].t, rallyT);

    // облёт: дуга сверху за заднюю линию
    const topPos = V(0, H, 0.01), arcCtrl = V(0, H * 0.55, bc.pos.z + 16);
    const a = tilt, ia = 1 - a;
    camPos.set(0, 0, 0).addScaledVector(topPos, ia * ia).addScaledVector(arcCtrl, 2 * ia * a).addScaledVector(bcPos, a * a);
    camPos.lerp(CAM_POV, pov);
    camLook.copy(bcLook).lerp(CAM_POV_LOOK, pov);
    const qTop = camQuat(topPos, V(0, 0, 0), UP_TOP);
    const qEnd = camQuat(camPos, camLook, UP);
    camera.quaternion.slerpQuaternions(qTop, qEnd, sstep(0, 1, a));
    if (a < 0.001) camera.rotateZ(Math.sin(time * 0.12) * 0.012);
    camera.position.copy(camPos);
    camera.fov = lerp(lerp(topFov, bc.fov, a), aspect < 1 ? 64 : 52, pov);
    const dBall = camera.position.distanceTo(ballPos);
    camera.near = dBall < 3 ? 0.03 : 0.5;
    camera.updateProjectionMatrix();
    sky.position.copy(camera.position);

    ball.position.copy(ballPos);
    ball.quaternion.copy(ballQ);
    blob.position.set(ballPos.x, 0.016, ballPos.z);
    const hgt = ballPos.y - R;
    const bs = R * 3.2 * (1 + hgt * 0.35);
    blob.scale.set(bs, bs, 1);
    blob.material.opacity = clamp(1 - hgt * 0.28, 0.12, 0.9);

    // след
    const inFlight = p >= P_RALLY_A && rallyT > 0.4;
    trailMat.uniforms.op.value = inFlight ? 0.55 * (1 - sstep(0.4, 0.9, 1 - dBall / 4)) : 0;
    if (inFlight) {
      const view = V(0, 0, 0);
      for (let i = 0; i < TN; i++) {
        const tt = Math.max(0.4, rallyT - i * 0.011);
        rallyAt(rally, tt, tmpV);
        const tt2 = Math.max(0.4, tt - 0.004);
        const tan = rallyAt(rally, tt2, V(0, 0, 0)).sub(tmpV).multiplyScalar(-1);
        view.subVectors(camera.position, tmpV);
        const side = new THREE.Vector3().crossVectors(tan, view).normalize().multiplyScalar(R * 0.85 * (1 - i / TN));
        trailPos.set([tmpV.x + side.x, tmpV.y + side.y, tmpV.z + side.z, tmpV.x - side.x, tmpV.y - side.y, tmpV.z - side.z], i * 6);
        const al = Math.pow(1 - i / TN, 1.6);
        trailA[i * 2] = al; trailA[i * 2 + 1] = al;
      }
      trailGeo.attributes.position.needsUpdate = true;
      trailGeo.attributes.aA.needsUpdate = true;
    }

    // отскоки: следы держатся по скроллу, пыль и кольца срабатывают при пролёте вперёд
    rally.bounces.forEach((b, i) => {
      marks[i].material.opacity = p >= P_RALLY_A && rallyT >= b.t ? 0.5 : 0;
      if (p >= P_RALLY_A && lastRallyT < b.t && rallyT >= b.t) { puffs[i].start = time; rings[i].start = time; }
      const age = time - puffs[i].start;
      puffs[i].pts.material.uniforms.age.value = age < 1.2 ? age : -1;
      const ra = (time - rings[i].start) / 0.9;
      const ring = rings[i].m;
      ring.material.opacity = ra >= 0 && ra < 1 ? (1 - ra) * 0.85 : 0;
      const rs = 0.15 + easeOut(ra) * 1.6;
      ring.scale.set(rs, rs, rs);
    });
    lastRallyT = p >= P_RALLY_A ? rallyT : 0;

    // ——— слой HTML ———
    const introOut = sstep(0.025, 0.12, p);
    if (intro) { intro.style.opacity = 1 - introOut; intro.style.transform = `translate3d(0, ${-introOut * 60}px, 0)`; intro.style.visibility = introOut > 0.99 ? 'hidden' : ''; }
    if (shade) shade.style.opacity = 1 - introOut * 0.65;
    if (hint) hint.style.opacity = (1 - sstep(0.01, 0.05, p)) * sstep(1.8, 2.6, introT);
    const scoreVis = sstep(P_TILT_B - 0.03, P_TILT_B, p) * (1 - sstep(P_RALLY_B - 0.02, P_RALLY_B + 0.02, p));
    scoreEl.style.opacity = scoreVis;
    scoreEl.style.visibility = scoreVis < 0.01 ? 'hidden' : 'visible';
    let si = rally.bounces.filter(b => p >= P_RALLY_A && rallyT >= b.t).length;
    if (rallyT >= rally.total - 0.35 && p >= P_RALLY_A) si = 4;
    if (si !== lastScore) {
      lastScore = si;
      scoreYou.textContent = SCORES[si];
      scoreEl.classList.toggle('is-game', si === 4);
      scoreYou.classList.remove('flip'); void scoreYou.offsetWidth; scoreYou.classList.add('flip');
    }
    scoreOpp.textContent = si === 4 ? '' : '0';

    const W = canvas.clientWidth, Hh = canvas.clientHeight;
    tags.forEach((el, i) => {
      const b = rally.bounces[i];
      const next = i < 3 ? rally.bounces[i + 1].t : rally.total - 0.08;
      const op = p < P_RALLY_A ? 0 : sstep(b.t, b.t + 0.12, rallyT) * (1 - sstep(next - 0.2, next - 0.02, rallyT));
      el.style.opacity = op;
      el.style.visibility = op < 0.01 ? 'hidden' : 'visible';
      if (op > 0.01) {
        proj.copy(b.pos).setY(0).project(camera);
        const x = clamp((proj.x * 0.5 + 0.5) * W, 24, W - 24);
        const y = clamp((-proj.y * 0.5 + 0.5) * Hh, 160, Hh - 20);
        el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        el.classList.toggle('flip-left', x > W * 0.62);
      }
    });

    const feltOp = p >= P_RALLY_A ? 1 - sstep(0.17, 0.42, dBall) : 0;
    felt.style.opacity = feltOp;
    section.classList.toggle('is-felt', feltOp > 0.98);
    document.documentElement.classList.toggle('felt-on', feltOp > 0.4);

    renderer.render(scene, camera);
    if (firstFrame) { firstFrame = false; section.classList.add('is-ready'); }
    requestAnimationFrame(frame);
  }
  if (document.fonts && document.fonts.load) {
    // текст на ветрозащите рисуется шрифтом Unbounded — ждём его, но не дольше секунды
    Promise.race([document.fonts.load('800 46px Unbounded'), new Promise(r => setTimeout(r, 1000))]).then(() => {
      const done = new Set();
      scene.traverse(o => {
        const m = o.material;
        if (!m || done.has(m) || !m.map || !m.map.image || m.map.image.width !== 2048 || m.map.image.height !== 128) return;
        done.add(m);
        m.map.dispose();
        m.map = windscreenTexture(o.geometry.parameters.width);
        m.needsUpdate = true;
      });
    });
  }
  start();
}
