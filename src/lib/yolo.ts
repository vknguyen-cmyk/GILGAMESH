/**
 * Pure YOLO helpers: resize math, output decoding, and NMS.
 * No DOM or onnxruntime here, so the same code runs in the browser and in Node tests.
 */

/** Output layouts the decoder understands. */
export type YoloFormat =
  /** Ultralytics YOLOv8 / YOLO11 export: [1, 4 + classes, anchors], no objectness. */
  | "yolov8"
  /** YOLOv5 export: [1, anchors, 5 + classes], with an objectness score. */
  | "yolov5"
  /** NMS-free end-to-end export (YOLOv10, YOLO26): [1, maxDet, 6] = x1, y1, x2, y2, score, class. */
  | "end2end";

/** How an image is fitted into the square model input. */
export type ResizeMode =
  /** Keep the aspect ratio and pad with gray (Ultralytics default). */
  | "letterbox"
  /** Squash to the full square (Roboflow's "Stretch to" preprocessing). */
  | "stretch";

export interface Letterbox {
  /** Square model input size in pixels. */
  size: number;
  /** Scale from source pixels to model pixels, per axis. Equal for letterbox. */
  scaleX: number;
  scaleY: number;
  /** Left and top padding in model pixels. */
  padX: number;
  padY: number;
  /** Scaled image size inside the square, in model pixels. */
  newW: number;
  newH: number;
  srcW: number;
  srcH: number;
}

/** Same resize-and-pad rule Ultralytics uses at export and inference time. */
export function letterbox(srcW: number, srcH: number, size: number): Letterbox {
  const scale = Math.min(size / srcW, size / srcH);
  const newW = Math.round(srcW * scale);
  const newH = Math.round(srcH * scale);
  const padX = Math.max(0, Math.round((size - newW) / 2 - 0.1));
  const padY = Math.max(0, Math.round((size - newH) / 2 - 0.1));
  return { size, scaleX: scale, scaleY: scale, padX, padY, newW, newH, srcW, srcH };
}

/** Stretch the whole image to the square, the way Roboflow's "Stretch to" resize trains. */
export function stretch(srcW: number, srcH: number, size: number): Letterbox {
  return { size, scaleX: size / srcW, scaleY: size / srcH, padX: 0, padY: 0, newW: size, newH: size, srcW, srcH };
}

/** Pick the fitting rule a model was trained with. */
export function fitImage(srcW: number, srcH: number, size: number, mode: ResizeMode = "letterbox"): Letterbox {
  return mode === "stretch" ? stretch(srcW, srcH, size) : letterbox(srcW, srcH, size);
}

/** One detection with its box normalized to the source image (0–1). */
export interface RawDetection {
  classId: number;
  label: string;
  score: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Candidate {
  classId: number;
  score: number;
  /** Corners in model pixels. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface DecodeOptions {
  labels: string[];
  box: Letterbox;
  /** Drop candidates below this score before NMS. */
  minScore: number;
  /** IoU above which a lower-scoring box of the same class is suppressed. */
  iou: number;
  /** Keep at most this many detections. */
  maxDet?: number;
  format?: YoloFormat;
}

/**
 * Work out the layout from the tensor shape when the model config does not say.
 * Returns the format plus whether a yolov8 tensor is transposed (anchors first).
 */
export function detectFormat(
  dims: readonly number[],
  numClasses: number,
  hint?: YoloFormat,
): { format: YoloFormat; transposed: boolean } {
  if (dims.length !== 3 || dims[0] !== 1) {
    throw new Error(`Unexpected model output shape [${dims.join(", ")}]. Expected [1, N, M].`);
  }
  const [, a, b] = dims;
  if (hint === "end2end") return { format: "end2end", transposed: false };
  if (hint === "yolov5") return { format: "yolov5", transposed: false };
  if (hint === "yolov8") {
    if (a === numClasses + 4) return { format: "yolov8", transposed: false };
    if (b === numClasses + 4) return { format: "yolov8", transposed: true };
  }
  if (a === numClasses + 4) return { format: "yolov8", transposed: false };
  if (b === 6 && numClasses + 4 !== 6) return { format: "end2end", transposed: false };
  if (b === numClasses + 4) return { format: "yolov8", transposed: true };
  if (b === numClasses + 5) return { format: "yolov5", transposed: false };
  throw new Error(
    `Model output [${dims.join(", ")}] does not match ${numClasses} labels. ` +
      "Check that model.json lists every class in training order.",
  );
}

function iouOf(a: Candidate, b: Candidate): number {
  const ix = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1));
  const iy = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
  const inter = ix * iy;
  const union = (a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - inter;
  return union > 0 ? inter / union : 0;
}

