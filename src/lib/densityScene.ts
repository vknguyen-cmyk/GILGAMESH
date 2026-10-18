import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import type { Detection } from "../types";
import { toneOf, type RealScan } from "./realScan";

/**
 * 3D view of a real 2D X-ray built only from what the image contains.
 *
 * - Landscape: darker pixels absorbed more X-rays, so they rise higher.
 *   Height shows how much material the beam passed through, not where it sits in depth.
 * - Layers: pixels are split by their dual-energy color into organic, mixed, and metal
 *   sheets that can be pulled apart.
 *
 * It is a visualization, not a reconstruction: a single projection has no depth.
 */

export type DensityMode = "landscape" | "layers";

export interface DensityApi {
  setMode: (mode: DensityMode) => void;
  setHeight: (t: number) => void;
  setFocus: (id: string | null) => void;
  resize: () => void;
  dispose: () => void;
}

const GRID_MAX = 220;
const WIDTH = 1.6;
const LAYER_ORDER = ["organic", "mixed", "metal"] as const;
const LAYER_LABEL: Record<(typeof LAYER_ORDER)[number], string> = {
  organic: "Organic",
  mixed: "Mixed",
  metal: "Metal",
};

interface Grid {
  cols: number;
  rows: number;
  density: Float32Array;
  rgb: Float32Array;
  tone: Array<ReturnType<typeof toneOf>>;
}

/** Sample the scan onto a coarse grid with density = how dark the pixel is. */
function buildGrid(scan: RealScan): Grid {
  const { width, height, data } = scan.sample;
  const step = Math.max(1, Math.ceil(Math.max(width, height) / GRID_MAX));
  const cols = Math.max(2, Math.floor(width / step));
  const rows = Math.max(2, Math.floor(height / step));
  const raw = new Float32Array(cols * rows);
  const rgb = new Float32Array(cols * rows * 3);
  const tone: Grid["tone"] = new Array(cols * rows);
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let n = 0;
      for (let y = r * step; y < Math.min(height, (r + 1) * step); y += 1) {
        for (let x = c * step; x < Math.min(width, (c + 1) * step); x += 1) {
          const i = (y * width + x) * 4;
          sr += data[i];
          sg += data[i + 1];
          sb += data[i + 2];
          n += 1;
        }
      }
      const R = sr / n;
      const G = sg / n;
      const B = sb / n;
      const k = r * cols + c;
      const t = toneOf(R, G, B);
      tone[k] = t;
      // Perceived brightness; near-white belt counts as empty.
      const lum = (0.299 * R + 0.587 * G + 0.114 * B) / 255;
      raw[k] = t === "background" ? 0 : Math.max(0, Math.min(1, (1 - lum) * 1.25));
      rgb[k * 3] = R / 255;
      rgb[k * 3 + 1] = G / 255;
      rgb[k * 3 + 2] = B / 255;
    }
  }
  // Light 3x3 blur so the surface reads as terrain rather than noise.
  const density = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      let s = 0;
      let n = 0;
      for (let dr = -1; dr <= 1; dr += 1) {
        for (let dc = -1; dc <= 1; dc += 1) {
          const rr = r + dr;
          const cc = c + dc;
          if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
          s += raw[rr * cols + cc];
          n += 1;
        }
      }
      density[r * cols + c] = s / n;
    }
  }
  return { cols, rows, density, rgb, tone };
}

function label(text: string, className: string) {
  const el = document.createElement("div");
  el.className = className;
  el.textContent = text;
  return new CSS2DObject(el);
}

