import type { InferenceSession } from "onnxruntime-web";
import {
  decodeYolo,
  fitImage,
  mergeModelDetections,
  rgbaToChw,
  type Letterbox,
  type RawDetection,
  type ResizeMode,
  type YoloFormat,
} from "./yolo";

/**
 * In-browser threat detector.
 * Loads `public/models/xray/model.json` and the ONNX file it names, then runs
 * YOLO on the laptop with onnxruntime-web. No server and no network at the booth.
 *
 * When `public/models/xray-pretrained/` also holds a model, both run on every scan and
 * their boxes are merged with cross-model Weighted Boxes Fusion. Without it, the console
 * runs the primary model alone.
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
  /** How images were fitted to the square during training. Roboflow's "Stretch to" means "stretch". */
  resize?: ResizeMode;
  /** Starting value for the alarm threshold slider. */
  defaultThreshold?: number;
  iou?: number;
}

export interface LoadedModel {
  /** The primary model's config, with `threats` merged across both models and `name` naming both. */
  config: ModelConfig;
  threatSet: Set<string>;
  /** The second model's own config when it loaded; null in single-model mode. */
  secondary: ModelConfig | null;
}

export class ModelMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelMissingError";
  }
}

export const MODEL_DIR = `${import.meta.env.BASE_URL}models/xray/`;
export const SECONDARY_MODEL_DIR = `${import.meta.env.BASE_URL}models/xray-pretrained/`;

/** Scores this low are kept so the threshold slider can reveal them without re-running. */
export const MIN_SCORE = 0.05;

type Ort = typeof import("onnxruntime-web");

let ortPromise: Promise<Ort> | null = null;
interface Runner {
  config: ModelConfig;
  session: InferenceSession;
}
let modelPromise: Promise<{ model: LoadedModel; runners: Runner[]; ort: Ort }> | null = null;

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

async function fetchConfig(dir: string): Promise<ModelConfig> {
  const shown = `public/${dir.slice(import.meta.env.BASE_URL.length)}model.json`;
  let response: Response;
  try {
    response = await fetch(`${dir}model.json`, { cache: "no-cache" });
  } catch {
    throw new ModelMissingError(`Couldn't read ${shown}.`);
  }
  const type = response.headers.get("content-type") ?? "";
  if (!response.ok || type.includes("text/html")) {
    throw new ModelMissingError(
      `No X-ray model found at ${shown}. Train one with training/train_xray_yolo.ipynb, then copy model.onnx and model.json into that folder.`,
    );
  }
  let config: ModelConfig;
  try {
    config = (await response.json()) as ModelConfig;
  } catch {
    throw new ModelMissingError(`${shown} isn't valid JSON.`);
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
    resize: config.resize === "stretch" ? "stretch" : "letterbox",
    defaultThreshold: config.defaultThreshold ?? 0.35,
    iou: config.iou ?? 0.45,
  };
}

async function createSession(ort: Ort, dir: string, config: ModelConfig): Promise<InferenceSession> {
  try {
    return await ort.InferenceSession.create(`${dir}${config.file}`, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    });
  } catch (error) {
    throw new ModelMissingError(
      `Couldn't load public/${dir.slice(import.meta.env.BASE_URL.length)}${config.file}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/** The optional second model. Any problem loading it leaves the console in single-model mode. */
async function loadSecondary(ort: Ort): Promise<Runner | null> {
  try {
    const config = await fetchConfig(SECONDARY_MODEL_DIR);
    const session = await createSession(ort, SECONDARY_MODEL_DIR, config);
    return { config, session };
  } catch (error) {
    console.info(`Second X-ray model not loaded, running one model: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}

/** Load both configs and ONNX sessions once. Safe to call repeatedly. */
export function loadModel(): Promise<LoadedModel> {
  if (!modelPromise) {
    modelPromise = (async () => {
      const primaryConfig = await fetchConfig(MODEL_DIR);
      const ort = await loadOrt();
      const [primarySession, secondary] = await Promise.all([
        createSession(ort, MODEL_DIR, primaryConfig),
        loadSecondary(ort),
      ]);
      const runners: Runner[] = [{ config: primaryConfig, session: primarySession }];
      if (secondary) runners.push(secondary);
      // A label is a threat if either model calls it one.
      const threats = Array.from(new Set([...primaryConfig.threats, ...(secondary?.config.threats ?? [])]));
      const config: ModelConfig = {
        ...primaryConfig,
        name: secondary ? `${primaryConfig.name} + ${secondary.config.name}` : primaryConfig.name,
        threats,
      };
      const threatSet = new Set(threats.map((label) => label.toLowerCase()));
      return { model: { config, threatSet, secondary: secondary?.config ?? null }, runners, ort };
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
  const { model, runners, ort } = await modelPromise!;
  const started = performance.now();

  // Preprocess once per input size and resize rule; models that share them share the tensor.
  const inputs = new Map<string, { box: Letterbox; data: Float32Array }>();
  const inputFor = (config: ModelConfig) => {
    const key = `${config.inputSize}:${config.resize}`;
    let prepared = inputs.get(key);
    if (!prepared) {
      prepared = preprocess(image, config.inputSize, config.resize);
      inputs.set(key, prepared);
    }
    return prepared;
  };

  const perModel = await Promise.all(
    runners.map(async ({ config, session }) => {
      const { box, data } = inputFor(config);
      const size = config.inputSize;
      const input = new ort.Tensor("float32", data, [1, 3, size, size]);
      const outputs = await session.run({ [session.inputNames[0]]: input });
      const output = outputs[session.outputNames[0]];
      return decodeYolo(output.data as Float32Array, output.dims, {
        labels: config.labels,
        box,
        minScore: MIN_SCORE,
        iou: config.iou ?? 0.45,
        format: config.format,
      });
    }),
  );

  const detections =
    perModel.length > 1 ? mergeModelDetections(perModel[0], perModel[1], 0.45) : perModel[0];
  return { detections, elapsedMs: performance.now() - started, model };
}

function preprocess(
  image: CanvasImageSource & { width: number; height: number },
  size: number,
  resize: ResizeMode | undefined,
): { box: Letterbox; data: Float32Array } {
  const box = fitImage(image.width, image.height, size, resize);
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
  return { box, data: rgbaToChw(ctx.getImageData(0, 0, size, size).data, size) };
}

function makeCanvas(size: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(size, size);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  return canvas;
}
