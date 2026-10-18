import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import type { Bag, BagItem, BagType } from "../types";

const DIMS: Record<BagType, [number, number, number]> = {
  "cabin-roller": [0.78, 0.62, 0.98],
  backpack: [0.58, 0.74, 0.46],
  duffel: [0.5, 0.38, 1.2],
  tote: [0.52, 0.58, 0.46],
  "hard-shell": [0.72, 0.68, 0.92],
};

const MATERIAL_COLOR: Record<BagItem["material"], number> = {
  organic: 0xe07a32,
  metal: 0x2451d4,
  mixed: 0x2a9a5c,
};

export interface SceneApi {
  setFocus: (id: string | null) => void;
  setSlice: (t: number) => void;
  resize: () => void;
  dispose: () => void;
}

function makeMaterial(item: BagItem, planes: THREE.Plane[], opacity: number) {
  const mat = new THREE.MeshStandardMaterial({
    color: MATERIAL_COLOR[item.material],
    roughness: item.material === "metal" ? 0.35 : 0.72,
    metalness: item.material === "metal" ? 0.45 : 0.02,
    transparent: true,
    opacity,
    clippingPlanes: planes,
    side: THREE.DoubleSide,
  });
  if (item.threat) {
    mat.emissive = new THREE.Color(0xff2233);
    mat.emissiveIntensity = 0.12;
  }
  mat.userData.baseOpacity = opacity;
  return mat;
}

function addMesh(group: THREE.Group, mesh: THREE.Mesh) {
  mesh.renderOrder = 2;
  group.add(mesh);
}

