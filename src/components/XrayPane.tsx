import { useLayoutEffect, useRef } from "react";
import type { Bag, MaterialFilter, Phase, Projected, ViewKind } from "../types";
import { bagWindow, projectItem } from "../lib/geometry";
import { renderXray } from "../lib/renderXray";
import type { Detection } from "../types";

interface XrayPaneProps {
  bag: Bag;
  view: ViewKind;
  filter: MaterialFilter;
  phase: Phase;
  detections: Detection[];
  hoveredId: string | null;
  posed: boolean;
  onHover: (id: string | null) => void;
  onInspect: (id: string | null) => void;
}

const VIEW_LABEL: Record<ViewKind, string> = {
  top: "View A · Top",
  side: "View B · Side",
};

export function XrayPane({
  bag,
  view,
  filter,
  phase,
  detections,
  hoveredId,
  posed,
  onHover,
  onInspect,
}: XrayPaneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const draw = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (width < 2 || height < 2) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      renderXray(ctx, width, height, bag, view, filter);
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [bag, view, filter]);

  const win = bagWindow(bag.type, view);
  const boxes = detections.map((detection) => {
    const item = bag.items.find((entry) => entry.id === detection.itemId);
    if (!item) return null;
    const projected: Projected = projectItem(item, view, win);
    return { detection, projected };
  });

  return (
    <section className="pane" aria-label={VIEW_LABEL[view]}>
      <div
        className={`plate ${posed ? "posed" : "entering"}`}
        onClick={() => {
          if (phase === "ready") onInspect(null);
        }}
      >
        <canvas ref={canvasRef} />
        <span className="view-tag">{VIEW_LABEL[view]}</span>
        {phase === "scanning" && <div className="scanline" />}
        {phase === "ready" &&
          boxes.map((box) => {
            if (!box) return null;
            const { detection, projected } = box;
            return (
              <button
                key={detection.itemId}
                type="button"
                className={`hitbox ${detection.threat ? "threat" : "benign"} ${
                  hoveredId === detection.itemId ? "hot" : ""
                }`}
                style={{
                  left: `${projected.cx * 100}%`,
                  top: `${projected.cy * 100}%`,
                  width: `${projected.w * 100}%`,
                  height: `${projected.h * 100}%`,
                  transform: "translate(-50%, -50%)",
                  zIndex: detection.threat ? 4 : 2,
                }}
                aria-label={`Open 3D render of ${detection.label}, confidence ${detection.confidence.toFixed(3)}`}
                onMouseEnter={() => onHover(detection.itemId)}
                onMouseLeave={() => onHover(null)}
                onClick={(event) => {
                  event.stopPropagation();
                  onInspect(detection.itemId);
                }}
              >
                <span className="chip">
                  {detection.label} {detection.confidence.toFixed(3)}
                </span>
              </button>
            );
          })}
        <span className="corner tl" />
        <span className="corner tr" />
        <span className="corner bl" />
        <span className="corner br" />
      </div>
    </section>
  );
}
