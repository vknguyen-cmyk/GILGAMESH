import { useEffect, useRef, useState } from "react";
import type { Detection } from "../types";
import type { RealScan } from "../lib/realScan";
import { mountDensityScene, type DensityApi, type DensityMode } from "../lib/densityScene";

interface DensityViewProps {
  scan: RealScan;
  detections: Detection[];
  focusId: string | null;
  onSelect: (id: string | null) => void;
}

export function DensityView({ scan, detections, focusId, onSelect }: DensityViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<DensityApi | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const [mode, setMode] = useState<DensityMode>("landscape");
  const [height, setHeight] = useState(45);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const api = mountDensityScene(host, scan, detections, (id) => onSelectRef.current(id));
    apiRef.current = api;
    const observer = new ResizeObserver(() => api.resize());
    observer.observe(host);
    return () => {
      observer.disconnect();
      api.dispose();
      apiRef.current = null;
    };
  }, [scan, detections]);

  useEffect(() => apiRef.current?.setMode(mode), [mode, scan, detections]);
  useEffect(() => apiRef.current?.setHeight(height / 100), [height, scan, detections]);
  useEffect(() => apiRef.current?.setFocus(focusId), [focusId, scan, detections]);

  return (
    <div className="three-wrap">
      <div ref={hostRef} className="three-host" data-testid="density-view" />
      <div className="three-badge clear">Density view · not a CT scan</div>
      <div className="three-hud">
        <div className="seg" role="group" aria-label="Density view mode">
          <button type="button" className={mode === "landscape" ? "on" : "ghost"} onClick={() => setMode("landscape")}>
            Landscape
          </button>
          <button type="button" className={mode === "layers" ? "on" : "ghost"} onClick={() => setMode("layers")}>
            Layers
          </button>
        </div>
        <label className="slice">
          <span>{mode === "landscape" ? "Height" : "Spread"} {height}%</span>
          <input
            type="range"
            min={0}
            max={100}
            value={height}
            aria-label="Height of the density relief"
            onChange={(event) => setHeight(Number(event.target.value))}
          />
        </label>
        <button type="button" className="ghost" onClick={() => onSelect(null)}>
          Frame Bag
        </button>
      </div>
    </div>
  );
}
