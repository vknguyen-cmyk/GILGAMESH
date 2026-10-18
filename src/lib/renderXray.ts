import type { Bag, BagItem, BagType, Material, MaterialFilter, ViewKind } from "../types";
import { bagWindow, hashString, mulberry32, projectItem } from "./geometry";

const MATERIAL_RGB: Record<Material, [string, string]> = {
  organic: ["#ffb15a", "#d85a12"],
  metal: ["#7eafff", "#173e9c"],
  mixed: ["#8fd9a8", "#1d7a45"],
};

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function filterAlpha(material: Material, filter: MaterialFilter): number {
  if (filter === "all") return 1;
  if (filter === material) return 1;
  if (material === "mixed") return 0.42;
  return 0.06;
}

function shellPath(
  ctx: CanvasRenderingContext2D,
  type: BagType,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  if (type === "duffel") {
    const r = h * 0.46;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arc(x + w - r, y + h / 2, r, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(x + r, y + h);
    ctx.arc(x + r, y + h / 2, r, Math.PI / 2, -Math.PI / 2);
    ctx.closePath();
    return;
  }
  if (type === "backpack") {
    roundRect(ctx, x, y, w, h, Math.min(w, h) * 0.18);
    return;
  }
  if (type === "tote") {
    const inset = w * 0.06;
    ctx.beginPath();
    ctx.moveTo(x + inset, y);
    ctx.lineTo(x + w - inset, y);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.closePath();
    return;
  }
  roundRect(ctx, x, y, w, h, Math.min(w, h) * (type === "hard-shell" ? 0.08 : 0.12));
}

function fillMaterial(
  ctx: CanvasRenderingContext2D,
  material: Material,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const [light, dark] = MATERIAL_RGB[material];
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, light);
  g.addColorStop(1, dark);
  ctx.fillStyle = g;
}

function drawLaptopTop(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const g = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
  g.addColorStop(0, "#8eb7ff");
  g.addColorStop(0.55, "#3c7a52");
  g.addColorStop(1, "#1d4e9a");
  ctx.fillStyle = g;
  roundRect(ctx, -w / 2, -h / 2, w, h, 8);
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.globalCompositeOperation = "multiply";
  const rand = mulberry32(42);
  ctx.strokeStyle = "rgba(12, 36, 110, 0.55)";
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 18; i += 1) {
    ctx.beginPath();
    let x = -w * 0.42 + rand() * w * 0.5;
    let y = -h * 0.42 + rand() * h * 0.84;
    ctx.moveTo(x, y);
    for (let k = 0; k < 4; k += 1) {
      if (rand() > 0.45) x += (rand() - 0.4) * w * 0.22;
      else y += (rand() - 0.5) * h * 0.2;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  for (let i = 0; i < 6; i += 1) {
    const cw = w * (0.06 + rand() * 0.08);
    const ch = h * (0.05 + rand() * 0.07);
    ctx.fillStyle = "rgba(10, 28, 90, 0.45)";
    ctx.fillRect(-w * 0.42 + rand() * w * 0.4, -h * 0.35 + rand() * h * 0.7, cw, ch);
  }
  ctx.restore();

  const kbX = -w * 0.02;
  const kbY = -h * 0.28;
  const kbW = w * 0.46;
  const kbH = h * 0.62;
  ctx.fillStyle = "rgba(18, 48, 120, 0.18)";
  roundRect(ctx, kbX, kbY, kbW, kbH, 4);
  ctx.fill();
  const cols = 10;
  const rows = 5;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const kw = kbW / cols - 3;
      const kh = kbH / rows - 3;
      ctx.fillStyle = "rgba(10, 30, 90, 0.35)";
      roundRect(ctx, kbX + 4 + c * (kbW / cols), kbY + 4 + r * (kbH / rows), kw, kh, 1.5);
      ctx.fill();
    }
  }
  ctx.fillStyle = "rgba(10, 30, 90, 0.28)";
  roundRect(ctx, kbX + kbW * 0.28, kbY + kbH + h * 0.04, kbW * 0.44, h * 0.12, 4);
  ctx.fill();
}

