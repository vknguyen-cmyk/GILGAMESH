import { useEffect, useRef, useState, type DragEvent } from "react";
import { detect, loadModel, type LoadedModel } from "../lib/detector";
import { buildRealAnalysis, loadScan } from "../lib/realScan";
import { mountLane, type LaneApi, type LaneDetection, type LaneLogEntry, type LaneScan, type LaneSnapshot } from "../lib/laneScene";
import { mountInspect } from "../lib/inspectScene";

/**
 * The screening lane: a 3D belt and X-ray tunnel where every bag carries a real scan,
 * screened by the same models and thresholds as the console. Flagged bags are pushed to
 * bag search; clicking one opens its 3D density view.
 */

interface SampleScan {
  file: string;
  name?: string;
}

const REDUCED_MOTION =
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

async function analyze(file: File, model: LoadedModel): Promise<LaneScan> {
  const scan = await loadScan(file);
  const result = await detect(scan.bitmap);
  const analysis = buildRealAnalysis(scan, result.detections, model, model.config.defaultThreshold ?? 0.35, result.elapsedMs);
  const detections: LaneDetection[] = analysis.detections
    .filter((d) => d.box)
    .map((d) => ({
      label: d.label,
      score: d.confidence,
      x: d.box!.x,
      y: d.box!.y,
      w: d.box!.w,
      h: d.box!.h,
      kind: d.uncertain ? "review" : d.threat ? "threat" : "benign",
    }));
  return {
    id: scan.id,
    file: scan.fileName,
    image: scan.bitmap,
    width: scan.width,
    height: scan.height,
    verdict: analysis.verdict,
    detections,
    top: detections.find((d) => d.kind !== "benign") ?? detections[0] ?? null,
  };
}

export function LaneView() {
  const hostRef = useRef<HTMLDivElement>(null);
  const monitorRef = useRef<HTMLCanvasElement>(null);
  const apiRef = useRef<LaneApi | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const scansRef = useRef<LaneScan[]>([]);
  const pendingRef = useRef<LaneScan[]>([]);
  const cursorRef = useRef(0);
  const modelRef = useRef<Promise<LoadedModel> | null>(null);

  const [snapshot, setSnapshot] = useState<LaneSnapshot>({ focus: null, log: [], cleared: 0, held: 0 });
  const [status, setStatus] = useState("Loading the X-ray models…");
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(REDUCED_MOTION ? 0.6 : 1);
  const [follow, setFollow] = useState(false);
  const [inspect, setInspect] = useState<LaneLogEntry | null>(null);
  const [dragging, setDragging] = useState(false);

  const getModel = () => (modelRef.current ??= loadModel());

  async function addFiles(files: File[]) {
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (!images.length) {
      setStatus("Drop image files: PNG, JPG, WebP, or BMP.");
      return;
    }
    try {
      const model = await getModel();
      for (const [i, file] of images.entries()) {
        setStatus(`Screening ${file.name} (${i + 1} of ${images.length})…`);
        const scan = await analyze(file, model);
        scansRef.current.push(scan);
        pendingRef.current.push(scan);
      }
      setStatus(`${images.length} new scan${images.length === 1 ? "" : "s"} on the belt next`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  // Mount the 3D lane once.
  useEffect(() => {
    const host = hostRef.current;
    const monitor = monitorRef.current;
    if (!host || !monitor) return;
    const api = mountLane(host, {
      monitor,
      reducedMotion: REDUCED_MOTION,
      nextScan: () => {
        if (pendingRef.current.length) return pendingRef.current.shift()!;
        const all = scansRef.current;
        if (!all.length) return null;
        return all[cursorRef.current++ % all.length];
      },
      onChange: setSnapshot,
      onInspect: setInspect,
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

  // Screen the bundled sample scans so the lane runs before anyone uploads.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const model = await getModel();
        const res = await fetch(`${import.meta.env.BASE_URL}samples/samples.json`);
        const list: SampleScan[] = res.ok ? await res.json() : [];
        if (!list.length) {
          setStatus("Add X-ray images to start the belt");
          return;
        }
        for (const [i, sample] of list.entries()) {
          if (cancelled) return;
          setStatus(`Screening sample scans (${i + 1} of ${list.length})…`);
          const blob = await (await fetch(`${import.meta.env.BASE_URL}samples/${sample.file}`)).blob();
          const scan = await analyze(new File([blob], sample.name ?? sample.file, { type: blob.type }), model);
          if (cancelled) return;
          scansRef.current.push(scan);
        }
        setStatus(`${list.length} sample scans on a loop · add your own anytime`);
      } catch (error) {
        if (!cancelled) setStatus(error instanceof Error ? error.message : String(error));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  let vTitle = "Belt starting";
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
  const vClass = verdict === "analyzing" || verdict === "waiting" ? "scanning" : verdict;

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
        void addFiles(Array.from(e.dataTransfer.files));
      }}
    >
      <section className="lane-stage" aria-label="3D view of the screening lane">
        <div ref={hostRef} className="lane-host" data-testid="lane-3d" />
        <span className="lane-badge">Animated lane · real scans and real model results</span>
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
              if (e.target.files) void addFiles(Array.from(e.target.files));
              e.target.value = "";
            }}
          />
        </div>
        {inspect && <InspectPanel entry={inspect} onClose={() => setInspect(null)} />}
        {dragging && (
          <div className="lane-drop" aria-hidden="true">
            <strong>Drop X-rays to put them on the belt</strong>
            <span>They are screened on this laptop, then ride through next</span>
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
        <p className="lane-note">
          The 3D bags are animation. Each scan is a real X-ray image screened by the models on this laptop. Bags the
          models flag are pushed to bag search; an officer makes the final call.
        </p>
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
