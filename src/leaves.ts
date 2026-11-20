/**
 * Falling pixel-art leaves.
 *
 * - Leaves spawn just above the top of the viewport and drift down with a gentle sway.
 * - When a leaf reaches the top edge of a "collidable" element (see CONFIG.collidables)
 *   it lands, stays attached to that element (so it scrolls with it), and after
 *   5 seconds it fades out and is removed.
 * - Leaves that miss every element simply fall out of the screen: the background
 *   is not a surface.
 * - Everything is drawn on one fixed canvas with image smoothing disabled, an
 *   integer pixel scale and positions snapped to whole device pixels, so the
 *   pixel art never gets blurred.
 */

import leaf1 from "./particles/leaf1.png";
import leaf2 from "./particles/leaf2.png";
import leaf3 from "./particles/leaf3.png";
import leaf4 from "./particles/leaf4.png";
import leaf5 from "./particles/leaf5.png";

const SPRITE_URLS: string[] = [leaf1, leaf2, leaf3, leaf4, leaf5];

const CONFIG = {
  /** CSS pixels used for each pixel of the texture (4 = every texture pixel is 4x4 px). */
  pixelScale: 4,
  /** Max leaves alive at once. */
  maxLeaves: 40,
  /** Random delay between spawns, in ms [min, max]. */
  spawnIntervalMs: [500, 1400] as [number, number],
  /** Fall speed in CSS px / second [min, max]. */
  fallSpeed: [35, 65] as [number, number],
  /** Constant sideways wind in px / second [min, max]. */
  drift: [-8, 14] as [number, number],
  /** Sway strength (horizontal velocity amplitude, px / second) [min, max]. */
  swayAmp: [10, 30] as [number, number],
  /** Sway speed in radians / second [min, max]. */
  swayFreq: [1.2, 2.4] as [number, number],
  /** Max tilt while falling, in degrees. */
  maxTiltDeg: 35,
  /** Rotation snaps to this step (keeps the pixel-art look). 0 = continuous. */
  rotationStepDeg: 15,
  /** Elements the leaves can land on (their top edge). */
  collidables: ".glass-card, .page-wrapper > h1",
  /** How far a landed leaf sinks into the surface, in CSS px. */
  sinkPx: 2,
  /** Time a landed leaf stays fully visible before fading, in ms. */
  fadeDelayMs: 5000,
  /** Fade-out duration, in ms. */
  fadeDurationMs: 1200,
  /** z-index of the canvas (above the cards, below the "return to preview" bar). */
  zIndex: 4,
};

const DEG = Math.PI / 180;

interface Leaf {
  img: HTMLImageElement;
  x: number; // centre, CSS px (viewport space)
  y: number;
  t: number;
  fallSpeed: number;
  drift: number;
  swayAmp: number;
  swayFreq: number;
  swayPhase: number;
  angle: number;
  restAngle: number;
  tilt: number;
  state: "falling" | "landed";
  host: Element | null;
  offX: number; // x offset from the host's left edge
  landedAt: number;
  alpha: number;
}

