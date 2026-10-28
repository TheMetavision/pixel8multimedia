// 8-bit snow over the seasonal homepage hero (HomeHero.astro). One canvas inside the hero,
// under the copy and the art card. Everything sits on a grid of square "pixels": flakes are
// single cells or a few larger plus shapes, step down a whole cell at a time, and land in a
// low drift along the hero's bottom edge that builds up and melts away. Never created for
// prefers-reduced-motion; stops drawing while the hero is off-screen or the tab is hidden.

interface Flake { col: number; y: number; vy: number; plus: boolean; color: string; sway: number; }

const COLORS = ['#ffffff', '#ffffff', '#9fd8ff'];
const DRIFT_MAX = 4;   // cells
const MELT = 0.012;    // chance per drift cell per second
const SWAY = [0.6, 1.6]; // seconds between sideways steps

export function startSnow(hero: HTMLElement): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const canvas = document.createElement('canvas');
  canvas.className = 'absolute inset-0 w-full h-full pointer-events-none';
  canvas.setAttribute('aria-hidden', 'true');
  /* Over the background gradient; the content grid comes later in the DOM, so it sits on top */
  hero.firstElementChild?.after(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) { canvas.remove(); return; }

  let w = 0, h = 0, cell = 4, cols = 0;
  let flakes: Flake[] = [];
  let drift = new Uint8Array(0);
  const rand = (a: number, b: number) => a + Math.random() * (b - a);

  const flake = (anyY: boolean): Flake => {
    const plus = Math.random() < 0.1;
    return {
      col: Math.floor(Math.random() * cols),
      y: anyY ? Math.random() * h : -3 * cell,
      vy: rand(plus ? 30 : 40, plus ? 50 : 80), // px/s; the big ones drift down slower
      plus,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      sway: rand(SWAY[0], SWAY[1]),
    };
  };

  /* Drop one cell of snow on a column, sliding it downhill so the drift stays low and smooth */
  const land = (col: number) => {
    for (let i = 0; i < 4; i++) {
      const l = col > 0 ? drift[col - 1] : 255, r = col < cols - 1 ? drift[col + 1] : 255;
      const low = l < r ? col - 1 : col + 1;
      if (Math.min(l, r) < drift[col]) col = low; else break;
    }
    if (drift[col] < DRIFT_MAX) drift[col]++;
  };

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const small = window.innerWidth < 768;
    w = hero.clientWidth;
    h = hero.clientHeight;
    cell = small ? 4 : 5;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    const newCols = Math.ceil(w / cell);
    if (newCols !== cols) {
      const old = drift;
      drift = new Uint8Array(newCols);
      if (old.length) drift.set(old.subarray(0, newCols));
      /* A thin starting drift, so the edge isn't bare while it builds */
      else for (let c = 0; c < newCols; c++) drift[c] = Math.random() < 0.5 ? 1 : 0;
      cols = newCols;
    }
    const count = small ? 25 : 60;
    while (flakes.length < count) flakes.push(flake(true));
    flakes.length = count;
    for (const f of flakes) if (f.col >= cols) f.col = Math.floor(Math.random() * cols);
  };

  const px = (col: number, row: number) => ctx.fillRect(col * cell, row * cell, cell, cell);

  let raf = 0, last = 0, melt = 0, onScreen = true;
  const frame = (t: number) => {
    const dt = last ? Math.min((t - last) / 1000, 0.05) : 0;
    last = t;
    ctx.clearRect(0, 0, w, h);

    for (const f of flakes) {
      f.y += f.vy * dt;
      f.sway -= dt;
      if (f.sway <= 0) {
        f.col = Math.min(cols - 1, Math.max(0, f.col + (Math.random() < 0.5 ? -1 : 1)));
        f.sway = rand(SWAY[0], SWAY[1]);
      }
      const row = Math.floor(f.y / cell);
      const lowest = f.plus ? row + 1 : row;
      /* Landed: its lowest cell has reached the top of the drift under it */
      if ((lowest + 1) * cell >= h - drift[f.col] * cell) {
        land(f.col);
        Object.assign(f, flake(false));
        continue;
      }
      ctx.fillStyle = f.color;
      ctx.globalAlpha = 0.9;
      if (f.plus) {
        px(f.col, row - 1); px(f.col - 1, row); px(f.col, row); px(f.col + 1, row); px(f.col, row + 1);
      } else {
        px(f.col, row);
      }
    }

    /* Melt: a few random cells, in proportion to how much snow is lying */
    let total = 0;
    for (let c = 0; c < cols; c++) total += drift[c];
    melt += total * MELT * dt;
    while (melt >= 1) {
      melt--;
      for (let tries = 0; tries < 8; tries++) {
        const c = Math.floor(Math.random() * cols);
        if (drift[c]) { drift[c]--; break; }
      }
    }

    /* The drift: white on top, pale blue underneath, flush with the hero's bottom edge */
    ctx.globalAlpha = 0.85;
    for (let c = 0; c < cols; c++) {
      const d = drift[c];
      if (!d) continue;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(c * cell, h - d * cell, cell, cell);
      if (d > 1) {
        ctx.fillStyle = '#9fd8ff';
        ctx.fillRect(c * cell, h - (d - 1) * cell, cell, (d - 1) * cell);
      }
    }
    ctx.globalAlpha = 1;
    raf = requestAnimationFrame(frame);
  };

  const shouldRun = () => onScreen && !document.hidden;
  const update = () => {
    if (shouldRun()) { if (!raf) { last = 0; raf = requestAnimationFrame(frame); } }
    else if (raf) { cancelAnimationFrame(raf); raf = 0; }
  };

  resize();
  new ResizeObserver(resize).observe(hero);
  new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; update(); }).observe(hero);
  document.addEventListener('visibilitychange', update);
  update();
}
