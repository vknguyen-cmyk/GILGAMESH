import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

/**
 * The 3D screening lane: bags ride a belt through an X-ray tunnel, each carrying a real scan
 * and the model's real result. Bags the model flags are pushed off to a bag-search belt, where
 * a pulsing node invites the officer to open the bag's 3D density view.
 *
 * The 3D bags themselves are animation; the scans and results they carry are real.
 */

export type LaneVerdict = "clear" | "review" | "threat";

export interface LaneDetection {
  label: string;
  score: number;
  /** Box normalized to the scan image, top-left corner plus size. */
  x: number;
  y: number;
  w: number;
  h: number;
  kind: "threat" | "review" | "benign";
}

export interface LaneScan {
  id: string;
  file: string;
  image: CanvasImageSource;
  width: number;
  height: number;
  verdict: LaneVerdict;
  detections: LaneDetection[];
  /** Strongest detection, used for headlines. */
  top: LaneDetection | null;
}

export interface LaneLogEntry {
  serial: number;
  label: string;
  type: string;
  status: "belt" | "scanning" | "analyzing" | LaneVerdict;
  scan: LaneScan;
}

export interface LaneSnapshot {
  focus: { label: string; file: string; progress: number; phase: "scanning" | "analyzing" | LaneVerdict; scan: LaneScan } | null;
  log: LaneLogEntry[];
  cleared: number;
  held: number;
}

export interface LaneApi {
  setPaused: (paused: boolean) => void;
  setSpeed: (speed: number) => void;
  setFollow: (follow: boolean) => void;
  resize: () => void;
  dispose: () => void;
}

interface LaneOptions {
  /** Canvas the scan is drawn into; it also textures the monitor beside the machine. */
  monitor: HTMLCanvasElement;
  /** Called when the belt has room for another bag. Return null to leave a gap. */
  nextScan: () => LaneScan | null;
  onChange: (snapshot: LaneSnapshot) => void;
  onInspect: (entry: LaneLogEntry) => void;
  reducedMotion: boolean;
}

const COLORS = { organic: "#ff9500", mixed: "#30b94d", metal: "#0071e3" } as const;
type MaterialKey = keyof typeof COLORS;
const KIND_COLOR = { threat: "#ff3b30", review: "#ff9500", benign: "#0071e3" } as const;
const BELT_Y = 0.75;
const BELT_HALF = 7;
const TUNNEL_HALF = 1.3;
const SPACING = 3.4;
const DIVERT_X = 3.4;
const SPUR_SLOTS = [-4.15, -3.05, -1.95];
const ANALYSIS_DELAY = 450;

interface BagItem {
  mat: MaterialKey;
  shape?: "cyl" | "knife" | "scissors";
  u: number;
  v: number;
  l: number;
  w: number;
  h: number;
}
interface BagSpec {
  type: string;
  color: number;
  size: [number, number, number];
  round?: boolean;
  verdict: LaneVerdict;
  items: BagItem[];
}

