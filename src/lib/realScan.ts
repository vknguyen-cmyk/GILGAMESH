import type { Analysis, Detection, Material, MaterialFilter, Rect } from "../types";
import type { LoadedModel } from "./detector";
import type { RawDetection } from "./yolo";

/** A real X-ray image the officer dropped into the lane. */
export interface RealScan {
  id: string;
  fileName: string;
  bitmap: ImageBitmap;
  width: number;
  height: number;
  /** Downsampled RGBA copy used for material estimates and filters. */
  sample: { width: number; height: number; data: Uint8ClampedArray };
  /** False for grayscale scans that carry no dual-energy colors. */
  colorful: boolean;
}

const SAMPLE_MAX = 384;

let counter = 0;

export async function loadScan(file: File): Promise<RealScan> {
  if (!file.type.startsWith("image/")) {
    throw new Error(`${file.name} isn't an image. Use PNG, JPG, WebP, or BMP.`);
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(`Couldn't decode ${file.name}. TIFF and DICOS need converting to PNG or JPG first.`);
  }
  const scale = Math.min(1, SAMPLE_MAX / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D is unavailable in this browser.");
  ctx.drawImage(bitmap, 0, 0, width, height);
  const data = ctx.getImageData(0, 0, width, height).data;

  counter += 1;
  return {
    id: `X-${String(counter).padStart(3, "0")}`,
    fileName: file.name,
    bitmap,
    width: bitmap.width,
    height: bitmap.height,
    sample: { width, height, data },
    colorful: colorShare(data) > 0.04,
  };
}

type Tone = Material | "background" | "gray";

/**
 * Classify one pixel by the pseudo-color a dual-energy scanner paints it.
 * Orange is organic, green is mixed, blue is metal. Near-white is empty belt.
 */
function toneOf(r: number, g: number, b: number): Tone {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (min > 232) return "background";
  const saturation = max === 0 ? 0 : (max - min) / max;
  if (saturation < 0.18 || max - min < 22) return "gray";
  let hue: number;
  if (max === r) hue = ((g - b) / (max - min)) % 6;
  else if (max === g) hue = (b - r) / (max - min) + 2;
  else hue = (r - g) / (max - min) + 4;
  hue *= 60;
  if (hue < 0) hue += 360;
  if (hue < 55 || hue >= 330) return "organic";
  if (hue < 170) return "mixed";
  return "metal";
}

function colorShare(data: Uint8ClampedArray): number {
  let colored = 0;
  let total = 0;
  for (let i = 0; i < data.length; i += 16) {
    const tone = toneOf(data[i], data[i + 1], data[i + 2]);
    if (tone === "background") continue;
    total += 1;
    if (tone !== "gray") colored += 1;
  }
  return total === 0 ? 0 : colored / total;
}

/** Dominant material color inside a box, or "unknown" on grayscale scans. */
export function estimateMaterial(scan: RealScan, box: Rect): Material | "unknown" {
  if (!scan.colorful) return "unknown";
  const { width, height, data } = scan.sample;
  const x0 = Math.max(0, Math.floor(box.x * width));
  const y0 = Math.max(0, Math.floor(box.y * height));
  const x1 = Math.min(width, Math.ceil((box.x + box.w) * width));
  const y1 = Math.min(height, Math.ceil((box.y + box.h) * height));
  const counts: Record<Material, number> = { organic: 0, mixed: 0, metal: 0 };
  let colored = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * width + x) * 4;
      const tone = toneOf(data[i], data[i + 1], data[i + 2]);
      if (tone === "background" || tone === "gray") continue;
      counts[tone] += 1;
      colored += 1;
    }
  }
  if (colored < 6) return "unknown";
  // Metal reads blue only where it is dense, so a smaller share still counts.
  if (counts.metal >= colored * 0.3) return "metal";
  return counts.organic >= counts.mixed ? "organic" : "mixed";
}

/**
 * Build the console's Analysis from raw detections and the current alarm threshold.
 * Re-run on every slider move; it doesn't call the model again.
 */
export function buildRealAnalysis(
  scan: RealScan,
  raw: RawDetection[],
  model: LoadedModel,
  threshold: number,
  elapsedMs: number,
): Analysis {
  const detections: Detection[] = raw
    .filter((entry) => entry.score >= threshold)
    .map((entry, index) => {
      const box = { x: entry.x, y: entry.y, w: entry.w, h: entry.h };
      return {
        itemId: `${scan.id}-${index}`,
        label: entry.label,
        confidence: entry.score,
        threat: model.threatSet.has(entry.label.toLowerCase()),
        material: estimateMaterial(scan, box),
        box,
      };
    })
    .sort((a, b) => Number(b.threat) - Number(a.threat) || b.confidence - a.confidence);
  const threatCount = detections.filter((entry) => entry.threat).length;
  return {
    bagId: scan.id,
    detections,
    verdict: threatCount > 0 ? "threat" : "clear",
    threatCount,
    elapsedMs,
  };
}

const PAPER: [number, number, number] = [244, 241, 234];

/**
 * Draw a real scan into the plate, fitted without cropping, and apply the
 * Organic or Metal filter by fading pixels of other colors.
 * Returns where the image landed, normalized to the plate.
 */
export function renderRealXray(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  scan: RealScan,
  filter: MaterialFilter,
): Rect {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = `rgb(${PAPER.join(",")})`;
  ctx.fillRect(0, 0, width, height);

  const pad = 10;
  const scale = Math.min((width - pad * 2) / scan.width, (height - pad * 2) / scan.height);
  const drawW = scan.width * scale;
  const drawH = scan.height * scale;
  const x = (width - drawW) / 2;
  const y = (height - drawH) / 2;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(scan.bitmap, x, y, drawW, drawH);

  if (filter !== "all" && scan.colorful) {
    const dpr = ctx.getTransform().a || 1;
    const px = Math.max(0, Math.floor(x * dpr));
    const py = Math.max(0, Math.floor(y * dpr));
    const pw = Math.max(1, Math.min(ctx.canvas.width - px, Math.ceil(drawW * dpr)));
    const ph = Math.max(1, Math.min(ctx.canvas.height - py, Math.ceil(drawH * dpr)));
    const image = ctx.getImageData(px, py, pw, ph);
    const data = image.data;
    for (let i = 0; i < data.length; i += 4) {
      const tone = toneOf(data[i], data[i + 1], data[i + 2]);
      let keep: number;
      if (tone === "background") keep = 1;
      else if (tone === filter) keep = 1;
      else if (tone === "mixed") keep = 0.4;
      else keep = 0.08;
      if (keep === 1) continue;
      data[i] = PAPER[0] + (data[i] - PAPER[0]) * keep;
      data[i + 1] = PAPER[1] + (data[i + 1] - PAPER[1]) * keep;
      data[i + 2] = PAPER[2] + (data[i + 2] - PAPER[2]) * keep;
    }
    ctx.putImageData(image, px, py);
  }

  return { x: x / width, y: y / height, w: drawW / width, h: drawH / height };
}
