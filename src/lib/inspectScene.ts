import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { LaneScan } from "./laneScene";

/**
 * A held bag's real scan as a 3D density model: darker, denser pixels rise higher, colored
 * with the scan's own colors. The model's boxes stand over it as frames as tall as the
 * densest point inside them. A visualization of one 2D X-ray, not a CT reconstruction.
 */
export function mountInspect(host: HTMLElement, scan: LaneScan, reducedMotion: boolean): { dispose: () => void } {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.style.display = "block";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf5f5f7);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xcfcfd6, 1.3));
  const light = new THREE.DirectionalLight(0xffffff, 1.5);
  light.position.set(1.5, 3, 1.2);
  scene.add(light);
  const base = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), new THREE.MeshStandardMaterial({ color: 0xe8e8ed, roughness: 1 }));
  base.rotation.x = -Math.PI / 2;
  base.position.y = -0.005;
  scene.add(base);

  const camera = new THREE.PerspectiveCamera(36, 1, 0.05, 30);
  camera.position.set(2.2, 2.0, 2.5);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.1, 0);
  controls.enableDamping = true;
  controls.minDistance = 1.2;
  controls.maxDistance = 6;
  controls.maxPolarAngle = Math.PI * 0.48;
  controls.autoRotate = !reducedMotion;
  controls.autoRotateSpeed = 1.2;
  const stopSpin = () => {
    controls.autoRotate = false;
  };
  controls.addEventListener("start", stopSpin);

  // Sample the scan onto a grid; density is how dark each pixel is, with the empty belt at zero.
  const gx = 160;
  const gy = Math.max(24, Math.round((gx * scan.height) / scan.width));
  const c = document.createElement("canvas");
  c.width = gx;
  c.height = gy;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(scan.image, 0, 0, gx, gy);
  const px = g.getImageData(0, 0, gx, gy).data;
  const W = 2.0;
  const D = (W * scan.height) / scan.width;
  const geo = new THREE.PlaneGeometry(W, D, gx - 1, gy - 1);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const colors = new Float32Array(gx * gy * 3);
  const dens = new Float32Array(gx * gy);
  for (let i = 0; i < gx * gy; i++) {
    const r = px[i * 4];
    const gg = px[i * 4 + 1];
    const b = px[i * 4 + 2];
    const lum = (0.299 * r + 0.587 * gg + 0.114 * b) / 255;
    const paper = lum > 0.84 && Math.max(r, gg, b) - Math.min(r, gg, b) < 40;
    dens[i] = paper ? 0 : Math.min(1, (1 - lum) * 1.35);
    colors[i * 3] = Math.pow(r / 255, 1.3);
    colors[i * 3 + 1] = Math.pow(gg / 255, 1.3);
    colors[i * 3 + 2] = Math.pow(b / 255, 1.3);
  }
  const height = new Float32Array(gx * gy);
  for (let y = 0; y < gy; y++) {
    for (let x = 0; x < gx; x++) {
      let sum = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= gx || yy >= gy) continue;
          sum += dens[yy * gx + xx];
          n++;
        }
      }
      height[y * gx + x] = (sum / n) * 0.45;
      pos.setY(y * gx + x, height[y * gx + x]);
    }
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, side: THREE.DoubleSide });
  const terrain = new THREE.Mesh(geo, terrainMat);
  terrain.scale.y = reducedMotion ? 1 : 0.02;
  scene.add(terrain);

  for (const d of scan.detections) {
    if (d.kind === "benign") continue;
    let peak = 0.08;
    for (let y = Math.floor(d.y * gy); y < Math.min(gy, Math.ceil((d.y + d.h) * gy)); y++) {
      for (let x = Math.floor(d.x * gx); x < Math.min(gx, Math.ceil((d.x + d.w) * gx)); x++) {
        peak = Math.max(peak, height[y * gx + x]);
      }
    }
    const h = peak + 0.06;
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(d.w * W, h, d.h * D)),
      new THREE.LineBasicMaterial({ color: d.kind === "threat" ? 0xff3b30 : 0xff9500 }),
    );
    edges.position.set((d.x + d.w / 2 - 0.5) * W, h / 2, (d.y + d.h / 2 - 0.5) * D);
    scene.add(edges);
  }

  const observer = new ResizeObserver(() => {
    const w = host.clientWidth || 1;
    const h = host.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  });
  observer.observe(host);

  let raf = 0;
  let last = performance.now();
  const frame = (t: number) => {
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    // The model rises into place when the panel opens.
    terrain.scale.y += (1 - terrain.scale.y) * Math.min(1, dt * 3);
    controls.update();
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return {
    dispose() {
      cancelAnimationFrame(raf);
      observer.disconnect();
      controls.removeEventListener("start", stopSpin);
      controls.dispose();
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        mesh.geometry?.dispose();
        const mat = mesh.material as THREE.Material | undefined;
        mat?.dispose();
      });
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
