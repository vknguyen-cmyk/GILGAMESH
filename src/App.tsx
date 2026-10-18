import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { BAGS, TYPE_LABEL } from "./data/bags";
import { analyzeBag } from "./lib/analyze";
import { detect, loadModel, type LoadedModel } from "./lib/detector";
import { buildRealAnalysis, loadScan } from "./lib/realScan";
import type { RawDetection } from "./lib/yolo";
import type { Analysis, Decision, MaterialFilter, Phase } from "./types";
import { ThreeView } from "./components/ThreeView";
import { DensityView } from "./components/DensityView";
import { LaneView } from "./components/LaneView";
import { XrayPane, type PaneSource } from "./components/XrayPane";
import { HistorySheet } from "./components/HistorySheet";
import { PassengerCard } from "./components/PassengerCard";
import { saveBag, scanToJpeg } from "./lib/historyApi";
import type { PassengerRecord } from "./types/history";

type Mode = "demo" | "real";

type ModelState =
  | { status: "idle" | "loading" }
  | { status: "ready"; model: LoadedModel }
  | { status: "missing"; error: string };

type RealResult = { raw: RawDetection[]; elapsedMs: number } | { error: string };

const SIM_ENTRIES: PaneSource[] = BAGS.map((bag) => ({ kind: "sim", bag }));

const FILTERS: Array<{ id: MaterialFilter; label: string }> = [
  { id: "all", label: "Color" },
  { id: "organic", label: "Organic" },
  { id: "metal", label: "Metal" },
];

const SCAN_LINES = [
  "Capturing dual-energy projection",
  "Splitting organic and metallic",
  "Proposing object regions",
  "Scoring threat classes",
];

const REAL_SCAN_LINES = [
  "Reading uploaded image",
  "Letterboxing for the model",
  "Running detector on this laptop",
  "Filtering overlaps and scoring",
];

function formatClock(date: Date) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function entryKey(entry: PaneSource | null) {
  if (!entry) return "none";
  return entry.kind === "sim" ? entry.bag.id : entry.scan.id;
}

function entryMeta(entry: PaneSource) {
  if (entry.kind === "sim") {
    return { id: entry.bag.id, kind: TYPE_LABEL[entry.bag.type], detail: `Tag ${entry.bag.tag}` };
  }
  const { scan } = entry;
  return { id: scan.id, kind: "X-ray image", detail: scan.fileName, size: `${scan.width}×${scan.height}` };
}

interface SampleScan {
  file: string;
  name?: string;
}

