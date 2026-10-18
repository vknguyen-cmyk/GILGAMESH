export type Material = "organic" | "metal" | "mixed";

export type BagType = "cabin-roller" | "backpack" | "duffel" | "tote" | "hard-shell";

export type ItemShape =
  | "laptop"
  | "handgun"
  | "knife"
  | "bottle"
  | "clothing"
  | "book"
  | "cable"
  | "shoes"
  | "tablet"
  | "magazine"
  | "keys"
  | "umbrella"
  | "headphones";

export type ViewKind = "top" | "side";

export type MaterialFilter = "all" | "organic" | "metal";

export type Phase = "entering" | "scanning" | "ready" | "failed";

/**
 * Item placement is in bag space, 0–1.
 * x width, y height, z length along the belt.
 * w, h, d are sizes on those same axes.
 */
export interface BagItem {
  id: string;
  label: string;
  shape: ItemShape;
  material: Material;
  threat: boolean;
  confidence: number;
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  yaw: number;
}

export interface Bag {
  id: string;
  type: BagType;
  tag: string;
  items: BagItem[];
}

export interface Detection {
  itemId: string;
  label: string;
  confidence: number;
  threat: boolean;
  /** Real scans estimate this from pixel color; grayscale scans report "unknown". */
  material: Material | "unknown";
  /** Scripted bags only. */
  shape?: ItemShape;
  /** Real scans only: the model's box, normalized to the image (0–1). */
  box?: Rect;
  /** Real scans only: a threat class scored below the alarm threshold but high enough to look at. */
  uncertain?: boolean;
}

export interface Analysis {
  bagId: string;
  detections: Detection[];
  /** "review": no confident threat, but a weak threat-class hit the officer should look at. */
  verdict: "clear" | "review" | "threat";
  threatCount: number;
  elapsedMs: number;
}

export interface Decision {
  bagId: string;
  action: "cleared" | "held";
  verdict: "clear" | "review" | "threat" | "unscreened";
  at: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Projected {
  cx: number;
  cy: number;
  w: number;
  h: number;
  rotation: number;
}
