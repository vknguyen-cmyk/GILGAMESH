import { useEffect, useRef, useState, type DragEvent } from "react";
import { mountLane, type LaneApi, type LaneLogEntry, type LaneSnapshot } from "../lib/laneScene";
import type { LaneItem } from "../lib/laneScans";
import { mountInspect } from "../lib/inspectScene";
import { HistoryOfflineError, fetchRecordByBag, photoSrc, saveBag, scanToJpeg } from "../lib/historyApi";
import type { PassengerRecord } from "../types/history";

/**
 * The screening lane: every X-ray you upload rides the belt as one bag, in upload order.
 * Each bag carries its scan's console analysis (same models, same alarm threshold), so the
 * lane holds a bag exactly when the console flags its scan. Flagged bags are pushed to
 * bag search; clicking one opens its 3D density view and owner.
 */

const REDUCED_MOTION =
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

interface LaneViewProps {
  /** Uploaded scans in upload order, shared with the console. */
  items: LaneItem[];
  onAddFiles: (files: File[]) => void;
  sampleCount: number;
  onUseSamples: () => void;
  onRecord?: () => void;
}

export function LaneView({ items, onAddFiles, sampleCount, onUseSamples, onRecord }: LaneViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const monitorRef = useRef<HTMLCanvasElement>(null);
  const apiRef = useRef<LaneApi | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  /** Index of the next upload to put on the belt. */
  const cursorRef = useRef(0);
  const [sent, setSent] = useState(0);
  const historyOffline = useRef(false);
  const onRecordRef = useRef(onRecord);
  onRecordRef.current = onRecord;

  const [snapshot, setSnapshot] = useState<LaneSnapshot>({ focus: null, log: [], cleared: 0, held: 0 });
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(REDUCED_MOTION ? 0.6 : 1);
  const [follow, setFollow] = useState(false);
  const [inspect, setInspect] = useState<LaneLogEntry | null>(null);
  const [dragging, setDragging] = useState(false);

  const analyzing = items.filter((i) => i.state === "analyzing").length;
  const waiting = items.length - sent;
  let status = "Add X-ray images. Each one rides the belt as a bag.";
  if (items.length) {
    if (analyzing) status = `Analyzing ${analyzing} scan${analyzing === 1 ? "" : "s"}…`;
    else if (waiting > 0) status = `${waiting} bag${waiting === 1 ? "" : "s"} waiting for the belt`;
    else status = `All ${items.length} uploaded scan${items.length === 1 ? " has" : "s have"} been through the lane`;
  }

  // Mount the 3D lane once.
  useEffect(() => {
    const host = hostRef.current;
    const monitor = monitorRef.current;
    if (!host || !monitor) return;
    const api = mountLane(host, {
      monitor,
      reducedMotion: REDUCED_MOTION,
      // Uploads board in order; a scan still being analyzed holds the line until its result is in.
      nextScan: () => {
        const list = itemsRef.current;
        while (cursorRef.current < list.length) {
          const item = list[cursorRef.current];
          if (item.state === "analyzing") return null;
          cursorRef.current++;
          setSent(cursorRef.current);
          if (item.state === "ready") return item.scan;
        }
        return null;
      },
      onChange: setSnapshot,
      onInspect: setInspect,
      // Each bag's result goes to the history server under its scan's ID: scan with boxes, verdict, where it went.
      onResult: (entry) => {
        if (historyOffline.current) return;
        const { scan } = entry;
        const top = scan.top;
        void saveBag(entry.label, {
          scan: {
            dataUrl: scanToJpeg(scan.image, scan.width, scan.height, scan.detections),
            caption: scan.file,
          },
          screening: {
            verdict: scan.verdict,
            action: scan.verdict === "clear" ? "cleared" : "held",
            threatLabel: scan.verdict === "clear" ? null : (top?.label ?? null),
            confidence: scan.verdict === "clear" ? null : (top?.score ?? null),
            source: "lane",
          },
        })
          .then(() => onRecordRef.current?.())
          .catch((error) => {
            if (error instanceof HistoryOfflineError) historyOffline.current = true;
          });
      },
    });
    apiRef.current = api;
    const observer = new ResizeObserver(() => api.resize());
    observer.observe(host);
    return () => {
      observer.disconnect();
      api.dispose();
      apiRef.current = null;
    };
  }, []);

  function runAgain() {
    cursorRef.current = 0;
    setSent(0);
  }

  useEffect(() => apiRef.current?.setPaused(paused), [paused]);
  useEffect(() => apiRef.current?.setSpeed(speed), [speed]);
  useEffect(() => apiRef.current?.setFollow(follow), [follow]);

  useEffect(() => {
    if (!inspect) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setInspect(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inspect]);

  const focus = snapshot.focus;
  const verdict = focus?.phase ?? "waiting";
  const top = focus?.scan.top;
  let vTitle = items.length ? "Belt starting" : "No bags yet";
  let vSub = status;
  if (focus) {
    if (verdict === "scanning") {
      vTitle = "Scanning";
      vSub = "Building the X-ray image";
    } else if (verdict === "analyzing") {
      vTitle = "Analyzing";
      vSub = "Running the threat models";
    } else if (verdict === "threat" && top) {
      vTitle = `Threat · ${top.label} ${top.score.toFixed(2)}`;
      vSub = "Diverted to bag search · officer confirms";
    } else if (verdict === "review" && top) {
      vTitle = `Look closer · possible ${top.label} ${top.score.toFixed(2)}`;
      vSub = "Diverted to bag search · check the marked area";
    } else {
      vTitle = "No threats found";
      vSub = "Officer confirms before clearing";
    }
  }
  const vClass =
    verdict === "waiting" ? (items.length ? "scanning" : "idle") : verdict === "analyzing" ? "scanning" : verdict;

  const stop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div
      className="lane"
      onDragEnter={(e) => {
        stop(e);
        setDragging(true);
      }}
      onDragOver={stop}
      onDragLeave={(e) => {
        stop(e);
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        stop(e);
        setDragging(false);
        onAddFiles(Array.from(e.dataTransfer.files));
      }}
    >
      <section className="lane-stage" aria-label="3D view of the screening lane">
        <div ref={hostRef} className="lane-host" data-testid="lane-3d" />
        <span className="lane-badge">Each bag is one of your uploaded X-rays</span>
        <div className="lane-hud">
          <span className="hint">Drag to orbit · click the blue node on a held bag to see it in 3D</span>
          <button type="button" className="lane-btn" onClick={() => setPaused((p) => !p)}>
            {paused ? "Run belt" : "Pause belt"}
          </button>
          <label className="lane-speed" htmlFor="lane-speed">
            Belt speed
            <input
              id="lane-speed"
              type="range"
              min={0.4}
              max={2.5}
              step={0.1}
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
            />
          </label>
          <button type="button" className="lane-btn" onClick={() => setFollow((f) => !f)}>
            {follow ? "Overview" : "Follow bag"}
          </button>
          {items.length > 0 && waiting === 0 && analyzing === 0 && (
            <button type="button" className="lane-btn" onClick={runAgain}>
              Run again
            </button>
          )}
          <button type="button" className="lane-btn" onClick={() => fileInput.current?.click()}>
            Add X-ray images
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) onAddFiles(Array.from(e.target.files));
              e.target.value = "";
            }}
          />
        </div>
        {items.length === 0 && (
          <div className="lane-empty">
            <strong>Put X-rays on the belt</strong>
            <span>Each image you add rides through as one bag. Flagged bags are pushed to bag search.</span>
            <div>
              <button type="button" className="lane-btn primary-lane" onClick={() => fileInput.current?.click()}>
                Add X-ray images
              </button>
              {sampleCount > 0 && (
                <button type="button" className="lane-btn" onClick={onUseSamples}>
                  Use {sampleCount} sample scans
                </button>
              )}
            </div>
          </div>
        )}
        {inspect && <InspectPanel entry={inspect} onClose={() => setInspect(null)} />}
        {dragging && (
          <div className="lane-drop" aria-hidden="true">
            <strong>Drop X-rays to put them on the belt</strong>
            <span>Each image becomes a bag on the belt, screened like in the Console</span>
          </div>
        )}
      </section>

      <aside className="lane-side">
        <div className="lane-head">
          <h2>Now Screening</h2>
          <span>{focus?.label ?? "—"}</span>
        </div>
        <div className="lane-card lane-monitor">
          <canvas ref={monitorRef} width={640} height={400} aria-label="Live X-ray image of the bag in the tunnel" />
          <div className="meta">
            <span>{focus?.file ?? status}</span>
            <span>{focus ? (focus.progress >= 1 ? "Scan complete" : `${Math.round(focus.progress * 100)}%`) : ""}</span>
          </div>
        </div>
        <div className={`lane-verdict ${vClass}`} role="status" aria-live="polite">
          <span className="dot" />
          <strong>{vTitle}</strong>
          <small>{vSub}</small>
        </div>
        <div className="lane-head">
          <h2>Lane Log</h2>
          <span>
            {snapshot.cleared} cleared · {snapshot.held} held
          </span>
        </div>
        <ul className="lane-card lane-log">
          {snapshot.log.map((e) => {
            const isNow = focus?.label === e.label;
            const heldBag = e.status === "threat" || e.status === "review";
            const statusText =
              e.status === "clear"
                ? "Cleared"
                : e.status === "threat"
                  ? `To search · ${e.scan.top?.label ?? "threat"}`
                  : e.status === "review"
                    ? "To search · look closer"
                    : e.status === "scanning"
                      ? "Scanning"
                      : e.status === "analyzing"
                        ? "Analyzing"
                        : "On belt";
            const body = (
              <>
                <div>
                  <b>{e.label}</b>
                  <span>{e.type}</span>
                </div>
                <em className={e.status}>{statusText}</em>
              </>
            );
            return (
              <li key={e.serial} className={`${isNow ? "now" : ""} ${heldBag ? "held" : ""}`}>
                {heldBag ? (
                  <button type="button" onClick={() => setInspect(e)} aria-label={`Inspect ${e.label} in 3D`}>
                    {body}
                  </button>
                ) : (
                  body
                )}
              </li>
            );
          })}
          {snapshot.log.length === 0 && <li className="empty">{status}</li>}
        </ul>
      </aside>
    </div>
  );
}