function buildItem(item: BagItem, sx: number, sy: number, sz: number, planes: THREE.Plane[]) {
  const group = new THREE.Group();
  const mat = () => makeMaterial(item, planes, item.material === "organic" ? 0.78 : 0.9);

  switch (item.shape) {
    case "laptop": {
      const thickness = Math.max(sy, 0.045);
      const base = new THREE.Mesh(new THREE.BoxGeometry(sx, thickness, sz), mat());
      const deck = new THREE.Mesh(
        new THREE.BoxGeometry(sx * 0.46, thickness * 0.35, sz * 0.62),
        makeMaterial({ ...item, material: "metal", threat: false }, planes, 0.95),
      );
      deck.position.set(sx * 0.16, thickness * 0.55, sz * 0.04);
      addMesh(group, base);
      addMesh(group, deck);
      break;
    }
    case "handgun": {
      const navy = makeMaterial(item, planes, 0.96);
      navy.color.set(0x16357a);
      navy.emissive.set(0xaa2230);
      navy.emissiveIntensity = 0.18;
      const slide = new THREE.Mesh(new THREE.BoxGeometry(sx * 0.36, sy * 0.24, sz * 0.92), navy);
      slide.position.set(0, sy * 0.22, 0);
      const grip = new THREE.Mesh(new THREE.BoxGeometry(sx * 0.34, sy * 0.58, sz * 0.24), navy);
      grip.position.set(0, -sy * 0.16, -sz * 0.22);
      grip.rotation.x = 0.4;
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(Math.min(sx, sy) * 0.12, Math.min(sx, sy) * 0.12, sz * 0.22, 12), navy);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, sy * 0.24, sz * 0.4);
      addMesh(group, slide);
      addMesh(group, grip);
      addMesh(group, barrel);
      break;
    }
    case "knife": {
      const blade = new THREE.Mesh(
        new THREE.BoxGeometry(Math.max(sx * 0.22, 0.03), Math.max(sy * 0.18, 0.02), sz * 0.62),
        mat(),
      );
      blade.position.z = sz * 0.12;
      const handleMat = makeMaterial({ ...item, material: "organic", threat: false }, planes, 0.92);
      const handle = new THREE.Mesh(
        new THREE.BoxGeometry(Math.max(sx * 0.36, 0.04), Math.max(sy * 0.28, 0.03), sz * 0.28),
        handleMat,
      );
      handle.position.z = -sz * 0.32;
      addMesh(group, blade);
      addMesh(group, handle);
      break;
    }
    case "bottle": {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(sx * 0.28, sx * 0.32, sy * 0.62, 16), mat());
      body.position.y = -sy * 0.08;
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(sx * 0.12, sx * 0.12, sy * 0.28, 12), mat());
      neck.position.y = sy * 0.32;
      const cap = new THREE.Mesh(
        new THREE.CylinderGeometry(sx * 0.14, sx * 0.14, sy * 0.1, 12),
        makeMaterial({ ...item, material: "metal", threat: false }, planes, 0.95),
      );
      cap.position.y = sy * 0.46;
      addMesh(group, body);
      addMesh(group, neck);
      addMesh(group, cap);
      break;
    }
    case "book": {
      const cover = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat());
      addMesh(group, cover);
      break;
    }
    case "tablet": {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(sx, Math.max(sy, 0.025), sz), mat());
      addMesh(group, slab);
      break;
    }
    case "magazine": {
      const body = new THREE.Mesh(new THREE.BoxGeometry(sx * 0.7, sy, sz * 0.55), mat());
      addMesh(group, body);
      break;
    }
    case "shoes": {
      const a = new THREE.Mesh(new THREE.BoxGeometry(sx * 0.42, sy * 0.55, sz * 0.7), mat());
      a.position.x = -sx * 0.18;
      const b = new THREE.Mesh(new THREE.BoxGeometry(sx * 0.42, sy * 0.55, sz * 0.7), mat());
      b.position.x = sx * 0.18;
      addMesh(group, a);
      addMesh(group, b);
      break;
    }
    case "headphones": {
      const band = new THREE.Mesh(new THREE.TorusGeometry(sx * 0.28, 0.012, 8, 18, Math.PI), mat());
      band.rotation.y = Math.PI;
      band.position.y = sy * 0.05;
      const cupGeo = new THREE.CylinderGeometry(sx * 0.1, sx * 0.1, sy * 0.28, 12);
      const left = new THREE.Mesh(cupGeo, mat());
      left.rotation.z = Math.PI / 2;
      left.position.x = -sx * 0.28;
      const right = new THREE.Mesh(cupGeo, mat());
      right.rotation.z = Math.PI / 2;
      right.position.x = sx * 0.28;
      addMesh(group, band);
      addMesh(group, left);
      addMesh(group, right);
      break;
    }
    case "keys": {
      for (let i = 0; i < 3; i += 1) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.005, 8, 14), mat());
        ring.position.set((i - 1) * sx * 0.28, 0, (i - 1) * sz * 0.15);
        addMesh(group, ring);
      }
      break;
    }
    case "umbrella":
    case "cable": {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-sz * 0.4, 0, 0),
        new THREE.Vector3(-sz * 0.1, sy * 0.2, sx * 0.1),
        new THREE.Vector3(sz * 0.15, -sy * 0.1, -sx * 0.05),
        new THREE.Vector3(sz * 0.4, 0, 0),
      ]);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.008, 6, false), mat());
      addMesh(group, tube);
      break;
    }
    case "clothing":
    default: {
      const blob = new THREE.Mesh(new THREE.SphereGeometry(0.5, 20, 14), mat());
      blob.scale.set(sx * 0.8, sy * 0.45, sz * 0.8);
      addMesh(group, blob);
      break;
    }
  }

  const points = buildPoints(item, sx, sy, sz, planes);
  group.add(points);

  const wire = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(sx * 1.12, sy * 1.12, sz * 1.12)),
    new THREE.LineBasicMaterial({
      color: item.threat ? 0xff2438 : 0x2451d4,
      transparent: true,
      opacity: item.threat ? 1 : 0.85,
      clippingPlanes: planes,
    }),
  );
  wire.userData.threatWire = item.threat;
  wire.userData.baseOpacity = item.threat ? 1 : 0.85;
  if (!item.threat && item.material === "organic") wire.visible = false;
  wire.renderOrder = 3;
  group.add(wire);

  const hit = new THREE.Mesh(
    new THREE.BoxGeometry(sx * 1.12, sy * 1.12, sz * 1.12),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
  );
  hit.userData.baseOpacity = 0;
  group.add(hit);

  return group;
}

function buildPoints(item: BagItem, sx: number, sy: number, sz: number, planes: THREE.Plane[]) {
  const count = item.material === "organic" ? 48 : 36;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const base = new THREE.Color(MATERIAL_COLOR[item.material]);
  const hot = new THREE.Color(0xff3344);
  for (let i = 0; i < count; i += 1) {
    positions[i * 3] = (Math.random() - 0.5) * sx;
    positions[i * 3 + 1] = (Math.random() - 0.5) * sy;
    positions[i * 3 + 2] = (Math.random() - 0.5) * sz;
    const color = item.threat && i % 3 === 0 ? hot : base;
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const points = new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      size: 0.012,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      clippingPlanes: planes,
      depthWrite: false,
    }),
  );
  const pointMaterial = points.material as THREE.PointsMaterial;
  pointMaterial.userData.baseOpacity = 0.9;
  points.raycast = () => undefined;
  return points;
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
    else if (material) material.dispose();
  });
}