/* 3D bag looks, matched to each scan's real result so the animation never contradicts it. */
const BAGS: BagSpec[] = [
  { type: "Hard-shell roller", color: 0x2b3a55, size: [1.05, 0.46, 0.72], verdict: "clear", items: [
    { mat: "metal", u: -0.12, v: 0.05, l: 0.55, w: 0.62, h: 0.08 },
    { mat: "organic", u: 0.28, v: -0.18, l: 0.35, w: 0.45, h: 0.3 },
    { mat: "organic", shape: "cyl", u: 0.25, v: 0.3, l: 0.38, w: 0.16, h: 0.16 },
  ] },
  { type: "Duffel", color: 0x5b6b4a, size: [1.15, 0.5, 0.55], round: true, verdict: "clear", items: [
    { mat: "organic", u: -0.15, v: 0, l: 0.5, w: 0.7, h: 0.35 },
    { mat: "mixed", u: 0.28, v: -0.15, l: 0.3, w: 0.32, h: 0.25 },
    { mat: "metal", u: 0.25, v: 0.25, l: 0.18, w: 0.18, h: 0.06 },
  ] },
  { type: "Tote", color: 0xc9a227, size: [0.85, 0.4, 0.5], verdict: "clear", items: [
    { mat: "organic", u: -0.15, v: -0.1, l: 0.35, w: 0.5, h: 0.12 },
    { mat: "organic", u: 0.2, v: 0.1, l: 0.4, w: 0.6, h: 0.25 },
    { mat: "metal", u: -0.3, v: 0.3, l: 0.1, w: 0.1, h: 0.03 },
  ] },
  { type: "Backpack", color: 0x2a2a2e, size: [0.75, 0.5, 0.6], verdict: "threat", items: [
    { mat: "metal", u: -0.05, v: -0.1, l: 0.7, w: 0.55, h: 0.07 },
    { mat: "metal", shape: "knife", u: 0.12, v: 0.3, l: 0.5, w: 0.1, h: 0.04 },
    { mat: "organic", u: -0.25, v: 0.3, l: 0.3, w: 0.25, h: 0.2 },
  ] },
  { type: "Hard-shell roller", color: 0x3c6e8f, size: [1.05, 0.46, 0.72], verdict: "threat", items: [
    { mat: "metal", u: -0.2, v: -0.15, l: 0.4, w: 0.45, h: 0.05 },
    { mat: "metal", shape: "scissors", u: 0.22, v: 0.2, l: 0.3, w: 0.16, h: 0.04 },
    { mat: "organic", u: 0.2, v: -0.2, l: 0.4, w: 0.45, h: 0.3 },
  ] },
  { type: "Cabin roller", color: 0xa8423f, size: [1.0, 0.45, 0.7], verdict: "review", items: [
    { mat: "organic", u: -0.2, v: 0, l: 0.45, w: 0.75, h: 0.3 },
    { mat: "metal", shape: "cyl", u: 0.25, v: -0.2, l: 0.3, w: 0.14, h: 0.14 },
    { mat: "mixed", u: 0.25, v: 0.22, l: 0.28, w: 0.3, h: 0.2 },
  ] },
];

type BagMode = "belt" | "push" | "spur" | "removed";
interface Bag {
  serial: number;
  label: string;
  spec: BagSpec;
  scan: LaneScan;
  group: THREE.Group;
  shellMat: THREE.MeshStandardMaterial;
  inner: THREE.Group;
  half: number;
  state: "queued" | "scanning" | "done";
  mode: BagMode;
  pushT: number;
  scanned: number;
  doneAt: number;
  reported: boolean;
  node: { core: THREE.Sprite; halo: THREE.Sprite } | null;
}

