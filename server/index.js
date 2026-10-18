/**
 * GILGAMESH history API: a thin backend that keeps one record per screened bag.
 *
 * A record holds the bag ID, the traveler (anonymous photo, name, ID number), that day's
 * flight (number, from, to, date), the 2D scan the officer saw (a JPEG on disk), and the
 * screening result. Records live in server/data/records.json, scans in server/data/scans/.
 *
 * Travelers and flights are generated demo identities: the console only sees the X-ray, so
 * each new bag gets a stable made-up traveler derived from its bag ID. They are marked
 * `demo: true` and shown as demo identities in the app.
 *
 *   npm run server     → http://localhost:3001 (npm run dev starts it with the app)
 */
import cors from "cors";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const SCAN_DIR = path.join(DATA_DIR, "scans");
const STORE_PATH = path.join(DATA_DIR, "records.json");
const PORT = Number(process.env.PORT || 3001);
/** Oldest records (and their scans) are dropped past this many. */
const MAX_RECORDS = 300;

fs.mkdirSync(SCAN_DIR, { recursive: true });

function readStore() {
  if (!fs.existsSync(STORE_PATH)) return [];
  try {
    const records = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
    return Array.isArray(records) ? records : [];
  } catch {
    return [];
  }
}

function writeStore(records) {
  const tmp = `${STORE_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(records, null, 2));
  fs.renameSync(tmp, STORE_PATH);
}

/* ---------- Demo identities, stable per bag ID ---------- */

const FIRST = ["Alex", "Jordan", "Riley", "Morgan", "Casey", "Sam", "Taylor", "Avery", "Quinn", "Jamie", "Rowan", "Skyler", "Noah", "Mina", "Leo", "Priya", "Hana", "Mateo", "Zoe", "Omar"];
const LAST = ["Rivera", "Lee", "Santos", "Chen", "Nguyen", "Okonkwo", "Patel", "Kim", "Garcia", "Haddad", "Silva", "Tanaka", "Novak", "Mensah", "Kowalski", "Ibrahim", "Larsen", "Moreau", "Duarte", "Singh"];
/** Departures from Seattle; "DH" is a made-up carrier code for the demo. */
const ROUTES = [
  ["SEA", "SFO"], ["SEA", "LAX"], ["SEA", "JFK"], ["SEA", "ORD"], ["SEA", "DEN"], ["SEA", "BOS"],
  ["SEA", "HNL"], ["SEA", "ANC"], ["SEA", "YVR"], ["SEA", "NRT"], ["SEA", "ICN"], ["SEA", "LHR"],
];

function hash(text) {
  let h = 2166136261;
  for (const ch of text) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function demoIdentity(bagId) {
  const h = hash(bagId);
  const [from, to] = ROUTES[h % ROUTES.length];
  return {
    passenger: {
      name: `${FIRST[(h >>> 4) % FIRST.length]} ${LAST[(h >>> 9) % LAST.length]}`,
      idNumber: `P-${String(100000 + ((h >>> 3) % 900000))}`,
      photoUrl: "/history/avatars/anonymous.svg",
    },
    flight: {
      number: `DH ${100 + ((h >>> 13) % 900)}`,
      from,
      to,
      date: new Date().toISOString().slice(0, 10),
    },
    demo: true,
  };
}

/* ---------- Scans: the 2D image is stored as a JPEG file next to the records ---------- */

function safeName(bagId) {
  return bagId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);
}

function saveScan(bagId, dataUrl) {
  const match = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(dataUrl || "");
  if (!match) return null;
  const ext = match[1] === "jpeg" ? "jpg" : match[1];
  const file = `${safeName(bagId)}.${ext}`;
  fs.writeFileSync(path.join(SCAN_DIR, file), Buffer.from(match[2], "base64"));
  return `/api/scans/${file}?v=${Date.now().toString(36)}`;
}

function removeScanFiles(record) {
  const url = record?.scan?.imageUrl || "";
  if (!url.startsWith("/api/scans/")) return;
  const file = path.join(SCAN_DIR, path.basename(url.split("?")[0]));
  if (file.startsWith(SCAN_DIR)) fs.rmSync(file, { force: true });
}

function trim(records) {
  while (records.length > MAX_RECORDS) removeScanFiles(records.pop());
  return records;
}

function cleanScreening(body, previous = {}) {
  const verdicts = ["clear", "review", "threat", "unscreened"];
  const actions = ["cleared", "held"];
  return {
    verdict: verdicts.includes(body?.verdict) ? body.verdict : previous.verdict || "unscreened",
    action: actions.includes(body?.action) ? body.action : previous.action ?? null,
    threatLabel: body?.threatLabel !== undefined ? body.threatLabel || null : previous.threatLabel ?? null,
    confidence: typeof body?.confidence === "number" ? body.confidence : previous.confidence ?? null,
    screenedAt: body?.action || body?.verdict ? new Date().toISOString() : previous.screenedAt ?? null,
    source: body?.source || previous.source || null,
  };
}

/* ---------- API ---------- */

const app = express();
app.use(cors());
app.use(express.json({ limit: "8mb" }));
app.use("/api/scans", express.static(SCAN_DIR, { maxAge: "1h" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "gilgamesh-history", records: readStore().length });
});

app.get("/api/records", (_req, res) => {
  const records = readStore()
    .slice()
    .sort((a, b) => (b.updatedAt || b.createdAt || "").localeCompare(a.updatedAt || a.createdAt || ""));
  res.json(records);
});

app.get("/api/records/by-bag/:bagId", (req, res) => {
  const record = readStore().find((entry) => entry.bagId === req.params.bagId);
  if (!record) {
    res.status(404).json({ error: "No record for that bag" });
    return;
  }
  res.json(record);
});

/**
 * Create or update one bag's record.
 * Body (all optional): { scan: { dataUrl, caption }, screening: { verdict, action, threatLabel, confidence, source } }
 * A new bag gets a demo traveler and today's flight.
 */
app.put("/api/bags/:bagId", (req, res) => {
  const bagId = String(req.params.bagId).slice(0, 64);
  if (!bagId) {
    res.status(400).json({ error: "bagId is required" });
    return;
  }
  const body = req.body ?? {};
  const records = readStore();
  const index = records.findIndex((entry) => entry.bagId === bagId);
  const now = new Date().toISOString();
  const existing = index >= 0 ? records[index] : null;

  const record = existing
    ? { ...existing }
    : {
        id: `R-${Date.now().toString(36).toUpperCase()}`,
        bagId,
        ...demoIdentity(bagId),
        scan: { imageUrl: "/history/scans/placeholder.svg", caption: null },
        screening: cleanScreening({}),
        createdAt: now,
      };

  if (body.scan?.dataUrl) {
    const url = saveScan(bagId, body.scan.dataUrl);
    if (!url) {
      res.status(400).json({ error: "scan.dataUrl must be a base64 JPEG, PNG, or WebP data URL" });
      return;
    }
    record.scan = { imageUrl: url, caption: body.scan.caption ?? record.scan.caption ?? null };
  } else if (body.scan?.caption) {
    record.scan = { ...record.scan, caption: body.scan.caption };
  }
  if (body.screening) record.screening = cleanScreening(body.screening, record.screening);
  record.updatedAt = now;

  if (index >= 0) records.splice(index, 1);
  records.unshift(record);
  writeStore(trim(records));
  res.status(existing ? 200 : 201).json(record);
});

/** Delete every record and stored scan. */
app.post("/api/records/reset", (_req, res) => {
  for (const record of readStore()) removeScanFiles(record);
  writeStore([]);
  res.json({ ok: true, count: 0 });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`GILGAMESH history API on http://0.0.0.0:${PORT} · ${readStore().length} records`);
});
