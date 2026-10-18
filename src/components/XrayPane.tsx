import { useLayoutEffect, useRef, useState } from "react";
import type { Bag, Detection, MaterialFilter, Phase, Projected, Rect, ViewKind } from "../types";
import { bagWindow, projectItem } from "../lib/geometry";
import { renderXray } from "../lib/renderXray";
import { renderRealXray, type RealScan } from "../lib/realScan";

export type PaneSource = { kind: "sim"; bag: Bag } | { kind: "real"; scan: RealScan };

interface XrayPaneProps {
  source: PaneSource;
  view: ViewKind;
  filter: MaterialFilter;
  phase: Phase;
  detections: Detection[];
  activeId: string | null;
  posed: boolean;
  onHover: (id: string | null) => void;
  onInspect: (id: string | null) => void;
}

const VIEW_LABEL: Record<ViewKind, string> = {
  top: "Top View",
  side: "Side View",
};

const FULL: Rect = { x: 0, y: 0, w: 1, h: 1 };

export function XrayPane({
  source,
  view,
  filter,
  phase,
  detections,
  activeId,
  posed,
  onHover,
  onInspect,
}: XrayPaneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fit, setFit] = useState<Rect>(FULL);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const draw = () => {
      const ctx = canvas.getContext("2d", { willReadFrequently: source.kind === "real" });
      if (!ctx) return;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (width < 2 || height < 2) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (source.kind === "sim") {
        renderXray(ctx, width, height, source.bag, view, filter);
        return;
      }
      const placed = renderRealXray(ctx, width, height, source.scan, filter);
      setFit((current) =>
        Math.abs(current.x - placed.x) < 1e-4 &&
        Math.abs(current.y - placed.y) < 1e-4 &&
        Math.abs(current.w - placed.w) < 1e-4 &&
        Math.abs(current.h - placed.h) < 1e-4
          ? current
          : placed,
      );
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [source, view, filter]);

  const boxes = detections.map((detection) => {
    if (source.kind === "real") {
      if (!detection.box) return null;
      const b = detection.box;
      const projected: Projected = {
        cx: fit.x + (b.x + b.w / 2) * fit.w,
        cy: fit.y + (b.y + b.h / 2) * fit.h,
        w: b.w * fit.w,
        h: b.h * fit.h,
        rotation: 0,
      };
      return { detection, projected };
    }
    const item = source.bag.items.find((entry) => entry.id === detection.itemId);
    if (!item) return null;
    const projected: Projected = projectItem(item, view, bagWindow(source.bag.type, view));
    return { detection, projected };
  });

  const tag = source.kind === "real" ? source.scan.fileName : VIEW_LABEL[view];
  const action = source.kind === "real" ? "Select" : "Open 3D view of";

  return (
    <section className="pane" aria-label={tag}>
      <div
        className={`plate ${posed ? "posed" : "entering"}`}
        onClick={() => {
          if (phase === "ready") onInspect(null);
        }}
      >
        <canvas ref={canvasRef} />
        <span className="view-tag">{tag}</span>
        {phase === "scanning" && <div className="scanline" />}
        {phase === "ready" &&
          boxes.map((box) => {
            if (!box) return null;
            const { detection, projected } = box;
            const top = projected.cy - projected.h / 2;
            return (
              <button
                key={detection.itemId}
                type="button"
                className={`hitbox ${detection.uncertain ? "uncertain" : detection.threat ? "threat" : "benign"} ${
                  activeId === detection.itemId ? "hot" : ""
                } ${top < 0.07 ? "chip-in" : ""}`}
                style={{
                  left: `${projected.cx * 100}%`,
                  top: `${projected.cy * 100}%`,
                  width: `${projected.w * 100}%`,
                  height: `${projected.h * 100}%`,
                  transform: "translate(-50%, -50%)",
                  zIndex: detection.threat ? 4 : 2,
                }}
                aria-label={`${action} ${detection.label}, confidence ${detection.confidence.toFixed(3)}`}
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
