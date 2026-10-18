import type { PassengerRecord } from "../types/history";

/**
 * Client for the history server in server/index.js.
 * In development Vite proxies /api to it (npm run dev starts both). To point a deployed
 * console at a hosted server, build with VITE_API_URL=https://your-server.example.
 */
const API = ((import.meta.env.VITE_API_URL as string | undefined) ?? "").replace(/\/$/, "");

export class HistoryOfflineError extends Error {
  constructor() {
    super("The history server isn't running. Start the console with npm run dev, or run npm run server.");
    this.name = "HistoryOfflineError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    });
  } catch {
    throw new HistoryOfflineError();
  }
  const isJson = (response.headers.get("content-type") ?? "").includes("application/json");
  // A static host (GitHub Pages, vite preview) answers /api with an HTML 404 page.
  if (!isJson) throw new HistoryOfflineError();
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error || `Request failed (${response.status})`);
  return data as T;
}

export function fetchRecords() {
  return request<PassengerRecord[]>("/api/records");
}

/** One bag's record, or null if the server has none yet. */
export async function fetchRecordByBag(bagId: string): Promise<PassengerRecord | null> {
  try {
    return await request<PassengerRecord>(`/api/records/by-bag/${encodeURIComponent(bagId)}`);
  } catch (error) {
    if (error instanceof HistoryOfflineError) throw error;
    return null;
  }
}

export interface BagUpdate {
  scan?: { dataUrl?: string; caption?: string };
  screening?: {
    verdict?: PassengerRecord["screening"]["verdict"];
    action?: "cleared" | "held";
    threatLabel?: string | null;
    confidence?: number | null;
    source?: "lane" | "console";
  };
}

/** Create the bag's record on first contact (with its traveler and flight), or update it. */
export function saveBag(bagId: string, update: BagUpdate = {}) {
  return request<PassengerRecord>(`/api/bags/${encodeURIComponent(bagId)}`, {
    method: "PUT",
    body: JSON.stringify(update),
  });
}

export function resetRecords() {
  return request<{ ok: boolean; count: number }>("/api/records/reset", { method: "POST" });
}

/** Resolve a record's image URL: server files come from the API, bundled art from the site. */
export function assetUrl(url: string) {
  if (url.startsWith("/api/")) return `${API}${url}`;
  if (url.startsWith("/")) return `${import.meta.env.BASE_URL}${url.slice(1)}`;
  return url;
}

export function scanImageSrc(record: PassengerRecord) {
  return assetUrl(record.scan.imageUrl);
}

export function photoSrc(record: PassengerRecord) {
  return assetUrl(record.passenger.photoUrl);
}

/** Render a scan with its detection boxes into a JPEG data URL for the history server. */
export function scanToJpeg(
  image: CanvasImageSource,
  width: number,
  height: number,
  boxes: { x: number; y: number; w: number; h: number; kind: "threat" | "review" | "benign"; label: string; score: number }[],
): string {
  const scale = Math.min(1, 720 / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#f4f1ea";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(image, 0, 0, w, h);
  const colors = { threat: "#ff3b30", review: "#ff9500", benign: "#0071e3" } as const;
  ctx.font = "600 13px -apple-system, system-ui, sans-serif";
  for (const b of boxes) {
    const bx = b.x * w;
    const by = b.y * h;
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = colors[b.kind];
    ctx.setLineDash(b.kind === "review" ? [8, 5] : []);
    ctx.strokeRect(bx, by, b.w * w, b.h * h);
    ctx.setLineDash([]);
    const text = `${b.label} ${b.score.toFixed(2)}`;
    const tw = ctx.measureText(text).width + 10;
    const ty = by > 20 ? by - 19 : by + 2;
    ctx.fillStyle = b.kind === "review" ? "#b25e00" : colors[b.kind];
    ctx.fillRect(bx - 1, ty, tw, 18);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(text, bx + 4, ty + 13);
  }
  return canvas.toDataURL("image/jpeg", 0.85);
}