function drawLaptopSide(ctx: CanvasRenderingContext2D, w: number, h: number, material: Material) {
  fillMaterial(ctx, material, -w / 2, -h * 0.15, w, h * 0.55);
  roundRect(ctx, -w / 2, -h * 0.15, w, Math.max(6, h * 0.55), 3);
  ctx.fill();
  ctx.save();
  ctx.translate(-w * 0.28, -h * 0.15);
  ctx.rotate(-0.55);
  fillMaterial(ctx, "metal", 0, -h * 0.7, w * 0.62, Math.max(4, h * 0.28));
  roundRect(ctx, 0, -h * 0.7, w * 0.62, Math.max(4, h * 0.28), 2);
  ctx.fill();
  ctx.restore();
}

function drawHandgun(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const metal = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
  metal.addColorStop(0, "#1a3f86");
  metal.addColorStop(1, "#071433");
  ctx.fillStyle = metal;

  roundRect(ctx, -w * 0.48, -h * 0.46, w * 0.78, Math.max(8, h * 0.3), 2);
  ctx.fill();
  roundRect(ctx, w * 0.18, -h * 0.4, w * 0.3, Math.max(6, h * 0.16), 2);
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(-w * 0.22, -h * 0.16);
  ctx.lineTo(-w * 0.02, -h * 0.16);
  ctx.lineTo(w * 0.08, h * 0.46);
  ctx.lineTo(-w * 0.28, h * 0.42);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(-w * 0.02, -h * 0.08);
  ctx.quadraticCurveTo(w * 0.2, h * 0.02, w * 0.05, h * 0.28);
  ctx.quadraticCurveTo(-w * 0.02, h * 0.12, -w * 0.02, -h * 0.08);
  ctx.fill();

  ctx.fillStyle = "rgba(4, 10, 28, 0.55)";
  ctx.fillRect(-w * 0.34, -h * 0.4, w * 0.46, Math.max(3, h * 0.08));
  ctx.beginPath();
  ctx.arc(-w * 0.3, -h * 0.28, Math.min(w, h) * 0.06, 0, Math.PI * 2);
  ctx.fill();
}

function drawKnife(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = "#16357a";
  ctx.beginPath();
  ctx.moveTo(-w * 0.46, -Math.max(2, h * 0.1));
  ctx.lineTo(w * 0.12, -Math.max(1.5, h * 0.04));
  ctx.lineTo(w * 0.12, Math.max(1.5, h * 0.08));
  ctx.lineTo(-w * 0.46, Math.max(2, h * 0.16));
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#071433";
  ctx.fillRect(-w * 0.2, -Math.max(1, h * 0.02), w * 0.28, Math.max(2, h * 0.06));
  ctx.fillStyle = "#e07a32";
  roundRect(ctx, w * 0.1, -h * 0.32, w * 0.32, Math.max(8, h * 0.64), 3);
  ctx.fill();
}

function drawBottle(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const bodyW = w * 0.7;
  const neckW = w * 0.28;
  fillMaterial(ctx, "organic", -bodyW / 2, -h * 0.2, bodyW, h * 0.68);
  roundRect(ctx, -bodyW / 2, -h * 0.2, bodyW, h * 0.68, bodyW * 0.35);
  ctx.fill();
  fillMaterial(ctx, "organic", -neckW / 2, -h * 0.48, neckW, h * 0.34);
  ctx.fillRect(-neckW / 2, -h * 0.48, neckW, h * 0.34);
  fillMaterial(ctx, "metal", -neckW / 2 - 1, -h * 0.5, neckW + 2, h * 0.12);
  roundRect(ctx, -neckW / 2 - 1, -h * 0.5, neckW + 2, h * 0.12, 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(120, 50, 10, 0.45)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-bodyW * 0.35, h * 0.05);
  ctx.lineTo(bodyW * 0.35, h * 0.05);
  ctx.stroke();
}

