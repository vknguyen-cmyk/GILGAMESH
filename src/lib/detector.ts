import type { InferenceSession } from "onnxruntime-web";
import { decodeYolo, letterbox, rgbaToChw, type RawDetection, type YoloFormat } from "./yolo";

/**
 * In-browser threat detector.
 * Loads `public/models/xray/model.json` and the ONNX file it names, then runs
 * YOLO on the laptop with onnxruntime-web. No server and no network at the booth.
 */

export interface ModelConfig {
  /** Shown in the console, e.g. "PIDray · YOLO11n". */
  name: string;
  /** ONNX file name next to model.json. */
  file: string;
  /** Square input size the model was exported with. */
  inputSize: number;
  /** Class names in training order. */
  labels: string[];
  /** Labels that put a bag on hold. Matching ignores case. */
  threats: string[];
  format?: YoloFormat;
  /** Starting value for the alarm threshold slider. */
  defaultThreshold?: number;
  iou?: number;
}

export interface LoadedModel {
  config: ModelConfig;
  threatSet: Set<string>;
}

export class ModelMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelMissingError";
  }
}

export const MODEL_DIR = `${import.meta.env.BASE_URL}models/xray/`;

/** Scores this low are kept so the threshold slider can reveal them without re-running. */
export const MIN_SCORE = 0.05;

type Ort = typeof import("onnxruntime-web");

let ortPromise: Promise<Ort> | null = null;
let modelPromise: Promise<{ model: LoadedModel; session: InferenceSession; ort: Ort }> | null = null;

function loadOrt(): Promise<Ort> {
  if (!ortPromise) {
    ortPromise = (async () => {
      const ort = (await import("onnxruntime-web/wasm")) as unknown as Ort;
      const { default: wasmUrl } = await import("onnxruntime-web/ort-wasm-simd-threaded.wasm?url");
      ort.env.wasm.wasmPaths = { wasm: wasmUrl };
      // One thread avoids cross-origin isolation headers; a nano model still runs well under a second.
      ort.env.wasm.numThreads = 1;
      return ort;
    })();
    ortPromise.catch(() => {
      ortPromise = null;
    });
  }
  return ortPromise;
}

async function fetchConfig(): Promise<ModelConfig> {
  let response: Response;
  try {
    response = await fetch(`${MODEL_DIR}model.json`, { cache: "no-cache" });
  } catch {
    throw new ModelMissingError("Couldn't read public/models/xray/model.json.");
  }
  const type = response.headers.get("content-type") ?? "";
  if (!response.ok || type.includes("text/html")) {
    throw new ModelMissingError(
      "No X-ray model found. Train one with training/train_xray_yolo.ipynb, then copy model.onnx and model.json into public/models/xray/.",
    );
  }
  let config: ModelConfig;
  try {
    config = (await response.json()) as ModelConfig;
  } catch {
    throw new ModelMissingError("public/models/xray/model.json isn't valid JSON.");
  }
  if (!Array.isArray(config.labels) || config.labels.length === 0 || !config.file) {
    throw new ModelMissingError("model.json needs a `file` and a non-empty `labels` list.");
  }
  return {
    name: config.name || config.file,
    file: config.file,
    inputSize: config.inputSize || 640,
    labels: config.labels,
    threats: config.threats ?? [],
    format: config.format,
    defaultThreshold: config.defaultThreshold ?? 0.35,
    iou: config.iou ?? 0.45,
  };
}

/** Load the config and ONNX session once. Safe to call repeatedly. */
export function loadModel(): Promise<LoadedModel> {
  if (!modelPromise) {
    modelPromise = (async () => {
      const config = await fetchConfig();
      const ort = await loadOrt();
      let session: InferenceSession;
      try {
        session = await ort.InferenceSession.create(`${MODEL_DIR}${config.file}`, {
          executionProviders: ["wasm"],
          graphOptimizationLevel: "all",
        });
      } catch (error) {
        throw new ModelMissingError(
          `Couldn't load public/models/xray/${config.file}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      const threatSet = new Set(config.threats.map((label) => label.toLowerCase()));
      return { model: { config, threatSet }, session, ort };
    })();
    modelPromise.catch(() => {
      modelPromise = null;
    });
  }
  return modelPromise.then(({ model }) => model);
}

export interface DetectResult {
  detections: RawDetection[];
  /** Preprocess plus inference time, in milliseconds. */
  elapsedMs: number;
  model: LoadedModel;
}

let busy: Promise<unknown> = Promise.resolve();

/** Run the detector on one image. Calls are queued, since one WASM session runs one at a time. */
export function detect(image: CanvasImageSource & { width: number; height: number }): Promise<DetectResult> {
  const run = busy.then(() => runDetect(image));
  busy = run.catch(() => undefined);
  return run;
}

async function runDetect(image: CanvasImageSource & { width: number; height: number }): Promise<DetectResult> {
  await loadModel();
  const { model, session, ort } = await modelPromise!;
  const { config } = model;
  const started = performance.now();

  const size = config.inputSize;
  const box = letterbox(image.width, image.height, size);
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext("2d", { willReadFrequently: true }) as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!ctx) throw new Error("Canvas 2D is unavailable in this browser.");
  ctx.fillStyle = "rgb(114, 114, 114)";
  ctx.fillRect(0, 0, size, size);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, box.padX, box.padY, box.newW, box.newH);
  const pixels = ctx.getImageData(0, 0, size, size).data;

  const input = new ort.Tensor("float32", rgbaToChw(pixels, size), [1, 3, size, size]);
  const outputs = await session.run({ [session.inputNames[0]]: input });
  const output = outputs[session.outputNames[0]];

  const detections = decodeYolo(output.data as Float32Array, output.dims, {
    labels: config.labels,
    box,
    minScore: MIN_SCORE,
    iou: config.iou ?? 0.45,
    format: config.format,
  });

  return { detections, elapsedMs: performance.now() - started, model };
}

function makeCanvas(size: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(size, size);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  return canvas;
}
