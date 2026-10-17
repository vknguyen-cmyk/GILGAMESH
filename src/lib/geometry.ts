import type { BagItem, BagType, Projected, Rect, ViewKind } from "../types";

/** Normalized plate rectangle occupied by the bag shell for a given view. */
export function bagWindow(type: BagType, view: ViewKind): Rect {
  if (view === "top") {
    switch (type) {
      case "cabin-roller":
        return { x: 0.07, y: 0.16, w: 0.86, h: 0.66 };
      case "backpack":
        return { x: 0.18, y: 0.1, w: 0.64, h: 0.78 };
      case "duffel":
        return { x: 0.05, y: 0.26, w: 0.9, h: 0.46 };
      case "tote":
        return { x: 0.16, y: 0.16, w: 0.68, h: 0.66 };
      case "hard-shell":
        return { x: 0.08, y: 0.14, w: 0.84, h: 0.7 };
    }
  }
  switch (type) {
    case "cabin-roller":
      return { x: 0.08, y: 0.12, w: 0.84, h: 0.74 };
    case "backpack":
      return { x: 0.16, y: 0.1, w: 0.68, h: 0.78 };
    case "duffel":
      return { x: 0.06, y: 0.28, w: 0.88, h: 0.42 };
    case "tote":
      return { x: 0.14, y: 0.14, w: 0.72, h: 0.68 };
    case "hard-shell":
      return { x: 0.1, y: 0.12, w: 0.8, h: 0.74 };
  }
}

/**
 * Top view looks down: belt axis runs left→right, bag width runs vertically.
 * Side view looks across the belt: belt axis left→right, bag height runs vertically.
 */
export function projectItem(item: BagItem, view: ViewKind, win: Rect): Projected {
  if (view === "top") {
    return {
      cx: win.x + item.z * win.w,
      cy: win.y + item.x * win.h,
      w: item.d * win.w,
      h: item.w * win.h,
      rotation: item.yaw,
    };
  }
  return {
    cx: win.x + item.z * win.w,
    cy: win.y + (1 - item.y) * win.h,
    w: item.d * win.w,
    h: item.h * win.h,
    rotation: 0,
  };
}

export function hashString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
