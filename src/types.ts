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

export type Phase = "entering" | "scanning" | "ready";

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
  material: Material;
  shape: ItemShape;
}

export interface Analysis {
  bagId: string;
  detections: Detection[];
  verdict: "clear" | "threat";
  threatCount: number;
  elapsedMs: number;
}

export interface Decision {
  bagId: string;
  type: BagType;
  tag: string;
  action: "cleared" | "held";
  verdict: "clear" | "threat";
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