/** Per-class greedy NMS, highest score first. */
export function nms(candidates: Candidate[], iou: number, maxDet: number): Candidate[] {
  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const kept: Candidate[] = [];
  for (const candidate of sorted) {
    if (kept.length >= maxDet) break;
    const overlaps = kept.some(
      (other) => other.classId === candidate.classId && iouOf(other, candidate) > iou,
    );
    if (!overlaps) kept.push(candidate);
  }
  return kept;
}

/** Turn a raw output tensor into detections normalized to the source image. */
export function decodeYolo(
  data: ArrayLike<number>,
  dims: readonly number[],
  options: DecodeOptions,
): RawDetection[] {
  const { labels, box, minScore, iou } = options;
  const maxDet = options.maxDet ?? 100;
  const numClasses = labels.length;
  const { format, transposed } = detectFormat(dims, numClasses, options.format);
  const candidates: Candidate[] = [];

  if (format === "yolov8") {
    const anchors = transposed ? dims[1] : dims[2];
    const channels = numClasses + 4;
    const at = transposed
      ? (c: number, i: number) => data[i * channels + c]
      : (c: number, i: number) => data[c * anchors + i];
    for (let i = 0; i < anchors; i += 1) {
      let best = -1;
      let score = minScore;
      for (let c = 0; c < numClasses; c += 1) {
        const value = at(4 + c, i);
        if (value > score) {
          score = value;
          best = c;
        }
      }
      if (best < 0) continue;
      const cx = at(0, i);
      const cy = at(1, i);
      const w = at(2, i);
      const h = at(3, i);
      candidates.push({ classId: best, score, x1: cx - w / 2, y1: cy - h / 2, x2: cx + w / 2, y2: cy + h / 2 });
    }
  } else if (format === "yolov5") {
    const rows = dims[1];
    const channels = dims[2];
    for (let i = 0; i < rows; i += 1) {
      const base = i * channels;
      const objectness = data[base + 4];
      if (objectness < minScore) continue;
      let best = -1;
      let score = minScore;
      for (let c = 0; c < numClasses; c += 1) {
        const value = objectness * data[base + 5 + c];
        if (value > score) {
          score = value;
          best = c;
        }
      }
      if (best < 0) continue;
      const cx = data[base];
      const cy = data[base + 1];
      const w = data[base + 2];
      const h = data[base + 3];
      candidates.push({ classId: best, score, x1: cx - w / 2, y1: cy - h / 2, x2: cx + w / 2, y2: cy + h / 2 });
    }
  } else {
    const rows = dims[1];
    const channels = dims[2];
    for (let i = 0; i < rows; i += 1) {
      const base = i * channels;
      const score = data[base + 4];
      const classId = Math.round(data[base + 5]);
      if (score < minScore || classId < 0 || classId >= numClasses) continue;
      candidates.push({
        classId,
        score,
        x1: data[base],
        y1: data[base + 1],
        x2: data[base + 2],
        y2: data[base + 3],
      });
    }
  }

  const kept = format === "end2end" ? candidates.sort((a, b) => b.score - a.score).slice(0, maxDet) : nms(candidates, iou, maxDet);

  const out: RawDetection[] = [];
  for (const candidate of kept) {
    const x1 = clamp((candidate.x1 - box.padX) / box.scaleX, 0, box.srcW);
    const y1 = clamp((candidate.y1 - box.padY) / box.scaleY, 0, box.srcH);
    const x2 = clamp((candidate.x2 - box.padX) / box.scaleX, 0, box.srcW);
    const y2 = clamp((candidate.y2 - box.padY) / box.scaleY, 0, box.srcH);
    if (x2 - x1 < 1 || y2 - y1 < 1) continue;
    out.push({
      classId: candidate.classId,
      label: labels[candidate.classId] ?? `class ${candidate.classId}`,
      score: candidate.score,
      x: x1 / box.srcW,
      y: y1 / box.srcH,
      w: (x2 - x1) / box.srcW,
      h: (y2 - y1) / box.srcH,
    });
  }
  return out;
}

/**
 * Pack letterboxed RGBA pixels (size × size) into a CHW float tensor in 0–1.
 * The browser fills the RGBA buffer by drawing onto a canvas.
 */
export function rgbaToChw(rgba: ArrayLike<number>, size: number): Float32Array {
  const plane = size * size;
  const out = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i += 1) {
    out[i] = rgba[i * 4] / 255;
    out[plane + i] = rgba[i * 4 + 1] / 255;
    out[2 * plane + i] = rgba[i * 4 + 2] / 255;
  }
  return out;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
