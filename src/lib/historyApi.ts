import type { PassengerRecord } from "../types/history";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export function fetchRecords() {
  return request<PassengerRecord[]>("/api/records");
}

export function fetchRecordByBag(bagId: string) {
  return request<PassengerRecord>(`/api/records/by-bag/${encodeURIComponent(bagId)}`);
}

export function saveDecisionByBag(
  bagId: string,
  body: {
    action: "cleared" | "held";
    verdict?: "clear" | "review" | "threat" | "unscreened";
    threatLabel?: string | null;
    confidence?: number | null;
    scanImage?: string | null;
  },
) {
  return request<PassengerRecord>(`/api/records/by-bag/${encodeURIComponent(bagId)}/decision`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function createRecord(body: {
  bagId?: string;
  passenger: PassengerRecord["passenger"];
  flight: PassengerRecord["flight"];
  scan?: PassengerRecord["scan"];
  screening?: PassengerRecord["screening"];
}) {
  return request<PassengerRecord>("/api/records", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function resetRecords() {
  return request<{ ok: boolean; count: number }>("/api/records/reset", { method: "POST" });
}

export function scanImageSrc(record: PassengerRecord) {
  return record.scan.dataUrl || record.scan.imageUrl;
}