export function mountDensityScene(
  host: HTMLElement,
  scan: RealScan,
  detections: Detection[],
  onSelect: (id: string | null) => void,
): DensityApi {
  const grid = buildGrid(scan);
  const W = WIDTH;
  const D = (WIDTH * scan.height) / scan.width;
  let heightScale = 0.32;
  let mode: DensityMode = "landscape";

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf5f5f7);
  const camera = new THREE.PerspectiveCamera(34, 1, 0.02, 40);
  const radius = Math.max(W, D);
  const homeLandscape = new THREE.Vector3(0, radius * 0.95, radius * 1.15);
  const homeLayers = new THREE.Vector3(radius * 0.9, radius * 1.1, radius * 1.9);
  let home = homeLandscape;
  camera.position.copy(home);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  renderer.domElement.style.display = "block";
  host.appendChild(renderer.domElement);

  const labels = new CSS2DRenderer();
  labels.domElement.style.position = "absolute";
  labels.domElement.style.inset = "0";
  labels.domElement.style.pointerEvents = "none";
  host.appendChild(labels.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = radius * 0.3;
  controls.maxDistance = radius * 4;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.target.set(0, 0, 0);
  controls.update();

  scene.add(new THREE.HemisphereLight(0xffffff, 0xd8d8de, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(1.5, 3, 1.2);
  scene.add(key);

  // Base plate the scan sits on.
  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(W * 1.04, D * 1.04),
    new THREE.MeshStandardMaterial({ color: 0xe9e6df, roughness: 0.9 }),
  );
  plate.rotation.x = -Math.PI / 2;
  plate.position.y = -0.002;
  plate.raycast = () => undefined;
  scene.add(plate);

  // Landscape surface.
  const geo = new THREE.PlaneGeometry(W, D, grid.cols - 1, grid.rows - 1);
  geo.rotateX(-Math.PI / 2);
  const colors = new Float32Array(grid.cols * grid.rows * 3);
  for (let k = 0; k < grid.cols * grid.rows; k += 1) {
    // Deepen colors slightly so pale regions don't wash out under the lights.
    colors[k * 3] = Math.pow(grid.rgb[k * 3], 1.25);
    colors[k * 3 + 1] = Math.pow(grid.rgb[k * 3 + 1], 1.25);
    colors[k * 3 + 2] = Math.pow(grid.rgb[k * 3 + 2], 1.25);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const surface = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65, side: THREE.DoubleSide }),
  );
  surface.raycast = () => undefined;
  scene.add(surface);

  function applyHeights() {
    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    for (let k = 0; k < grid.cols * grid.rows; k += 1) pos.setY(k, grid.density[k] * heightScale);
    pos.needsUpdate = true;
    geo.computeVertexNormals();
  }

  // Material layers: one point sheet per dual-energy color.
  const layers = new THREE.Group();
  const layerLabels: CSS2DObject[] = [];
  LAYER_ORDER.forEach((name) => {
    const positions: number[] = [];
    const cols: number[] = [];
    for (let r = 0; r < grid.rows; r += 1) {
      for (let c = 0; c < grid.cols; c += 1) {
        const k = r * grid.cols + c;
        if (grid.tone[k] !== name) continue;
        positions.push((c / (grid.cols - 1) - 0.5) * W, 0, (r / (grid.rows - 1) - 0.5) * D);
        cols.push(colors[k * 3], colors[k * 3 + 1], colors[k * 3 + 2]);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.016, vertexColors: true }));
    pts.userData.layer = name;
    const frame = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(W, D).rotateX(-Math.PI / 2)),
      new THREE.LineBasicMaterial({ color: 0x8a94a6, transparent: true, opacity: 0.6 }),
    );
    const sheet = new THREE.Group();
    sheet.add(pts, frame);
    const tag = label(LAYER_LABEL[name], "density-layer-tag");
    tag.position.set(-W / 2, 0, -D / 2);
    sheet.add(tag);
    layerLabels.push(tag);
    sheet.userData.layer = name;
    layers.add(sheet);
  });
  scene.add(layers);

  function applyLayers() {
    const gap = 0.04 + heightScale * 0.45;
    layers.children.forEach((sheet, i) => {
      sheet.position.y = i * gap;
    });
  }

  // Detection boxes, sized from the model's box and the densest point under it.
  const boxes = new Map<string, { group: THREE.Group; center: THREE.Vector3; peak: number; threat: boolean }>();
  detections.forEach((det) => {
    if (!det.box) return;
    const b = det.box;
    const c0 = Math.max(0, Math.floor(b.x * grid.cols));
    const c1 = Math.min(grid.cols - 1, Math.ceil((b.x + b.w) * grid.cols));
    const r0 = Math.max(0, Math.floor(b.y * grid.rows));
    const r1 = Math.min(grid.rows - 1, Math.ceil((b.y + b.h) * grid.rows));
    let peak = 0.2;
    for (let r = r0; r <= r1; r += 1) {
      for (let c = c0; c <= c1; c += 1) peak = Math.max(peak, grid.density[r * grid.cols + c]);
    }
    const group = new THREE.Group();
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({ color: det.threat ? 0xff3142 : 0x2f62ff }),
    );
    const fillBox = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({
        color: det.threat ? 0xff3142 : 0x2f62ff,
        transparent: true,
        opacity: 0.08,
        depthWrite: false,
      }),
    );
    fillBox.userData.detectionId = det.itemId;
    group.add(edges, fillBox);
    const tag = label(`${det.label} ${det.confidence.toFixed(2)}`, `density-tag ${det.threat ? "threat" : ""}`);
    group.add(tag);
    const center = new THREE.Vector3((b.x + b.w / 2 - 0.5) * W, 0, (b.y + b.h / 2 - 0.5) * D);
    group.position.copy(center);
    group.scale.set(b.w * W, 1, b.h * D);
    group.userData.tag = tag;
    scene.add(group);
    boxes.set(det.itemId, { group, center, peak, threat: det.threat });
  });

  function applyBoxes() {
    boxes.forEach(({ group, peak }) => {
      const top = mode === "landscape" ? peak * heightScale + 0.04 : layers.children[2].position.y + 0.06;
      group.scale.y = Math.max(0.04, top);
      group.position.y = group.scale.y / 2;
      const tag = group.userData.tag as CSS2DObject;
      tag.position.set(0, 0.5 + 0.04 / group.scale.y, 0);
    });
  }

  function applyMode() {
    surface.visible = mode === "landscape";
    plate.visible = mode === "landscape";
    layers.visible = mode === "layers";
    layerLabels.forEach((t) => (t.visible = mode === "layers"));
    applyLayers();
    applyBoxes();
  }

  applyHeights();
  applyMode();

  // Click a box to select it.
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let downAt: { x: number; y: number } | null = null;
  const onDown = (e: PointerEvent) => (downAt = { x: e.clientX, y: e.clientY });
  const onUp = (e: PointerEvent) => {
    if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 5) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const targets: THREE.Object3D[] = [];
    boxes.forEach(({ group }) => targets.push(group.children[1]));
    const hit = raycaster.intersectObjects(targets, false)[0];
    onSelect(hit ? (hit.object.userData.detectionId as string) : null);
  };
  renderer.domElement.addEventListener("pointerdown", onDown);
  renderer.domElement.addEventListener("pointerup", onUp);

  let goalTarget = new THREE.Vector3(0, 0, 0);
  let goalPos: THREE.Vector3 | null = null;
  let focusId: string | null = null;

  function setFocus(id: string | null) {
    focusId = id;
    boxes.forEach(({ group }, key) => {
      const mat = (group.children[1] as THREE.Mesh).material as THREE.MeshBasicMaterial;
      mat.opacity = key === id ? 0.22 : 0.08;
    });
    const entry = id ? boxes.get(id) : undefined;
    if (!entry) {
      const mid = mode === "layers" ? layers.children[1].position.y : 0;
      goalTarget = new THREE.Vector3(0, mid, 0);
      goalPos = home.clone().setY(home.y + mid);
      return;
    }
    const size = Math.max(entry.group.scale.x, entry.group.scale.z, 0.15);
    goalTarget = entry.center.clone().setY(entry.group.scale.y / 2);
    goalPos = goalTarget.clone().add(new THREE.Vector3(size * 1.2, size * 1.6, size * 2));
  }

  function resize() {
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    labels.setSize(w, h);
  }
  resize();

  let frame = 0;
  const tick = () => {
    frame = requestAnimationFrame(tick);
    controls.target.lerp(goalTarget, 0.12);
    if (goalPos) {
      camera.position.lerp(goalPos, 0.12);
      if (camera.position.distanceTo(goalPos) < 0.003) goalPos = null;
    }
    controls.update();
    renderer.render(scene, camera);
    labels.render(scene, camera);
  };
  tick();

  return {
    setMode(next) {
      mode = next;
      home = next === "layers" ? homeLayers : homeLandscape;
      applyMode();
      setFocus(focusId);
    },
    setHeight(t) {
      heightScale = 0.05 + t * 0.6;
      applyHeights();
      applyLayers();
      applyBoxes();
    },
    setFocus,
    resize,
    dispose() {
      cancelAnimationFrame(frame);
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      controls.dispose();
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        mesh.geometry?.dispose?.();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose?.();
      });
      renderer.dispose();
      renderer.domElement.remove();
      labels.domElement.remove();
    },
  };
}