export function mountLane(host: HTMLElement, options: LaneOptions): LaneApi {
  const { monitor, reducedMotion } = options;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xffffff);
  scene.fog = new THREE.Fog(0xffffff, 18, 34);

  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
  const HOME = { pos: new THREE.Vector3(7.2, 6.4, 9.6), target: new THREE.Vector3(1.4, 0.8, -1.1) };
  camera.position.copy(HOME.pos);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.style.display = "block";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  host.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(HOME.target);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 4;
  controls.maxDistance = 22;
  controls.maxPolarAngle = Math.PI * 0.47;

  scene.add(new THREE.HemisphereLight(0xffffff, 0xd9d9e0, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(4, 9, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 6, bottom: -6, near: 1, far: 30 });
  sun.shadow.bias = -0.0005;
  scene.add(sun);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ color: 0xf0f0f3, roughness: 1 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  function box(w: number, h: number, d: number, color: number, opts: { round?: number; rough?: number; metal?: number } = {}) {
    const m = new THREE.Mesh(
      opts.round ? new RoundedBoxGeometry(w, h, d, 3, opts.round) : new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color, roughness: opts.rough ?? 0.6, metalness: opts.metal ?? 0 }),
    );
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  /* Conveyor */
  const beltCanvas = document.createElement("canvas");
  beltCanvas.width = 256;
  beltCanvas.height = 32;
  {
    const c = beltCanvas.getContext("2d")!;
    c.fillStyle = "#2c2c30";
    c.fillRect(0, 0, 256, 32);
    c.fillStyle = "#3a3a40";
    for (let x = 0; x < 256; x += 16) c.fillRect(x, 0, 3, 32);
  }
  const beltTex = new THREE.CanvasTexture(beltCanvas);
  beltTex.wrapS = THREE.RepeatWrapping;
  beltTex.repeat.set(14, 1);
  beltTex.colorSpace = THREE.SRGBColorSpace;
  const belt = new THREE.Mesh(new THREE.BoxGeometry(BELT_HALF * 2, 0.06, 1.2), new THREE.MeshStandardMaterial({ map: beltTex, roughness: 0.9 }));
  belt.position.y = BELT_Y - 0.03;
  belt.receiveShadow = true;
  scene.add(belt);
  {
    const railFar = box(BELT_HALF * 2 + 0.3, 0.16, 0.08, 0xc7c7cc, { metal: 0.4, rough: 0.35 });
    railFar.position.set(0, BELT_Y - 0.06, 0.66);
    scene.add(railFar);
    // The near rail has a gap where the diverter pushes bags out.
    const gapStart = DIVERT_X - 0.72;
    const gapEnd = DIVERT_X + 0.72;
    for (const [a, b] of [[-BELT_HALF - 0.15, gapStart], [gapEnd, BELT_HALF + 0.15]]) {
      const seg = box(b - a, 0.16, 0.08, 0xc7c7cc, { metal: 0.4, rough: 0.35 });
      seg.position.set((a + b) / 2, BELT_Y - 0.06, -0.66);
      scene.add(seg);
    }
  }
  for (const x of [-6.5, -3.5, 3.5, 6.5]) {
    for (const z of [-0.6, 0.6]) {
      const leg = box(0.08, BELT_Y - 0.1, 0.08, 0xaeaeb2, { metal: 0.5, rough: 0.4 });
      leg.position.set(x, (BELT_Y - 0.1) / 2, z);
      scene.add(leg);
    }
  }
  const rollers: THREE.Mesh[] = [];
  for (const x of [-BELT_HALF, BELT_HALF]) {
    const r = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.25, 20), new THREE.MeshStandardMaterial({ color: 0x8e8e93, metalness: 0.6, roughness: 0.3 }));
    r.rotation.x = Math.PI / 2;
    r.position.set(x, BELT_Y - 0.04, 0);
    scene.add(r);
    rollers.push(r);
  }

  /* Search belt, where held bags wait for an officer */
  const spurRollers: THREE.Mesh[] = [];
  {
    const z0 = -0.72;
    const z1 = -4.75;
    for (let z = z0 - 0.12; z > z1; z -= 0.22) {
      const r = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.2, 14), new THREE.MeshStandardMaterial({ color: 0xb4b4ba, metalness: 0.6, roughness: 0.3 }));
      r.rotation.z = Math.PI / 2;
      r.position.set(DIVERT_X, BELT_Y - 0.05, z);
      r.receiveShadow = true;
      scene.add(r);
      spurRollers.push(r);
    }
    for (const dx of [-0.66, 0.66]) {
      const rail = box(0.08, 0.16, z0 - z1, 0xc7c7cc, { metal: 0.4, rough: 0.35 });
      rail.position.set(DIVERT_X + dx, BELT_Y - 0.06, (z0 + z1) / 2);
      scene.add(rail);
      for (const z of [-1.4, -4.4]) {
        const leg = box(0.08, BELT_Y - 0.1, 0.08, 0xaeaeb2, { metal: 0.5, rough: 0.4 });
        leg.position.set(DIVERT_X + dx, (BELT_Y - 0.1) / 2, z);
        scene.add(leg);
      }
    }
    const stop = box(1.3, 0.3, 0.08, 0xff3b30, { rough: 0.5 });
    stop.position.set(DIVERT_X, BELT_Y + 0.1, z1 - 0.02);
    scene.add(stop);
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 160;
    const g = c.getContext("2d")!;
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, 512, 160);
    g.fillStyle = "#ff3b30";
    g.fillRect(0, 0, 18, 160);
    g.fillStyle = "#1d1d1f";
    g.font = "700 64px -apple-system, system-ui, sans-serif";
    g.fillText("Bag search", 48, 92);
    g.fillStyle = "#6e6e73";
    g.font = "500 30px -apple-system, system-ui, sans-serif";
    g.fillText("Held for an officer", 50, 136);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const signPole = box(0.06, 2.0, 0.06, 0xaeaeb2, { metal: 0.5 });
    signPole.position.set(DIVERT_X + 0.95, 1.0, z1 - 0.1);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.5), new THREE.MeshBasicMaterial({ map: tex }));
    sign.position.set(DIVERT_X + 0.95, 2.1, z1 - 0.06);
    scene.add(signPole, sign);
  }

  /* Diverter */
  const housing = box(0.9, 0.5, 0.45, 0xdcdce0, { round: 0.05 });
  housing.position.set(DIVERT_X, BELT_Y + 0.22, 1.32);
  const stripe = box(0.92, 0.06, 0.02, 0xff9500);
  stripe.position.set(DIVERT_X, BELT_Y + 0.4, 1.555);
  const plate = box(1.1, 0.34, 0.06, 0x3a3a40, { rough: 0.5 });
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 12), new THREE.MeshStandardMaterial({ color: 0xc7c7cc, metalness: 0.7, roughness: 0.25 }));
  rod.rotation.x = Math.PI / 2;
  scene.add(housing, stripe, plate, rod);
  const pusher: { z: number; busy: Bag | null } = { z: 0.95, busy: null };
  function setPusher(z: number) {
    pusher.z = z;
    plate.position.set(DIVERT_X, BELT_Y + 0.22, z);
    const len = Math.max(0.05, 1.1 - z);
    rod.scale.y = len;
    rod.position.set(DIVERT_X, BELT_Y + 0.22, z + len / 2);
  }
  setPusher(0.95);

  /* X-ray machine */
  const machine = new THREE.Group();
  scene.add(machine);
  const shell = 0xe9e9ec;
  const top = box(2.9, 0.5, 2.1, shell, { round: 0.08, rough: 0.5 });
  top.position.y = 2.1;
  machine.add(top);
  for (const z of [-0.92, 0.92]) {
    const side = box(2.9, 1.95, 0.26, shell, { round: 0.06, rough: 0.5 });
    side.position.set(0, 0.98, z);
    machine.add(side);
  }
  const base = box(2.9, 0.42, 1.6, 0xdcdce0, { rough: 0.6 });
  base.position.y = 0.42;
  machine.add(base);
  for (const z of [-1.06, 1.06]) {
    const band = box(2.92, 0.08, 0.02, 0x0071e3, { rough: 0.4 });
    band.position.set(0, 1.62, z);
    machine.add(band);
  }
  const lightMat = new THREE.MeshStandardMaterial({ color: 0x34c759, emissive: 0x34c759, emissiveIntensity: 0.8 });
  const statusLight = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.12, 24), lightMat);
  statusLight.position.set(0.9, 2.42, 0.5);
  machine.add(statusLight);
  const beamMat = new THREE.MeshBasicMaterial({ color: 0x4da3ff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
  const beam = new THREE.Mesh(new THREE.PlaneGeometry(1.55, 1.1), beamMat);
  beam.rotation.y = Math.PI / 2;
  beam.position.set(0, BELT_Y + 0.55, 0);
  machine.add(beam);
  const curtains: { pivot: THREE.Group; cx: number; z: number; angle: number }[] = [];
  const curtainMat = new THREE.MeshStandardMaterial({ color: 0x3a3a40, roughness: 0.8, transparent: true, opacity: 0.88, side: THREE.DoubleSide });
  for (const cx of [-1.46, 1.46]) {
    for (let i = 0; i < 8; i++) {
      const pivot = new THREE.Group();
      pivot.position.set(cx, 1.85, -0.7 + i * 0.2);
      const flap = new THREE.Mesh(new THREE.BoxGeometry(0.012, 1.05, 0.18), curtainMat);
      flap.position.y = -0.525;
      flap.castShadow = true;
      pivot.add(flap);
      machine.add(pivot);
      curtains.push({ pivot, cx, z: pivot.position.z, angle: 0 });
    }
  }

  /* Monitor showing the same image as the side panel */
  const xctx = monitor.getContext("2d")!;
  const monTex = new THREE.CanvasTexture(monitor);
  monTex.colorSpace = THREE.SRGBColorSpace;
  {
    const group = new THREE.Group();
    group.position.set(2.6, 0, -1.7);
    group.rotation.y = -0.35;
    const pole = box(0.08, 1.9, 0.08, 0xaeaeb2, { metal: 0.5 });
    pole.position.y = 0.95;
    const bezel = box(1.75, 1.15, 0.08, 0x1d1d1f, { round: 0.03 });
    bezel.position.y = 2.25;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.0), new THREE.MeshBasicMaterial({ map: monTex }));
    screen.position.set(0, 2.25, 0.045);
    group.add(pole, bezel, screen);
    scene.add(group);
  }

  /* Bags */
  const xrayMats = Object.fromEntries(
    (Object.keys(COLORS) as MaterialKey[]).map((k) => [k, new THREE.MeshBasicMaterial({ color: COLORS[k], transparent: true, opacity: 0.85, depthWrite: false })]),
  ) as Record<MaterialKey, THREE.MeshBasicMaterial>;

  function makeBag(spec: BagSpec, scan: LaneScan, serial: number): Bag {
    const [L, H, W] = spec.size;
    const g = new THREE.Group();
    const shellMat = new THREE.MeshStandardMaterial({ color: spec.color, roughness: 0.55, transparent: true, opacity: 1 });
    const body = new THREE.Mesh(new RoundedBoxGeometry(L, H, W, 4, spec.round ? Math.min(H, W) * 0.45 : 0.06), shellMat);
    body.castShadow = true;
    body.receiveShadow = true;
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.022, 8, 20, Math.PI), shellMat);
    handle.position.set(0, H / 2, 0);
    handle.castShadow = true;
    g.add(body, handle);
    const inner = new THREE.Group();
    inner.visible = false;
    for (const it of spec.items) {
      const iL = it.l * L;
      const iW = it.w * W;
      const iH = Math.max(0.03, it.h * H * 2);
      let m: THREE.Mesh;
      if (it.shape === "cyl") {
        m = new THREE.Mesh(new THREE.CylinderGeometry(iW / 2, iW / 2, iL, 16), xrayMats[it.mat]);
        m.rotation.z = Math.PI / 2;
      } else {
        m = new THREE.Mesh(new THREE.BoxGeometry(iL, iH, iW), xrayMats[it.mat]);
      }
      m.position.set(it.u * L, -H * 0.1, it.v * W);
      inner.add(m);
    }
    g.add(inner);
    g.position.set(-BELT_HALF - 0.6, BELT_Y + H / 2, 0);
    scene.add(g);
    return {
      serial,
      label: `B-${2040 + serial}`,
      spec,
      scan,
      group: g,
      shellMat,
      inner,
      half: L / 2,
      state: "queued",
      mode: "belt",
      pushT: 0,
      scanned: 0,
      doneAt: 0,
      reported: false,
      node: null,
    };
  }

  function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    r = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  function spriteFrom(canvas: HTMLCanvasElement) {
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    sprite.renderOrder = 10;
    return sprite;
  }

  function makeTag(kind: LaneVerdict, text: string) {
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 112;
    const g = c.getContext("2d")!;
    g.font = "600 52px -apple-system, system-ui, sans-serif";
    const w = Math.min(500, g.measureText(text).width + 64);
    g.fillStyle = kind === "threat" ? "#ff3b30" : "#c96f00";
    roundRect(g, (512 - w) / 2, 12, w, 88, 22);
    g.fill();
    g.fillStyle = "#ffffff";
    g.textAlign = "center";
    g.fillText(text, 256, 74);
    const sprite = spriteFrom(c);
    sprite.scale.set(1.5, 0.33, 1);
    return sprite;
  }

  /* The clickable node: a small blue circle with a pulse ring, inviting a click into the 3D view. */
  function makeNode() {
    const core = document.createElement("canvas");
    core.width = 128;
    core.height = 128;
    const g = core.getContext("2d")!;
    g.fillStyle = "#ffffff";
    g.beginPath();
    g.arc(64, 64, 58, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#0071e3";
    g.beginPath();
    g.arc(64, 64, 48, 0, Math.PI * 2);
    g.fill();
    // A small cube glyph: "open in 3D"
    g.strokeStyle = "#ffffff";
    g.lineWidth = 6;
    g.lineJoin = "round";
    g.beginPath();
    g.moveTo(64, 38);
    g.lineTo(86, 50);
    g.lineTo(86, 76);
    g.lineTo(64, 88);
    g.lineTo(42, 76);
    g.lineTo(42, 50);
    g.closePath();
    g.moveTo(42, 50);
    g.lineTo(64, 62);
    g.lineTo(86, 50);
    g.moveTo(64, 62);
    g.lineTo(64, 88);
    g.stroke();
    const halo = document.createElement("canvas");
    halo.width = 128;
    halo.height = 128;
    const h = halo.getContext("2d")!;
    h.strokeStyle = "#0071e3";
    h.lineWidth = 8;
    h.beginPath();
    h.arc(64, 64, 52, 0, Math.PI * 2);
    h.stroke();
    const coreSprite = spriteFrom(core);
    coreSprite.scale.set(0.34, 0.34, 1);
    const haloSprite = spriteFrom(halo);
    haloSprite.scale.set(0.34, 0.34, 1);
    haloSprite.renderOrder = 9;
    return { core: coreSprite, halo: haloSprite };
  }

  /* Monitor */
  function drawMonitor(bag: Bag | null, now: number) {
    const W = monitor.width;
    const H = monitor.height;
    xctx.fillStyle = "#f4f1ea";
    xctx.fillRect(0, 0, W, H);
    if (!bag) {
      xctx.fillStyle = "#86868b";
      xctx.font = "600 22px -apple-system, system-ui, sans-serif";
      xctx.textAlign = "center";
      xctx.fillText("Waiting for the next bag", W / 2, H / 2 + 5);
      xctx.textAlign = "left";
      monTex.needsUpdate = true;
      return;
    }
    // The real scan builds up line by line as the bag crosses the beam, front edge first.
    const s = bag.scan;
    const fit = Math.min((W - 20) / s.width, (H - 20) / s.height);
    const dw = s.width * fit;
    const dh = s.height * fit;
    const dx = (W - dw) / 2;
    const dy = (H - dh) / 2;
    const p = bag.scanned;
    const shown = dw * p;
    if (shown > 0) {
      const sx = s.width * (1 - p);
      xctx.drawImage(s.image, sx, 0, s.width - sx, s.height, dx + dw - shown, dy, shown, dh);
    }
    if (p < 1) {
      xctx.fillStyle = "rgba(0, 113, 227, 0.85)";
      xctx.fillRect(dx + dw - shown - 2, dy, 3, dh);
    }
    if (bag.doneAt && now - bag.doneAt > ANALYSIS_DELAY) {
      for (const d of s.detections) {
        const col = KIND_COLOR[d.kind];
        const bx = dx + d.x * dw;
        const by = dy + d.y * dh;
        xctx.lineWidth = 3;
        xctx.strokeStyle = col;
        xctx.setLineDash(d.kind === "review" ? [10, 6] : []);
        xctx.strokeRect(bx, by, d.w * dw, d.h * dh);
        xctx.setLineDash([]);
        const text = `${d.label} ${d.score.toFixed(2)}`;
        xctx.font = "600 17px -apple-system, system-ui, sans-serif";
        const tw = xctx.measureText(text).width + 16;
        const ty = by > 30 ? by - 28 : by + 4;
        xctx.fillStyle = d.kind === "review" ? "#b25e00" : col;
        roundRect(xctx, bx - 1, ty, tw, 24, 6);
        xctx.fill();
        xctx.fillStyle = "#fff";
        xctx.fillText(text, bx + 7, ty + 18);
      }
    }
    monTex.needsUpdate = true;
  }

  /* Simulation state */
  const bags: Bag[] = [];
  const parked: Bag[] = [];
  const log: Bag[] = [];
  let serial = 1;
  let paused = false;
  let speed = reducedMotion ? 0.6 : 1;
  let follow = false;
  let focusBag: Bag | null = null;
  let cleared = 0;
  let held = 0;
  const lightColor = new THREE.Color(0x34c759);
  const pickCount: Record<LaneVerdict, number> = { threat: 0, review: 0, clear: 0 };

  function entryOf(bag: Bag): LaneLogEntry {
    const status: LaneLogEntry["status"] = bag.reported
      ? bag.scan.verdict
      : bag.state === "scanning"
        ? "scanning"
        : bag.state === "done"
          ? "analyzing"
          : "belt";
    return { serial: bag.serial, label: bag.label, type: bag.spec.type, status, scan: bag.scan };
  }

  let lastEmit = 0;
  let dirty = true;
  function emit(now: number, force = false) {
    // Progress changes every frame, so the panel refreshes at most every 120 ms.
    if (!force && !dirty && now - lastEmit < 120) return;
    lastEmit = now;
    dirty = false;
    const f = focusBag;
    options.onChange({
      focus: f
        ? {
            label: f.label,
            file: f.scan.file,
            progress: f.scanned,
            phase: f.state === "scanning" ? "scanning" : f.reported ? f.scan.verdict : "analyzing",
            scan: f.scan,
          }
        : null,
      log: log.slice(-6).reverse().map(entryOf),
      cleared,
      held,
    });
  }

  function spawn() {
    const scan = options.nextScan();
    if (!scan) return;
    const pool = BAGS.filter((b) => b.verdict === scan.verdict);
    const spec = pool[pickCount[scan.verdict]++ % pool.length];
    const bag = makeBag(spec, scan, serial++);
    bags.push(bag);
    log.push(bag);
    if (log.length > 40) log.shift();
    dirty = true;
  }

  function moveBag(bag: Bag, v: number, dt: number) {
    const g = bag.group;
    const W = bag.spec.size[2];
    if (bag.mode === "belt") {
      g.position.x += v * dt;
      const flagged = bag.reported && bag.scan.verdict !== "clear";
      if (flagged && g.position.x >= DIVERT_X && !pusher.busy) {
        g.position.x = DIVERT_X;
        bag.mode = "push";
        bag.pushT = 0;
        pusher.busy = bag;
      }
    } else if (bag.mode === "push") {
      if (v > 0) bag.pushT += dt * Math.max(0.7, speed);
      const t = Math.min(1, bag.pushT / 0.75);
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      g.position.z = -e * 1.25;
      g.rotation.y = Math.sin(t * Math.PI) * 0.12;
      setPusher(g.position.z + W / 2 + 0.04);
      if (t >= 1) {
        bag.mode = "spur";
        pusher.busy = null;
        g.rotation.y = 0;
        if (parked.length >= SPUR_SLOTS.length) parked.shift()!.mode = "removed";
        parked.push(bag);
        const top = bag.scan.top;
        const tag = makeTag(bag.scan.verdict, bag.scan.verdict === "threat" && top ? `Hold · ${top.label}` : "Look closer");
        tag.position.y = bag.spec.size[1] / 2 + 0.38;
        g.add(tag);
        const node = makeNode();
        // Beside the tag, toward the camera, so neighboring bags' tags never cover it.
        node.core.position.set(0.98, bag.spec.size[1] / 2 + 0.38, 0.1);
        node.halo.position.copy(node.core.position);
        g.add(node.halo, node.core);
        bag.node = node;
      }
    } else if (bag.mode === "spur") {
      const slot = parked.indexOf(bag);
      const target = SPUR_SLOTS[slot] ?? SPUR_SLOTS[SPUR_SLOTS.length - 1];
      const step = Math.max(v, paused ? 0 : 0.25) * dt * 1.2;
      const dz = target - g.position.z;
      g.position.z += Math.sign(dz) * Math.min(Math.abs(dz), step);
      if (Math.abs(dz) > 0.01) for (const r of spurRollers) r.rotation.x += step / 0.05;
    }
  }

  function disposeBag(b: Bag) {
    scene.remove(b.group);
    b.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose();
      const mat = mesh.material as THREE.Material & { map?: THREE.Texture | null };
      if (mat && mat !== b.shellMat && !Object.values(xrayMats).includes(mat as THREE.MeshBasicMaterial)) {
        mat.map?.dispose();
        mat.dispose();
      }
    });
    b.shellMat.dispose();
  }

  function update(dt: number, now: number) {
    const v = 0.9 * speed * (paused ? 0 : 1);
    beltTex.offset.x -= (v * dt) / ((BELT_HALF * 2) / beltTex.repeat.x);
    for (const r of rollers) r.rotation.y -= (v * dt) / 0.06;

    const onBelt = bags.filter((b) => b.mode === "belt");
    const last = onBelt[onBelt.length - 1];
    if (!last || last.group.position.x > -BELT_HALF - 0.6 + SPACING) spawn();

    let beamOn = false;
    for (const bag of bags) {
      moveBag(bag, v, dt);
      const x = bag.group.position.x;
      const inside = bag.mode === "belt" && Math.abs(x) < TUNNEL_HALF + bag.half * 0.2;
      // Inside the tunnel the shell turns see-through and the contents glow in X-ray colors.
      const targetOpacity = inside ? 0.18 : 1;
      bag.shellMat.opacity += (targetOpacity - bag.shellMat.opacity) * Math.min(1, dt * 6);
      bag.shellMat.depthWrite = bag.shellMat.opacity > 0.95;
      bag.inner.visible = bag.shellMat.opacity < 0.9;

      const p = THREE.MathUtils.clamp((x + bag.half) / (bag.half * 2), 0, 1);
      if (p > 0 && bag.scanned < 1) {
        if (bag.state !== "scanning") {
          bag.state = "scanning";
          focusBag = bag;
          dirty = true;
        }
        bag.scanned = p;
        beamOn = true;
        if (p >= 1) {
          bag.state = "done";
          bag.doneAt = now;
        }
      }
      if (bag.state === "done" && !bag.reported && now - bag.doneAt > ANALYSIS_DELAY) {
        bag.reported = true;
        dirty = true;
        if (bag.scan.verdict === "clear") {
          cleared++;
          lightColor.set(0x34c759);
        } else {
          held++;
          lightColor.set(bag.scan.verdict === "threat" ? 0xff3b30 : 0xff9500);
        }
      }
      if (bag.node) {
        // Pulse: the ring grows and fades on a loop; the core breathes slightly.
        const t = ((now / 1300) % 1 + bag.serial * 0.17) % 1;
        const s = 0.34 + t * 0.32;
        bag.node.halo.scale.set(s, s, 1);
        (bag.node.halo.material as THREE.SpriteMaterial).opacity = (1 - t) * 0.8;
        const c = 0.34 + Math.sin(now / 420) * 0.015;
        bag.node.core.scale.set(c, c, 1);
      }
    }
    for (let i = bags.length - 1; i >= 0; i--) {
      const b = bags[i];
      const gone = (b.mode === "belt" && b.group.position.x > BELT_HALF + 1) || b.mode === "removed";
      if (!gone) continue;
      bags.splice(i, 1);
      disposeBag(b);
    }
    if (!pusher.busy && pusher.z < 0.95) setPusher(Math.min(0.95, pusher.z + dt * 2.2));

    for (const c of curtains) {
      let push = 0;
      for (const bag of bags) {
        if (bag.mode !== "belt") continue;
        const dx = bag.group.position.x - c.cx;
        if (Math.abs(dx) < bag.half + 0.12 && Math.abs(c.z) < bag.spec.size[2] / 2 + 0.1) push = 1.05;
      }
      c.angle += (push - c.angle) * Math.min(1, dt * (push ? 9 : 3));
      c.pivot.rotation.z = -c.angle * (1 + Math.sin(now / 180 + c.z * 9) * 0.05 * c.angle);
    }

    beamMat.opacity += ((beamOn ? 0.35 + Math.sin(now / 60) * 0.08 : 0) - beamMat.opacity) * Math.min(1, dt * 8);
    if (beamOn) lightColor.set(0x0071e3);
    lightMat.color.lerp(lightColor, Math.min(1, dt * 6));
    lightMat.emissive.copy(lightMat.color);

    drawMonitor(focusBag, now);
    emit(now);

    if (follow && focusBag) {
      const target = focusBag.group.position;
      controls.target.lerp(new THREE.Vector3(target.x, 1, target.z), Math.min(1, dt * 3));
      camera.position.lerp(new THREE.Vector3(target.x + 3.2, 3.2, target.z + 5.2), Math.min(1, dt * 2));
    }
  }

  /* Click a held bag (or its node) to inspect it */
  const ray = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  function heldBagAt(ev: PointerEvent): Bag | null {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(pointer, camera);
    const candidates = bags.filter((b) => b.mode === "spur");
    const hits = ray.intersectObjects(candidates.map((b) => b.group), true);
    if (!hits.length) return null;
    let o: THREE.Object3D | null = hits[0].object;
    while (o && !candidates.some((b) => b.group === o)) o = o.parent;
    return candidates.find((b) => b.group === o) ?? null;
  }
  let downAt: { x: number; y: number } | null = null;
  const onDown = (e: PointerEvent) => {
    downAt = { x: e.clientX, y: e.clientY };
  };
  const onUp = (e: PointerEvent) => {
    if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 5) return;
    const bag = heldBagAt(e);
    if (bag) options.onInspect(entryOf(bag));
  };
  const onMove = (e: PointerEvent) => {
    if (e.buttons) return;
    renderer.domElement.style.cursor = heldBagAt(e) ? "pointer" : "";
  };
  renderer.domElement.addEventListener("pointerdown", onDown);
  renderer.domElement.addEventListener("pointerup", onUp);
  renderer.domElement.addEventListener("pointermove", onMove);

  function resize() {
    const w = host.clientWidth || 1;
    const h = host.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();

  let simClock = 0;
  let lastT = performance.now();
  let raf = 0;
  const frame = (t: number) => {
    const dt = Math.min(0.05, (t - lastT) / 1000);
    lastT = t;
    simClock += dt * 1000;
    update(dt, simClock);
    controls.update();
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return {
    setPaused(next) {
      paused = next;
    },
    setSpeed(next) {
      speed = next;
    },
    setFollow(next) {
      follow = next;
      if (!next) {
        camera.position.copy(HOME.pos);
        controls.target.copy(HOME.target);
      }
    },
    resize,
    dispose() {
      cancelAnimationFrame(raf);
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      renderer.domElement.removeEventListener("pointermove", onMove);
      controls.dispose();
      for (const b of bags) disposeBag(b);
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        mesh.geometry?.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose();
      });
      beltTex.dispose();
      monTex.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