interface Surface {
  el: Element;
  rect: DOMRect;
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function init(): Promise<void> {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const sprites = (await Promise.all(SPRITE_URLS.map(loadImage))).filter(
    (img): img is HTMLImageElement => img !== null && img.naturalWidth > 0,
  );
  if (sprites.length === 0) return;

  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  Object.assign(canvas.style, {
    position: "fixed",
    inset: "0",
    width: "100vw",
    height: "100vh",
    pointerEvents: "none",
    zIndex: String(CONFIG.zIndex),
    imageRendering: "pixelated",
  });
  document.body.appendChild(canvas);

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  let dpr = 1;
  let devScale = 1; // device pixels per texture pixel (always an integer)

  function resize(): void {
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    devScale = Math.max(1, Math.round(CONFIG.pixelScale * dpr));
  }
  resize();
  window.addEventListener("resize", resize);

  /** Leaf size in CSS px. */
  function sizeOf(leaf: Leaf): { w: number; h: number } {
    return {
      w: (leaf.img.naturalWidth * devScale) / dpr,
      h: (leaf.img.naturalHeight * devScale) / dpr,
    };
  }

  const leaves: Leaf[] = [];

  function spawn(): Leaf {
    const img = sprites[Math.floor(Math.random() * sprites.length)];
    return {
      img,
      x: rand(-20, window.innerWidth + 20),
      y: -(img.naturalHeight * devScale) / dpr,
      t: 0,
      fallSpeed: rand(...CONFIG.fallSpeed),
      drift: rand(...CONFIG.drift),
      swayAmp: rand(...CONFIG.swayAmp),
      swayFreq: rand(...CONFIG.swayFreq),
      swayPhase: rand(0, Math.PI * 2),
      angle: 0,
      restAngle: rand(-25, 25) * DEG,
      tilt: rand(0.6, 1) * CONFIG.maxTiltDeg * DEG,
      state: "falling",
      host: null,
      offX: 0,
      landedAt: 0,
      alpha: 1,
    };
  }

  function getSurfaces(): Surface[] {
    const out: Surface[] = [];
    document.querySelectorAll(CONFIG.collidables).forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) out.push({ el, rect });
    });
    return out;
  }

  /** Returns false when the leaf should be removed. */
  function step(
    leaf: Leaf,
    dt: number,
    now: number,
    surfaces: Surface[],
  ): boolean {
    const { w, h } = sizeOf(leaf);

    if (leaf.state === "falling") {
      const prevBottom = leaf.y + h / 2;

      leaf.t += dt;
      const phase = leaf.t * leaf.swayFreq + leaf.swayPhase;
      leaf.x += (leaf.drift + Math.cos(phase) * leaf.swayAmp) * dt;
      leaf.y += leaf.fallSpeed * (1 + 0.2 * Math.sin(phase * 0.6)) * dt;
      leaf.angle = Math.cos(phase) * leaf.tilt;

      const bottom = leaf.y + h / 2;

      // Find the highest surface whose top edge we just crossed.
      let hit: Surface | null = null;
      for (const s of surfaces) {
        const r = s.rect;
        if (leaf.x < r.left || leaf.x > r.right) continue;
        if (prevBottom <= r.top + 4 && bottom >= r.top) {
          if (!hit || r.top < hit.rect.top) hit = s;
        }
      }

      if (hit) {
        leaf.state = "landed";
        leaf.host = hit.el;
        leaf.offX = leaf.x - hit.rect.left;
        leaf.y = hit.rect.top - h / 2 + CONFIG.sinkPx;
        leaf.landedAt = now;
        leaf.alpha = 1;
        return true;
      }

      // Fell past the bottom or far off the sides: the background isn't a surface.
      if (leaf.y - h / 2 > window.innerHeight) return false;
      if (leaf.x < -w * 2 || leaf.x > window.innerWidth + w * 2) return false;
      return true;
    }

    // ── landed ──
    const host = leaf.host;
    const rect = host ? host.getBoundingClientRect() : null;

    if (
      !host ||
      !host.isConnected ||
      !rect ||
      rect.width === 0 ||
      leaf.offX < 0 ||
      leaf.offX > rect.width
    ) {
      // Surface disappeared or moved out from under the leaf: let it fall again.
      leaf.state = "falling";
      leaf.host = null;
      leaf.alpha = 1;
      return true;
    }

    leaf.x = rect.left + leaf.offX;
    leaf.y = rect.top - h / 2 + CONFIG.sinkPx;
    leaf.angle += (leaf.restAngle - leaf.angle) * Math.min(1, dt * 6);

    const age = now - leaf.landedAt;
    if (age > CONFIG.fadeDelayMs) {
      leaf.alpha = 1 - (age - CONFIG.fadeDelayMs) / CONFIG.fadeDurationMs;
      if (leaf.alpha <= 0) return false;
    }
    return true;
  }

  function draw(): void {
    const c = ctx as CanvasRenderingContext2D;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1;
    c.clearRect(0, 0, canvas.width, canvas.height);
    c.imageSmoothingEnabled = false;

    const stepRad = CONFIG.rotationStepDeg * DEG;

    for (const leaf of leaves) {
      const dw = leaf.img.naturalWidth * devScale;
      const dh = leaf.img.naturalHeight * devScale;

      let a = leaf.angle;
      if (stepRad > 0) a = Math.round(a / stepRad) * stepRad;

      // Snap to whole device pixels so the pixel art stays crisp.
      c.setTransform(
        1,
        0,
        0,
        1,
        Math.round(leaf.x * dpr),
        Math.round(leaf.y * dpr),
      );
      if (a !== 0) c.rotate(a);
      c.globalAlpha = Math.max(0, Math.min(1, leaf.alpha));
      c.drawImage(leaf.img, Math.round(-dw / 2), Math.round(-dh / 2), dw, dh);
    }

    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1;
  }

  let last = performance.now();
  let spawnIn = 0;

  function frame(now: number): void {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    spawnIn -= dt * 1000;
    if (spawnIn <= 0 && leaves.length < CONFIG.maxLeaves) {
      leaves.push(spawn());
      spawnIn = rand(...CONFIG.spawnIntervalMs);
    }

    const surfaces = getSurfaces();
    for (let i = leaves.length - 1; i >= 0; i--) {
      if (!step(leaves[i], dt, now, surfaces)) leaves.splice(i, 1);
    }

    draw();
    requestAnimationFrame(frame);
  }

  document.addEventListener("visibilitychange", () => {
    last = performance.now();
  });

  requestAnimationFrame(frame);
}

init();