export function App() {
  const [mode, setMode] = useState<Mode>("real");
  /** Lane: the 3D screening lane. Console: one scan at a time with full findings. */
  const [screen, setScreen] = useState<"lane" | "console">("lane");
  const [realEntries, setRealEntries] = useState<PaneSource[]>([]);
  const [indexes, setIndexes] = useState<Record<Mode, number>>({ demo: 0, real: 0 });
  const [decisionsByMode, setDecisionsByMode] = useState<Record<Mode, Decision[]>>({ demo: [], real: [] });
  const [phase, setPhase] = useState<Phase>("entering");
  const [filter, setFilter] = useState<MaterialFilter>("all");
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [show3d, setShow3d] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [posed, setPosed] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [scanStep, setScanStep] = useState(0);
  const [run, setRun] = useState(0);
  const [modelState, setModelState] = useState<ModelState>({ status: "idle" });
  const [realResults, setRealResults] = useState<Record<string, RealResult>>({});
  const [threshold, setThreshold] = useState<number | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [uploadNote, setUploadNote] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [historyTick, setHistoryTick] = useState(0);
  const [passenger, setPassenger] = useState<PassengerRecord | null>(null);
  const lock = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const realResultsRef = useRef(realResults);
  realResultsRef.current = realResults;

  const entries = mode === "demo" ? SIM_ENTRIES : realEntries;
  const index = indexes[mode];
  const decisions = decisionsByMode[mode];
  const entry = entries[index] ?? null;
  const currentKey = entryKey(entry);
  const done = !entry;
  const isReal = entry?.kind === "real";
  const model = modelState.status === "ready" ? modelState.model : null;
  const effectiveThreshold = threshold ?? model?.config.defaultThreshold ?? 0.35;
  const realResult = entry?.kind === "real" ? realResults[entry.scan.id] : undefined;

  const analysis: Analysis | null = useMemo(() => {
    if (!entry) return null;
    if (entry.kind === "sim") return analyzeBag(entry.bag);
    if (!realResult || !("raw" in realResult) || !model) return null;
    return buildRealAnalysis(entry.scan, realResult.raw, model, effectiveThreshold, realResult.elapsedMs);
  }, [entry, realResult, model, effectiveThreshold]);

  function setIndex(update: (value: number) => number) {
    setIndexes((current) => ({ ...current, [mode]: update(current[mode]) }));
  }

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  function warmModel() {
    setModelState({ status: "loading" });
    loadModel().then(
      (loaded) => setModelState({ status: "ready", model: loaded }),
      (error: unknown) =>
        setModelState({ status: "missing", error: error instanceof Error ? error.message : String(error) }),
    );
  }

  useEffect(() => {
    if (mode === "real" && modelState.status === "idle") warmModel();
  }, [mode, modelState.status]);

  // Look up (or create) the traveler and flight for the bag on screen.
  useEffect(() => {
    if (!entry || entry.kind !== "real") {
      setPassenger(null);
      return;
    }
    let cancelled = false;
    saveBag(entry.scan.id, { scan: { caption: entry.scan.fileName } })
      .then((record) => {
        if (!cancelled) setPassenger(record);
      })
      .catch(() => {
        if (!cancelled) setPassenger(null);
      });
    return () => {
      cancelled = true;
    };
  }, [currentKey, mode]);

  useEffect(() => {
    lock.current = false;
    setPhase("entering");
    setPosed(false);
    setHoveredId(null);
    setFocusId(null);
    setShow3d(false);
    setConfirmClear(false);
    setScanStep(0);
    if (!entry) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const frame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => setPosed(true));
    });
    const scanAt = reduce ? 60 : 720;
    const timers: number[] = [];
    let cancelled = false;

    if (entry.kind === "sim") {
      const result = analyzeBag(entry.bag);
      const readyAt = scanAt + (reduce ? 240 : result.elapsedMs);
      timers.push(window.setTimeout(() => setPhase("scanning"), scanAt));
      timers.push(window.setTimeout(() => setPhase("ready"), readyAt));
      SCAN_LINES.forEach((_, step) => {
        timers.push(
          window.setTimeout(
            () => setScanStep(step + 1),
            scanAt + ((readyAt - scanAt) / SCAN_LINES.length) * step,
          ),
        );
      });
    } else {
      const { scan } = entry;
      const started = performance.now();
      const minReady = scanAt + (reduce ? 200 : 650);
      // Only move forward: a slow first model load can fire the finish timer before this one.
      timers.push(window.setTimeout(() => setPhase((value) => (value === "entering" ? "scanning" : value)), scanAt));
      REAL_SCAN_LINES.slice(0, -1).forEach((_, step) => {
        timers.push(
          window.setTimeout(() => setScanStep((value) => Math.max(value, step + 1)), scanAt + step * 220),
        );
      });
      const finish = (next: Phase) => {
        const wait = Math.max(0, minReady - (performance.now() - started));
        timers.push(
          window.setTimeout(() => {
            setScanStep(REAL_SCAN_LINES.length);
            setPhase(next);
          }, wait),
        );
      };
      const cached = realResultsRef.current[scan.id];
      const job =
        cached && "raw" in cached
          ? Promise.resolve(cached)
          : detect(scan.bitmap).then((result) => {
              setModelState({ status: "ready", model: result.model });
              return { raw: result.detections, elapsedMs: result.elapsedMs };
            });
      job.then(
        (result) => {
          if (cancelled) return;
          setRealResults((current) => ({ ...current, [scan.id]: result }));
          finish("ready");
        },
        (error: unknown) => {
          if (cancelled) return;
          const message = error instanceof Error ? error.message : String(error);
          setRealResults((current) => ({ ...current, [scan.id]: { error: message } }));
          if (error instanceof Error && error.name === "ModelMissingError") {
            setModelState({ status: "missing", error: message });
          }
          finish("failed");
        },
      );
    }

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      timers.forEach((timer) => window.clearTimeout(timer));
    };
    // The entry key, run counter, and mode fully identify the bag being screened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentKey, run, mode]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (screen !== "console") return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (event.key === "Escape") {
        if (confirmClear) {
          setConfirmClear(false);
          return;
        }
        if (showHistory) {
          setShowHistory(false);
          return;
        }
        if (show3d) setShow3d(false);
        else if (focusId) setFocusId(null);
        return;
      }
      if (event.key === "3" || event.key === "Enter") {
        if (show3d && event.key === "Enter" && confirmClear) return;
        if (!show3d && phase === "ready" && entry && analysis) {
          event.preventDefault();
          setShow3d(true);
        }
        return;
      }
      if (!entry || show3d) return;
      if ((event.key === "h" || event.key === "H") && (phase === "ready" || phase === "failed")) {
        event.preventDefault();
        decide("held");
      }
      if ((event.key === "c" || event.key === "C") && phase === "ready") {
        event.preventDefault();
        requestClear();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function restart() {
    setDecisionsByMode((current) => ({ ...current, [mode]: [] }));
    setShow3d(false);
    setConfirmClear(false);
    setIndex(() => 0);
    setRun((value) => value + 1);
  }

  function decide(action: "cleared" | "held") {
    if (lock.current || !entry || (phase !== "ready" && phase !== "failed")) return;
    if (phase === "failed" && action === "cleared") return;
    lock.current = true;
    const meta = entryMeta(entry);
    const verdict = phase === "ready" && analysis ? analysis.verdict : "unscreened";
    const top = analysis?.detections.find((item) => item.threat) ?? null;
    setDecisionsByMode((current) => ({
      ...current,
      [mode]: [
        {
          bagId: meta.id,
          action,
          verdict,
          at: Date.now(),
        },
        ...current[mode],
      ],
    }));
    setConfirmClear(false);
    setShow3d(false);

    // Store the decision and the scan the officer saw, with its boxes, in the history server.
    if (entry.kind === "real") {
      const scan = entry.scan;
      const boxes = (analysis?.detections ?? [])
        .filter((d) => d.box)
        .map((d) => ({
          ...d.box!,
          kind: (d.uncertain ? "review" : d.threat ? "threat" : "benign") as "threat" | "review" | "benign",
          label: d.label,
          score: d.confidence,
        }));
      void saveBag(scan.id, {
        scan: { dataUrl: scanToJpeg(scan.bitmap, scan.width, scan.height, boxes), caption: scan.fileName },
        screening: { verdict, action, threatLabel: top?.label ?? null, confidence: top?.confidence ?? null, source: "console" },
      })
        .then(() => setHistoryTick((value) => value + 1))
        .catch(() => undefined);
    }

    setIndex((current) => current + 1);
  }

  function requestClear() {
    if (!analysis || phase !== "ready") return;
    if (analysis.verdict !== "clear") {
      setConfirmClear(true);
      return;
    }
    decide("cleared");
  }

  function inspect(id: string | null) {
    if (phase !== "ready") return;
    setFocusId(id);
    if (entry?.kind === "sim") setShow3d(true);
  }

  const [samples, setSamples] = useState<SampleScan[]>([]);
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}samples/samples.json`)
      .then((res) => (res.ok ? res.json() : []))
      .then((list: SampleScan[]) => setSamples(Array.isArray(list) ? list : []))
      .catch(() => setSamples([]));
  }, []);

  async function loadSamples() {
    const files = await Promise.all(
      samples.map(async (sample) => {
        const res = await fetch(`${import.meta.env.BASE_URL}samples/${sample.file}`);
        const blob = await res.blob();
        return new File([blob], sample.name ?? sample.file, { type: blob.type });
      }),
    );
    await addFiles(files);
  }

  async function addFiles(list: FileList | File[]) {
    const files = Array.from(list);
    const loaded: PaneSource[] = [];
    const problems: string[] = [];
    for (const file of files) {
      try {
        loaded.push({ kind: "real", scan: await loadScan(file) });
      } catch (error) {
        problems.push(error instanceof Error ? error.message : String(error));
      }
    }
    if (files.length === 0) problems.push("Drop image files: PNG, JPG, WebP, or BMP.");
    setUploadNote(problems.length ? problems.join(" ") : null);
    if (loaded.length === 0) return;
    setRealEntries((current) => [...current, ...loaded]);
    if (mode !== "real") {
      setMode("real");
      setFilter("all");
    }
  }

  function carriesFiles(event: DragEvent) {
    return Array.from(event.dataTransfer.types).includes("Files");
  }

  function onDragEnter(event: DragEvent) {
    if (screen !== "console") return;
    if (!carriesFiles(event)) return;
    event.preventDefault();
    dragDepth.current += 1;
    setDragActive(true);
  }

  function onDragOver(event: DragEvent) {
    if (screen !== "console") return;
    if (!carriesFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function onDragLeave(event: DragEvent) {
    if (screen !== "console") return;
    if (!carriesFiles(event)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragActive(false);
  }

  function onDrop(event: DragEvent) {
    if (screen !== "console") return;
    if (!carriesFiles(event)) return;
    event.preventDefault();
    dragDepth.current = 0;
    setDragActive(false);
    void addFiles(event.dataTransfer.files);
  }

  const held = decisions.filter((d) => d.action === "held").length;
  const cleared = decisions.filter((d) => d.action === "cleared").length;
  const topThreat = analysis?.detections.find((d) => d.threat) ?? null;
  const ready = phase === "ready" && analysis !== null;
  const failure = realResult && "error" in realResult ? realResult.error : null;
  const meta = entry ? entryMeta(entry) : null;
  const grayscale = entry?.kind === "real" && !entry.scan.colorful;

  let verdictText = mode === "real" ? "Drop an X-ray to start" : "Waiting for a bag";
  if (entry && phase === "entering") verdictText = isReal ? "Image entering lane" : "Bag entering lane";
  if (entry && phase === "scanning") verdictText = isReal ? "Running threat detector" : "Analyzing dual-energy scan";
  if (entry && phase === "failed") verdictText = "Not screened · model unavailable";
  if (ready && analysis.verdict === "clear") verdictText = "No threats found";
  if (ready && analysis.verdict === "review") {
    const weak = analysis.detections.find((d) => d.uncertain);
    verdictText = weak ? `Look closer · possible ${weak.label} ${weak.confidence.toFixed(2)}` : "Look closer";
  }
  if (ready && analysis.verdict === "threat") {
    verdictText = topThreat
      ? `Threat · ${topThreat.label} ${topThreat.confidence.toFixed(3)}`
      : "Threat detected";
  }
  const stateClass = ready ? analysis.verdict : phase;

  const scanLines = isReal ? REAL_SCAN_LINES : SCAN_LINES;

  return (
    <div
      className={`app ${ready && analysis.verdict === "threat" ? "is-threat" : ""} ${ready && analysis.verdict === "clear" ? "is-clear" : ""} ${ready && analysis.verdict === "review" ? "is-review" : ""}`}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <header className="topbar">
        <div className="brand">
          <span className="mark" aria-hidden="true">
            <svg viewBox="0 0 32 32">
              <path d="M6 26V12a10 10 0 0 1 20 0v14" fill="none" stroke="currentColor" strokeWidth="2" />
              <path d="M11 26V16a5 5 0 0 1 10 0v10" fill="none" stroke="#ff3348" strokeWidth="2" />
            </svg>
          </span>
          <div>
            <strong>GILGAMESH</strong>
          </div>
        </div>
        <div className="view-switch" role="group" aria-label="Screen">
          <button type="button" className={screen === "lane" ? "on" : ""} onClick={() => setScreen("lane")}>
            Lane
          </button>
          <button type="button" className={screen === "console" ? "on" : ""} onClick={() => setScreen("console")}>
            Console
          </button>
        </div>
        <div className="station">
          <span>Terminal 3</span>
          <span className="dot" />
          <span>Lane 04</span>
          <span className="dot" />
          <span>Carry-on</span>
        </div>
        <div className="top-stats">
          <button type="button" className="ghost history-btn" onClick={() => setShowHistory(true)}>
            History
          </button>
          <span className="live">
            <i /> Live
          </span>
          {screen === "console" && (
            <>
              <span className="stat">
                Cleared <b>{cleared}</b>
              </span>
              <span className="stat held">
                Held <b>{held}</b>
              </span>
            </>
          )}
          <time dateTime={now.toISOString()}>{formatClock(now)}</time>
        </div>
      </header>

      {screen === "lane" ? (
        <LaneView onRecord={() => setHistoryTick((value) => value + 1)} />
      ) : (
      <div className="workspace">
        <aside className="rail queue">
          <div className="rail-head">
            <h2>Queue</h2>
            <span>{entries.length === 0 ? "Empty" : done ? "Done" : `${index + 1} of ${entries.length}`}</span>
          </div>
          <ol className="bag-list">
            {entries.map((laneEntry, entryIndex) => {
              const laneMeta = entryMeta(laneEntry);
              const decision = decisions.find((item) => item.bagId === laneMeta.id);
              const state =
                decision?.action ??
                (entryIndex === index ? phase : entryIndex > index ? "waiting" : "done");
              const liveVerdict = entryIndex === index && ready ? analysis.verdict : "";
              return (
                <li
                  key={laneMeta.id}
                  className={`bag-card ${entryIndex === index ? "current" : ""} ${state} ${liveVerdict}`}
                >
                  <div className="bag-row">
                    <b>{laneMeta.id}</b>
                    <em>
                      {state === "cleared"
                        ? "Cleared"
                        : state === "held"
                          ? "Held"
                          : entryIndex === index
                            ? phaseLabel(phase)
                            : "Queued"}
                    </em>
                  </div>
                  <div className="bag-meta" title={laneMeta.detail}>
                    {laneMeta.kind} · {laneMeta.detail}
                  </div>
                </li>
              );
            })}
            {mode === "real" && entries.length === 0 && (
              <li className="bag-hint">Uploaded scans line up here. Drop images anywhere on the console.</li>
            )}
          </ol>
          <div className="rail-foot">
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(event) => {
                if (event.target.files) void addFiles(event.target.files);
                event.target.value = "";
              }}
            />
            <button type="button" className="ghost upload" onClick={() => fileInput.current?.click()}>
              Add X-ray Images
            </button>
            {uploadNote && <p className="note">{uploadNote}</p>}
            <button
              type="button"
              className="texty"
              onClick={restart}
              disabled={entries.length === 0 || (index === 0 && decisions.length === 0)}
            >
              Restart Lane
            </button>
          </div>
        </aside>

        <main className="stage">
          {!entry || !meta ? (
            mode === "real" && entries.length === 0 ? (
              <div className="empty dropzone">
                <div className="arch" />
                <h2>Screen a real X-ray</h2>
                <p>
                  Drop PNG or JPG bag scans anywhere on the console, or choose files. Images stay on this laptop and
                  the model runs in the browser.
                </p>
                <div className="empty-actions">
                  {samples.length > 0 && (
                    <button type="button" className="primary safe" data-testid="try-samples" onClick={() => void loadSamples()}>
                      Try {samples.length} sample scans
                    </button>
                  )}
                  <button
                    type="button"
                    className={samples.length > 0 ? "ghost" : "primary safe"}
                    onClick={() => fileInput.current?.click()}
                  >
                    Choose images
                  </button>
                </div>
                <ModelStatus state={modelState} onRetry={warmModel} />
              </div>
            ) : (
              <div className="empty">
                <div className="arch" />
                <h2>Lane clear</h2>
                <p>
                  {cleared} cleared · {held} held for search
                </p>
                <div className="empty-actions">
                  {mode === "real" && (
                    <button type="button" className="ghost" onClick={() => fileInput.current?.click()}>
                      Add more images
                    </button>
                  )}
                  <button type="button" className="primary safe" onClick={restart}>
                    Replay lane
                  </button>
                </div>
              </div>
            )
          ) : (
            <>
              <div className="stage-head">
                <div>
                  <p className="kicker">Now screening</p>
                  <h2>
                    {meta.id}
                    <span>
                      {meta.kind} · {meta.detail}
                      {meta.size ? ` · ${meta.size}` : ""}
                    </span>
                  </h2>
                </div>
                <div className="filters" role="group" aria-label="Material filter">
                  {FILTERS.map((entryFilter) => (
                    <button
                      key={entryFilter.id}
                      type="button"
                      className={filter === entryFilter.id ? "on" : ""}
                      disabled={grayscale && entryFilter.id !== "all"}
                      title={grayscale && entryFilter.id !== "all" ? "This grayscale scan has no material colors" : undefined}
                      onClick={() => setFilter(entryFilter.id)}
                    >
                      {entryFilter.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className={`views ${stateClass} ${isReal ? "single" : ""}`}>
                {ready && analysis.verdict === "clear" && <div className="stamp clear">No threats found</div>}
                <XrayPane
                  source={entry}
                  view="top"
                  filter={grayscale ? "all" : filter}
                  phase={phase}
                  detections={ready ? analysis.detections : []}
                  activeId={hoveredId ?? (isReal ? focusId : null)}
                  posed={posed}
                  onHover={setHoveredId}
                  onInspect={inspect}
                />
                {!isReal && (
                  <XrayPane
                    source={entry}
                    view="side"
                    filter={filter}
                    phase={phase}
                    detections={ready ? analysis.detections : []}
                    activeId={hoveredId}
                    posed={posed}
                    onHover={setHoveredId}
                    onInspect={inspect}
                  />
                )}
              </div>

              <div className={`verdict-bar ${stateClass}`} role="status" aria-live="polite" data-testid="verdict">
                <strong>{verdictText}</strong>
                {ready && (
                  <span>
                    {analysis.verdict === "clear" ? "Officer confirms before clearing · " : ""}
                    {analysis.detections.length} object{analysis.detections.length === 1 ? "" : "s"} ·{" "}
                    {analysis.threatCount} threat
                    {analysis.threatCount === 1 ? "" : "s"}
                    {analysis.verdict === "review" ? " · weak hits shown in orange" : ""}
                  </span>
                )}
              </div>
              <div className="rollers" aria-hidden="true" />
            </>
          )}
        </main>

        <aside className="rail assess">
          <div className="rail-head">
            <h2>Findings</h2>
            {ready && <span>{formatElapsed(analysis.elapsedMs)}</span>}
          </div>

          {passenger && (
            <div className="passenger-slot">
              <PassengerCard record={passenger} compact />
            </div>
          )}

          {!entry ? (
            <p className="muted pad">
              {mode === "real"
                ? "Queue is empty. Add X-ray images to screen them."
                : "Queue is empty. Replay the lane to run the set again."}
            </p>
          ) : phase === "failed" ? (
            <div className="fail pad">
              <p>{failure ?? "The detector couldn't run on this image."}</p>
              <p className="muted">Hold the bag for a manual search, or fix the model and retry.</p>
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  setModelState({ status: "idle" });
                  setRealResults((current) => {
                    const next = { ...current };
                    if (entry.kind === "real") delete next[entry.scan.id];
                    return next;
                  });
                  setRun((value) => value + 1);
                }}
              >
                Retry detector
              </button>
            </div>
          ) : !ready ? (
            <ol className="scan-log">
              {scanLines.map((line, step) => (
                <li key={line} className={scanStep > step ? "on" : ""}>
                  <i />
                  {line}
                </li>
              ))}
            </ol>
          ) : (
            <>
              {isReal && (
                <div className="threshold">
                  <label htmlFor="threshold">
                    <span>Alarm threshold</span>
                    <b>{effectiveThreshold.toFixed(2)}</b>
                  </label>
                  <input
                    id="threshold"
                    type="range"
                    min={0.05}
                    max={0.9}
                    step={0.01}
                    value={effectiveThreshold}
                    onChange={(event) => setThreshold(Number(event.target.value))}
                  />
                  <p>Lower catches more and raises more false alarms.</p>
                </div>
              )}
              {analysis.detections.length === 0 ? (
                <p className="muted pad">
                  No objects above {effectiveThreshold.toFixed(2)}. Lower the threshold to see weaker detections.
                </p>
              ) : (
                <ul className="detections">
                  {analysis.detections.map((detection) => (
                    <li key={detection.itemId}>
                      <button
                        type="button"
                        className={`${detection.uncertain ? "uncertain" : detection.threat ? "threat" : ""} ${focusId === detection.itemId ? "on" : ""}`}
                        onMouseEnter={() => setHoveredId(detection.itemId)}
                        onMouseLeave={() => setHoveredId(null)}
                        onClick={() => inspect(detection.itemId)}
                      >
                        <span className="det-top">
                          <b>{detection.label}</b>
                          <em>{detection.confidence.toFixed(3)}</em>
                        </span>
                        <span className="det-sub">
                          {materialText(detection.material, isReal)}
                          {detection.uncertain ? " · possible threat, below alarm" : detection.threat ? " · threat" : ""}
                        </span>
                        <span className="meter" aria-hidden="true">
                          <span style={{ width: `${detection.confidence * 100}%` }} />
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          <div className="legend">
            <span>
              <i className="swatch organic" /> Organic
            </span>
            <span>
              <i className="swatch mixed" /> Mixed
            </span>
            <span>
              <i className="swatch metal" /> Metal
            </span>
            <span>
              <i className="swatch threat" /> Threat
            </span>
          </div>

          <div className="actions">
            {confirmClear && analysis && analysis.verdict !== "clear" ? (
              <div className="confirm">
                <p>
                  {analysis.verdict === "threat"
                    ? "This bag has a flagged threat. Clearing it overrides the model and sends it down the lane."
                    : "The model saw a possible threat it wasn't sure about. Clear only if you checked that spot."}
                </p>
                <div className="action-row">
                    <button type="button" className="ghost" onClick={() => setConfirmClear(false)}>
                    Keep Holding
                  </button>
                  <button type="button" className="primary danger" onClick={() => decide("cleared")}>
                    Override and Clear
                  </button>
                </div>
              </div>
            ) : (
              <div className="action-row">
                {phase === "failed" ? (
                    <button type="button" className="primary danger" onClick={() => decide("held")}>
                    Hold for Search
                  </button>
                ) : analysis && analysis.verdict !== "clear" ? (
                  <>
                    <button type="button" className="primary danger" disabled={!ready} onClick={() => decide("held")}>
                      Hold for Search
                    </button>
                    <button type="button" className="ghost" disabled={!ready} onClick={requestClear}>
                      Override Clear
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="primary safe"
                      data-testid="safe-btn"
                      disabled={!entry || !ready}
                      onClick={requestClear}
                    >
                      Clear Bag
                    </button>
                    <button type="button" className="ghost" disabled={!entry || !ready} onClick={() => decide("held")}>
                      Hold for Search
                    </button>
                  </>
                )}
              </div>
            )}
            {mode === "real" ? (
              <button
                type="button"
                className="open3d"
                data-testid="open-density"
                disabled={!entry || !ready || !analysis}
                title="Density visualization, not a CT scan"
                onClick={() => setShow3d(true)}
              >
                Open Density View
              </button>
            ) : (
              <button
                type="button"
                className="open3d"
                data-testid="open-3d"
                disabled={!entry || !ready}
                onClick={() => inspect(hoveredId)}
              >
                View in 3D
              </button>
            )}
          </div>
        </aside>

        {show3d && entry?.kind === "sim" && analysis && (
          <div className="inspector" role="dialog" aria-label="3D luggage render">
            <ThreeView
              key={entry.bag.id}
              bag={entry.bag}
              focusId={focusId}
              verdict={analysis.verdict}
              onSelect={setFocusId}
            />
            <aside className="inspect-side">
              <div className="rail-head">
                <h2>3D View</h2>
                <button type="button" className="texty" onClick={() => setShow3d(false)}>
                  Done
                </button>
              </div>
              <p className="muted">
                {entry.bag.id} · {TYPE_LABEL[entry.bag.type]}. Red marks a threat. Click an item to frame it.
              </p>
              <ul className="detections">
                {analysis.detections.map((detection) => (
                  <li key={detection.itemId}>
                    <button
                      type="button"
                      className={`${detection.uncertain ? "uncertain" : detection.threat ? "threat" : ""} ${focusId === detection.itemId ? "on" : ""}`}
                      onClick={() => setFocusId(detection.itemId)}
                    >
                      <span className="det-top">
                        <b>{detection.label}</b>
                        <em>{detection.confidence.toFixed(3)}</em>
                      </span>
                      <span className="det-sub">{detection.uncertain ? "Possible threat · click to frame" : detection.threat ? "Threat · click to frame" : "Click to frame"}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="actions">
                {analysis.verdict === "clear" ? (
                  <button type="button" className="primary safe" onClick={() => decide("cleared")}>
                    Clear Bag
                  </button>
                ) : (
                  <button type="button" className="primary danger" onClick={() => decide("held")}>
                    Hold for Search
                  </button>
                )}
              </div>
            </aside>
          </div>
        )}

        {show3d && entry?.kind === "real" && analysis && (
          <div className="inspector" role="dialog" aria-label="3D density view">
            <DensityView
              key={entry.scan.id}
              scan={entry.scan}
              detections={analysis.detections}
              focusId={focusId}
              onSelect={setFocusId}
            />
            <aside className="inspect-side">
              <div className="rail-head">
                <h2>Density View</h2>
                <button type="button" className="texty" onClick={() => setShow3d(false)}>
                  Done
                </button>
              </div>
              <p className="muted">
                {entry.scan.fileName}. Darker, denser material rises higher. Layers splits organic, mixed, and metal by
                color. This is a density visualization of one 2D X-ray, not a CT scan.
              </p>
              <ul className="detections">
                {analysis.detections.map((detection) => (
                  <li key={detection.itemId}>
                    <button
                      type="button"
                      className={`${detection.uncertain ? "uncertain" : detection.threat ? "threat" : ""} ${focusId === detection.itemId ? "on" : ""}`}
                      onClick={() => setFocusId(detection.itemId)}
                    >
                      <span className="det-top">
                        <b>{detection.label}</b>
                        <em>{detection.confidence.toFixed(3)}</em>
                      </span>
                      <span className="det-sub">{detection.uncertain ? "Possible threat · click to frame" : detection.threat ? "Threat · click to frame" : "Click to frame"}</span>
                    </button>
                  </li>
                ))}
                {analysis.detections.length === 0 && <li className="muted">No detections above threshold.</li>}
              </ul>
              <div className="actions">
                {analysis.verdict === "clear" ? (
                  <button type="button" className="primary safe" onClick={() => decide("cleared")}>
                    Clear Bag
                  </button>
                ) : (
                  <button type="button" className="primary danger" onClick={() => decide("held")}>
                    Hold for Search
                  </button>
                )}
              </div>
            </aside>
          </div>
        )}

        {dragActive && (
          <div className="drop-overlay" aria-hidden="true">
            <div>
              <strong>Drop X-rays to screen</strong>
              <span>PNG, JPG, WebP, or BMP · runs on this laptop</span>
            </div>
          </div>
        )}

      </div>
      )}

      <HistorySheet open={showHistory} onClose={() => setShowHistory(false)} refreshKey={historyTick} />

    </div>
  );
}

function ModelStatus({ state, onRetry }: { state: ModelState; onRetry: () => void }) {
  if (state.status === "ready") {
    const { config } = state.model;
    return (
      <p className="model-status ok">
        Model ready · {config.name} · {config.labels.length} classes
      </p>
    );
  }
  if (state.status === "missing") {
    return (
      <div className="model-status missing">
        <p>{state.error}</p>
        <button type="button" className="texty" onClick={onRetry}>
          Check again
        </button>
      </div>
    );
  }
  return <p className="model-status">Loading model…</p>;
}

function materialText(material: string, estimated: boolean) {
  if (material === "unknown") return "material n/a";
  return estimated ? `${material} (est.)` : material;
}

function formatElapsed(ms: number) {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)}s`;
}

function phaseLabel(phase: Phase) {
  if (phase === "entering") return "Entering";
  if (phase === "scanning") return "Scanning";
  if (phase === "failed") return "Not screened";
  return "On screen";
}
