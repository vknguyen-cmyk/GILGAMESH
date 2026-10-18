import { useEffect, useRef, useState } from "react";
import type { Bag } from "../types";
import { mountScene, type SceneApi } from "../lib/threeScene";

interface ThreeViewProps {
  bag: Bag;
  focusId: string | null;
  verdict: "clear" | "review" | "threat";
  onSelect: (id: string | null) => void;
}

export function ThreeView({ bag, focusId, verdict, onSelect }: ThreeViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<SceneApi | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const [slice, setSlice] = useState(100);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const api = mountScene(host, bag, (id) => onSelectRef.current(id));
    apiRef.current = api;
    const observer = new ResizeObserver(() => api.resize());
    observer.observe(host);
    return () => {
      observer.disconnect();
      api.dispose();
      apiRef.current = null;
    };
  }, [bag]);

  useEffect(() => {
    apiRef.current?.setFocus(focusId);
  }, [focusId, bag]);

  useEffect(() => {
    apiRef.current?.setSlice(slice / 100);
  }, [slice, bag]);

  return (
    <div className="three-wrap">
      <div ref={hostRef} className="three-host" data-testid="three-view" />
      <div className={`three-badge ${verdict}`}>
        {verdict === "clear" ? "No threats found" : "Threat in volume"}
      </div>
      <div className="three-hud">
        <p>Drag to rotate · scroll to zoom</p>
        <label className="slice">
          <span>Clip {slice}%</span>
          <input
            type="range"
            min={12}
            max={100}
            value={slice}
            aria-label="Clip the 3D volume by height"
            onChange={(event) => setSlice(Number(event.target.value))}
          />
        </label>
        <button
          type="button"
          className="ghost"
          onClick={() => {
            onSelect(null);
            apiRef.current?.setFocus(null);
          }}
        >
          Reset View
        </button>
      </div>
    </div>
  );
}
