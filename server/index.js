import cors from "cors";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SEED_RECORDS } from "./seed.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const STORE_PATH = path.join(DATA_DIR, "records.json");
const PORT = Number(process.env.PORT || 3001);

fs.mkdirSync(DATA_DIR, { recursive: true });

function readStore() {
  if (!fs.existsSync(STORE_PATH)) {
    writeStore(structuredClone(SEED_RECORDS));
  }
  return JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
}

function writeStore(records) {
  const tmp = `${STORE_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(records, null, 2));
  fs.renameSync(tmp, STORE_PATH);
}

function newId(prefix = "R") {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 100)
    .toString()
    .padStart(2, "0")}`;
}

function applyDecision(record, body) {
  const action = body?.action;
  if (action !== "cleared" && action !== "held") {
    return { error: "action must be cleared or held", status: 400 };
  }
  return {
    status: 200,
    record: {
      ...record,
      screening: {
        ...record.screening,
        action,
        verdict: body?.verdict || record.screening.verdict,
        threatLabel: body?.threatLabel ?? record.screening.threatLabel,
        confidence: body?.confidence ?? record.screening.confidence,
        screenedAt: new Date().toISOString(),
      },
      scan: body?.scanImage
        ? {
            ...record.scan,
            dataUrl: body.scanImage,
          }
        : record.scan,
    },
  };
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "8mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "gilgamesh-history", records: readStore().length });
});

app.get("/api/records", (_req, res) => {
  const records = readStore().slice().sort((a, b) => {
    const aTime = a.screening?.screenedAt || a.createdAt || "";
    const bTime = b.screening?.screenedAt || b.createdAt || "";
    return bTime.localeCompare(aTime);
  });
  res.json(records);
});

app.get("/api/records/by-bag/:bagId", (req, res) => {
  const record = readStore().find((entry) => entry.bagId === req.params.bagId);
  if (!record) {
    res.status(404).json({ error: "No passenger record for that bag" });
    return;
  }
  res.json(record);
});

app.get("/api/records/:id", (req, res) => {
  const record = readStore().find((entry) => entry.id === req.params.id);
  if (!record) {
    res.status(404).json({ error: "Record not found" });
    return;
  }
  res.json(record);
});

app.post("/api/records", (req, res) => {
  const body = req.body ?? {};
  if (!body.passenger?.name || !body.passenger?.idNumber || !body.flight?.number) {
    res.status(400).json({ error: "passenger.name, passenger.idNumber, and flight.number are required" });
    return;
  }

  const record = {
    id: newId(),
    bagId: body.bagId || newId("B"),
    passenger: {
      name: String(body.passenger.name),
      idNumber: String(body.passenger.idNumber),
      photoUrl: body.passenger.photoUrl || "/history/avatars/anonymous.svg",
    },
    flight: {
      number: String(body.flight.number),
      from: String(body.flight.from || "—"),
      to: String(body.flight.to || "—"),
      date: String(body.flight.date || new Date().toISOString().slice(0, 10)),
    },
    scan: {
      imageUrl: body.scan?.imageUrl || "/history/scans/placeholder.svg",
      view: body.scan?.view || "single",
      caption: body.scan?.caption || "Uploaded scan",
      dataUrl: body.scan?.dataUrl || null,
    },
    screening: {
      verdict: body.screening?.verdict || "unscreened",
      action: body.screening?.action || null,
      threatLabel: body.screening?.threatLabel || null,
      confidence: body.screening?.confidence ?? null,
      screenedAt: body.screening?.screenedAt || null,
    },
    createdAt: new Date().toISOString(),
  };

  const records = readStore();
  records.unshift(record);
  writeStore(records);
  res.status(201).json(record);
});

app.patch("/api/records/:id/decision", (req, res) => {
  const records = readStore();
  const index = records.findIndex((entry) => entry.id === req.params.id);
  if (index < 0) {
    res.status(404).json({ error: "Record not found" });
    return;
  }
  const result = applyDecision(records[index], req.body);
  if (result.error) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  records[index] = result.record;
  writeStore(records);
  res.json(result.record);
});

app.patch("/api/records/by-bag/:bagId/decision", (req, res) => {
  const records = readStore();
  const index = records.findIndex((entry) => entry.bagId === req.params.bagId);
  if (index < 0) {
    res.status(404).json({ error: "No passenger record for that bag" });
    return;
  }
  const result = applyDecision(records[index], req.body);
  if (result.error) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  records[index] = result.record;
  writeStore(records);
  res.json(result.record);
});

app.post("/api/records/reset", (_req, res) => {
  writeStore(structuredClone(SEED_RECORDS));
  res.json({ ok: true, count: SEED_RECORDS.length });
});

app.listen(PORT, "0.0.0.0", () => {
  readStore();
  console.log(`GILGAMESH history API on http://0.0.0.0:${PORT}`);
});
