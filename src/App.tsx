import { useEffect, useRef, useState } from "react";
import { BAGS, TYPE_LABEL } from "./data/bags";
import { analyzeBag } from "./lib/analyze";
import type { Decision, MaterialFilter, Phase } from "./types";
import { ThreeView } from "./components/ThreeView";
import { XrayPane } from "./components/XrayPane";

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

function formatClock(date: Date) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function App() {
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("entering");
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [filter, setFilter] = useState<MaterialFilter>("all");
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [show3d, setShow3d] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [posed, setPosed] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [scanStep, setScanStep] = useState(0);
  const [run, setRun] = useState(0);
  const lock = useRef(false);

  const bag = BAGS[index] ?? null;
  const analysis = bag ? analyzeBag(bag) : null;
  const done = !bag;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    lock.current = false;
    if (index >= BAGS.length) return;
    const current = BAGS[index];
    const result = analyzeBag(current);
    setPhase("entering");
    setPosed(false);
    setHoveredId(null);
    setFocusId(null);
    setShow3d(false);
    setConfirmClear(false);
    setScanStep(0);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const frame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => setPosed(true));
    });
    const scanAt = reduce ? 60 : 720;
    const readyAt = scanAt + (reduce ? 240 : result.elapsedMs);
    const tScan = window.setTimeout(() => setPhase("scanning"), scanAt);
    const tReady = window.setTimeout(() => setPhase("ready"), readyAt);
    const stepTimers = SCAN_LINES.map((_, step) =>
      window.setTimeout(
        () => setScanStep(step + 1),
        scanAt + ((readyAt - scanAt) / SCAN_LINES.length) * step,
      ),
    );
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(tScan);
      window.clearTimeout(tReady);
      stepTimers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [index, run]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (event.key === "Escape") {
        if (confirmClear) {
          setConfirmClear(false);
          return;
        }
        if (show3d) setShow3d(false);
        return;
      }
      if (event.key === "3" || event.key === "Enter") {
        if (show3d && event.key === "Enter" && confirmClear) return;
        if (!show3d && phase === "ready" && bag) {
          event.preventDefault();
          setShow3d(true);
        }
        return;
      }
      if (!bag || phase !== "ready" || show3d) return;
      if (event.key === "h" || event.key === "H") {
        event.preventDefault();
        decide("held");
      }
      if (event.key === "c" || event.key === "C") {
        event.preventDefault();
        requestClear();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function restart() {
    setDecisions([]);
    setShow3d(false);
    setConfirmClear(false);
    setIndex(0);
    setRun((value) => value + 1);
  }

  function decide(action: "cleared" | "held") {
    if (lock.current || !bag || !analysis || phase !== "ready") return;
    lock.current = true;
    setDecisions((current) => [
      {
        bagId: bag.id,
        type: bag.type,
        tag: bag.tag,
        action,
        verdict: analysis.verdict,
        at: Date.now(),
      },
      ...current,
    ]);
    setConfirmClear(false);
    setShow3d(false);
    setIndex((current) => current + 1);
  }

  function requestClear() {
    if (!analysis) return;
    if (analysis.verdict === "threat") {
      setConfirmClear(true);
      return;
    }
    decide("cleared");
  }

  function inspect(id: string | null) {
    if (phase !== "ready") return;
    setFocusId(id);
    setShow3d(true);
  }

  const held = decisions.filter((d) => d.action === "held").length;
  const cleared = decisions.filter((d) => d.action === "cleared").length;
  const topThreat = analysis?.detections.find((d) => d.threat) ?? null;

  let verdictText = "Waiting for a bag";
  if (bag && phase === "entering") verdictText = "Bag entering lane";
  if (bag && phase === "scanning") verdictText = "Analyzing dual-energy scan";
  if (bag && phase === "ready" && analysis?.verdict === "clear") verdictText = "Safe to proceed";
  if (bag && phase === "ready" && analysis?.verdict === "threat") {
    verdictText = topThreat
      ? `Threat detected · ${topThreat.label} ${topThreat.confidence.toFixed(3)}`
      : "Threat detected";
  }

  return (
    <div className={`app ${analysis?.verdict === "threat" && phase === "ready" ? "is-threat" : ""} ${analysis?.verdict === "clear" && phase === "ready" ? "is-clear" : ""}`}>
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
            <span>Lane screening</span>
          </div>
        </div>
        <div className="station">
          <span>Terminal 3</span>
          <span className="dot" />
          <span>Lane 04</span>
          <span className="dot" />
          <span>Carry-on</span>
        </div>
        <div className="top-stats">
          <span className="live">
            <i /> Live
          </span>
          <span className="stat">
            Cleared <b>{cleared}</b>
          </span>
          <span className="stat held">
            Held <b>{held}</b>
          </span>
          <time dateTime={now.toISOString()}>{formatClock(now)}</time>
        </div>
      </header>

      <div className="workspace">
        <aside className="rail queue">
          <div className="rail-head">
            <h2>Lane queue</h2>
            <span>{done ? "0" : `${index + 1} / ${BAGS.length}`}</span>
          </div>
          <ol className="bag-list">
            {BAGS.map((entry, entryIndex) => {
              const decision = decisions.find((item) => item.bagId === entry.id);
              const state =
                decision?.action ??
                (entryIndex === index ? phase : entryIndex > index ? "waiting" : "done");
              const liveVerdict = entryIndex === index && phase === "ready" && analysis ? analysis.verdict : "";
              return (
                <li key={entry.id} className={`bag-card ${entryIndex === index ? "current" : ""} ${state} ${liveVerdict}`}>
                  <div className="bag-row">
                    <b>{entry.id}</b>
                    <em>{state === "cleared" ? "Cleared" : state === "held" ? "Held" : entryIndex === index ? phaseLabel(phase) : "Queued"}</em>
                  </div>
                  <div className="bag-meta">
                    {TYPE_LABEL[entry.type]} · Tag {entry.tag}
                  </div>
                </li>
              );
            })}
          </ol>
          <div className="rail-foot">
            <button type="button" className="texty" onClick={restart} disabled={index === 0 && decisions.length === 0}>
              Restart lane
            </button>
          </div>
        </aside>

        <main className="stage">
          {done || !bag || !analysis ? (
            <div className="empty">
              <div className="arch" />
              <h2>Lane clear</h2>
              <p>
                {cleared} cleared · {held} held for search
              </p>
              <button type="button" className="primary safe" onClick={restart}>
                Replay lane
              </button>
            </div>
          ) : (
            <>
              <div className="stage-head">
                <div>
                  <p className="kicker">Now screening</p>
                  <h2>
                    {bag.id}
                    <span>
                      {TYPE_LABEL[bag.type]} · Tag {bag.tag}
                    </span>
                  </h2>
                </div>
                <div className="filters" role="group" aria-label="Material filter">
                  {FILTERS.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      className={filter === entry.id ? "on" : ""}
                      onClick={() => setFilter(entry.id)}
                    >
                      {entry.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className={`views ${phase === "ready" ? analysis.verdict : phase}`}>
                {phase === "ready" && analysis.verdict === "clear" && (
                  <div className="stamp clear">Safe to proceed</div>
                )}
                <XrayPane
                  bag={bag}
                  view="top"
                  filter={filter}
                  phase={phase}
                  detections={phase === "ready" ? analysis.detections : []}
                  hoveredId={hoveredId}
                  posed={posed}
                  onHover={setHoveredId}
                  onInspect={inspect}
                />
                <XrayPane
                  bag={bag}
                  view="side"
                  filter={filter}
                  phase={phase}
                  detections={phase === "ready" ? analysis.detections : []}
                  hoveredId={hoveredId}
                  posed={posed}
                  onHover={setHoveredId}
                  onInspect={inspect}
                />
              </div>

              <div className={`verdict-bar ${phase === "ready" ? analysis.verdict : phase}`} role="status" aria-live="polite" data-testid="verdict">
                <strong>{verdictText}</strong>
                {phase === "ready" && (
                  <span>
                    {analysis.detections.length} objects · {analysis.threatCount} threat
                    {analysis.threatCount === 1 ? "" : "s"}
                  </span>
                )}
              </div>
              <div className="rollers" aria-hidden="true" />
            </>
          )}
        </main>

        <aside className="rail assess">
          <div className="rail-head">
            <h2>Assessment</h2>
            {phase === "ready" && analysis && <span>{(analysis.elapsedMs / 1000).toFixed(1)}s</span>}
          </div>

          {!bag || !analysis ? (
            <p className="muted pad">Queue is empty. Replay the lane to run the set again.</p>
          ) : phase !== "ready" ? (
            <ol className="scan-log">
              {SCAN_LINES.map((line, step) => (
                <li key={line} className={scanStep > step ? "on" : ""}>
                  <i />
                  {line}
                </li>
              ))}
            </ol>
          ) : (
            <ul className="detections">
              {analysis.detections.map((detection) => (
                <li key={detection.itemId}>
                  <button
                    type="button"
                    className={`${detection.threat ? "threat" : ""} ${focusId === detection.itemId ? "on" : ""}`}
                    onMouseEnter={() => setHoveredId(detection.itemId)}
                    onMouseLeave={() => setHoveredId(null)}
                    onClick={() => inspect(detection.itemId)}
                  >
                    <span className="det-top">
                      <b>{detection.label}</b>
                      <em>{detection.confidence.toFixed(3)}</em>
                    </span>
                    <span className="det-sub">
                      {detection.material}
                      {detection.threat ? " · threat" : ""}
                    </span>
                    <span className="meter" aria-hidden="true">
                      <span style={{ width: `${detection.confidence * 100}%` }} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="legend">
            <span><i className="swatch organic" /> Organic</span>
            <span><i className="swatch mixed" /> Mixed</span>
            <span><i className="swatch metal" /> Metal</span>
            <span><i className="swatch threat" /> Threat</span>
          </div>

          <div className="actions">
            {confirmClear && analysis?.verdict === "threat" ? (
              <div className="confirm">
                <p>This bag has a flagged threat. Clearing it overrides the model and sends it down the lane.</p>
                <div className="action-row">
                  <button type="button" className="ghost" onClick={() => setConfirmClear(false)}>
                    Keep on hold
                  </button>
                  <button type="button" className="primary danger" onClick={() => decide("cleared")}>
                    Override and clear
                  </button>
                </div>
              </div>
            ) : (
              <div className="action-row">
                {analysis?.verdict === "threat" ? (
                  <>
                    <button type="button" className="primary danger" disabled={phase !== "ready"} onClick={() => decide("held")}>
                      Hold for search
                    </button>
                    <button type="button" className="ghost" disabled={phase !== "ready"} onClick={requestClear}>
                      Override clear
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" className="ghost" disabled={!bag || phase !== "ready"} onClick={() => decide("held")}>
                      Hold for search
                    </button>
                    <button
                      type="button"
                      className="primary safe"
                      data-testid="safe-btn"
                      disabled={!bag || phase !== "ready"}
                      onClick={requestClear}
                    >
                      Safe to proceed
                    </button>
                  </>
                )}
              </div>
            )}
            <button
              type="button"
              className="open3d"
              data-testid="open-3d"
              disabled={!bag || phase !== "ready"}
              onClick={() => inspect(hoveredId)}
            >
              Open 3D render
            </button>
          </div>
        </aside>

        {show3d && bag && analysis && (
          <div className="inspector" role="dialog" aria-label="3D luggage render">
            <ThreeView key={bag.id} bag={bag} focusId={focusId} verdict={analysis.verdict} onSelect={setFocusId} />
            <aside className="inspect-side">
              <div className="rail-head">
                <h2>3D render</h2>
                <button type="button" className="texty" onClick={() => setShow3d(false)}>
                  Back to 2D
                </button>
              </div>
              <p className="muted">
                {bag.id} · {TYPE_LABEL[bag.type]}. Wire boxes mark the same objects as the X-ray. Red is a threat.
              </p>
              <ul className="detections">
                {analysis.detections.map((detection) => (
                  <li key={detection.itemId}>
                    <button
                      type="button"
                      className={`${detection.threat ? "threat" : ""} ${focusId === detection.itemId ? "on" : ""}`}
                      onClick={() => setFocusId(detection.itemId)}
                    >
                      <span className="det-top">
                        <b>{detection.label}</b>
                        <em>{detection.confidence.toFixed(3)}</em>
                      </span>
                      <span className="det-sub">{detection.threat ? "Threat · click to frame" : "Click to frame"}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="actions">
                {analysis.verdict === "clear" ? (
                  <button type="button" className="primary safe" onClick={() => decide("cleared")}>
                    Safe to proceed
                  </button>
                ) : (
                  <button type="button" className="primary danger" onClick={() => decide("held")}>
                    Hold for search
                  </button>
                )}
              </div>
            </aside>
          </div>
        )}
      </div>

      <footer className="bottombar">
        <span>Simulation lane · scores are scripted for the booth</span>
        <span className="keys">
          {show3d ? "Esc back to 2D · drag to orbit" : "Click a box or the bag for 3D · H hold · C clear · 3 open 3D"}
        </span>
      </footer>
    </div>
  );
}

function phaseLabel(phase: Phase) {
  if (phase === "entering") return "Entering";
  if (phase === "scanning") return "Scanning";
  return "Review";
}
