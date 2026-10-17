import type { Analysis, Bag } from "../types";

/**
 * Screening pass for one bag.
 * The booth build returns scripted scores. Swap this function for a real
 * detector later — the console only consumes `Analysis`.
 */
export function analyzeBag(bag: Bag): Analysis {
  const detections = bag.items
    .map((item) => ({
      itemId: item.id,
      label: item.label,
      confidence: item.confidence,
      threat: item.threat,
      material: item.material,
      shape: item.shape,
    }))
    .sort((a, b) => Number(b.threat) - Number(a.threat) || b.confidence - a.confidence);

  const threatCount = detections.filter((d) => d.threat).length;

  return {
    bagId: bag.id,
    detections,
    verdict: threatCount > 0 ? "threat" : "clear",
    threatCount,
    elapsedMs: 980 + bag.items.length * 90,
  };
}