function drawClothing(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number) {
  const rand = mulberry32(seed);
  for (let i = 0; i < 3; i += 1) {
    ctx.beginPath();
    const cx = (rand() - 0.5) * w * 0.2;
    const cy = (rand() - 0.5) * h * 0.2;
    ctx.moveTo(cx - w * 0.4, cy);
    ctx.bezierCurveTo(
      cx - w * 0.2,
      cy - h * (0.4 + rand() * 0.2),
      cx + w * 0.3,
      cy - h * 0.35,
      cx + w * 0.38,
      cy + h * 0.05,
    );
    ctx.bezierCurveTo(
      cx + w * 0.2,
      cy + h * (0.4 + rand() * 0.15),
      cx - w * 0.3,
      cy + h * 0.42,
      cx - w * 0.4,
      cy,
    );
    fillMaterial(ctx, "organic", -w / 2, -h / 2, w, h);
    ctx.globalAlpha *= 0.55;
    ctx.fill();
  }
  ctx.strokeStyle = "rgba(140, 60, 16, 0.35)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-w * 0.2, -h * 0.1);
  ctx.quadraticCurveTo(0, h * 0.15, w * 0.25, -h * 0.05);
  ctx.stroke();
}

function drawBook(ctx: CanvasRenderingContext2D, w: number, h: number) {
  fillMaterial(ctx, "organic", -w / 2, -h / 2, w, h);
  roundRect(ctx, -w / 2, -h / 2, w, h, 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(120, 48, 10, 0.4)";
  ctx.lineWidth = 1;
  const lines = 6;
  for (let i = 1; i < lines; i += 1) {
    const y = -h / 2 + (h / lines) * i;
    ctx.beginPath();
    ctx.moveTo(-w * 0.38, y);
    ctx.lineTo(w * 0.38, y);
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(90, 36, 8, 0.35)";
  ctx.fillRect(-w / 2, -h / 2, Math.max(3, w * 0.08), h);
}

function drawCable(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number) {
  const rand = mulberry32(seed);
  ctx.strokeStyle = "#1d4eaa";
  ctx.lineWidth = Math.max(2, Math.min(w, h) * 0.18);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-w * 0.4, 0);
  for (let i = 0; i < 3; i += 1) {
    const x = -w * 0.2 + i * w * 0.28;
    const y = (rand() - 0.5) * h * 0.8;
    ctx.quadraticCurveTo(x, y, x + w * 0.12, (rand() - 0.5) * h * 0.4);
  }
  ctx.stroke();
  ctx.fillStyle = "#163a8c";
  ctx.beginPath();
  ctx.arc(w * 0.38, 0, Math.max(3, h * 0.28), 0, Math.PI * 2);
  ctx.fill();
}

function drawShoes(ctx: CanvasRenderingContext2D, w: number, h: number) {
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(side * w * 0.18, side * h * 0.08);
    fillMaterial(ctx, "mixed", -w * 0.28, -h * 0.22, w * 0.5, h * 0.4);
    ctx.beginPath();
    ctx.ellipse(0, 0, w * 0.26, h * 0.22, side * 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawTablet(ctx: CanvasRenderingContext2D, w: number, h: number) {
  if (h < w * 0.28) {
    fillMaterial(ctx, "mixed", -w / 2, -h / 2, w, h);
    roundRect(ctx, -w / 2, -h / 2, w, Math.max(4, h), 2);
    ctx.fill();
    return;
  }
  fillMaterial(ctx, "mixed", -w / 2, -h / 2, w, h);
  roundRect(ctx, -w / 2, -h / 2, w, h, 6);
  ctx.fill();
  ctx.fillStyle = "rgba(8, 40, 28, 0.25)";
  roundRect(ctx, -w * 0.42, -h * 0.4, w * 0.84, h * 0.8, 3);
  ctx.fill();
  ctx.fillStyle = "rgba(8, 30, 20, 0.55)";
  ctx.beginPath();
  ctx.arc(0, h * 0.28, Math.min(w, h) * 0.04, 0, Math.PI * 2);
  ctx.fill();
}

function drawMagazine(ctx: CanvasRenderingContext2D, w: number, h: number) {
  fillMaterial(ctx, "metal", -w / 2, -h / 2, w, h);
  roundRect(ctx, -w * 0.35, -h * 0.48, w * 0.7, h * 0.96, 3);
  ctx.fill();
  ctx.strokeStyle = "rgba(6, 16, 60, 0.55)";
  ctx.lineWidth = 1.4;
  for (let i = 0; i < 6; i += 1) {
    const y = -h * 0.36 + i * h * 0.12;
    ctx.beginPath();
    ctx.moveTo(-w * 0.24, y);
    ctx.lineTo(w * 0.24, y);
    ctx.stroke();
  }
}

function drawKeys(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number) {
  const rand = mulberry32(seed);
  ctx.strokeStyle = "#1a46a8";
  ctx.fillStyle = "#2456c4";
  ctx.lineWidth = 2;
  for (let i = 0; i < 3; i += 1) {
    const x = (rand() - 0.5) * w * 0.5;
    const y = (rand() - 0.5) * h * 0.4;
    ctx.beginPath();
    ctx.arc(x, y, Math.min(w, h) * 0.16, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + Math.min(w, h) * 0.12, y);
    ctx.lineTo(x + w * 0.28, y + (rand() - 0.5) * h * 0.2);
    ctx.stroke();
  }
}

function drawUmbrella(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.strokeStyle = "#1d4eaa";
  ctx.lineWidth = Math.max(2, h * 0.12);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-w * 0.46, 0);
  ctx.lineTo(w * 0.42, 0);
  ctx.stroke();
  ctx.lineWidth = 1.2;
  for (let i = -2; i <= 2; i += 1) {
    ctx.beginPath();
    ctx.moveTo(-w * 0.1, 0);
    ctx.lineTo(-w * 0.1 + i * w * 0.08, -h * 0.35);
    ctx.stroke();
  }
  ctx.fillStyle = "#163a8c";
  ctx.beginPath();
  ctx.arc(w * 0.44, 0, Math.max(2.5, h * 0.18), 0, Math.PI * 2);
  ctx.fill();
}

function drawHeadphones(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.strokeStyle = "#1d6b42";
  ctx.lineWidth = Math.max(3, h * 0.12);
  ctx.beginPath();
  ctx.arc(0, h * 0.05, Math.min(w, h) * 0.38, Math.PI, 0);
  ctx.stroke();
  fillMaterial(ctx, "mixed", -w * 0.48, -h * 0.05, w * 0.22, h * 0.48);
  roundRect(ctx, -w * 0.48, -h * 0.05, w * 0.22, h * 0.48, 4);
  ctx.fill();
  fillMaterial(ctx, "mixed", w * 0.26, -h * 0.05, w * 0.22, h * 0.48);
  roundRect(ctx, w * 0.26, -h * 0.05, w * 0.22, h * 0.48, 4);
  ctx.fill();
}

function drawShape(
  ctx: CanvasRenderingContext2D,
  item: BagItem,
  view: ViewKind,
  w: number,
  h: number,
) {
  const seed = hashString(item.id + item.label);
  switch (item.shape) {
    case "laptop":
      if (view === "top") drawLaptopTop(ctx, w, h);
      else drawLaptopSide(ctx, w, h, item.material);
      return;
    case "handgun":
      drawHandgun(ctx, w, h);
      return;
    case "knife":
      drawKnife(ctx, w, h);
      return;
    case "bottle":
      drawBottle(ctx, w, h);
      return;
    case "clothing":
      drawClothing(ctx, w, h, seed);
      return;
    case "book":
      drawBook(ctx, w, h);
      return;
    case "cable":
      drawCable(ctx, w, h, seed);
      return;
    case "shoes":
      drawShoes(ctx, w, h);
      return;
    case "tablet":
      drawTablet(ctx, w, h);
      return;
    case "magazine":
      drawMagazine(ctx, w, h);
      return;
    case "keys":
      drawKeys(ctx, w, h, seed);
      return;
    case "umbrella":
      drawUmbrella(ctx, w, h);
      return;
    case "headphones":
      drawHeadphones(ctx, w, h);
      return;
    default:
      return;
  }
}

function drawHardware(
  ctx: CanvasRenderingContext2D,
  type: BagType,
  view: ViewKind,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  ctx.save();
  ctx.strokeStyle = "rgba(24, 58, 120, 0.85)";
  ctx.fillStyle = "rgba(24, 58, 120, 0.8)";
  ctx.lineWidth = 2;
  if (type === "cabin-roller" || type === "hard-shell") {
    const r = 7;
    const wheels: Array<[number, number]> = [
      [x + 18, y + h - 2],
      [x + w * 0.38, y + h - 2],
      [x + w * 0.62, y + h - 2],
      [x + w - 18, y + h - 2],
    ];
    for (const [wx, wy] of wheels) {
      ctx.beginPath();
      ctx.arc(wx, wy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (view === "side" && (type === "cabin-roller" || type === "hard-shell")) {
    ctx.strokeStyle = "rgba(24, 58, 120, 0.75)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x + w * 0.42, y);
    ctx.lineTo(x + w * 0.42, y - 16);
    ctx.lineTo(x + w * 0.58, y - 16);
    ctx.lineTo(x + w * 0.58, y);
    ctx.stroke();
  }
  if (view === "top" && type === "backpack") {
    ctx.strokeStyle = "rgba(24, 58, 120, 0.45)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x + 8, y + h * 0.2);
    ctx.quadraticCurveTo(x - 16, y + h * 0.5, x + 8, y + h * 0.85);
    ctx.moveTo(x + w - 8, y + h * 0.2);
    ctx.quadraticCurveTo(x + w + 16, y + h * 0.5, x + w - 8, y + h * 0.85);
    ctx.stroke();
  }
  if (type === "tote" && view === "side") {
    ctx.beginPath();
    ctx.moveTo(x + w * 0.28, y);
    ctx.quadraticCurveTo(x + w * 0.36, y - 22, x + w * 0.46, y);
    ctx.moveTo(x + w * 0.54, y);
    ctx.quadraticCurveTo(x + w * 0.64, y - 22, x + w * 0.72, y);
    ctx.stroke();
  }
  ctx.restore();
}

export function renderXray(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  bag: Bag,
  view: ViewKind,
  filter: MaterialFilter,
) {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#f4f1ea";
  ctx.fillRect(0, 0, width, height);

  const vignette = ctx.createRadialGradient(
    width / 2,
    height / 2,
    width * 0.2,
    width / 2,
    height / 2,
    width * 0.72,
  );
  vignette.addColorStop(0, "rgba(255,255,255,0)");
  vignette.addColorStop(1, "rgba(150, 140, 120, 0.18)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);

  const win = bagWindow(bag.type, view);
  const x = win.x * width;
  const y = win.y * height;
  const w = win.w * width;
  const h = win.h * height;

  ctx.save();
  ctx.fillStyle = "rgba(90, 70, 40, 0.08)";
  ctx.beginPath();
  ctx.ellipse(x + w / 2, y + h + 8, w * 0.42, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  shellPath(ctx, bag.type, x, y, w, h);
  ctx.fillStyle = "rgba(255, 236, 214, 0.35)";
  ctx.fill();
  ctx.clip();

  const ordered = [...bag.items].sort((a, b) => Number(a.threat) - Number(b.threat) || a.y - b.y);
  for (const item of ordered) {
    const projected = projectItem(item, view, win);
    const pw = Math.max(8, projected.w * width);
    const ph = Math.max(8, projected.h * height);
    ctx.save();
    ctx.translate(projected.cx * width, projected.cy * height);
    ctx.rotate((projected.rotation * Math.PI) / 180);
    ctx.globalAlpha = filterAlpha(item.material, filter);
    ctx.globalCompositeOperation = "source-over";
    drawShape(ctx, item, view, pw, ph);
    ctx.restore();
  }
  ctx.restore();

  ctx.save();
  shellPath(ctx, bag.type, x, y, w, h);
  ctx.strokeStyle = "rgba(28, 63, 122, 0.9)";
  ctx.lineWidth = 2.25;
  ctx.stroke();
  ctx.setLineDash([5, 6]);
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(28, 63, 122, 0.35)";
  ctx.save();
  ctx.translate(4, 4);
  shellPath(ctx, bag.type, x, y, w - 8, h - 8);
  ctx.stroke();
  ctx.restore();
  ctx.restore();

  drawHardware(ctx, bag.type, view, x, y, w, h);
}