export function mountScene(
  host: HTMLElement,
  bag: Bag,
  onSelect: (id: string | null) => void,
): SceneApi {
  const [W, H, D] = DIMS[bag.type];
  const scene = new THREE.Scene();
  scene.background = null;

  const camera = new THREE.PerspectiveCamera(34, 1, 0.05, 40);
  const radius = Math.max(W, H, D);
  const home = new THREE.Vector3(radius * 1.2, radius * 0.58, radius * 1.28);
  camera.position.copy(home);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.localClippingEnabled = true;
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
  controls.target.set(0, 0, 0);
  controls.minDistance = radius * 0.45;
  controls.maxDistance = radius * 3.2;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.update();

  scene.add(new THREE.HemisphereLight(0xffffff, 0xd8d8de, 1.05));
  const key = new THREE.DirectionalLight(0xffffff, 1.35);
  key.position.set(3, 4, 2);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xe8eef8, 0.45);
  fill.position.set(-3, 1.5, -2);
  scene.add(fill);

  const clip = new THREE.Plane(new THREE.Vector3(0, -1, 0), H);
  const planes = [clip];

  const root = new THREE.Group();
  scene.add(root);

  const shell = new THREE.Mesh(
    new THREE.BoxGeometry(W, H, D),
    new THREE.MeshStandardMaterial({
      color: 0xc47a3c,
      transparent: true,
      opacity: 0.34,
      roughness: 0.42,
      depthWrite: false,
      side: THREE.DoubleSide,
      clippingPlanes: planes,
    }),
  );
  shell.userData.baseOpacity = 0.34;
  shell.renderOrder = 1;
  shell.raycast = () => undefined;
  root.add(shell);

  const shellEdge = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(W, H, D)),
    new THREE.LineBasicMaterial({ color: 0x1c3f78, transparent: true, opacity: 0.9 }),
  );
  shellEdge.userData.baseOpacity = 0.9;
  root.add(shellEdge);

  if (bag.type === "cabin-roller" || bag.type === "hard-shell") {
    const handleMat = new THREE.MeshStandardMaterial({ color: 0x1c3f78 });
    const grip = new THREE.Mesh(new THREE.BoxGeometry(W * 0.34, 0.025, 0.03), handleMat);
    grip.position.set(0, H / 2 + 0.07, -D * 0.08);
    const postGeo = new THREE.BoxGeometry(0.02, 0.08, 0.02);
    const left = new THREE.Mesh(postGeo, handleMat);
    left.position.set(-W * 0.16, H / 2 + 0.03, -D * 0.08);
    const right = new THREE.Mesh(postGeo, handleMat);
    right.position.set(W * 0.16, H / 2 + 0.03, -D * 0.08);
    root.add(grip, left, right);
  }

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(Math.max(W, D) * 0.62, 40),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.08, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -H / 2 - 0.06;
  scene.add(shadow);

  const groups = new Map<string, THREE.Group>();
  const labelEls = new Map<string, HTMLDivElement>();

  for (const item of bag.items) {
    const sx = Math.max(item.w * W * 0.82, 0.06);
    const sy = Math.max(item.h * H * 0.82, 0.05);
    const sz = Math.max(item.d * D * 0.82, 0.06);
    const group = buildItem(item, sx, sy, sz, planes);
    group.position.set((item.x - 0.5) * W * 0.56, (item.y - 0.5) * H * 0.56, (item.z - 0.5) * D * 0.56);
    group.rotation.y = (item.yaw * Math.PI) / 180;
    group.userData.itemId = item.id;

    const div = document.createElement("div");
    div.className = item.threat ? "obj-label threat" : "obj-label";
    div.textContent = `${item.label} ${item.confidence.toFixed(3)}`;
    const label = new CSS2DObject(div);
    label.position.set(0, sy * 0.7 + 0.04, 0);
    group.add(label);
    labelEls.set(item.id, div);

    root.add(group);
    groups.set(item.id, group);
  }

  let focusId: string | null = null;
  let lerpFrom = performance.now();
  let lerpMs = 0;
  const camFrom = new THREE.Vector3();
  const camTo = new THREE.Vector3();
  const tgtFrom = new THREE.Vector3();
  const tgtTo = new THREE.Vector3();
  let spinning = true;
  let frame = 0;

  const applyOpacity = (object: THREE.Object3D, scale: number) => {
    object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      const material = mesh.material;
      const list = Array.isArray(material) ? material : material ? [material] : [];
      for (const entry of list) {
        const base = entry.userData.baseOpacity as number | undefined;
        if (base === undefined || !("opacity" in entry)) continue;
        entry.opacity = base * scale;
        entry.transparent = true;
      }
    });
  };

  const emphasize = () => {
    for (const [id, group] of groups) {
      const scale = focusId && focusId !== id ? 0.22 : 1;
      applyOpacity(group, scale);
      const label = labelEls.get(id);
      const item = bag.items.find((entry) => entry.id === id);
      if (label) {
        const show = focusId === id || Boolean(item?.threat);
        label.style.opacity = show ? "1" : "0";
      }
    }
  };

  const setFocus = (id: string | null) => {
    focusId = id;
    emphasize();
    camFrom.copy(camera.position);
    tgtFrom.copy(controls.target);
    if (id && groups.has(id)) {
      const point = new THREE.Vector3();
      groups.get(id)!.getWorldPosition(point);
      tgtTo.copy(point);
      const offset = new THREE.Vector3(radius * 0.95, radius * 0.5, radius * 1.05);
      camTo.copy(point).add(offset);
    } else {
      tgtTo.set(0, 0, 0);
      camTo.copy(home);
    }
    lerpFrom = performance.now();
    lerpMs = 680;
  };

  const setSlice = (t: number) => {
    const clamped = Math.min(1, Math.max(0, t));
    clip.constant = THREE.MathUtils.lerp(-H / 2 - 0.02, H / 2 + 0.2, clamped);
  };

  const resize = () => {
    const width = host.clientWidth || 1;
    const height = host.clientHeight || 1;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    labels.setSize(width, height);
  };

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let moved = false;
  let downX = 0;
  let downY = 0;

  const onPointerDown = (event: PointerEvent) => {
    spinning = false;
    lerpMs = 0;
    moved = false;
    downX = event.clientX;
    downY = event.clientY;
  };
  const onPointerMove = (event: PointerEvent) => {
    if (Math.hypot(event.clientX - downX, event.clientY - downY) > 5) moved = true;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObject(root, true);
    const hitItem = hits.some((hit) => findItemId(hit.object));
    renderer.domElement.style.cursor = hitItem ? "pointer" : "grab";
  };
  const onPointerUp = (event: PointerEvent) => {
    if (moved) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObject(root, true);
    for (const hit of hits) {
      const id = findItemId(hit.object);
      if (id) {
        onSelect(id);
        return;
      }
    }
  };

  renderer.domElement.addEventListener("pointerdown", onPointerDown);
  renderer.domElement.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);

  const clock = new THREE.Clock();
  const animate = () => {
    frame = window.requestAnimationFrame(animate);
    const elapsed = clock.getElapsedTime();
    if (spinning) root.rotation.y = -0.72 + Math.sin(elapsed * 0.35) * 0.06;

    root.traverse((child) => {
      if (child.userData.threatWire && child instanceof THREE.LineSegments) {
        const material = child.material as THREE.LineBasicMaterial;
        const base = (material.userData.baseOpacity as number) || 1;
        const dim = focusId ? base : base;
        material.opacity = dim * (0.65 + 0.35 * Math.sin(elapsed * 4));
      }
    });

    if (lerpMs > 0) {
      const t = Math.min(1, (performance.now() - lerpFrom) / lerpMs);
      const eased = 1 - (1 - t) ** 3;
      camera.position.lerpVectors(camFrom, camTo, eased);
      controls.target.lerpVectors(tgtFrom, tgtTo, eased);
      if (t >= 1) lerpMs = 0;
    }
    controls.update();
    renderer.render(scene, camera);
    labels.render(scene, camera);
  };

  resize();
  setSlice(1);
  emphasize();
  animate();

  return {
    setFocus,
    setSlice,
    resize,
    dispose: () => {
      window.cancelAnimationFrame(frame);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      controls.dispose();
      disposeObject(scene);
      renderer.dispose();
      host.replaceChildren();
    },
  };
}

function findItemId(object: THREE.Object3D | null): string | null {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (typeof current.userData.itemId === "string") return current.userData.itemId;
    current = current.parent;
  }
  return null;
}
