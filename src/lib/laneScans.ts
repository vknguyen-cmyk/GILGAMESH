import type { Analysis } from "../types";
import type { LaneDetection, LaneScan } from "./laneScene";
import type { RealScan } from "./realScan";

/**
 * Turn the console's analysis of an uploaded scan into the bag that carries it on the lane.
 * Both screens read the same Analysis (same models, same threshold), so a bag is held on
 * the lane exactly when the console flags its scan.
 */
export function toLaneScan(scan: RealScan, analysis: Analysis): LaneScan {
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
  // Headline: the strongest confident threat, else the strongest "look closer" hit.
  const top =
    detections.find((d) => d.kind === "threat") ?? detections.find((d) => d.kind === "review") ?? detections[0] ?? null;
  return {
    id: scan.id,
    file: scan.fileName,
    image: scan.bitmap,
    width: scan.width,
    height: scan.height,
    verdict: analysis.verdict,
    detections,
    top,
  };
}

/** One uploaded scan as the lane sees it: still analyzing, failed, or ready to ride. */
export type LaneItem = { id: string; state: "analyzing" | "failed" } | { id: string; state: "ready"; scan: LaneScan };
