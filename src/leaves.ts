/**
 * Falling pixel-art leaves (decorative background layer).
 *
 * - Leaves spawn just above the top of the viewport and drift down with a gentle sway.
 * - They are drawn on a fixed canvas placed right after the .bg-sky element, so they
 *   sit above the night sky but behind all of the page UI (cards, text, buttons).
 * - No collision: leaves fall straight through and are removed once they leave the screen.
 * - Image smoothing is off, the pixel scale is a whole number and positions snap to
 *   whole device pixels, so the pixel art never gets blurred.
 */

import leaf1 from "./particles/leaf1.png";
import leaf2 from "./particles/leaf2.png";
import leaf3 from "./particles/leaf3.png";
import leaf4 from "./particles/leaf4.png";
import leaf5 from "./particles/leaf5.png";

const SPRITE_URLS: string[] = [leaf1, leaf2, leaf3, leaf4, leaf5];

const CONFIG = {
  /** CSS pixels used for each pixel of the texture (4 = every texture pixel is 4x4 px). */
  pixelScale: 6,
  /** Max leaves alive at once. */
  maxLeaves: 360,
  /** Random delay between spawns, in ms [min, max]. */
  spawnIntervalMs: [250, 600] as [number, number],
  /** Fall speed in CSS px / second [min, max]. */
  fallSpeed: [35, 65] as [number, number],
  /** Constant sideways wind in px / second [min, max]. */
  drift: [-25, 25] as [number, number],
  /** Sway strength (horizontal velocity amplitude, px / second) [min, max]. */
  swayAmp: [40, 60] as [number, number],
  /** Sway speed in radians / second [min, max]. */
  swayFreq: [1.2, 2.4] as [number, number],
  /** Max tilt while falling, in degrees. */
  maxTiltDeg: 90,
  /** Rotation snaps to this step (keeps the pixel-art look). 0 = continuous. */
  rotationStepDeg: 15,
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
  tilt: number;
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
    // Same layer as .bg-sky (z-index: -1). Because the canvas comes right after it in
    // the DOM, it is painted on top of the sky but still behind all of the page UI.
    zIndex: "-1",
    imageRendering: "pixelated",
  });

  const sky = document.querySelector(".bg-sky");
  if (sky) {
    sky.insertAdjacentElement("afterend", canvas);
  } else {
    document.body.prepend(canvas);
  }

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
      tilt: rand(0.6, 1) * CONFIG.maxTiltDeg * DEG,
    };
  }

  /** Returns false when the leaf has left the screen and should be removed. */
  function step(leaf: Leaf, dt: number): boolean {
    const { w, h } = sizeOf(leaf);

    leaf.t += dt;
    const phase = leaf.t * leaf.swayFreq + leaf.swayPhase;
    leaf.x += (leaf.drift + Math.cos(phase) * leaf.swayAmp) * dt;
    leaf.y += leaf.fallSpeed * (1 + 0.2 * Math.sin(phase * 0.6)) * dt;
    leaf.angle = Math.cos(phase) * leaf.tilt;

    if (leaf.y - h / 2 > window.innerHeight) return false;
    if (leaf.x < -w * 2 || leaf.x > window.innerWidth + w * 2) return false;
    return true;
  }

  function draw(): void {
    const c = ctx as CanvasRenderingContext2D;
    c.setTransform(1, 0, 0, 1, 0, 0);
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
      c.drawImage(leaf.img, Math.round(-dw / 2), Math.round(-dh / 2), dw, dh);
    }

    c.setTransform(1, 0, 0, 1, 0, 0);
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

    for (let i = leaves.length - 1; i >= 0; i--) {
      if (!step(leaves[i], dt)) leaves.splice(i, 1);
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