const KIND_COLOR = { threat: "#ff3b30", review: "#ff9500", benign: "#0071e3" } as const;

function InspectPanel({ entry, onClose }: { entry: LaneLogEntry; onClose: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const scanRef = useRef<HTMLCanvasElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const { scan } = entry;
  const top = scan.top;
  const [owner, setOwner] = useState<PassengerRecord | null>(null);
  const [ownerState, setOwnerState] = useState<"loading" | "ready" | "offline">("loading");

  // The bag's owner comes from the history server; a bag it hasn't seen yet gets its record now.
  useEffect(() => {
    let cancelled = false;
    setOwner(null);
    setOwnerState("loading");
    fetchRecordByBag(entry.label)
      .then((record) => record ?? saveBag(entry.label))
      .then((record) => {
        if (cancelled) return;
        setOwner(record);
        setOwnerState("ready");
      })
      .catch(() => {
        if (!cancelled) setOwnerState("offline");
      });
    return () => {
      cancelled = true;
    };
  }, [entry.label]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const view = mountInspect(host, scan, REDUCED_MOTION);
    closeRef.current?.focus();
    return () => view.dispose();
  }, [scan]);

  useEffect(() => {
    const canvas = scanRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.fillStyle = "#f4f1ea";
    ctx.fillRect(0, 0, 640, 400);
    const fit = Math.min(620 / scan.width, 380 / scan.height);
    const dw = scan.width * fit;
    const dh = scan.height * fit;
    const dx = (640 - dw) / 2;
    const dy = (400 - dh) / 2;
    ctx.drawImage(scan.image, dx, dy, dw, dh);
    for (const d of scan.detections) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = KIND_COLOR[d.kind];
      ctx.setLineDash(d.kind === "review" ? [10, 6] : []);
      ctx.strokeRect(dx + d.x * dw, dy + d.y * dh, d.w * dw, d.h * dh);
    }
    ctx.setLineDash([]);
  }, [scan]);

  return (
    <div
      className="lane-inspect"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="lane-inspect-card" role="dialog" aria-modal="true" aria-labelledby="lane-insp-title">
        <div className="lane-inspect-3d">
          <div ref={hostRef} className="lane-inspect-host" aria-label="3D density model of the held bag" />
          <span className="tagline">3D density view · not a CT scan</span>
          <span className="hint">Drag to rotate · scroll to zoom</span>
        </div>
        <div className="lane-inspect-side">
          <div className="lane-head">
            <h2 id="lane-insp-title">{entry.label}</h2>
            <button ref={closeRef} type="button" className="lane-btn" onClick={onClose}>
              Close
            </button>
          </div>
          <div className="lane-owner" aria-live="polite">
            {owner ? (
              <>
                <img src={photoSrc(owner)} alt="" className="lane-owner-photo" />
                <div className="lane-owner-who">
                  <strong>{owner.passenger.name}</strong>
                  <small>
                    ID {owner.passenger.idNumber}
                    {owner.demo ? " · demo identity" : ""}
                  </small>
                </div>
                <div className="lane-owner-flight">
                  <strong>{owner.flight.number}</strong>
                  <small>
                    {owner.flight.from} → {owner.flight.to} · {owner.flight.date}
                  </small>
                </div>
              </>
            ) : (
              <small className="lane-owner-note">
                {ownerState === "offline" ? "Owner details need the history server (npm run dev)." : "Looking up the owner…"}
              </small>
            )}
          </div>
          <div className={`lane-verdict ${scan.verdict}`}>
            <span className="dot" />
            <strong>
              {scan.verdict === "threat" ? "Threat" : "Look closer"}
              {top ? ` · ${top.label} ${top.score.toFixed(2)}` : ""}
            </strong>
            <small>
              {entry.type} · {scan.file}
            </small>
          </div>
          <canvas ref={scanRef} width={640} height={400} aria-label="X-ray scan with the model's boxes" />
          <ul className="lane-dets">
            {scan.detections
              .filter((d) => d.kind !== "benign")
              .map((d, i) => (
                <li key={i} className={d.kind}>
                  {d.label}
                  <span>
                    {d.score.toFixed(2)} · {d.kind === "threat" ? "above alarm" : "below alarm"}
                  </span>
                </li>
              ))}
          </ul>
          <p className="lane-note">
            Taller means denser: darker pixels in the X-ray absorbed more of the beam. Height is not depth inside the
            bag.
          </p>
        </div>
      </div>
    </div>
  );
}
