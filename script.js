/* ============================================================ 
   TWEAKLR THEME — EARLY SAFE HANDLER
   Independent from app boot; keeps the existing MoonSky engine
   synchronized without changing the rest of the theme system.
   ============================================================ */
(function () {
  const KEY = 'ming-theme';
  const EXPLICIT_KEY = 'ming-theme-explicit';
  const root = document.documentElement;

  function buttons() {
    return Array.from(document.querySelectorAll('[data-theme-toggle]'));
  }

  function sync(theme) {
    const dark = theme === 'dark';
    root.setAttribute('data-theme', dark ? 'dark' : 'light');

    buttons().forEach(btn => {
      btn.setAttribute('aria-pressed', String(dark));
      btn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
    });

    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#100D0B' : '#F7F2EC');

    // MoonSky owns Moonflower's sun/moon atmosphere and night effects.
    // Notify it directly as well as leaving its existing observer intact.
    try {
      if (window.MoonSky && typeof window.MoonSky.setMode === 'function') {
        window.MoonSky.setMode(dark ? 'dark' : 'light');
      }
    } catch (_) {}
  }

  function toggle() {
    const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    sync(next);
    try {
      localStorage.setItem(KEY, next);
      localStorage.setItem(EXPLICIT_KEY, '1');
    } catch (_) {}
  }

  // Capture phase keeps the toggle usable even if another app handler fails.
  document.addEventListener('click', event => {
    const btn = event.target && event.target.closest
      ? event.target.closest('[data-theme-toggle]')
      : null;
    if (!btn) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    toggle();
  }, true);

  sync(root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
})();

/*=============================
   MOON-SKY.JS
=============================*/
/* ============================================================
   Tweaklr — Moonflower
   moon-sky.js  ·  a single canvas, one render loop, mounted into
   whichever Moonflower screen is currently active.

   Tweaklr is the world outside; this is the world inside. The engine
   never touches app.js's state or Moonflower's data (goals, notes,
   reminders, chat) — it only draws the environment behind it.

   Two atmospheres share this canvas and one render loop:
     mode 'dark'  — moon, cool stars, a rare occasional eclipse
     mode 'light' — sun, warm atmosphere, faint drifting dust
   The mode follows Tweaklr's existing global theme toggle by watching
   <html data-theme> — the same self-wiring already used below to
   move the canvas between screens. theme.js is never touched.
   ============================================================ */
(function () {
  'use strict';

  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const COARSE = matchMedia('(pointer: coarse)').matches;
  const cores = navigator.hardwareConcurrency || 4;

  /* ---- one-time device tier ---- */
  function pickTier() {
    if (REDUCED) return 'still';
    if (cores <= 2 || (COARSE && innerWidth < 380)) return 'low';
    if (cores >= 6 && !COARSE) return 'high';
    return 'mid';
  }
  const TIERS = {
    still: { stars: 90, sat: 0, neb: 1, shoot: 0, dpr: 1, parallax: 0 },
    low: { stars: 70, sat: 2, neb: 1, shoot: 1, dpr: 1, parallax: 0.4 },
    mid: { stars: 150, sat: 3, neb: 2, shoot: 2, dpr: 1.5, parallax: 0.7 },
    high: { stars: 240, sat: 5, neb: 3, shoot: 2, dpr: 2, parallax: 1 }
  };

  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  /* dark atmosphere */
  const NIGHT = {
    space: '#02030A', shadow: '#0B0D16', grey: '#8F929B',
    light: '#DDE2EA', silver: '#BFC5D0', blue: '#11182A', violet: '#28233D'
  };
  /* light atmosphere — evolves from Tweaklr's own warm palette, not a
     plain white flip: quiet cream/gold, sunlight through a still room */
  const DAY = {
    sky: '#F7EEE0', skyEdge: '#EEDFC5', dust: '#E7CFA6',
    sunCore: '#FFF7E6', sunMid: '#F3D9A6', sunEdge: '#D9A75C', cloud: '#EADFC9'
  };

  function initialMode() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  function MoonSky() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'msky';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.ctx = this.canvas.getContext('2d', { alpha: true });
    this.tier = pickTier();
    this.cfg = TIERS[this.tier];
    this.mounted = null;
    this.running = false;
    this.w = 0; this.h = 0; this.dpr = 1;
    this.t0 = performance.now();
    this.introStart = null;
    this.slowFrames = 0; this.frameChecks = 0;
    this.pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    this.orientReady = false;

    /* mode: 0 = dark/moon, 1 = light/sun. mix eases toward target so a
       theme switch reads as time passing, not a hard cut */
    this.mode = initialMode();
    this.mix = this.mode === 'light' ? 1 : 0;
    this.mixTarget = this.mix;

    /* eclipse: dark-mode only, rare, cinematic. Eligible after a
       while, then again after a long randomized gap. Phases advance
       against accumulated dark-mode viewing time, not wall clock, so
       it never fires while the person is looking at daylight. */
    this.eclipse = { phase: 'idle', t: 0, next: rand(45, 90), darkTime: 0 };
    this.onEclipse = null;

    this._genField();
    this._ro = new ResizeObserver(() => this._resize());
    this._raf = null;

    this._onPointer = e => {
      if (!this.cfg.parallax) return;
      this.pointer.tx = clamp((e.clientX / innerWidth) * 2 - 1, -1, 1);
      this.pointer.ty = clamp((e.clientY / innerHeight) * 2 - 1, -1, 1);
    };
    this._onOrient = e => {
      if (!this.cfg.parallax || e.gamma === null) return;
      this.pointer.tx = clamp(e.gamma / 28, -1, 1);
      this.pointer.ty = clamp((e.beta - 40) / 28, -1, 1);
    };
    this._onFirstTap = () => {
      if (this.orientReady) return;
      this.orientReady = true;
      if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
        DeviceOrientationEvent.requestPermission().then(r => {
          if (r === 'granted') window.addEventListener('deviceorientation', this._onOrient);
        }).catch(() => {});
      } else if (typeof DeviceOrientationEvent !== 'undefined') {
        window.addEventListener('deviceorientation', this._onOrient);
      }
    };
  }

  MoonSky.prototype._genField = function () {
    const c = this.cfg;
    this.stars = [];
    for (let i = 0; i < c.stars; i++) {
      const depth = Math.pow(Math.random(), 1.6); // biased toward far (small/dim)
      this.stars.push({
        x: Math.random(), y: Math.random(),
        r: lerp(0.4, 1.9, depth),
        base: lerp(0.15, 0.95, depth),
        depth,
        phase: rand(0, Math.PI * 2),
        speed: rand(0.6, 1.6),
        warm: Math.random() < 0.18
      });
    }
    this.nebula = [];
    for (let i = 0; i < c.neb; i++) {
      this.nebula.push({
        x: rand(0.1, 0.9), y: rand(0.05, 0.7), r: rand(0.28, 0.46),
        hue: Math.random() < 0.5 ? NIGHT.violet : NIGHT.blue,
        alpha: rand(0.12, 0.22), phase: rand(0, Math.PI * 2)
      });
    }
    this.sats = [];
    for (let i = 0; i < c.sat; i++) this._newSat();
    this.shots = [];
    this._nextShot = rand(1800, 4600);
    this.body = { xf: rand(0.68, 0.82), yf: rand(0.2, 0.34), rf: rand(0.24, 0.29), craters: null };
    const cr = [];
    for (let i = 0; i < 15; i++) {
      const a = rand(0, Math.PI * 2), d = rand(0.05, 0.82) * rand(0.4, 1);
      cr.push({ dx: Math.cos(a) * d, dy: Math.sin(a) * d, r: rand(0.05, 0.16), shade: rand(0.12, 0.32) });
    }
    this.body.craters = cr;
    this.rays = [];
    for (let i = 0; i < 6; i++) this.rays.push({ a: rand(0, Math.PI * 2), w: rand(0.16, 0.3), speed: rand(0.004, 0.01) });
  };

  MoonSky.prototype._newSat = function () {
    const edge = Math.floor(rand(0, 4));
    const pos = { x: 0, y: 0 };
    if (edge === 0) { pos.x = rand(0, 1); pos.y = -0.05; }
    else if (edge === 1) { pos.x = 1.05; pos.y = rand(0, 1); }
    else if (edge === 2) { pos.x = rand(0, 1); pos.y = 1.05; }
    else { pos.x = -0.05; pos.y = rand(0, 1); }
    const target = { x: rand(0.1, 0.9), y: rand(0.1, 0.9) };
    const speed = rand(0.006, 0.014);
    const ang = Math.atan2(target.y - pos.y, target.x - pos.x);
    this.sats.push({
      x: pos.x, y: pos.y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
      blink: rand(0, 6), r: rand(1.1, 1.8)
    });
  };

  MoonSky.prototype._spawnShot = function () {
    const c = this.cfg;
    if (this.shots.length >= c.shoot) return;
    const fromTop = Math.random() < 0.7;
    const x = fromTop ? rand(0.1, 0.95) : (Math.random() < 0.5 ? -0.02 : 1.02);
    const y = fromTop ? -0.02 : rand(0.05, 0.5);
    const ang = rand(0.35, 0.85) * (Math.random() < 0.5 ? 1 : -1) + Math.PI / 2 * (fromTop ? 1 : 0.4);
    const speed = rand(0.55, 1.3);
    const big = Math.random() < 0.15;
    this.shots.push({
      x, y, vx: Math.cos(ang) * speed * (fromTop ? 1 : (x < 0 ? 1 : -1)),
      vy: Math.sin(ang) * speed * 0.7 + 0.25,
      life: 0, max: rand(0.7, big ? 1.6 : 1.1), len: big ? rand(120, 190) : rand(55, 110),
      w: big ? rand(1.6, 2.2) : rand(0.8, 1.4)
    });
  };

  /* ---- theme: called by the <html data-theme> watcher below ---- */
  MoonSky.prototype.setMode = function (mode) {
    if (mode !== 'light' && mode !== 'dark') return;
    if (this.mode === mode) return;
    this.mode = mode;
    this.mixTarget = mode === 'light' ? 1 : 0;
    // leaving the dark atmosphere mid-eclipse: let it recede quickly
    // rather than freezing an occluder over a moon that is fading out
    if (mode === 'light' && this.eclipse.phase !== 'idle' && this.eclipse.phase !== 'recede') {
      this.eclipse.phase = 'recede'; this.eclipse.t = 0;
    }
    // the "still" tier never runs a render loop, so give it an
    // immediate, un-animated redraw rather than a stale atmosphere
    if (this.tier === 'still') {
      this.mix = this.mixTarget;
      if (this.mounted) this._draw(performance.now());
    }
  };

  /* ---- lifecycle ---- */
  MoonSky.prototype.mountTo = function (el) {
    if (this.mounted === el) { this.start(); return; }
    if (this.mounted) this._ro.unobserve(this.mounted);
    this.mounted = el;
    el.insertBefore(this.canvas, el.firstChild);
    el.addEventListener('pointerdown', this._onFirstTap, { once: true, passive: true });
    this._ro.observe(el);
    this._resize();
    this.introStart = performance.now();
    this.start();
  };

  MoonSky.prototype._resize = function () {
    if (!this.mounted) return;
    const r = this.mounted.getBoundingClientRect();
    this.dpr = Math.min(devicePixelRatio || 1, this.cfg.dpr);
    this.w = Math.max(1, Math.round(r.width));
    this.h = Math.max(1, Math.round(r.height));
    this.canvas.width = this.w * this.dpr;
    this.canvas.height = this.h * this.dpr;
    this.canvas.style.width = this.w + 'px';
    this.canvas.style.height = this.h + 'px';
  };

  MoonSky.prototype.start = function () {
    if (this.running) return;
    this.running = true;
    if (this.cfg.parallax) {
      window.addEventListener('pointermove', this._onPointer, { passive: true });
    }
    document.addEventListener('visibilitychange', this._onVis || (this._onVis = () => {
      if (document.hidden) this.stop(); else if (this.mounted) this.start();
    }));
    this._lastT = performance.now();
    if (this.tier === 'still') { this._draw(performance.now()); this.running = false; return; }
    const step = t => { this._frame(t); if (this.running) this._raf = requestAnimationFrame(step); };
    this._raf = requestAnimationFrame(step);
  };

  MoonSky.prototype.stop = function () {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    window.removeEventListener('pointermove', this._onPointer);
  };

  MoonSky.prototype._frame = function (t) {
    const start = performance.now();
    this._draw(t);
    const dt = performance.now() - start;
    if (this.frameChecks < 240) {
      this.frameChecks++;
      if (dt > 20) this.slowFrames++;
      if (this.frameChecks === 240 && this.slowFrames > 140 && this.tier !== 'low' && this.tier !== 'still') {
        this.tier = this.tier === 'high' ? 'mid' : 'low';
        this.cfg = TIERS[this.tier];
        this._genField();
      }
    }
  };

  /* ---- eclipse state machine (dark mode only) ----
     approach → align (peak, corona + dip) → recede → idle, then a
     long randomized wait before it's eligible again. */
  MoonSky.prototype._advanceEclipse = function (dtSec) {
    const e = this.eclipse;
    if (this.mode !== 'dark' || this.mix > 0.05) { e.darkTime = 0; return; }
    e.darkTime += dtSec;

    if (e.phase === 'idle') {
      if (e.darkTime >= e.next) { e.phase = 'approach'; e.t = 0; }
      return;
    }
    e.t += dtSec;
    const DUR = { approach: 6, align: 3.2, recede: 6.5 };
    if (e.phase === 'approach' && e.t >= DUR.approach) { e.phase = 'align'; e.t = 0; if (this.onEclipse) this.onEclipse(); }
    else if (e.phase === 'align' && e.t >= DUR.align) { e.phase = 'recede'; e.t = 0; }
    else if (e.phase === 'recede' && e.t >= DUR.recede) {
      e.phase = 'idle'; e.t = 0; e.darkTime = 0; e.next = rand(150, 320);
    }
  };

  /* 0 = no eclipse influence, 1 = full alignment (peak dimming) */
  MoonSky.prototype._eclipseK = function () {
    const e = this.eclipse;
    if (e.phase === 'idle') return 0;
    const DUR = { approach: 6, align: 3.2, recede: 6.5 };
    if (e.phase === 'approach') return clamp(e.t / DUR.approach, 0, 1);
    if (e.phase === 'align') return 1;
    return clamp(1 - e.t / DUR.recede, 0, 1);
  };

  /* ---- draw ---- */
  MoonSky.prototype._draw = function (t) {
    const ctx = this.ctx, w = this.w, h = this.h, dpr = this.dpr;
    const dtSec = clamp((t - (this._lastT || t)) / 1000, 0, 0.25);
    this._lastT = t;
    this.mix = lerp(this.mix, this.mixTarget, clamp(dtSec * 1.1, 0, 1));
    this._advanceEclipse(dtSec);
    const eK = this._eclipseK();
    this.eclipsing = eK > 0.02 && this.mix < 0.5;

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const mix = this.mix; // 0 dark .. 1 light

    /* sky fill — cross-faded, never a hard swap */
    ctx.fillStyle = NIGHT.space;
    ctx.fillRect(0, 0, w, h);
    if (mix > 0.002) {
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, DAY.sky);
      sky.addColorStop(1, DAY.skyEdge);
      ctx.save();
      ctx.globalAlpha = mix;
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }

    const time = (t - this.t0) / 1000;
    const intro = this.introStart ? clamp((t - this.introStart) / 1400, 0, 1) : 1;
    const introEase = 1 - Math.pow(1 - intro, 3);
    const dim = 1 - eK * 0.4; // eclipse ambient dip

    if (this.cfg.parallax) {
      this.pointer.x = lerp(this.pointer.x, this.pointer.tx, 0.05);
      this.pointer.y = lerp(this.pointer.y, this.pointer.ty, 0.05);
    }
    const px = this.pointer.x, py = this.pointer.y;

    const bodyX = this.body.xf * w;
    const bodyY = this.body.yf * h + (this.tier === 'still' ? 0 : Math.sin(time * 0.06) * 4);
    const bodyR = this.body.rf * Math.min(w, h * 1.15);

    /* nebula / soft cloud — farthest, barely moves, hue crosses over */
    ctx.save();
    ctx.translate(px * 5, py * 5);
    this.nebula.forEach(n => {
      const nx = n.x * w + Math.sin(time * 0.05 + n.phase) * 10;
      const ny = n.y * h + Math.cos(time * 0.04 + n.phase) * 8;
      const r = n.r * Math.max(w, h);
      const nightA = n.alpha * introEase * (1 - mix) * dim;
      if (nightA > 0.003) {
        const g = ctx.createRadialGradient(nx, ny, 0, nx, ny, r);
        g.addColorStop(0, hexA(n.hue, nightA));
        g.addColorStop(1, hexA(n.hue, 0));
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(nx, ny, r, 0, 7); ctx.fill();
      }
      const dayA = n.alpha * 0.55 * introEase * mix;
      if (dayA > 0.003) {
        const g2 = ctx.createRadialGradient(nx, ny, 0, nx, ny, r);
        g2.addColorStop(0, hexA(DAY.cloud, dayA));
        g2.addColorStop(1, hexA(DAY.cloud, 0));
        ctx.fillStyle = g2;
        ctx.beginPath(); ctx.arc(nx, ny, r, 0, 7); ctx.fill();
      }
    });
    ctx.restore();

    /* stars ⇄ dust — same positions and twinkle, color/alpha crosses over */
    const still = this.tier === 'still';
    const pulseBoost = (this._pulseUntil && t < this._pulseUntil)
      ? 0.22 * ((this._pulseUntil - t) / 900)
      : 0;
    for (let i = 0; i < this.stars.length; i++) {
      const s = this.stars[i];
      const factor = lerp(3, 20, s.depth) * this.cfg.parallax;
      const sx = s.x * w + px * factor;
      const sy = s.y * h + py * factor;
      let a = s.base;
      if (!still) a *= 0.72 + 0.28 * Math.sin(time * s.speed + s.phase);
      const dm = Math.hypot(sx - bodyX, sy - bodyY);
      const glowBoost = dm < bodyR * 3.2 ? (1 - dm / (bodyR * 3.2)) * 0.35 : 0;
      const nightA = clamp((a + glowBoost + pulseBoost) * dim, 0, 1) * introEase * (1 - mix);
      const dayA = a * 0.22 * mix * introEase; // faint dust, deliberately subtle
      if (nightA > 0.004) {
        ctx.beginPath();
        ctx.fillStyle = s.warm ? `rgba(223,214,196,${nightA})` : `rgba(221,226,234,${nightA})`;
        ctx.arc(sx, sy, s.r, 0, 7);
        ctx.fill();
        if (s.r > 1.5 && nightA > 0.6) {
          ctx.beginPath();
          ctx.fillStyle = `rgba(221,226,234,${nightA * 0.12})`;
          ctx.arc(sx, sy, s.r * 3.2, 0, 7);
          ctx.fill();
        }
      }
      if (dayA > 0.004) {
        ctx.beginPath();
        ctx.fillStyle = `rgba(217,167,92,${dayA})`;
        ctx.arc(sx, sy, s.r * 0.85, 0, 7);
        ctx.fill();
      }
    }

    ctx.save();
    ctx.translate(px * 6 * this.cfg.parallax, py * 6 * this.cfg.parallax);

    /* sun bloom + disc (fades in as mix → 1) */
    if (mix > 0.01) {
      ctx.save();
      ctx.globalAlpha = mix * introEase;
      const sunBloomR = bodyR * 2.9;
      const sbloom = ctx.createRadialGradient(bodyX, bodyY, bodyR * 0.3, bodyX, bodyY, sunBloomR);
      sbloom.addColorStop(0, hexA(DAY.sunEdge, 0.28));
      sbloom.addColorStop(1, hexA(DAY.sunEdge, 0));
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = sbloom;
      ctx.beginPath(); ctx.arc(bodyX, bodyY, sunBloomR, 0, 7); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';

      if (!still) {
        this.rays.forEach(ray => {
          const a0 = ray.a + time * ray.speed;
          ctx.save();
          ctx.translate(bodyX, bodyY);
          ctx.rotate(a0);
          const rg = ctx.createRadialGradient(0, 0, bodyR * 0.9, 0, 0, bodyR * 2.4);
          rg.addColorStop(0, hexA(DAY.sunMid, 0.05));
          rg.addColorStop(1, hexA(DAY.sunMid, 0));
          ctx.fillStyle = rg;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.arc(0, 0, bodyR * 2.4, -ray.w / 2, ray.w / 2);
          ctx.closePath(); ctx.fill();
          ctx.restore();
        });
      }

      const sun = ctx.createRadialGradient(
        bodyX - bodyR * 0.25, bodyY - bodyR * 0.28, bodyR * 0.1,
        bodyX, bodyY, bodyR * 0.86
      );
      sun.addColorStop(0, DAY.sunCore);
      sun.addColorStop(0.55, DAY.sunMid);
      sun.addColorStop(1, DAY.sunEdge);
      ctx.fillStyle = sun;
      ctx.beginPath(); ctx.arc(bodyX, bodyY, bodyR * 0.86, 0, 7); ctx.fill();
      ctx.restore();
    }

    /* moon bloom + disc + craters (fades in as mix → 0) */
    if (mix < 0.99) {
      const moonAlpha = (1 - mix) * introEase * dim;
      const bloomR = bodyR * 2.6;
      const bloom = ctx.createRadialGradient(bodyX - bodyR * 0.3, bodyY - bodyR * 0.3, bodyR * 0.4, bodyX, bodyY, bloomR);
      bloom.addColorStop(0, `rgba(224,227,238,${0.30 * moonAlpha})`);
      bloom.addColorStop(1, 'rgba(224,227,238,0)');
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = bloom;
      ctx.beginPath(); ctx.arc(bodyX, bodyY, bloomR, 0, 7); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = moonAlpha;
      const disc = ctx.createRadialGradient(
        bodyX - bodyR * 0.38, bodyY - bodyR * 0.4, bodyR * 0.15,
        bodyX, bodyY, bodyR
      );
      disc.addColorStop(0, '#F1F0EE');
      disc.addColorStop(0.42, NIGHT.light);
      disc.addColorStop(0.75, NIGHT.silver);
      disc.addColorStop(1, NIGHT.shadow);
      ctx.fillStyle = disc;
      ctx.beginPath(); ctx.arc(bodyX, bodyY, bodyR, 0, 7); ctx.fill();

      ctx.save();
      ctx.beginPath(); ctx.arc(bodyX, bodyY, bodyR, 0, 7); ctx.clip();
      this.body.craters.forEach(cr => {
        const cx = bodyX + cr.dx * bodyR, cy = bodyY + cr.dy * bodyR, r = cr.r * bodyR;
        const lit = ((cx - bodyX) < 0) ? 1 : 0.4;
        const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
        g.addColorStop(0, `rgba(11,13,22,0)`);
        g.addColorStop(0.6, `rgba(11,13,22,${cr.shade * 0.5 * lit})`);
        g.addColorStop(1, `rgba(11,13,22,${cr.shade * lit})`);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.fill();
      });
      const rim = ctx.createRadialGradient(bodyX - bodyR * 0.5, bodyY - bodyR * 0.5, bodyR * 0.7, bodyX - bodyR * 0.5, bodyY - bodyR * 0.5, bodyR * 1.05);
      rim.addColorStop(0, 'rgba(255,255,255,0)');
      rim.addColorStop(1, 'rgba(255,255,255,.18)');
      ctx.fillStyle = rim;
      ctx.beginPath(); ctx.arc(bodyX, bodyY, bodyR, 0, 7); ctx.fill();
      ctx.restore();
      ctx.restore();

      /* eclipse occluder + corona, drawn only while it's actually happening */
      if (eK > 0.02) {
        const approach = this.eclipse.phase === 'recede' ? 1 - eK : eK;
        const ox = bodyX + (1 - approach) * bodyR * 2.4;
        const oy = bodyY - (1 - approach) * bodyR * 0.6;
        ctx.save();
        ctx.globalAlpha = moonAlpha;
        ctx.beginPath(); ctx.arc(bodyX, bodyY, bodyR, 0, 7); ctx.clip();
        ctx.fillStyle = NIGHT.space;
        ctx.beginPath(); ctx.arc(ox, oy, bodyR * 1.02, 0, 7); ctx.fill();
        ctx.restore();
        if (this.eclipse.phase === 'align') {
          const corona = ctx.createRadialGradient(bodyX, bodyY, bodyR * 0.94, bodyX, bodyY, bodyR * 1.16);
          corona.addColorStop(0, 'rgba(255,255,255,0)');
          corona.addColorStop(0.7, `rgba(255,246,232,${0.5 * moonAlpha})`);
          corona.addColorStop(1, 'rgba(255,246,232,0)');
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = corona;
          ctx.beginPath(); ctx.arc(bodyX, bodyY, bodyR * 1.16, 0, 7); ctx.fill();
          ctx.restore();
        }
      }
    }
    ctx.restore();

    /* satellites — a night-sky detail, fades out with the moon */
    if (!still && mix < 0.9) {
      const dt = 1 / 60;
      const satA = (1 - mix) * dim;
      this.sats.forEach((s, idx) => {
        s.x += s.vx; s.y += s.vy; s.blink += dt;
        if (s.x < -0.1 || s.x > 1.1 || s.y < -0.1 || s.y > 1.1) { this.sats.splice(idx, 1); this._newSat(); return; }
        const sx = s.x * w + px * 10 * this.cfg.parallax, sy = s.y * h + py * 10 * this.cfg.parallax;
        const blink = 0.4 + 0.6 * Math.max(0, Math.sin(s.blink * 1.3));
        const tlen = 9, ang = Math.atan2(s.vy, s.vx);
        const g = ctx.createLinearGradient(sx, sy, sx - Math.cos(ang) * tlen, sy - Math.sin(ang) * tlen);
        g.addColorStop(0, `rgba(200,208,224,${0.5 * introEase * satA})`);
        g.addColorStop(1, 'rgba(200,208,224,0)');
        ctx.strokeStyle = g; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx - Math.cos(ang) * tlen, sy - Math.sin(ang) * tlen); ctx.stroke();
        ctx.beginPath();
        ctx.fillStyle = `rgba(216,222,232,${blink * introEase * satA})`;
        ctx.arc(sx, sy, s.r, 0, 7); ctx.fill();
      });
    }

    /* shooting stars — same, night-only */
    if (!still && mix < 0.9) {
      this._nextShot -= 16.7;
      if (this._nextShot <= 0) { this._spawnShot(); this._nextShot = rand(2200, 8600); }
      const shotA = (1 - mix) * dim;
      for (let i = this.shots.length - 1; i >= 0; i--) {
        const sh = this.shots[i];
        sh.life += 1 / 60;
        sh.x += sh.vx * 0.012; sh.y += sh.vy * 0.012;
        sh.vx *= 1.012; sh.vy *= 1.012;
        const alpha = (sh.life < sh.max * 0.15
          ? sh.life / (sh.max * 0.15)
          : clamp(1 - (sh.life - sh.max * 0.15) / (sh.max * 0.85), 0, 1)) * shotA;
        if (sh.life >= sh.max || alpha <= 0) { this.shots.splice(i, 1); continue; }
        const hx = sh.x * w, hy = sh.y * h;
        const ang = Math.atan2(sh.vy, sh.vx);
        const tx = hx - Math.cos(ang) * sh.len, ty = hy - Math.sin(ang) * sh.len;
        const g = ctx.createLinearGradient(hx, hy, tx, ty);
        g.addColorStop(0, `rgba(255,255,255,${alpha})`);
        g.addColorStop(0.4, `rgba(221,226,234,${alpha * 0.5})`);
        g.addColorStop(1, 'rgba(221,226,234,0)');
        ctx.strokeStyle = g; ctx.lineWidth = sh.w; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(tx, ty); ctx.stroke();
      }
    }

    ctx.restore();
  };

  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return `rgba(${r},${g},${b},${a})`;
  }

  /* ---- react to Moonflower-specific moments ---- */
  MoonSky.prototype.pulse = function () {
    // a brief brightening, used when a message lands inside "Talk to Me"
    if (this.tier === 'still') return;
    const boost = 900;
    this._pulseUntil = performance.now() + boost;
  };

  /* ============================================================
     auto-wiring — no changes to app.js or theme.js required.
     One observer moves the canvas between Moonflower's two screens;
     a second watches the global theme and crossfades this engine's
     own atmosphere to match, independently of anything else that
     also reacts to that same attribute.
  ============================================================ */
  const sky = new MoonSky();
  window.MoonSky = sky;

  const ids = ['screen-moonflower', 'screen-moonroom'];
  const screens = ids.map(id => document.getElementById(id)).filter(Boolean);

  function sync() {
    const active = screens.find(s => s.classList.contains('is-active'));
    if (active) sky.mountTo(active);
    else sky.stop();
  }
  screens.forEach(s => new MutationObserver(sync).observe(s, { attributes: true, attributeFilter: ['class'] }));
  sync();

  new MutationObserver(() => sky.setMode(initialMode()))
    .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
})();






















/*============================
     APP.JS   
  ============================*/
  /* ============================================================
   Tweaklr — People. Moments. Possibilities.
   app.js  ·  vanilla JS, no dependencies
   Sections: Utilities · Demo Data · App State · Rendering atoms
             Navigation · Location · Home · Discover · Nearby
             Daily Updates · Connections · Messaging · Moonflower
             Profile · Search · Notifications · Sheets · Modals
             Toasts · Actions · Boot
   ============================================================ */

/* ------------------------------------------------------------
   SUPABASE CONNECTION
------------------------------------------------------------ */

const SUPABASE_URL = 'https://avnuejgqaxygxeiyqeny.supabase.co';

const SUPABASE_PUBLISHABLE_KEY =
  'sb_publishable_wF8lZnLfC-x9ySqXUqRcHQ_CI_QWrHW';

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);

const IS_APP_PAGE = document.getElementById('app') !== null;


if (IS_APP_PAGE) {

/* ------------------------------------------------------------
   UTILITIES
------------------------------------------------------------ */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s = '') => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = n => `<svg aria-hidden="true"><use href="#i-${n}"/></svg>`;
const HOUR = 36e5;
const now = () => Date.now();
const uid = p => p + '_' + Math.random().toString(36).slice(2, 9);

function timeAgo(ts) {
  const m = Math.floor((now() - ts) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  const d = Math.floor(h / 24);
  return d === 1 ? 'yesterday' : d + 'd ago';
}
function clockTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
function hoursLeft(u) {
  return Math.max(0, (u.createdAt + 24 * HOUR - now()) / HOUR);
}
function lifeLabel(u) {
  const h = hoursLeft(u);
  if (h <= 0) return 'Gone';
  if (h < 1) return `Disappears in ${Math.max(1, Math.round(h * 60))}m`;
  return `Disappears in ${Math.round(h)}h`;
}
/* Display only. Coordinates are never shown; distance is deliberately coarse. */
function distLabel(km) {
  if (km === null || km === undefined || !isFinite(km)) return 'Distance unavailable';
  const metres = Math.max(0, km * 1000);
  if (metres < 1000) return Math.round(metres) + ' m away';
  if (km < 10) return km.toFixed(2) + ' km away';
  return km.toFixed(1) + ' km away';
}
function greetWord() {
  const h = new Date().getHours();
  if (h < 5) return 'Still up';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}
function initials(name) {
  return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ------------------------------------------------------------
   DEMO DATA  (shaped so a backend can drop straight in)
------------------------------------------------------------ */
const currentUser = {
  id: 'u_me',
  name: 'Connell Christopher',
  username: '@connell',
  usernameChangedAt: null,
  avatarUrl: '',
  hue: 24,
  headline: 'Application Security',
  tags: [],
  bio: 'Breaking things carefully so other people can build safely. Usually somewhere with good coffee and bad wifi.',
  interests: [],
  activity: '',
  joined: '',
  email: '',
  emailConfirmed: false,
  discoverable: true
};

/* ------------------------------------------------------------
   TWEAKLR CURRENT USER PROFILE READY STATE
------------------------------------------------------------ */

let mingProfileReadyResolve;
const mingProfileReady = new Promise(resolve => {
  mingProfileReadyResolve = resolve;
});

/* ------------------------------------------------------------
   TWEAKLR CURRENT USER PROFILE
------------------------------------------------------------ */

(async function loadMingCurrentUserProfile() {

  try {
    const {
      data: { session },
      error: sessionError
    } = await supabaseClient.auth.getSession();

    if (sessionError || !session?.user) {
      mingProfileReadyResolve();
      return;
    }

    const { data: profile, error } = await supabaseClient
      .from('profiles')
      .select('id, username, display_name, avatar_url, bio, headline, interests, tags, activity, discoverable, created_at, updated_at')
      .eq('id', session.user.id)
      .maybeSingle();

    if (error || !profile) {
      console.warn('Tweaklr: could not load current profile.', error?.message || 'Profile not found.');
      mingProfileReadyResolve();
      return;
    }

    currentUser.id = profile.id;
    currentUser.name =
      profile.display_name ||
      session.user.user_metadata?.display_name ||
      currentUser.name;

    currentUser.avatarUrl = profile.avatar_url || '';

    currentUser.username = profile.username
      ? '@' + profile.username.replace(/^@/, '')
      : currentUser.username;


    currentUser.bio = profile.bio || '';
    currentUser.headline = profile.headline || '';
    currentUser.interests = Array.isArray(profile.interests) ? profile.interests : [];
    currentUser.tags = Array.isArray(profile.tags) ? profile.tags : [];
    currentUser.activity = profile.activity || '';
    currentUser.discoverable = profile.discoverable !== false;
    currentUser.email = session.user.email || '';
    currentUser.emailConfirmed = !!session.user.email_confirmed_at;
    currentUser.joined = profile.created_at
      ? 'Joined ' + new Date(profile.created_at).toLocaleDateString([], { month: 'long', year: 'numeric' })
      : '';

    /*
       The app renders its demo UI asynchronously. The profile request can
       finish before or after that first render, so refresh the active views
       here after the real profile has arrived. This prevents the demo name
       from winning a race against Supabase.
    */
    const greeting = document.getElementById('greeting');
    if (greeting) {
      greeting.textContent = `${greetWord()}, ${currentUser.name.split(' ')[0]}`;
    }

    const moonTitle = document.getElementById('moon-title');
    if (moonTitle) {
      moonTitle.textContent = `${greetWord()}, ${currentUser.name.split(' ')[0]}.`;
    }

    if (typeof state !== 'undefined') {
      if (state.loaded?.home) renderHome();
      if (state.loaded?.profile) renderProfile();
      if (state.tab === 'moonflower') renderMoonflower();
    }

    console.log('Tweaklr: current profile loaded and active views refreshed.');
    mingProfileReadyResolve();

  } catch (error) {
    console.warn('Tweaklr: current profile load failed.', error);
    mingProfileReadyResolve();
  }

})();

const people = [
  { id: 'p1', name: 'Maya Okafor', short: 'Maya', hue: 340, tag: 'Designer · Entrepreneur', interests: ['Brand design', 'Ceramics', 'Coffee'], bio: 'Building a small design studio. Happy to trade feedback over coffee.', off: { e: -350, n: 600 }, status: 'on', activity: 'Sketching at Neo Café', visitor: false },
  { id: 'p2', name: 'Ibrahim Danjuma', short: 'Ibrahim', hue: 200, tag: 'Developer · Technology', interests: ['Backend', 'Chess', 'Running'], bio: 'Writing Go, breaking builds, fixing them again. Looking for a weekend project partner.', off: { e: 1000, n: -660 }, status: 'on', activity: 'Open to a working session', visitor: false },
  { id: 'p3', name: 'Tomi Adeleke', short: 'Tomi', hue: 28, tag: 'Photography · Student', interests: ['Film photography', 'Street', 'Music'], bio: 'Final year student. I shoot on a beaten-up Canon and I will photograph almost anything.', off: { e: -1400, n: -1280 }, status: 'away', activity: 'Free this weekend', visitor: false },
  { id: 'p4', name: 'Alex Nwosu', short: 'Alex', hue: 148, tag: 'Fitness · Music', interests: ['Football', 'Gym', 'Afrobeats'], bio: 'Five-a-side most evenings. Always short two players.', off: { e: 300, n: 270 }, status: 'on', activity: 'Football at 7', visitor: false },
  { id: 'p5', name: 'Sarah Bello', short: 'Sarah', hue: 268, tag: 'Marketing · Travel', interests: ['Brand strategy', 'Hiking', 'Markets'], bio: 'Marketing lead by day, aggressively curious about new neighbourhoods by evening.', off: { e: 2000, n: 1300 }, status: null, activity: 'Exploring the next neighbourhood over', visitor: false },
  { id: 'p6', name: 'Lena Fischer', short: 'Lena', hue: 188, tag: 'Visiting · Architecture', interests: ['Architecture', 'Food', 'Cycling'], bio: 'Here for ten days from Berlin. Would love to see the city with someone who actually lives here.', off: { e: -200, n: -1480 }, status: 'on', activity: 'New in town', visitor: true },
  { id: 'p7', name: 'Chidi Eze', short: 'Chidi', hue: 12, tag: 'Barista · Roaster', interests: ['Coffee', 'Vinyl', 'Cooking'], bio: 'I pull shots at a small place round the corner. Ask me where to eat.', off: { e: -120, n: -275 }, status: 'on', activity: 'Behind the bar till 8', visitor: false },
  { id: 'p8', name: 'Aisha Yusuf', short: 'Aisha', hue: 306, tag: 'Nurse · Volunteer', interests: ['Health', 'Reading', 'Gardening'], bio: 'Night shifts, quiet mornings. Runs a small first-aid workshop once a month.', off: { e: -2900, n: 1100 }, status: 'away', activity: 'Off shift today', visitor: false },
  { id: 'p9', name: 'Kunle Bamgbose', short: 'Kunle', hue: 88, tag: 'Carpenter · Furniture', interests: ['Woodwork', 'Design', 'Football'], bio: 'Tables, shelves, small repairs. Twelve years of sawdust.', off: { e: -1000, n: -1960 }, status: null, activity: 'Taking commissions', visitor: false },
  { id: 'p10', name: 'Priya Menon', short: 'Priya', hue: 222, tag: 'Visiting · Data science', interests: ['Data', 'Yoga', 'Street food'], bio: 'Here for a two-week project. Looking for a good running route and better suya.', off: { e: 800, n: -410 }, status: 'on', activity: 'Visiting for 2 weeks', visitor: true }
];
const mingConnectionProfiles = new Map();
let mingDiscoverPeople = [];
let mingNearbyActivities = [];
let mingLocationPublishKey = '';
const byId = id => people.find(p => p.id === id) || mingDiscoverPeople.find(p => p.id === id) || mingConnectionProfiles.get(id) || null;

const KINDS = {
  service: { label: 'Side hustle', cls: '' },
  hiring: { label: 'Hiring', cls: 'k-hiring' },
  alert: { label: 'Local alert', cls: 'k-alert' },
  sale: { label: 'For sale', cls: 'k-sale' },
  talk: { label: 'Someone to talk to', cls: 'k-talk' },
  visitor: { label: 'Visiting', cls: 'k-visitor' },
  activity: { label: 'Activity', cls: 'k-activity' },
  general: { label: 'Update', cls: '' }
};

let dailyUpdates = [];

let discoverMoments = [];
let discoverOpportunities = [];
let discoverActivities = [];
let discoverVisitors = [];
let discoverPlaces = [];
const discoverActivityJoined = new Set();

let connections = [
  { personId: 'p1', at: now() - 2 * 24 * HOUR },
  { personId: 'p2', at: now() - 1 * 24 * HOUR },
  { personId: 'p7', at: now() - 6 * 24 * HOUR },
  { personId: 'p5', at: now() - 21 * 24 * HOUR }
];
let connectionRequests = [
  { id: 'r1', personId: 'p3', message: 'Saw you shoot film too. I have a spare roll of Portra if you ever want to trade.', at: now() - 3 * HOUR },
  { id: 'r2', personId: 'p10', message: 'Visiting for two weeks and trying to find a running route. Any advice welcome.', at: now() - 26 * HOUR }
];
let connectionOutgoingRequests = [];

async function loadMingConnections() {
  try {
    const { data: { session }, error: sessionError } =
      await supabaseClient.auth.getSession();
    if (sessionError || !session?.user) return false;

    const { data: rows, error } = await supabaseClient
      .from('connections')
      .select('id, requester_id, recipient_id, status, note, created_at')
      .or(`requester_id.eq.${session.user.id},recipient_id.eq.${session.user.id}`)
      .order('created_at', { ascending: false });

    if (error) {
      console.warn('Tweaklr: connections backend is not ready yet.', error.message);
      return false;
    }

    const { data: profiles, error: profileError } =
      await supabaseClient.rpc('get_my_connection_profiles');

    if (profileError) {
      console.warn('Tweaklr: connection profiles could not be loaded.', profileError.message);
      return false;
    }

    mingConnectionProfiles.clear();
    (profiles || []).forEach(profile => {
      const interests = Array.isArray(profile.interests) ? profile.interests : [];
      const tags = Array.isArray(profile.tags) ? profile.tags : [];
      mingConnectionProfiles.set(profile.id, {
        id: profile.id,
        name: profile.display_name || 'Tweaklr user',
        short: profile.display_name || 'Tweaklr user',
        tag: profile.headline || tags.join(' · '),
        interests,
        bio: profile.bio || '',
        avatarUrl: profile.avatar_url || '',
        username: profile.username ? '@' + profile.username.replace(/^@/, '') : '',
        activity: profile.activity || '',
        status: null,
        km: null,
        visitor: false
      });
    });

    const uid = session.user.id;
    connections = (rows || [])
      .filter(row => row.status === 'accepted')
      .map(row => ({
        id: row.id,
        personId: row.requester_id === uid ? row.recipient_id : row.requester_id,
        at: new Date(row.created_at).getTime()
      }));

    connectionRequests = (rows || [])
      .filter(row => row.status === 'pending' && row.recipient_id === uid)
      .map(row => ({
        id: row.id,
        personId: row.requester_id,
        message: row.note || '',
        at: new Date(row.created_at).getTime()
      }));

    connectionOutgoingRequests = (rows || [])
      .filter(row => row.status === 'pending' && row.requester_id === uid)
      .map(row => ({
        id: row.id,
        personId: row.recipient_id,
        message: row.note || '',
        at: new Date(row.created_at).getTime()
      }));

    return true;
  } catch (error) {
    console.warn('Tweaklr: connection load failed.', error);
    return false;
  }
}

function connectionStatus(id) {
  if (isConnected(id)) return 'connected';
  if (connectionRequests.some(r => r.personId === id)) return 'incoming';
  return 'none';
}


function isUuidPerson(id) {
  return /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(id);
}

async function ensureMingCallAuthenticatedUser() {
  const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession();
  if (sessionError || !session?.access_token) {
    console.warn('Tweaklr: authenticated call session is not ready.', sessionError?.message || '');
    return false;
  }

  // Verify the same JWT that REST/Realtime will use. This prevents the
  // call layer from proceeding with a stale or locally cached session.
  const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
  if (userError || !user?.id || !isUuidPerson(user.id)) {
    console.warn('Tweaklr: authenticated call user could not be verified.', userError?.message || '');
    return false;
  }

  currentUser.id = user.id;
  await supabaseClient.realtime.setAuth(session.access_token);

  console.log('Tweaklr: call auth verified.', {
    userId: user.id,
    role: session.user?.role || null
  });

  return true;
}


function hasOutgoingConnectionRequest(id) {
  return connectionOutgoingRequests.some(r => r.personId === id);
}


let notifications = [];
let notificationReadIds = new Set();
let notificationReadAt = new Map();
let persistedReadNotifications = [];
const TWEAKLR_NOTIFICATION_RETENTION_MS = 24 * HOUR;

async function loadNotificationReadState() {
  notificationReadIds = new Set();
  notificationReadAt = new Map();
  persistedReadNotifications = [];
  const { data, error } = await supabaseClient
    .from('user_notification_reads')
    .select('notification_id, read_at, notification_payload')
    .eq('user_id', currentUser.id);

  if (error) {
    console.warn('Tweaklr: notification read state could not be loaded from the backend.', error.message);
    return false;
  }

  const cutoff = Date.now() - TWEAKLR_NOTIFICATION_RETENTION_MS;
  const expiredIds = [];
  (data || []).forEach(row => {
    if (!row.read_at) return;
    const readAt = new Date(row.read_at).getTime();
    if (!Number.isFinite(readAt) || readAt <= cutoff) {
      expiredIds.push(row.notification_id);
      return;
    }
    notificationReadIds.add(row.notification_id);
    notificationReadAt.set(row.notification_id, readAt);
    if (row.notification_payload && typeof row.notification_payload === 'object') {
      persistedReadNotifications.push({ ...row.notification_payload, read: true });
    }
  });

  if (expiredIds.length) {
    const { error: cleanupError } = await supabaseClient
      .from('user_notification_reads')
      .delete()
      .eq('user_id', currentUser.id)
      .in('notification_id', expiredIds);
    if (cleanupError) console.warn('Tweaklr: expired notification read states could not be cleaned up.', cleanupError.message);
  }
  return true;
}

async function saveNotificationReadState(ids) {
  const uniqueIds = [...new Set((Array.isArray(ids) ? ids : []).filter(id => typeof id === 'string' && id.length > 0))];
  if (!currentUser.id || !uniqueIds.length) return true;
  const { error } = await supabaseClient.rpc('mark_tweaklr_notifications_read', {
    p_notification_ids: uniqueIds
  });
  if (error) {
    console.warn('Tweaklr: notification read state could not be saved to the backend.', error.message);
    return false;
  }
  const readAt = Date.now();
  uniqueIds.forEach(id => {
    notificationReadIds.add(id);
    notificationReadAt.set(id, readAt);
  });
  return true;
}

async function loadMingNotifications() {
  try {
    const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession();
    if (sessionError || !session?.user) return false;

    currentUser.id = session.user.id;
    await loadNotificationReadState();
    await loadMingConnections();
    await loadMingMessages();

    const next = [];

    connectionRequests.forEach(r => {
      const p = byId(r.personId);
      const name = p?.short || p?.name || 'Someone';
      const id = 'connreq_' + r.id;
      next.push({
        id, type: 'request', personId: r.personId,
        text: '<b>' + esc(name) + '</b> wants to connect with you.',
        at: r.at, read: notificationReadIds.has(id)
      });
    });

    conversations.forEach(c => {
      const unread = c.messages.filter(m => !m.me && !m.read);
      if (!unread.length) return;
      const latest = unread[unread.length - 1];
      const p = byId(c.personId);
      const name = p?.short || p?.name || 'Someone';
      const id = 'message_' + latest.id;
      next.push({
        id, type: 'message', personId: c.personId,
        text: '<b>' + esc(name) + '</b> sent you ' + (unread.length === 1 ? 'a message.' : unread.length + ' messages.'),
        at: latest.at, read: notificationReadIds.has(id)
      });
    });

    const { data: updates, error: updateError } = await supabaseClient
      .rpc('get_daily_updates', { p_limit: 50 });

    if (!updateError) {
      (updates || []).forEach(row => {
        if (row.author_id === session.user.id) return;
        const p = byId(row.author_id);
        const name = p?.short || row.author_display_name || 'Someone';
        const id = 'update_' + row.id;
        next.push({
          id, type: 'update', updateId: row.id,
          text: '<b>' + esc(name) + '</b> posted a Daily Update.',
          at: new Date(row.created_at).getTime(),
          read: notificationReadIds.has(id)
        });
      });
    } else {
      console.warn('Tweaklr: Daily Update notifications could not be loaded.', updateError.message);
    }

    /* Post activity notifications: likes and comments on the current user's posts. */
    try {
      const { data: myPosts, error: myPostsError } = await supabaseClient
        .from('daily_updates')
        .select('id, title, created_at')
        .eq('author_id', session.user.id)
        .order('created_at', { ascending: false })
        .limit(100);

      if (!myPostsError && myPosts?.length) {
        const postIds = myPosts.map(row => row.id);
        const postById = new Map(myPosts.map(row => [row.id, row]));
        const [likesResult, commentsResult] = await Promise.all([
          supabaseClient
            .from('daily_update_likes')
            .select('id, update_id, user_id, created_at')
            .in('update_id', postIds)
            .neq('user_id', session.user.id)
            .order('created_at', { ascending: false })
            .limit(100),
          supabaseClient
            .from('daily_update_comments')
            .select('id, update_id, author_id, body, created_at')
            .in('update_id', postIds)
            .neq('author_id', session.user.id)
            .order('created_at', { ascending: false })
            .limit(100)
        ]);

        if (likesResult.error) {
          console.warn('Tweaklr: post-like notifications could not be loaded.', likesResult.error.message);
        }
        if (commentsResult.error) {
          console.warn('Tweaklr: post-comment notifications could not be loaded.', commentsResult.error.message);
        }

        const likeRows = likesResult.error ? [] : (likesResult.data || []);
        const commentRows = commentsResult.error ? [] : (commentsResult.data || []);
        const actorIds = [...new Set([
          ...likeRows.map(row => row.user_id),
          ...commentRows.map(row => row.author_id)
        ].filter(id => id && id !== session.user.id))];

        const actorMap = new Map();
        if (actorIds.length) {
          const { data: actors, error: actorsError } = await supabaseClient
            .from('profiles')
            .select('id, display_name, username, avatar_url')
            .in('id', actorIds);

          if (!actorsError) {
            (actors || []).forEach(actor => actorMap.set(actor.id, actor));
          } else {
            console.warn('Tweaklr: post notification profiles could not be loaded.', actorsError.message);
          }
        }

        const actorName = id => {
          const actor = actorMap.get(id);
          return actor?.display_name || (actor?.username ? '@' + String(actor.username).replace(/^@/, '') : 'Someone');
        };

        likeRows.forEach(row => {
          const post = postById.get(row.update_id);
          if (!post) return;
          const id = 'post_like_' + row.id;
          next.push({
            id,
            type: 'like',
            personId: row.user_id,
            updateId: row.update_id,
            text: '<b>' + esc(actorName(row.user_id)) + '</b> liked your post' + (post.title ? ' “' + esc(post.title) + '”' : '') + '.',
            at: new Date(row.created_at).getTime(),
            read: notificationReadIds.has(id)
          });
        });

        commentRows.forEach(row => {
          const post = postById.get(row.update_id);
          if (!post) return;
          const id = 'post_comment_' + row.id;
          next.push({
            id,
            type: 'comment',
            personId: row.author_id,
            updateId: row.update_id,
            text: '<b>' + esc(actorName(row.author_id)) + '</b> commented on your post' + (post.title ? ' “' + esc(post.title) + '”' : '') + '.',
            at: new Date(row.created_at).getTime(),
            read: notificationReadIds.has(id)
          });
        });
      }
    } catch (postNotificationError) {
      console.warn('Tweaklr: post activity notifications failed.', postNotificationError);
    }

    const { error: syncError } = await supabaseClient.rpc('sync_tweaklr_notifications', {
      p_notifications: next.map(n => ({
        id: n.id, type: n.type, personId: n.personId || null,
        updateId: n.updateId || null, text: n.text, at: n.at
      }))
    });
    if (syncError) {
      console.warn('Tweaklr: notification snapshots could not be synced to the backend.', syncError.message);
    }

    const freshIds = new Set(next.map(n => n.id));
    const retainedRead = persistedReadNotifications.filter(n => !freshIds.has(n.id));
    notifications = [...next, ...retainedRead]
      .filter(n => {
        const readAt = notificationReadAt.get(n.id);
        return !readAt || Date.now() - readAt < TWEAKLR_NOTIFICATION_RETENTION_MS;
      })
      .map(n => ({ ...n, read: notificationReadIds.has(n.id) }))
      .sort((a, b) => b.at - a.at);
    rememberAndPopupNewMingNotifications(notifications);
    updateNotifDot();
    return true;
  } catch (error) {
    console.warn('Tweaklr: notification load failed.', error);
    return false;
  }
}

let conversations = [
  {
    id: 'c_p1', personId: 'p1', unread: 0, messages: [
      { me: false, text: 'That security talk you mentioned — is it open to anyone?', at: now() - 26 * HOUR },
      { me: true, text: 'It is. I will send you the details tonight.', at: now() - 25.5 * HOUR },
      { me: false, text: 'Perfect. Also I am at Neo if you are around later.', at: now() - 40 * 60000 }
    ]
  },
  {
    id: 'c_p2', personId: 'p2', unread: 2, messages: [
      { me: false, text: 'Are you free Saturday morning?', at: now() - 3.2 * HOUR },
      { me: false, text: 'I want to pair on the booking thing before I lose interest in it', at: now() - 3 * HOUR }
    ]
  },
  {
    id: 'c_p7', personId: 'p7', unread: 0, messages: [
      { me: true, text: 'Save me a seat at the window?', at: now() - 5 * HOUR },
      { me: false, text: 'Always. Beans just came out of the roaster.', at: now() - 4.8 * HOUR }
    ]
  }
];

/* Moonflower — private, never leaves this device in the demo */
let moonNotes = [
  { id: 'mn1', at: now() - 20 * HOUR, text: 'Told Maya about the studio idea out loud for the first time. It sounded less ridiculous than it does in my head.' },
  { id: 'mn2', at: now() - 3 * 24 * HOUR, text: 'Slept badly. Walked instead of taking the car and the whole day was better for it. Remember that.' }
];
let moonGoals = [
  { id: 'g1', title: 'Ship the security audit toolkit', sub: 'Personal project · by December', steps: [{ t: 'Write the scanner core', done: true }, { t: 'Add report export', done: true }, { t: 'Write the docs', done: false }, { t: 'Publish v0.1', done: false }] },
  { id: 'g2', title: 'Run 5km without stopping', sub: 'Three mornings a week', steps: [{ t: 'Two runs a week for a month', done: true }, { t: 'Reach 3km', done: false }, { t: 'Reach 5km', done: false }] }
];
let moonReminders = [
  { id: 'rm1', text: 'Call home on Sunday', when: 'Sunday, 6pm', done: false },
  { id: 'rm2', text: 'Renew the domain', when: 'Friday', done: false },
  { id: 'rm3', text: 'Send Maya the talk details', when: 'Tonight', done: true }
];
let moonChat = [
  { me: false, text: 'Hello Connell. Nothing here is shared with anyone. What is on your mind tonight?', at: now() - 26 * HOUR }
];

/* ------------------------------------------------------------
   APP STATE
------------------------------------------------------------ */
const state = {
  tab: 'home',
  stack: [],
  loaded: { home: false, discover: false, nearby: false, tweak: false, profile: false },
  discoverFilter: 'all',
  radius: 2,
  locStatus: 'unknown',   // unknown | requesting | granted | denied | unavailable | timeout
  userLocation: null,      // exact device fix — internal only, never rendered
  geo: { locality: '', district: '', city: '', region: '', country: '', postcode: '' }, // derived from the fix
  geoWatchId: null,
  activeChat: null,
  activePerson: null,
  moonRoom: null,
  searchQuery: '',
  sheetCtx: null
};

/* ------------------------------------------------------------
   RENDERING ATOMS
------------------------------------------------------------ */
function avatarStyle(hue) {
  return `background:linear-gradient(145deg,hsl(${hue} 42% 66%),hsl(${(hue + 340) % 360} 40% 40%))`;
}
function avatar(p, size = 44, opts = {}) {
  const statusClass = isMingUserOnline(p.id) ? 'on' : '';
  const st = statusClass ? `<span class="status ${statusClass}"></span>` : '';
  const image = p.avatarUrl
    ? `<img src="${esc(p.avatarUrl)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;display:block;">`
    : initials(p.short || p.name);
  return `<span class="av av--${size}" style="${avatarStyle(p.hue)}" aria-hidden="true">${image}${opts.status === false ? '' : st}</span>`;
}
function ringAvatar(p, size = 56, live = false) {
  return `<span class="av-ring ${live ? 'live' : ''}">${avatar(p, size)}</span>`;
}
function kindPill(kind) {
  const k = KINDS[kind] || KINDS.general;
  return `<span class="kind ${k.cls}">${k.label}</span>`;
}
function sectionHead(title, hint, action) {
  return `<div class="section-head"><h2>${esc(title)}</h2>${action ? `<button data-action="${action.a}">${esc(action.t)}</button>` : hint ? `<span class="hint">${esc(hint)}</span>` : ''}</div>`;
}
function emptyState(title, body, cta) {
  return `<div class="empty"><div class="mark"></div><h3>${esc(title)}</h3><p>${esc(body)}</p>${cta ? `<button class="btn btn--soft" data-action="${cta.a}">${esc(cta.t)}</button>` : ''}</div>`;
}
function skeletonCards(n = 3) {
  return tweaklrLoadingMarkup('Gathering the latest around you…');
}
function skeletonRail() {
  return tweaklrLoadingMarkup('Discovering people nearby…');
}

/* ------------------------------------------------------------
   TWEAK — VIDEO FEED SHELL
   TikTok connection and live video integration are not active yet.
------------------------------------------------------------ */
/* ------------------------------------------------------------
   TWEAK — TikTok Display API integration
   OAuth and access tokens are handled by Supabase Edge Functions.
------------------------------------------------------------ */
let tweakTikTokReturnHandled = false;

function renderTweak() {
  const host = $('#tweak-body');
  if (!host) return;

  host.innerHTML = `
    <section class="tweak-welcome">
      <div class="tweak-eyebrow"><span>✦</span> YOUR PERSONAL VIDEO SPACE</div>
      <h2>Your videos. Your <em>space.</em></h2>
      <p>Pulse brings eligible videos from creators who connect TikTok, while likes, comments, follows, connections and messages stay native to Tweaklr.</p>
      <div class="tweak-source-card">
        <div class="tweak-source-icon">♪</div>
        <div class="tweak-source-copy"><b>Connect TikTok</b><span>Securely link your TikTok account to bring your public videos into Pulse.</span></div>
        <button type="button" class="tweak-connect-btn" data-action="tweak-connect">Connect</button>
      </div>
      <p id="tweak-account-status" class="tweak-account-status" aria-live="polite">Checking TikTok connection…</p>
      <section class="tweak-video-section">
        <div class="tweak-feed-head">
          <div><div class="tweak-eyebrow">FROM YOUR CONNECTED ACCOUNT</div><h2>Your TikTok videos</h2></div>
          <button type="button" class="tweak-outline-btn" data-action="tweak-refresh">Refresh</button>
        </div>
        <div id="tweak-video-feed" class="tweak-video-feed" aria-live="polite">
          <div class="tweak-video-message">Your connected videos will appear here.</div>
        </div>
      </section>
      <p class="tweak-privacy-note">TikTok access tokens stay on the server. Tweaklr social actions are separate from TikTok likes, comments and follows.</p>
    </section>`;

  handleTweakTikTokReturn();
  loadTweakTikTokData();
}

function handleTweakTikTokReturn() {
  if (tweakTikTokReturnHandled) return;
  const url = new URL(window.location.href);
  const status = url.searchParams.get('tiktok');
  if (!status) return;
  tweakTikTokReturnHandled = true;
  const reason = url.searchParams.get('reason') || '';
  url.searchParams.delete('tiktok');
  url.searchParams.delete('reason');
  history.replaceState({}, document.title, url.pathname + url.search + url.hash);

  if (status === 'connected') {
    toast('TikTok connected successfully.', 'success');
  } else {
    const messages = {
      authorization_denied: 'TikTok connection was cancelled.',
      invalid_callback: 'TikTok returned an incomplete connection response.',
      server_not_configured: 'TikTok integration still needs server configuration.',
      invalid_or_expired_state: 'That TikTok connection request expired. Please try again.',
      token_exchange_failed: 'TikTok could not complete authorization. Please try again.',
      profile_retrieval_failed: 'TikTok profile details could not be retrieved.',
      connection_save_failed: 'TikTok connected, but Tweaklr could not save the connection.',
      callback_failed: 'TikTok connection failed. Please try again.'
    };
    toast(messages[reason] || 'TikTok connection failed. Please try again.', 'alert');
  }
}

function safeTweakTikTokUrl(value) {
  if (!value || typeof value !== 'string') return '';
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const allowed = url.protocol === 'https:' &&
      ((host === 'tiktok.com' || host.endsWith('.tiktok.com')) ||
       /(^|\.)tiktokcdn[^.]*\.com$/i.test(host));
    return allowed ? url.href : '';
  } catch (_) {
    return '';
  }
}

async function loadTweakTikTokData(showToast = false) {
  const statusEl = $('#tweak-account-status');
  const feedEl = $('#tweak-video-feed');
  if (!statusEl || !feedEl) return;

  statusEl.textContent = 'Checking TikTok connection…';
  try {
    const { data, error } = await supabaseClient.functions.invoke('tweak-tiktok-videos', { body: {} });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);

    if (!data?.connected) {
      statusEl.textContent = 'TikTok is not connected to this Tweaklr account yet.';
      feedEl.innerHTML = '<div class="tweak-video-message">Connect TikTok to import your public videos. Each creator must authorize their own account.</div>';
      return;
    }

    const displayName = data.profile?.display_name || 'your TikTok account';
    statusEl.textContent = 'Connected as ' + displayName + '.';
    const connectButton = $('#screen-tweak [data-action="tweak-connect"]');
    if (connectButton) connectButton.textContent = 'Reconnect';

    const videos = Array.isArray(data.videos) ? data.videos : [];
    if (!videos.length) {
      feedEl.innerHTML = '<div class="tweak-video-message">Your TikTok account is connected, but no public videos were returned by TikTok.</div>';
      return;
    }

    feedEl.innerHTML = videos.map(video => {
      const title = esc(video.title || video.video_description || 'TikTok video');
      const description = esc(video.video_description || '');
      const embed = safeTweakTikTokUrl(video.embed_link);
      const cover = safeTweakTikTokUrl(video.cover_image_url);
      const share = safeTweakTikTokUrl(video.share_url);
      const media = embed
        ? '<iframe class="tweak-video-embed" src="' + esc(embed) + '" title="' + title + '" loading="lazy" allow="fullscreen; encrypted-media; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>'
        : (cover ? '<a class="tweak-video-cover" href="' + esc(share || cover) + '" target="_blank" rel="noopener noreferrer"><img src="' + esc(cover) + '" alt="' + title + '" loading="lazy"></a>' : '');
      return '<article class="tweak-video-card">' + media +
        '<div class="tweak-video-copy"><b>' + title + '</b>' +
        (description && description !== title ? '<p>' + description + '</p>' : '') +
        (share ? '<a href="' + esc(share) + '" target="_blank" rel="noopener noreferrer">Open on TikTok ↗</a>' : '') +
        '</div></article>';
    }).join('');
    if (showToast) toast('TikTok videos refreshed.', 'success');
  } catch (error) {
    console.warn('Tweaklr: TikTok videos could not be loaded.', error);
    statusEl.textContent = 'TikTok videos could not be loaded right now.';
    feedEl.innerHTML = '<div class="tweak-video-message">Make sure you are signed in to Tweaklr and that the TikTok integration has been configured on the server.</div>';
    if (showToast) toast('Could not refresh TikTok videos. Check the connection and try again.', 'alert');
  }
}

async function beginTweakSetup() {
  try {
    const { data, error } = await supabaseClient.functions.invoke('tweak-tiktok-auth-start', { body: {} });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    if (!data?.authorization_url) throw new Error('TikTok authorization URL was not returned.');
    window.location.assign(data.authorization_url);
  } catch (error) {
    console.warn('Tweaklr: TikTok connection could not start.', error);
    const message = error?.message || 'TikTok connection could not start.';
    toast(message.length < 150 ? message : 'TikTok connection could not start. Check the server configuration.', 'alert');
  }
}

/* ------------------------------------------------------------
   NAVIGATION
------------------------------------------------------------ */
const nav = $('#nav');
const fab = $('#fab');

function setTab(tab, opts = {}) {
  if (state.stack.length) closeAllStacks();
  state.tab = tab;
  $$('.screen[data-tab]').forEach(s => s.classList.toggle('is-active', s.dataset.tab === tab));
  $$('#nav button').forEach(b => {
    const on = b.dataset.nav === tab;
    b.classList.toggle('is-on', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  fab.classList.toggle('hidden', tab === 'moonflower' || tab === 'profile' || tab === 'tweak');
  const scroller = $(`#screen-${tab} .scroll`);
  if (scroller && !opts.keepScroll) scroller.scrollTop = 0;
  ensureLoaded(tab);
}

async function refreshMingCurrentUserProfile() {
  try {
    const {
      data: { session },
      error: sessionError
    } = await supabaseClient.auth.getSession();

    if (sessionError || !session?.user) return;

    const { data: profile, error } = await supabaseClient
      .from('profiles')
      .select('id, username, display_name, avatar_url, bio, headline, interests, tags, activity, discoverable, created_at, updated_at')
      .eq('id', session.user.id)
      .maybeSingle();

    if (error || !profile) {
      console.warn('Tweaklr: could not refresh current profile.', error?.message || 'Profile not found.');
      return;
    }

    currentUser.id = profile.id;
    currentUser.name = profile.display_name || session.user.user_metadata?.display_name || currentUser.name;
    currentUser.avatarUrl = profile.avatar_url || '';
    currentUser.username = profile.username ? '@' + profile.username.replace(/^@/, '') : currentUser.username;
    currentUser.bio = profile.bio || '';
    currentUser.headline = profile.headline || '';
    currentUser.interests = Array.isArray(profile.interests) ? profile.interests : [];
    currentUser.tags = Array.isArray(profile.tags) ? profile.tags : [];
    currentUser.activity = profile.activity || '';
    currentUser.discoverable = profile.discoverable !== false;
    currentUser.email = session.user.email || '';
    currentUser.emailConfirmed = !!session.user.email_confirmed_at;
    currentUser.joined = profile.created_at
      ? 'Joined ' + new Date(profile.created_at).toLocaleDateString([], { month: 'long', year: 'numeric' })
      : '';

    if (state.loaded.profile) renderProfile();
  } catch (error) {
    console.warn('Tweaklr: current profile refresh failed.', error);
  }
}

function ensureLoaded(tab) {
  if (tab === 'home' && !state.loaded.home) return loadHome();
  if (tab === 'discover' && !state.loaded.discover) return loadDiscover();
  if (tab === 'nearby' && !state.loaded.nearby) return loadNearby();
  if (tab === 'tweak') renderTweak();
  if (tab === 'profile') {
    if (!state.loaded.profile) {
      state.loaded.profile = true;
      renderProfile();
    }
    refreshMingCurrentUserProfile();
  }
  if (tab === 'moonflower') renderMoonflower();
}

function pushStack(id) {
  const scr = document.getElementById('screen-' + id);
  if (!scr) return;
  if (!state.stack.includes(id)) state.stack.push(id);
  scr.classList.add('is-active');
  nav.classList.toggle('hidden', !scr.classList.contains('has-nav'));
  fab.classList.add('hidden');
  const sc = scr.querySelector('.scroll');
  if (sc) sc.scrollTop = 0;
}
function popStack() {
  const id = state.stack.pop();
  if (id === 'chat') stopMingChatRealtime();
  if (id) document.getElementById('screen-' + id).classList.remove('is-active');
  const top = state.stack[state.stack.length - 1];
  const topScreen = top ? document.getElementById('screen-' + top) : null;
  nav.classList.toggle('hidden', !!topScreen && !topScreen.classList.contains('has-nav'));
  fab.classList.toggle('hidden', !!top || state.tab === 'moonflower' || state.tab === 'profile');
}
function closeAllStacks() {
  while (state.stack.length) popStack();
}

/* Scroll-aware top bars */
$$('.scroll[data-scroll]').forEach(sc => {
  sc.addEventListener('scroll', () => {
    const bar = sc.parentElement.querySelector('.topbar');
    if (bar) bar.classList.toggle('is-scrolled', sc.scrollTop > 6);
  }, { passive: true });
});

/* ------------------------------------------------------------
   LOCATION
   Device-derived only. There is no manual location input anywhere
   in this app: the user can allow or deny, nothing else.
   state.userLocation holds the exact fix and is used internally
   for distance maths. It is never rendered into the DOM.
------------------------------------------------------------ */
/* 
   Location is intentionally acquired in two stages:
   1) Fast/network-assisted fix first, so mobile users get into Tweaklr quickly.
   2) High-accuracy watch continues in the background and quietly improves the fix.
   This avoids making the first screen wait for a cold GPS lock.
*/
const GEO_FAST_OPTS = {
  enableHighAccuracy: false,
  maximumAge: 120000,
  timeout: 5000
};
const GEO_PRECISE_OPTS = {
  enableHighAccuracy: true,
  maximumAge: 0,
  timeout: 10000
};
const GEO_OPTS = GEO_PRECISE_OPTS;
const EARTH_R = 6371;                 // km
const REFRESH_MOVE_M = 10;            // update the local UI after 10m movement
const LOCATION_REPUBLISH_MIN_MS = 15000; // do not write location more than once per 15s
let mingLastPublishedAt = 0;

function haversineKm(a, b) {
  const rad = d => d * Math.PI / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(s));
}
/* metres east/north -> absolute coordinates, used to place demo peers
   relative to the real device fix. Replace with rows from the backend. */
function offsetToCoords(origin, off) {
  const dLat = (off.n / 1000) / 110.574;
  const dLng = (off.e / 1000) / (111.320 * Math.cos(origin.latitude * Math.PI / 180) || 1);
  return { latitude: origin.latitude + dLat, longitude: origin.longitude + dLng };
}

function hasLocation() { return state.locStatus === 'granted' && !!state.userLocation; }

/* Public-facing label. Coarse by design — never a coordinate. */
function areaLabel() {
  return state.geo.locality || (hasLocation() ? 'Your area' : 'Location off');
}

function locationLine() {
  switch (state.locStatus) {
    case 'granted': return {
      title: 'Location enabled',
      sub: state.geo.locality ? `${state.geo.locality} · from your device` : 'GPS fix acquired · finding your area…'
    };
    case 'requesting': return { title: 'Getting your location…', sub: 'Your device is finding a fix' };
    case 'denied': return { title: 'Location is off', sub: 'Turn on location access to discover people nearby' };
    case 'unavailable': return { title: 'Location unavailable', sub: 'Your device could not provide a position' };
    case 'timeout': return { title: 'Location timed out', sub: 'Move somewhere with a clearer signal and try again' };
    default: return { title: 'Location is off', sub: 'Turn on location access to discover people nearby' };
  }
}

/* --- permission bootstrap: re-acquire silently if already granted --- */
async function initLocation() {
  if (!('geolocation' in navigator)) {
    state.locStatus = 'unavailable';
    refreshLocationUI();
    return;
  }
  if (navigator.permissions && navigator.permissions.query) {
    try {
      const st = await navigator.permissions.query({ name: 'geolocation' });
      applyPermissionState(st.state);
      st.onchange = () => applyPermissionState(st.state);
      return;
    } catch (_) { /* fall through */ }
  }
  refreshLocationUI();
}

function applyPermissionState(perm) {
  if (perm === 'granted') { requestLocation(); }
  else if (perm === 'denied') { state.locStatus = 'denied'; stopWatching(); refreshLocationUI(); }
  else { state.locStatus = 'unknown'; refreshLocationUI(); }
}

function requestLocation(then) {
  if (!('geolocation' in navigator)) {
    state.locStatus = 'unavailable';
    toast('This device cannot provide a location', 'x');
    refreshLocationUI();
    if (then) then();
    return;
  }

  state.locStatus = 'requesting';
  refreshLocationUI();

  /*
     First ask for the quickest usable position. On phones this can come
     from a recent/cached network-assisted location instead of waiting for
     a fresh GPS lock. As soon as it arrives, Tweaklr can calculate distance,
     publish the discovery location and render Nearby.
  */
  navigator.geolocation.getCurrentPosition(
    pos => {
      acceptFix(pos, true);
      if (then) then();
    },
    fastErr => {
      /*
         A fast request is allowed to fail without turning location off.
         Fall back to a fresh high-accuracy request before reporting an
         actual location failure to the user.
      */
      navigator.geolocation.getCurrentPosition(
        pos => {
          acceptFix(pos, true);
          if (then) then();
        },
        err => {
          handleGeoError(err);
          if (then) then();
        },
        GEO_PRECISE_OPTS
      );
    },
    GEO_FAST_OPTS
  );
}

/* 
   Keep the fix current after the fast first fix. The browser/device can
   improve accuracy in the background without blocking the initial UI.
*/
function startWatching() {
  if (state.geoWatchId !== null || !('geolocation' in navigator)) return;
  state.geoWatchId = navigator.geolocation.watchPosition(
    pos => acceptFix(pos, false),
    err => {
      /*
         A watch timeout/unavailable event should not erase a location
         that was already acquired successfully. The next watch update
         can recover automatically.
      */
      if (err && err.code === 1) handleGeoError(err);
    },
    GEO_PRECISE_OPTS
  );
}
function stopWatching() {
  if (state.geoWatchId === null) return;
  navigator.geolocation.clearWatch(state.geoWatchId);
  state.geoWatchId = null;
}

function acceptFix(pos, announce) {
  const c = pos.coords;
  const prev = state.userLocation;

  state.userLocation = {
    latitude: c.latitude,
    longitude: c.longitude,
    accuracy: c.accuracy,
    altitude: c.altitude,
    altitudeAccuracy: c.altitudeAccuracy,
    heading: c.heading,
    speed: c.speed,
    timestamp: pos.timestamp
  };

  state.locStatus = 'granted';

  /*
     Do not wait for reverse geocoding or the Supabase discovery write
     before updating the interface. The first valid coordinate is enough
     to start nearby-distance calculations immediately.
  */
  applyGeoToPeers();
  refreshLocationUI();
  startWatching();

  const movedM = prev ? haversineKm(prev, state.userLocation) * 1000 : Infinity;
  const publishDue = (now() - mingLastPublishedAt) >= LOCATION_REPUBLISH_MIN_MS;

  if (announce || movedM >= REFRESH_MOVE_M) {
    if (announce || publishDue || movedM >= REFRESH_MOVE_M) {
      /*
         Publishing and discovery loading happen in the background.
         The UI is already usable while these network calls complete.
      */
      publishMingApproxLocation().then(() => {
        return loadMingDiscoverableProfiles(state.loaded.nearby ? state.radius : null);
      }).then(() => {
        refreshLocationUI();
      }).catch(() => {
        /* Keep the local GPS fix even if the backend is temporarily slow. */
      });
    }

    /*
       Reverse geocoding is deliberately non-blocking. The UI initially
       uses "Your area", then replaces it with the readable locality when
       the geocoder responds.
    */
    resolveArea();
  }

  if (announce) {
    toast('Location on — your coordinates stay on your device', 'shield');
  }
}

function handleGeoError(err) {
  if (err.code === 1) { state.locStatus = 'denied'; stopWatching(); }
  else if (err.code === 3) state.locStatus = 'timeout';
  else state.locStatus = 'unavailable';
  state.userLocation = null;
  state.geo = { locality: '', district: '', city: '', region: '', country: '', postcode: '' };
  toast(locationLine().title, 'pin');
  refreshLocationUI();
}

/* --- reverse geocoding: readable place names are DERIVED from the fix --- */
async function resolveArea() {
  if (!hasLocation()) return;
  const { latitude, longitude } = state.userLocation;
  const stamp = state.userLocation.timestamp;
  try {
    const ctrl = new AbortController();
    const kill = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&lat=${latitude}&lon=${longitude}`,
      { signal: ctrl.signal, headers: { 'Accept': 'application/json' } }
    );
    clearTimeout(kill);
    if (!res.ok) throw new Error('geocoder ' + res.status);
    const d = await res.json();
    if (state.userLocation && state.userLocation.timestamp !== stamp) return; // stale
    const a = d.address || {};
    state.geo = {
      locality: a.neighbourhood || a.suburb || a.city_district || a.town || a.village || a.city || a.county || 'Your area',
      district: a.city_district || a.suburb || '',
      city: a.city || a.town || a.village || a.county || '',
      region: a.state || '',
      country: a.country || '',
      postcode: a.postcode || ''
    };
  } catch (_) {
    // Offline or geocoder unavailable: fall back to a generic label.
    state.geo = { locality: 'Your area', district: '', city: '', region: '', country: '', postcode: '' };
  }
  refreshLocationUI();
}

/* --- proximity: every distance comes from coordinates --- */
function applyGeoToPeers() {
  if (!hasLocation()) {
    people.forEach(p => { p.coords = null; p.km = null; });
    return;
  }
  const me = state.userLocation;
  people.forEach(p => {
    if (!p.off) return;
    p.coords = offsetToCoords(me, p.off);
    p.km = haversineKm(me, p.coords);
  });
}

function refreshLocationUI() {
  applyGeoToPeers();
  renderHomeLocation();
  const sub = $('#discover-sub');
  if (sub) sub.textContent = hasLocation() ? `Around ${areaLabel()}` : 'Location off · distances hidden';
  if (state.loaded.home) { renderHomePeople(); renderHomeFeed(); renderHomeOpps(); }
  if (state.loaded.discover) { loadMingDiscoverableProfiles().then(() => loadMingDiscoverContent()).then(() => renderDiscover()); }
  if (state.loaded.nearby) loadMingDiscoverableProfiles(state.radius).then(() => renderNearby());
  if (state.loaded.profile) renderProfile();
}

/* ------------------------------------------------------------
   REAL DAILY UPDATES — SUPABASE
------------------------------------------------------------ */
async function loadMingDailyUpdates() {
  try {
    const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession();
    if (sessionError || !session?.user) return false;

    const { data: rows, error } = await supabaseClient
      .rpc('get_daily_updates', { p_limit: 30 });

    if (error) {
      console.warn('Tweaklr: Daily Updates backend could not be loaded.', error.message);
      dailyUpdates = [];
      return false;
    }

    dailyUpdates = await Promise.all((rows || []).map(async row => {
      const name = row.author_display_name || 'Tweaklr user';
      const profile = {
        id: row.author_id,
        name,
        short: name.split(' ')[0] || name,
        hue: 24,
        tag: row.author_headline || 'Tweaklr member',
        interests: [],
        bio: row.author_bio || '',
        avatarUrl: row.author_avatar_url || '',
        username: row.author_username ? '@' + row.author_username.replace(/^@/, '') : '',
        activity: row.author_activity || '',
        status: 'on',
        visitor: false,
        km: null
      };

      if (row.author_id !== currentUser.id) {
        const existing = mingConnectionProfiles.get(row.author_id);
        mingConnectionProfiles.set(row.author_id, { ...(existing || {}), ...profile });
      }

      const media = Array.isArray(row.media) ? row.media : [];
      const resolvedMedia = await Promise.all(media.map(async item => {
        const path = typeof item === 'string' ? item : item?.path;
        if (!path) return null;
        try {
          const { data: signed, error: signedError } = await supabaseClient.storage.from('ming-post-media').createSignedUrl(path, 3600);
          if (signedError || !signed?.signedUrl) return null;
          return { path, url: signed.signedUrl, name: typeof item === 'string' ? path.split('/').pop() : (item?.name || path.split('/').pop()), mime: typeof item === 'string' ? '' : (item?.mime || '') };
        } catch (_) { return null; }
      }));
      return {
        id: row.id,
        authorId: row.author_id,
        kind: row.kind,
        title: row.title,
        body: row.body,
        media: resolvedMedia.filter(Boolean),
        createdAt: new Date(row.created_at).getTime(),
        likes: Number(row.likes || 0),
        liked: !!row.liked,
        comments: [],
        commentsCount: Number(row.comments_count || 0)
      };
    }));

    return true;
  } catch (error) {
    console.warn('Tweaklr: Daily Updates load failed.', error);
    dailyUpdates = [];
    return false;
  }
}

async function loadMingDailyUpdateComments(updateId) {
  const { data: rows, error } = await supabaseClient
    .rpc('get_daily_update_comments', { p_update_id: updateId });

  if (error) {
    console.warn('Tweaklr: Daily Update comments could not be loaded.', error.message);
    return null;
  }

  const comments = (rows || []).map(row => {
    const name = row.author_display_name || 'Tweaklr user';
    const profile = {
      id: row.author_id,
      name,
      short: name.split(' ')[0] || name,
      hue: 24,
      tag: 'Tweaklr member',
      interests: [],
      bio: '',
      avatarUrl: row.author_avatar_url || '',
      username: row.author_username ? '@' + row.author_username.replace(/^@/, '') : '',
      activity: '',
      status: 'on',
      visitor: false,
      km: null
    };

    if (row.author_id !== currentUser.id) {
      const existing = mingConnectionProfiles.get(row.author_id);
      mingConnectionProfiles.set(row.author_id, { ...(existing || {}), ...profile });
    }

    return {
      id: row.id,
      authorId: row.author_id,
      text: row.body,
      at: new Date(row.created_at).getTime()
    };
  });

  return comments;
}

/* ------------------------------------------------------------
   HOME
------------------------------------------------------------ */
async function loadHome() {
  state.loaded.home = true;
  $('#home-people').innerHTML = sectionHead('People nearby', 'Approximate') + skeletonRail();
  $('#home-feed').innerHTML = sectionHead('Daily Updates', 'Gone in 24 hours') + skeletonCards(2);
  $('#home-opps').innerHTML = sectionHead('Possibilities near you', 'From Daily Updates') + skeletonRail();
  renderHomeLocation();
  await loadMingDailyUpdates();
  renderHome();
}

function renderHome() {
  $('#greeting').textContent = `${greetWord()}, ${currentUser.name.split(' ')[0]}`;
  $('#home-avatar').innerHTML = avatar(currentUser, 44);
  renderHomeLocation();
  renderHomePeople();
  renderHomeSpaces();
  renderHomeFeed();
  renderHomeOpps();
  updateNotifDot();
}

function renderHomeLocation() {
  const host = $('#home-loc');
  if (!host) return;
  const l = locationLine();
  const on = state.locStatus === 'granted';
  host.innerHTML = `<div class="locbar">
    ${on ? '<span class="pulse-dot"></span>' : icon('pin')}
    <span class="txt"><b>${esc(l.title)}</b> <span>· ${esc(l.sub)}</span></span>
    ${on ? '' : `<button data-action="enable-location">${state.locStatus === 'requesting' ? 'Finding…' : 'Turn on'}</button>`}
  </div>`;
}

function renderHomePeople() {
  const host = $('#home-people');
  if (!host) return;

  if (!hasLocation()) {
    host.innerHTML = sectionHead('People nearby') +
      emptyState(locationLine().title, 'Tweaklr finds people using your device location. Turn on location access to see who is around you.',
        state.locStatus === 'denied' ? null : { t: 'Turn on location', a: 'enable-location' });
    return;
  }

  const near = mingDiscoverPeople
    .filter(p => p.km != null && p.km <= 15)
    .sort((a, b) => a.km - b.km);

  host.innerHTML = sectionHead('People nearby', null, { t: 'See all', a: 'go-nearby' }) +
    (near.length
      ? `<div class="rail">${near.map(p => `
        <button class="pcard" data-action="person:${p.id}">
          ${ringAvatar(p, 56, isMingUserOnline(p.id))}
          <div class="name">${esc(p.short)}</div>
          <div class="tag">${esc(p.tag.split(' · ')[0])}</div>
          <div class="dist">${esc(distLabel(p.km))}</div>
        </button>`).join('')}</div>`
      : emptyState('No people nearby yet', 'No other discoverable Tweaklr members with a fresh location are within 15 km right now.'));
}

function renderHomeFeed() {
  const list = liveUpdates().slice(0, 6);
  $('#home-feed').innerHTML = sectionHead('Daily Updates', 'Gone in 24 hours') +
    (list.length ? list.map(updateCard).join('') :
      emptyState('Nothing shared yet today', 'Daily Updates disappear after 24 hours. Be the first to say what you are up to.', { t: 'Share an update', a: 'create:update' }));
}

function renderHomeOpps() {
  const possibilityKinds = new Set(['service', 'hiring', 'sale', 'talk', 'visitor', 'activity']);
  const list = liveUpdates().filter(u => possibilityKinds.has(u.kind)).slice(0, 6);

  $('#home-opps').innerHTML = sectionHead('Possibilities near you', 'From Daily Updates') +
    (list.length
      ? `<div class="rail">${list.map(u => {
          const p = u.authorId === currentUser.id ? currentUser : byId(u.authorId);
          const kind = KINDS[u.kind] || KINDS.general;
          return `<button class="ocard" data-action="person:${u.authorId}">
            <div class="k">${esc(kind.label)}</div>
            <h3>${esc(u.title)}</h3>
            <p>${esc(u.body)}</p>
            <div class="f">${avatar(p, 28, { status: false })}<span>${esc(p.short || p.name)} · ${esc(hasLocation() && p.km != null ? distLabel(p.km) : 'Distance unavailable')}</span></div>
          </button>`;
        }).join('')}</div>`
      : emptyState('No possibilities yet', 'When people nearby share a service, opportunity, activity, sale or request, it will appear here.'));
}

/* ------------------------------------------------------------
   DAILY UPDATES
------------------------------------------------------------ */
function liveUpdates() {
  return dailyUpdates.filter(u => hoursLeft(u) > 0).sort((a, b) => b.createdAt - a.createdAt);
}

function renderDailyUpdateMedia(u) {
  const media = Array.isArray(u.media) ? u.media.filter(m => m?.url) : [];
  if (!media.length) return '';

  if (media.length === 1) {
    const m = media[0];
    return `<div class="upd-media upd-media--single">
      ${m.mime.startsWith('video/')
        ? `<video src="${esc(m.url)}" controls playsinline preload="none" aria-label="Post video"></video>`
        : `<a href="${esc(m.url)}" target="_blank" rel="noopener noreferrer" aria-label="View image"><img src="${esc(m.url)}" alt="${esc(m.name || 'Post image')}" loading="lazy" /></a>`}
    </div>`;
  }

  return `<div class="upd-media upd-media--collage upd-media--count-${media.length}" aria-label="${media.length} attached photos or videos">
    ${media.map((m, index) => `
      <button type="button" class="upd-media__tile" data-action="open-update-media:${esc(u.id)}:${index}" aria-label="Open ${m.mime.startsWith('video/') ? 'video' : 'photo'} ${index + 1}">
        ${m.mime.startsWith('video/')
          ? `<video src="${esc(m.url)}" muted playsinline preload="metadata" aria-hidden="true"></video>`
          : `<img src="${esc(m.url)}" alt="${esc(m.name || 'Post image')}" loading="lazy" />`}
      </button>`).join('')}
  </div>`;
}

function openDailyUpdateMedia(id, index) {
  const u = dailyUpdates.find(x => x.id === id);
  const media = Array.isArray(u?.media) ? u.media.filter(m => m?.url) : [];
  if (!media.length) return;

  let currentIndex = Math.max(0, Math.min(Number(index) || 0, media.length - 1));

  const renderViewer = () => {
    const item = media[currentIndex];
    if (!item) return;

    const position = media.length > 1 ? ` · ${currentIndex + 1} of ${media.length}` : '';
    $('#sheet-head').innerHTML = `<h2>Post media</h2><p>${esc((item.mime.startsWith('video/') ? 'Video' : 'Photo') + position)}</p>`;
    $('#sheet-body').innerHTML = item.mime.startsWith('video/')
      ? `<div class="upd-media-viewer" data-swipe-media><video src="${esc(item.url)}" controls autoplay playsinline preload="metadata"></video></div>`
      : `<div class="upd-media-viewer" data-swipe-media><img src="${esc(item.url)}" alt="${esc(item.name || 'Post image')}" /></div>`;

    const viewer = $('#sheet-body .upd-media-viewer');
    if (!viewer || media.length < 2) return;

    let startX = 0;
    let startY = 0;
    let tracking = false;

    viewer.addEventListener('touchstart', e => {
      if (!e.touches?.length) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      tracking = true;
    }, { passive: true });

    viewer.addEventListener('touchend', e => {
      if (!tracking || !e.changedTouches?.length) return;
      tracking = false;

      const endX = e.changedTouches[0].clientX;
      const endY = e.changedTouches[0].clientY;
      const dx = endX - startX;
      const dy = endY - startY;

      if (Math.abs(dx) < 55 || Math.abs(dx) <= Math.abs(dy)) return;

      const nextIndex = dx < 0
        ? Math.min(currentIndex + 1, media.length - 1)
        : Math.max(currentIndex - 1, 0);

      if (nextIndex !== currentIndex) {
        currentIndex = nextIndex;
        renderViewer();
      }
    }, { passive: true });
  };

  openSheet({
    title: 'Post media',
    sub: '',
    body: ''
  });

  renderViewer();
}

function updateCard(u) {
  const p = u.authorId === currentUser.id ? currentUser : byId(u.authorId);
  const h = hoursLeft(u);
  const pct = Math.max(2, Math.round((h / 24) * 100));
  const mine = u.authorId === currentUser.id;
  return `<article class="upd" id="upd-${u.id}">
    <div class="upd-top">
      ${avatar(p, 36)}
      <div class="who">
        <div class="n">${esc(p.short || p.name)}</div>
        <div class="m">${esc(mine ? 'You' : distLabel(p.km))} · ${esc(timeAgo(u.createdAt))}</div>
      </div>
      ${kindPill(u.kind)}
    </div>
    <h3>${esc(u.title)}</h3>
    <p>${esc(u.body)}</p>
    ${renderDailyUpdateMedia(u)}
    <div class="upd-foot">
      <button class="act ${u.liked ? 'is-on' : ''}" data-action="like:${u.id}" aria-pressed="${u.liked}" aria-label="React to this update">
        ${icon('heart')}<span>${u.likes}</span>
      </button>
      <button class="act" data-action="comments:${u.id}" aria-label="Open replies">
        ${icon('chat')}<span>${u.commentsCount ?? u.comments.length}</span>
      </button>
      <button class="act" data-action="share-update:${u.id}" aria-label="Share this update">
        <span aria-hidden="true">↗</span><span>Share</span>
      </button>
      ${mine ? `<button class="act" data-action="delete-update:${u.id}" aria-label="Delete update">${icon('trash')}</button>` : ''}
      <span class="expiry"><span class="life ${h < 4 ? 'low' : ''}"><i style="width:${pct}%"></i></span>${esc(lifeLabel(u))}</span>
    </div>
  </article>`;
}

async function getDailyUpdateShareData(id) {
  const u = dailyUpdates.find(x => x.id === id);
  if (!u) return null;

  const p = u.authorId === currentUser.id ? currentUser : byId(u.authorId);
  const title = u.title || 'Tweaklr Daily Update';
  const text = [p?.name ? p.name + ': ' + title : title, u.body || ''].filter(Boolean).join(' — ');
  const url = new URL(window.location.href);
  url.hash = '';
  url.searchParams.set('update', id);

  return { u, p, title, text, url: url.toString() };
}

async function getDailyUpdateMediaFiles(data) {
  const media = Array.isArray(data?.u?.media) ? data.u.media : [];
  const files = [];

  for (let index = 0; index < media.length; index++) {
    const item = media[index];
    if (!item?.url) continue;

    try {
      const response = await fetch(item.url);
      if (!response.ok) throw new Error('Media request failed');

      const blob = await response.blob();
      const type = item.mime || blob.type || 'application/octet-stream';
      const fallbackName = item.mime?.startsWith('video/')
        ? `ming-update-${data.u.id}-${index + 1}.mp4`
        : `ming-update-${data.u.id}-${index + 1}.jpg`;
      const name = (item.name || fallbackName)
        .replace(/[^a-zA-Z0-9._-]/g, '_');

      files.push(new File([blob], name || fallbackName, { type }));
    } catch (error) {
      console.warn('Tweaklr: Daily Update media fetch for sharing failed.', error);
    }
  }

  return files;
}

async function shareDailyUpdate(id) {
  const data = await getDailyUpdateShareData(id);
  if (!data) return;

  const connected = connections
    .filter(c => c.personId && isConnected(c.personId))
    .map(c => byId(c.personId))
    .filter(Boolean);

  openSheet({
    title: 'Share update',
    sub: 'Send the update text or its actual photo/video to a connection, another app, or save the media to your device.',
    body: `
      <div class="chat-action-grid" style="margin-bottom:12px">
        <button data-action="share-external:${esc(id)}"><span style="font-size:24px">↗</span><br>Other apps</button>
        <button data-action="download-update:${esc(id)}"><span style="font-size:24px">↓</span><br>Download</button>
      </div>
      <div class="section share-update-recipients" data-share-update-id="${esc(id)}" style="padding:0">
        <div class="section-head"><div><h2>Find a Tweaklr user</h2><p>Search by username to share with any member</p></div></div>
        <div class="field" style="padding:0 12px 10px">
          <input id="share-update-user-search" type="search" maxlength="40" placeholder="Search @username…" autocomplete="off" aria-label="Search Tweaklr users by username" />
        </div>
        <div id="share-update-search-results" aria-live="polite"><p class="center-note">Enter a username to find someone.</p></div>
        <div class="section-head" style="margin-top:12px"><div><h2>Your connections</h2><p>The update text or its media will be sent</p></div></div>
        ${connected.length ? connected.map(p => `
          <button class="opt" data-action="send-update:${esc(id)}:${esc(p.id)}">
            ${avatar(p, 42)}
            <span class="tx"><span class="t">${esc(p.short || p.name)}</span><span class="s">${esc(p.username || 'Connected')}</span></span>
            <span class="go">${icon('send')}</span>
          </button>`).join('') : '<p class="center-note">Your connections will appear here.</p>'}
      </div>`
  });
}

let shareUpdateSearchTimer = null;
let shareUpdateSearchRequest = 0;

function renderShareUpdateUserResults(host, profiles, updateId) {
  if (!host) return;
  if (!profiles.length) { host.innerHTML = '<p class="center-note">No matching Tweaklr users found.</p>'; return; }
  host.innerHTML = profiles.map(profile => {
    const p = { id: profile.id, name: profile.display_name || profile.username || 'Tweaklr user', short: profile.display_name || profile.username || 'Tweaklr user', username: profile.username ? '@' + profile.username.replace(/^@/, '') : '@user', avatarUrl: profile.avatar_url || '', hue: 26 };
    mingConnectionProfiles.set(profile.id, p);
    return '<button class="opt" data-action="send-update:' + esc(updateId) + ':' + esc(profile.id) + '">' + avatar(p, 42) + '<span class="tx"><span class="t">' + esc(p.short) + '</span><span class="s">' + esc(p.username) + '</span></span><span class="go">' + icon('send') + '</span></button>';
  }).join('');
}

async function searchShareUpdateUsers(query, updateId) {
  const host = document.getElementById('share-update-search-results');
  if (!host) return;
  const q = String(query || '').trim().replace(/^@+/, '').replace(/\s+/g, '');
  const requestId = ++shareUpdateSearchRequest;
  if (!q) { host.innerHTML = '<p class="center-note">Enter a username to find someone.</p>'; return; }
  if (q.length < 2) { host.innerHTML = '<p class="center-note">Type at least 2 characters.</p>'; return; }
  host.innerHTML = '<p class="center-note">Searching Tweaklr…</p>';
  try {
    const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession();
    if (sessionError || !session?.user) { if (requestId === shareUpdateSearchRequest) host.innerHTML = '<p class="center-note">Please sign in again to search users.</p>'; return; }
    const { data, error } = await supabaseClient.from('profiles').select('id, username, display_name, avatar_url').ilike('username', '%' + q + '%').neq('id', session.user.id).limit(12);
    if (requestId !== shareUpdateSearchRequest || !document.getElementById('share-update-search-results')) return;
    if (error) { console.warn('Tweaklr: share recipient search failed.', error.message); host.innerHTML = '<p class="center-note">Could not search users right now. Try again.</p>'; return; }
    renderShareUpdateUserResults(host, data || [], updateId);
  } catch (error) { if (requestId !== shareUpdateSearchRequest) return; console.warn('Tweaklr: share recipient search failed.', error); host.innerHTML = '<p class="center-note">Could not search users right now. Try again.</p>'; }
}

document.addEventListener('input', e => {
  if (e.target?.id !== 'share-update-user-search') return;
  const updateId = document.querySelector('.share-update-recipients')?.dataset.shareUpdateId || new URL(window.location.href).searchParams.get('update') || '';
  clearTimeout(shareUpdateSearchTimer);
  shareUpdateSearchTimer = setTimeout(() => searchShareUpdateUsers(e.target.value, updateId), 280);
});

async function shareDailyUpdateExternal(id) {
  const data = await getDailyUpdateShareData(id);
  if (!data) return;

  try {
    const files = await getDailyUpdateMediaFiles(data);

    if (files.length && navigator.share) {
      const shareData = {
        title: data.title,
        text: data.text
      };

      if (!navigator.canShare || navigator.canShare({ files })) {
        shareData.files = files;
        await navigator.share(shareData);
        closeSheet();
        return;
      }
    }

    if (files.length) {
      closeSheet();
      let completed = 0;

      for (const file of files) {
        const objectUrl = URL.createObjectURL(file);
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = file.name;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
        completed += 1;
        await sleep(180);
      }

      toast(completed === files.length ? 'Media ready to share' : 'Some media could not be shared.', completed ? 'check' : 'alert');
      return;
    }

    if (navigator.share) {
      await navigator.share({
        title: data.title,
        text: data.text,
        url: data.url
      });
      closeSheet();
      return;
    }

    await navigator.clipboard.writeText(data.url);
    closeSheet();
    toast('Update link copied', 'check');
  } catch (error) {
    if (error?.name === 'AbortError') return;

    try {
      const files = await getDailyUpdateMediaFiles(data);
      if (files.length) {
        closeSheet();

        for (const file of files) {
          const objectUrl = URL.createObjectURL(file);
          const link = document.createElement('a');
          link.href = objectUrl;
          link.download = file.name;
          document.body.appendChild(link);
          link.click();
          link.remove();
          setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
          await sleep(180);
        }

        toast('Media ready to share', 'check');
        return;
      }

      await navigator.clipboard.writeText(data.url);
      closeSheet();
      toast('Update link copied', 'check');
    } catch (_) {
      toast('Could not share this update.', 'alert');
    }
  }
}

async function sendDailyUpdateToConnection(updateId, personId) {
  const data = await getDailyUpdateShareData(updateId);
  if (!data || !isUuidPerson(personId) || personId === currentUser.id) {
    toast('Choose another Tweaklr user to share this update with.', 'alert');
    return;
  }

  const files = await getDailyUpdateMediaFiles(data);

  closeSheet();
  await openChat(personId);

  // Text-only Daily Updates should be shared as a normal chat message.
  // Preserve the existing actual-file flow whenever media is available.
  if (!files.length) {
    const message = [data.text, data.url].filter(Boolean).join('\n\n');
    if (message) await sendMessage(message, { replyToId: null });
    else toast('This update has no text to share.', 'alert');
    return;
  }

  let completed = 0;
  for (const file of files) {
    if (await sendStoredChatAttachment(file, { replyToId: null })) {
      completed += 1;
    }
  }

  if (completed) {
    toast(completed === files.length ? 'Media sent' : `${completed} media file(s) sent`, 'check');
  } else {
    toast('Could not send the media.', 'alert');
  }
}

async function downloadDailyUpdate(id) {
  const data = await getDailyUpdateShareData(id);
  if (!data) return;

  const media = Array.isArray(data.u.media) ? data.u.media : [];
  if (!media.length) {
    toast('This update has no photo or video to download.', 'alert');
    return;
  }

  closeSheet();
  let completed = 0;

  for (let index = 0; index < media.length; index++) {
    const item = media[index];
    if (!item?.url) continue;

    try {
      const response = await fetch(item.url);
      if (!response.ok) throw new Error('Media request failed');
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const extension = (item.name || '').includes('.')
        ? item.name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '')
        : (item.mime || '').split('/')[1]?.replace(/[^a-z0-9]/g, '') || 'bin';
      const safeName = (item.name || `ming-update-${data.u.id}-${index + 1}`)
        .replace(/[^a-zA-Z0-9._-]/g, '_');
      const filename = safeName.includes('.')
        ? safeName
        : `${safeName}.${extension || 'bin'}`;

      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
      completed += 1;
      await sleep(180);
    } catch (error) {
      console.warn('Tweaklr: Daily Update media download failed.', error);
    }
  }

  toast(completed ? (completed === media.length ? 'Media downloaded' : `${completed} media file(s) downloaded`) : 'Could not download the media.', completed ? 'check' : 'alert');
}

async function toggleLike(id) {
  const u = dailyUpdates.find(x => x.id === id);
  if (!u || !isUuidPerson(currentUser.id)) return;

  try {
    if (u.liked) {
      const { error } = await supabaseClient
        .from('daily_update_likes')
        .delete()
        .eq('update_id', id)
        .eq('user_id', currentUser.id);
      if (error) throw error;
      u.liked = false;
      u.likes = Math.max(0, u.likes - 1);
    } else {
      const { error } = await supabaseClient
        .from('daily_update_likes')
        .insert({ update_id: id, user_id: currentUser.id });
      if (error && !/duplicate|unique/i.test(error.message || '')) throw error;
      u.liked = true;
      if (!error) u.likes += 1;
    }

    $('[data-action="like:' + id + '"]').forEach(btn => {
      btn.classList.toggle('is-on', u.liked);
      btn.setAttribute('aria-pressed', String(u.liked));
      const count = btn.querySelector('span');
      if (count) count.textContent = u.likes;
      btn.classList.remove('bump');
      void btn.offsetWidth;
      btn.classList.add('bump');
    });
  } catch (error) {
    console.warn('Tweaklr: Daily Update like failed.', error.message);
  }
}

async function openComments(id) {
  const u = dailyUpdates.find(x => x.id === id);
  if (!u) return;

  const loadedComments = await loadMingDailyUpdateComments(id);
  if (loadedComments === null) {
    toast('Could not load replies.', 'alert');
    return;
  }

  u.comments = loadedComments;
  u.commentsCount = loadedComments.length;
  state.sheetCtx = { type: 'comments', id };

  const body = u.comments.length ? u.comments.map(c => {
    const p = c.authorId === currentUser.id ? currentUser : byId(c.authorId);
    return `<div style="display:flex;gap:11px;padding:11px 0;border-top:1px solid var(--border)">
      ${avatar(p, 36)}
      <div><div style="font-size:13.5px;font-weight:560">${esc(p.short || p.name)} <span style="color:var(--muted);font-weight:400">· ${esc(timeAgo(c.at))}</span></div>
      <div style="font-size:14px;margin-top:3px;line-height:1.45">${esc(c.text)}</div></div>
    </div>`;
  }).join('') : `<p style="padding:18px 0;color:var(--muted);font-size:13.5px;text-align:center">No replies yet. Say something useful.</p>`;

  openSheet({
    title: u.title,
    sub: `${u.commentsCount} ${u.commentsCount === 1 ? 'reply' : 'replies'} · ${lifeLabel(u)}`,
    body,
    foot: `<form id="comment-form" style="display:flex;gap:9px;align-items:flex-end">
      <textarea id="comment-input" rows="1" placeholder="Write a reply" aria-label="Write a reply"
        style="flex:1;min-height:44px;max-height:100px;padding:11px 15px;border-radius:22px;border:1px solid var(--border);background:var(--bg);font-size:15px;resize:none;outline:none"></textarea>
      <button class="send" type="submit" aria-label="Post reply">${icon('send')}</button>
    </form>`
  });

  $('#comment-form').addEventListener('submit', async e => {
    e.preventDefault();
    const inp = $('#comment-input');
    const text = inp.value.trim();
    if (!text) return;

    const { data: row, error } = await supabaseClient
      .from('daily_update_comments')
      .insert({
        update_id: id,
        author_id: currentUser.id,
        body: text
      })
      .select('id, created_at')
      .single();

    if (error) {
      console.warn('Tweaklr: Daily Update reply failed.', error.message);
      toast('Could not post reply.', 'alert');
      return;
    }

    u.comments.push({
      id: row.id,
      authorId: currentUser.id,
      text,
      at: new Date(row.created_at).getTime()
    });
    u.commentsCount = u.comments.length;
    inp.value = '';
    rerenderFeeds();
    openComments(id);
    toast('Reply posted', 'check');
  });
}

function deleteUpdate(id) {
  openModal({
    title: 'Delete this update?',
    lede: 'It would have disappeared on its own, but you can remove it now.',
    actions: [
      { t: 'Keep it', cls: 'btn--soft', a: 'close-modal' },
      { t: 'Delete', cls: 'btn--primary', a: 'confirm-delete:' + id }
    ]
  });
}

async function deleteMingDailyUpdate(id) {
  const { error } = await supabaseClient
    .from('daily_updates')
    .delete()
    .eq('id', id)
    .eq('author_id', currentUser.id);

  if (error) {
    console.warn('Tweaklr: Daily Update delete failed.', error.message);
    toast('Could not delete update.', 'alert');
    return false;
  }

  dailyUpdates = dailyUpdates.filter(u => u.id !== id);
  rerenderFeeds();
  if (state.loaded.profile) renderProfile();
  toast('Update deleted', 'trash');
  return true;
}

async function createUpdate(kind, title, body, activityMeta = null, mediaFiles = []) {
  if (!isUuidPerson(currentUser.id)) {
    toast('Please sign in again.', 'alert');
    return false;
  }

  const cleanTitle = String(title || '').trim();
  const cleanBody = String(body || '').trim();

  if (!cleanTitle) {
    toast('Add a title first.', 'alert');
    return false;
  }

  const insertRow = {
    author_id: currentUser.id,
    kind: KINDS[kind] ? kind : 'general',
    title: cleanTitle,
    body: cleanBody || 'No extra details.'
  };

  const files = Array.isArray(mediaFiles) ? mediaFiles.filter(Boolean) : [];
  if (files.length > 4) { toast('You can attach up to 4 photos or videos.', 'alert'); return false; }
  const uploadedMedia = [];
  for (const file of files) {
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    if (!isImage && !isVideo) { toast('Only photos and videos can be attached.', 'alert'); return false; }
    const maxBytes = isVideo ? 50 * 1024 * 1024 : 15 * 1024 * 1024;
    if (file.size > maxBytes) { toast(isVideo ? 'Videos must be 50 MB or smaller.' : 'Photos must be 15 MB or smaller.', 'alert'); return false; }
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 90) || (isVideo ? 'video' : 'photo');
    const path = currentUser.id + '/' + crypto.randomUUID() + '-' + safeName;
    const { error: uploadError } = await supabaseClient.storage.from('ming-post-media').upload(path, file, { contentType: file.type, cacheControl: '3600', upsert: false });
    if (uploadError) {
      if (uploadedMedia.length) await supabaseClient.storage.from('ming-post-media').remove(uploadedMedia.map(x => x.path)).catch(() => {});
      console.warn('Tweaklr: post media upload failed.', uploadError.message);
      toast('Could not upload the photo or video.', 'alert');
      return false;
    }
    uploadedMedia.push({ path, name: file.name, mime: file.type });
  }
  if (uploadedMedia.length) insertRow.media = uploadedMedia;

  if (kind === 'activity') {
    if (!activityMeta?.startsAt || !activityMeta?.place) {
      toast('Add a time and place for the activity.', 'alert');
      return false;
    }
    if (!Number.isFinite(Number(activityMeta.latitude)) || !Number.isFinite(Number(activityMeta.longitude))) {
      toast('Enable location before starting an activity.', 'pin');
      return false;
    }
    const startsAt = new Date(activityMeta.startsAt);
    if (Number.isNaN(startsAt.getTime()) || startsAt.getTime() <= Date.now()) {
      toast('Choose a future time for the activity.', 'clock');
      return false;
    }
    insertRow.activity_starts_at = startsAt.toISOString();
    insertRow.activity_place = String(activityMeta.place).trim();
    insertRow.activity_latitude = Number(activityMeta.latitude.toFixed(7));
    insertRow.activity_longitude = Number(activityMeta.longitude.toFixed(7));
  }

  const { data: row, error } = await supabaseClient
    .from('daily_updates')
    .insert(insertRow)
    .select('id, kind, title, body, media, created_at, activity_starts_at, activity_place')
    .single();

  if (error) {
    if (uploadedMedia.length) await supabaseClient.storage.from('ming-post-media').remove(uploadedMedia.map(x => x.path)).catch(() => {});
    console.warn('Tweaklr: Daily Update create failed.', error.message);
    toast('Could not share the update.', 'alert');
    return false;
  }

  const displayMedia = await Promise.all(uploadedMedia.map(async media => {
    try {
      const { data: signed, error: signedError } = await supabaseClient.storage
        .from('ming-post-media')
        .createSignedUrl(media.path, 3600);
      if (signedError || !signed?.signedUrl) return { ...media, url: '' };
      return { ...media, url: signed.signedUrl };
    } catch (_) {
      return { ...media, url: '' };
    }
  }));

  dailyUpdates.unshift({
    id: row.id,
    authorId: currentUser.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    media: displayMedia,
    createdAt: new Date(row.created_at).getTime(),
    likes: 0,
    liked: false,
    comments: [],
    commentsCount: 0,
    startsAt: row.activity_starts_at ? new Date(row.activity_starts_at).getTime() : null,
    place: row.activity_place || ''
  });

  rerenderFeeds();
  if (state.loaded.profile) renderProfile();
  return true;
}

function rerenderFeeds() {
  if (state.loaded.home) { renderHomeFeed(); }
  if (state.loaded.discover) { loadMingDiscoverContent().then(() => renderDiscover()); }
}

/* ------------------------------------------------------------
   DISCOVER
------------------------------------------------------------ */
const DISCOVER_FILTERS = [
  { k: 'all', t: 'Everything' },
  { k: 'people', t: 'People' },
  { k: 'moments', t: 'Moments' },
  { k: 'opps', t: 'Opportunities' },
  { k: 'activities', t: 'Activities' },
  { k: 'places', t: 'Places' },
  { k: 'visitors', t: 'Visitors' }
];

async function loadMingDiscoverableProfiles(radiusKm = null) {
  try {
    const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession();
    if (sessionError || !session?.user) return false;

    // Location is a hard requirement for geographic discoverability.
    // Never show a user in the Nearby/Discoverable list without a usable
    // distance. Interest discovery can be added separately without mixing
    // geographic and non-geographic results.
    if (!hasLocation()) {
      mingDiscoverPeople = [];
      return true;
    }

    const { data, error } = await supabaseClient.rpc('get_discoverable_profiles', { p_radius_km: radiusKm });
    if (error) { console.warn('Tweaklr: real-user discovery is not ready yet.', error.message); return false; }
    mingDiscoverPeople = (data || [])
      .filter(profile => profile.distance_km != null && Number.isFinite(Number(profile.distance_km)))
      .map(profile => {
      const name = profile.display_name || 'Tweaklr user';
      const tags = Array.isArray(profile.tags) ? profile.tags : [];
      const interests = Array.isArray(profile.interests) ? profile.interests : [];
      const seed = profile.id + ':' + name;
      let hue = 0;
      for (let i = 0; i < seed.length; i++) hue = (hue * 31 + seed.charCodeAt(i)) % 360;
      return {
        id: profile.id, name, short: name.split(' ')[0] || name, hue,
        tag: profile.headline || tags.slice(0, 3).join(' · ') || 'Tweaklr member',
        interests, bio: profile.bio || '', avatarUrl: profile.avatar_url || '',
        username: profile.username ? '@' + profile.username.replace(/^@/, '') : '',
        activity: profile.activity || 'Available on Tweaklr', status: 'on', visitor: false,
        km: profile.distance_km == null ? null : Number(profile.distance_km),
        bearingDeg: profile.bearing_deg == null ? null : Number(profile.bearing_deg), off: null
      };
    });
    mingDiscoverPeople.forEach(p => mingConnectionProfiles.set(p.id, p));
    return true;
  } catch (error) { console.warn('Tweaklr: real-user discovery failed.', error); return false; }
}

async function publishMingApproxLocation() {
  if (!hasLocation()) return false;
  const lat = Number(state.userLocation.latitude.toFixed(7));
  const lng = Number(state.userLocation.longitude.toFixed(7));
  const key = lat.toFixed(7) + ':' + lng.toFixed(7);
  if (key === mingLocationPublishKey) return true;
  try {
    const { error } = await supabaseClient.rpc('set_my_discovery_location', { p_latitude: lat, p_longitude: lng, p_accuracy_m: Number(state.userLocation.accuracy) });
    if (error) { console.warn('Tweaklr: approximate discovery location could not be published.', error.message); return false; }
    mingLocationPublishKey = key;
    mingLastPublishedAt = now();
    return true;
  } catch (error) { console.warn('Tweaklr: approximate discovery location failed.', error); return false; }
}

async function loadMingDiscoverContent() {
  discoverMoments = []; discoverOpportunities = []; discoverActivities = []; discoverVisitors = []; discoverPlaces = [];
  discoverActivityJoined.clear();
  try {
    const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession();
    if (sessionError || !session?.user) return false;
    const { data: rows, error } = await supabaseClient.rpc('get_daily_updates', { p_limit: 100 });
    if (error) console.warn('Tweaklr: Discover Daily Updates could not be loaded.', error.message);
    else {
      const updates = rows || [];
      const activityIds = updates.filter(r => r.kind === 'activity').map(r => r.id);
      updates.forEach(row => {
        const name = row.author_display_name || 'Tweaklr user';
        const seed = String(row.author_id || '') + ':' + name; let hue = 0;
        for (let i = 0; i < seed.length; i++) hue = (hue * 31 + seed.charCodeAt(i)) % 360;
        mingConnectionProfiles.set(row.author_id, { id: row.author_id, name, short: name.split(' ')[0] || name, hue,
          tag: row.author_headline || 'Tweaklr member', interests: [], bio: row.author_bio || '', avatarUrl: row.author_avatar_url || '',
          username: row.author_username ? '@' + row.author_username.replace(/^@/, '') : '', activity: row.author_activity || '',
          status: 'on', visitor: row.kind === 'visitor', km: mingDiscoverPeople.find(p => p.id === row.author_id)?.km ?? null });
        const base = { id: row.id, authorId: row.author_id, title: row.title, body: row.body, createdAt: new Date(row.created_at).getTime(),
          likes: Number(row.likes || 0), liked: !!row.liked, commentsCount: Number(row.comments_count || 0) };
        if (row.kind === 'talk' || row.kind === 'general') discoverMoments.push(base);
        if (['service', 'hiring', 'sale'].includes(row.kind)) discoverOpportunities.push(base);
        if (row.kind === 'activity') discoverActivities.push({ ...base, place: row.title, going: 0, joined: false });
        if (row.kind === 'visitor') discoverVisitors.push(base);
      });
      if (activityIds.length) {
        const { data: participants, error: participantError } = await supabaseClient.from('daily_update_participants').select('update_id, user_id').in('update_id', activityIds);
        if (participantError) console.warn('Tweaklr: Discover activity participants could not be loaded.', participantError.message);
        else {
          const counts = new Map();
          (participants || []).forEach(row => { counts.set(row.update_id, (counts.get(row.update_id) || 0) + 1); if (row.user_id === session.user.id) discoverActivityJoined.add(row.update_id); });
          discoverActivities.forEach(a => { a.going = counts.get(a.id) || 0; a.joined = discoverActivityJoined.has(a.id); });
        }
      }
    }
    const lat = hasLocation() ? Number(state.userLocation.latitude.toFixed(7)) : null;
    const lng = hasLocation() ? Number(state.userLocation.longitude.toFixed(7)) : null;
    const { data: placeRows, error: placeError } = await supabaseClient.rpc('get_discover_places', { p_latitude: lat, p_longitude: lng, p_radius_km: 5 });
    if (placeError) console.warn('Tweaklr: Discover places could not be loaded.', placeError.message);
    else discoverPlaces = (placeRows || []).map(row => ({ id: row.id, name: row.name, kind: row.kind, note: row.note || '', hue: 26, km: row.distance_km == null ? null : Number(row.distance_km), saved: !!row.saved_by_me }));
    return true;
  } catch (error) { console.warn('Tweaklr: Discover content load failed.', error); return false; }
}

async function loadDiscover() {
  state.loaded.discover = true;
  if (hasLocation()) await publishMingApproxLocation();
  await loadMingDiscoverableProfiles(); await loadMingDiscoverContent();
  $('#discover-chips').innerHTML = DISCOVER_FILTERS.map(f => '<button class="chip ' + (f.k === state.discoverFilter ? 'is-on' : '') + '" data-action="filter:' + f.k + '">' + f.t + '</button>').join('');
  $('#discover-body').innerHTML = skeletonRail() + skeletonCards(2); await sleep(560); renderDiscover();
}

function renderDiscover() {
  $('#discover-chips').innerHTML = DISCOVER_FILTERS.map(f => '<button class="chip ' + (f.k === state.discoverFilter ? 'is-on' : '') + '" data-action="filter:' + f.k + '">' + f.t + '</button>').join('');
  const f = state.discoverFilter; const show = k => f === 'all' || f === k; let html = '';
  if (show('people')) {
    html += '<div class="section">' + sectionHead('People', null, { t: 'Nearby', a: 'go-nearby' }) + '<div class="rail">' +
      (mingDiscoverPeople.map(p => '<button class="pcard" data-action="person:' + p.id + '">' + ringAvatar(p, 56, isMingUserOnline(p.id)) + '<div class="name">' + esc(p.short) + '</div><div class="tag">' + esc(p.tag) + '</div><div class="dist">' + esc(p.km == null ? 'Discoverable' : distLabel(p.km)) + '</div></button>').join('') || '<div style="padding:8px 0;color:var(--muted);font-size:13px">No other Tweaklr members are discoverable yet.</div>') + '</div></div>';
  }
  if (show('moments')) {
    html += '<div class="section">' + sectionHead('Moments', 'Recent local moments') + '<div class="rail">' + (discoverMoments.map(m => {
      const p = byId(m.authorId); if (!p) return '';
      return '<button class="mcard" data-action="person:' + m.authorId + '"><div class="art" style="background:' + avatarStyle(p.hue) + '"><span class="who">' + avatar(p, 28, { status: false }) + esc(p.short) + '</span></div><div class="body"><p>' + esc(m.body || m.title) + '</p><div class="m">' + esc(timeAgo(m.createdAt)) + ' · ' + esc(p.km == null ? 'Distance unavailable' : distLabel(p.km)) + '</div></div></button>';
    }).join('') || emptyState('No moments yet', 'Real local moments will appear here as people share them.')) + '</div></div>';
  }
  if (show('opps')) {
    html += '<div class="section">' + sectionHead('Opportunities', 'People looking, people offering') + '<div class="rail">' + (discoverOpportunities.map(o => {
      const p = byId(o.authorId); if (!p) return '';
      return '<button class="ocard" data-action="person:' + o.authorId + '"><div class="k">' + esc(o.title) + '</div><h3>' + esc(o.body || 'Opportunity') + '</h3><p>' + esc(timeAgo(o.createdAt)) + '</p><div class="f">' + avatar(p, 28, { status: false }) + '<span>' + esc(p.short) + ' · ' + esc(p.km == null ? 'Local' : distLabel(p.km)) + '</span></div></button>';
    }).join('') || emptyState('No opportunities yet', 'Real offers and requests shared on Tweaklr will appear here.')) + '</div></div>';
  }
  if (show('activities')) {
    html += '<div class="section">' + sectionHead('Activities', 'Things happening nearby') + (discoverActivities.map(a => {
      const p = byId(a.authorId); if (!p) return '';
      return '<button class="acard" data-action="activity:' + a.id + '"><div class="when"><div class="h">' + esc(timeAgo(a.createdAt)) + '</div><div class="d">' + esc(a.going) + ' going</div></div><div class="info"><div class="t">' + esc(a.title) + '</div><div class="s">' + esc(a.body || 'Activity shared on Tweaklr') + ' · ' + esc(p.km == null ? 'Local' : distLabel(p.km)) + '</div></div><span class="go">' + icon('chev') + '</span></button>';
    }).join('') || emptyState('No activities yet', 'Real activities shared on Tweaklr will appear here.')) + '</div>';
  }
  if (show('places')) {
    html += '<div class="section">' + sectionHead('Places', 'Public places added to Tweaklr') + '<div class="rail">' + (discoverPlaces.map(pl => '<button class="plcard" data-action="place:' + pl.id + '"><div class="art" style="background:' + avatarStyle(pl.hue) + '"></div><div class="body"><div class="n">' + esc(pl.name) + '</div><div class="s">' + esc(pl.kind) + '</div><div class="d">' + esc(pl.km == null ? 'Distance unavailable' : distLabel(pl.km)) + '</div></div></button>').join('') || emptyState('No places yet', 'Places will appear here once they are added to Tweaklr.')) + '</div></div>';
  }
  if (show('visitors')) {
    html += '<div class="section">' + sectionHead('Visitors', 'People sharing that they are visiting') + '<div class="rail">' + (discoverVisitors.map(v => {
      const p = byId(v.authorId); if (!p) return '';
      return '<button class="prow" data-action="person:' + v.authorId + '">' + avatar(p, 48) + '<div class="meta"><div class="n">' + esc(p.name) + '</div><div class="s">' + esc(v.body || v.title) + '</div></div><div class="right"><div class="d">' + esc(p.km == null ? 'Local' : distLabel(p.km)) + '</div><div class="t">' + esc(timeAgo(v.createdAt)) + '</div></div></button>';
    }).join('') || emptyState('No visitors right now', 'Visitors will appear here when they share a Visiting update.')) + '</div></div>';
  }
  $('#discover-body').innerHTML = html;
}
/* ------------------------------------------------------------
   NEARBY
------------------------------------------------------------ */
async function loadMingNearbyActivities(radiusKm = state.radius) {
  mingNearbyActivities = [];
  if (!hasLocation()) return false;

  try {
    const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession();
    if (sessionError || !session?.user) return false;

    const { data, error } = await supabaseClient.rpc('get_nearby_activities', {
      p_latitude: Number(state.userLocation.latitude.toFixed(7)),
      p_longitude: Number(state.userLocation.longitude.toFixed(7)),
      p_radius_km: Number(radiusKm)
    });

    if (error) {
      console.warn('Tweaklr: Nearby activities could not be loaded.', error.message);
      return false;
    }

    mingNearbyActivities = (data || []).map(row => {
      const name = row.author_display_name || 'Tweaklr user';
      const seed = String(row.author_id || '') + ':' + name;
      let hue = 0;
      for (let i = 0; i < seed.length; i++) hue = (hue * 31 + seed.charCodeAt(i)) % 360;

      const person = {
        id: row.author_id,
        name,
        short: name.split(' ')[0] || name,
        hue,
        tag: row.author_headline || 'Tweaklr member',
        interests: [],
        bio: row.author_bio || '',
        avatarUrl: row.author_avatar_url || '',
        username: row.author_username ? '@' + row.author_username.replace(/^@/, '') : '',
        activity: row.author_activity || '',
        status: 'on',
        visitor: false,
        km: Number(row.distance_km),
        bearingDeg: row.bearing_deg == null ? null : Number(row.bearing_deg),
        off: null
      };
      mingConnectionProfiles.set(person.id, person);

      const startsAt = row.starts_at ? new Date(row.starts_at).getTime() : null;
      return {
        id: row.id,
        authorId: row.author_id,
        title: row.title,
        body: row.body || '',
        createdAt: new Date(row.created_at).getTime(),
        startsAt,
        hour: startsAt ? new Date(startsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '',
        day: startsAt ? new Date(startsAt).toLocaleDateString([], { weekday: 'long' }) : '',
        place: row.place || 'Nearby',
        going: Number(row.going || 0),
        km: Number(row.distance_km),
        bearingDeg: row.bearing_deg == null ? null : Number(row.bearing_deg)
      };
    });

    return true;
  } catch (error) {
    console.warn('Tweaklr: Nearby activity load failed.', error);
    return false;
  }
}

async function loadNearby() {
  state.loaded.nearby = true;
  if (hasLocation()) {
    await publishMingApproxLocation();
    await loadMingDiscoverableProfiles(state.radius);
    await loadMingNearbyActivities(state.radius);
  } else {
    mingNearbyActivities = [];
  }
  $('#nearby-body').innerHTML = tweaklrLoadingMarkup('Finding what is happening nearby…');
  await sleep(640);
  renderNearby();
}

function renderNearby() {
  const host = $('#nearby-body');
  if (state.locStatus !== 'granted') {
    host.innerHTML = `
      <div class="perm">
        <div class="glyph">${icon('pin')}</div>
        <h3>${esc(locationLine().title === 'Location enabled' ? 'Turn on location' : locationLine().title)}</h3>
        <p>Tweaklr works out where you are from your device. There is no way to type an area in — you either allow location access or you don't. Your coordinates stay on your device, and nobody else sees more than a rough distance.</p>
        <button class="btn btn--primary btn--block" data-action="enable-location">
          ${state.locStatus === 'requesting' ? 'Finding your area…' : 'Enable location'}
        </button>
        <p class="fine">You can browse Discover without sharing location.</p>
      </div>
      ${state.locStatus === 'denied' ? `<div class="privacy-note" style="margin-top:16px">${icon('shield')}<p>Location is blocked for this site. Allow it in your browser settings, then tap Enable location again.</p></div>` : ''}
      <div class="section">${sectionHead('While you wait', 'Public activity')}
        ${liveUpdates().slice(0, 2).map(updateCard).join('')}
      </div>`;
    return;
  }

  const inRange = mingDiscoverPeople.filter(p => p.km !== null && p.km <= state.radius).sort((a, b) => a.km - b.km);
  const actPins = mingNearbyActivities.filter(a => a.km !== null && a.km <= state.radius).slice(0, 2);
  /* Pin positions come from the offset between two coordinates — a picture of
     relative bearing, never a published coordinate. */
  const mapPos = o => {
    if (o.bearingDeg != null && o.km != null) {
      const angle = o.bearingDeg * Math.PI / 180;
      const reach = Math.min(42, Math.max(8, (o.km / Math.max(state.radius, 0.1)) * 40));
      return { x: Math.min(93, Math.max(7, 50 + Math.sin(angle) * reach)), y: Math.min(90, Math.max(8, 50 - Math.cos(angle) * reach)) };
    }
    if (o.off) {
      const k = 45 / Math.max(state.radius, 0.1);
      return { x: Math.min(93, Math.max(7, 50 + (o.off.e / 1000) * k)), y: Math.min(90, Math.max(8, 50 - (o.off.n / 1000) * k)) };
    }
    return { x: 50, y: 50 };
  };

  host.innerHTML = `
    <div class="mapwrap">
      <div class="map" id="map">
        <div class="road h" style="top:32%"></div>
        <div class="road h" style="top:70%;height:9px"></div>
        <div class="road v" style="left:36%"></div>
        <div class="road v" style="left:72%;width:7px"></div>
        <div class="blk" style="left:6%;top:38%;width:24%;height:26%"></div>
        <div class="blk" style="left:42%;top:8%;width:24%;height:18%"></div>
        <div class="blk" style="left:78%;top:40%;width:18%;height:22%"></div>
        <div class="blk" style="left:8%;top:8%;width:20%;height:16%"></div>
        <div class="water"></div>
        <div class="ring r3"></div>
        <div class="ring r2"></div>
        <div class="ring r1"></div>
        <div class="ring r2 sweep"></div>
        <div class="me" aria-hidden="true"></div>
        <div class="map-float">${icon('shield')} ${esc(areaLabel())} · exact position hidden</div>
        ${inRange.map(p => `
          <button class="pin" style="left:${mapPos(p).x}%;top:${mapPos(p).y}%" data-action="person:${p.id}" aria-label="${esc(p.short)}, ${esc(distLabel(p.km))}">
            <span class="bubble">${avatar(p, 36)}</span><span class="tip"></span>
          </button>`).join('')}
        ${actPins.map(a => `
          <button class="pin activity" style="left:${mapPos(a).x}%;top:${mapPos(a).y}%" data-action="activity:${a.id}" aria-label="${esc(a.title)}">
            <span class="bubble">${esc(a.title.split(',')[0])} · ${esc(a.hour)}</span><span class="tip"></span>
          </button>`).join('')}
      </div>
      <div class="map-legend">${icon('users')}<span><b>${inRange.length} people</b> and ${actPins.length} activities within ${state.radius} km · measured from your device position</span></div>
    </div>

    <div class="radius-ctl">
      <div class="lbl"><b>Discovery area</b><span id="radius-val">${state.radius} km</span></div>
      <input type="range" id="radius" min="0.5" max="50" step="0.5" value="${state.radius}" aria-label="Discovery radius in kilometres" />
    </div>

    <div class="privacy-note">${icon('shield')}
      <p><b>Your exact location is hidden.</b> Tweaklr only ever shows an approximate distance, and never your address or coordinates — to anyone.</p>
    </div>

    <div class="section">${sectionHead('People around you', inRange.length ? `${inRange.length} within ${state.radius} km` : null)}
      ${inRange.length ? inRange.map(p => `
        <button class="prow" data-action="person:${p.id}">
          ${ringAvatar(p, 48, isMingUserOnline(p.id))}
          <div class="meta"><div class="n">${esc(p.name)}</div><div class="s">${esc(p.tag)} · ${esc(p.activity)}</div></div>
          <div class="right"><div class="d">${esc(distLabel(p.km))}</div><div class="t">${esc(areaLabel())}</div></div>
        </button>`).join('')
      : emptyState('No one nearby yet.', 'Check back soon, or expand your discovery area to see more of the neighbourhood.', { t: 'Expand to 50 km', a: 'expand-radius' })}
    </div>

    <div class="section">${sectionHead('Activity nearby', 'Next few days')}
      ${mingNearbyActivities.filter(a => a.km !== null && a.km <= state.radius).map(a => `
        <button class="acard" data-action="activity:${a.id}">
          <div class="when"><div class="h">${esc(a.hour)}</div><div class="d">${esc(a.day)}</div></div>
          <div class="info"><div class="t">${esc(a.title)}</div><div class="s">${esc(a.place)} · ${a.going} going</div></div>
          <span class="go">${icon('chev')}</span>
        </button>`).join('') || emptyState('Nothing planned nearby', 'Start something. People three streets away are probably free too.', { t: 'Create an activity', a: 'create:activity' })}
    </div>`;

  const slider = $('#radius');
  if (slider) {
    slider.addEventListener('input', e => {
      state.radius = parseFloat(e.target.value);
      $('#radius-val').textContent = state.radius + ' km';
    });
    slider.addEventListener('change', async () => {
      if (!hasLocation()) return renderNearby();
      await loadMingDiscoverableProfiles(state.radius);
      await loadMingNearbyActivities(state.radius);
      renderNearby();
    });
  }
}

/* ------------------------------------------------------------
   PERSON
------------------------------------------------------------ */
function isConnected(id) { return connections.some(c => c.personId === id); }

function openPerson(id) {
  const p = byId(id);
  if (!p) return;
  state.activePerson = id;
  $('#person-title').textContent = p.short;
  const status = connectionStatus(id);
  const connected = status === 'connected';
  const incoming = status === 'incoming';
  const outgoing = hasOutgoingConnectionRequest(id);
  const theirUpdates = liveUpdates().filter(u => u.authorId === id);
  const publicLikes = theirUpdates.reduce((total, update) => total + Math.max(0, Number(update.likes) || 0), 0);
  const relationshipLabel = connected ? 'Connected' : incoming ? 'Request received' : outgoing ? 'Request sent' : 'Not connected';
  const isBlocked = tweaklrBlockedUserIds.has(id);

  $('#person-body').innerHTML = `
    <div class="phead public-profile-head" style="padding-top:8px">
      ${ringAvatar(p, 88, isMingUserOnline(p.id))}
      <div class="who">
        <h1>${esc(p.name)}</h1>
        ${p.username ? `<div class="u public-profile-username">${esc(p.username.startsWith('@') ? p.username : '@' + p.username)}</div>` : ''}
        <div class="u">${esc(p.tag || 'Tweaklr member')}</div>
        ${p.headline ? `<div class="u">${esc(p.headline)}</div>` : ''}
        <div class="u" style="color:var(--coffee);margin-top:6px">${esc(distLabel(p.km))}${hasLocation() ? ' · ' + esc(areaLabel()) : ''}</div>
      </div>
    </div>
    <div class="public-profile-stats" aria-label="Public profile statistics">
      <div class="public-profile-stat"><strong>${publicLikes.toLocaleString()}</strong><span>Likes received</span></div>
      <div class="public-profile-stat"><strong>${theirUpdates.length.toLocaleString()}</strong><span>Live updates</span></div>
      <div class="public-profile-stat"><strong>${esc(relationshipLabel)}</strong><span>Your connection</span></div>
    </div>
    <div class="pmeta"><p class="bio">${esc(p.bio || 'This member has not added a bio yet.')}</p></div>
    <div class="now">
      <div><div class="lbl">Right now</div><div class="val">${esc(p.activity)}</div></div>
    </div>
    <div style="display:flex;gap:10px;padding:18px 18px 0">
      <button class="btn ${connected || outgoing ? 'btn--soft' : 'btn--primary'}" style="flex:1" data-action="${connected ? 'confirm-remove:' + p.id : incoming || outgoing ? 'go-connections' : 'connect:' + p.id}">
        ${connected ? icon('check') + 'Connected' : incoming ? icon('users') + 'Respond in Connections' : outgoing ? icon('check') + 'Request sent' : icon('users') + 'Connect'}
      </button>
      <button class="btn btn--soft" style="flex:1" data-action="message:${p.id}">${icon('chat')}Message</button>
    </div>
    <div style="padding:10px 18px 0">
      <button class="btn btn--soft btn--block" data-action="${isBlocked ? 'unblock-user:' + p.id : 'block-user:' + p.id}">${isBlocked ? 'Unblock this person' : 'Block this person privately'}</button>
    </div>
    <div class="section">${sectionHead('Interests')}
      <div class="tags">${p.interests.map(i => `<span class="tag-pill">${esc(i)}</span>`).join('')}</div>
    </div>
    <div class="section">${sectionHead('Daily Updates', 'Gone in 24 hours')}
      ${theirUpdates.length ? theirUpdates.map(updateCard).join('') : emptyState('Nothing shared today', `${p.short} has not posted an update in the last 24 hours.`)}
    </div>
    <div class="privacy-note" style="margin-bottom:8px">${icon('shield')}
      <p>You are seeing an approximate distance. ${esc(p.short)} cannot see your exact location either.</p>
    </div>`;
  pushStack('person');
}

/* ------------------------------------------------------------
   CONNECTIONS
------------------------------------------------------------ */
function renderConnections() {
  $('#conn-sub').textContent = `${connections.length} people · ${connectionRequests.length} pending`;
  const reqs = connectionRequests.map(r => {
    const p = byId(r.personId);
    return `<div class="req" id="req-${r.id}">
      <div class="top">${avatar(p, 48)}
        <div class="m"><div class="n">${esc(p.name)}</div><div class="s">${esc(p.tag)} · ${esc(distLabel(p.km))}</div></div>
      </div>
      <p class="msg">${esc(r.message)}</p>
      <div class="row">
        <button class="btn btn--primary btn--sm" data-action="accept-req:${r.id}">Accept</button>
        <button class="btn btn--soft btn--sm" data-action="decline-req:${r.id}">Not now</button>
      </div>
    </div>`;
  }).join('');

  const list = connections.length ? connections
    .slice()
    .sort((a, b) => b.at - a.at)
    .map(c => {
      const p = byId(c.personId);
      const d = Math.round((now() - c.at) / (24 * HOUR));
      const when = d === 0 ? 'Connected today' : d === 1 ? 'Connected yesterday' : `Connected ${d} days ago`;
      return `<div class="conn-card">
        <button style="display:flex;gap:13px;flex:1;align-items:center;text-align:left" data-action="person:${p.id}">
          ${avatar(p, 48)}
          <span class="m"><span class="n" style="display:block">${esc(p.name)}</span>
          <span class="s" style="display:block">${esc(p.tag)}</span>
          <span class="w" style="display:block">${esc(when)}</span></span>
        </button>
        <div class="acts">
          <button class="round" data-action="message:${p.id}" aria-label="Message ${esc(p.short)}">${icon('chat')}</button>
          <button class="round" data-action="confirm-remove:${p.id}" aria-label="Remove ${esc(p.short)}">${icon('x')}</button>
        </div>
      </div>`;
    }).join('') : emptyState('No connections yet', 'When you connect with someone nearby, they will appear here.', { t: 'Discover people', a: 'go-nearby' });

  $('#connections-body').innerHTML =
    (connectionRequests.length ? `<div class="section" style="margin-top:14px">${sectionHead('Requests', `${connectionRequests.length} waiting`)}${reqs}</div>` : '') +
    `<div class="section">${sectionHead('Your connections', `${connections.length} people`)}${list}</div>`;
}

function connectWith(id) {
  const p = byId(id);
  if (!p || isConnected(id)) return;
  openModal({
    title: `Connect with ${p.short}?`,
    lede: 'Add a short note so they know why. Connections are mutual — either of you can remove it later.',
    fields: `<div class="field"><label for="conn-note">Your note</label>
      <textarea id="conn-note" placeholder="Hi ${esc(p.short)} — saw you are nearby…" maxlength="180"></textarea></div>`,
    actions: [
      { t: 'Cancel', cls: 'btn--soft', a: 'close-modal' },
      { t: 'Send request', cls: 'btn--primary', a: 'send-conn:' + id }
    ]
  });
}

async function sendConnection(id) {
  const p = byId(id);
  if (!p) return;

  if (isUuidPerson(id)) {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session?.user) {
      toast('Please sign in again', 'alert');
      return;
    }

    const note = $('#conn-note')?.value.trim() || null;
    const { error } = await supabaseClient
      .from('connections')
      .insert({
        requester_id: session.user.id,
        recipient_id: id,
        note,
        status: 'pending'
      });

    if (error) {
      console.error('Tweaklr: connection request failed:', error.message);
      toast(/duplicate|unique/i.test(error.message) ? 'A request already exists.' : 'Could not send connection request.', 'alert');
      return;
    }

    closeModal();
    toast(`Connection request sent to ${p.short}`, 'check');
    await loadMingConnections();
    if (state.activePerson === id) openPersonRefresh(id);
    renderConnections();
    return;
  }

  connections.push({ personId: id, at: now() });
  closeModal();
  toast(`Connected with ${p.short}`, 'check');
  updateNotifDot();
  if (state.activePerson === id) openPersonRefresh(id);
  renderConnections();
  if (state.loaded.profile) renderProfile();
}

function openPersonRefresh(id) {
  const scroll = $('#screen-person .scroll').scrollTop;
  state.stack.pop();
  openPerson(id);
  $('#screen-person .scroll').scrollTop = scroll;
}

/* ------------------------------------------------------------
   MESSAGING
------------------------------------------------------------ */

/* ------------------------------------------------------------
   PRIVATE USER BLOCKING
------------------------------------------------------------ */
let tweaklrBlockedUserIds = new Set();

async function refreshTweaklrBlocks() {
  const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession();
  if (sessionError || !session?.user) return false;
  const { data, error } = await supabaseClient
    .from('user_blocks')
    .select('blocked_id')
    .eq('blocker_id', session.user.id);
  if (error) {
    console.warn('Tweaklr: block list is not ready. Run the private blocking migration in Supabase.', error.message);
    return false;
  }
  tweaklrBlockedUserIds = new Set((data || []).map(row => row.blocked_id));
  return true;
}

async function blockTweaklrUser(personId) {
  if (!isUuidPerson(personId)) {
    toast('Blocking is available for registered Tweaklr accounts.', 'alert');
    return;
  }
  const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession();
  if (sessionError || !session?.user) { toast('Please sign in again.', 'alert'); return; }
  if (personId === session.user.id) return;
  const p = byId(personId);
  const { error } = await supabaseClient.from('user_blocks').upsert(
    { blocker_id: session.user.id, blocked_id: personId },
    { onConflict: 'blocker_id,blocked_id', ignoreDuplicates: true }
  );
  if (error) {
    console.error('Tweaklr: block failed:', error.message);
    toast(error.message.includes('user_blocks') ? 'Run the blocking SQL migration in Supabase first.' : 'Could not block this person.', 'alert');
    return;
  }
  tweaklrBlockedUserIds.add(personId);
  closeSheet();
  closeModal();
  toast((p?.short || 'Person') + ' blocked privately.', 'check');
  if (state.activeChat === personId) {
    clearChatReply();
    popStack();
  }
  if (state.activePerson === personId && state.stack[state.stack.length - 1] === 'person') popStack();
  if (state.loaded.messages) renderMessages();
  if (state.loaded.profile) renderProfile();
}

async function unblockTweaklrUser(personId) {
  const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession();
  if (sessionError || !session?.user) { toast('Please sign in again.', 'alert'); return; }
  const { error } = await supabaseClient.from('user_blocks')
    .delete().eq('blocker_id', session.user.id).eq('blocked_id', personId);
  if (error) {
    console.error('Tweaklr: unblock failed:', error.message);
    toast('Could not unblock this person.', 'alert');
    return;
  }
  tweaklrBlockedUserIds.delete(personId);
  await openBlockedUsersSheet();
  toast('Person unblocked.', 'check');
}

async function openBlockedUsersSheet() {
  const ok = await refreshTweaklrBlocks();
  if (!ok) {
    toast('Blocked users are unavailable. Run the blocking SQL migration in Supabase.', 'alert');
    return;
  }
  const ids = [...tweaklrBlockedUserIds];
  openSheet({
    title: 'Blocked people',
    sub: 'Only you can see this list. People are not notified when you block or unblock them.',
    body: ids.length ? ids.map(id => {
      const p = byId(id);
      return '<div class="settings-info"><div class="settings-info-icon">' + (p ? avatar(p, 38) : icon('user')) + '</div><div style="flex:1;min-width:0"><div class="settings-info-title">' + esc(p?.name || p?.username || 'Tweaklr member') + '</div><div class="settings-info-sub">' + esc(p?.username ? '@' + p.username.replace(/^@/, '') : 'Blocked account') + '</div></div><button type="button" class="btn btn--soft btn--sm" data-action="unblock-user:' + esc(id) + '">Unblock</button></div>';
    }).join('') : '<div class="empty-state"><strong>No blocked people</strong><p>People you block will appear here.</p></div>',
    foot: '<button class="btn btn--soft btn--block" data-action="close-sheet">Done</button>'
  });
}

function confirmBlockTweaklrUser(personId) {
  const p = byId(personId);
  openModal({
    title: 'Block ' + (p?.short || 'this person') + '?',
    lede: 'They will not be notified. Tweaklr will prevent new messages and connection requests between you. Existing chat history is not deleted.',
    actions: [
      { t: 'Cancel', cls: 'btn--soft', a: 'close-modal' },
      { t: 'Block privately', cls: 'btn--danger', a: 'confirm-block-user:' + personId }
    ]
  });
}

async function loadMingMessages() {  try {
    const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession();
    if (sessionError || !session?.user) return false;

    const { data: rows, error } = await supabaseClient
      .from('messages')
      .select('id, sender_id, recipient_id, body, created_at, read_at, message_type, voice_path, voice_duration, reply_to_id, attachment_path, attachment_name, attachment_mime, attachment_size')
      .or(`sender_id.eq.${session.user.id},recipient_id.eq.${session.user.id}`)
      .order('created_at', { ascending: true });

    if (error) {
      console.warn('Tweaklr: messages backend is not ready yet.', error.message);
      return false;
    }

    // "Delete for me" is persisted separately so a hidden message stays
    // hidden after refresh without deleting it for the other participant.
    let hiddenMessageIds = new Set();
    const { data: hiddenRows, error: hiddenError } = await supabaseClient
      .from('message_hidden_for_users')
      .select('message_id')
      .eq('user_id', session.user.id);

    if (hiddenError) {
      // The delete migration may not have been run yet. Keep normal
      // messaging working rather than breaking the whole Messages screen.
      console.warn('Tweaklr: message hide list is not ready yet.', hiddenError.message);
    } else {
      hiddenMessageIds = new Set((hiddenRows || []).map(row => row.message_id));
    }

    const byConversation = new Map();

    (rows || []).forEach(row => {
      if (hiddenMessageIds.has(row.id)) return;

      const otherId = row.sender_id === session.user.id ? row.recipient_id : row.sender_id;
      const c = byConversation.get(otherId) || {
        id: 'c_' + otherId,
        personId: otherId,
        unread: 0,
        messages: []
      };

      c.messages.push({
        id: row.id,
        me: row.sender_id === session.user.id,
        text: row.body,
        at: new Date(row.created_at).getTime(),
        read: !!row.read_at,
        type: row.message_type || 'text',
        voicePath: row.voice_path || '',
        voiceDuration: row.voice_duration || 0,
        replyToId: row.reply_to_id || null,
        attachmentPath: row.attachment_path || '',
        attachmentName: row.attachment_name || '',
        attachmentMime: row.attachment_mime || '',
        attachmentSize: Number(row.attachment_size || 0)
      });

      if (row.recipient_id === session.user.id && !row.read_at) c.unread += 1;
      byConversation.set(otherId, c);
    });

    conversations = Array.from(byConversation.values());
    updateProfileMessageUnreadBadge();
    return true;
  } catch (error) {
    console.warn('Tweaklr: message load failed.', error);
    return false;
  }
}

let mingMessageChannel = null;
let mingChatChannel = null;

/* Global app presence.
   A user is online only while at least one Tweaklr tab is visible.
   Realtime removes the presence automatically when the socket closes. */
let mingPresenceChannel = null;
const mingOnlineUsers = new Set();
const mingPresenceTabId = 'tab_' + Math.random().toString(36).slice(2);

function isMingUserOnline(userId) {
  return !!userId && mingOnlineUsers.has(String(userId));
}

function refreshPresenceViews() {
  try {
    if (state.tab === 'home') renderHomePeople();
    if (state.tab === 'nearby') renderNearby();
    if (state.tab === 'discover') renderDiscover();
    if (state.tab === 'profile') renderProfile();
    if (state.tab === 'person' && state.activePerson) renderPerson(state.activePerson);
  } catch (_) {}
}

async function syncMingPresenceUsers() {
  if (!mingPresenceChannel) return;

  const next = new Set();
  const stateMap = mingPresenceChannel.presenceState();

  Object.values(stateMap || {}).forEach(entries => {
    (Array.isArray(entries) ? entries : [entries]).forEach(entry => {
      const id = entry?.userId;
      if (id) next.add(String(id));
    });
  });

  mingOnlineUsers.clear();
  next.forEach(id => mingOnlineUsers.add(id));
  refreshPresenceViews();
}

async function trackMingPresence() {
  if (!mingPresenceChannel || document.hidden) return;

  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session?.user) return;

  try {
    await mingPresenceChannel.track({
      userId: session.user.id,
      online_at: new Date().toISOString()
    });
  } catch (error) {
    console.warn('Tweaklr: presence track failed.', error);
  }
}

async function untrackMingPresence() {
  if (!mingPresenceChannel) return;
  try {
    await mingPresenceChannel.untrack();
  } catch (_) {}
}

async function startMingPresence() {
  if (mingPresenceChannel) return;

  const { data: { session }, error } = await supabaseClient.auth.getSession();
  if (error || !session?.user) return;

  await supabaseClient.realtime.setAuth();

  const channel = supabaseClient.channel('ming:presence', {
    config: {
      presence: { key: mingPresenceTabId }
    }
  });

  channel
    .on('presence', { event: 'sync' }, syncMingPresenceUsers)
    .on('presence', { event: 'join' }, syncMingPresenceUsers)
    .on('presence', { event: 'leave' }, syncMingPresenceUsers);

  mingPresenceChannel = channel;

  channel.subscribe(async status => {
    if (status !== 'SUBSCRIBED') {
      if (status !== 'CLOSED' && status !== 'CHANNEL_ERROR') {
        console.warn('Tweaklr: presence realtime status:', status);
      }
      return;
    }

    await trackMingPresence();
    await syncMingPresenceUsers();
  });
}

let chatTypingTimer = null;
let chatTyping = false;
let chatOnline = false;
let chatReplyTarget = null;
let chatRecording = null;
let chatRecordChunks = [];
let chatRecordStartedAt = 0;
const chatVoiceUrls = new Map();
const MING_CHAT_MAX_FILE_BYTES=50*1024*1024;
const MING_CHAT_ALLOWED_MIME=new Set(['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif','video/mp4','video/webm','video/quicktime','video/x-m4v','application/pdf','text/plain','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation']);
let pendingChatAttachment=null;
function clearChatAttachment(){pendingChatAttachment=null;const i=$('#chat-attachment-input');if(i)i.value='';const h=$('#chat-attachment-preview');if(h){h.hidden=true;h.innerHTML='';}}
function showChatAttachmentPreview(file){const h=$('#chat-attachment-preview');if(!h)return;h.hidden=false;h.innerHTML='<div class="chat-attachment-preview__inner"><span class="chat-attachment-preview__icon">'+icon(file.type.startsWith('image/')?'spark':'note')+'</span><span class="chat-attachment-preview__copy"><strong>'+esc(file.name)+'</strong><small>'+esc(formatChatFileSize(file.size))+' · Ready to send</small></span><button type="button" class="chat-attachment-preview__remove" id="chat-attachment-remove" aria-label="Remove attachment">'+icon('x')+'</button></div>';$('#chat-attachment-remove')?.addEventListener('click',clearChatAttachment);}
async function chooseChatAttachment(file){if(!file)return;const ext=(file.name||'').toLowerCase().split('.').pop();const mimeOk=MING_CHAT_ALLOWED_MIME.has(file.type);const extOk=['jpg','jpeg','png','webp','gif','heic','heif','mp4','webm','mov','m4v','pdf','txt','doc','docx','xls','xlsx','ppt','pptx'].includes(ext);if(!mimeOk&&!extOk){toast('That file type is not supported in Ming chat.','alert');return;}if(file.size>MING_CHAT_MAX_FILE_BYTES){toast('Attachments must be 50 MB or smaller.','alert');return;}pendingChatAttachment=file;showChatAttachmentPreview(file);}
async function sendStoredChatAttachment(file,options={}){const p=byId(state.activeChat);if(!p||!isUuidPerson(state.activeChat))return false;const {data:{session}}=await supabaseClient.auth.getSession();if(!session?.user){toast('Please sign in again','alert');return false;}const ext=(file.name||'').toLowerCase().split('.').pop();const isImage=file.type.startsWith('image/')||['jpg','jpeg','png','webp','gif','heic','heif'].includes(ext);const isVideo=file.type.startsWith('video/')||['mp4','webm','mov','m4v'].includes(ext);const type=(isImage||isVideo)?'image':'file';const safeName=file.name.replace(/[^a-zA-Z0-9._-]+/g,'_').slice(0,90)||'attachment';const path=session.user.id+'/'+crypto.randomUUID()+'-'+safeName;const {error:uploadError}=await supabaseClient.storage.from('ming-message-files').upload(path,file,{contentType:file.type||'application/octet-stream',cacheControl:'3600',upsert:false});if(uploadError){toast('Could not upload attachment. Run supabase_daily_update_share_media_migration.sql first.','alert');return false;}const replyToId=options.replyToId||chatReplyTarget?.id||null;let row=null,error=null;const direct=await supabaseClient.from('messages').insert({sender_id:session.user.id,recipient_id:state.activeChat,body:'',message_type:type,attachment_path:path,attachment_name:file.name,attachment_mime:file.type||'application/octet-stream',attachment_size:file.size,reply_to_id:replyToId}).select('id,sender_id,recipient_id,body,created_at,read_at,message_type,voice_path,voice_duration,reply_to_id,attachment_path,attachment_name,attachment_mime,attachment_size').single();row=direct.data;error=direct.error;if(error){const rpc=await supabaseClient.rpc('ming_send_message_v3',{p_recipient_id:state.activeChat,p_body:'',p_message_type:type,p_voice_path:null,p_voice_duration:null,p_reply_to_id:replyToId,p_attachment_path:path,p_attachment_name:file.name,p_attachment_mime:file.type||'application/octet-stream',p_attachment_size:file.size});row=Array.isArray(rpc.data)?rpc.data[0]:rpc.data;error=rpc.error;}if(error||!row){await supabaseClient.storage.from('ming-message-files').remove([path]).catch(()=>{});toast(error?.message||'Could not send attachment.','alert');return false;}const c=convoFor(state.activeChat);c.messages.push({id:row.id,me:true,text:'',at:new Date(row.created_at).getTime(),read:!!row.read_at,type,voicePath:'',voiceDuration:0,replyToId:row.reply_to_id||null,attachmentPath:path,attachmentName:file.name,attachmentMime:file.type||'',attachmentSize:file.size,reactions:[]});clearChatAttachment();clearChatReply();renderThread();const t=$('#chat-thread');if(t)t.scrollTop=t.scrollHeight;return true;}


function chatTopicFor(a, b) {
  return 'ming:chat:' + [a, b].sort().join(':');
}

/* ------------------------------------------------------------
   TWEAKLR CALLING — WebRTC + Supabase Realtime signaling
------------------------------------------------------------ */
let mingCallInboxChannel = null;
let mingCallOutboundChannel = null;
let mingCallOutboundChannelPromise = null;
let mingCallOutboundTarget = null;
let mingCallPeerChannel = null;
let mingCallPeerSubscribed = false;
let mingCallPeerId = null;
let mingCall = null;
let mingIncomingCall = null;
let mingCallTimer = null;
let mingCallFailureTimer = null;
let mingCallStartedAt = 0;
let mingCallRemoteStream = null;
let mingCallPendingIce = [];
let mingCallOutgoingIce = [];
let mingServiceWorkerRegistration = null;
let mingPushReady = false;

const MING_VAPID_PUBLIC_KEY = 'BPuZKvSfz_hshjbbaEz08rJo5cyzfP4JW2qSYkIiRuJ_QVkFjYBD62RqbcExYtNX1S9Z_Jk4hoPb697FYSghvYc';

const MING_RTC_CONFIG = {
  // Keep the existing STUN fallback intact. TURN credentials are fetched
  // securely per call from the Supabase Edge Function below.
  iceCandidatePoolSize: 2,
  iceServers: [
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

async function getMingRtcConfig() {
  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session?.access_token) return MING_RTC_CONFIG;

    const response = await fetch(SUPABASE_URL + '/functions/v1/turn-credentials', {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + session.access_token,
        'apikey': SUPABASE_ANON_KEY
      }
    });

    if (!response.ok) {
      console.warn('Tweaklr: TURN credentials unavailable; using STUN fallback.', response.status);
      return MING_RTC_CONFIG;
    }

    const data = await response.json();
    if (!Array.isArray(data?.iceServers) || !data.iceServers.length) {
      return MING_RTC_CONFIG;
    }

    return {
      iceCandidatePoolSize: 2,
      iceServers: data.iceServers
    };
  } catch (error) {
    console.warn('Tweaklr: TURN credential request failed; using STUN fallback.', error);
    return MING_RTC_CONFIG;
  }
}


function waitForMingIceGatheringComplete(pc, timeoutMs = 8000) {
  if (!pc || pc.iceGatheringState === 'complete') return Promise.resolve();

  return new Promise(resolve => {
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', check);
      resolve();
    };

    const check = () => {
      if (pc.iceGatheringState === 'complete') finish();
    };

    const timer = setTimeout(finish, timeoutMs);
    pc.addEventListener('icegatheringstatechange', check);
    check();
  });
}

function callTopicFor(userId) {
  return 'ming:call:' + userId;
}

function callSessionTopicFor(callId, a, b) {
  const users = [String(a || ''), String(b || '')].sort();
  return 'ming:call:' + callId + ':' + users[0] + ':' + users[1];
}

function setCallStatus(text) {
  const el = $('#call-status');
  if (el) el.textContent = text || '';
}

function setCallTitle(text) {
  const el = $('#call-title');
  if (el) el.textContent = text || '';
}

function formatCallDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return minutes + ':' + seconds;
}

function updateCallTimer() {
  if (!mingCallStartedAt) return;
  setCallStatus(formatCallDuration(Date.now() - mingCallStartedAt));
}

function startCallTimer() {
  if (mingCallTimer) clearInterval(mingCallTimer);
  mingCallStartedAt = Date.now();
  updateCallTimer();
  mingCallTimer = setInterval(updateCallTimer, 1000);
}

function stopCallTimer() {
  if (mingCallTimer) clearInterval(mingCallTimer);
  mingCallTimer = null;
  mingCallStartedAt = 0;
}

function setCallControls({ incoming = false, active = false } = {}) {
  $('#call-incoming-actions')?.toggleAttribute('hidden', !incoming);
  $('#call-active-actions')?.toggleAttribute('hidden', !active);
}

function renderCallMode(kind) {
  const overlay = $('#call-overlay');
  if (!overlay) return;
  overlay.dataset.callKind = kind || 'voice';
  const isVideo = kind === 'video';
  $('#call-remote-video')?.toggleAttribute('hidden', !isVideo);
  $('#call-local-video')?.toggleAttribute('hidden', !isVideo);
  $('#call-remote-audio')?.toggleAttribute('hidden', isVideo);
  $('#call-avatar')?.toggleAttribute('hidden', isVideo && !!mingCall?.connected);
  $('#call-camera')?.toggleAttribute('hidden', !isVideo);
}

function showCallOverlay({ incoming = false, active = false, kind = 'voice', personId = null, callId = null } = {}) {
  const overlay = $('#call-overlay');
  if (!overlay) return;
  overlay.dataset.callId = callId || '';
  overlay.dataset.callRole = incoming ? 'receiver' : 'caller';
  const p = personId ? byId(personId) : null;
  $('#call-name').textContent = p?.short || 'Tweaklr user';
  const av = $('#call-avatar');
  if (av && p) av.innerHTML = avatar(p, 72, { status: false });
  setCallControls({ incoming, active });
  renderCallMode(kind);
  overlay.hidden = false;
  document.body.classList.add('call-open');
}

function hideCallOverlay() {
  const overlay = $('#call-overlay');
  if (overlay) {
    overlay.hidden = true;
    overlay.dataset.callId = '';
    overlay.dataset.callRole = '';
  }
  document.body.classList.remove('call-open');
  setCallControls();
}

function attachCallMedia(stream, kind) {
  const localVideo = $('#call-local-video');
  if (localVideo) localVideo.srcObject = stream;
  if (kind === 'video' && localVideo) localVideo.play().catch(() => {});
}

function resetCallMedia() {
  ['call-local-video', 'call-remote-video', 'call-remote-audio'].forEach(id => {
    const el = $('#' + id);
    if (el) el.srcObject = null;
  });
}

function stopLocalCallStream() {
  if (!mingCall?.localStream) return;
  mingCall.localStream.getTracks().forEach(track => track.stop());
  mingCall.localStream = null;
}

async function closeCallPeerChannel() {
  await closeMingCallOutboundChannel();
  if (mingCallPeerChannel) await supabaseClient.removeChannel(mingCallPeerChannel);
  mingCallPeerChannel = null;
  mingCallPeerId = null;
  mingCallPeerSubscribed = false;
}

async function ensureCallPeerChannel(targetId, callId = null) {
  // Kept for compatibility with older call state. Call signaling now uses
  // the recipient's private inbox exclusively, so a second per-call room
  // cannot block negotiation.
  return isUuidPerson(targetId) && isUuidPerson(currentUser.id) && !!(callId || mingCall?.callId);
}

async function ensureMingCallOutboundChannel(targetId) {
  if (!isUuidPerson(targetId)) return null;

  if (
    mingCallOutboundChannel &&
    mingCallOutboundTarget === targetId
  ) {
    return mingCallOutboundChannel;
  }

  if (mingCallOutboundChannelPromise) {
    return mingCallOutboundChannelPromise;
  }

  mingCallOutboundChannelPromise = (async () => {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session?.access_token) {
      console.warn('Tweaklr: call realtime auth session is unavailable.');
      return null;
    }
    await supabaseClient.realtime.setAuth(session.access_token);

    const channel = supabaseClient.channel(callTopicFor(targetId), {
      config: {
        private: false,
        broadcast: { self: false, ack: true }
      }
    });

    const subscribed = await new Promise(resolve => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve(false);
      }, 8000);

      channel.subscribe(status => {
        if (status === 'SUBSCRIBED') {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(true);
          return;
        }

        if (['TIMED_OUT', 'CHANNEL_ERROR', 'CLOSED'].includes(status)) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(false);
        }
      });
    });

    if (!subscribed) {
      await supabaseClient.removeChannel(channel);
      return null;
    }

    mingCallOutboundChannel = channel;
    mingCallOutboundTarget = targetId;
    return channel;
  })();

  try {
    return await mingCallOutboundChannelPromise;
  } finally {
    mingCallOutboundChannelPromise = null;
  }
}

async function closeMingCallOutboundChannel() {
  if (mingCallOutboundChannel) {
    await supabaseClient.removeChannel(mingCallOutboundChannel);
  }
  mingCallOutboundChannel = null;
  mingCallOutboundTarget = null;
  mingCallOutboundChannelPromise = null;
}

async function sendCallInboxSignal(targetId, payload) {
  if (!isUuidPerson(targetId) || !payload?.callId) return false;

  console.log('Tweaklr: sending call signal', {
    type: payload.type,
    callId: payload.callId,
    to: targetId
  });

  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session?.user) return false;

  try {
    const channel = await ensureMingCallOutboundChannel(targetId);
    if (!channel) {
      console.warn('Tweaklr: call outbound channel could not connect.');
      return false;
    }

    const result = await channel.send({
      type: 'broadcast',
      event: 'call',
      payload
    });

    if (result === 'ok') return true;

    console.warn('Tweaklr: call realtime send was rejected.', {
      result,
      type: payload.type,
      callId: payload.callId
    });
    return false;
  } catch (error) {
    console.warn('Tweaklr: call realtime send failed.', {
      type: payload.type,
      callId: payload.callId,
      error
    });
    return false;
  }
}

async function sendCallSignal(targetId, payload) {
  // All call signaling (offer, answer, ICE, hangup, decline, busy) uses
  // the recipient's authenticated private inbox. This removes the fragile
  // second per-call Realtime subscription from the negotiation path.
  return sendCallInboxSignal(targetId, payload);
}

function urlBase64ToUint8Array(value) {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(char => char.charCodeAt(0)));
}

async function ensureMingCallServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  if (mingServiceWorkerRegistration) return mingServiceWorkerRegistration;
  try {
    mingServiceWorkerRegistration = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    return mingServiceWorkerRegistration;
  } catch (error) {
    console.warn('Tweaklr: service worker registration failed.', error);
    return null;
  }
}



/* Handle a call notification opened from the service worker. */
navigator.serviceWorker?.addEventListener('message', event => {
  if (event.data?.type !== 'ming-call-open') return;
  void restorePendingMingCall();
});

async function ensureMingPushReady({ prompt = false } = {}) {
  if (mingPushReady) return true;
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || typeof Notification === 'undefined') return false;

  try {
    const registration = await ensureMingCallServiceWorker();
    if (!registration) return false;

    let permission = Notification.permission;
    if (permission === 'default' && prompt) permission = await Notification.requestPermission();
    if (permission !== 'granted') return false;

    const existing = await registration.pushManager.getSubscription();
    const subscription = existing || await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(MING_VAPID_PUBLIC_KEY)
    });
    const json = subscription.toJSON();
    const keys = json.keys || {};

    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session?.user || !subscription.endpoint || !keys.p256dh || !keys.auth) return false;

    const { error } = await supabaseClient.from('ming_push_subscriptions').upsert({
      user_id: session.user.id,
      endpoint: subscription.endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      user_agent: navigator.userAgent.slice(0, 500),
      updated_at: new Date().toISOString()
    }, { onConflict: 'endpoint' });

    if (error) {
      console.warn('Tweaklr: could not save push subscription.', error.message);
      return false;
    }

    mingPushReady = true;
    return true;
  } catch (error) {
    console.warn('Tweaklr: push setup failed.', error);
    return false;
  }
}

async function showMingIncomingCallNotification(payload) {
  if (!payload?.callId || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  if (!document.hidden) return;
  try {
    const registration = await ensureMingCallServiceWorker();
    if (!registration) return;
    await registration.showNotification(
      payload.kind === 'video' ? 'Incoming video call' : 'Incoming voice call',
      {
        body: (byId(payload.from)?.short || 'Someone') + ' is calling you on Tweaklr',
        icon: './favicon.ico',
        badge: './favicon.ico',
        tag: 'ming-call-' + payload.callId,
        renotify: true,
        requireInteraction: true,
        vibrate: [180, 100, 180, 100, 360],
        data: { type: 'ming-call', callId: payload.callId }
      }
    );
  } catch (error) {
    console.warn('Tweaklr: incoming call notification failed.', error);
  }
}

async function createMingCallInvite(payload) {
  if (!payload?.callId || !isUuidPerson(payload.from) || !isUuidPerson(payload.to) || !payload.offer) return false;
  const { error } = await supabaseClient.from('ming_call_invites').insert({
    call_id: payload.callId,
    caller_id: payload.from,
    recipient_id: payload.to,
    kind: payload.kind || 'voice',
    offer: payload.offer,
    status: 'pending',
    expires_at: new Date(Date.now() + 90 * 1000).toISOString()
  });
  if (error) {
    console.warn('Tweaklr: call invite persistence failed.', {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint
    });
    return false;
  }
  return true;
}

async function updateMingCallInvite(callId, status) {
  if (!callId) return;
  await supabaseClient.from('ming_call_invites')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('call_id', callId);
}

async function sendMingCallPush(payload) {
  if (!payload?.to || !payload?.callId) return;
  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session?.access_token) return;
    await fetch(SUPABASE_URL + '/functions/v1/send-call-push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + session.access_token
      },
      body: JSON.stringify({
        recipientId: payload.to,
        callId: payload.callId,
        kind: payload.kind || 'voice',
        callerName: currentUser.name || 'Someone'
      })
    });
  } catch (error) {
    console.warn('Tweaklr: call push request failed.', error);
  }
}

async function restorePendingMingCall() {
  if (!isUuidPerson(currentUser.id) || mingCall || mingIncomingCall) return;
  try {
    const { data: rows, error } = await supabaseClient
      .from('ming_call_invites')
      .select('call_id, caller_id, kind, offer, expires_at')
      .eq('recipient_id', currentUser.id)
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1);
    if (error || !rows?.length) return;

    const row = rows[0];
    // Realtime may already have delivered this exact call.
    if (mingCall?.callId === row.call_id || mingIncomingCall?.callId === row.call_id) return;

    mingIncomingCall = {
      callId: row.call_id,
      from: row.caller_id,
      to: currentUser.id,
      kind: row.kind,
      offer: row.offer
    };
    showCallOverlay({ incoming: true, kind: row.kind || 'voice', personId: row.caller_id, callId: row.call_id });
    setCallTitle(row.kind === 'video' ? 'Incoming video call' : 'Incoming voice call');
    setCallStatus('Incoming call');
  } catch (error) {
    console.warn('Tweaklr: pending call restore failed.', error);
  }
}

async function endMingCall({ notify = true, reason = 'ended' } = {}) {
  if (mingCallFailureTimer) {
    clearTimeout(mingCallFailureTimer);
    mingCallFailureTimer = null;
  }

  const call = mingCall;
  const incoming = mingIncomingCall;

  if (notify && call?.remoteId && call?.callId) {
    await sendCallSignal(call.remoteId, {
      type: reason === 'declined' ? 'decline' : 'hangup',
      callId: call.callId,
      from: currentUser.id,
      to: call.remoteId
    });
  }

  if (call?.callId) {
    await updateMingCallInvite(call.callId, reason === 'declined' ? 'declined' : 'ended');
  }

  if (call?.pc) {
    try { call.pc.close(); } catch (_) {}
  }
  stopLocalCallStream();
  mingCallRemoteStream?.getTracks().forEach(track => track.stop());
  mingCallRemoteStream = null;
  mingCallPendingIce = [];
  mingCallOutgoingIce = [];
  mingIncomingCall = null;
  mingCall = null;
  stopCallTimer();
  resetCallMedia();
  hideCallOverlay();

  if (reason === 'failed') toast('Call could not connect.', 'alert');
  else if (reason === 'declined') toast('Call declined.', 'info');
  else if (incoming) toast('Call ended.', 'info');

  if (!call && !incoming) return;
  await closeCallPeerChannel();
}

async function setupCallPeer({ remoteId, callId, kind, role }) {
  const rtcConfig = await getMingRtcConfig();
  const pc = new RTCPeerConnection(rtcConfig);

  // Keep ICE diagnostics visible in the console instead of collapsing every
  // WebRTC failure into the same generic "could not connect" message.
  pc.oniceconnectionstatechange = () => {
    console.log('Tweaklr: ICE state', {
      callId,
      role,
      state: pc.iceConnectionState,
      gathering: pc.iceGatheringState,
      connection: pc.connectionState
    });

    if (pc.iceConnectionState === 'checking') {
      setCallStatus('Connecting…');
    } else if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
      setCallStatus('Connected');
    }
  };

  pc.onicecandidateerror = event => {
    console.warn('Tweaklr: ICE candidate error', {
      callId,
      role,
      url: event.url,
      errorCode: event.errorCode,
      errorText: event.errorText
    });
  };

  pc.onicecandidate = event => {
    if (!event.candidate) return;
    const candidate = event.candidate.toJSON ? event.candidate.toJSON() : event.candidate;
    const candidateType = candidate.candidate?.match(/\\btyp\\s+(\\w+)/)?.[1] || 'unknown';
    console.log('Tweaklr: ICE candidate gathered', {
      callId,
      role,
      candidateType,
      protocol: candidate.protocol,
      address: candidate.address || null,
      port: candidate.port || null
    });

    /*
       The offer is sent only after its initial ICE gathering pass, so the
       receiver is already subscribed to the caller's inbox by the time
       trickled candidates can arrive. Send candidates immediately instead
       of holding the caller's candidates until the answer arrives.
    */
    void sendCallSignal(remoteId, {
      type: 'ice',
      callId,
      from: currentUser.id,
      to: remoteId,
      candidate
    });
  };

  pc.ontrack = event => {
    const stream = event.streams?.[0] || new MediaStream([event.track]);
    mingCallRemoteStream = stream;
    const remoteVideo = $('#call-remote-video');
    const remoteAudio = $('#call-remote-audio');
    if (kind === 'video' && remoteVideo) {
      remoteVideo.srcObject = stream;
      remoteVideo.play().catch(() => {});
    }
    if (remoteAudio) {
      remoteAudio.srcObject = stream;
      remoteAudio.play().catch(() => {});
    }
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'connected') {
      if (mingCallFailureTimer) {
        clearTimeout(mingCallFailureTimer);
        mingCallFailureTimer = null;
      }
      if (mingCall) mingCall.connected = true;
      setCallStatus('Connected');
      startCallTimer();
      renderCallMode(kind);
    } else if (pc.connectionState === 'connecting') {
      setCallStatus('Connecting…');
    } else if (pc.connectionState === 'failed') {
      console.warn('Tweaklr: WebRTC connection failed', {
        callId,
        role,
        iceConnectionState: pc.iceConnectionState,
        iceGatheringState: pc.iceGatheringState,
        connectionState: pc.connectionState,
        localDescriptionType: pc.localDescription?.type || null,
        remoteDescriptionType: pc.remoteDescription?.type || null
      });
      /*
         ICE can briefly report "failed" while the signaling path is still
         delivering the answer/candidates. Do not tear the call down
         immediately; give the negotiation a short recovery window.
      */
      setCallStatus('Reconnecting…');
      if (!mingCallFailureTimer) {
        mingCallFailureTimer = setTimeout(() => {
          mingCallFailureTimer = null;
          if (mingCall?.pc === pc && !mingCall.connected) {
            void endMingCall({ notify: true, reason: 'failed' });
          }
        }, 12000);
      }
    } else if (pc.connectionState === 'disconnected') {
      setCallStatus('Reconnecting…');
    }
  };

  return pc;
}

async function getCallMedia(kind) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Media devices are not supported.');
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: kind === 'video'
      ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }
      : false
  });
}

async function startMingCall(kind) {
  if (!(await ensureMingCallAuthenticatedUser())) {
    toast('Your session is still loading. Please try the call again.', 'alert');
    return;
  }

  const remoteId = state.activeChat;
  if (!isUuidPerson(remoteId)) {
    toast('Calls are available for connected Tweaklr conversations.', 'alert');
    return;
  }
  if (mingCall || mingIncomingCall) {
    toast('You are already handling a call.', 'info');
    return;
  }

  try {
    const callId = crypto.randomUUID();
    setCallTitle(kind === 'video' ? 'Video call' : 'Voice call');
    setCallStatus('Requesting permission…');
    showCallOverlay({ active: true, kind, personId: remoteId, callId });

    const stream = await getCallMedia(kind);
    mingCall = { callId, remoteId, kind, role: 'caller', localStream: stream, pc: null, connected: false };

    attachCallMedia(stream, kind);
    setCallStatus('Calling…');

    const pc = await setupCallPeer({ remoteId, callId, kind, role: 'caller' });
    mingCall.pc = pc;
    stream.getTracks().forEach(track => pc.addTrack(track, stream));

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    // Wait for the initial ICE gathering pass so the SDP offer carries
    // the available host/STUN/TURN candidates. This keeps the call from
    // depending on a race between the offer and early ICE signaling.
    await waitForMingIceGatheringComplete(pc);

    const offerPayload = {
      type: 'offer',
      callId,
      from: currentUser.id,
      to: remoteId,
      kind,
      offer: pc.localDescription
    };

    // Persist the invite before joining the recipient's private inbox.
    // Realtime authorization uses this pending invite to allow the caller
    // to join that topic without exposing other users' call traffic.
    if (!(await createMingCallInvite(offerPayload))) {
      throw new Error('Could not save call invitation.');
    }

    const outboundChannel = await ensureMingCallOutboundChannel(remoteId);
    if (!outboundChannel) throw new Error('Could not connect call signaling.');

    void sendMingCallPush(offerPayload);
    if (!(await sendCallSignal(remoteId, offerPayload))) throw new Error('Could not send call invitation.');
  } catch (error) {
    console.warn('Tweaklr: outgoing call failed.', error);
    await endMingCall({ notify: false, reason: 'failed' });
  }
}

async function acceptMingCall() {
  const incoming = mingIncomingCall;
  if (!incoming) return;

  if (!(await ensureMingCallAuthenticatedUser())) {
    toast('Your session is still loading. Please try again.', 'alert');
    return;
  }

  try {
    const stream = await getCallMedia(incoming.kind);
    mingCall = {
      callId: incoming.callId,
      remoteId: incoming.from,
      kind: incoming.kind,
      role: 'callee',
      localStream: stream,
      pc: null,
      connected: false
    };
    mingIncomingCall = null;
    await updateMingCallInvite(incoming.callId, 'accepted');

    setCallTitle(incoming.kind === 'video' ? 'Video call' : 'Voice call');
    showCallOverlay({ active: true, kind: incoming.kind, personId: incoming.from, callId: incoming.callId });
    setCallStatus('Connecting…');
    attachCallMedia(stream, incoming.kind);

    const outboundChannel = await ensureMingCallOutboundChannel(incoming.from);
    if (!outboundChannel) throw new Error('Could not connect call signaling.');

    const pc = await setupCallPeer({
      remoteId: incoming.from,
      callId: incoming.callId,
      kind: incoming.kind,
      role: 'callee'
    });
    mingCall.pc = pc;
    stream.getTracks().forEach(track => pc.addTrack(track, stream));

    await pc.setRemoteDescription(new RTCSessionDescription(incoming.offer));
    for (const candidate of mingCallPendingIce.splice(0)) {
      try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch (_) {}
    }

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    // Include the initial ICE candidates in the answer as well, reducing
    // the chance that early candidate messages are lost during signaling.
    await waitForMingIceGatheringComplete(pc);

    if (!(await sendCallSignal(incoming.from, {
      type: 'answer',
      callId: incoming.callId,
      from: currentUser.id,
      to: incoming.from,
      answer: pc.localDescription
    }))) {
      throw new Error('Could not send call answer.');
    }
  } catch (error) {
    console.warn('Tweaklr: accepting call failed.', error);
    await endMingCall({ notify: true, reason: 'failed' });
  }
}

async function declineMingCall() {
  const incoming = mingIncomingCall;
  if (!incoming) return;
  await updateMingCallInvite(incoming.callId, 'declined');
  await sendCallSignal(incoming.from, {
    type: 'decline',
    callId: incoming.callId,
    from: currentUser.id,
    to: incoming.from
  });
  mingIncomingCall = null;
  hideCallOverlay();
  setCallControls();
  toast('Call declined.', 'info');
}

async function handleMingCallSignal(payload) {
  if (!payload?.type) return;

  const { data: { session } } = await supabaseClient.auth.getSession();
  const authenticatedUserId = session?.user?.id;
  if (!isUuidPerson(authenticatedUserId) || payload.to !== authenticatedUserId) return;
  currentUser.id = authenticatedUserId;

  console.log('Tweaklr: received call signal', {
    type: payload.type,
    callId: payload.callId,
    from: payload.from
  });

  if (payload.type === 'offer') {
    // Realtime delivery and database recovery can surface the same offer.
    // Treat the callId as the idempotency key so the receiver never creates
    // a second incoming-call state for the same call.
    if (mingCall?.callId === payload.callId || mingIncomingCall?.callId === payload.callId) {
      return;
    }

    if (mingCall || mingIncomingCall) {
      await sendCallSignal(payload.from, {
        type: 'busy',
        callId: payload.callId,
        from: currentUser.id,
        to: payload.from
      });
      return;
    }

    mingIncomingCall = {
      callId: payload.callId,
      from: payload.from,
      to: currentUser.id,
      kind: payload.kind || 'voice',
      offer: payload.offer
    };

    await showMingIncomingCallNotification(mingIncomingCall);
    showCallOverlay({
      incoming: true,
      kind: mingIncomingCall.kind,
      personId: mingIncomingCall.from,
      callId: mingIncomingCall.callId
    });
    setCallTitle(mingIncomingCall.kind === 'video' ? 'Incoming video call' : 'Incoming voice call');
    setCallStatus('Incoming call');
    return;
  }

  if (!mingCall || payload.callId !== mingCall.callId) return;

  if (payload.type === 'answer' && mingCall.role === 'caller') {
    try {
      console.log('Tweaklr: applying call answer', {
        callId: mingCall.callId
      });
      await mingCall.pc.setRemoteDescription(new RTCSessionDescription(payload.answer));
      mingCall.remoteDescriptionReady = true;
      for (const candidate of mingCallPendingIce.splice(0)) {
        try { await mingCall.pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch (_) {}
      }
      setCallStatus('Connecting…');
    } catch (error) {
      console.warn('Tweaklr: applying call answer failed.', error);
      await endMingCall({ notify: true, reason: 'failed' });
    }
    return;
  }

  if (payload.type === 'ice') {
    if (mingCall.pc?.remoteDescription) {
      try { await mingCall.pc.addIceCandidate(new RTCIceCandidate(payload.candidate)); } catch (_) {}
    } else {
      mingCallPendingIce.push(payload.candidate);
    }
    return;
  }

  if (payload.type === 'decline') {
    await endMingCall({ notify: false, reason: 'declined' });
    return;
  }

  if (payload.type === 'busy') {
    await endMingCall({ notify: false, reason: 'declined' });
    toast('They are already on another call.', 'info');
    return;
  }

  if (payload.type === 'hangup') {
    await endMingCall({ notify: false, reason: 'ended' });
  }
}

let mingCallInboxRetryTimer = null;

async function startMingCallInbox() {
  if (mingCallInboxChannel) return;

  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session?.user?.id || !session?.access_token) return;

  currentUser.id = session.user.id;
  await supabaseClient.realtime.setAuth(session.access_token);

  const topic = callTopicFor(session.user.id);
  console.log('Tweaklr: starting call inbox.', {
    userId: session.user.id,
    topic
  });

  const channel = supabaseClient.channel(topic, {
    config: { private: false, broadcast: { self: false, ack: true } }
  });

  channel.on('broadcast', { event: 'call' }, ({ payload }) => {
    handleMingCallSignal(payload).catch(error => console.warn('Tweaklr: call signal handling failed.', error));
  });

  mingCallInboxChannel = channel;

  channel.subscribe((status, error) => {
    if (status === 'SUBSCRIBED') {
      console.log('Tweaklr: call inbox connected.');
      void restorePendingMingCall();
      return;
    }

    if (['TIMED_OUT', 'CHANNEL_ERROR', 'CLOSED'].includes(status)) {
      console.warn('Tweaklr: call inbox disconnected.', status, error || '');

      // Do not remove the channel from inside its own status callback.
      // Supabase can synchronously emit another close/error event here,
      // which previously caused startMingCallInbox() to recurse until the
      // browser threw "too much recursion".
      if (mingCallInboxChannel === channel) mingCallInboxChannel = null;

      if (!mingCallInboxRetryTimer) {
        mingCallInboxRetryTimer = setTimeout(() => {
          mingCallInboxRetryTimer = null;
          void startMingCallInbox();
        }, 3000);
      }
      return;
    }

    console.warn('Tweaklr: call realtime status:', status, error || '');
  });
}

async function recoverMingCallInbox() {
  await startMingCallInbox();
  await restorePendingMingCall();
}

window.addEventListener('focus', () => {
  void recoverMingCallInbox();
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) void recoverMingCallInbox();
});

function toggleMingCallMute() {
  const track = mingCall?.localStream?.getAudioTracks?.()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  const btn = $('#call-mute');
  if (btn) {
    btn.classList.toggle('is-off', !track.enabled);
    btn.setAttribute('aria-pressed', String(!track.enabled));
    btn.innerHTML = icon(track.enabled ? 'mic' : 'mic-off');
  }
}

function toggleMingCallCamera() {
  const track = mingCall?.localStream?.getVideoTracks?.()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  const btn = $('#call-camera');
  if (btn) {
    btn.classList.toggle('is-off', !track.enabled);
    btn.setAttribute('aria-pressed', String(!track.enabled));
    btn.innerHTML = icon(track.enabled ? 'video' : 'video-off');
  }
}

function renderChatPresenceStatus() {
  const p = byId(state.activeChat);
  if (!p) return;
  const base = hasLocation() && p.km != null ? distLabel(p.km) + ' · ' : '';
  const status = chatTyping ? 'Typing…' : (chatOnline ? 'Online now' : (isMingUserOnline(p.id) ? 'Active now' : 'Active earlier'));
  $('#chat-sub').textContent = base + status;
}

async function stopMingChatRealtime() {
  if (chatTypingTimer) {
    clearTimeout(chatTypingTimer);
    chatTypingTimer = null;
  }
  chatTyping = false;
  chatOnline = false;
  if (mingChatChannel) {
    await supabaseClient.removeChannel(mingChatChannel);
    mingChatChannel = null;
  }
}

async function startMingChatRealtime(personId) {
  await stopMingChatRealtime();
  if (!isUuidPerson(personId)) {
    renderChatPresenceStatus();
    return;
  }

  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session?.user) return;

  await supabaseClient.realtime.setAuth();
  const topic = chatTopicFor(session.user.id, personId);

  const channel = supabaseClient.channel(topic, {
    config: {
      private: true,
      broadcast: { self: false, ack: false },
      presence: { key: session.user.id }
    }
  });

  channel
    .on('presence', { event: 'sync' }, () => {
      const presence = channel.presenceState();
      chatOnline = Object.prototype.hasOwnProperty.call(presence, personId);
      renderChatPresenceStatus();
    })
    .on('presence', { event: 'join' }, ({ key }) => {
      if (key === personId) {
        chatOnline = true;
        renderChatPresenceStatus();
      }
    })
    .on('presence', { event: 'leave' }, ({ key }) => {
      if (key === personId) {
        chatOnline = false;
        renderChatPresenceStatus();
      }
    })
    .on('broadcast', { event: 'typing' }, ({ payload }) => {
      if (payload?.from !== personId) return;
      chatTyping = payload.typing === true;
      renderChatPresenceStatus();
      if (chatTypingTimer) clearTimeout(chatTypingTimer);
      if (chatTyping) {
        chatTypingTimer = setTimeout(() => {
          chatTyping = false;
          renderChatPresenceStatus();
        }, 2500);
      }
      renderThread();
    });

  mingChatChannel = channel;

  channel.subscribe(async status => {
    if (status !== 'SUBSCRIBED') {
      if (status !== 'CLOSED' && status !== 'CHANNEL_ERROR') {
        console.warn('Tweaklr: chat realtime status:', status);
      }
      return;
    }

    await channel.track({
      userId: session.user.id,
      online_at: new Date().toISOString()
    });
    renderChatPresenceStatus();
  });
}

async function setMingTyping(isTyping) {
  if (!mingChatChannel || !isUuidPerson(state.activeChat)) return;

  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session?.user) return;

  await mingChatChannel.send({
    type: 'broadcast',
    event: 'typing',
    payload: {
      from: session.user.id,
      to: state.activeChat,
      typing: !!isTyping
    }
  });

  if (isTyping) {
    if (chatTypingTimer) clearTimeout(chatTypingTimer);
    chatTypingTimer = setTimeout(() => setMingTyping(false), 1200);
  } else if (chatTypingTimer) {
    clearTimeout(chatTypingTimer);
    chatTypingTimer = null;
  }
}

async function markMingConversationRead(personId) {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session?.user || !isUuidPerson(personId)) return;

  const { error } = await supabaseClient
    .from('messages')
    .update({ read_at: new Date().toISOString() })
    .eq('recipient_id', session.user.id)
    .eq('sender_id', personId)
    .is('read_at', null);

  if (error) console.warn('Tweaklr: could not mark messages read.', error.message);
}

async function subscribeMingMessages() {
  if (mingMessageChannel) return;
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session?.user) return;

  mingMessageChannel = supabaseClient
    .channel('ming-messages-' + session.user.id)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: 'recipient_id=eq.' + session.user.id
      },
      payload => {
        const row = payload.new;
        const p = byId(row.sender_id);
        if (!p) return;

        let c = conversations.find(x => x.personId === row.sender_id);
        if (!c) {
          c = { id: 'c_' + row.sender_id, personId: row.sender_id, unread: 0, messages: [] };
          conversations.unshift(c);
        }

        if (c.messages.some(m => m.id === row.id)) return;

        c.messages.push({
          id: row.id,
          me: false,
          text: row.body,
          at: new Date(row.created_at).getTime(),
          read: false,
          type: row.message_type || 'text',
          voicePath: row.voice_path || '',
          voiceDuration: row.voice_duration || 0,
          replyToId: row.reply_to_id || null,
          attachmentPath: row.attachment_path || '',
          attachmentName: row.attachment_name || '',
          attachmentMime: row.attachment_mime || '',
          attachmentSize: Number(row.attachment_size || 0),
          reactions: []
        });

        if (state.activeChat === row.sender_id) {
          markMingConversationRead(row.sender_id);
          c.unread = 0;
          renderThread();
          const t = $('#chat-thread');
          if (t) t.scrollTop = t.scrollHeight;
        } else {
          c.unread += 1;
        }

        if (state.loaded.messages) renderMessages();
        updateProfileMessageUnreadBadge();
        void loadMingNotifications().then(() => updateNotifDot());
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'messages',
        filter: 'sender_id=eq.' + session.user.id
      },
      payload => {
        const row = payload.new;
        const c = conversations.find(x => x.personId === row.recipient_id);
        const m = c?.messages.find(x => x.id === row.id);
        if (!m) return;
        m.text = row.body;
        m.read = !!row.read_at;
        if (state.activeChat === row.recipient_id) renderThread();
        if (state.loaded.messages) renderMessages();
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'messages',
        filter: 'recipient_id=eq.' + session.user.id
      },
      payload => {
        const row = payload.new;
        const c = conversations.find(x => x.personId === row.sender_id);
        const m = c?.messages.find(x => x.id === row.id);
        if (!m) return;
        m.text = row.body;
        m.read = !!row.read_at;
        if (state.activeChat === row.sender_id) renderThread();
        if (state.loaded.messages) renderMessages();
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'DELETE',
        schema: 'public',
        table: 'messages'
      },
      payload => {
        const id = payload.old?.id;
        if (!id) return;

        let changed = false;
        conversations.forEach(convo => {
          const next = convo.messages.filter(m => m.id !== id);
          if (next.length !== convo.messages.length) {
            convo.messages = next;
            changed = true;
          }
        });

        if (!changed) return;
        if (state.activeChat) renderThread();
        if (state.loaded.messages) renderMessages();
      }
    )
    .subscribe();
}

function convoFor(personId) {
  let c = conversations.find(x => x.personId === personId);
  if (!c) {
    c = { id: 'c_' + personId, personId, unread: 0, messages: [] };
    conversations.unshift(c);
  }
  return c;
}

function renderMessages() {
  const list = conversations.slice().sort((a, b) => {
    const la = a.messages.length ? a.messages[a.messages.length - 1].at : 0;
    const lb = b.messages.length ? b.messages[b.messages.length - 1].at : 0;
    return lb - la;
  });
  $('#messages-body').innerHTML = list.length ? list.map(c => {
    const p = byId(c.personId);
    if (!p) return '';
    const last = c.messages[c.messages.length - 1];
    return `<button class="convo ${c.unread ? 'unread' : ''}" data-action="chat:${c.personId}">
      ${avatar(p, 48)}
      <span class="c">
        <span class="top"><span class="n">${esc(p.short)}</span><span class="t">${last ? esc(timeAgo(last.at)) : ''}</span></span>
        <span class="p">${last ? (last.me ? 'You: ' : '') + esc(last.text) : 'Say hello'}</span>
      </span>
      ${c.unread ? `<span class="badge">${c.unread}</span>` : ''}
    </button>`;
  }).join('') : emptyState('No conversations yet.', 'Connect with someone nearby to start a conversation.', { t: 'Find people', a: 'go-nearby' });
}

async function openChat(personId) {
  const p = byId(personId);
  if (!p) return;

  if (isUuidPerson(personId)) {
    const blocksReady = await refreshTweaklrBlocks();
    if (blocksReady && tweaklrBlockedUserIds.has(personId)) {
      toast('You have blocked this person. Unblock them in Settings to message again.', 'alert');
      return;
    }
    await loadMingMessages();
    await markMingConversationRead(personId);
  }

  const c = convoFor(personId);
  c.unread = 0;
  // Opening a conversation also clears its related notification indicator.
  notifications.forEach(n => {
    if (n.type === 'message' && n.personId === personId) {
      n.read = true;
      notificationReadIds.add(n.id);
    }
  });
  const relatedReadIds = notifications
    .filter(n => n.type === 'message' && n.personId === personId)
    .map(n => n.id);
  if (relatedReadIds.length) {
    void saveNotificationReadState(relatedReadIds);
  }
  renderNotifications();
  updateNotifDot();
  state.activeChat = personId;
  $('#chat-av').innerHTML = `<button type="button" class="chat-profile-avatar" data-action="person:${esc(p.id)}" aria-label="View ${esc(p.short)}'s public profile" title="View public profile">${avatar(p, 36)}</button>`;
  $('#chat-name').innerHTML = `<button type="button" class="chat-profile-name" data-action="person:${esc(p.id)}" aria-label="View ${esc(p.short)}'s public profile" title="View public profile">${esc(p.short)}<span aria-hidden="true">↗</span></button>`;
  chatTyping = false;
  chatOnline = false;
  renderChatPresenceStatus();
  await startMingChatRealtime(personId);
  void ensureMingPushReady({ prompt: true });
  await loadChatReactions(c);
  renderThread();
  pushStack('chat');
  setTimeout(() => { const t = $('#chat-thread'); if (t) t.scrollTop = t.scrollHeight; }, 60);
}

function setChatReply(messageId) {  const c = convoFor(state.activeChat);
  const m = c.messages.find(x => x.id === messageId);
  if (!m) return;
  chatReplyTarget = m;
  const preview = $('#chat-reply-preview');
  if (preview) {
    preview.hidden = false;
    preview.innerHTML = `
      <button type="button" aria-label="Cancel reply" data-action="chat-cancel-reply">×</button>
      <strong>Replying to ${m.me ? 'your message' : esc(byId(state.activeChat)?.short || 'them')}</strong>
      ${m.type === 'voice' ? '🎙️ Voice note' : esc((m.text || '').slice(0, 140))}
    `;
  }
  $('#chat-input')?.focus();
  $$('.chat-message-row').forEach(row => row.classList.remove('is-replying'));
  const row = document.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`);
  if (row) {
    row.classList.add('is-replying');
    row.scrollIntoView({ behavior:'smooth', block:'center' });
  }
}

function jumpToRepliedMessage(messageId) {
  const thread = document.querySelector('#chat-thread');
  if (!thread || !messageId) return;

  const row = Array.from(thread.querySelectorAll('.chat-message-row'))
    .find(item => item.dataset.messageId === messageId);
  if (!row) return;

  // Scroll the conversation itself so the original message is brought into view
  // without unexpectedly moving the whole page or chat layout.
  const threadRect = thread.getBoundingClientRect();
  const rowRect = row.getBoundingClientRect();
  const targetTop = thread.scrollTop + rowRect.top - threadRect.top
    - Math.max(0, (thread.clientHeight - rowRect.height) / 2);

  if (typeof thread.scrollTo === 'function') {
    thread.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
  } else {
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  row.classList.remove('is-replying');
  void row.offsetWidth;
  row.classList.add('is-replying');
  setTimeout(() => row.classList.remove('is-replying'), 1400);
}

function clearChatReply() {
  chatReplyTarget = null;
  const preview = $('#chat-reply-preview');
  if (preview) {
    preview.hidden = true;
    preview.innerHTML = '';
  }
}

async function loadChatReactions(c) {
  if (!isUuidPerson(c.personId) || !c.messages.length) return;
  const ids = c.messages.filter(m => m.id && !String(m.id).startsWith('m_')).map(m => m.id);
  if (!ids.length) return;
  const { data, error } = await supabaseClient
    .from('message_reactions')
    .select('message_id,user_id,emoji')
    .in('message_id', ids);
  if (error) return;
  const grouped = new Map();
  (data || []).forEach(r => {
    const a = grouped.get(r.message_id) || [];
    a.push(r);
    grouped.set(r.message_id, a);
  });
  c.messages.forEach(m => {
    m.reactions = grouped.get(m.id) || [];
  });
}

function renderChatAttachment(m) {
  const path=m.attachmentPath||''; const name=m.attachmentName||'Attachment'; const mime=(m.attachmentMime||'').toLowerCase(); const ext=(name||'').toLowerCase().split('.').pop();
  if(!path)return '';
  const isVideo=mime.startsWith('video/')||['mp4','webm','mov','m4v'].includes(ext);
  const isImage=!isVideo&&(m.type==='image'||mime.startsWith('image/')||['jpg','jpeg','png','webp','gif','heic','heif'].includes(ext));
  if(isImage)return '<button type="button" class="chat-attachment chat-attachment--image" data-chat-attachment="'+esc(path)+'" aria-label="Open image"><span class="chat-attachment-loading">Loading image…</span><img alt="" data-chat-attachment-image hidden /></button>';
  if(isVideo)return '<button type="button" class="chat-attachment chat-attachment--video" data-chat-attachment="'+esc(path)+'" aria-label="Play video"><span class="chat-attachment-loading">Loading video…</span><video data-chat-attachment-video controls playsinline preload="metadata" hidden></video></button>';
  const size=m.attachmentSize?formatChatFileSize(m.attachmentSize):'';
  return '<button type="button" class="chat-attachment chat-attachment--file" data-chat-attachment="'+esc(path)+'" data-chat-attachment-download="true"><span class="chat-attachment-file-icon">'+icon('note')+'</span><span class="chat-attachment-file-copy"><strong>'+esc(name)+'</strong><small>'+esc(mime||'File')+(size?' · '+esc(size):'')+'</small></span><span class="go">'+icon('chev')+'</span></button>';
}
function formatChatFileSize(bytes){const n=Number(bytes||0);if(!n)return '';if(n<1024)return n+' B';if(n<1048576)return (n/1024).toFixed(0)+' KB';return (n/1048576).toFixed(1)+' MB';}
async function hydrateChatAttachments(){for(const node of $('[data-chat-attachment]')){const path=node.dataset.chatAttachment;if(!path)continue;const {data,error}=await supabaseClient.storage.from('ming-message-files').createSignedUrl(path,3600);if(error||!data?.signedUrl){const l=node.querySelector('.chat-attachment-loading');if(l)l.textContent='Attachment unavailable';continue;}const img=node.querySelector('[data-chat-attachment-image]');if(img){img.onload=()=>{img.hidden=false;node.querySelector('.chat-attachment-loading')?.remove();node.removeAttribute('data-chat-attachment');node.removeAttribute('aria-label');};img.onerror=()=>{img.hidden=true;const l=node.querySelector('.chat-attachment-loading');if(l)l.textContent='Image could not be loaded';};img.src=data.signedUrl;}const video=node.querySelector('[data-chat-attachment-video]');if(video){video.onloadedmetadata=()=>{video.hidden=false;node.querySelector('.chat-attachment-loading')?.remove();node.removeAttribute('data-chat-attachment');node.removeAttribute('aria-label');};video.onerror=()=>{video.hidden=true;const l=node.querySelector('.chat-attachment-loading');if(l)l.textContent='Video could not be loaded';};video.src=data.signedUrl;}}}

function renderVoiceMessage(m) {
  const seconds = Math.max(0, Number(m.voiceDuration || 0));
  if (!m.voicePath) {
    return `<div class="chat-voice-note"><span>🎙️</span><span>Voice note</span><span class="chat-voice-duration">${seconds}s</span></div>`;
  }
  return `<div class="chat-voice-note">
    <button type="button" data-voice-path="${esc(m.voicePath)}" aria-label="Play voice note">▶</button>
    <span>Voice note</span>
    <span class="chat-voice-duration">${seconds}s</span>
  </div>`;
}

function updateChatReturnLatest(thread) {
  if (!thread) return;
  const button = thread.querySelector('[data-action="chat-return-latest"]');
  if (!button) return;
  const distanceFromLatest = thread.scrollHeight - thread.clientHeight - thread.scrollTop;
  button.classList.toggle('is-visible', distanceFromLatest > 220);
  button.setAttribute('aria-hidden', distanceFromLatest > 220 ? 'false' : 'true');
}

function renderThread() {
  const c = convoFor(state.activeChat);

  const messages = c.messages.map(m => {
    const reply = m.replyToId ? c.messages.find(x => x.id === m.replyToId) : null;
    const reactions = (m.reactions || []).reduce((acc, r) => {
      const key = r.emoji;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    return `
    <div class="chat-message-row ${m.me ? 'chat-message-row--outgoing' : 'chat-message-row--incoming'}"
         data-message-id="${esc(m.id)}">
      <div class="chat-bubble" data-message-id="${esc(m.id)}">
        ${reply ? `<button type="button" class="chat-bubble__reply" data-action="chat-jump-reply:${esc(reply.id)}" aria-label="Jump to replied message"><strong>${reply.me ? 'You' : esc(byId(state.activeChat)?.short || 'Them')}</strong>${reply.type === 'voice' ? '🎙️ Voice note' : esc((reply.text || '').slice(0, 110))}</button>` : ''}
        ${m.type === 'voice' ? renderVoiceMessage(m) : (m.attachmentPath ? renderChatAttachment(m) : `<span class="chat-bubble__text">${esc(m.text)}</span>`)}
        <span class="chat-bubble__time">${clockTime(m.at)}${m.me ? ` · ${m.read ? 'Read' : 'Sent'}` : ''}</span>
        ${Object.entries(reactions).length ? `<span class="chat-reactions">${Object.entries(reactions).map(([emoji,count]) => tweaklrReactionMarkup(emoji,count)).join('')}</span>` : ''}
      </div>
    </div>`;
  }).join('');

  const typing = chatTyping
    ? `<div class="typing-state"><span class="typing-dots"><i></i><i></i><i></i></span><span>Typing…</span></div>`
    : '';

  const thread = $('#chat-thread');
  thread.innerHTML =
    `<div class="day-sep">Messages are stored securely for this conversation.</div>` +
    messages +
    typing +
    `<button type="button" class="chat-return-latest" data-action="chat-return-latest" aria-label="Jump to latest messages" title="Jump to latest messages" aria-hidden="true">
      <svg viewBox="0 0 40 40" aria-hidden="true" focusable="false">
        <circle cx="20" cy="20" r="15.5" fill="none" stroke="currentColor" stroke-opacity=".24" stroke-width="1"/>
        <path d="M25.8 11.8a9 9 0 1 0 3.1 11.4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
        <path d="M20 15.5v11m-4.5-4.1 4.5 4.5 4.5-4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M28.8 8.1l1 2.4 2.4 1-2.4 1-1 2.4-1-2.4-2.4-1 2.4-1z" fill="currentColor"/>
      </svg>
      <span>Latest</span>
    </button>`;
  if (!thread.dataset.returnLatestBound) {
    thread.addEventListener('scroll', () => updateChatReturnLatest(thread), { passive: true });
    thread.dataset.returnLatestBound = 'true';
  }
  updateChatReturnLatest(thread);
  void hydrateChatAttachments();

}

function tweaklrReactionSvg(id) {
  const emojis = {
    tw_heart: '❤️',
    tw_laugh: '😂',
    tw_wow: '😮',
    tw_sad: '😢',
    tw_angry: '😡',
    tw_like: '👍'
  };
  return '<span class="tweaklr-emoji" aria-hidden="true">' + (emojis[id] || emojis.tw_like) + '</span>';
}

function tweaklrReactionMarkup(id, count) {
  return '<span class="chat-reaction" data-tweaklr-reaction="' + esc(id) + '">' + tweaklrReactionSvg(id) + (count > 1 ? '<b>' + count + '</b>' : '') + '</span>';
}

function canEditChatMessage(m) {
  const ageMs = Date.now() - Number(m?.at || 0);
  return !!m &&
    m.me === true &&
    m.type === 'text' &&
    !m.attachmentPath &&
    !m.voicePath &&
    ageMs >= 0 &&
    ageMs <= 60 * 60 * 1000;
}

function openChatMessageEditor(messageId) {
  const c = convoFor(state.activeChat);
  const m = c.messages.find(x => x.id === messageId);
  if (!m || !canEditChatMessage(m)) {
    toast('You can edit your text messages for up to 1 hour after sending.', 'alert');
    return;
  }

  closeSheet();
  openModal({
    title: 'Edit message',
    lede: 'You can edit this message within 1 hour of sending it.',
    fields: `<div class="field"><label for="chat-edit-text">Message</label><textarea id="chat-edit-text" rows="4">${esc(m.text || '')}</textarea></div>`,
    actions: [
      { t: 'Cancel', cls: 'btn--soft', a: 'close-modal' },
      { t: 'Save changes', cls: 'btn--primary', a: 'chat-edit-save:' + messageId }
    ]
  });
}

async function saveEditedChatMessage(messageId) {
  const c = convoFor(state.activeChat);
  const m = c.messages.find(x => x.id === messageId);
  const input = document.getElementById('chat-edit-text');
  const nextText = input?.value.trim() || '';

  if (!m || !canEditChatMessage(m)) {
    closeModal();
    toast('You can edit your text messages for up to 1 hour after sending.', 'alert');
    return;
  }
  if (!nextText) {
    toast('A message cannot be empty.', 'alert');
    return;
  }

  const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession();
  if (sessionError || !session?.user) {
    toast('Please sign in again.', 'alert');
    return;
  }

  const { data: updatedRows, error } = await supabaseClient
    .rpc('ming_edit_message', {
      p_message_id: messageId,
      p_body: nextText
    })
    .maybeSingle();

  if (error) {
    console.warn('Tweaklr: message edit failed.', error.message);
    if (/function .*ming_edit_message.* not found|Could not find the function/i.test(error.message || '')) {
      toast('Message editing needs the latest database migration. Run supabase_message_edit_migration.sql in Supabase SQL Editor.', 'alert');
    } else {
      toast(error.message || 'Could not edit this message.', 'alert');
    }
    return;
  }
  if (!updatedRows?.id) {
    toast('The database did not confirm this edit. Refresh and try again.', 'alert');
    return;
  }

  m.text = updatedRows.body;
  closeModal();
  renderThread();
  if (state.loaded.messages) renderMessages();
  toast('Message edited', 'check');
}

function openMessageActions(messageId) {
  const c = convoFor(state.activeChat);
  const m = c.messages.find(x => x.id === messageId);
  if (!m) return;

  const editAction = canEditChatMessage(m)
    ? `<button data-action="chat-edit:${esc(messageId)}"><span aria-hidden="true">✎</span><br>Edit</button>`
    : '';

  const reactionChoices = [
    { emoji: '😀', label: 'Smile' },
    { emoji: '😂', label: 'Laugh' },
    { emoji: '😢', label: 'Cry' },
    { emoji: '❤️', label: 'Love' },
    { emoji: '😡', label: 'Angry' },
    { emoji: '👍', label: 'Thumbs up' }
  ];

  openSheet({
    title: 'Message',
    sub: 'React or choose an action',
    body: `
      <div class="chat-reaction-picker" role="group" aria-label="React to message">
        ${reactionChoices.map(({ emoji, label }) => `
          <button type="button" class="chat-reaction-choice" data-action="chat-add-reaction:${esc(messageId)}:${encodeURIComponent(emoji)}" aria-label="${label}" title="${label}">${emoji}</button>
        `).join('')}
      </div>
      <div class="chat-action-grid">
        <button data-action="chat-reply:${esc(messageId)}"><span class="tw-action-icon tw-action-reply" aria-hidden="true"></span><br>Reply</button>
        <button data-action="chat-copy:${esc(messageId)}"><span class="tw-action-icon tw-action-copy" aria-hidden="true"></span><br>Copy</button>
        <button data-action="chat-forward:${esc(messageId)}"><span class="tw-action-icon tw-action-forward" aria-hidden="true"></span><br>Forward</button>
        <button data-action="chat-delete:${esc(messageId)}"><span class="tw-action-icon tw-action-delete" aria-hidden="true"></span><br>Delete</button>
        ${editAction}
      </div>`
  });
}

function openDeleteMessageChoices(messageId) {
  const c = convoFor(state.activeChat);
  const m = c.messages.find(x => x.id === messageId);
  if (!m) return;

  const ageMs = Date.now() - Number(m.at || 0);
  const canDeleteForEveryone =
    m.me &&
    ageMs >= 0 &&
    ageMs <= 30 * 60 * 1000;

  openSheet({
    title: 'Delete message',
    sub: canDeleteForEveryone
      ? 'Choose who should stop seeing this message.'
      : 'This message can only be removed from your view.',
    body: `
      ${canDeleteForEveryone ? `
        <button class="opt" data-action="chat-delete-choice:${esc(messageId)}:everyone">
          <span class="ic">🗑️</span>
          <span class="tx"><span class="t">Delete for everyone</span><span class="s">Remove it from both chats</span></span>
          <span class="go">${icon('chev')}</span>
        </button>` : ''}
      <button class="opt" data-action="chat-delete-choice:${esc(messageId)}:me">
        <span class="ic">⌫</span>
        <span class="tx"><span class="t">Delete for me</span><span class="s">Remove it only from your view</span></span>
        <span class="go">${icon('chev')}</span>
      </button>
    `
  });
}

function confirmChatDelete(messageId, mode) {
  const c = convoFor(state.activeChat);
  const m = c.messages.find(x => x.id === messageId);
  if (!m) return;

  if (mode === 'everyone') {
    closeSheet();
    const ageMs = Date.now() - Number(m.at || 0);
    if (!m.me || ageMs < 0 || ageMs > 30 * 60 * 1000) {
      toast('Delete for everyone is only available for 30 minutes.', 'alert');
      return;
    }

    openModal({
      title: 'Delete for everyone?',
      lede: 'This will permanently remove the message from both chats. This cannot be undone.',
      actions: [
        { t: 'Cancel', cls: 'btn--soft', a: 'close-modal' },
        { t: 'Delete for everyone', cls: 'btn--primary', a: 'confirm-chat-delete:' + messageId + ':everyone' }
      ]
    });
    return;
  }

  closeSheet();
  openModal({
    title: 'Delete for me?',
    lede: 'This removes the message only from your view. The other person will still have it.',
    actions: [
      { t: 'Cancel', cls: 'btn--soft', a: 'close-modal' },
      { t: 'Delete for me', cls: 'btn--primary', a: 'confirm-chat-delete:' + messageId + ':me' }
    ]
  });
}

async function deleteChatMessage(messageId, mode) {
  const c = convoFor(state.activeChat);
  const m = c.messages.find(x => x.id === messageId);
  if (!m) return false;

  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session?.user) {
    toast('Please sign in again.', 'alert');
    return false;
  }

  if (mode === 'me') {
    const { error } = await supabaseClient
      .from('message_hidden_for_users')
      .insert({
        message_id: messageId,
        user_id: session.user.id
      });

    if (error) {
      console.warn('Tweaklr: delete for me failed.', error.message);
      toast('Could not delete this message for you. Run the message delete migration first.', 'alert');
      return false;
    }

    conversations.forEach(convo => {
      convo.messages = convo.messages.filter(x => x.id !== messageId);
    });

    closeModal();
    closeSheet();
    if (state.activeChat) renderThread();
    if (state.loaded.messages) renderMessages();
    toast('Message deleted for you', 'trash');
    return true;
  }

  if (mode !== 'everyone') return false;

  const ageMs = Date.now() - Number(m.at || 0);
  if (!m.me || ageMs < 0 || ageMs > 30 * 60 * 1000) {
    closeModal();
    toast('Delete for everyone is only available for 30 minutes.', 'alert');
    return false;
  }

  const { data: deletedRows, error } = await supabaseClient
    .from('messages')
    .delete()
    .eq('id', messageId)
    .eq('sender_id', session.user.id)
    .select('id');

  if (error) {
    console.warn('Tweaklr: delete for everyone failed.', error.message);
    toast('Could not delete this message. Run the message delete migration first.', 'alert');
    return false;
  }

  if (!deletedRows?.length) {
    closeModal();
    toast('This message can no longer be deleted for everyone.', 'alert');
    return false;
  }

  // The database row is gone first. Clean up any private media owned by
  // the sender afterward so a failed storage cleanup never blocks deletion.
  const cleanupPaths = [];
  if (m.attachmentPath) cleanupPaths.push({ bucket: 'ming-message-files', path: m.attachmentPath });
  if (m.voicePath) cleanupPaths.push({ bucket: 'ming-voice', path: m.voicePath });

  const cleanupFailures = [];
  for (const item of cleanupPaths) {
    const { error: storageError } = await supabaseClient
      .storage
      .from(item.bucket)
      .remove([item.path]);

    if (storageError) cleanupFailures.push(item.bucket);
  }

  conversations.forEach(convo => {
    convo.messages = convo.messages.filter(x => x.id !== messageId);
  });

  closeModal();
  closeSheet();
  if (state.activeChat) renderThread();
  if (state.loaded.messages) renderMessages();

  if (cleanupFailures.length) {
    toast('Message deleted, but its media could not be fully cleaned up.', 'alert');
  } else {
    toast('Message deleted for everyone', 'trash');
  }
  return true;
}

async function copyChatMessage(messageId) {
  const c = convoFor(state.activeChat);
  const m = c.messages.find(x => x.id === messageId);
  if (!m) return;
  if (m.type === 'voice') {
    toast('Voice notes cannot be copied as text.', 'alert');
    return;
  }
  await navigator.clipboard?.writeText(m.text || '');
  closeSheet();
  toast('Message copied', 'check');
}

let chatForwardSourceId = null;
function forwardChatMessage(messageId) {
  const source = convoFor(state.activeChat).messages.find(x => x.id === messageId);
  chatForwardSourceId = source?.id || null;
  if (!source) return;
  const options = conversations.filter(c => c.personId !== state.activeChat).map(c => {
    const p = byId(c.personId);
    return p ? `<button class="opt" data-action="forward-to:${esc(c.personId)}"><span class="tx"><span class="t">${esc(p.short)}</span><span class="s">Forward message</span></span><span class="go">›</span></button>` : '';
  }).join('');
  openSheet({ title:'Forward message', sub:'Choose a conversation', body: options || '<p class="center-note">No other conversations yet.</p>' });
}

async function forwardSelectedChatMessage(targetId) {
  const source = convoFor(state.activeChat).messages.find(x => x.id === chatForwardSourceId);
  if (!source || !isUuidPerson(targetId)) return;
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session?.user) { toast('Please sign in again', 'alert'); return; }
  if (source.type === 'text') {
    closeSheet(); await openChat(targetId); await sendMessage(source.text || ''); return;
  }
  const rpc = await supabaseClient.rpc('ming_send_message_v3', {
    p_recipient_id: targetId, p_body: '', p_message_type: source.type,
    p_voice_path: source.type === 'voice' ? (source.voicePath || null) : null,
    p_voice_duration: source.type === 'voice' ? (source.voiceDuration || null) : null,
    p_reply_to_id: null,
    p_attachment_path: source.type !== 'voice' ? (source.attachmentPath || null) : null,
    p_attachment_name: source.type !== 'voice' ? (source.attachmentName || null) : null,
    p_attachment_mime: source.type !== 'voice' ? (source.attachmentMime || null) : null,
    p_attachment_size: source.type !== 'voice' ? (source.attachmentSize || null) : null
  });
  if (rpc.error) { toast('Could not forward this message.', 'alert'); return; }
  closeSheet(); await openChat(targetId); await loadMingMessages(); renderThread();
  toast('Message forwarded', 'check');
}

async function addChatReaction(messageId, emoji) {
  const c = convoFor(state.activeChat);
  const m = c.messages.find(x => x.id === messageId);
  if (!m || !isUuidPerson(state.activeChat)) return;
  const { data:{session} } = await supabaseClient.auth.getSession();
  if (!session?.user) return;

  const myReactions = (m.reactions || []).filter(r => r.user_id === session.user.id);
  const existing = myReactions.find(r => r.emoji === emoji);
  let error = null;

  if (existing) {
    ({ error } = await supabaseClient
      .from('message_reactions')
      .delete()
      .eq('message_id', messageId)
      .eq('user_id', session.user.id)
      .eq('emoji', emoji));

    if (!error) {
      m.reactions = (m.reactions || []).filter(r => !(r.user_id === session.user.id && r.emoji === emoji));
    }
  } else {
    // Prefer updating an existing per-user reaction atomically when the table
    // has a unique (message_id, user_id) constraint. This avoids a delete/insert
    // race and works when RLS silently returns zero deleted rows.
    if (myReactions.length) {
      const replacement = await supabaseClient
        .from('message_reactions')
        .upsert(
          { message_id: messageId, user_id: session.user.id, emoji },
          { onConflict: 'message_id,user_id' }
        )
        .select('message_id,user_id,emoji')
        .single();

      if (!replacement.error && replacement.data) {
        m.reactions = [
          ...(m.reactions || []).filter(r => r.user_id !== session.user.id),
          replacement.data
        ];
        closeSheet();
        renderThread();
        return;
      }

      // Some deployments permit multiple emoji rows per user instead of
      // enforcing one row per message/user. Retain the existing compatible path.
      ({ error } = await supabaseClient
        .from('message_reactions')
        .delete()
        .eq('message_id', messageId)
        .eq('user_id', session.user.id));

      if (error) {
        console.error('[Tweaklr] Could not replace message reaction:', replacement.error || error);
        toast('Could not update reaction.', 'alert');
        return;
      }
      m.reactions = (m.reactions || []).filter(r => r.user_id !== session.user.id);
    }

    const { data, error: insertError } = await supabaseClient
      .from('message_reactions')
      .insert({ message_id: messageId, user_id: session.user.id, emoji })
      .select('message_id,user_id,emoji')
      .single();

    error = insertError;
    if (!error && data) m.reactions = [...(m.reactions || []), data];
  }

  if (error) {
    console.error('[Tweaklr] Could not update message reaction:', error);
    toast('Could not update reaction.', 'alert');
    return;
  }
  closeSheet();
  renderThread();
}

async function sendMessage(text, options = {}) {
  const p = byId(state.activeChat);
  if (!p || !text) return;
  if (isUuidPerson(state.activeChat)) {
    if (!(await refreshTweaklrBlocks())) {
      toast('Messaging privacy could not be checked. Please try again.', 'alert');
      return;
    }
    if (tweaklrBlockedUserIds.has(state.activeChat)) {
      toast('Unblock this person before sending a message.', 'alert');
      return;
    }
  }

  const replyToId = options.replyToId || chatReplyTarget?.id || null;

  if (isUuidPerson(state.activeChat)) {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session?.user) {
      toast('Please sign in again', 'alert');
      return;
    }

    let row = null;
    let error = null;

    const direct = await supabaseClient
      .from('messages')
      .insert({
        sender_id: session.user.id,
        recipient_id: state.activeChat,
        body: text,
        message_type: 'text',
        reply_to_id: replyToId
      })
      .select('id, sender_id, recipient_id, body, created_at, read_at, message_type, voice_path, voice_duration, reply_to_id')
      .single();

    row = direct.data;
    error = direct.error;

    if (error) {
      const rpc = await supabaseClient.rpc('ming_send_message_v2', {
        p_recipient_id: state.activeChat,
        p_body: text,
        p_message_type: 'text',
        p_voice_path: null,
        p_voice_duration: null,
        p_reply_to_id: replyToId
      });
      row = Array.isArray(rpc.data) ? rpc.data[0] : rpc.data;
      error = rpc.error;
    }

    if (error || !row) {
      toast('Could not send message. ' + (error?.message || ''), 'alert');
      return;
    }

    const c = convoFor(state.activeChat);
    c.messages.push({
      id: row.id, me:true, text:row.body, at:new Date(row.created_at).getTime(),
      read:!!row.read_at, type:row.message_type || 'text',
      voicePath:row.voice_path || '', voiceDuration:row.voice_duration || 0,
      replyToId:row.reply_to_id || null, reactions:[]
    });
    clearChatReply();
    renderThread();
    const t=$('#chat-thread'); if(t) t.scrollTop=t.scrollHeight;
    return;
  }

  const c=convoFor(state.activeChat);
  c.messages.push({id:uid('m'),me:true,text,at:now(),read:true,type:'text',replyToId});
  clearChatReply();
  renderThread();
  const t=$('#chat-thread'); if(t) t.scrollTop=t.scrollHeight;
}

async function recordVoiceNote() {
  if (chatRecording) {
    chatRecording.stop();
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    toast('Voice notes are not supported in this browser.', 'alert');
    return;
  }
  if (!isUuidPerson(state.activeChat)) {
    toast('Voice notes need a connected Tweaklr conversation.', 'alert');
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio:true });
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
    chatRecordChunks = [];
    chatRecordStartedAt = Date.now();
    chatRecording = new MediaRecorder(stream, { mimeType:mime });
    $('#chat-voice')?.classList.add('is-recording');
    $('#chat-input').placeholder = 'Recording voice note… tap mic to stop';
    chatRecording.ondataavailable = e => { if (e.data.size) chatRecordChunks.push(e.data); };
    chatRecording.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      $('#chat-voice')?.classList.remove('is-recording');
      $('#chat-input').placeholder = 'Message';
      const duration = Math.max(1, Math.round((Date.now() - chatRecordStartedAt) / 1000));
      const blob = new Blob(chatRecordChunks, { type:mime });
      chatRecording = null;
      chatRecordChunks = [];
      await uploadVoiceNote(blob, duration);
    };
    chatRecording.start();
  } catch (e) {
    toast('Microphone permission was not granted.', 'alert');
  }
}

async function uploadVoiceNote(blob, duration) {
  const { data:{session} } = await supabaseClient.auth.getSession();
  if (!session?.user) return;
  const path = `${session.user.id}/${crypto.randomUUID()}.webm`;
  const { error:uploadError } = await supabaseClient.storage.from('ming-voice').upload(path, blob, { contentType:blob.type, upsert:false });
  if (uploadError) {
    toast('Could not upload voice note. Run supabase_message_extras.sql first.', 'alert');
    return;
  }

  const replyToId = chatReplyTarget?.id || null;
  const direct = await supabaseClient.from('messages').insert({
    sender_id:session.user.id, recipient_id:state.activeChat, body:'',
    message_type:'voice', voice_path:path, voice_duration:duration, reply_to_id:replyToId
  }).select('id,sender_id,recipient_id,body,created_at,read_at,message_type,voice_path,voice_duration,reply_to_id,attachment_path,attachment_name,attachment_mime,attachment_size').single();

  let row=direct.data, error=direct.error;
  if(error) {
    const rpc=await supabaseClient.rpc('ming_send_message_v2',{
      p_recipient_id:state.activeChat,p_body:'',p_message_type:'voice',
      p_voice_path:path,p_voice_duration:duration,p_reply_to_id:replyToId
    });
    row=Array.isArray(rpc.data)?rpc.data[0]:rpc.data; error=rpc.error;
  }
  if(error||!row) {
    await supabaseClient.storage.from('ming-voice').remove([path]).catch(() => {});
    toast(error?.message || 'Could not save voice note.', 'alert');
    return;
  }

  const c=convoFor(state.activeChat);
  c.messages.push({id:row.id,me:true,text:'',at:new Date(row.created_at).getTime(),read:false,type:'voice',voicePath:path,voiceDuration:duration,replyToId:row.reply_to_id||null,attachmentPath:row.attachment_path||'',attachmentName:row.attachment_name||'',attachmentMime:row.attachment_mime||'',attachmentSize:Number(row.attachment_size||0),reactions:[]});
  clearChatReply();
  renderThread();
  const t=$('#chat-thread'); if(t) t.scrollTop=t.scrollHeight;
}

/* ------------------------------------------------------------
   MOONFLOWER
------------------------------------------------------------ */
const MOON_ROOMS = {
  talk: { title: 'Talk to Me', sub: 'Private conversation', icon: 'spark' },
  journey: { title: 'My Journey', sub: 'Goals and plans', icon: 'target' },
  space: { title: 'My Space', sub: 'Notes and memories', icon: 'note' },
  reminders: { title: 'Reminders', sub: 'Things to hold onto', icon: 'alarm' }
};

/* Native actions rather than a command menu — each just seeds the
   input with a starting thought; the person still decides whether
   and how to send it. */
const MOON_INTENTS = {
  think: { label: 'Think', seed: 'Help me think through something: ' },
  plan: { label: 'Plan', seed: 'I want to plan ' },
  remember: { label: 'Remember', seed: 'Remember this: ' },
  explore: { label: 'Explore', seed: "I'm curious about " },
  reflect: { label: 'Reflect', seed: 'Something on my mind — ' },
  create: { label: 'Create', seed: "I'm trying to make " },
  organize: { label: 'Organize', seed: 'Help me get organized around ' }
};

function renderMoonflower() {
  if (window.MoonSky && !window.MoonSky.onEclipse) {
    // set once, the first time Moonflower is actually opened — moon-sky.js
    // loads after this file, so window.MoonSky doesn't exist at boot()
    window.MoonSky.onEclipse = () => {
      const was = $('#moon-quiet') ? $('#moon-quiet').textContent : '';
      $$('.moon').forEach(el => el.classList.add('is-eclipse'));
      const q = $('#moon-quiet');
      if (q) q.textContent = 'The sky has paused for a moment. Nothing here needs you to do anything.';
      setTimeout(() => {
        $$('.moon').forEach(el => el.classList.remove('is-eclipse'));
        if (q && state.tab === 'moonflower') renderMoonflower();
      }, 10000);
    };
  }
  $('#moon-title').textContent = `${greetWord()}, ${currentUser.name.split(' ')[0]}.`;
  $('#moon-grid').innerHTML = `
    <button class="moon-tile moon-glass" data-action="moon:journey">
      <span class="ic">${icon('target')}</span>
      <span class="t">My Journey</span><span class="s">${moonGoals.length} things you are working towards</span>
    </button>
    <button class="moon-tile moon-glass" data-action="moon:space">
      <span class="ic">${icon('note')}</span>
      <span class="t">My Space</span><span class="s">${moonNotes.length} notes, ${moonNotes.length === 1 ? 'one star' : moonNotes.length + ' stars'}</span>
    </button>
    <button class="moon-tile moon-glass" data-action="moon:reminders">
      <span class="ic">${icon('alarm')}</span>
      <span class="t">Reminders</span><span class="s">${moonReminders.filter(r => !r.done).length} still open</span>
    </button>
    <button class="moon-tile moon-glass" data-action="moon:talk">
      <span class="ic">${icon('spark')}</span>
      <span class="t">Talk to Me</span><span class="s">A conversation that stays here</span>
    </button>`;
  const pending = moonReminders.find(r => !r.done);
  $('#moon-quiet').innerHTML = pending
    ? `Quiet reminder — ${esc(pending.text.toLowerCase())}, ${esc(pending.when.toLowerCase())}. Nothing here is shared with anyone on Tweaklr.`
    : 'Nothing pending. Nothing here is shared with anyone on Tweaklr.';
}

function openMoonRoom(key) {
  const room = MOON_ROOMS[key];
  if (!room) return;
  state.moonRoom = key;
  $('#moonroom-title').textContent = room.title;
  $('#moonroom-sub').textContent = room.sub;
  const form = $('#moon-form');
  const actionBtn = $('#moonroom-action');
  form.hidden = key !== 'talk';
  actionBtn.hidden = key === 'talk' || key === 'space';
  actionBtn.setAttribute('aria-label', key === 'journey' ? 'Add a goal' : 'Add a reminder');
  renderMoonRoom();
  pushStack('moonroom');
  if (key === 'talk') setTimeout(() => { const s = $('#moonroom-scroll'); s.scrollTop = s.scrollHeight; }, 80);
}

/* deterministic-looking scatter for the constellation, stable per note id */
function constellationPos(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return { x: 10 + (h % 82), y: 14 + ((h >> 8) % 72) };
}

function renderMoonRoom() {
  const key = state.moonRoom;
  const host = $('#moonroom-body');

  if (key === 'talk') {
    host.innerHTML = `
    <div class="moon-chips" role="group" aria-label="Ways to start">
      ${Object.entries(MOON_INTENTS).map(([k, v]) => `<button class="moon-chip" data-action="moon-intent:${k}">${esc(v.label)}</button>`).join('')}
    </div>
    <div style="padding:6px 16px 8px;display:flex;flex-direction:column;gap:8px">
      ${moonChat.map(m => `<div class="bub ${m.me ? 'me' : 'them'}">${esc(m.text)}<span class="time">${clockTime(m.at)}</span></div>`).join('')}
    </div>
    <p class="center-note">Private to you. Not stored on any server in this demo.</p>`;
    return;
  }

  if (key === 'journey') {
    host.innerHTML = `<div style="padding:10px 0 0">${moonGoals.length ? moonGoals.map(g => {
      const done = g.steps.filter(s => s.done).length;
      const pct = done / g.steps.length;
      const W = 300, cx = 8, cy = 30, cw = W - 40;
      const path = `M${cx},${cy} C${cx + cw * 0.3},${cy - 22} ${cx + cw * 0.7},${cy + 18} ${cx + cw},${cy - 4}`;
      // an eased point along the curve's general shape — a believable position
      // on the path rather than exact bezier arithmetic
      const approxY = cy - Math.sin(pct * Math.PI) * 14;
      return `<div class="orbit-goal moon-glass">
        <div class="t">${esc(g.title)}</div>
        <div class="s">${esc(g.sub)} · ${done} of ${g.steps.length} done</div>
        <svg class="track" viewBox="0 0 ${W} 56" preserveAspectRatio="none">
          <path class="track-path" d="${path}"/>
          <circle class="track-node" cx="${cx}" cy="${cy}" r="3"/>
          <circle class="track-target" cx="${cx + cw}" cy="${cy - 4}" r="6"/>
          <circle class="track-cur" cx="${cx + cw * pct}" cy="${approxY}" r="5"/>
        </svg>
        <div class="steps">${g.steps.map((s, i) => `
          <button class="check" aria-pressed="${s.done}" data-action="step:${g.id}:${i}">
            <span class="box">${icon('check')}</span><span class="lb">${esc(s.t)}</span>
          </button>`).join('')}</div>
      </div>`;
    }).join('') : emptyState('No trajectory set yet', 'Add the first thing you are working towards.', { t: 'Add a goal', a: 'moon-add' })}</div>`;
    return;
  }

  if (key === 'space') {
    const stars = moonNotes.map(n => {
      const p = constellationPos(n.id);
      return `<button class="cstar" style="left:${p.x}%;top:${p.y}%" data-action="open-note:${n.id}" aria-label="Memory from ${esc(timeAgo(n.at))}"></button>`;
    }).join('');
    host.innerHTML = `
      <div class="constellation">
        ${moonNotes.length ? stars : `<div class="cempty">Your sky is empty. Every note you write becomes a star here.</div>`}
      </div>
      <div class="log-composer moon-glass">
        <div class="date">${esc(new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase())}</div>
        <h4>How was today?</h4>
        <textarea id="log-input" rows="2" placeholder="Write here…" maxlength="600"></textarea>
        <div class="row"><button id="log-save" disabled>Save privately</button></div>
      </div>
      <div id="log-entries">${moonNotes.map(logEntryRow).join('') || ''}</div>`;
    const ta = $('#log-input'), save = $('#log-save');
    ta.addEventListener('input', () => { save.disabled = !ta.value.trim(); });
    save.addEventListener('click', () => {
      const v = ta.value.trim();
      if (!v) return;
      moonNotes.unshift({ id: uid('mn'), at: now(), text: v, place: hasLocation() ? areaLabel() : null });
      ta.value = ''; save.disabled = true;
      renderMoonRoom(); renderMoonflower();
      if (window.MoonSky) window.MoonSky.pulse();
      toast('Saved to My Space', 'check');
    });
    return;
  }

  if (key === 'reminders') {
    const open = moonReminders.filter(r => !r.done).length;
    const W = 320, cy = 30, R = 22;
    const arc = moonReminders.map((r, i) => {
      const t = moonReminders.length > 1 ? i / (moonReminders.length - 1) : 0.5;
      const x = 30 + t * (W - 60);
      const y = cy - Math.sin(t * Math.PI) * R;
      return `<g class="body ${r.done ? 'done' : ''}"><circle cx="${x}" cy="${y}" r="4"/></g>`;
    }).join('');
    host.innerHTML = `
      <div class="orbit-strip"><svg viewBox="0 0 ${W} 60" preserveAspectRatio="none">
        <path class="ring" d="M20,30 Q160,${30 - R * 1.6} 300,30"/>${arc}
      </svg></div>
      <div style="padding:2px 18px 0">${moonReminders.length ? moonReminders.map(r => `
        <button class="check" aria-pressed="${r.done}" data-action="rem:${r.id}" style="border-bottom:1px solid var(--border)">
          <span class="box">${icon('check')}</span>
          <span class="lb">${esc(r.text)}</span>
          <span class="when">${esc(r.when)}</span>
        </button>`).join('') : emptyState('Nothing to remember', 'Add something small. Moonflower will keep it for you.', { t: 'Add a reminder', a: 'moon-add' })}</div>
      ${moonReminders.length ? `<p class="center-note">${open} still open</p>` : ''}`;
  }
}

function logEntryRow(n) {
  return `<div class="log-entry moon-glass" id="log-${n.id}">
    <div class="d">${esc(new Date(n.at).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' }))} · ${esc(timeAgo(n.at))}${n.place ? ` · ${esc(n.place)}` : ''}</div>
    <p>${esc(n.text)}</p>
    <div class="del"><button class="btn btn--sm btn--danger" data-action="del-note:${n.id}">${icon('trash')}Delete</button></div>
  </div>`;
}

function moonAdd() {
  const key = state.moonRoom;
  if (key === 'journey') {
    openModal({
      title: 'Add a goal',
      lede: 'Break it into a few small steps you can actually tick off.',
      fields: `<div class="field"><label for="mf-goal">Goal</label><input id="mf-goal" type="text" placeholder="Run 5km without stopping" /></div>
        <div class="field"><label for="mf-sub">Timeframe</label><input id="mf-sub" type="text" placeholder="Three mornings a week" /></div>
        <div class="field"><label for="mf-steps">Steps, one per line</label><textarea id="mf-steps" placeholder="Two runs a week&#10;Reach 3km&#10;Reach 5km"></textarea></div>`,
      actions: [{ t: 'Cancel', cls: 'btn--soft', a: 'close-modal' }, { t: 'Add goal', cls: 'btn--primary', a: 'save-goal' }]
    });
  } else {
    openModal({
      title: 'Add a reminder',
      lede: 'Something small you do not want to lose.',
      fields: `<div class="field"><label for="mf-rem">Remember</label><input id="mf-rem" type="text" placeholder="Call home" /></div>
        <div class="field"><label for="mf-when">When</label><input id="mf-when" type="text" placeholder="Sunday, 6pm" /></div>`,
      actions: [{ t: 'Cancel', cls: 'btn--soft', a: 'close-modal' }, { t: 'Add reminder', cls: 'btn--primary', a: 'save-rem' }]
    });
  }
}

function moonReply(text) {
  const t = text.toLowerCase();
  if (t.includes('tomorrow') || t.includes('plan')) {
    return 'Let us keep tomorrow simple. One thing that matters, one thing that is easy, one thing for you. What is the one that matters?';
  }
  if (t.includes('tired') || t.includes('stress') || t.includes('hard') || t.includes('sad')) {
    return 'That sounds heavy. You do not have to solve it tonight. What would make the next hour a little kinder?';
  }
  if (t.includes('idea') || t.includes('build') || t.includes('project')) {
    return 'Say more about it. What would the smallest first version look like — something you could finish this week?';
  }
  if (t.endsWith('?')) {
    return 'Good question. Let us take it apart: what do you already know, and what are you actually deciding between?';
  }
  return 'Noted. I will keep that here. What else is on your mind?';
}

/* A small heuristic layer on top of moonReply — this is still a
   scripted demo, not a real model, but it acts on Moonflower's own
   data rather than only talking about it: it can store a memory,
   recall one, or offer to turn a deadline-shaped sentence into a
   Journey. Nothing here reaches outside the current session. */
function moonAct(text) {
  const t = text.toLowerCase();

  if (state.moonPendingJourney && /^\s*(yes|yeah|sure|please|do it|go ahead|ok(ay)?)\b/i.test(text)) {
    const title = state.moonPendingJourney;
    state.moonPendingJourney = null;
    moonGoals.unshift({ id: uid('g'), title, sub: 'Started from a conversation', steps: [{ t: 'Define the first concrete step', done: false }] });
    if (state.moonRoom === 'journey') renderMoonRoom();
    renderMoonflower();
    return `Done — "${title}" is in My Journey now.`;
  }
  state.moonPendingJourney = null;

  const remember = text.match(/remember (?:that |this[:,]?\s*)?(.+)/i);
  if (remember && remember[1].trim().length > 3) {
    let note = remember[1].trim().replace(/\.+$/, '');
    note = note.charAt(0).toUpperCase() + note.slice(1) + '.';
    moonNotes.unshift({ id: uid('mn'), at: now(), text: note, place: hasLocation() ? areaLabel() : null });
    renderMoonflower();
    if (state.moonRoom === 'space') renderMoonRoom();
    return `Kept — it's in My Space now${hasLocation() ? ', tagged near ' + areaLabel() : ''}.`;
  }

  const recall = t.match(/what was i (?:working (?:on|toward)|doing)[^\d]*(\d+)\s*(day|week|month)s?\s*ago/);
  if (recall) {
    const n = +recall[1], unit = recall[2];
    const span = unit === 'day' ? n * HOUR * 24 : unit === 'week' ? n * HOUR * 24 * 7 : n * HOUR * 24 * 30;
    const target = now() - span;
    const goal = moonGoals[moonGoals.length - 1];
    const note = moonNotes.filter(nt => nt.at <= target + HOUR * 24 * 3).sort((a, b) => Math.abs(a.at - target) - Math.abs(b.at - target))[0];
    const bits = [];
    if (goal) bits.push(`working toward "${goal.title}"`);
    if (note) bits.push(`you had written "${note.text.length > 64 ? note.text.slice(0, 64) + '…' : note.text}"`);
    if (bits.length) return `Around then you were ${bits.join(', and ')}.`;
    return "I don't have anything from that far back yet — Moonflower only remembers what you've told it.";
  }

  if (/\b(exam|deadline|interview|certification|test|assessment)\b/.test(t)) {
    state.moonPendingJourney = text.replace(/\.+$/, '');
    return `That sounds worth tracking properly rather than just saying out loud. Want me to set "${state.moonPendingJourney}" as a goal in My Journey?`;
  }

  return moonReply(text);
}

/* ------------------------------------------------------------
   PROFILE
------------------------------------------------------------ */
let profileContentTab = 'posts';
let profileLikedUpdates = [];
let profileLikesLoaded = false;

async function loadMingProfileLikedUpdates() {
  if (!isUuidPerson(currentUser.id)) return false;

  try {
    const { data: rows, error } = await supabaseClient
      .rpc('get_daily_updates', { p_limit: 100 });

    if (error) {
      console.warn('Tweaklr: liked Daily Updates could not be loaded.', error.message);
      return false;
    }

    profileLikedUpdates = (rows || [])
      .filter(row => row.liked === true)
      .map(row => {
        const name = row.author_display_name || 'Tweaklr user';
        const profile = {
          id: row.author_id,
          name,
          short: name.split(' ')[0] || name,
          hue: 24,
          tag: row.author_headline || 'Tweaklr member',
          interests: [],
          bio: row.author_bio || '',
          avatarUrl: row.author_avatar_url || '',
          username: row.author_username ? '@' + row.author_username.replace(/^@/, '') : '',
          activity: row.author_activity || '',
          status: 'on',
          visitor: false,
          km: null
        };

        if (row.author_id !== currentUser.id) {
          const existing = mingConnectionProfiles.get(row.author_id);
          mingConnectionProfiles.set(row.author_id, { ...(existing || {}), ...profile });
        }

        return {
          id: row.id,
          authorId: row.author_id,
          kind: row.kind,
          title: row.title,
          body: row.body,
          createdAt: new Date(row.created_at).getTime(),
          likes: Number(row.likes || 0),
          liked: true,
          comments: [],
          commentsCount: Number(row.comments_count || 0)
        };
      });

    profileLikesLoaded = true;
    return true;
  } catch (error) {
    console.warn('Tweaklr: liked Daily Updates load failed.', error);
    return false;
  }
}

function profileLikedUpdateCard(u) {
  const p = u.authorId === currentUser.id ? currentUser : byId(u.authorId);
  const h = hoursLeft(u);
  const pct = Math.max(2, Math.round((h / 24) * 100));

  return `<article class="upd" id="profile-upd-${u.id}">
    <div class="upd-top">
      ${avatar(p, 36)}
      <div class="who">
        <div class="n">${esc(p.short || p.name)}</div>
        <div class="m">Liked by you · ${esc(timeAgo(u.createdAt))}</div>
      </div>
      ${kindPill(u.kind)}
    </div>
    <h3>${esc(u.title)}</h3>
    <p>${esc(u.body)}</p>
    <div class="upd-foot">
      <span class="act is-on" aria-label="You liked this update">${icon('heart')}<span>${u.likes}</span></span>
      <span class="act" aria-label="Replies">${icon('chat')}<span>${u.commentsCount}</span></span>
      <span class="expiry"><span class="life ${h < 4 ? 'low' : ''}"><i style="width:${pct}%"></i></span>${esc(lifeLabel(u))}</span>
    </div>
  </article>`;
}

function renderProfile() {
  const mine = liveUpdates().filter(u => u.authorId === currentUser.id);
  $('#profile-body').innerHTML = `
    <div class="phead">
      <button type="button" data-action="avatar-menu" aria-label="Profile photo" style="border:0;background:none;padding:0;cursor:pointer">
        ${ringAvatar(currentUser, 88, true)}
      </button>
      <div class="who">
        <h1>${esc(currentUser.name)}</h1>
        <div class="u">${esc(currentUser.username)}</div>
        <div class="u" style="margin-top:6px;color:var(--coffee)">${esc(currentUser.headline)}</div>
      </div>
    </div>
    <div class="pmeta">
      <p class="bio">${esc(currentUser.bio)}</p>
      <div class="line">
        <span>${icon('pin')}${esc(hasLocation() ? areaLabel() : 'Location off')}</span>
        <span>${icon('case')}${esc(currentUser.tags.join(' · '))}</span>
      </div>
    </div>
    <div class="stats">
      <button data-action="go-connections"><div class="v">${connections.length}</div><div class="l">Connections</div></button>
      <button data-action="go-updates"><div class="v">${mine.length}</div><div class="l">Live updates</div></button>
      <button class="profile-messages-stat" data-action="go-messages">
        <div class="v">${conversations.reduce((n, c) => n + c.unread, 0)}</div>
        <span class="profile-message-unread-badge" id="profile-message-unread-badge" aria-label="Unread messages">${Math.min(99, conversations.reduce((n, c) => n + c.unread, 0))}</span>
        <div class="l">Messages</div>
      </button>
    </div>
    <div class="now">
      <div><div class="lbl">Right now</div><div class="val">${esc(currentUser.activity)}</div></div>
      <button class="edit" data-action="edit-activity">Change</button>
    </div>
    <div style="display:flex;gap:10px;padding:18px 18px 0">
      <button class="btn btn--primary" style="flex:1" data-action="edit-profile">${icon('edit')}Edit profile</button>
      <button class="btn btn--soft" style="flex:1" data-action="go-connections">${icon('users')}Connections</button>
    </div>
    <div class="section">${sectionHead('Interests and services')}
      <div class="tags">${currentUser.interests.map(i => `<span class="tag-pill">${esc(i)}</span>`).join('')}</div>
    </div>
    
    <div class="section">${sectionHead('Your account')}
      <div class="menu-list">
        <button class="menu-item profile-account-messages" data-action="go-messages">${icon('chat')}<span class="t">Messages</span><span class="profile-account-message-dot" id="profile-account-message-dot" aria-label="Unread messages"></span><span class="go">${icon('chev')}</span></button>
        <button class="menu-item" data-action="go-notifications">${icon('bell')}<span class="t">Notifications</span><span class="go">${icon('chev')}</span></button>
        <button type="button" class="menu-item" data-action="go-spaces">${icon('sp-store')}<span class="t">Your Spaces</span><span class="go">${icon('chev')}</span></button>
        <button class="menu-item" data-action="go-wallet">${icon('sp-wallet')}<span class="t">Tweaklr Wallet</span><span class="go">${icon('chev')}</span></button>
        <button class="menu-item" data-action="privacy">${icon('shield')}<span class="t">Location and privacy</span><span class="go">${icon('chev')}</span></button>
        <button class="menu-item" data-action="settings">${icon('settings')}<span class="t">Settings</span><span class="go">${icon('chev')}</span></button>
      </div>
      <p class="center-note">${esc(currentUser.joined)}</p>
    </div>`;

  // Bind this dynamically-rendered control directly. This keeps Profile → Your Spaces
  // independent of the global delegated click handler.
  const spacesButton = $('#profile-body [data-action="go-spaces"]');
  if (spacesButton) {
    spacesButton.addEventListener('click', async e => {
      e.preventDefault();
      e.stopPropagation();
      closeSheet();
      try {
        await openSpaces();
      } catch (error) {
        console.error('Tweaklr: Your Spaces direct navigation failed:', error);
        toast('Your Spaces could not be loaded right now.', 'alert');
      }
    });
  }
}

function usernameChangeAvailable() {
  if (!currentUser.usernameChangedAt) return true;

  const changedAt = new Date(currentUser.usernameChangedAt).getTime();
  if (!Number.isFinite(changedAt)) return true;

  const next = new Date(changedAt);
  next.setMonth(next.getMonth() + 3);

  return now() >= next.getTime();
}

function usernameNextChangeDate() {
  if (!currentUser.usernameChangedAt) return null;

  const changedAt = new Date(currentUser.usernameChangedAt).getTime();
  if (!Number.isFinite(changedAt)) return null;

  const next = new Date(changedAt);
  next.setMonth(next.getMonth() + 3);
  return next;
}

function normalizeMingProfileList(value, limit) {
  const seen = new Set();
  return String(value || '').split(/[#\,\n]+/).map(item => item.trim().replace(/^#+/, '').trim()).filter(Boolean).map(item => item.replace(/\s+/g, ' ')).filter(item => /^[A-Za-z0-9][A-Za-z0-9 _&+.'-]*$/.test(item)).map(item => item.toLowerCase()).filter(item => { if (seen.has(item)) return false; seen.add(item); return true; }).slice(0, limit);
}

function validateMingProfileList(value, limit, label) {
  const raw = String(value || '').trim();
  if (!raw) return { ok: true, items: [] };
  const chunks = raw.split(/[#\,\n]+/).map(item => item.trim().replace(/^#+/, '').trim()).filter(Boolean);
  if (chunks.length > limit) return { ok: false, message: label + ' can contain up to ' + limit + ' items.' };
  const invalid = chunks.find(item => !/^[A-Za-z0-9][A-Za-z0-9 _&+.'-]*$/.test(item.replace(/\s+/g, ' ')));
  if (invalid) return { ok: false, message: 'Remove unsupported characters from ' + label + ': ' + invalid };
  const normalized = chunks.map(item => item.replace(/\s+/g, ' ').toLowerCase());
  if (new Set(normalized).size !== normalized.length) return { ok: false, message: label + ' cannot contain duplicates.' };
  return { ok: true, items: normalized };
}

function editProfile() {
  const usernameLocked = !usernameChangeAvailable();
  const nextUsernameChange = usernameNextChangeDate();

  openModal({
    title: 'Edit profile',
    lede: 'Keep it human. People nearby see this before they see anything else.',
    fields: `
      <div class="field">
        <label>Profile photo</label>
        <div style="display:flex;align-items:center;gap:14px">
          ${ringAvatar(currentUser, 64, false)}
          <label class="btn btn--soft" style="cursor:pointer;flex:1;text-align:center">
            ${currentUser.avatarUrl ? 'Change photo' : 'Add your photo'}
            <input id="ep-avatar" type="file" accept="image/*" capture="user" style="display:none" />
          </label>
        </div>
        <div class="count">Use a clear photo of yourself. People are more likely to recognize and connect with you when they can see the person behind the profile.</div>
      </div>

      <div class="field">
        <label for="ep-name">Name</label>
        <input id="ep-name" type="text" value="${esc(currentUser.name)}" />
      </div>

      <div class="field">
        <label for="ep-username">Username</label>
        <input id="ep-username" type="text" value="${esc(currentUser.username.replace(/^@/, ''))}" maxlength="30" ${usernameLocked ? 'disabled' : ''} />
        <div class="count">${usernameLocked && nextUsernameChange
          ? 'Username can be changed again on ' + nextUsernameChange.toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' }) + '.'
          : 'You can change your username once every 3 months.'}</div>
      </div>

      <div class="field">
        <label for="ep-head">What you do</label>
        <input id="ep-head" type="text" value="${esc(currentUser.headline)}" />
      </div>

      <div class="field">
        <label for="ep-bio">Short bio</label>
        <textarea id="ep-bio" maxlength="220">${esc(currentUser.bio)}</textarea>
      </div>

      <div class="field">
        <label for="ep-tags">Tags</label>
        <input id="ep-tags" type="text" value="${esc(currentUser.tags.map(t => '#' + String(t).replace(/^#+/, '')).join(' '))}" maxlength="200" placeholder="#appsec #cybersecurity #coffee" />
        <div class="count">Separate tags with # · e.g. #appsec #cybersecurity #coffee.</div>
      </div>

      <div class="field">
        <label for="ep-interests">Interests and services</label>
        <input id="ep-interests" type="text" value="${esc(currentUser.interests.map(i => '#' + String(i).replace(/^#+/, '')).join(' '))}" maxlength="300" placeholder="#football #music #design" />
        <div class="count">Separate interests with # · e.g. #football #music #design.</div>
      </div>

      <div class="field">
        <label>Your area</label>
        <div style="padding:13px 14px;border:1px solid var(--border);border-radius:var(--r-md);background:var(--surface-2);font-size:14.5px;color:var(--muted)">${esc(hasLocation() ? areaLabel() : 'Location off')}</div>
        <div class="count">Set by your device, not by you. Others only ever see a rounded distance.</div>
      </div>`,
    actions: [{ t: 'Cancel', cls: 'btn--soft', a: 'close-modal' }, { t: 'Save changes', cls: 'btn--primary', a: 'save-profile' }]
  });
}

/* ------------------------------------------------------------
   SEARCH
------------------------------------------------------------ */
let searchTimer = null;
let searchDataReady = false;
let searchDataLoading = null;
let searchPeople = [];
let searchPlaces = [];
let searchDiscoverableSpaces = [];

function mapSearchProfile(row) {
  const name = row.display_name || 'Tweaklr user';
  const tags = Array.isArray(row.tags) ? row.tags : [];
  const interests = Array.isArray(row.interests) ? row.interests : [];
  let hue = 0;
  const seed = row.id + ':' + name;
  for (let i = 0; i < seed.length; i++) hue = (hue * 31 + seed.charCodeAt(i)) % 360;
  return {
    id: row.id, name, short: name.split(' ')[0] || name, hue,
    tag: row.headline || tags.slice(0, 3).join(' · ') || 'Tweaklr member',
    tags, interests, bio: row.bio || '', avatarUrl: row.avatar_url || '',
    username: row.username ? '@' + row.username.replace(/^@/, '') : '',
    activity: row.activity || '', status: 'on', visitor: false,
    km: row.distance_km == null ? null : Number(row.distance_km)
  };
}

async function loadMingSearchData() {
  if (searchDataLoading) return searchDataLoading;
  searchDataLoading = (async () => {
    try {
      const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession();
      if (sessionError || !session?.user) return false;

      const profilesPromise = supabaseClient.rpc('get_discoverable_profiles', { p_radius_km: null });
      const updatesPromise = supabaseClient.rpc('get_daily_updates', { p_limit: 100 });
      const placesPromise = hasLocation()
        ? supabaseClient.rpc('get_discover_places', {
            p_latitude: Number(state.userLocation.latitude.toFixed(7)),
            p_longitude: Number(state.userLocation.longitude.toFixed(7)),
            p_radius_km: 5
          })
        : Promise.resolve({ data: [], error: null });

      // Discoverable Spaces are global search data, not just the Spaces
      // already joined by the current user. The RPC is optional until its
      // migration has been run; the local Space mirror remains a safe fallback.
      const spacesPromise = supabaseClient.rpc('get_discoverable_ming_spaces');

      const [profilesResult, updatesResult, placesResult, spacesResult] = await Promise.all([
        profilesPromise, updatesPromise, placesPromise, spacesPromise
      ]);

      searchPeople = profilesResult.error ? [] : (profilesResult.data || []).map(mapSearchProfile);
      searchPeople.forEach(p => mingConnectionProfiles.set(p.id, p));

      if (updatesResult.error) {
        dailyUpdates = [];
      } else {
        dailyUpdates = (updatesResult.data || []).map(row => {
          const name = row.author_display_name || 'Tweaklr user';
          const existing = mingConnectionProfiles.get(row.author_id);
          mingConnectionProfiles.set(row.author_id, {
            ...(existing || {}),
            id: row.author_id, name, short: name.split(' ')[0] || name,
            hue: existing?.hue || 24,
            tag: row.author_headline || existing?.tag || 'Tweaklr member',
            interests: existing?.interests || [],
            bio: row.author_bio || existing?.bio || '',
            avatarUrl: row.author_avatar_url || existing?.avatarUrl || '',
            username: row.author_username ? '@' + row.author_username.replace(/^@/, '') : (existing?.username || ''),
            activity: row.author_activity || existing?.activity || '',
            status: 'on', visitor: row.kind === 'visitor',
            km: searchPeople.find(p => p.id === row.author_id)?.km ?? existing?.km ?? null
          });
          return {
            id: row.id, authorId: row.author_id, kind: row.kind,
            title: row.title, body: row.body,
            createdAt: new Date(row.created_at).getTime(),
            likes: Number(row.likes || 0), liked: !!row.liked,
            comments: [], commentsCount: Number(row.comments_count || 0)
          };
        });
      }

      searchPlaces = placesResult.error ? [] : (placesResult.data || []).map(row => ({
        id: row.id, name: row.name, kind: row.kind, note: row.note || '',
        hue: 26, km: row.distance_km == null ? null : Number(row.distance_km),
        saved: !!row.saved_by_me
      }));

      searchDiscoverableSpaces = spacesResult.error
        ? []
        : (spacesResult.data || []).map(row => ({
            id: row.id,
            name: row.name,
            description: row.description || '',
            nature: row.nature,
            discoverable: true,
            expiresAt: row.expires_at ? new Date(row.expires_at).getTime() : null
          }));

      searchDataReady = true;
      return true;
    } catch (error) {
      console.warn('Tweaklr: Search data load failed.', error);
      searchDataReady = false;
      return false;
    } finally {
      searchDataLoading = null;
    }
  })();
  return searchDataLoading;
}

async function openSearch() {
  pushStack('search');
  renderSearch('loading');
  await loadMingSearchData();
  renderSearch('idle');
  setTimeout(() => $('#search-input').focus(), 80);
}

/* Branded loading state shared by Tweaklr screens. Kept presentation-only. */
function tweaklrLoadingMarkup(message = 'Nearby is everything…') {
  return '<div class="tweaklr-loading" role="status" aria-live="polite">' +
    '<div class="tweaklr-loading-orbit" aria-hidden="true">' +
      '<span class="tweaklr-loading-dot tweaklr-loading-dot--one"></span>' +
      '<span class="tweaklr-loading-dot tweaklr-loading-dot--two"></span>' +
      '<span class="tweaklr-loading-dot tweaklr-loading-dot--three"></span>' +
      '<span class="tweaklr-loading-core">T</span>' +
    '</div>' +
    '<div class="tweaklr-loading-brand">Tweaklr<span class="tweaklr-loading-pulse">✦</span></div>' +
    '<div class="tweaklr-loading-message">' + esc(message) + '</div>' +
    '<div class="tweaklr-loading-motto">NEARBY IS EVERYTHING</div>' +
    '<div class="tweaklr-loading-track" aria-hidden="true"><span></span></div>' +
  '</div>';
}

function renderSearch(mode, q = '') {
  const host = $('#search-body');
  if (mode === 'idle') {
    host.innerHTML = `
      <div class="section" style="margin-top:14px">
        <div class="search-guidance"><strong>People are found by @username.</strong> Use a word or #tag for everything else.</div>
        ${sectionHead('Try searching for')}
        <div class="chips" style="flex-wrap:wrap">
          ${['photographer', 'football', 'coffee', 'developer', 'visiting', 'market'].map(t => `<button class="chip" data-action="search-term:${t}">${t}</button>`).join('')}
        </div>
      </div>
      <div class="section">${sectionHead('People near you')}
        ${searchPeople.slice(0, 4).map(p => `
          <button class="prow" data-action="person:${p.id}">${avatar(p, 44)}
            <div class="meta"><div class="n">${esc(p.name)}</div><div class="s">${esc(p.tag)}</div></div>
            <div class="right"><div class="d">${esc(distLabel(p.km))}</div></div>
          </button>`).join('')}
      </div>`;
    return;
  }
  if (mode === 'loading') {
    host.innerHTML = tweaklrLoadingMarkup('Finding your people and places…');
    return;
  }

  const isUsernameSearch = q.trim().startsWith('@');
  const t = q.replace(/^[@#]/, '').toLowerCase();

  // People are intentionally username-only. Other searches should not
  // accidentally surface people by first name, bio, activity, or tags.
  const rp = isUsernameSearch
    ? searchPeople.filter(p => String(p.username || '').replace(/^@/, '').toLowerCase().includes(t))
    : [];
  const updateSearchText = u => {
    const kindLabel = KINDS[u.kind]?.label || u.kind || '';
    return [kindLabel, u.title, u.body].filter(Boolean).join(' ').toLowerCase();
  };
  const ru = dailyUpdates.filter(u =>
    ['general', 'visitor'].includes(u.kind) && updateSearchText(u).includes(t)
  );
  const ro = dailyUpdates.filter(u =>
    ['service', 'sale'].includes(u.kind) && updateSearchText(u).includes(t)
  );
  const ra = dailyUpdates.filter(u =>
    u.kind === 'activity' && updateSearchText(u).includes(t)
  ).map(u => ({
    ...u,
    hour: clockTime(u.createdAt),
    day: new Date(u.createdAt).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }),
    place: u.title,
    going: 0
  }));
  const rj = dailyUpdates.filter(u =>
    u.kind === 'hiring' && updateSearchText(u).includes(t)
  );
  const rh = dailyUpdates.filter(u =>
    ['talk', 'alert'].includes(u.kind) && updateSearchText(u).includes(t)
  );
  const rl = searchPlaces.filter(p =>
    (p.name + ' ' + p.kind + ' ' + p.note).toLowerCase().includes(t)
  );
  const spaceSearchSource = searchDiscoverableSpaces.length
    ? searchDiscoverableSpaces
    : Server.db.spaces;
  const rs = spaceSearchSource.filter(s => {
    if (s.nature === 'silly' || !s.discoverable || (s.expiresAt && s.expiresAt <= now())) return false;
    return [s.name, s.description, s.nature, NATURES[s.nature]?.label]
      .filter(Boolean).join(' ').toLowerCase().includes(t);
  });
  const tagSet = new Set();
  const tagPeople = [];
  searchPeople.forEach(p => {
    const profileTags = [...(p.tags || []), ...(p.interests || [])];
    profileTags.forEach(tag => {
      const cleanTag = String(tag).replace(/^#+/, '').trim();
      if (cleanTag.toLowerCase().includes(t)) tagSet.add(cleanTag);
    });
    if (!isUsernameSearch && profileTags.some(tag => String(tag).replace(/^#+/, '').trim().toLowerCase() === t)) tagPeople.push(p);
  });

  const total = rp.length + tagPeople.length + tagSet.size + ru.length + ro.length + ra.length +
    rj.length + rh.length + rl.length + rs.length;

  if (!total) {
    host.innerHTML = emptyState(`Nothing for "${q}"`, 'Try a shorter word, or widen your discovery area in Nearby.', { t: 'Open Nearby', a: 'go-nearby' });
    return;
  }

  let html = `
    <div class="search-result-head">
      <div class="search-result-query">${esc(q)}</div>
      <div class="search-result-count">${total} result${total === 1 ? '' : 's'}</div>
    </div>`;

  if (rp.length) html += `<div class="res-group"><div class="gh">People <span class="search-group-count">${rp.length}</span></div>${rp.map(p => `
    <button class="prow search-person-row" data-action="person:${p.id}">${avatar(p, 46)}
      <div class="meta">
        <div class="n">${esc(p.name)}</div>
        <div class="s">${esc(p.username || '@username')} · ${esc(p.tag)}</div>
      </div>
      <div class="right"><div class="d">${esc(distLabel(p.km))}</div></div>
    </button>`).join('')}</div>`;

  if (tagPeople.length) html += '<div class="res-group"><div class="gh">People with #' + esc(t) + ' <span class="search-group-count">' + tagPeople.length + '</span></div>' + tagPeople.map(p => '<button class="prow search-person-row" data-action="person:' + p.id + '">' + avatar(p, 46) + '<div class="meta"><div class="n">' + esc(p.name) + '</div><div class="s">' + esc(p.username || '@username') + ' · ' + esc(p.tag) + '</div></div><div class="right"><div class="d">' + esc(distLabel(p.km)) + '</div></div></button>').join('') + '</div>';

  if (tagSet.size) {
    html += '<div class="res-group"><div class="gh">Tags</div><div class="chips" style="flex-wrap:wrap;padding:8px 0 4px">' +
      Array.from(tagSet).map(tag => '<button class="chip" data-action="search-term:' + esc(tag) + '">#' + esc(tag) + '</button>').join('') +
      '</div></div>';
  }

  if (ru.length) html += `<div class="res-group"><div class="gh">Daily Updates</div>${ru.map(updateCard).join('')}</div>`;

  if (ro.length) html += `<div class="res-group"><div class="gh">Opportunities</div><div class="rail">${ro.map(o => {
    const p = byId(o.authorId);
    return `<button class="ocard" data-action="person:${o.authorId}"><div class="k">${esc(o.kind)}</div><h3>${esc(o.title)}</h3>
      <p>${esc(o.body)}</p><div class="f">${avatar(p, 28, { status: false })}<span>${esc(p.short)}</span></div></button>`;
  }).join('')}</div></div>`;

  if (rj.length) html += '<div class="res-group"><div class="gh">Job offerings</div>' + rj.map(updateCard).join('') + '</div>';
  if (rh.length) html += '<div class="res-group"><div class="gh">Need help</div>' + rh.map(updateCard).join('') + '</div>';

  if (ra.length) html += `<div class="res-group"><div class="gh">Activities</div>${ra.map(a => `
    <button class="acard" data-action="activity:${a.id}">
      <div class="when"><div class="h">${esc(a.hour)}</div><div class="d">${esc(a.day)}</div></div>
      <div class="info"><div class="t">${esc(a.title)}</div><div class="s">${esc(a.place)} · ${a.going} going</div></div>
      <span class="go">${icon('chev')}</span></button>`).join('')}</div>`;

  if (rl.length) html += `<div class="res-group"><div class="gh">Discoverable places</div><div class="rail">${rl.map(pl => `
    <button class="plcard" data-action="place:${pl.id}">
      <div class="art" style="background:linear-gradient(155deg,hsl(${pl.hue} 34% 84%),hsl(${(pl.hue + 20) % 360} 28% 62%))"></div>
      <div class="body"><div class="n">${esc(pl.name)}</div><div class="s">${esc(pl.kind)}</div><div class="d">${esc(pl.km == null ? 'Nearby place' : distLabel(pl.km))}</div></div>
    </button>`).join('')}</div></div>`;

  if (rs.length) {
    html += '<div class="res-group"><div class="gh">Discoverable Spaces</div><div class="rail">' +
      rs.map(spc => '<button class="sp-tile" data-sp="open:' + spc.id + '">' +
        '<div class="cover" style="background:' + (NATURES[spc.nature]?.swatch || 'var(--surface-2)') + '">' +
        '<span class="nature">' + esc(NATURES[spc.nature]?.label || 'Space') + '</span></div>' +
        '<div class="info"><div class="n">' + esc(spc.name) + '</div>' +
        (spc.description ? '<div class="d">' + esc(spc.description) + '</div>' : '') +
        '<div class="f"><span>' + esc(NATURES[spc.nature]?.label || 'Space') + ' · Discoverable</span></div>' +
        '</div></button>').join('') +
      '</div></div>';
  }

  host.innerHTML = html + '<div class="spacer"></div>';
}

/* ------------------------------------------------------------
   NOTIFICATIONS
------------------------------------------------------------ */
const NOTIF_ICON = { connect: 'users', update: 'spark', message: 'chat', nearby: 'pin', expiry: 'clock', request: 'users', like: 'heart', comment: 'chat' };

function renderNotifications() {
  const host = $('#notif-body');
  host.innerHTML = notifications.length ? notifications.map(n => `
    <button class="notif" data-action="notif:${n.id}">
      <span class="ic">${icon(NOTIF_ICON[n.type] || 'bell')}</span>
      <span class="c"><span class="t" style="display:block">${n.text}</span><span class="ti" style="display:block">${esc(timeAgo(n.at))}</span></span>
      ${n.read ? '' : '<span class="unread-dot"></span>'}
    </button>`).join('') : emptyState("You're all caught up.", 'New connections, nearby activity and messages will show up here.');
}

function updateNotifDot() {
  const unread = notifications.some(n => !n.read);
  $('#notif-dot').hidden = !unread;
}
function updateProfileMessageUnreadBadge() {
  const badge = $('#profile-message-unread-badge');
  const unread = conversations.reduce((n, c) => n + (Number(c.unread) || 0), 0);
  if (badge) {
    badge.textContent = unread > 99 ? '99+' : String(unread);
    badge.hidden = unread === 0;
  }
  const dot = $('#profile-account-message-dot');
  if (dot) dot.hidden = unread === 0;
}

/* ------------------------------------------------------------
   TWEAKLR NOTIFICATION POPUPS
------------------------------------------------------------ */
let mingNotificationPopupHost = null;
let mingNotificationAudioContext = null;
let mingNotificationAudioUnlocked = false;
let mingNotificationRuntimeReady = false;
const mingKnownNotificationIds = new Set();

function ensureMingNotificationPopupHost() {
  if (mingNotificationPopupHost && document.body.contains(mingNotificationPopupHost)) return mingNotificationPopupHost;
  mingNotificationPopupHost = document.createElement('div');
  mingNotificationPopupHost.className = 'ming-notification-popups';
  mingNotificationPopupHost.setAttribute('aria-live', 'polite');
  mingNotificationPopupHost.setAttribute('aria-atomic', 'false');
  document.body.appendChild(mingNotificationPopupHost);
  return mingNotificationPopupHost;
}

function unlockMingNotificationAudio() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!mingNotificationAudioContext) mingNotificationAudioContext = new AudioCtx();
    if (mingNotificationAudioContext.state === 'suspended') mingNotificationAudioContext.resume();
    mingNotificationAudioUnlocked = true;
  } catch (_) {}
}

function playMingNotificationSound() {
  if (!mingNotificationAudioUnlocked) return;
  try {
    const ctx = mingNotificationAudioContext;
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    const nowTime = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, nowTime);
    gain.gain.exponentialRampToValueAtTime(0.055, nowTime + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, nowTime + 0.48);
    gain.connect(ctx.destination);

    [659.25, 783.99, 987.77].forEach((frequency, index) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(frequency, nowTime + index * 0.055);
      osc.connect(gain);
      osc.start(nowTime + index * 0.055);
      osc.stop(nowTime + 0.49);
    });
  } catch (_) {}
}

function showMingNotificationPopup(notification) {
  if (!notification || notification.read) return;
  // Quiet Mode is scoped to an open Casual Space. Keep notifications in the
  // inbox, but do not show a popup or play its sound while that Space is active.
  if (typeof window.tweaklrQuietModeActive === 'function' && window.tweaklrQuietModeActive()) return;
  const host = ensureMingNotificationPopupHost();
  const popup = document.createElement('button');
  popup.type = 'button';
  popup.className = 'ming-notification-popup';
  popup.innerHTML =
    '<span class="ming-notification-popup__icon">' +
      icon(NOTIF_ICON[notification.type] || 'bell') +
    '</span>' +
    '<span class="ming-notification-popup__copy">' +
      '<strong>Tweaklr</strong>' +
      '<span>' + notification.text + '</span>' +
    '</span>' +
    '<span class="ming-notification-popup__close" aria-hidden="true">×</span>';

  popup.addEventListener('click', async () => {
    popup.remove();
    await handleAction('notif:' + notification.id);
  });

  host.appendChild(popup);
  playMingNotificationSound();

  const timeout = setTimeout(() => {
    popup.classList.add('is-leaving');
    setTimeout(() => popup.remove(), 220);
  }, 5200);

  popup.addEventListener('click', () => clearTimeout(timeout), { once: true });
}

function rememberAndPopupNewMingNotifications(nextNotifications) {
  const list = Array.isArray(nextNotifications) ? nextNotifications : [];

  if (!mingNotificationRuntimeReady) {
    list.forEach(n => {
      if (!n.read) mingKnownNotificationIds.add(n.id);
    });
    mingNotificationRuntimeReady = true;
    return;
  }

  list.forEach(n => {
    if (n.read || mingKnownNotificationIds.has(n.id)) return;
    mingKnownNotificationIds.add(n.id);
    showMingNotificationPopup(n);
  });
}

function setupMingNotificationAudioUnlock() {
  const unlock = () => unlockMingNotificationAudio();
  document.addEventListener('pointerdown', unlock, { passive: true, once: true });
  document.addEventListener('keydown', unlock, { passive: true, once: true });
}

/* ------------------------------------------------------------
   BOTTOM SHEETS
------------------------------------------------------------ */
const sheet = $('#sheet'), scrim = $('#scrim'), modal = $('#modal');

function openSheet({ title, sub, body, foot }) {
  $('#sheet-head').innerHTML = `<h2>${esc(title)}</h2>${sub ? `<p>${esc(sub)}</p>` : ''}`;
  $('#sheet-body').innerHTML = body || '';
  $('#sheet-foot').innerHTML = foot || '';
  sheet.classList.add('is-open');
  scrim.classList.add('is-open');
}
function closeSheet() {
  sheet.classList.remove('is-open');
  if (!modal.classList.contains('is-open')) scrim.classList.remove('is-open');
}
const CREATE_OPTIONS = [
  { k: 'update', ic: 'spark', t: 'Daily Update', s: 'Share something happening now' },
  { k: 'activity', ic: 'cal', t: 'Activity', s: 'Invite people to do something' },
  { k: 'help', ic: 'hand', t: 'Need Help', s: 'Ask people nearby for something' },
  { k: 'offer', ic: 'gift', t: 'Offer', s: 'A service, an item, an opportunity' },
  { k: 'visitor', ic: 'plane', t: 'Visitor', s: "Tell people you're visiting the area" },
  { k: 'space', ic: 'sp-store', t: 'Space', s: 'A private world for one part of your life' }
];

function openCreateSheet() {
  openSheet({
    title: 'Share something',
    sub: 'Everything you post disappears after 24 hours.',
    body: CREATE_OPTIONS.map(o => `
      <button class="opt" data-action="create:${o.k}">
        <span class="ic">${icon(o.ic)}</span>
        <span class="tx"><span class="t" style="display:block">${o.t}</span><span class="s" style="display:block">${o.s}</span></span>
        <span class="go">${icon('chev')}</span>
      </button>`).join('')
  });
}

const CREATE_PRESETS = {
  update: { kind: 'general', title: 'Daily Update', ph: 'What is happening right now?', body: 'Anything worth saying to the people around you.', kinds: ['general', 'service', 'sale', 'talk', 'alert'] },
  activity: { kind: 'activity', title: 'Start an activity', ph: 'Football at the pitch down the road, 7pm', body: 'Where, when, and how many people you need.', kinds: ['activity'] },
  help: { kind: 'talk', title: 'Ask for help', ph: 'Need a photographer tomorrow morning', body: 'Say what you need and roughly when.', kinds: ['talk', 'hiring', 'alert'] },
  offer: { kind: 'service', title: 'Offer something', ph: 'Carpentry — shelving and repairs this week', body: 'What you are offering and who it is for.', kinds: ['service', 'sale', 'hiring'] },
  visitor: { kind: 'visitor', title: 'Say you are visiting', ph: 'New in town for ten days', body: 'What you are hoping to see, eat or find.', kinds: ['visitor'] }
};

function openComposer(type) {
  const preset = CREATE_PRESETS[type] || CREATE_PRESETS.update;
  state.sheetCtx = { type: 'compose', kind: preset.kind };
  openSheet({
    title: preset.title,
    sub: preset.body,
    body: `
      <div class="field"><label for="nu-title">Headline</label>
        <input id="nu-title" type="text" maxlength="70" placeholder="${esc(preset.ph)}" /></div>
      <div class="field"><label for="nu-body">Details</label>
        <textarea id="nu-body" maxlength="280" placeholder="A couple of lines is plenty."></textarea>
        <div class="count"><span id="nu-count">0</span>/280</div></div>
      <div class="field"><label>Photos & videos</label>
        <input id="nu-media" type="file" accept="image/*,video/*" multiple hidden />
        <button type="button" class="btn btn--soft btn--block" id="nu-media-pick">${icon('spark')} Add photos or videos</button>
        <div id="nu-media-preview" style="display:grid;gap:8px;margin-top:9px"></div>
        <div class="count">Up to 4 files · photos 15 MB each · videos 50 MB each</div></div>
      ${type === 'activity' ? `<div class="field"><label for="nu-when">When</label>
        <input id="nu-when" type="datetime-local" /></div>
      <div class="field"><label for="nu-place">Place</label>
        <input id="nu-place" type="text" maxlength="100" placeholder="The five-a-side pitch" /></div>` : ''}
      ${preset.kinds.length > 1 ? `<div class="field"><label>Category</label>
        <div class="pick" id="nu-kinds">${preset.kinds.map(k => `
          <button type="button" data-kind="${k}" aria-pressed="${k === preset.kind}">${KINDS[k].label}</button>`).join('')}</div></div>` : ''}
      <div class="ephemeral-note">${icon('clock')}<span>This disappears in 24 hours. Nothing you post here becomes a permanent profile.</span></div>`,
    foot: `<button class="btn btn--primary btn--block" id="nu-post" disabled>Share update</button>`
  });

  const title = $('#nu-title'), body = $('#nu-body'), post = $('#nu-post');
  const whenInput = $('#nu-when'), placeInput = $('#nu-place');
  const mediaInput = $('#nu-media'), mediaPick = $('#nu-media-pick'), mediaPreview = $('#nu-media-preview');
  let selectedMedia = [];
  const renderMediaPreview = () => {
    if (!mediaPreview) return;
    mediaPreview.innerHTML = selectedMedia.map((file, index) => {
      const url = URL.createObjectURL(file);
      const visual = file.type.startsWith('video/') ? '<video src="' + esc(url) + '" muted playsinline preload="metadata" style="width:100%;height:110px;object-fit:cover;border-radius:12px;background:#000"></video>' : '<img src="' + esc(url) + '" alt="' + esc(file.name) + '" style="width:100%;height:110px;object-fit:cover;border-radius:12px" />';
      return '<div style="position:relative">' + visual + '<button type="button" data-remove-media="' + index + '" aria-label="Remove ' + esc(file.name) + '" style="position:absolute;top:6px;right:6px;width:28px;height:28px;border:0;border-radius:50%;background:rgba(0,0,0,.68);color:#fff;cursor:pointer">×</button></div>';
    }).join('');
  };
  mediaPick?.addEventListener('click', () => mediaInput?.click());
  mediaInput?.addEventListener('change', () => {
    const incoming = Array.from(mediaInput.files || []);
    const next = [...selectedMedia, ...incoming];
    if (next.length > 4) { toast('You can attach up to 4 photos or videos.', 'alert'); selectedMedia = next.slice(0, 4); } else selectedMedia = next;
    mediaInput.value = '';
    renderMediaPreview();
  });
  mediaPreview?.addEventListener('click', e => {
    const btn = e.target.closest('[data-remove-media]');
    if (!btn) return;
    selectedMedia.splice(Number(btn.dataset.removeMedia), 1);
    renderMediaPreview();
  });

  if (whenInput) {
    const defaultWhen = new Date(Date.now() + 60 * 60 * 1000);
    defaultWhen.setSeconds(0, 0);
    const offset = defaultWhen.getTimezoneOffset();
    const localWhen = new Date(defaultWhen.getTime() - offset * 60000);
    whenInput.value = localWhen.toISOString().slice(0, 16);
  }

  const validate = () => {
    const titleOk = title.value.trim().length >= 3;
    const activityOk = !whenInput || (
      whenInput.value &&
      placeInput.value.trim().length >= 2 &&
      new Date(whenInput.value).getTime() > Date.now()
    );
    post.disabled = !(titleOk && activityOk);
  };
  title.addEventListener('input', validate);
  body.addEventListener('input', () => { $('#nu-count').textContent = body.value.length; validate(); });
  if (whenInput) whenInput.addEventListener('input', validate);
  if (placeInput) placeInput.addEventListener('input', validate);
  const kindsBox = $('#nu-kinds');
  if (kindsBox) {
    kindsBox.addEventListener('click', e => {
      const b = e.target.closest('button[data-kind]');
      if (!b) return;
      $$('button[data-kind]', kindsBox).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      state.sheetCtx.kind = b.dataset.kind;
    });
  }
  post.addEventListener('click', async () => {
    if (state.sheetCtx.kind === 'activity' && !hasLocation()) {
      toast('Enable location before starting an activity.', 'pin');
      return;
    }

    const activityMeta = whenInput ? {
      startsAt: new Date(whenInput.value).toISOString(),
      place: placeInput.value.trim(),
      latitude: state.userLocation?.latitude,
      longitude: state.userLocation?.longitude
    } : null;

    const kind = state.sheetCtx.kind;
    const ok = await createUpdate(
      kind,
      title.value.trim(),
      body.value.trim() || 'No extra details',
      activityMeta,
      selectedMedia
    );
    if (!ok) return;

    closeSheet();
    toast(kind === 'activity' ? 'Activity shared nearby' : 'Shared — it disappears in 24 hours', 'check');
    if (state.tab === 'nearby') await loadNearby();
    if (state.tab !== 'home') setTab('home');
    setTimeout(() => { $('#screen-home .scroll')?.scrollTo({ top: 260, behavior: 'smooth' }); }, 280);
  });
  setTimeout(() => title.focus(), 260);
}

function openActivitySheet(id) {
  const a = discoverActivities.find(x => x.id === id);
  if (!a) return;
  const p = byId(a.authorId);
  if (!p) return;
  openSheet({
    title: a.title,
    sub: (a.startsAt ? new Date(a.startsAt).toLocaleString([], { weekday: 'long', hour: 'numeric', minute: '2-digit' }) : timeAgo(a.createdAt)) + ' · ' + a.going + ' going',
    body: '<div style="display:flex;align-items:center;gap:12px;padding:6px 0 14px">' +
      avatar(p, 44) +
      '<div style="flex:1"><div style="font-size:14.5px;font-weight:560">' + esc(p.short) + ' shared this activity</div>' +
      '<div style="font-size:12.5px;color:var(--muted)">' + esc(p.km == null ? 'Local activity' : distLabel(p.km)) + '</div></div></div>' +
      '<p style="font-size:14px;line-height:1.55;color:#4A3B32">' + esc(a.body || 'Activity shared on Tweaklr.') + '</p>' +
      '<div style="font-size:13px;color:var(--muted);margin-top:10px">' + esc(a.place || 'Nearby') + ' · ' + esc(a.startsAt ? new Date(a.startsAt).toLocaleString([], { weekday: 'long', hour: 'numeric', minute: '2-digit' }) : 'Time not set') + '</div>' +
      '<div class="privacy-note" style="margin:16px 0 0">' + icon('shield') + '<p>Exact meeting details should be shared privately after people connect or join.</p></div>',
    foot: '<div style="display:flex;gap:10px"><button class="btn btn--primary" style="flex:1" data-action="join:' + a.id + '">' +
      (a.joined ? 'Joined' : 'Join') + '</button><button class="btn btn--soft" style="flex:1" data-action="person:' + p.id + '">View host</button></div>'
  });
}

function openPlaceSheet(id) {
  const pl = discoverPlaces.find(x => x.id === id);
  if (!pl) return;
  openSheet({
    title: pl.name,
    sub: pl.kind + ' · ' + (pl.km == null ? 'Distance unavailable' : distLabel(pl.km)),
    body: '<div style="height:120px;border-radius:var(--r-lg);margin:4px 0 14px;background:' + avatarStyle(pl.hue) + '"></div>' +
      '<p style="font-size:14.5px;line-height:1.55">' + esc(pl.note || 'Public place on Tweaklr.') + '</p>',
    foot: '<button class="btn btn--soft btn--block" data-action="save-place:' + pl.id + '">' + (pl.saved ? 'Saved' : 'Save this place') + '</button>'
  });
}

function openSettingsSheet() {
  const discoverableNow = currentUser.discoverable === true && hasLocation();
  const emailLabel = currentUser.email || 'Email not available';
  const emailStatus = currentUser.email
    ? (currentUser.emailConfirmed ? 'Verified email address' : 'Email confirmation pending')
    : 'Sign in again to refresh account details';

  openSheet({
    title: 'Settings',
    sub: 'Privacy, account details and simple preferences.',
    body: `
      <div class="settings-section-title">Privacy and security</div>

      <div class="settings-control">
        <div class="settings-control-copy">
          <div class="settings-control-title"><span class="settings-status-dot ${discoverableNow ? 'on' : ''}"></span>Discoverable nearby</div>
          <div class="settings-control-sub">${discoverableNow ? 'People nearby can discover you.' : (hasLocation() ? 'You are hidden from nearby discovery.' : 'Turn on location to become discoverable.')}</div>
        </div>
        <button class="settings-switch ${discoverableNow ? 'on' : ''}" type="button"
          data-action="toggle-discoverable"
          aria-pressed="${discoverableNow}"
          aria-label="${discoverableNow ? 'Turn off nearby discoverability' : 'Turn on nearby discoverability'}">
          <span></span>
        </button>
      </div>

      <div class="settings-info">
        <div class="settings-info-icon">${icon('pin')}</div>
        <div>
          <div class="settings-info-title">Location</div>
          <div class="settings-info-sub">${hasLocation() ? esc(areaLabel()) + ' · device location enabled' : 'Location is off'}</div>
        </div>
      </div>

      <div class="settings-info">
        <div class="settings-info-icon">${icon('shield')}</div>
        <div>
          <div class="settings-info-title">Location privacy</div>
          <div class="settings-info-sub">Your exact coordinates and address are never shown to other users.</div>
        </div>
      </div>

      <button class="opt" data-action="blocked-users"><span class="ic">${icon('shield')}</span>
        <span class="tx"><span class="t" style="display:block">Blocked people</span><span class="s" style="display:block">Manage people you have privately blocked</span></span>
        <span class="go">${icon('chev')}</span></button>

      <div class="settings-section-title">Account</div>

      <div class="settings-info">
        <div class="settings-info-icon">${icon('user')}</div>
        <div>
          <div class="settings-info-title">Username</div>
          <div class="settings-info-sub">${esc(currentUser.username || 'Not set')}</div>
        </div>
      </div>

      <div class="settings-info">
        <div class="settings-info-icon">${icon('lock')}</div>
        <div>
          <div class="settings-info-title">Email</div>
          <div class="settings-info-sub">${esc(emailLabel)} · ${esc(emailStatus)}</div>
        </div>
      </div>

      <div class="settings-section-title">Preferences</div>

      <button class="opt" data-action="edit-profile"><span class="ic">${icon('edit')}</span>
        <span class="tx"><span class="t" style="display:block">Edit profile</span><span class="s" style="display:block">Name, bio and profile details</span></span>
        <span class="go">${icon('chev')}</span></button>

      <button class="opt" data-action="go-notifications"><span class="ic">${icon('bell')}</span>
        <span class="tx"><span class="t" style="display:block">Notifications</span><span class="s" style="display:block">What you hear about</span></span>
        <span class="go">${icon('chev')}</span></button>

      <button class="opt" data-action="about"><span class="ic">${icon('coffee')}</span>
        <span class="tx"><span class="t" style="display:block">About Tweaklr</span><span class="s" style="display:block">People. Moments. Possibilities.</span></span>
        <span class="go">${icon('chev')}</span></button>`
  });
}

async function toggleMingDiscoverability() {
  if (!hasLocation()) {
    toast('Turn on location before becoming discoverable', 'pin');
    return;
  }

  const next = currentUser.discoverable !== true;

  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session?.user) {
      toast('Please sign in again', 'alert');
      return;
    }

    const { error } = await supabaseClient
      .from('profiles')
      .update({ discoverable: next })
      .eq('id', session.user.id);

    if (error) {
      console.error('Tweaklr: discoverability update failed:', error.message);
      toast('Could not update discoverability', 'alert');
      return;
    }

    currentUser.discoverable = next;
    if (state.loaded.profile) renderProfile();
    if (state.loaded.home) renderHome();
    if (state.loaded.discover) renderDiscover();
    if (state.loaded.nearby) {
      await loadMingDiscoverableProfiles(state.radius);
      renderNearby();
    }
    openSettingsSheet();
    toast(next ? 'You are now discoverable nearby' : 'You are hidden from nearby discovery', next ? 'check' : 'shield');
  } catch (error) {
    console.error('Tweaklr: discoverability update failed:', error);
    toast('Could not update discoverability', 'alert');
  }
}

function openPrivacySheet() {
  const on = state.locStatus === 'granted';
  openSheet({
    title: 'Location and privacy',
    sub: 'What people around you can and cannot see.',
    body: `
      <div class="privacy-note" style="margin:4px 0 16px">${icon('shield')}
        <p><b>Your exact location is hidden from other people.</b> Tweaklr reads your position from your device to work out who is near you, and shares only a rounded distance.</p></div>
      <div style="font-size:14px;line-height:1.8">
        <div>Shown to others · your area, ${esc(hasLocation() ? areaLabel() : 'nothing while location is off')}</div>
        <div>Shown to others · rounded distance</div>
        <div style="color:var(--muted)">Never shown · coordinates, address, live movement</div>
      </div>
      <p style="margin-top:14px;font-size:13px;color:var(--muted)">Your location comes from your device. It cannot be typed in or changed by hand — allow or deny access in your browser settings.</p>
      <div style="margin-top:16px;font-size:13px;color:var(--muted)">Status: ${esc(locationLine().title.toLowerCase())}${state.userLocation ? ` · accuracy about ${Math.round(state.userLocation.accuracy)} m` : ''}</div>`,
    foot: on ? `<button class="btn btn--soft btn--block" data-action="close-sheet">Done</button>`
      : `<button class="btn btn--primary btn--block" data-action="enable-location">Enable location</button>`
  });
}

function openMoonAbout() {
  openSheet({
    title: 'Moonflower is private',
    sub: 'It never appears on your Tweaklr profile.',
    body: `<p style="font-size:14.5px;line-height:1.6;padding:4px 0 8px">
      Tweaklr is the world around you. Moonflower is the world inside you.</p>
      <p style="font-size:14px;line-height:1.6;color:var(--muted)">
      Nothing you write here is shared, ranked, shown to people nearby, or used anywhere else in the app. No one can see that you opened it.</p>`,
    foot: `<button class="btn btn--soft btn--block" data-action="close-sheet">Close</button>`
  });
}

function openAboutSheet() {
  openSheet({
    title: 'Tweaklr',
    sub: 'People. Moments. Possibilities.',
    body: `<p style="font-size:14.5px;line-height:1.6;padding:4px 0">Tweaklr makes the world feel like a neighbourhood — the people, the moments and the possibilities within a short walk of you.</p>
      <p style="font-size:13px;color:var(--muted);margin-top:10px">Frontend demo. All data lives in this browser session.</p>`,
    foot: `<button class="btn btn--soft btn--block" data-action="close-sheet">Close</button>`
  });
}

/* ------------------------------------------------------------
   MODALS
------------------------------------------------------------ */
function openModal({ title, lede, fields, actions }) {
  modal.innerHTML = `<h2>${esc(title)}</h2>${lede ? `<p class="lede">${esc(lede)}</p>` : ''}
    ${fields || ''}
    <div class="row">${actions.map(a => `<button class="btn ${a.cls}" data-action="${a.a}">${esc(a.t)}</button>`).join('')}</div>`;
  modal.classList.add('is-open');
  scrim.classList.add('is-open');
  const first = modal.querySelector('input, textarea');
  if (first) setTimeout(() => first.focus(), 240);
}
function closeModal() {
  modal.classList.remove('is-open');
  if (!sheet.classList.contains('is-open')) scrim.classList.remove('is-open');
}

let pendingAvatarObjectUrl = null;
let pendingAvatarImage = null;
let pendingAvatarCrop = { x: 0, y: 0, zoom: 1 };

function openAvatarMenu() {
  openModal({
    title: 'Profile photo',
    lede: currentUser.avatarUrl
      ? 'View your current photo or choose a new one.'
      : 'Add a clear photo so people can recognize and connect with you.',
    fields: `<div class="profile-avatar-menu-preview">${ringAvatar(currentUser, 96, false)}</div>`,
    actions: [
      ...(currentUser.avatarUrl ? [{ t: 'View photo', cls: 'btn--soft', a: 'view-avatar' }] : []),
      { t: currentUser.avatarUrl ? 'Edit photo' : 'Add photo', cls: 'btn--primary', a: 'pick-avatar' }
    ]
  });
}

function viewAvatar() {
  if (!currentUser.avatarUrl) return;
  openModal({
    title: 'Your photo',
    fields: `<div class="profile-photo-preview"><img src="${esc(currentUser.avatarUrl)}" alt="Your profile photo"></div>`,
    actions: [
      { t: 'Edit photo', cls: 'btn--soft', a: 'pick-avatar' },
      { t: 'Close', cls: 'btn--primary', a: 'close-modal' }
    ]
  });
}

function pickAvatar() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.setAttribute('capture', 'user');
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast('Please choose an image file.', 'alert');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast('Photo must be 8 MB or smaller.', 'alert');
      return;
    }
    if (pendingAvatarObjectUrl) URL.revokeObjectURL(pendingAvatarObjectUrl);
    pendingAvatarObjectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      pendingAvatarImage = img;
      openAvatarCrop();
    };
    img.onerror = () => toast('Could not read that photo.', 'alert');
    img.src = pendingAvatarObjectUrl;
  };
  input.click();
}

function openAvatarCrop() {
  pendingAvatarCrop = { x: 0, y: 0, zoom: 1 };

  openModal({
    title: 'Edit photo',
    lede: 'Move and zoom your photo until you like the frame.',
    fields: `
      <div style="text-align:center">
        <div id="avatar-crop-frame" style="width:min(100%,320px);aspect-ratio:1;margin:0 auto 16px;overflow:hidden;border-radius:50%;clip-path:circle(50% at 50% 50%);background:#111;position:relative;touch-action:none">
          <img id="avatar-crop-bg" src="${esc(pendingAvatarObjectUrl || '')}" alt="" aria-hidden="true" style="position:absolute;inset:-18px;width:calc(100% + 36px);height:calc(100% + 36px);object-fit:cover;filter:blur(18px);opacity:.72;transform:scale(1.08);user-select:none;-webkit-user-drag:none" />
          <img id="avatar-crop-image" src="${esc(pendingAvatarObjectUrl || '')}" alt="Photo preview" style="position:absolute;left:50%;top:50%;max-width:none;width:auto;height:auto;transform:translate(-50%,-50%) scale(.5);transform-origin:center;user-select:none;-webkit-user-drag:none" />
        </div>
        <label for="avatar-zoom" style="display:block;text-align:left;font-size:13px;margin-bottom:7px">Zoom</label>
        <input id="avatar-zoom" type="range" min="0.5" max="3" step="0.01" value="0.5" style="width:100%" />
        <div class="count">Your photo is cropped to a square. Maximum upload size: 8 MB.</div>
      </div>`,
    actions: [
      { t: 'Cancel', cls: 'btn--soft', a: 'avatar-crop-cancel' },
      { t: 'Save photo', cls: 'btn--primary', a: 'save-avatar-crop' }
    ]
  });

  const img = document.getElementById('avatar-crop-image');
  const bg = document.getElementById('avatar-crop-bg');
  const frame = document.getElementById('avatar-crop-frame');
  const zoom = document.getElementById('avatar-zoom');
  if (!img || !frame || !zoom) return;

  const apply = () => {
    const z = Number(zoom.value);
    pendingAvatarCrop.zoom = z;
    img.style.transform =
      `translate(calc(-50% + ${pendingAvatarCrop.x}px), calc(-50% + ${pendingAvatarCrop.y}px)) scale(${z})`;
    if (bg) bg.style.transform = 'scale(1.08)';
  };

  zoom.addEventListener('input', apply);

  const start = e => {
    const p = e.touches?.[0] || e;
    img._avatarDragging = true;
    img._avatarStartX = p.clientX;
    img._avatarStartY = p.clientY;
    img._avatarOriginX = pendingAvatarCrop.x;
    img._avatarOriginY = pendingAvatarCrop.y;
  };

  const move = e => {
    if (!img._avatarDragging) return;
    const p = e.touches?.[0] || e;
    pendingAvatarCrop.x = img._avatarOriginX + p.clientX - img._avatarStartX;
    pendingAvatarCrop.y = img._avatarOriginY + p.clientY - img._avatarStartY;
    apply();
    e.preventDefault();
  };

  const end = () => { img._avatarDragging = false; };

  frame.addEventListener('mousedown', start);
  frame.addEventListener('mousemove', move);
  frame.addEventListener('mouseup', end);
  frame.addEventListener('mouseleave', end);
  frame.addEventListener('touchstart', start, { passive: false });
  frame.addEventListener('touchmove', move, { passive: false });
  frame.addEventListener('touchend', end);
}

async function saveAvatarCrop() {
  if (!pendingAvatarImage) return;

  const frame = document.getElementById('avatar-crop-frame');
  const zoomEl = document.getElementById('avatar-zoom');
  if (!frame) return;

  const frameSize = frame.getBoundingClientRect().width;
  const zoom = Number(zoomEl?.value || pendingAvatarCrop.zoom || 1);
  const x = Number(pendingAvatarCrop.x || 0);
  const y = Number(pendingAvatarCrop.y || 0);

  const canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 800;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    toast('Could not prepare the photo.', 'alert');
    return;
  }

  const sourceW = pendingAvatarImage.naturalWidth;
  const sourceH = pendingAvatarImage.naturalHeight;

  // Scale the source image so it completely covers the square crop frame.
  const baseScale = Math.max(
    frameSize / sourceW,
    frameSize / sourceH
  );

  const drawScale = baseScale * zoom;
  const drawW = sourceW * drawScale;
  const drawH = sourceH * drawScale;

  // Fill the canvas first with the same blurred/covered image used behind
  // the preview. This lets the main photo be shown at the reduced scale
  // without leaving empty edges in the saved square avatar.
  const bgScale = baseScale;
  const bgW = sourceW * bgScale;
  const bgH = sourceH * bgScale;
  const bgX = (frameSize - bgW) / 2;
  const bgY = (frameSize - bgH) / 2;

  const scaleToCanvas = 800 / frameSize;

  ctx.save();
  ctx.filter = 'blur(18px)';
  ctx.globalAlpha = 0.72;
  ctx.drawImage(
    pendingAvatarImage,
    (bgX - 18) * scaleToCanvas,
    (bgY - 18) * scaleToCanvas,
    (bgW + 36) * scaleToCanvas,
    (bgH + 36) * scaleToCanvas
  );
  ctx.restore();

  // Match the exact visual position used by the crop preview.
  const drawX = (frameSize - drawW) / 2 + x;
  const drawY = (frameSize - drawH) / 2 + y;

  ctx.drawImage(
    pendingAvatarImage,
    drawX * scaleToCanvas,
    drawY * scaleToCanvas,
    drawW * scaleToCanvas,
    drawH * scaleToCanvas
  );

  const blob = await new Promise(resolve =>
    canvas.toBlob(resolve, 'image/jpeg', 0.88)
  );

  if (!blob) {
    toast('Could not prepare the photo.', 'alert');
    return;
  }

  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session?.user) {
    toast('Please sign in again', 'alert');
    return;
  }

  const path = session.user.id + '/profile.jpg';

  const { error: uploadError } =
    await supabaseClient.storage.from('avatars').upload(path, blob, {
      upsert: true,
      contentType: 'image/jpeg',
      cacheControl: '3600'
    });

  if (uploadError) {
    console.error('Tweaklr: avatar upload failed:', uploadError);
    toast('Could not upload photo', 'alert');
    return;
  }

  const { data: publicData } =
    supabaseClient.storage.from('avatars').getPublicUrl(path);

  const publicUrl =
    publicData.publicUrl + '?v=' + Date.now();

  const { error: profileError } =
    await supabaseClient
      .from('profiles')
      .update({ avatar_url: publicUrl })
      .eq('id', session.user.id);

  if (profileError) {
    console.error(
      'Tweaklr: avatar profile update failed:',
      profileError.message
    );
    toast('Could not save photo', 'alert');
    return;
  }

  currentUser.avatarUrl = publicUrl;

  if (pendingAvatarObjectUrl) {
    URL.revokeObjectURL(pendingAvatarObjectUrl);
  }

  pendingAvatarObjectUrl = null;
  pendingAvatarImage = null;
  pendingAvatarCrop = { x: 0, y: 0, zoom: 1 };

  closeModal();
  renderProfile();
  renderHome();
  toast('Profile photo updated', 'check');
}

/* ------------------------------------------------------------
   TOASTS
------------------------------------------------------------ */
function toast(msg, ic = 'check') {
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = `${icon(ic)}<span>${esc(msg)}</span>`;
  $('#toasts').appendChild(t);
  setTimeout(() => {
    t.classList.add('out');
    setTimeout(() => t.remove(), 240);
  }, 2600);
}

/* ------------------------------------------------------------
   CALL CLICK DIAGNOSTICS
   Call-only tracing. No call behavior is changed.
------------------------------------------------------------ */
document.addEventListener('click', e => {
  const target = e.target?.closest?.('#call-overlay [data-action]');
  if (!target) return;

  console.log('Tweaklr: call control click reached document', {
    action: target.dataset.action,
    tag: target.tagName,
    disabled: !!target.disabled,
    hidden: !!target.hidden,
    pointerEvents: getComputedStyle(target).pointerEvents,
    overlayPointerEvents: getComputedStyle(document.getElementById('call-overlay') || document.body).pointerEvents
  });
}, true);

/* ------------------------------------------------------------
   ACTIONS (delegated)
------------------------------------------------------------ */
document.addEventListener('click', async e => {
  const openBtn = e.target.closest('[data-open]');
  if (openBtn) {
    const k = openBtn.dataset.open;
    if (k === 'search') openSearch();
    if (k === 'notifications') { renderNotifications(); pushStack('notifications'); }
    if (k === 'settings') openSettingsSheet();
    if (k === 'moon-about') openMoonAbout();
    return;
  }

  if (e.target.closest('[data-back]')) { popStack(); return; }

  const navBtn = e.target.closest('#nav button');
  if (navBtn) { setTab(navBtn.dataset.nav); return; }

  const host = e.target.closest('[data-action]');
  if (!host) return;
  const [verb, arg, arg2] = host.dataset.action.split(':');

  switch (verb) {
    case 'tweak-connect': await beginTweakSetup(); break;
    case 'tweak-refresh': await loadTweakTikTokData(true); break;
    case 'person': openPerson(arg); break;
    case 'block-user': confirmBlockTweaklrUser(arg); break;
    case 'confirm-block-user': await blockTweaklrUser(arg); break;
    case 'unblock-user': await unblockTweaklrUser(arg); break;
    case 'blocked-users': await openBlockedUsersSheet(); break;
    case 'block-current-chat': if (state.activeChat) confirmBlockTweaklrUser(state.activeChat); break;
    case 'like': toggleLike(arg); break;
    case 'comments': openComments(arg); break;
    case 'share-update': await shareDailyUpdate(arg); break;
    case 'open-update-media': openDailyUpdateMedia(arg, arg2); break;
    case 'share-external': await shareDailyUpdateExternal(arg); break;
    case 'send-update': await sendDailyUpdateToConnection(arg, arg2); break;
    case 'download-update': await downloadDailyUpdate(arg); break;
    case 'delete-update': deleteUpdate(arg); break;

    case 'confirm-delete':
      closeModal();
      await deleteMingDailyUpdate(arg);
      break;

    case 'confirm-chat-delete':
      await deleteChatMessage(arg, arg2);
      break;

    case 'connect': connectWith(arg); break;
    case 'send-conn': sendConnection(arg); break;

    case 'confirm-remove': {
      const p = byId(arg);
      openModal({
        title: `Remove ${p.short}?`,
        lede: 'You will both stop seeing each other in Connections. You can connect again later.',
        actions: [{ t: 'Cancel', cls: 'btn--soft', a: 'close-modal' }, { t: 'Remove', cls: 'btn--primary', a: 'remove-conn:' + arg }]
      });
      break;
    }
    case 'remove-conn': {
      if (isUuidPerson(arg)) {
        const { error } = await supabaseClient
          .from('connections')
          .delete()
          .eq('id', connections.find(c => c.personId === arg)?.id || '');

        if (error) {
          console.error('Tweaklr: removing connection failed:', error.message);
          toast('Could not remove connection.', 'alert');
          break;
        }

        closeModal();
        await loadMingConnections();
        renderConnections();
        if (state.loaded.profile) renderProfile();
        if (state.activePerson === arg && state.stack[state.stack.length - 1] === 'person') openPersonRefresh(arg);
        toast('Connection removed', 'x');
        break;
      }

      connections = connections.filter(c => c.personId !== arg);
      closeModal();
      renderConnections();
      if (state.loaded.profile) renderProfile();
      if (state.activePerson === arg && state.stack[state.stack.length - 1] === 'person') openPersonRefresh(arg);
      toast('Connection removed', 'x');
      break;
    }

    case 'accept-req': {
      const r = connectionRequests.find(x => x.id === arg);
      if (!r) break;

      if (isUuidPerson(r.personId)) {
        const { error } = await supabaseClient
          .from('connections')
          .update({
            status: 'accepted',
            responded_at: new Date().toISOString()
          })
          .eq('id', r.id);

        if (error) {
          console.error('Tweaklr: accepting connection failed:', error.message);
          toast('Could not accept request.', 'alert');
          break;
        }

        await loadMingConnections();
        renderConnections();
        if (state.loaded.profile) renderProfile();
        toast(`You and ${byId(r.personId)?.short || 'this person'} are connected`, 'check');
        break;
      }

      connections.push({ personId: r.personId, at: now() });
      connectionRequests = connectionRequests.filter(x => x.id !== arg);
      renderConnections();
      if (state.loaded.profile) renderProfile();
      toast(`You and ${byId(r.personId).short} are connected`, 'check');
      break;
    }

    case 'decline-req': {
      const r = connectionRequests.find(x => x.id === arg);
      if (!r) break;

      if (isUuidPerson(r.personId)) {
        const { error } = await supabaseClient
          .from('connections')
          .update({
            status: 'declined',
            responded_at: new Date().toISOString()
          })
          .eq('id', r.id);

        if (error) {
          console.error('Tweaklr: declining connection failed:', error.message);
          toast('Could not dismiss request.', 'alert');
          break;
        }

        await loadMingConnections();
        renderConnections();
        toast('Request dismissed', 'x');
        break;
      }

      connectionRequests = connectionRequests.filter(x => x.id !== arg);
      renderConnections();
      toast('Request dismissed', 'x');
    }

    case 'message': closeSheet(); popStackIfPerson(); openChat(arg); break;
    case 'chat': openChat(arg); break;

    case 'activity': openActivitySheet(arg); break;
    case 'join': {
      const a = discoverActivities.find(x => x.id === arg);
      if (!a) break;
      if (a.joined) {
        toast('You already joined this activity.', 'check');
        break;
      }
      const { data: { session } } = await supabaseClient.auth.getSession();
      if (!session?.user) {
        toast('Please sign in again.', 'alert');
        break;
      }
      const { error } = await supabaseClient.from('daily_update_participants').insert({ update_id: a.id, user_id: session.user.id });
      if (error && error.code !== '23505') {
        console.error('Tweaklr: joining activity failed:', error.message);
        toast('Could not join activity.', 'alert');
        break;
      }
      a.joined = true;
      if (!error) a.going += 1;
      closeSheet();
      toast('You joined the activity.', 'check');
      if (state.loaded.discover) renderDiscover();
      break;
    }
    case 'place': openPlaceSheet(arg); break;
    case 'save-place': {
      const pl = discoverPlaces.find(x => x.id === arg);
      if (!pl) break;
      const { data: { session } } = await supabaseClient.auth.getSession();
      if (!session?.user) {
        toast('Please sign in again.', 'alert');
        break;
      }
      if (pl.saved) {
        const { error } = await supabaseClient.from('saved_discover_places').delete().eq('place_id', pl.id).eq('user_id', session.user.id);
        if (error) { toast('Could not remove saved place.', 'alert'); break; }
        pl.saved = false;
        closeSheet();
        toast('Place removed from saved places.', 'x');
      } else {
        const { error } = await supabaseClient.from('saved_discover_places').insert({ place_id: pl.id, user_id: session.user.id });
        if (error && error.code !== '23505') { toast('Could not save place.', 'alert'); break; }
        pl.saved = true;
        closeSheet();
        toast('Place saved.', 'check');
      }
      break;
    }

    case 'filter':
      state.discoverFilter = arg;
      renderDiscover();
      $('#screen-discover .scroll').scrollTo({ top: 0, behavior: 'smooth' });
      break;

    case 'go-nearby': setTab('nearby'); break;
    case 'go-spaces': {
      e.preventDefault();
      closeSheet();

      try {
        await openSpaces();
      } catch (error) {
        console.error('Tweaklr: Your Spaces navigation failed:', error);
        toast('Your Spaces could not be loaded right now.', 'alert');
      }

      break;
    }
    case 'go-wallet': {
      e.preventDefault();
      closeSheet();
      requestAnimationFrame(() => openWallet());
      break;
    }
    case 'go-connections': {
      const loaded = await loadMingConnections();
      renderConnections();
      pushStack('connections');
      if (!loaded) toast('Showing local connections until the backend is connected.', 'alert');
      break;
    }
    case 'go-messages': { const ready = await loadMingMessages(); await subscribeMingMessages(); renderMessages(); pushStack('messages'); if (!ready) toast('Messaging is not connected yet. Run supabase_messages.sql once.', 'alert'); break; }
    case 'go-notifications': {
      closeSheet();
      await loadMingNotifications();
      renderNotifications();
      updateNotifDot();
      pushStack('notifications');
      break;
    }
    case 'go-updates': $('#my-updates').scrollIntoView({ behavior: 'smooth', block: 'start' }); break;

    case 'profile-content': {
      profileContentTab = arg === 'likes' ? 'likes' : 'posts';
      if (profileContentTab === 'likes' && !profileLikesLoaded) {
        await loadMingProfileLikedUpdates();
      }
      renderProfile();
      setTimeout(() => $('#my-updates')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 40);
      break;
    }

    case 'enable-location': closeSheet(); requestLocation(() => { if (state.tab !== 'nearby') return; }); break;
    case 'expand-radius': state.radius = 50; renderNearby(); toast('Discovery area expanded to 50 km', 'pin'); break;

    case 'create':
      closeSheet();
      /* Spaces have their own creation flow (spaces.js) */
      setTimeout(() => arg === 'space' ? openWizard() : openComposer(arg), 180);
      break;
    case 'close-sheet': closeSheet(); break;
    case 'close-modal': closeModal(); break;

    case 'notif': {
      const n = notifications.find(x => x.id === arg);
      if (!n) break;
      const saved = await saveNotificationReadState([n.id]);
      if (!saved) {
        toast('Could not save read status. Please try again.', 'alert');
        break;
      }
      n.read = true;
      renderNotifications();
      updateNotifDot();

      if (n.type === 'message' && n.personId) {
        await openChat(n.personId);
      } else if (n.type === 'request') {
        await loadMingConnections();
        renderConnections();
        pushStack('connections');
      } else if (n.type === 'update') {
        setTab('home');
      } else if ((n.type === 'like' || n.type === 'comment') && n.updateId) {
        profileContentTab = 'posts';
        setTab('profile');
        setTimeout(() => {
          renderProfile();
          const post = document.getElementById('upd-' + n.updateId);
          if (post) post.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 80);
      }
      break;
    }

    case 'call':
      await startMingCall(arg === 'video' ? 'video' : 'voice');
      break;
    case 'call-accept': await acceptMingCall(); break;
    case 'call-decline': await declineMingCall(); break;
    case 'call-end': await endMingCall({ notify: true, reason: 'ended' }); break;
    case 'call-mute': toggleMingCallMute(); break;
    case 'call-camera': toggleMingCallCamera(); break;

    case 'moon': openMoonRoom(arg); break;
    case 'moon-add': moonAdd(); break;
    case 'moon-intent': {
      const inp = $('#moon-input');
      if (!inp) break;
      inp.value = MOON_INTENTS[arg] ? MOON_INTENTS[arg].seed : '';
      inp.focus();
      inp.setSelectionRange(inp.value.length, inp.value.length);
      autoGrow(inp);
      $('#moon-send').disabled = !inp.value.trim();
      break;
    }
    case 'step': {
      const g = moonGoals.find(x => x.id === arg);
      if (!g) break;
      g.steps[+arg2].done = !g.steps[+arg2].done;
      renderMoonRoom();
      break;
    }
    case 'rem': {
      const r = moonReminders.find(x => x.id === arg);
      if (r) r.done = !r.done;
      renderMoonRoom(); renderMoonflower();
      break;
    }
    case 'del-note':
      moonNotes = moonNotes.filter(n => n.id !== arg);
      renderMoonRoom(); renderMoonflower();
      toast('Note deleted', 'trash');
      break;
    case 'open-note': {
      const n = moonNotes.find(x => x.id === arg);
      if (!n) break;
      const row = $('#log-' + arg);
      if (row) { row.scrollIntoView({ behavior: 'smooth', block: 'center' }); row.style.borderColor = 'rgba(221,226,234,.4)'; setTimeout(() => { row.style.borderColor = ''; }, 900); }
      break;
    }
    case 'save-goal': {
      const t = $('#mf-goal').value.trim();
      if (!t) { closeModal(); break; }
      const steps = $('#mf-steps').value.split('\n').map(s => s.trim()).filter(Boolean).map(s => ({ t: s, done: false }));
      moonGoals.unshift({ id: uid('g'), title: t, sub: $('#mf-sub').value.trim() || 'No deadline', steps: steps.length ? steps : [{ t: 'Start', done: false }] });
      closeModal(); renderMoonRoom(); renderMoonflower();
      toast('Goal added', 'check');
      break;
    }
    case 'save-rem': {
      const t = $('#mf-rem').value.trim();
      if (!t) { closeModal(); break; }
      moonReminders.unshift({ id: uid('rm'), text: t, when: $('#mf-when').value.trim() || 'Someday', done: false });
      closeModal(); renderMoonRoom(); renderMoonflower();
      toast('Reminder added', 'check');
      break;
    }

    case 'avatar-menu': openAvatarMenu(); break;
    case 'view-avatar': viewAvatar(); break;
    case 'pick-avatar': pickAvatar(); break;
    case 'avatar-crop-cancel':
      if (pendingAvatarObjectUrl) URL.revokeObjectURL(pendingAvatarObjectUrl);
      pendingAvatarObjectUrl = null;
      pendingAvatarImage = null;
      closeModal();
      break;
    case 'save-avatar-crop': await saveAvatarCrop(); break;
    case 'edit-profile': closeSheet(); setTimeout(editProfile, 160); break;
    case 'save-profile': {
      const avatarInput = $('#ep-avatar');
      const avatarFile = avatarInput?.files?.[0] || null;
      const newName = $('#ep-name').value.trim();
      const newBio = $('#ep-bio').value.trim();
      const tagsValidation = validateMingProfileList($('#ep-tags').value, 8, 'Tags');
      const interestsValidation = validateMingProfileList($('#ep-interests').value, 12, 'Interests and services');

      if (!tagsValidation.ok) { toast(tagsValidation.message, 'alert'); break; }
      if (!interestsValidation.ok) { toast(interestsValidation.message, 'alert'); break; }

      const newTags = tagsValidation.items;
      const newInterests = interestsValidation.items;
      const requestedUsername = $('#ep-username').value.trim().toLowerCase();
      const currentUsername = currentUser.username.replace(/^@/, '').toLowerCase();
      const usernameChanged = requestedUsername !== currentUsername;

      if (newName) currentUser.name = newName;
      currentUser.headline = $('#ep-head').value.trim() || currentUser.headline;
      if (newBio) currentUser.bio = newBio;
      currentUser.tags = newTags;
      currentUser.interests = newInterests;

      try {
        const { data: { session } } =
          await supabaseClient.auth.getSession();

        if (!session?.user) {
          toast('Please sign in again', 'alert');
          break;
        }

        if (avatarFile) {
          if (!avatarFile.type.startsWith('image/')) {
            toast('Please choose an image file.', 'alert');
            break;
          }
          if (avatarFile.size > 5 * 1024 * 1024) {
            toast('Photo must be 5 MB or smaller.', 'alert');
            break;
          }
          const extension = (avatarFile.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
          const path = session.user.id + '/profile.' + (extension || 'jpg');
          const { error: uploadError } = await supabaseClient.storage.from('avatars').upload(path, avatarFile, {
            upsert: true,
            contentType: avatarFile.type,
            cacheControl: '3600'
          });
          if (uploadError) {
            console.error('Tweaklr: avatar upload failed:', uploadError.message);
            toast('Could not upload photo', 'alert');
            break;
          }
          const { data: publicData } = supabaseClient.storage.from('avatars').getPublicUrl(path);
          currentUser.avatarUrl = publicData.publicUrl;
        }

        if (usernameChanged) {
          if (!/^[A-Za-z0-9](?:[A-Za-z0-9_-]{1,28}[A-Za-z0-9])?$/.test(requestedUsername)) {
            toast('Username must be 3–30 characters and use only letters, numbers, underscores, or hyphens.', 'alert');
            break;
          }

          if (!usernameChangeAvailable()) {
            const next = usernameNextChangeDate();
            toast(
              next
                ? 'Username can be changed again on ' + next.toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' }) + '.'
                : 'Username can only be changed once every 3 months.',
              'alert'
            );
            break;
          }

          const { data: usernameResult, error: usernameError } =
            await supabaseClient.rpc('change_username', {
              new_username: requestedUsername
            });

          if (usernameError) {
            console.error('Tweaklr: username update failed:', usernameError.message);

            if (/already exists|duplicate|unique/i.test(usernameError.message)) {
              toast('That username is already taken.', 'alert');
            } else if (/3 months|three months|cooldown/i.test(usernameError.message)) {
              toast('Username can only be changed once every 3 months.', 'alert');
            } else {
              toast('Could not change username.', 'alert');
            }
            break;
          }

          currentUser.username = '@' + requestedUsername;
          currentUser.usernameChangedAt =
            usernameResult?.username_changed_at || new Date().toISOString();
        }

        const { error } = await supabaseClient
          .from('profiles')
          .update({
            display_name: currentUser.name,
            avatar_url: currentUser.avatarUrl || null,
            bio: currentUser.bio,
            headline: currentUser.headline,
            interests: currentUser.interests,
            tags: currentUser.tags,
            activity: currentUser.activity
          })
          .eq('id', session.user.id);

        if (error) {
          console.error('Tweaklr: profile update failed:', error.message);
          toast('Could not save profile', 'alert');
          break;
        }

        closeModal();
        renderProfile();
        renderHome();
        renderMoonflower();
        toast(usernameChanged ? 'Profile and username updated' : 'Profile updated', 'check');

      } catch (error) {
        console.error('Tweaklr: profile update failed:', error);
        toast('Could not save profile', 'alert');
      }

      break;
    }
    case 'edit-activity':
      openModal({
        title: 'What are you doing right now?',
        lede: 'People nearby see this on your profile. It clears itself overnight.',
        fields: `<div class="field"><label for="ea-now">Right now</label><input id="ea-now" type="text" value="${esc(currentUser.activity)}" maxlength="60" /></div>`,
        actions: [{ t: 'Cancel', cls: 'btn--soft', a: 'close-modal' }, { t: 'Save', cls: 'btn--primary', a: 'save-activity' }]
      });
      break;
    case 'save-activity': {
      const nextActivity = $('#ea-now').value.trim();

      try {
        const { data: { session } } = await supabaseClient.auth.getSession();

        if (!session?.user) {
          toast('Please sign in again', 'alert');
          break;
        }

        const { error } = await supabaseClient
          .from('profiles')
          .update({ activity: nextActivity })
          .eq('id', session.user.id);

        if (error) {
          console.error('Tweaklr: activity update failed:', error.message);
          toast('Could not update activity', 'alert');
          break;
        }

        currentUser.activity = nextActivity;
        closeModal();
        renderProfile();
        toast('Updated', 'check');
      } catch (error) {
        console.error('Tweaklr: activity update failed:', error);
        toast('Could not update activity', 'alert');
      }
      break;
    }

    case 'privacy': closeSheet(); setTimeout(openPrivacySheet, 160); break;
    case 'toggle-discoverable': await toggleMingDiscoverability(); break;
    case 'settings': closeSheet(); setTimeout(openSettingsSheet, 160); break;
    case 'about': closeSheet(); setTimeout(openAboutSheet, 160); break;

    case 'search-term':
      $('#search-input').value = arg;
      runSearch(arg);
      break;
  }
});

function popStackIfPerson() {
  if (state.stack[state.stack.length - 1] === 'person') popStack();
}

/* ------------------------------------------------------------
   INPUT WIRING
------------------------------------------------------------ */

if ($('#fab')) {
  $('#fab').addEventListener('click', openCreateSheet);
}

if ($('#home-avatar')) {
  $('#home-avatar').addEventListener('click', () => setTab('profile'));
}

if ($('#refresh-nearby')) {
  $('#refresh-nearby').addEventListener('click', async () => {
    if (state.locStatus !== 'granted') {
      requestLocation();
      return;
    }

    await loadNearby();
    toast('Nearby refreshed', 'layers');
  });
}

if ($('#mark-all-read')) {
  $('#mark-all-read').addEventListener('click', async () => {
    const ids = notifications.map(n => n.id);
    if (!ids.length) {
      toast('All caught up', 'check');
      return;
    }
    const button = $('#mark-all-read');
    if (button) button.disabled = true;
    const saved = await saveNotificationReadState(ids);
    if (!saved) {
      toast('Could not save read status. Please try again.', 'alert');
      if (button) button.disabled = false;
      return;
    }
    notifications.forEach(n => {
      n.read = true;
      notificationReadIds.add(n.id);
    });
    renderNotifications();
    updateNotifDot();
    toast('All caught up', 'check');
    if (button) button.disabled = false;
  });
}
scrim.addEventListener('click', () => { closeSheet(); closeModal(); });
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (modal.classList.contains('is-open')) return closeModal();
  if (sheet.classList.contains('is-open')) return closeSheet();
  if (state.stack.length) popStack();
});

/* Search input */
const searchInput = $('#search-input');
function runSearch(q) {
  state.searchQuery = q;
  $('#search-clear').hidden = !q;
  clearTimeout(searchTimer);
  if (!q.trim()) { renderSearch('idle'); return; }

  if (!searchDataReady) {
    renderSearch('loading');
    searchTimer = setTimeout(async () => {
      await loadMingSearchData();
      renderSearch('results', q.trim());
    }, 80);
    return;
  }

  searchTimer = setTimeout(() => renderSearch('results', q.trim()), 220);
}
searchInput.addEventListener('input', e => runSearch(e.target.value));
$('#search-clear').addEventListener('click', () => { searchInput.value = ''; runSearch(''); searchInput.focus(); });

/* Chat composer */
const chatInput = $('#chat-input'), chatSend = $('#chat-send');
function autoGrow(el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 110) + 'px'; }
chatInput.addEventListener('input', () => {
  chatSend.disabled = !chatInput.value.trim() && !pendingChatAttachment;
  autoGrow(chatInput);
  if (chatInput.value.trim()) setMingTyping(true);
  else setMingTyping(false);
});
$('#chat-form').addEventListener('submit', async e => {
  e.preventDefault();
  const v = chatInput.value.trim();
  if (!v && !pendingChatAttachment) return;
  setMingTyping(false);
  if (pendingChatAttachment) { const file=pendingChatAttachment; await sendStoredChatAttachment(file,{replyToId:chatReplyTarget?.id||null}); chatInput.value=''; chatInput.style.height='auto'; chatSend.disabled=true; return; }
  chatInput.value = ''; chatInput.style.height = 'auto'; chatSend.disabled = true;
  sendMessage(v, { replyToId: chatReplyTarget?.id || null });
});
$('#chat-voice').addEventListener('click', recordVoiceNote);
$('#chat-attach').addEventListener('click',()=>{const input=$('#chat-attachment-input');if(!input)return;try{if(typeof input.showPicker==='function')input.showPicker();else input.click();}catch(_){input.click();}});
$('#chat-attachment-input').addEventListener('change',async e=>{await chooseChatAttachment(e.target.files?.[0]||null);chatSend.disabled=!chatInput.value.trim()&&!pendingChatAttachment;});
chatInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#chat-form').requestSubmit(); }
});

/* Chat message gestures: long-press for actions, horizontal swipe-right for reply. */
let chatPressTimer = null;
let chatGesture = null;

document.addEventListener('pointerdown', e => {
  const row = e.target.closest('.chat-message-row');
  if (!row) return;
  if (e.target.closest('button,input')) return;
  chatGesture = { row, startX:e.clientX, startY:e.clientY, moved:false };
  chatPressTimer = setTimeout(() => {
    if (!chatGesture?.moved) openMessageActions(row.dataset.messageId);
  }, 520);
});

document.addEventListener('pointermove', e => {
  if (!chatGesture) return;
  const dx=e.clientX-chatGesture.startX, dy=e.clientY-chatGesture.startY;
  if (Math.abs(dx)>8 || Math.abs(dy)>8) chatGesture.moved=true;
  if (chatGesture.moved) clearTimeout(chatPressTimer);
  if (Math.abs(dx)>8 && Math.abs(dx)>Math.abs(dy)) {
    const x=Math.max(0,Math.min(72,dx));
    chatGesture.row.style.transform=`translateX(${x}px)`;
    chatGesture.row.classList.add('is-swiping');
  }
});

document.addEventListener('pointerup', e => {
  if (!chatGesture) return;
  clearTimeout(chatPressTimer);
  const {row,startX,startY}=chatGesture;
  const dx=e.clientX-startX, dy=e.clientY-startY;
  row.classList.remove('is-swiping');
  row.style.transform='';
  if (dx>60 && Math.abs(dx)>Math.abs(dy)*1.2) {
    setChatReply(row.dataset.messageId);
    toast('Replying to message', 'reply');
  }
  chatGesture=null;
});

document.addEventListener('pointercancel', () => {
  clearTimeout(chatPressTimer);
  if (chatGesture?.row) {
    chatGesture.row.classList.remove('is-swiping');
    chatGesture.row.style.transform='';
  }
  chatGesture=null;
});

document.addEventListener('click', async e => {
  const attachmentBtn=e.target.closest('[data-chat-attachment]');
  if(attachmentBtn){e.stopPropagation();if(attachmentBtn.querySelector('[data-chat-attachment-video]'))return;const path=attachmentBtn.dataset.chatAttachment;if(!path)return;let url=attachmentBtn.dataset.chatAttachmentUrl;if(!url){const {data,error}=await supabaseClient.storage.from('ming-message-files').createSignedUrl(path,3600);if(error||!data?.signedUrl){toast('Could not open attachment.','alert');return;}url=data.signedUrl;}window.open(url,'_blank','noopener');return;}
  const voiceBtn=e.target.closest('[data-voice-path]');
  if (voiceBtn) {
    e.stopPropagation();

    const path = voiceBtn.dataset.voicePath;
    if (!path) return;

    try {
      let audio = voiceBtn._audio;

      if (!audio) {
        const { data, error } = await supabaseClient
          .storage
          .from('ming-voice')
          .createSignedUrl(path, 3600);

        if (error || !data?.signedUrl) {
          console.error('Tweaklr: could not create voice playback URL:', error?.message || 'No signed URL returned.');
          toast('Could not load this voice note.', 'alert');
          return;
        }

        audio = new Audio();
        audio.preload = 'auto';
        audio.src = data.signedUrl;
        voiceBtn._audio = audio;

        audio.addEventListener('ended', () => {
          voiceBtn.textContent = '▶';
        });

        audio.addEventListener('error', () => {
          console.error('Tweaklr: voice playback failed.', audio.error?.message || audio.error?.code || 'Unknown audio error');
          voiceBtn.textContent = '▶';
          toast('This voice note could not be played.', 'alert');
        });
      }

      if (audio.paused) {
        voiceBtn.textContent = '…';
        await audio.play();
        voiceBtn.textContent = '⏸';
      } else {
        audio.pause();
        voiceBtn.textContent = '▶';
      }
    } catch (error) {
      console.error('Tweaklr: voice playback failed:', error);
      voiceBtn.textContent = '▶';
      toast('This voice note could not be played.', 'alert');
    }
    return;
  }
  const b=e.target.closest('[data-action^="chat-"]');
  if (!b) return;
  const [verb,arg,arg2]=b.dataset.action.split(':');
  if(verb==='chat-edit'){ openChatMessageEditor(arg); }
  if(verb==='chat-edit-save'){ await saveEditedChatMessage(arg); }
  if(verb==='chat-reply'){ closeSheet(); setChatReply(arg); }
  if(verb==='chat-jump-reply'){ jumpToRepliedMessage(arg); }
  if(verb==='chat-cancel-reply'){ clearChatReply(); }
  if(verb==='chat-copy'){ copyChatMessage(arg); }
  if(verb==='chat-forward'){ forwardChatMessage(arg); }
  if(verb==='chat-react'){ /* emoji row already visible */ }
  if(verb==='chat-add-reaction'){ addChatReaction(arg, decodeURIComponent(arg2||'')); }
  if(verb==='chat-delete'){ openDeleteMessageChoices(arg); }
  if(verb==='chat-delete-choice'){ confirmChatDelete(arg, arg2); }
  if(verb==='confirm-chat-delete') await deleteChatMessage(arg, arg2);
  if(verb==='forward-to') await forwardSelectedChatMessage(arg);
});

/* Moonflower composer */
const moonInput = $('#moon-input'), moonSend = $('#moon-send');
moonInput.addEventListener('input', () => { moonSend.disabled = !moonInput.value.trim(); autoGrow(moonInput); });
$('#moon-form').addEventListener('submit', e => {
  e.preventDefault();
  const v = moonInput.value.trim();
  if (!v) return;
  moonInput.value = ''; moonInput.style.height = 'auto'; moonSend.disabled = true;
  moonChat.push({ me: true, text: v, at: now() });
  renderMoonRoom();
  if (window.MoonSky) window.MoonSky.pulse();
  const s = $('#moonroom-scroll'); s.scrollTop = s.scrollHeight;
  setTimeout(() => {
    moonChat.push({ me: false, text: moonAct(v), at: now() });
    renderMoonRoom();
    if (window.MoonSky) window.MoonSky.pulse();
    s.scrollTop = s.scrollHeight;
  }, 900);
});
moonInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#moon-form').requestSubmit(); }
});
$('#moonroom-action').addEventListener('click', moonAdd);

/* ------------------------------------------------------------
   BOOT
------------------------------------------------------------ */
function tickExpiry() {
  const before = dailyUpdates.length;
  dailyUpdates = dailyUpdates.filter(u => hoursLeft(u) > 0);
  if (dailyUpdates.length !== before) rerenderFeeds();
  $$('.upd').forEach(card => {
    const id = card.id.replace('upd-', '');
    const u = dailyUpdates.find(x => x.id === id);
    if (!u) return;
    const exp = card.querySelector('.expiry');
    const bar = card.querySelector('.life i');
    const h = hoursLeft(u);
    if (exp) exp.lastChild.textContent = lifeLabel(u);
    if (bar) bar.style.width = Math.max(2, Math.round((h / 24) * 100)) + '%';
    card.querySelector('.life').classList.toggle('low', h < 4);
  });
}

async function boot() {
  /*
     Start device-location acquisition immediately and independently of
     the Supabase profile request. Location must never wait for profile,
     avatar, auth metadata, or any other network request.
  */
  initLocation();

  // The profile still gates the first authenticated render as before.
  await mingProfileReady;
  if (typeof Server !== 'undefined') {
    Server.session.userId = currentUser.id;
    await Server.load();
  }
  setupMingNotificationAudioUnlock();
  await loadMingNotifications();
  await subscribeMingMessages();
  await loadMingDailyUpdates();
  startMingCallInbox();
  void ensureMingPushReady({ prompt: false });
  await restorePendingMingCall();
  renderHome();
  setTab('home');
  updateNotifDot();

  const sharedUpdateId = new URLSearchParams(window.location.search).get('update');
  if (sharedUpdateId) {
    setTimeout(() => {
      const sharedPost = document.getElementById('upd-' + sharedUpdateId);
      if (sharedPost) {
        sharedPost.scrollIntoView({ behavior: 'smooth', block: 'center' });
        sharedPost.style.outline = '2px solid var(--coffee)';
        sharedPost.style.outlineOffset = '4px';
        setTimeout(() => {
          sharedPost.style.outline = '';
          sharedPost.style.outlineOffset = '';
        }, 2200);
      }
    }, 180);
  }
  /*
     The location request may already be running or complete by this point.
     Do not start a duplicate request here.
  */
  await startMingPresence();

  document.addEventListener('visibilitychange', async () => {
    if (document.hidden) {
      await untrackMingPresence();
      await syncMingPresenceUsers();
      return;
    }

    await trackMingPresence();
    await syncMingPresenceUsers();

    if (state.locStatus === 'granted') requestLocation();
  });

  window.addEventListener('pagehide', () => {
    /* Realtime will close the socket when the page is actually left.
       Visibility handling above also removes background tabs from presence. */
    untrackMingPresence();
  });

  setInterval(tickExpiry, 60000);
}
boot();
























/*================================
   SPACES.JS
================================*/
/* ============================================================
   Tweaklr — Spaces
   spaces.js  ·  loaded after app.js, reuses its helpers
   ($, esc, icon, avatar, toast, openSheet, openModal, pushStack,
    popStack, currentUser, people, byId, hasLocation, distLabel…)

   Sections:
     Icons · Server (trust boundary) · Seed data · Screen mounting
     Spaces index · Create wizard · Invitations · Space shell
     Business · Friendly · Casual · Silly · Romantic
     Marketplace · Escrow · Disputes · Wallet · Events

   TRUST BOUNDARY
   --------------
   Everything below the `Server` object is presentation. The UI never
   assigns a status, a role, a balance or an order state: it calls
   Server.submit(action, payload) and re-renders whatever comes back.
   `Server` is a stand-in for the Postgres functions in schema.sql —
   same action names, same guards, same rejection reasons — so moving
   to Supabase is a transport change, not a rewrite.
   ============================================================ */

/* ------------------------------------------------------------
   ICONS (added to the existing sprite)
------------------------------------------------------------ */
(function addIcons() {
  const defs = {
    'sp-store': '<path d="M4 9.5 5.6 5h12.8L20 9.5M4 9.5h16M4 9.5v9A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5v-9M4 9.5a2.6 2.6 0 0 0 4 0 2.6 2.6 0 0 0 4 0 2.6 2.6 0 0 0 4 0 2.6 2.6 0 0 0 4 0"/>',
    'sp-wallet': '<rect x="3.5" y="6.5" width="17" height="12" rx="2.6"/><path d="M3.5 10h17M16.5 14.5h1.6"/>',
    'sp-key': '<circle cx="8.5" cy="12" r="3.6"/><path d="M12.1 12H20M17.4 12v3M14.6 12v2.2"/>',
    'sp-grid': '<rect x="4" y="4" width="7" height="7" rx="1.8"/><rect x="13" y="4" width="7" height="7" rx="1.8"/><rect x="4" y="13" width="7" height="7" rx="1.8"/><rect x="13" y="13" width="7" height="7" rx="1.8"/>',
    'sp-list': '<path d="M8 6.5h12M8 12h12M8 17.5h12M4.2 6.5h.01M4.2 12h.01M4.2 17.5h.01"/>',
    'sp-poll': '<path d="M6 19V11M12 19V5M18 19v-5"/>',
    'sp-box': '<path d="m12 3.5 8 4v9l-8 4-8-4v-9z"/><path d="m4 7.5 8 4 8-4M12 11.5V20"/>',
    'sp-scale': '<path d="M12 4.5v15M6 8h12M6.5 8 4 14h5zM17.5 8 15 14h5zM8 19.5h8"/>',
    'sp-heart2': '<path d="M12 19.5s-6.6-4-6.6-8.5A3.6 3.6 0 0 1 12 8.6a3.6 3.6 0 0 1 6.6 2.4c0 4.5-6.6 8.5-6.6 8.5z"/>',
    'sp-game': '<rect x="3" y="7.5" width="18" height="9.5" rx="4.2"/><path d="M7.5 10.6v3.2M5.9 12.2h3.2M15.6 11.4h.01M17.8 13.2h.01"/>',
    'sp-sun': '<circle cx="12" cy="12" r="4"/><path d="M12 3.5v2M12 18.5v2M20.5 12h-2M5.5 12h-2M17.9 6.1l-1.4 1.4M7.5 16.5l-1.4 1.4M17.9 17.9l-1.4-1.4M7.5 7.5 6.1 6.1"/>',
    'sp-doc': '<path d="M6.5 3.5h7L18 8v12.5H6.5z"/><path d="M13.2 3.5V8H18M9.5 12.5h5M9.5 16h3.5"/>',
    'sp-bolt': '<path d="M13.4 3.5 6 13.2h5.2L10.6 20.5 18 10.8h-5.2z"/>',
    'sp-copy': '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.4"/><path d="M15.5 8.5v-2a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2"/>',
    'sp-refresh': '<path d="M20 12a8 8 0 1 1-2.6-5.9M20 4.5V10h-5.4"/>',
    'sp-camera': '<path d="M4 8.5h3.2l1.4-2.4h6.8l1.4 2.4H20a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 20 20H4a1.5 1.5 0 0 1-1.5-1.5v-8A1.5 1.5 0 0 1 4 8.5z"/><circle cx="12" cy="14" r="3.4"/>',
    'sp-globe': '<circle cx="12" cy="12" r="8.4"/><path d="M3.8 12h16.4M12 3.6c2.2 2.4 3.3 5.3 3.3 8.4S14.2 18 12 20.4C9.8 18 8.7 15.1 8.7 12S9.8 6 12 3.6z"/>'
  };
  const svg = document.querySelector('svg[aria-hidden="true"]');
  if (!svg) return;
  Object.entries(defs).forEach(([id, d]) => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'symbol');
    s.setAttribute('id', 'i-' + id);
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '1.7');
    s.setAttribute('stroke-linecap', 'round');
    s.setAttribute('stroke-linejoin', 'round');
    s.innerHTML = d;
    svg.appendChild(s);
  });
})();

/* ============================================================
   SERVER — the only thing allowed to mutate protected state.
   Mirror of schema.sql. Replace the bodies with Supabase RPC
   calls and the UI above it does not change.
============================================================ */
const Server = (() => {

  /* ---- "tables" ---- */
  const db = {
    spaces: [],
    members: [],          // { spaceId, userId, role, joinedAt }
    invites: [],          // { spaceId, codeHash, hint, expiresAt, maxUses, uses, revoked, version }
    content: [],          // { id, spaceId, kind, ... }  space-native content
    openRoles: [],
    products: [],
    orders: [],
    orderEvents: [],      // append-only
    disputes: [],
    evidence: [],
    files: [],
    bids: [],
    walletAccounts: [],   // { userId, asset, available, held }
    walletEntries: [],    // append-only ledger
    audit: []             // append-only
  };

  const session = { userId: currentUser.id };

  /* ---- roles & permissions (server-side truth) ---- */
  const ROLE_SETS = {
    business: ['owner', 'admin', 'manager', 'member'],
    friendly: ['owner', 'moderator', 'member'],
    casual: ['owner', 'moderator', 'member', 'guest'],
    silly: ['owner', 'moderator', 'member'],
    romantic: ['owner', 'member'],
    marketplace: ['owner', 'moderator', 'seller', 'buyer']
  };
  const RANK = { owner: 100, admin: 80, manager: 60, moderator: 60, seller: 40, member: 30, buyer: 30, guest: 10 };
  const NEEDS = {
    'space.update': 80, 'space.invite.rotate': 80, 'space.member.role': 80, 'space.member.remove': 60,
    'space.post': 30, 'space.post.pin': 60, 'space.moderate': 60,
    'product.create': 40, 'order.create': 30, 'dispute.arbitrate': 60
  };

  function roleOf(spaceId, userId = session.userId) {
    const m = db.members.find(x => x.spaceId === spaceId && x.userId === userId);
    return m ? m.role : null;
  }
  function can(spaceId, action, userId = session.userId) {
    const r = roleOf(spaceId, userId);
    if (!r) return false;
    const need = NEEDS[action];
    if (need === undefined) return true;
    return RANK[r] >= need;
  }

  /* ---- invitation codes ----
     Generated with a CSPRNG. Only the hash is stored; the plaintext is
     returned once, at issuance. Rotating bumps `version` and revokes the
     previous row, so the old code stops validating immediately.
     In production this is a Postgres function using pgcrypto's digest(). */
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1
  function randomCode() {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    const s = Array.from(bytes, b => ALPHABET[b % ALPHABET.length]).join('');
    return s.slice(0, 4) + '-' + s.slice(4, 8);
  }
  async function hashCode(code) {
    const norm = code.trim().toUpperCase();
    if (crypto.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(norm));
      return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
    }
    // Dev fallback: crypto.subtle needs a secure context and this file may be
    // opened from disk. Never ship this path — hashing belongs in Postgres.
    let h = 0x811c9dc5;
    for (let i = 0; i < norm.length; i++) { h ^= norm.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return 'dev' + h.toString(16);
  }

  async function issueInvite(spaceId, cfg = {}) {
    const prev = db.invites.filter(i => i.spaceId === spaceId && !i.revoked);
    prev.forEach(i => { i.revoked = true; i.revokedAt = Date.now(); });
    const code = randomCode();
    const row = {
      spaceId,
      codeHash: await hashCode(code),
      hint: code.slice(-2),
      createdAt: Date.now(),
      expiresAt: cfg.ttlHours ? Date.now() + cfg.ttlHours * 3600e3 : null,
      maxUses: cfg.maxUses || null,
      uses: 0,
      revoked: false,
      version: (prev[0] ? prev[0].version : 0) + 1
    };
    db.invites.push(row);
    audit(spaceId, prev.length ? 'invite.rotated' : 'invite.issued', { version: row.version });
    return { invite: row, code };   // plaintext leaves the server exactly once
  }

  async function redeemInvite(code) {
    const h = await hashCode(code);
    const row = db.invites.find(i => i.codeHash === h && !i.revoked);
    if (!row) return { ok: false, error: 'That code is not valid. It may have been regenerated.' };
    if (row.expiresAt && row.expiresAt < Date.now()) return { ok: false, error: 'That invitation has expired.' };
    if (row.maxUses && row.uses >= row.maxUses) return { ok: false, error: 'That invitation has been used its maximum number of times.' };
    const space = db.spaces.find(s => s.id === row.spaceId);
    if (roleOf(space.id)) return { ok: false, error: 'You are already in this Space.' };
    if (space.maxMembers && memberCount(space.id) >= space.maxMembers) return { ok: false, error: 'This Space is full.' };
    row.uses++;
    const role = space.nature === 'marketplace' ? 'buyer' : 'member';
    db.members.push({ spaceId: space.id, userId: session.userId, role, joinedAt: Date.now(), approved: !space.requireApproval });
    audit(space.id, 'member.joined', { via: 'invite', version: row.version });
    return { ok: true, data: { space } };
  }

  const memberCount = spaceId => db.members.filter(m => m.spaceId === spaceId).length;

  function audit(spaceId, event, meta) {
    const entry = Object.freeze({
      id: 'local_' + db.audit.length + '_' + Date.now(), spaceId, actor: session.userId,
      event, meta: meta || {}, at: Date.now()
    });
    db.audit.push(entry);
    // Durable activity is written through a membership-checked RPC. The UI
    // still works if the migration has not been applied; persistence then waits.
    try {
      void supabaseClient.rpc('record_ming_space_activity', {
        p_space_id: spaceId, p_event: event, p_meta: meta || {}
      }).then(({ data, error }) => {
        if (error) {
          console.warn('Tweaklr: Space activity could not be persisted. Run the Business Activity Log migration if it has not been applied.', error.message);
          return;
        }
        if (data && data.id) {
          const index = db.audit.indexOf(entry);
          if (index >= 0) db.audit[index] = Object.freeze({
            id: data.id, spaceId, actor: session.userId, event, meta: meta || {},
            at: data.created_at ? new Date(data.created_at).getTime() : entry.at
          });
        }
      }).catch(error => console.warn('Tweaklr: Space activity persistence failed.', error));
    } catch (error) {
      console.warn('Tweaklr: Space activity persistence could not start.', error);
    }
  }

  /* ---- escrow state machine ----
     transition -> { to, who: roles allowed, guard }
     The client may only name a transition. The server decides if it is legal
     for that actor, in that state, at that time. */
  const ORDER_FLOW = {
    pending: {
      fund: { to: 'funded', who: ['buyer'] },
      cancel: { to: 'cancelled', who: ['buyer', 'seller'] }
    },
    funded: {
      seller_confirm: { to: 'seller_confirmed', who: ['seller'] },
      cancel: { to: 'cancelled', who: ['seller'] },
      dispute: { to: 'disputed', who: ['buyer', 'seller'] }
    },
    seller_confirmed: {
      ship: { to: 'shipped', who: ['seller'] },
      dispute: { to: 'disputed', who: ['buyer', 'seller'] }
    },
    shipped: {
      confirm_delivery: { to: 'delivered', who: ['buyer'] },
      dispute: { to: 'disputed', who: ['buyer', 'seller'] }
    },
    delivered: {
      accept: { to: 'accepted', who: ['buyer'] },
      dispute: { to: 'disputed', who: ['buyer'] }
    },
    accepted: {
      release: { to: 'completed', who: ['system'] }
    },
    disputed: {
      resolve_release: { to: 'completed', who: ['arbiter'] },
      resolve_refund: { to: 'refunded', who: ['arbiter'] }
    },
    completed: {}, refunded: {}, cancelled: {}
  };

  const TERMINAL = ['completed', 'refunded', 'cancelled'];

  function partyOf(order, userId = session.userId) {
    if (order.buyerId === userId) return 'buyer';
    if (order.sellerId === userId) return 'seller';
    if (can(order.spaceId, 'dispute.arbitrate', userId)) return 'arbiter';
    return null;
  }

  function orderEvent(order, from, to, transition, meta) {
    db.orderEvents.push(Object.freeze({
      id: 'oe_' + db.orderEvents.length, orderId: order.id,
      from, to, transition, actor: session.userId, at: Date.now(), meta: meta || {}
    }));
  }

  /* ---- wallet ledger (development mode, no custody) ----
     Balances are derived from append-only entries, never assigned.
     A real deployment replaces this with a custodial provider and
     on-chain settlement; nothing here touches a blockchain. */
  function account(userId, asset) {
    let a = db.walletAccounts.find(x => x.userId === userId && x.asset === asset);
    if (!a) { a = { userId, asset, available: 0, held: 0 }; db.walletAccounts.push(a); }
    return a;
  }
  function ledger(userId, asset, kind, amount, ref, note) {
    db.walletEntries.unshift(Object.freeze({
      id: 'we_' + db.walletEntries.length, userId, asset, kind, amount, ref, note,
      at: Date.now(), mode: 'development'
    }));
  }
  function hold(userId, asset, amount, ref) {
    const a = account(userId, asset);
    if (a.available < amount) return false;
    a.available -= amount; a.held += amount;
    ledger(userId, asset, 'escrow_hold', -amount, ref, 'Held in escrow');
    return true;
  }
  function releaseHold(order, toSeller) {
    const a = account(order.buyerId, order.asset);
    a.held -= order.total;
    if (toSeller) {
      ledger(order.buyerId, order.asset, 'escrow_release', 0, order.id, 'Released to seller');
      const s = account(order.sellerId, order.asset);
      const fee = Math.round(order.total * 0.015 * 100) / 100;      // platform fee
      s.available += order.total - fee;
      ledger(order.sellerId, order.asset, 'sale_payout', order.total - fee, order.id, 'Sale settled');
      ledger(order.sellerId, order.asset, 'fee', -fee, order.id, 'Tweaklr fee 1.5%');
    } else {
      a.available += order.total;
      ledger(order.buyerId, order.asset, 'escrow_refund', order.total, order.id, 'Refunded');
    }
  }

  async function uploadSpaceFile(spaceId, file, kind = 'file', contentId = null, productId = null) {
    if (!file || !spaceId || !session.userId) return { ok:false, error:'Missing file or Space.' };
    const safe = String(file.name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120);
    const path = `${spaceId}/${session.userId}/${crypto.randomUUID()}-${safe}`;
    const { error: uploadError } = await supabaseClient.storage.from('ming-space-media').upload(path, file, {
      cacheControl: '3600', upsert: false, contentType: file.type || 'application/octet-stream'
    });
    if (uploadError) return { ok:false, error:uploadError.message || 'File upload failed.' };
    const { data: row, error: recordError } = await supabaseClient.rpc('record_ming_space_file', {
      p_space_id: spaceId, p_storage_path: path, p_filename: file.name || safe,
      p_content_type: file.type || 'application/octet-stream', p_size_bytes: file.size || 0,
      p_kind: kind, p_content_id: contentId, p_product_id: productId
    });
    if (recordError) {
      await supabaseClient.storage.from('ming-space-media').remove([path]);
      return { ok:false, error:recordError.message || 'File metadata could not be saved.' };
    }
    const mapped = { id:row.id, spaceId:row.space_id, ownerId:row.owner_id, contentId:row.content_id, productId:row.product_id, storagePath:row.storage_path, filename:row.filename, contentType:row.content_type, sizeBytes:Number(row.size_bytes||0), kind:row.kind, createdAt:new Date(row.created_at).getTime() };
    db.files.unshift(mapped);
    return { ok:true, data:{ file:mapped } };
  }

  async function openSpaceFile(fileId, forceDownload = false) {
    const file = db.files.find(f => f.id === fileId);
    if (!file) return;
    // Open the browsing tab during the trusted click, before awaiting Supabase,
    // so mobile browsers are less likely to block the signed-file destination.
    const tab = window.open('about:blank', '_blank');
    try { if (tab) tab.opener = null; } catch (_) {}
    const options = forceDownload ? { download: file.displayName || file.filename || true } : undefined;
    const { data, error } = await supabaseClient.storage.from('ming-space-media').createSignedUrl(file.storagePath, 300, options);
    if (error || !data?.signedUrl) {
      if (tab) tab.close();
      toast(error?.message || 'File could not be opened.', 'x');
      return;
    }
    if (tab) tab.location.href = data.signedUrl;
    else toast('Your browser blocked the new tab. Allow pop-ups for Tweaklr and try again.', 'x');
  }

  async function load() {
    session.userId = currentUser.id;
    if (!isUuidPerson(session.userId)) return false;

    let data;
    try {
      const result = await supabaseClient.rpc('get_my_ming_spaces');
      data = result.data;
      if (result.error) {
        console.warn('Tweaklr: Spaces database load failed.', result.error.message);
        return false;
      }
    } catch (error) {
      console.warn('Tweaklr: Spaces database load request failed.', error);
      return false;
    }

    db.spaces = [];
    db.members = [];
    db.invites = [];
    db.content = [];
    db.openRoles = [];
    db.products = [];
    db.files = [];
    db.bids = [];
    db.audit = [];

    (data || []).forEach(row => {
      if (!db.spaces.some(s => s.id === row.space_id)) {
        db.spaces.push({
          id: row.space_id,
          name: row.name,
          description: row.description || '',
          nature: row.nature,
          privacy: row.privacy,
          discoverable: !!row.discoverable,
          requireApproval: !!row.require_approval,
          maxMembers: row.max_members ?? null,
          hue: row.hue ?? null,
          locationLinked: !!row.location_linked,
          expiresAt: row.expires_at ? new Date(row.expires_at).getTime() : null,
          features: row.features || {},
          theme: row.theme || (row.features && row.features.theme) || null,
          ownerId: row.owner_id,
          createdAt: new Date(row.created_at).getTime()
        });
      }

      db.members.push({
        spaceId: row.space_id,
        userId: row.member_id,
        role: row.member_role,
        joinedAt: new Date(row.member_joined_at).getTime(),
        approved: row.member_approved !== false
      });

      if (row.invite_id && !db.invites.some(i => i.spaceId === row.space_id)) {
        db.invites.push({
          id: row.invite_id,
          spaceId: row.space_id,
          codeHash: row.invite_code_hash,
          hint: row.invite_hint,
          createdAt: new Date(row.invite_created_at).getTime(),
          expiresAt: row.invite_expires_at ? new Date(row.invite_expires_at).getTime() : null,
          maxUses: row.invite_max_uses ?? null,
          uses: row.invite_uses || 0,
          revoked: !!row.invite_revoked,
          version: row.invite_version || 1
        });
      }
    });

    const optionalLoaders = [
      {
        name: 'content',
        rpc: 'get_my_ming_space_content',
        map: row => ({ id: row.id, spaceId: row.space_id, kind: row.kind, authorId: row.author_id, at: new Date(row.created_at).getTime(), updatedAt: new Date(row.updated_at).getTime(), ...(row.payload || {}) })
      },
      {
        name: 'products',
        rpc: 'get_my_ming_space_products',
        map: row => ({ id: row.id, spaceId: row.space_id, sellerId: row.seller_id, title: row.title, price: Number(row.price), asset: row.asset, condition: row.condition, category: row.category, qty: row.qty, handover: row.handover, description: row.description, media: row.media || [], auction: row.auction || {}, createdAt: new Date(row.created_at).getTime(), status: row.status })
      },
      {
        name: 'files',
        rpc: 'get_my_ming_space_files',
        map: row => ({ id: row.id, spaceId: row.space_id, ownerId: row.owner_id, contentId: row.content_id, productId: row.product_id, storagePath: row.storage_path, filename: row.filename, displayName: row.display_name || row.filename, category: row.category || 'General', contentType: row.content_type, sizeBytes: Number(row.size_bytes || 0), kind: row.kind, createdAt: new Date(row.created_at).getTime() })
      },
      {
        name: 'bids',
        rpc: 'get_my_ming_space_product_bids',
        map: row => ({ id: row.id, productId: row.product_id, bidderId: row.bidder_id, amount: Number(row.amount), createdAt: new Date(row.created_at).getTime() })
      },
      {
        name: 'audit',
        rpc: 'get_my_ming_space_activity',
        map: row => ({ id: row.id, spaceId: row.space_id, actor: row.actor_id, event: row.event, meta: row.meta || {}, at: new Date(row.created_at).getTime() })
      }
    ];

    // These loaders read independent tables. Run them concurrently so the
    // Spaces screen does not wait for five sequential network round-trips.
    await Promise.all(optionalLoaders.map(async loader => {
      try {
        const { data: rows, error } = await supabaseClient.rpc(loader.rpc);
        if (error) {
          console.warn(`Tweaklr: optional Spaces loader skipped (${loader.name}).`, error.message);
          return;
        }
        db[loader.name] = (rows || []).map(loader.map);
      } catch (error) {
        console.warn(`Tweaklr: optional Spaces loader skipped (${loader.name}).`, error);
      }
    }));
    const memberIds = [...new Set(db.members.map(m => m.userId).filter(id => id && id !== currentUser.id))];
    if (memberIds.length) {
      const { data: profiles, error: profileError } = await supabaseClient
        .from('profiles')
        .select('id, username, display_name, avatar_url, bio, headline, interests, tags, activity')
        .in('id', memberIds);

      if (!profileError) {
        (profiles || []).forEach(profile => {
          const displayName = profile.display_name || '';
          mingConnectionProfiles.set(profile.id, {
            id: profile.id,
            name: displayName,
            short: displayName.split(' ')[0] || '',
            username: profile.username ? '@' + profile.username.replace(/^@/, '') : '',
            avatarUrl: profile.avatar_url || '',
            bio: profile.bio || '',
            tag: profile.headline || '',
            interests: Array.isArray(profile.interests) ? profile.interests : [],
            tags: Array.isArray(profile.tags) ? profile.tags : [],
            activity: profile.activity || '',
            hue: 0,
            status: null,
            visitor: false
          });
        });
      }
    }

    return true;
  }

  /* ---- the single entry point ---- */
  async function submit(action, p = {}) {
    const deny = msg => ({ ok: false, error: msg });

    switch (action) {

      case 'space.create': {
        if (!p.name || p.name.trim().length < 2) return deny('A Space needs a name.');
        if (!ROLE_SETS[p.nature]) return deny('Unknown Space nature.');
        if (!session.userId || !isUuidPerson(session.userId)) return deny('Please sign in again.');

        const { data, error } = await supabaseClient.rpc('create_ming_space', {
          p_name: p.name.trim(),
          p_description: (p.description || '').trim(),
          p_nature: p.nature,
          p_privacy: p.privacy || 'private',
          p_require_approval: !!p.requireApproval,
          p_max_members: p.maxMembers || null,
          p_hue: p.hue ?? null,
          p_location_linked: !!p.locationLinked,
          p_expires_at: p.ttlDays ? new Date(Date.now() + p.ttlDays * 864e5).toISOString() : null,
          p_features: { ...(p.features || {}), theme: p.theme || p.features?.theme || null },
          p_invite_ttl_hours: p.inviteTtlHours || null,
          p_invite_max_uses: p.inviteMaxUses || null
        });

        if (error) {
          console.warn('Tweaklr: Space creation failed.', error.message);
          return deny(error.message || 'Could not create this Space.');
        }

        const space = data?.space;
        const member = data?.member;
        const invite = data?.invite;
        if (!space || !member) return deny('The Space was not returned by the database.');

        db.spaces = db.spaces.filter(s => s.id !== space.id);
        db.spaces.push({
          id: space.id,
          name: space.name,
          description: space.description || '',
          nature: space.nature,
          privacy: space.privacy,
          discoverable: !!space.discoverable,
          requireApproval: !!space.requireApproval,
          maxMembers: space.maxMembers ?? null,
          hue: space.hue ?? null,
          locationLinked: !!space.locationLinked,
          expiresAt: space.expiresAt ? new Date(space.expiresAt).getTime() : null,
          features: space.features || {},
          theme: space.theme || (space.features && space.features.theme) || null,
          ownerId: space.ownerId,
          createdAt: new Date(space.createdAt).getTime()
        });

        db.members = db.members.filter(m => !(m.spaceId === member.spaceId && m.userId === member.userId));
        db.members.push({
          spaceId: member.spaceId,
          userId: member.userId,
          role: member.role,
          joinedAt: new Date(member.joinedAt).getTime(),
          approved: member.approved !== false
        });

        if (invite) {
          db.invites = db.invites.filter(i => i.spaceId !== space.id);
          db.invites.push({
            spaceId: space.id,
            codeHash: invite.codeHash,
            hint: invite.hint,
            createdAt: new Date(invite.createdAt).getTime(),
            expiresAt: invite.expiresAt ? new Date(invite.expiresAt).getTime() : null,
            maxUses: invite.maxUses ?? null,
            uses: invite.uses || 0,
            revoked: !!invite.revoked,
            version: invite.version || 1
          });
        }

        return { ok: true, data: { space: db.spaces.find(s => s.id === space.id), code: data.code } };
      }

      case 'space.invite.rotate': {
        if (!can(p.spaceId, 'space.invite.rotate')) return deny('Only owners and admins can regenerate the code.');
        const { data, error } = await supabaseClient.rpc('rotate_ming_space_invite', {
          p_space_id: p.spaceId,
          p_ttl_hours: p.ttlHours ?? 24,
          p_max_uses: p.maxUses ?? null
        });
        if (error) return deny(error.message || 'Could not regenerate the invitation.');
        return { ok: true, data: data || {} };
      }

      case 'space.leave': {
        if (!session.userId || !isUuidPerson(session.userId)) return deny('Please sign in again.');
        const { error } = await supabaseClient.rpc('leave_ming_space', { p_space_id: p.spaceId });
        if (error) return deny(error.message || 'Could not leave this Space.');
        db.spaces = db.spaces.filter(x => x.id !== p.spaceId);
        db.members = db.members.filter(x => x.spaceId !== p.spaceId || x.userId !== session.userId);
        return { ok: true };
      }

      case 'space.delete': {
        if (!session.userId || !isUuidPerson(session.userId)) return deny('Please sign in again.');
        const { error } = await supabaseClient.rpc('delete_ming_space', { p_space_id: p.spaceId });
        if (error) {
          console.warn('Tweaklr: Space deletion failed.', error.message);
          return deny(error.message || 'Could not delete this Space.');
        }
        db.spaces = db.spaces.filter(x => x.id !== p.spaceId);
        db.members = db.members.filter(x => x.spaceId !== p.spaceId);
        db.invites = db.invites.filter(x => x.spaceId !== p.spaceId);
        return { ok: true };
      }

      case 'space.join': {
        if (!session.userId || !isUuidPerson(session.userId)) return deny('Please sign in again.');
        const { data, error } = await supabaseClient.rpc('redeem_ming_space_invite', { p_code: p.code || '' });
        if (error) {
          console.warn('Tweaklr: Space join failed.', error.message);
          return deny(error.message || 'That invitation could not be used.');
        }
        const joined = data;
        if (!joined?.id) return deny('The Space could not be loaded.');
        await loadSpacesFromDatabase();
        return { ok: true, data: { space: spaceById(joined.id) || joined } };
      }

      case 'space.member.role': {
        if (!can(p.spaceId, 'space.member.role')) return deny('You cannot change roles here.');
        const target = db.members.find(m => m.spaceId === p.spaceId && m.userId === p.userId);
        if (!target) return deny('Not a member.');
        if (target.role === 'owner') return deny('The owner role cannot be reassigned here.');
        const space = db.spaces.find(s => s.id === p.spaceId);
        if (!ROLE_SETS[space.nature].includes(p.role)) return deny('That role does not exist in this Space.');
        const { data: updated, error } = await supabaseClient.rpc('set_ming_space_member_role', { p_space_id: p.spaceId, p_user_id: p.userId, p_role: p.role });
        if (error) return deny(error.message || 'Could not change this role.');
        target.role = updated.role;
        audit(p.spaceId, 'member.role_changed', { userId: p.userId, role: p.role });
        return { ok: true, data: { member: target } };
      }

      case 'space.post': {
        if (!can(p.spaceId, 'space.post')) return deny('You cannot post in this Space.');
        const { data: created, error } = await supabaseClient.rpc('create_ming_space_content', {
          p_space_id: p.spaceId,
          p_kind: p.kind,
          p_payload: p.payload || {}
        });
        if (error) return deny(error.message || 'Could not save this Space content.');
        const row = { id: created.id, spaceId: created.space_id, kind: created.kind, authorId: created.author_id, at: new Date(created.created_at).getTime(), ...(created.payload || {}) };
        db.content.unshift(row);
        audit(p.spaceId, 'content.created', { kind: p.kind });
        return { ok: true, data: { row } };
      }

      case 'content.mutate': {
        const row = db.content.find(c => c.id === p.id);
        if (!row) return deny('Gone.');
        if (p.op === 'react') {
          row.reacts = row.reacts || {};
          row.mine = row.mine || {};
          const on = !row.mine[p.key];
          row.mine[p.key] = on;
          row.reacts[p.key] = (row.reacts[p.key] || 0) + (on ? 1 : -1);
        }
        if (p.op === 'vote') {
          if (row.voted !== undefined && row.voted !== null) row.options[row.voted].votes--;
          row.options[p.index].votes++;
          row.voted = p.index;
        }
        if (p.op === 'toggle') {
          if (!can(row.spaceId, 'space.post')) return deny('Not allowed.');
          row.done = !row.done;
          row.status = row.done ? 'completed' : 'todo';
          audit(row.spaceId, 'task.toggled', { id: row.id, done: row.done });
        }
        if (p.op === 'listadd') row.items.push({ t: p.text, done: false });
        if (p.op === 'listtoggle') row.items[p.index].done = !row.items[p.index].done;
        const payload = Object.fromEntries(Object.entries(row).filter(([k]) => !['id','spaceId','authorId','kind','at','updatedAt'].includes(k)));
        const { error } = await supabaseClient.rpc('update_ming_space_content', { p_id: row.id, p_payload: payload });
        if (error) return deny(error.message || 'Could not save the change.');
        if (p.op === 'taskupdate' && row.kind === 'task') {
          audit(row.spaceId, 'task.updated', { status: row.status || (row.done ? 'completed' : 'todo'), priority: row.priority || 'medium' });
        }
        return { ok: true, data: { row } };
      }

      case 'product.create': {
        if (!can(p.spaceId, 'product.create')) return deny('You need the seller role in this Space.');
        if (!(p.price > 0)) return deny('Price must be positive.');
        const { data: created, error } = await supabaseClient.rpc('create_ming_space_product', {
          p_space_id: p.spaceId, p_title: p.title, p_price: p.price,
          p_condition: p.condition, p_category: p.category, p_handover: p.handover,
          p_description: p.description || '', p_qty: p.qty || 1,
          p_media: p.media || [], p_auction: p.auction || {}
        });
        if (error) return deny(error.message || 'Could not save this listing.');
        const row = {
          id: created.id, spaceId: created.space_id, sellerId: created.seller_id,
          title: created.title, price: Number(created.price), asset: created.asset,
          condition: created.condition, category: created.category, qty: created.qty,
          handover: created.handover, description: created.description, media: created.media || [],
          auction: created.auction || {}, createdAt: new Date(created.created_at).getTime(), status: created.status
        };
        db.products.unshift(row);
        audit(p.spaceId, 'product.listed', { id: row.id, price: row.price });
        return { ok: true, data: { row } };
      }

      case 'order.create': {
        const prod = db.products.find(x => x.id === p.productId);
        if (!prod || prod.status !== 'listed') return deny('That listing is no longer available.');
        if (prod.sellerId === session.userId) return deny('You cannot buy your own listing.');
        if (!can(prod.spaceId, 'order.create')) return deny('Join this Space to buy.');
        /* Price comes from the listing row, never from the client. */
        const order = {
          id: 'MO-' + Date.now().toString(36).toUpperCase().slice(-6),
          spaceId: prod.spaceId, productId: prod.id,
          buyerId: session.userId, sellerId: prod.sellerId,
          unit: prod.price, qty: 1, total: prod.price,
          asset: prod.asset, status: 'pending',
          idempotencyKey: p.idempotencyKey,
          createdAt: Date.now(), acceptanceDeadline: null
        };
        const dupe = db.orders.find(o => o.idempotencyKey === p.idempotencyKey);
        if (dupe) return { ok: true, data: { order: dupe } };   // replay-safe
        db.orders.unshift(order);
        orderEvent(order, null, 'pending', 'create');
        audit(prod.spaceId, 'order.created', { id: order.id });
        return { ok: true, data: { order } };
      }

      case 'order.transition': {
        const order = db.orders.find(o => o.id === p.orderId);
        if (!order) return deny('Order not found.');
        const allowed = ORDER_FLOW[order.status] || {};
        const rule = allowed[p.transition];
        if (!rule) return deny(`"${p.transition}" is not possible while this order is ${order.status.replace('_', ' ')}.`);
        const party = partyOf(order);
        if (!party || !rule.who.includes(party)) return deny('You are not a party to that step.');

        const from = order.status;

        if (p.transition === 'fund') {
          if (!hold(order.buyerId, order.asset, order.total, order.id)) {
            return deny('Not enough available balance in your development wallet.');
          }
        }
        if (p.transition === 'confirm_delivery') {
          order.acceptanceDeadline = Date.now() + 72 * 3600e3;   // buyer acceptance window
        }
        if (p.transition === 'cancel' && from === 'funded') releaseHold(order, false);
        if (p.transition === 'resolve_release') releaseHold(order, true);
        if (p.transition === 'resolve_refund') releaseHold(order, false);

        order.status = rule.to;
        orderEvent(order, from, order.status, p.transition, p.meta);
        audit(order.spaceId, 'order.' + p.transition, { id: order.id, to: order.status });

        /* Release is a system step, not a user action: acceptance triggers it. */
        if (order.status === 'accepted') {
          releaseHold(order, true);
          order.status = 'completed';
          orderEvent(order, 'accepted', 'completed', 'release', { by: 'system' });
          audit(order.spaceId, 'order.released', { id: order.id });
        }
        if (TERMINAL.includes(order.status)) {
          const prod = db.products.find(x => x.id === order.productId);
          if (prod && order.status === 'completed') { prod.qty -= order.qty; if (prod.qty <= 0) prod.status = 'sold'; }
        }
        return { ok: true, data: { order } };
      }

      case 'dispute.open': {
        const order = db.orders.find(o => o.id === p.orderId);
        if (!order) return deny('Order not found.');
        const party = partyOf(order);
        if (party !== 'buyer' && party !== 'seller') return deny('Only the buyer or seller can open a dispute.');
        const res = await submit('order.transition', { orderId: order.id, transition: 'dispute', meta: { reason: p.reason } });
        if (!res.ok) return res;
        const d = {
          id: 'dp_' + Math.random().toString(36).slice(2, 8),
          orderId: order.id, spaceId: order.spaceId,
          openedBy: session.userId, reason: p.reason, detail: p.detail,
          status: 'evidence', openedAt: Date.now(),
          evidenceDeadline: Date.now() + 96 * 3600e3
        };
        db.disputes.unshift(d);
        audit(order.spaceId, 'dispute.opened', { orderId: order.id, reason: p.reason });
        return { ok: true, data: { dispute: d } };
      }

      case 'dispute.evidence': {
        const d = db.disputes.find(x => x.id === p.disputeId);
        if (!d) return deny('Dispute not found.');
        const order = db.orders.find(o => o.id === d.orderId);
        const party = partyOf(order);
        if (!party) return deny('You are not a party to this dispute.');
        db.evidence.push(Object.freeze({
          id: 'ev_' + db.evidence.length, disputeId: d.id, party,
          userId: session.userId, kind: p.kind, label: p.label, at: Date.now()
        }));
        audit(d.spaceId, 'dispute.evidence_added', { disputeId: d.id, kind: p.kind });
        return { ok: true, data: { dispute: d } };
      }

      default: return deny('Unknown action.');
    }
  }

  return {
    db, session, load, submit, can, roleOf, memberCount, uploadSpaceFile, openSpaceFile,
    ROLE_SETS, RANK, ORDER_FLOW, TERMINAL, partyOf,
    account, ledger,
    orderEvents: id => db.orderEvents.filter(e => e.orderId === id),
    evidenceFor: id => db.evidence.filter(e => e.disputeId === id),
    auditFor: id => db.audit.filter(a => a.spaceId === id).slice().reverse(),
    recordActivity: audit,
    /* seeding only — never call from UI code */
    _seed: fn => fn(db, { issueInvite, ledger, account })
  };
})();

/* ============================================================
   SPACE NATURES — identity, not decoration
============================================================ */
const NATURES = {
  business: {
    label: 'Business', eyebrow: 'Build with intent', icon: 'sp-doc', hue: 215,
    blurb: 'Teams, clients and projects with structure, roles and a record of decisions.',
    signature: 'The workroom',
    promise: 'Turn a group into an operating room — briefs, tasks, roles and decisions stay together.',
    features: ['Briefs & announcements', 'Tasks & ownership', 'Roles & permissions', 'Immutable activity log'],
    swatch: 'linear-gradient(135deg,#14171D,#2A313A 58%,#C5A572)',
    palettes: [
      { name:'Boardroom', colors:['#11151B','#2A313A','#C5A572'] },
      { name:'Ledger', colors:['#17211F','#31524A','#B9D0C5'] },
      { name:'Studio', colors:['#1B1A20','#4A3F52','#D6B4C7'] }
    ],
    tabs: [['brief', 'Brief', 'sp-doc'], ['work', 'Work', 'sp-list'], ['files', 'Files', 'sp-box'], ['people', 'People', 'users'], ['log', 'Log', 'clock']]
  },
  friendly: {
    label: 'Friendly', eyebrow: 'Keep your people close', icon: 'users', hue: 24,
    blurb: 'Your people, moments, plans and running jokes — without the noise of a public feed.',
    signature: 'The circle',
    promise: 'A warm private room for the people you already choose.',
    features: ['Shared moments', 'Polls & decisions', 'Events & plans', 'Member-first home'],
    swatch: 'linear-gradient(135deg,#F5E5D6,#D19A72 62%,#875137)',
    palettes: [
      { name:'Sunroom', colors:['#FFF4E8','#E8B58E','#9A5C43'] },
      { name:'Garden', colors:['#EEF6E9','#A9C98F','#557C55'] },
      { name:'Bonfire', colors:['#FFF0DF','#D78A63','#7A3F32'] }
    ],
    tabs: [['home', 'Home', 'home'], ['moments', 'Moments', 'sp-camera'], ['events', 'Events', 'cal'], ['meetings', 'Meetings', 'sp-bolt'], ['people', 'People', 'users']]
  },
  casual: {
    label: 'Casual', eyebrow: 'Right now matters', icon: 'sp-bolt', hue: 160,
    blurb: 'Fast-moving meetups, visitors and things worth knowing before the moment passes.',
    signature: 'The live room',
    promise: 'Make a temporary room for what is happening now — then let it fade.',
    features: ['Expiring posts', 'Nearby context', 'Meeting points', 'Auto-closing Spaces'],
    swatch: 'linear-gradient(135deg,#E8F3EE,#83C4AA 60%,#0F7058)',
    palettes: [
      { name:'Sidewalk', colors:['#F2F0EA','#B7B1A3','#5C5A52'] },
      { name:'Concrete', colors:['#ECEEEF','#A8B0B5','#59636A'] },
      { name:'Notebook', colors:['#F5F0E7','#C8BBA4','#776A57'] }
    ],
    tabs: [['now', 'Now', 'sp-bolt'], ['around', 'Around', 'pin'], ['people', 'People', 'users']]
  },
  romantic: {
    label: 'Romantic', eyebrow: 'Just the two of you', icon: 'sp-heart2', hue: 350,
    blurb: 'A private world for two — memories, plans and lists that never become public.',
    signature: 'The two-person world',
    promise: 'Give a relationship its own quiet place, separate from the rest of Tweaklr.',
    features: ['Private memories', 'Shared plans', 'Lists for two', 'Always invitation-only'],
    swatch: 'linear-gradient(135deg,#211517,#633438 60%,#C98B6B)',
    palettes: [
      { name:'Velvet', colors:['#241318','#713844','#D59A83'] },
      { name:'Rose', colors:['#FFF0F1','#D98D9C','#813C55'] },
      { name:'Moonlit', colors:['#171727','#49436E','#C9A6C8'] }
    ],
    tabs: [['us', 'Us', 'sp-heart2'], ['memories', 'Memories', 'sp-camera'], ['letters', 'Letters', 'sp-doc'], ['calendar', 'Calendar', 'cal'], ['health', 'Wellness', 'sp-heart2'], ['plans', 'Plans', 'sp-list'], ['names', 'Names', 'users'], ['vault', 'Vault', 'sp-doc']]
  },
  marketplace: {
    label: 'Marketplace', eyebrow: 'Trade with trust', icon: 'sp-store', hue: 150,
    blurb: 'Buy and sell inside a Space with roles, order states and a protected transaction flow.',
    signature: 'The trusted market',
    promise: 'Keep listings, buyers, sellers and the transaction trail inside one accountable room.',
    features: ['Listings & sellers', 'Orders & status', 'Evidence & disputes', 'Escrow-ready flow'],
    swatch: 'linear-gradient(135deg,#E9F0EC,#88B4A0 55%,#1B6047)',
    palettes: [
      { name:'Mercantile', colors:['#F3F0E7','#B79B6C','#4D3924'] },
      { name:'Night Market', colors:['#111A18','#35675A','#D4B46A'] },
      { name:'Gallery', colors:['#F4F3EF','#9BA8A5','#394B48'] }
    ],
    tabs: [['market', 'Market', 'sp-store'], ['orders', 'Orders', 'sp-box'], ['sellers', 'Sellers', 'users'], ['cases', 'Cases', 'sp-scale']]
  }
};



const ORDER_STATES = {
  pending: { t: 'Awaiting payment', cls: '' },
  funded: { t: 'Payment held', cls: 'held' },
  seller_confirmed: { t: 'Seller confirmed', cls: 'held' },
  shipped: { t: 'On the way', cls: 'held' },
  delivered: { t: 'Delivered — acceptance window', cls: 'held' },
  accepted: { t: 'Accepted', cls: 'done' },
  completed: { t: 'Completed', cls: 'done' },
  disputed: { t: 'In dispute', cls: 'disputed' },
  refunded: { t: 'Refunded', cls: 'cancelled' },
  cancelled: { t: 'Cancelled', cls: 'cancelled' }
};
const FLOW_ORDER = ['pending', 'funded', 'seller_confirmed', 'shipped', 'delivered', 'completed'];
const FLOW_COPY = {
  pending: ['Order created', 'Listing reserved at the listed price'],
  funded: ['Payment held', 'Held by Tweaklr, not sent to the seller'],
  seller_confirmed: ['Seller confirmed', 'Seller accepted the order'],
  shipped: ['Handed over', 'Shipped or handed to the buyer'],
  delivered: ['Delivery confirmed', 'Starts a 72-hour acceptance window'],
  completed: ['Funds released', 'Settled to the seller']
};

/* ============================================================
   SPACES STATE (view state only)
============================================================ */
const sp = {
  activeId: null,
  tab: null,
  wizard: null,
  shownCodes: {},        // plaintext held in memory for the owner, this session only
  codeVisibility: {},    // UI-only reveal state; hashes are never reversed
  activeOrder: null,
  activeRoleApplicantsId: null,
  marketTab: 'all',
  indexFilter: 'all',
  pendingMedia: []
};

const spaceById = id => Server.db.spaces.find(s => s.id === id);

async function loadSpacesFromDatabase() {
  if (typeof Server !== 'undefined' && Server.load) {
    try { return await Server.load(); }
    catch (error) { console.error('Tweaklr: Spaces database load failed:', error); return false; }
  }
  return false;
}
const mySpaces = () => Server.db.members
  .filter(m => m.userId === Server.session.userId)
  .map(m => spaceById(m.spaceId))
  .filter(s => s && s.nature !== 'silly')
  .sort((a, b) => b.createdAt - a.createdAt);
const contentOf = (spaceId, kind) => Server.db.content.filter(c => c.spaceId === spaceId && c.kind === kind);
const money = (n, asset = 'USDT') => (asset === 'BTC' ? n.toFixed(5) : n.toFixed(2)) + ' ' + asset;

function nameOf(userId) {
  if (userId === currentUser.id) return 'You';
  const p = mingConnectionProfiles.get(userId);
  return p?.short || p?.name || '';
}
function personOf(userId) {
  if (userId === currentUser.id) return currentUser;
  return mingConnectionProfiles.get(userId) || {
    id: userId,
    name: '',
    short: '',
    username: '',
    avatarUrl: '',
    bio: '',
    tag: '',
    interests: [],
    tags: [],
    activity: '',
    hue: 0,
    status: null,
    visitor: false
  };
}

/* ============================================================
   SCREEN MOUNTING  (stack screens, same system as the rest of Tweaklr)
============================================================ */
function mountScreen(html) {
  const wrap = document.createElement('div');
  wrap.innerHTML = html.trim();
  const el = wrap.firstElementChild;
  const app = document.getElementById('app');
  if (!app || !el) {
    console.error('Tweaklr: Could not mount a Spaces screen because the app container is unavailable.');
    return null;
  }

  /* Keep stack screens before the FAB when the FAB exists. If the FAB is
     temporarily unavailable, append safely instead of aborting the entire
     Spaces module. */
  const fab = document.getElementById('fab');
  if (fab && fab.parentNode === app) app.insertBefore(el, fab);
  else app.appendChild(el);

  return el;
}

mountScreen(`
<section class="screen screen--stack has-nav" id="screen-spaces" aria-label="Your Spaces">
  <header class="topbar">
    <div class="topbar-row">
      <button class="icon-btn back-btn" data-back aria-label="Back"><svg><use href="#i-back"/></svg></button>
      <div style="flex:1 1 auto"><div class="topbar-title">Spaces</div>
      <div class="topbar-sub">Your own worlds inside Tweaklr</div></div>
      <button class="icon-btn" data-sp="join" aria-label="Join with a code"><svg><use href="#i-sp-key"/></svg></button>
    </div>
  </header>
  <div class="scroll" data-scroll><div id="spaces-body"></div></div>
</section>`);

mountScreen(`
<section class="screen screen--stack" id="screen-createspace" aria-label="Create a Space">
  <header class="topbar">
    <div class="topbar-row">
      <button class="icon-btn back-btn" id="wz-close" aria-label="Close"><svg><use href="#i-x"/></svg></button>
      <div style="flex:1 1 auto"><div class="topbar-title" id="wz-title">Create a Space</div>
      <div class="topbar-sub" id="wz-sub"></div></div>
    </div>
    <div class="wz-progress" id="wz-progress"></div>
  </header>
  <div class="scroll" data-scroll><div id="wz-body"></div></div>
  <div class="wz-foot">
    <button class="btn btn--soft btn--back" id="wz-back" aria-label="Previous step"><svg><use href="#i-back"/></svg></button>
    <button class="btn btn--primary" id="wz-next">Continue</button>
  </div>
</section>`);

mountScreen(`
<section class="screen screen--stack sp" id="screen-space" aria-label="Space">
  <header class="sp-head" id="sp-head"></header>
  <div class="sp-scroll" data-scroll id="sp-scroll"><div id="sp-body"></div></div>
  <nav class="sp-tabs" id="sp-tabs" aria-label="Space sections"></nav>
</section>`);

mountScreen(`
<section class="screen screen--stack sp" id="screen-order" aria-label="Order">
  <header class="sp-head">
    <div class="sp-bar">
      <button class="back" data-back aria-label="Back"><svg><use href="#i-back"/></svg></button>
      <div class="ttl"><div class="n" id="ord-title">Order</div><div class="m" id="ord-sub"></div></div>
    </div>
  </header>
  <div class="sp-scroll" data-scroll style="padding-bottom:calc(var(--safe-b) + 24px)"><div id="ord-body"></div></div>
</section>`);

mountScreen(`
<section class="screen screen--stack wallet-shell" id="screen-wallet" aria-label="Tweaklr Wallet">
  <header class="topbar">
    <div class="topbar-row">
      <button class="icon-btn back-btn" data-back aria-label="Back"><svg><use href="#i-back"/></svg></button>
      <div style="flex:1 1 auto"><div class="topbar-title">Tweaklr Wallet</div>
      <div class="topbar-sub">Development mode</div></div>
    </div>
  </header>
  <div class="scroll" data-scroll><div id="wallet-body"></div></div>
</section>`);

/* scroll shadows for the new screens */
['#screen-spaces .scroll', '#screen-createspace .scroll', '#screen-wallet .scroll'].forEach(sel => {
  const el = document.querySelector(sel);
  if (!el) {
    console.warn('Tweaklr: Spaces screen scroll target was not available during mount:', sel);
    return;
  }
  el.addEventListener('scroll', () => {
    el.parentElement.querySelector('.topbar')?.classList.toggle('is-scrolled', el.scrollTop > 6);
  }, { passive: true });
});

/* ============================================================
   SPACES INDEX
============================================================ */
async function openSpaces() {
  /* Navigation must happen immediately; database loading must never block the screen transition. */
  const screen = document.getElementById('screen-spaces');
  if (!screen) {
    console.error('Tweaklr: Spaces screen is not mounted.');
    toast('Spaces could not be opened right now.', 'alert');
    return;
  }

  if (state.stack[state.stack.length - 1] !== 'spaces') {
    pushStack('spaces');
  }

  const body = $('#spaces-body');
  if (body && !body.innerHTML.trim()) {
    body.innerHTML = tweaklrLoadingMarkup('Bringing your Spaces together…');
  }

  await loadSpacesFromDatabase();

  try {
    renderSpaces();
  } catch (error) {
    console.error('Tweaklr: Spaces screen render failed:', error);
    toast('Spaces could not be loaded right now.', 'alert');
  }
}

function renderSpaces() {
  const body = $('#spaces-body');
  if (!body) return;

  /* A stale filter must never be able to break the entire Spaces screen. */
  if (sp.indexFilter !== 'all' && !NATURES[sp.indexFilter]) {
    sp.indexFilter = 'all';
  }

  renderHomeSpaces();
  const list = mySpaces();
  const filters = [['all', 'All'], ...Object.entries(NATURES).map(([k, n]) => [k, n.label])];
  const visible = sp.indexFilter === 'all' ? list : list.filter(s => s.nature === sp.indexFilter);
  const totalMembers = list.reduce((sum, s) => sum + Server.memberCount(s.id), 0);
  const liveSpaces = list.filter(s => contentOf(s.id, 'now').length > 0).length;
  const owned = list.filter(s => Server.roleOf(s.id) === 'owner').length;
  const selectedNature = sp.indexFilter !== 'all' ? NATURES[sp.indexFilter] : null;

  body.innerHTML = `
    <div class="spaces-hero spaces-hero--command">
      <div class="spaces-hero__eyebrow">${icon('sp-grid')} TWEAKLR SPACES <span class="spaces-live-pill"><i></i> YOUR WORLDS</span></div>
      <div class="spaces-command-copy">
        <div>
          <h1>${list.length ? 'A different room for every reason.' : 'Your worlds, with their own rules.'}</h1>
          <p>${list.length
            ? 'Private rooms for the people, projects and moments that matter. Each Space keeps its own identity, members and rules.'
            : 'Spaces are not just group chats. Build a room around work, friendship, the moment, play, love or trade.'}</p>
        </div>
        <div class="spaces-orbit" aria-hidden="true"><span></span><b>M</b></div>
      </div>
      <div class="spaces-metrics">
        <div><strong>${list.length}</strong><span>Spaces</span></div>
        <div><strong>${totalMembers}</strong><span>Members</span></div>
        <div><strong>${liveSpaces}</strong><span>Live now</span></div>
      </div>
      <div class="spaces-hero__actions">
        <button class="btn btn--primary" data-sp="create">${icon('plus')}Create a Space</button>
        <button class="btn btn--soft" data-sp="join">${icon('sp-key')}Join with code</button>
      </div>
    </div>

    <div class="spaces-quick-launch">
      <div class="spaces-quick-launch__head">
        <div><span class="eyebrow">Quick launch</span><h2>Start with an intention.</h2></div>
        <span class="spaces-owner-count">${owned} owned</span>
      </div>
      <div class="spaces-quick-grid">
        ${Object.entries(NATURES).map(([k, n]) => `
          <button class="space-quick-card ${selectedNature === n ? 'is-selected' : ''}" data-sp="create-type:${k}" style="--sp-swatch:${n.swatch}">
            <span class="space-quick-card__icon">${icon(n.icon)}</span>
            <span class="space-quick-card__copy"><strong>${esc(n.label)}</strong><small>${esc(n.signature)}</small></span>
            <span class="space-quick-card__go">${icon('chev')}</span>
          </button>`).join('')}
      </div>
    </div>

    <div class="space-intentions">
      <div class="space-intentions__head">
        <div><span class="eyebrow">Explore the system</span><h2>Give the Space a reason to exist.</h2></div>
      </div>
      <div class="space-nature-rail">
        ${Object.entries(NATURES).map(([k, n]) => `
          <button class="space-nature-card" data-sp="create-type:${k}" style="--sp-swatch:${n.swatch}" aria-label="Create a ${esc(n.label)} Space">
            <span class="space-nature-card__glow"></span>
            <span class="space-nature-card__icon">${icon(n.icon)}</span>
            <span class="space-nature-card__eyebrow">${esc(n.eyebrow)}</span>
            <strong>${esc(n.label)}</strong>
            <span class="space-nature-card__signature">${esc(n.signature)}</span>
            <span class="space-nature-card__copy">${esc(n.blurb)}</span>
            <span class="space-nature-card__cta">Explore this kind ${icon('chev')}</span>
          </button>`).join('')}
      </div>
    </div>

    <div class="space-filter-row">
      ${filters.map(([k,t]) => `<button class="chip ${sp.indexFilter === k ? 'is-on' : ''}" data-sp="filter:${k}">${esc(t)}</button>`).join('')}
    </div>

    ${visible.length ? `<div class="section spaces-owned-section">
      ${sectionHead(sp.indexFilter === 'all' ? 'Your Spaces' : NATURES[sp.indexFilter].label + ' Spaces', `${visible.length}`)}
      ${visible.map(spaceTile).join('')}
    </div>`
    : `<div class="spaces-empty-premium">${emptyState(
        sp.indexFilter === 'all' ? 'Your first Space is waiting.' : 'Nothing here yet.',
        sp.indexFilter === 'all' ? 'Pick a purpose above and create a room that feels made for it.' : 'Create one with this character and make it yours.',
        { t: 'Create this kind', a: 'create-type:' + sp.indexFilter }
      )}</div>`}

    <div class="spaces-footer-note">
      <span class="spaces-footer-note__mark">${icon('shield')}</span>
      <div><strong>Built around boundaries.</strong><span>Membership, invitations and Space rules are enforced by the backend.</span></div>
    </div>

    <div class="section spaces-wallet-section">${sectionHead('Tweaklr Wallet', 'Development mode')}
      <div class="menu-list">
        <button class="menu-item" data-sp="wallet">${icon('sp-wallet')}<span class="t">Balances and activity</span><span class="go">${icon('chev')}</span></button>
      </div>
    </div>`;
}
function spaceTile(s) {
  const n = NATURES[s.nature] || NATURES.friendly || { label: 'Space', signature: '', promise: '', swatch: '#8B3543', icon: 'sp-grid' };
  const members = Server.db.members.filter(m => m.spaceId === s.id).slice(0, 4).map(m => personOf(m.userId));
  const liveCount = contentOf(s.id, 'now').length;
  return `<button class="sp-tile sp-tile--premium" data-sp="open:${s.id}" style="--sp-swatch:${n.swatch}">
    <span class="sp-tile__cover" style="background:${coverFor(s)}">
      <span class="sp-tile__top">
        <span class="sp-tile__nature">${icon(n.icon)}${esc(n.label)}</span>
        <span class="sp-tile__arrow">${icon('chev')}</span>
      </span>
      <span class="sp-tile__signature">${esc(n.signature)}</span>
    </span>
    <span class="sp-tile__body">
      <span class="sp-tile__title-row">
        <span class="sp-tile__name">${esc(s.name)}</span>
        <span class="sp-tile__role">${esc(Server.roleOf(s.id) || 'guest')}</span>
      </span>
      <span class="sp-tile__description">${esc(s.description || n.promise)}</span>
      <span class="sp-tile__footer">
        <span class="stack-avs">${members.map(p => avatar(p, 26, { status: false })).join('')}</span>
        <span>${Server.memberCount(s.id)} ${Server.memberCount(s.id) === 1 ? 'member' : 'members'}${liveCount ? ' · ' + liveCount + ' live' : ''}</span>
      </span>
    </span>
  </button>`;
}

/* ============================================================
   CREATE WIZARD — progressive disclosure, 8 steps
============================================================ */
const WZ_STEPS = ['nature', 'identity', 'privacy', 'look', 'members', 'invite', 'features', 'review'];

function openWizard(nature = null) {
  sp.wizard = {
    i: 0, dir: 1,
    nature: nature && NATURES[nature] ? nature : null, name: '', description: '',
    privacy: 'private', requireApproval: false,
    hue: null, maxMembers: null,
    inviteTtlHours: 24, inviteMaxUses: null,
    locationLinked: false, ttlDays: null,
    features: {}, theme: null
  };
  if (nature === 'business') sp.wizard.maxMembers = 100;
  if (nature === 'friendly') sp.wizard.maxMembers = 50;
  if (nature === 'casual') { sp.wizard.maxMembers = 30; sp.wizard.ttlDays = 1; }
  if (nature === 'romantic') { sp.wizard.maxMembers = 2; sp.wizard.privacy = 'private'; sp.wizard.requireApproval = true; }
  if (nature === 'marketplace') sp.wizard.maxMembers = 100;
  renderWizard();
  pushStack('createspace');
}

function wzSet(patch, rerender = true) {
  Object.assign(sp.wizard, patch);
  if (rerender) renderWizard();
}

function renderWizard() {
  const w = sp.wizard;
  const step = WZ_STEPS[w.i];
  $('#wz-progress').innerHTML = WZ_STEPS.map((_, i) => `<i class="${i <= w.i ? 'on' : ''}"></i>`).join('');
  $('#wz-sub').textContent = `Step ${w.i + 1} of ${WZ_STEPS.length}`;
  $('#wz-back').style.visibility = w.i === 0 ? 'hidden' : 'visible';
  $('#wz-body').innerHTML = `<div class="wz-step ${w.dir < 0 ? 'back' : ''}">${WZ_RENDER[step](w)}</div>`;
  const next = $('#wz-next');
  next.textContent = step === 'review' ? 'Create Space' : 'Continue';
  next.disabled = !wzValid(step, w);
  $('#screen-createspace .scroll').scrollTop = 0;
}

function wzValid(step, w) {
  if (step === 'nature') return !!w.nature;
  if (step === 'identity') {
    const nameOk = w.name.trim().length >= 2;
    const descriptionRequired = ['business','marketplace'].includes(w.nature);
    const descriptionOk = !descriptionRequired || w.description.trim().length >= 8;
    return nameOk && descriptionOk;
  }
  if (step === 'members') {
    if (w.nature === 'romantic') return Number(w.maxMembers || 2) <= 2;
    if (w.nature === 'casual') return Number(w.ttlDays || 0) >= 1 && Number(w.ttlDays || 0) <= 30;
    return !w.maxMembers || Number(w.maxMembers) > 0;
  }
  return true;
}

const WZ_RENDER = {
  nature: w => `
    <h2>What are you creating?</h2>
    <p class="lede">This decides how the Space looks and what it can do. It cannot be changed later.</p>
    <div class="nature-grid">
      ${Object.entries(NATURES).map(([k, n]) => `
        <button class="nature-card" aria-pressed="${w.nature === k}" data-sp="wz-nature:${k}">
          <span class="swatch" style="background:${n.swatch}"></span>
          <span class="tick">${icon('check')}</span>
          <span class="t">${n.label}</span>
          <span class="s">${esc(n.blurb)}</span>
        </button>`).join('')}
    </div>`,

  identity: w => `
    <h2>Name your Space</h2>
    <p class="lede">Members see this everywhere. Short names work best.</p>
    <div class="field"><label for="wz-name">Name</label>
      <input id="wz-name" type="text" maxlength="40" value="${esc(w.name)}" placeholder="Give your Space a name" /></div>
    <div class="field"><label for="wz-desc">What is it for?</label>
      <textarea id="wz-desc" maxlength="160" placeholder="One line so people know what they are joining.">${esc(w.description)}</textarea></div>`,

  privacy: w => `
    <h2>Who can find it?</h2>
    <p class="lede">Privacy is set here and enforced on the server, not by hiding buttons.</p>
    ${[
      ['private', 'Invitation only', 'Nobody can find this Space. The only way in is a code you share.'],
      ['approval', 'Invitation, with approval', 'People with a code request to join. You let them in.'],
      ['discoverable', 'Discoverable nearby', 'Appears in Discover for people in your area. Joining still needs a code.']
    ].map(([k, t, s]) => `
      <button class="choice" aria-pressed="${w.privacy === k}" data-sp="wz-privacy:${k}">
        <span class="radio"></span>
        <span class="tx"><span class="t" style="display:block">${t}</span><span class="s" style="display:block">${s}</span></span>
      </button>`).join('')}
    ${w.nature === 'romantic' ? `<div class="ephemeral-note" style="margin-top:14px">${icon('lock')}<span>Romantic Spaces are always invitation only and never appear in Discover, whatever else you pick.</span></div>` : ''}`,

  look: w => `
    <h2>Set the atmosphere</h2>
    <p class="lede">A ${NATURES[w.nature].label} Space already has its own environment. Pick the cover that fits yours.</p>
    <div class="nature-grid" style="grid-template-columns:1fr 1fr 1fr">
      ${(NATURES[w.nature].palettes || []).map(p => `
        <button class="nature-card" style="min-height:76px;padding:0;overflow:hidden;position:relative" aria-pressed="${w.theme && w.theme.name === p.name}" data-sp="wz-theme:${esc(p.name)}">
          <span class="swatch" style="margin:0;height:100%;border:0;background:linear-gradient(140deg,${p.colors[0]},${p.colors[1]} 58%,${p.colors[2]})"></span>
          <span class="t" style="position:absolute;left:10px;bottom:8px;color:white;font-weight:700;text-shadow:0 1px 6px rgba(0,0,0,.5)">${esc(p.name)}</span>
          <span class="tick">${icon('check')}</span>
        </button>`).join('')}
    </div>
    <p class="lede" style="margin-top:14px">Every Space nature has its own three-color family. Other Space types cannot use these palettes.</p>`,

  members: w => `
    <h2>Who is in it?</h2>
    <p class="lede">Roles for a ${NATURES[w.nature].label} Space: ${Server.ROLE_SETS[w.nature].join(', ')}. You will be the owner.</p>
    <button class="toggle-row" aria-pressed="${w.requireApproval}" data-sp="wz-toggle:requireApproval">
      <span class="tx"><span class="t" style="display:block">Approve each person</span>
      <span class="s" style="display:block">A valid code puts them in a queue, not in the room</span></span>
      <span class="sw"></span>
    </button>
    <div class="field"><label for="wz-max">Member limit</label>
      <input id="wz-max" type="text" inputmode="numeric" value="${w.maxMembers || ''}" placeholder="No limit" /></div>
    ${w.nature === 'casual' ? `
      <div class="field"><label for="wz-ttl">Close the Space automatically</label>
        <input id="wz-ttl" type="text" inputmode="numeric" value="${w.ttlDays || ''}" placeholder="Days — leave empty to keep it open" /></div>` : ''}
    ${(w.nature === 'casual' || w.nature === 'marketplace') ? `
      <button class="toggle-row" aria-pressed="${w.locationLinked}" data-sp="wz-toggle:locationLinked">
        <span class="tx"><span class="t" style="display:block">Use my area</span>
        <span class="s" style="display:block">Shows distances inside the Space. Your coordinates stay on your device</span></span>
        <span class="sw"></span>
      </button>` : ''}`,

  invite: w => `
    <h2>How people get in</h2>
    <p class="lede">Your code is generated and stored hashed on the server. Regenerating one kills the old one instantly.</p>
    <div class="field"><label>Code expires after</label>
      <div class="pick">${[[6, '6 hours'], [24, '24 hours'], [168, '7 days'], [0, 'Never']].map(([h, t]) => `
        <button type="button" aria-pressed="${w.inviteTtlHours === h}" data-sp="wz-ttlh:${h}">${t}</button>`).join('')}</div></div>
    <div class="field"><label>Maximum uses</label>
      <div class="pick">${[[1, 'One person'], [10, '10'], [50, '50'], [0, 'Unlimited']].map(([n, t]) => `
        <button type="button" aria-pressed="${(w.inviteMaxUses || 0) === n}" data-sp="wz-maxuses:${n}">${t}</button>`).join('')}</div></div>
    <div class="ephemeral-note">${icon('shield')}<span>Tweaklr stores a hash of the code, never the code itself. You will see the plaintext once, when it is issued.</span></div>`,

  features: w => {
    const opts = FEATURE_OPTIONS[w.nature];
    return `
    <h2>What lives here?</h2>
    <p class="lede">Turn off what you do not need. You can change these later in Space settings.</p>
    ${opts.map(f => `
      <button class="toggle-row" aria-pressed="${w.features[f.k] !== false}" data-sp="wz-feature:${f.k}">
        <span class="tx"><span class="t" style="display:block">${f.t}</span><span class="s" style="display:block">${f.s}</span></span>
        <span class="sw"></span>
      </button>`).join('')}
    ${w.nature === 'marketplace' ? `<div class="ephemeral-note" style="margin-top:16px">${icon('shield')}<span>Payments in this Space are held in escrow until the buyer confirms delivery. Tweaklr Wallet is in development mode — no real funds move.</span></div>` : ''}`;
  },

  review: w => `
    <h2>Ready?</h2>
    <p class="lede">One last look before this Space exists.</p>
    <div style="margin-top:18px">
      ${[
        ['Nature', NATURES[w.nature].label],
        ['Color', w.theme?.name || 'Nature default'],
        ['Name', w.name],
        ['Purpose', w.description || '—'],
        ['Privacy', { private: 'Invitation only', approval: 'Invitation, with approval', discoverable: 'Discoverable nearby' }[w.privacy]],
        ['Approval', w.requireApproval ? 'Each person approved' : 'Anyone with the code'],
        ['Member limit', w.maxMembers ? w.maxMembers + ' people' : 'No limit'],
        ['Code expires', w.inviteTtlHours ? w.inviteTtlHours + ' hours' : 'Never'],
        ['Code uses', w.inviteMaxUses ? w.inviteMaxUses : 'Unlimited'],
        ['Your role', 'Owner']
      ].map(([k, v]) => `<div class="review-row"><span class="k">${k}</span><span class="v">${esc(String(v))}</span></div>`).join('')}
    </div>`
};

const FEATURE_OPTIONS = {
  business: [
    { k: 'announcements', t: 'Announcements', s: 'Pinned notices from admins' },
    { k: 'tasks', t: 'Tasks', s: 'Work items with an owner and a date' },
    { k: 'documents', t: 'Documents', s: 'Shared files and links' },
    { k: 'opportunities', t: 'Opportunities', s: 'Roles and briefs open to members' },
    { k: 'audit', t: 'Activity log', s: 'Who did what, kept permanently' }
  ],
  friendly: [
    { k: 'moments', t: 'Moments', s: 'Photos and small things worth sharing' },
    { k: 'polls', t: 'Polls', s: 'Settle an argument in ten seconds' },
    { k: 'events', t: 'Events', s: 'Plans with a time and a place' },
    { k: 'memories', t: 'Memories', s: 'Moments you choose to keep' }
  ],
  casual: [
    { k: 'now', t: 'Happening now', s: 'Posts that clear themselves' },
    { k: 'nearby', t: 'Nearby members', s: 'Who is close, by distance only' },
    { k: 'polls', t: 'Quick polls', s: 'Where are we going?' },
    { k: 'meet', t: 'Meeting point', s: 'Shared only with people who join' }
  ],
  silly: [
    { k: 'prompts', t: 'Daily prompt', s: 'A stupid question every morning' },
    { k: 'stickers', t: 'Sticker wall', s: 'React with nonsense' },
    { k: 'game', t: 'Mini-game', s: 'A scoreboard nobody asked for' }
  ],
  romantic: [
    { k: 'memories', t: 'Memories', s: 'A private timeline' },
    { k: 'plans', t: 'Plans', s: 'Dates and small ideas' },
    { k: 'lists', t: 'Shared lists', s: 'Places, films, someday things' },
    { k: 'milestones', t: 'Milestones', s: 'Dates that matter' },
    { k: 'loveletter', t: 'Love letters', s: 'A private letter for your person' }
  ],
  marketplace: [
    { k: 'listings', t: 'Listings', s: 'Members can list items for sale' },
    { k: 'escrow', t: 'Escrow', s: 'Funds held until delivery is confirmed' },
    { k: 'disputes', t: 'Dispute centre', s: 'Evidence-based resolution' },
    { k: 'pickup', t: 'Pickup', s: 'Hand over in person as well as ship' }
  ]
};

$('#wz-close').addEventListener('click', () => popStack());
$('#wz-back').addEventListener('click', () => {
  const w = sp.wizard;
  captureWizardInputs();
  if (w.i > 0) { w.i--; w.dir = -1; renderWizard(); }
});
$('#wz-next').addEventListener('click', async () => {
  const w = sp.wizard;
  captureWizardInputs();
  if (WZ_STEPS[w.i] !== 'review') {
    if (!wzValid(WZ_STEPS[w.i], w)) return;
    w.i++; w.dir = 1; renderWizard();
    return;
  }
  const res = await Server.submit('space.create', {
    name: w.name, description: w.description, nature: w.nature,
    privacy: w.nature === 'romantic' ? 'private' : w.privacy,
    requireApproval: w.privacy === 'approval' || w.requireApproval,
    maxMembers: w.maxMembers, hue: w.hue, locationLinked: w.locationLinked,
    ttlDays: w.ttlDays, theme: w.theme, features: w.features,
    inviteTtlHours: w.inviteTtlHours || null, inviteMaxUses: w.inviteMaxUses || null
  });
  if (!res.ok) { toast(res.error, 'x'); return; }
  sp.shownCodes[res.data.space.id] = res.data.code;
  /* Space content starts empty; nothing is fabricated after creation. */
  popStack();
  renderSpaces();
  toast('Space created', 'check');
  setTimeout(() => { openSpace(res.data.space.id); setTimeout(() => openInviteSheet(res.data.space.id, true), 420); }, 260);
});

function captureWizardInputs() {
  const w = sp.wizard;
  const name = $('#wz-name'); if (name) w.name = name.value;
  const desc = $('#wz-desc'); if (desc) w.description = desc.value;
  const max = $('#wz-max'); if (max) w.maxMembers = parseInt(max.value, 10) || null;
  const ttl = $('#wz-ttl'); if (ttl) w.ttlDays = parseInt(ttl.value, 10) || null;
}
$('#wz-body').addEventListener('input', e => {
  if (e.target.id === 'wz-name') $('#wz-next').disabled = e.target.value.trim().length < 2;
});

/* ============================================================
   INVITATIONS
============================================================ */
function openInviteSheet(spaceId, fresh = false) {
  const s = spaceById(spaceId);
  const inv = Server.db.invites.find(i => i.spaceId === spaceId && !i.revoked);
  const code = sp.shownCodes[spaceId];
  const owner = Server.can(spaceId, 'space.invite.rotate');
  const codeVisible = sp.codeVisibility[spaceId] !== false;
  openSheet({
    title: fresh ? 'Your Space is live' : 'Invitation',
    sub: `${s.name} · ${NATURES[s.nature].label} · ${Server.memberCount(spaceId)} ${Server.memberCount(spaceId) === 1 ? 'member' : 'members'}`,
    body: `
      <div class="code-card">
        <div class="lbl">Invitation code</div>
        <div class="code-row">
          <div class="code">${code ? (codeVisible ? esc(code) : '••••-••••') : '···· ····'}</div>
          ${code ? `<button class="code-visibility" type="button" data-sp="toggle-code:${spaceId}" aria-label="${codeVisible ? 'Hide invitation code' : 'Show invitation code'}" title="${codeVisible ? 'Hide code' : 'Show code'}">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              ${codeVisible
                ? '<path d="M2.2 12s3.5-6 9.8-6 9.8 6 9.8 6-3.5 6-9.8 6-9.8-6-9.8-6Z"/><circle cx="12" cy="12" r="2.6"/>'
                : '<path d="m3 3 18 18"/><path d="M6.7 6.8C3.9 8.3 2.2 12 2.2 12s3.5 6 9.8 6c1.7 0 3.2-.4 4.5-1"/><path d="M10.1 6.2A10 10 0 0 1 12 6c6.3 0 9.8 6 9.8 6s-.9 1.5-2.5 2.9"/><path d="M9.7 9.7a3 3 0 0 0 4.6 4.6"/>'}
            </svg>
          </button>` : ''}
        </div>
        <div class="meta">${code ? '' : 'Only shown once at issue. Regenerate to get a new one.<br>'}
          ${inv ? `${inv.expiresAt ? 'Expires ' + new Date(inv.expiresAt).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : 'No expiry'} ·
          ${inv.maxUses ? `${inv.uses}/${inv.maxUses} uses` : `${inv.uses} uses`} · version ${inv.version}` : 'No active code'}</div>
      </div>
      <div style="display:flex;gap:9px;margin-top:14px">
        <button class="btn btn--soft btn--sm" style="flex:1" data-sp="copy-code:${spaceId}" ${code ? '' : 'disabled'}>${icon('sp-copy')}Copy</button>
        <button class="btn btn--soft btn--sm" style="flex:1" data-sp="share-code:${spaceId}" ${code ? '' : 'disabled'}>${icon('send')}Share</button>
        ${owner ? `<button class="btn btn--soft btn--sm" style="flex:1" data-sp="rotate-code:${spaceId}">${icon('sp-refresh')}New code</button>` : ''}
      </div>
      <div class="ephemeral-note" style="margin-top:16px">${icon('shield')}<span>Tweaklr keeps only a hash of this code. Regenerating revokes the current one immediately — anyone still holding it is locked out.</span></div>`,
    foot: `<button class="btn btn--primary btn--block" data-action="close-sheet">Done</button>`
  });
}

function openJoinSheet() {
  openSheet({
    title: 'Join a Space',
    sub: 'Enter the code someone sent you.',
    body: `<div class="field"><label for="join-code">Invitation code</label>
      <input id="join-code" type="text" placeholder="M7K9-XP42" autocapitalize="characters" spellcheck="false"
        style="text-transform:uppercase;letter-spacing:.1em;font-size:18px" /></div>
      <div class="ephemeral-note">${icon('lock')}<span>Codes are checked on the server. Wrong or revoked codes tell you nothing about the Space.</span></div>`,
    foot: `<button class="btn btn--primary btn--block" data-sp="join-submit">Join</button>`
  });
  setTimeout(() => $('#join-code').focus(), 260);
}

/* ============================================================
   SPACE SHELL
============================================================ */
function openSpace(id, tab) {
  const s = spaceById(id);
  if (!s) return;
  if (s.nature === 'silly') { toast('Silly Spaces are no longer available.'); return; }
  sp.activeId = id;
  sp.tab = tab || NATURES[s.nature].tabs[0][0];
  const screen = $('#screen-space');
  screen.dataset.nature = s.nature;
  screen.dataset.spaceId = s.id;
  const theme = spaceTheme(s);
  screen.style.setProperty('--sp-accent', theme.colors[0]);
  screen.style.setProperty('--sp-accent-2', theme.colors[1]);
  screen.style.setProperty('--sp-accent-3', theme.colors[2]);
  screen.style.setProperty('--sp-theme-name', JSON.stringify(theme.name || 'Tweaklr'));
  renderSpace();
  pushStack('space');
  if (s.nature === 'business' && sp.tab === 'brief') void refreshOpenRoles(s.id);
}

function renderSpace() {
  const s = spaceById(sp.activeId);
  const n = NATURES[s.nature];
  $('#sp-head').innerHTML = HEADERS[s.nature](s);
  $('#sp-tabs').innerHTML = n.tabs.map(([k, label, ic]) => `
    <button class="${sp.tab === k ? 'on' : ''}" data-sp="tab:${k}" aria-current="${sp.tab === k}">
      ${icon(ic)}<span>${label}</span></button>`).join('');
  $('#sp-body').innerHTML = VIEWS[s.nature][sp.tab](s);
  $('#sp-scroll').scrollTop = 0;
}
function refreshSpace() {
  const s = spaceById(sp.activeId);
  $('#sp-body').innerHTML = VIEWS[s.nature][sp.tab](s);
}

function spBar(s, opts = {}) {
  return `<div class="sp-bar">
    <button class="back" data-back aria-label="Leave Space">${icon('back')}</button>
    <div class="ttl"><div class="n">${esc(s.name)}</div>
      <div class="m">${opts.meta || `${NATURES[s.nature].label} · ${Server.memberCount(s.id)} members`}</div></div>
    <button class="ic" data-sp="invite:${s.id}" aria-label="Invitation">${icon('sp-key')}</button>
    <button class="ic" data-sp="settings:${s.id}" aria-label="Space settings">${icon('settings')}</button>
  </div>`;
}

const HEADERS = {
  business: s => spBar(s) + `
    <div class="biz-metrics">
      <div><div class="v">${contentOf(s.id, 'task').filter(t => !t.done).length}</div><div class="k">Open tasks</div></div>
      <div><div class="v">${Server.memberCount(s.id)}</div><div class="k">Members</div></div>
      <div><div class="v">${Server.db.openRoles.filter(r => r.spaceId === s.id && r.status === 'open').length + contentOf(s.id, 'opportunity').length}</div><div class="k">Open roles</div></div>
    </div>`,

  friendly: s => `<div class="sp-cover" style="background:${coverFor(s)}">${spBar(s)}</div>`,

  casual: s => spBar(s, { meta: `${NATURES[s.nature].label}${s.expiresAt ? ' · closes ' + new Date(s.expiresAt).toLocaleDateString([], { day: 'numeric', month: 'short' }) : ''}` }) +
    `<div class="live-bar"><span class="live-dot"></span> ${contentOf(s.id, 'now').length} things happening${s.locationLinked && hasLocation() ? ` · ${esc(areaLabel())}` : ''}</div>`,

  silly: s => spBar(s, { meta: `Silly · ${Server.memberCount(s.id)} members` }),

  romantic: s => spBar(s, { meta: 'Private' }) + `
    <div class="rom-hero">
      <h2>${esc(s.name)}</h2>
      <p>${esc(s.description || 'Just the two of you.')}</p>
    </div>`,

  marketplace: s => spBar(s, { meta: `Marketplace · ${Server.db.products.filter(p => p.spaceId === s.id && p.status === 'listed').length} listings` })
};

function spaceTheme(s) {
  const fallback = NATURES[s.nature]?.palettes?.[0] || { name: 'Tweaklr', colors: ['#14171D','#2A313A','#C5A572'] };
  const raw = s?.theme || s?.features?.theme;
  return raw && Array.isArray(raw.colors) && raw.colors.length === 3 ? raw : fallback;
}
function coverFor(s) {
  const theme = spaceTheme(s);
  return `linear-gradient(140deg, ${theme.colors[0]}, ${theme.colors[1]} 58%, ${theme.colors[2]})`;
}

/* ============================================================
   BUSINESS
============================================================ */
const VIEWS = { business: {}, friendly: {}, casual: {}, silly: {}, romantic: {}, marketplace: {} };

VIEWS.business.files = s => {
  const files = Server.db.files.filter(f => f.spaceId === s.id && !f.contentId && !f.productId);
  const docs = contentOf(s.id, 'doc'), role = Server.roleOf(s.id);
  const canManage = ['owner','admin','manager'].includes(role);
  const fileRows = files.map(f => {
    const title = f.displayName || f.filename || 'Document', type = f.contentType || 'application/octet-stream';
    const size = Number(f.sizeBytes || 0), sizeLabel = size >= 1048576 ? (size/1048576).toFixed(1)+' MB' : Math.max(1,Math.round(size/1024))+' KB';
    const category = f.category || 'General', date = f.createdAt ? new Date(f.createdAt).toLocaleDateString([], {day:'numeric',month:'short',year:'numeric'}) : 'Date unavailable';
    return '<article class="sp-card sp-doc-card" data-doc-card data-doc-name="' + esc((title+' '+type+' '+category).toLowerCase()) + '" data-doc-category="' + esc(category) + '">' +
      '<button type="button" class="sp-doc-open" data-sp="file-open:' + f.id + '" aria-label="Open ' + esc(title) + '"><span class="sp-doc-icon">' + icon(type.startsWith('image/')?'sp-camera':type.startsWith('video/')?'sp-bolt':'sp-doc') + '</span><span class="sp-doc-copy"><b>' + esc(title) + '</b><small>' + esc(category) + ' · ' + esc(type) + '</small><small>' + esc(sizeLabel) + ' · ' + esc(date) + '</small><small>Shared by ' + esc(nameOf(f.ownerId)) + '</small></span><span class="sp-doc-openmark">' + icon('chev') + '</span></button><div class="sp-doc-actions"><button type="button" class="btn btn--soft btn--sm" data-sp="file-open:' + f.id + '">Open</button><button type="button" class="btn btn--soft btn--sm" data-sp="file-download:' + f.id + '">Download</button>' +
      ((canManage || f.ownerId === currentUser.id) ? '<button type="button" class="btn btn--soft btn--sm" data-sp="doc-rename:' + f.id + '">Rename</button><button type="button" class="btn btn--soft btn--sm" data-sp="doc-category:' + f.id + '">Category</button>' : '') +
      (f.ownerId === currentUser.id ? '<button type="button" class="btn btn--ghost btn--sm sp-doc-delete" data-sp="doc-delete:' + f.id + '">Delete</button>' : '') + '</div></article>';
  }).join('');
  return '<div class="sp-documents"><section class="sp-doc-hero"><div class="sp-doc-hero-mark">' + icon('sp-doc') + '</div><div class="sp-doc-hero-copy"><span class="sp-doc-eyebrow">BUSINESS SPACE · LIBRARY</span><h2>Documents</h2><p>One polished home for your team’s shared files, references and working documents.</p><div class="sp-doc-statline"><span>' + files.length + ' file' + (files.length===1?'':'s') + '</span><span>Private to this Space</span></div></div><button type="button" class="btn btn--primary sp-doc-upload" data-sp="doc-upload">＋ Add document</button></section>' +
    '<section class="sp-doc-toolbar"><label class="sp-doc-search"><span aria-hidden="true">⌕</span><input id="docs-search" type="search" placeholder="Search by name, type or category…" aria-label="Search documents"></label><label class="sp-doc-filter"><span>Category</span><select id="docs-category" aria-label="Filter documents by category"><option value="">All categories</option><option>General</option><option>Contracts</option><option>Finance</option><option>Design</option><option>Reports</option><option>Policies</option><option>Other</option></select></label></section>' +
    '<section class="sp-doc-library"><div class="sp-doc-section-head"><div><span class="sp-doc-eyebrow">YOUR WORKSPACE</span><h3>Shared files</h3></div><span class="sp-doc-count">' + files.length + ' items</span></div>' +
    (files.length ? '<div class="sp-doc-grid" id="docs-grid">' + fileRows + '</div><div class="sp-doc-no-results" id="docs-no-results" hidden>No documents match your search. Try another name or category.</div>' : '<div class="sp-doc-empty"><div class="sp-doc-empty-icon">' + icon('sp-doc') + '</div><h3>Your document library starts here</h3><p>Upload a proposal, contract, report, spreadsheet or image. Files are stored in your private Tweaklr Space.</p><button type="button" class="btn btn--primary" data-sp="doc-upload">Upload your first document</button></div>') +
    '</section>' + (docs.length ? '<section class="sp-doc-notes"><div class="sp-doc-section-head"><div><span class="sp-doc-eyebrow">SPACE NOTES</span><h3>Document notes</h3></div><span class="sp-doc-count">' + docs.length + ' notes</span></div><div class="sp-doc-note-grid">' + docs.map(d=>'<article class="sp-card sp-doc-note"><span class="sp-doc-note-label">NOTE</span><b>'+esc(d.title||'Document note')+'</b><p>'+esc(d.body||'Saved in this Space.')+'</p></article>').join('')+'</div></section>' : '') +
    '<p class="sp-doc-footnote">' + icon('lock') + ' Files are only available to approved members of this Space. Supported previews open in a new tab; other files can be downloaded from there.</p></div>';
};

VIEWS.friendly.meetings = s => {
  const meetings = contentOf(s.id, 'meeting');
  const polls = contentOf(s.id, 'poll');
  return '<div class="sp-sec"><h3>Meetings <span><button data-sp="new:meeting">Host</button></span></h3>' +
    (meetings.length ? meetings.map(m => '<div class="sp-card"><b>' + esc(m.title) + '</b><div style="font-size:12px;color:var(--muted);margin-top:5px">' + esc(m.when || '') + '</div><p style="font-size:13px;line-height:1.5;margin-top:8px">' + esc(m.agenda || '') + '</p><div style="margin-top:10px"><button class="btn btn--soft btn--sm" data-sp="new:poll">Add a poll</button></div></div>').join('') : spEmpty('No meetings yet.', {t:'Host a meeting',a:'new:meeting'})) +
    '</div><div class="sp-sec"><h3>Room decisions</h3>' +
    (polls.length ? polls.map(pollCard).join('') : spEmpty('No polls yet.', {t:'Create a poll',a:'new:poll'})) +
    '</div>';
};

VIEWS.romantic.names = s => {
  const names = contentOf(s.id, 'nickname');
  return '<div class="privacy-seal">' + icon('lock') + '<span>Sweet names are private to this Space.</span></div>' +
    '<div class="sp-sec"><h3>Your names <span><button data-sp="new:nickname">Add</button></span></h3>' +
    (names.length ? names.map(n => '<div class="sp-card"><b>' + esc(n.name) + '</b><div style="font-size:12px;color:var(--muted);margin-top:5px">chosen by ' + esc(nameOf(n.authorId)) + '</div></div>').join('') : spEmpty('Give each other a name that belongs here.', {t:'Choose a sweet name',a:'new:nickname'})) +
    '</div>';
};

VIEWS.romantic.calendar = s => {
  const milestones = contentOf(s.id, 'milestone');
  const plans = contentOf(s.id, 'plan');
  const all = milestones.concat(plans).sort((a,b) => String(a.when || '').localeCompare(String(b.when || '')));
  return '<div class="privacy-seal">' + icon('lock') + '<span>Your shared calendar lives only inside this Space.</span></div>' +
    '<div class="sp-sec"><h3>Dates & plans <span><button data-sp="new:milestone">Pin date</button></span></h3>' +
    (all.length ? all.map(x => '<div class="sp-card"><b>' + esc(x.title || 'Plan') + '</b><div style="font-size:12px;color:var(--muted);margin-top:5px">' + esc(x.when || '') + (x.where ? ' · ' + esc(x.where) : '') + '</div></div>').join('') : spEmpty('Nothing pinned yet.', {t:'Pin a special date',a:'new:milestone'})) +
    '</div>';
};

VIEWS.romantic.health = s => {
  const entries = contentOf(s.id, 'health');
  return '<div class="privacy-seal">' + icon('lock') + '<span>Private wellness tracking. It is visible only to members of this Space and is not used for public discovery.</span></div>' +
    '<div class="sp-sec"><h3>Wellness log <span><button data-sp="new:health">Add</button></span></h3>' +
    (entries.length ? entries.map(h => '<div class="sp-card"><div style="display:flex;justify-content:space-between;gap:10px"><b>' + esc(h.metric) + '</b><span>' + esc(h.value) + '</span></div><div style="font-size:11.5px;color:var(--muted);margin-top:5px">' + esc(h.when || '') + '</div></div>').join('') : spEmpty('No private wellness entries yet.', {t:'Add an entry',a:'new:health'})) +
    '</div>';
};

VIEWS.romantic.vault = s => {
  const files = Server.db.files.filter(f => f.spaceId === s.id);
  return '<div class="privacy-seal">' + icon('lock') + '<span>A private vault for sensitive memories, plans and files. Keep personal information here only if both people agree.</span></div>' +
    '<div class="sp-sec"><h3>Private files <span><button data-sp="new:file">Add</button></span></h3>' +
    (files.length ? files.map(f => '<button class="sp-card" style="display:flex;gap:10px;align-items:center;width:100%;text-align:left" data-sp="file-open:' + f.id + '">' + icon('sp-doc') + '<span style="flex:1"><b>' + esc(f.filename) + '</b><small style="display:block;color:var(--muted);margin-top:3px">' + esc(f.contentType) + '</small></span>' + icon('chev') + '</button>').join('') : spEmpty('Your private vault is empty.', {t:'Save something',a:'new:file'})) +
    '</div>';
};


/* ------------------------------------------------------------
   BUSINESS OPEN ROLES — separate persisted workflow.
   All writes go through guarded Supabase RPCs; this UI never
   treats a local toast as a submitted application.
------------------------------------------------------------ */
function openRoleDateValue(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}
function openRoleDateLabel(value) {
  if (!value) return 'No deadline';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString([], { day:'numeric', month:'short', year:'numeric' });
}
async function refreshOpenRoles(spaceId) {
  if (!spaceId || !supabaseClient) return false;
  try {
    const { data, error } = await supabaseClient.rpc('get_ming_space_open_roles', { p_space_id: spaceId });
    if (error) {
      console.warn('Tweaklr: Open Roles could not be loaded.', error.message);
      return false;
    }
    const mapped = (data || []).map(r => ({
      id:r.id, spaceId:r.space_id, createdBy:r.created_by, title:r.title,
      employmentType:r.employment_type, workMode:r.work_mode, location:r.location || '',
      department:r.department || '', description:r.description || '',
      responsibilities:Array.isArray(r.responsibilities) ? r.responsibilities : [],
      requiredSkills:Array.isArray(r.required_skills) ? r.required_skills : [],
      compensation:r.compensation || '', applicationDeadline:r.application_deadline || null,
      status:r.status, createdAt:r.created_at, updatedAt:r.updated_at,
      applicationCount:Number(r.application_count || 0), myApplicationStatus:r.my_application_status || ''
    }));
    Server.db.openRoles = Server.db.openRoles.filter(r => r.spaceId !== spaceId).concat(mapped);
    if (sp.activeId === spaceId && spaceById(spaceId)?.nature === 'business' && sp.tab === 'brief') {
      const body = $('#sp-body');
      if (body) body.innerHTML = VIEWS.business.brief(spaceById(spaceId));
      const head = $('#sp-head');
      if (head) head.innerHTML = HEADERS.business(spaceById(spaceId));
    }
    return true;
  } catch (error) {
    console.warn('Tweaklr: Open Roles load request failed.', error);
    return false;
  }
}
function openRoleComposer(roleId = null) {
  const space = spaceById(sp.activeId);
  if (!space || space.nature !== 'business' || !Server.can(space.id, 'space.post.pin')) {
    toast('Only an owner, admin, or manager can manage Open Roles.', 'x');
    return;
  }
  const role = roleId ? Server.db.openRoles.find(r => r.id === roleId && r.spaceId === space.id) : null;
  if (roleId && !role) { toast('This role is no longer available. Refresh and try again.', 'x'); return; }
  openSheet({
    title: role ? 'Edit open role' : 'Create an open role',
    sub: 'Publish a clear opportunity and tell applicants what you need.',
    body: `
      <div class="field"><label for="or-title">Role title</label><input id="or-title" maxlength="100" value="${esc(role?.title || '')}" placeholder="e.g. Junior Security Analyst" /></div>
      <div class="field"><label for="or-type">Employment type</label><select id="or-type">
        ${[['full-time','Full-time'],['part-time','Part-time'],['contract','Contract'],['internship','Internship'],['temporary','Temporary'],['volunteer','Volunteer']].map(([v,l])=>`<option value="${v}" ${(role?.employmentType || 'full-time')===v?'selected':''}>${l}</option>`).join('')}
      </select></div>
      <div class="field"><label for="or-mode">Work arrangement</label><select id="or-mode">
        ${[['remote','Remote'],['hybrid','Hybrid'],['on-site','On-site']].map(([v,l])=>`<option value="${v}" ${(role?.workMode || 'remote')===v?'selected':''}>${l}</option>`).join('')}
      </select></div>
      <div class="field"><label for="or-location">Location (optional)</label><input id="or-location" maxlength="120" value="${esc(role?.location || '')}" placeholder="e.g. Abuja, Nigeria or Worldwide" /></div>
      <div class="field"><label for="or-department">Team / department (optional)</label><input id="or-department" maxlength="100" value="${esc(role?.department || '')}" placeholder="e.g. Application Security" /></div>
      <div class="field"><label for="or-description">Role description</label><textarea id="or-description" maxlength="4000" rows="5" placeholder="Explain the opportunity and what the person will do.">${esc(role?.description || '')}</textarea></div>
      <div class="field"><label for="or-responsibilities">Responsibilities (one per line)</label><textarea id="or-responsibilities" maxlength="2000" rows="3" placeholder="Assess web applications&#10;Write clear findings">${esc((role?.responsibilities || []).join('\n'))}</textarea></div>
      <div class="field"><label for="or-skills">Required skills (separate with commas or new lines)</label><textarea id="or-skills" maxlength="1200" rows="3" placeholder="Web security, Burp Suite, communication">${esc((role?.requiredSkills || []).join(', '))}</textarea></div>
      <div class="field"><label for="or-compensation">Compensation / benefits (optional)</label><input id="or-compensation" maxlength="160" value="${esc(role?.compensation || '')}" placeholder="e.g. Paid internship / Salary discussed" /></div>
      <div class="field"><label for="or-deadline">Application deadline (optional)</label><input id="or-deadline" type="datetime-local" value="${openRoleDateValue(role?.applicationDeadline)}" /></div>
      ${role ? `<div class="field"><label for="or-status">Listing status</label><select id="or-status"><option value="open" ${role.status==='open'?'selected':''}>Open — accepting applications</option><option value="closed" ${role.status==='closed'?'selected':''}>Closed</option></select></div>` : ''}
    `,
    foot: `<button class="btn btn--primary btn--block" data-sp="role-save:${role?.id || 'new'}">${role ? 'Save changes' : 'Publish role'}</button>`
  });
}
function openRoleApplicationSheet(role) {
  if (!role || role.status !== 'open') { toast('This role is closed.', 'x'); return; }
  if (role.myApplicationStatus) { toast('You have already applied. Your status is ' + role.myApplicationStatus + '.', 'check'); return; }
  openSheet({
    title: 'Apply · ' + role.title,
    sub: 'Your application goes to the Business Space hiring team.',
    body: `
      <div class="field"><label for="oa-intro">Short introduction</label><textarea id="oa-intro" maxlength="600" rows="3" placeholder="Introduce yourself and explain why this role interests you."></textarea></div>
      <div class="field"><label for="oa-experience">Relevant skills and experience</label><textarea id="oa-experience" maxlength="2000" rows="4" placeholder="Share relevant experience, projects, skills, or training."></textarea></div>
      <div class="field"><label for="oa-portfolio">CV or portfolio link (optional)</label><input id="oa-portfolio" type="url" maxlength="500" placeholder="https://..." /></div>
      <div class="field"><label for="oa-message">Application message</label><textarea id="oa-message" maxlength="2000" rows="3" placeholder="Anything else the hiring team should know?"></textarea></div>
      <div class="ephemeral-note">${icon('shield')}<span>Only authorised Business Space managers can review your application. Use a link you are comfortable sharing.</span></div>
    `,
    foot: `<button class="btn btn--primary btn--block" data-sp="role-apply-submit:${role.id}">Submit application</button>`
  });
}
async function openRoleApplicants(roleId) {
  sp.activeRoleApplicantsId = roleId;
  const role = Server.db.openRoles.find(r => r.id === roleId);
  if (!role || !Server.can(role.spaceId, 'space.post.pin')) { toast('You cannot review applicants here.', 'x'); return; }
  const { data, error } = await supabaseClient.rpc('get_ming_space_role_applications', { p_role_id: roleId });
  if (error) { toast(error.message || 'Applicants could not be loaded.', 'x'); return; }
  const applications = (data || []).map(a => ({
    id:a.id, roleId:a.role_id, applicantId:a.applicant_id, introduction:a.introduction || '',
    skillsExperience:a.skills_experience || '', portfolioUrl:a.portfolio_url || '',
    message:a.message || '', status:a.status, createdAt:a.created_at
  }));
  const applicantProfiles = new Map();
  const profileIds = [...new Set(applications.map(a => a.applicantId).filter(id => id && id !== currentUser.id && !mingConnectionProfiles.has(id)))];
  if (profileIds.length) {
    const { data: profiles, error: profileError } = await supabaseClient
      .from('profiles').select('id, username, display_name, avatar_url').in('id', profileIds);
    if (!profileError) (profiles || []).forEach(profile => {
      const displayName = profile.display_name || '';
      applicantProfiles.set(profile.id, {
        id:profile.id, name:displayName, short:displayName.split(' ')[0] || '',
        username:profile.username ? '@' + profile.username.replace(/^@/, '') : '',
        avatarUrl:profile.avatar_url || '', bio:'', tag:'', interests:[], tags:[], activity:'',
        hue:0, status:null, visitor:false
      });
    });
  }
  const statuses = [['submitted','Submitted'],['reviewing','Reviewing'],['shortlisted','Shortlisted'],['interview','Interview'],['rejected','Rejected'],['hired','Hired']];
  openSheet({
    title: 'Applicants · ' + role.title,
    sub: applications.length + (applications.length === 1 ? ' application' : ' applications'),
    body: applications.length ? applications.map(a => {
      const person = applicantProfiles.get(a.applicantId) || personOf(a.applicantId);
      return `<article class="sp-card sp-role-applicant">
        <div class="sp-role-applicant__head">${avatar(person,38)}<div class="sp-role-applicant__identity"><strong>${esc(person.short || person.name || person.username || 'Tweaklr member')}</strong><small>${esc(person.username || '')} · ${esc(timeAgo(new Date(a.createdAt).getTime()))}</small></div><span class="sp-role-status">${esc(a.status)}</span></div>
        <div class="sp-role-applicant__section"><b>Introduction</b><p>${esc(a.introduction)}</p></div>
        <div class="sp-role-applicant__section"><b>Skills & experience</b><p>${esc(a.skillsExperience)}</p></div>
        ${a.portfolioUrl ? `<a class="sp-role-link" href="${esc(a.portfolioUrl)}" target="_blank" rel="noopener noreferrer">Open CV / portfolio ↗</a>` : '<div class="sp-role-muted">No CV or portfolio link supplied.</div>'}
        <div class="sp-role-applicant__section"><b>Message</b><p>${esc(a.message)}</p></div>
        <div class="sp-role-applicant__controls"><label for="ra-status-${a.id}">Application status</label><select id="ra-status-${a.id}">${statuses.map(([v,l])=>`<option value="${v}" ${a.status===v?'selected':''}>${l}</option>`).join('')}</select>
        <button class="btn btn--soft btn--sm" data-sp="appstatus:${a.id}">Save status</button><button class="btn btn--soft btn--sm" data-sp="msg-applicant:${a.applicantId}">Contact applicant</button></div>
      </article>`;
    }).join('') : spEmpty('No applications have been submitted yet.'),
    foot: '<button class="btn btn--soft btn--block" data-action="close-sheet">Done</button>'
  });
}
async function setOpenRoleStatus(roleId, status) {
  const role = Server.db.openRoles.find(r => r.id === roleId);
  if (!role || !Server.can(role.spaceId, 'space.post.pin')) { toast('You cannot manage this role.', 'x'); return; }
  const { error } = await supabaseClient.rpc('update_ming_space_open_role', {
    p_role_id: role.id, p_title: role.title, p_employment_type: role.employmentType,
    p_work_mode: role.workMode, p_location: role.location, p_department: role.department,
    p_description: role.description, p_responsibilities: role.responsibilities || [],
    p_required_skills: role.requiredSkills || [], p_compensation: role.compensation || '',
    p_application_deadline: role.applicationDeadline || null, p_status: status
  });
  if (error) { toast(error.message || 'Role status could not be updated.', 'x'); return; }
  closeSheet();
  await refreshOpenRoles(role.spaceId);
  toast(status === 'closed' ? 'Role closed' : 'Role reopened', 'check');
}

VIEWS.business.brief = s => {
  const notes = contentOf(s.id, 'announcement');
  const legacyOpps = contentOf(s.id, 'opportunity');
  const roles = Server.db.openRoles.filter(r => r.spaceId === s.id);
  const canManage = Server.can(s.id, 'space.post.pin');
  return `
  <div class="sp-sec"><h3>Announcements ${canManage ? `<span><button data-sp="new:announcement">Post</button></span>` : ''}</h3>
    ${notes.length ? notes.map(a => `
      <div class="sp-card ${a.pinned ? 'pinned' : ''}">
        <div style="font-size:14.5px;font-weight:580;letter-spacing:-.018em">${esc(a.title)}</div>
        <p style="font-size:13.5px;color:var(--muted);margin-top:6px;line-height:1.5">${esc(a.body)}</p>
        <div style="font-size:11.5px;color:var(--muted);margin-top:10px">${esc(nameOf(a.authorId))} · ${esc(timeAgo(a.at))}</div>
      </div>`).join('') : spEmpty('Nothing announced yet.', canManage ? { t: 'Post the first one', a: 'new:announcement' } : null)}
  </div>
  <div class="sp-sec sp-open-roles">
    <h3>Open roles ${canManage ? `<span><button data-sp="role-new">Add role</button></span>` : ''}</h3>
    ${roles.length ? roles.map(r => `
      <article class="sp-card sp-open-role ${r.status==='closed'?'is-closed':''}">
        <div class="sp-open-role__top"><div><div class="sp-open-role__title">${esc(r.title)}</div><div class="sp-open-role__meta">${esc(r.employmentType.replace(/-/g,' '))} · ${esc(r.workMode.replace(/-/g,' '))}${r.department ? ' · ' + esc(r.department) : ''}</div></div><span class="sp-role-status ${r.status==='open'?'is-open':'is-closed'}">${r.status==='open'?'Open':'Closed'}</span></div>
        ${r.location ? `<div class="sp-open-role__detail">${icon('sp-globe')}<span>${esc(r.location)}</span></div>` : ''}
        <p class="sp-open-role__description">${esc(r.description)}</p>
        ${r.responsibilities.length ? `<div class="sp-open-role__section"><b>Responsibilities</b><ul>${r.responsibilities.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
        ${r.requiredSkills.length ? `<div class="sp-open-role__skills"><b>Required skills</b><div>${r.requiredSkills.map(x=>`<span>${esc(x)}</span>`).join('')}</div></div>` : ''}
        ${r.compensation ? `<div class="sp-open-role__detail"><b>Compensation</b><span>${esc(r.compensation)}</span></div>` : ''}
        <div class="sp-open-role__footer"><span>Deadline: ${esc(openRoleDateLabel(r.applicationDeadline))}</span><span>${r.applicationCount} applicant${r.applicationCount===1?'':'s'}</span></div>
        ${r.myApplicationStatus ? `<div class="sp-role-applied">Your application: <b>${esc(r.myApplicationStatus.replace(/-/g,' '))}</b></div>` : ''}
        <div class="sp-open-role__actions">
          ${!canManage && r.status==='open' && !r.myApplicationStatus ? `<button class="btn btn--primary btn--sm" data-sp="role-apply:${r.id}">Apply</button>` : ''}
          ${canManage ? `<button class="btn btn--soft btn--sm" data-sp="role-edit:${r.id}">Edit</button><button class="btn btn--soft btn--sm" data-sp="role-applicants:${r.id}">Applicants (${r.applicationCount})</button>${r.status==='open' ? `<button class="btn btn--soft btn--sm" data-sp="role-close:${r.id}">Close role</button>` : `<button class="btn btn--soft btn--sm" data-sp="role-reopen:${r.id}">Reopen</button>`}` : ''}
        </div>
      </article>`).join('') : spEmpty('No roles are published yet.', canManage ? {t:'Create the first role',a:'role-new'} : null)}
    ${legacyOpps.length ? `<div class="sp-role-legacy"><small>Earlier opportunity posts</small>${legacyOpps.map(o=>`<div class="sp-card"><b>${esc(o.title || 'Opportunity')}</b><p>${esc(o.body || '')}</p><button class="btn btn--soft btn--sm" data-sp="apply:${o.id}">Express interest</button></div>`).join('')}</div>` : ''}
  </div>
  <div class="sp-sec"><h3>Documents</h3>
    ${contentOf(s.id, 'doc').map(d => `
      <div class="sp-card" style="display:flex;align-items:center;gap:12px">
        ${icon('sp-doc')}<div style="flex:1"><div style="font-size:14px">${esc(d.title)}</div>
        <div style="font-size:11.5px;color:var(--muted)">${esc(d.meta)}</div></div><span class="go">${icon('chev')}</span>
      </div>`).join('') || spEmpty('No documents shared.')}
  </div>`;
};

VIEWS.business.work = space => {
 const tasks=contentOf(space.id,'task'), statuses=[['todo','To do'],['in_progress','In progress'],['in_review','In review'],['completed','Completed']];
 const st=t=>t.status||(t.done?'completed':'todo'), today=new Date();today.setHours(0,0,0,0);
 const overdue=t=>t.due&&!t.done&&st(t)!=='completed'&&!Number.isNaN(Date.parse(t.due))&&new Date(t.due+'T00:00:00')<today;
 const completed=tasks.filter(t=>st(t)==='completed'||t.done).length, active=tasks.length-completed, late=tasks.filter(overdue).length, progress=tasks.length?Math.round(completed/tasks.length*100):0;
 const members=Server.db.members.filter(m=>m.spaceId===space.id&&m.approved!==false);
 const memberOptions=members.map(m=>{const p=personOf(m.userId);return '<option value="'+esc(m.userId)+'">'+esc(p.short||p.name||p.username||('Member · '+m.userId.slice(0,8)))+'</option>';}).join('');
 const cards=list=>list.map(t=>{
  const status=st(t),p=t.assigneeId?personOf(t.assigneeId):null,owner=p?(p.short||p.name||p.username||'Space member'):(t.owner||'Unassigned'),subs=Array.isArray(t.subtasks)?t.subtasks:[];
  const due=t.due?new Date(t.due+'T00:00:00'):null,dueText=!t.due?'No deadline':(overdue(t)?'Overdue · ':'Due ')+(due&&!Number.isNaN(+due)?due.toLocaleDateString([],{day:'numeric',month:'short'}):esc(t.due));
  return '<article class="sp-task-card '+(overdue(t)?'is-overdue':'')+'" data-task-card data-task-title="'+esc((t.title||'').toLowerCase())+'" data-task-status="'+esc(status)+'" data-task-priority="'+esc(t.priority||'medium')+'" data-task-assignee="'+esc(t.assigneeId||'')+'">'+
  '<div class="sp-task-card-top"><span class="sp-task-priority p-'+esc(t.priority||'medium')+'"><i></i>'+esc(({urgent:'Urgent',high:'High',medium:'Medium',low:'Low'}[t.priority||'medium']||'Medium'))+'</span><button type="button" class="sp-task-more" data-sp="task-open:'+t.id+'" aria-label="Open task details">•••</button></div>'+
  '<button type="button" class="sp-task-title" data-sp="task-open:'+t.id+'">'+esc(t.title||'Untitled task')+'</button>'+(t.description?'<p class="sp-task-description">'+esc(t.description)+'</p>':'')+
  '<div class="sp-task-meta"><span class="sp-task-assignee"><span class="sp-task-avatar">'+esc(owner.slice(0,1).toUpperCase())+'</span>'+esc(owner)+'</span><span class="sp-task-due '+(overdue(t)?'late':'')+'">'+icon('clock')+esc(dueText)+'</span></div>'+
  '<div class="sp-task-card-bottom"><span class="sp-task-subcount">'+icon('check')+' '+subs.filter(x=>x.done).length+'/'+subs.length+' steps</span><select class="sp-task-status-select" data-task-status-id="'+t.id+'" aria-label="Change task status">'+statuses.map(([v,l])=>'<option value="'+v+'"'+(v===status?' selected':'')+'>'+l+'</option>').join('')+'</select></div>'+
  '<div class="sp-task-card-actions"><button type="button" class="btn btn--soft btn--sm" data-sp="task-open:'+t.id+'">Details</button><button type="button" class="btn btn--soft btn--sm" data-sp="task-edit:'+t.id+'">Edit</button></div></article>';
 }).join('');
 const board=statuses.map(([status,label])=>{const group=tasks.filter(t=>st(t)===status);return '<section class="sp-task-column col-'+status+'"><header><span class="sp-task-column-dot"></span><b>'+label+'</b><span class="sp-task-column-count">'+group.length+'</span></header><div class="sp-task-column-body">'+(group.length?cards(group):'<div class="sp-task-column-empty">Nothing here yet</div>')+'</div></section>';}).join('');
 return '<div class="sp-tasks"><section class="sp-task-hero"><div class="sp-task-hero-copy"><span class="sp-task-eyebrow">THE WORKROOM</span><h2>Make progress visible.</h2><p>Every priority, owner and deadline in one focused workspace.</p><div class="sp-task-hero-tags"><span>'+tasks.length+' total tasks</span><span>'+progress+'% complete</span></div></div><button type="button" class="btn btn--primary sp-task-create" data-sp="new:task">＋ Create task</button><div class="sp-task-progress"><div><span>Workspace progress</span><b>'+progress+'%</b></div><div class="sp-task-progress-track"><i style="width:'+progress+'%"></i></div></div></section>'+
 '<section class="sp-task-metrics"><article><span class="sp-task-metric-icon">◷</span><div><b>'+active+'</b><span>Active tasks</span></div></article><article><span class="sp-task-metric-icon">✓</span><div><b>'+completed+'</b><span>Completed</span></div></article><article class="'+(late?'metric-alert':'')+'"><span class="sp-task-metric-icon">!</span><div><b>'+late+'</b><span>Overdue</span></div></article><article><span class="sp-task-metric-icon">↗</span><div><b>'+tasks.filter(t=>['urgent','high'].includes(t.priority)&&st(t)!=='completed').length+'</b><span>High priority</span></div></article></section>'+
 '<section class="sp-task-controls"><label class="sp-task-search"><span>⌕</span><input id="sp-task-search" type="search" placeholder="Find a task…" aria-label="Search tasks"></label><select id="sp-task-filter-status" aria-label="Filter by status"><option value="">All statuses</option>'+statuses.map(([v,l])=>'<option value="'+v+'">'+l+'</option>').join('')+'</select><select id="sp-task-filter-priority" aria-label="Filter by priority"><option value="">All priorities</option><option value="urgent">Urgent</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select><select id="sp-task-filter-assignee" aria-label="Filter by assignee"><option value="">Everyone</option>'+memberOptions+'</select><button type="button" class="sp-task-view-toggle" data-sp="task-view-toggle">'+(sp.taskBoard?'List view':'Board view')+'</button></section><div class="sp-task-no-results" id="sp-task-no-results" hidden>No tasks match these filters. Try clearing a filter.</div>'+
 '<section class="sp-task-list-mode" id="sp-task-list-mode" '+(sp.taskBoard?'hidden':'')+'><div class="sp-task-list-head"><div><span class="sp-task-eyebrow">TASK REGISTER</span><h3>All tasks</h3></div><span class="sp-task-list-count">'+tasks.length+' items</span></div><div class="sp-task-grid">'+(tasks.length?cards(tasks):'<div class="sp-task-empty"><div class="sp-task-empty-symbol">✳</div><h3>Your next win starts here.</h3><p>Create the first task and turn the plan into progress.</p><button type="button" class="btn btn--primary" data-sp="new:task">Create your first task</button></div>')+'</div></section>'+
 '<section class="sp-task-board-mode" id="sp-task-board-mode" '+(!sp.taskBoard?'hidden':'')+'><div class="sp-task-board-heading"><div><span class="sp-task-eyebrow">LIVE WORKFLOW</span><h3>Board view</h3></div><span>Change a task status to move it</span></div><div class="sp-task-board">'+board+'</div></section></div>';
};

VIEWS.business.people = s => membersView(s, 'Roles decide what each person can do. Changes are enforced on the server.');
function auditEventLabel(event) {
  const labels = {
    'member.joined':'Member joined','member.role_changed':'Member role changed',
    'member.removed':'Member removed','invite.issued':'Invitation created',
    'invite.rotated':'Invitation renewed','content.created':'Space content created',
    'task.toggled':'Task status changed','task.updated':'Task details updated',
    'document.uploaded':'Document uploaded','document.renamed':'Document renamed',
    'document.categorized':'Document category changed','document.deleted':'Document deleted',
    'product.listed':'Product listed',
    'order.created':'Order created','order.funded':'Order funded',
    'order.seller_confirmed':'Seller confirmed order','order.shipped':'Order shipped',
    'order.delivered':'Delivery confirmed','order.accepted':'Order accepted',
    'order.cancelled':'Order cancelled','order.disputed':'Order disputed',
    'order.released':'Funds released','dispute.opened':'Dispute opened',
    'dispute.evidence_added':'Dispute evidence added','space.created':'Space created',
    'space.updated':'Space settings updated'
  };
  if (labels[event]) return labels[event];
  const tail = String(event || 'activity').split('.').pop().replace(/[_-]/g,' ');
  return tail.charAt(0).toUpperCase()+tail.slice(1);
}
function auditEventCategory(event) {
  if (/^(task|content)\./.test(event)) return 'work';
  if (/^document\./.test(event)) return 'documents';
  if (/^(member|space)\./.test(event)) return 'people';
  if (/^invite\./.test(event)) return 'access';
  if (/^(product|order|dispute)\./.test(event)) return 'market';
  return 'other';
}
function auditEventSummary(a) {
  const m = a.meta || {}, event = String(a.event || '');
  if (event === 'content.created') return (m.kind ? String(m.kind).replace(/[_-]/g,' ') : 'New content') + ' was added to the Space.';
  if (event === 'task.toggled') return m.done ? 'A task was marked complete.' : 'A task was reopened.';
  if (event === 'task.updated') return 'Task details, ownership, priority or progress were updated.';
  if (/^document\./.test(event)) return ({'document.uploaded':'A file was added to the shared library.','document.renamed':'A shared document was renamed.','document.categorized':'A document was moved to a different category.','document.deleted':'A document was removed from the shared library.'})[event] || 'A document changed.';
  if (event === 'member.role_changed') return 'A member’s Space role or access was updated.';
  if (event === 'member.joined') return 'A new member joined this Space.';
  if (event === 'invite.issued' || event === 'invite.rotated') return 'The Space invitation was ' + (event.endsWith('rotated') ? 'renewed.' : 'created.');
  if (/^order\./.test(event)) return 'An order moved through the Space marketplace workflow.';
  if (/^dispute\./.test(event)) return 'A marketplace dispute was updated.';
  if (event === 'product.listed') return 'A new marketplace listing was published.';
  return 'A change was recorded in this Space.';
}
async function refreshSpaceActivity(spaceId) {
  try {
    const { data, error } = await supabaseClient.rpc('get_my_ming_space_activity');
    if (error) {
      console.warn('Tweaklr: latest Space activity could not be refreshed.', error.message);
      return;
    }
    const incoming = (data || []).filter(row => row.space_id === spaceId).map(row => ({
      id: row.id, spaceId: row.space_id, actor: row.actor_id, event: row.event,
      meta: row.meta || {}, at: new Date(row.created_at).getTime()
    }));
    const pending = Server.db.audit.filter(row => row.spaceId === spaceId && String(row.id).startsWith('local_'));
    Server.db.audit = Server.db.audit.filter(row => row.spaceId !== spaceId).concat(incoming, pending);
    if (sp.activeId === spaceId && sp.tab === 'log') refreshSpace();
  } catch (error) {
    console.warn('Tweaklr: latest Space activity refresh failed.', error);
  }
}
function applySpaceActivityFilters() {
  const root = document.getElementById('screen-space');
  if (!root || root.dataset.nature !== 'business' || !root.querySelector('.sp-activity')) return;
  const query = (root.querySelector('#sp-activity-search')?.value || '').trim().toLowerCase();
  const category = root.querySelector('#sp-activity-category')?.value || '';
  const period = root.querySelector('#sp-activity-period')?.value || 'all';
  const cutoff = period === 'day' ? Date.now()-86400000 : period === 'week' ? Date.now()-7*86400000 : period === 'month' ? Date.now()-30*86400000 : 0;
  let shown = 0;
  root.querySelectorAll('[data-activity-row]').forEach(row => {
    const ok = (!query || row.dataset.search.includes(query)) &&
      (!category || row.dataset.category === category) &&
      Number(row.dataset.at || 0) >= cutoff;
    row.hidden = !ok;
    if (ok) shown++;
  });
  const empty = root.querySelector('#sp-activity-no-results');
  if (empty) empty.hidden = shown > 0;
}
VIEWS.business.log = s => {
  const entries = Server.auditFor(s.id);
  const now = Date.now(), recent = entries.filter(a => now-a.at < 86400000).length;
  const people = new Set(entries.map(a => a.actor).filter(Boolean)).size;
  const work = entries.filter(a => auditEventCategory(a.event) === 'work').length;
  const rows = entries.map(a => {
    const actor = nameOf(a.actor) || 'Space member';
    const label = auditEventLabel(a.event), category = auditEventCategory(a.event);
    const date = new Date(a.at);
    const timestamp = Number.isNaN(date.getTime()) ? 'Time unavailable' : date.toLocaleString([], {day:'numeric',month:'short',year:'numeric',hour:'numeric',minute:'2-digit'});
    const search = (actor+' '+label+' '+auditEventSummary(a)+' '+a.event).toLowerCase();
    const symbol = category === 'work' ? '✓' : category === 'people' ? '♙' : category === 'access' ? '⌁' : category === 'market' ? '↗' : '·';
    return '<article class="sp-activity-row" data-activity-row data-category="'+category+'" data-at="'+a.at+'" data-search="'+esc(search)+'"><span class="sp-activity-symbol c-'+category+'">'+symbol+'</span><div class="sp-activity-main"><div class="sp-activity-title"><b>'+esc(actor)+'</b><span>'+esc(label)+'</span></div><p>'+esc(auditEventSummary(a))+'</p><time>'+esc(timestamp)+'</time></div><span class="sp-activity-mark" aria-hidden="true">•</span></article>';
  }).join('');
  return '<div class="sp-activity"><section class="sp-activity-hero"><div><span class="sp-activity-eyebrow">THE SPACE RECORD</span><h2>Every move. One timeline.</h2><p>A clear history of changes across this workspace, from people and access to tasks and marketplace activity.</p></div><div class="sp-activity-seal" aria-hidden="true">↗</div></section>'+
    '<section class="sp-activity-metrics"><article><span>◷</span><div><b>'+entries.length+'</b><small>Total events</small></div></article><article><span>✳</span><div><b>'+recent+'</b><small>Last 24 hours</small></div></article><article><span>♙</span><div><b>'+people+'</b><small>Contributors</small></div></article><article><span>✓</span><div><b>'+work+'</b><small>Work updates</small></div></article></section>'+
    '<section class="sp-activity-toolbar"><label><span>⌕</span><input id="sp-activity-search" type="search" placeholder="Search people or activity…" aria-label="Search activity log"></label><select id="sp-activity-category" aria-label="Filter activity type"><option value="">All activity</option><option value="work">Tasks &amp; content</option><option value="documents">Documents</option><option value="people">People &amp; Space</option><option value="access">Invitations &amp; access</option><option value="market">Marketplace</option></select><select id="sp-activity-period" aria-label="Filter by date"><option value="all">Any time</option><option value="day">Last 24 hours</option><option value="week">Last 7 days</option><option value="month">Last 30 days</option></select></section>'+
    '<section class="sp-activity-feed"><div class="sp-activity-feed-head"><div><span class="sp-activity-eyebrow">AUDIT TRAIL</span><h3>Recent activity</h3></div><span>Newest first</span></div>'+(rows || '<div class="sp-activity-empty"><span>✳</span><h3>Your Space story starts here.</h3><p>When members create content, change roles or update work, those events will appear here.</p></div>')+'<div class="sp-activity-no-results" id="sp-activity-no-results" hidden>No activity matches those filters. Try a broader search.</div></section>'+
    '<p class="sp-activity-footnote">Activity records are append-only in the database. Only members of this Space can view its history.</p></div>';
};

/* ============================================================
   FRIENDLY
============================================================ */
VIEWS.friendly.home = s => {
  const members = Server.db.members.filter(m => m.spaceId === s.id);
  const polls = contentOf(s.id, 'poll');
  const events = contentOf(s.id, 'event');
  return `
  <div class="friend-strip">
    ${members.map(m => {
      const p = personOf(m.userId);
      return `<button data-sp="member:${m.userId}">${avatar(p, 40)}<div class="nm">${esc(p.short || p.name || '')}</div></button>`;
    }).join('')}
  </div>
  <div class="sp-sec"><h3>Today <span><button data-sp="new:moment">Share</button></span></h3>
    ${contentOf(s.id, 'moment').slice(0, 2).map(momentCard).join('') || spEmpty('Quiet in here.', { t: 'Share something', a: 'new:moment' })}
  </div>
  ${polls.length ? `<div class="sp-sec"><h3>Settle it</h3>${polls.map(pollCard).join('')}</div>` : ''}
  ${events.length ? `<div class="sp-sec"><h3>Coming up</h3>${events.map(eventCard).join('')}</div>` : ''}`;
};
VIEWS.friendly.moments = s => `
  <div class="sp-sec"><h3>Moments <span><button data-sp="new:moment">Share</button></span></h3>
    ${contentOf(s.id, 'moment').map(momentCard).join('') || spEmpty('No moments yet.', { t: 'Share the first', a: 'new:moment' })}</div>`;
VIEWS.friendly.events = s => `
  <div class="sp-sec"><h3>Events <span><button data-sp="new:event">Plan</button></span></h3>
    ${contentOf(s.id, 'event').map(eventCard).join('') || spEmpty('Nothing planned.', { t: 'Plan something', a: 'new:event' })}</div>`;
VIEWS.friendly.people = s => membersView(s, 'Everyone here was invited by someone.');

const REACTS = [['love', '♥'], ['ha', 'ha'], ['same', 'same'], ['wow', 'wow']];
const momentCard = m => `
  <div class="moment">
    <div class="art" style="background:linear-gradient(155deg,hsl(${m.hue} 40% 80%),hsl(${(m.hue + 320) % 360} 36% 52%))">
      <span style="background:rgba(255,253,249,.9);border-radius:99px;padding:4px 10px 4px 4px;font-size:11.5px;font-weight:550;display:inline-flex;align-items:center;gap:6px">
        ${avatar(personOf(m.authorId), 28, { status: false })}${esc(nameOf(m.authorId))}</span>
    </div>
    <div class="cap">${esc(m.text)}</div>
    <div class="reacts">
      ${REACTS.map(([k, label]) => `<button class="react ${m.mine && m.mine[k] ? 'on' : ''}" data-sp="react:${m.id}:${k}">${label} ${(m.reacts && m.reacts[k]) || 0}</button>`).join('')}
    </div>
  </div>`;
const pollCard = p => {
  const total = p.options.reduce((n, o) => n + o.votes, 0) || 1;
  return `<div class="sp-card">
    <div style="font-size:14.5px;font-weight:560">${esc(p.question)}</div>
    <div class="poll" style="margin-top:10px">
      ${p.options.map((o, i) => `
        <button class="${p.voted === i ? 'picked' : ''}" data-sp="vote:${p.id}:${i}">
          <span class="fill" style="width:${p.voted === null || p.voted === undefined ? 0 : Math.round(o.votes / total * 100)}%"></span>
          <span class="lb"><span>${esc(o.t)}</span><span>${p.voted === null || p.voted === undefined ? '' : Math.round(o.votes / total * 100) + '%'}</span></span>
        </button>`).join('')}
    </div>
    <div style="font-size:11.5px;color:var(--muted)">${total} ${total === 1 ? 'vote' : 'votes'}</div>
  </div>`;
};
const eventCard = e => `
  <div class="sp-card" style="display:flex;gap:14px;align-items:center">
    <div style="text-align:center;min-width:46px">
      <div style="font-size:17px;font-weight:620;letter-spacing:-.02em">${esc(e.day)}</div>
      <div style="font-size:11px;color:var(--muted)">${esc(e.month)}</div>
    </div>
    <div style="flex:1">
      <div style="font-size:14.5px;font-weight:555">${esc(e.title)}</div>
      <div style="font-size:12.5px;color:var(--muted);margin-top:2px">${esc(e.where)} · ${esc(e.time)}</div>
    </div>
    <button class="btn btn--soft btn--sm" data-sp="rsvp:${e.id}">${e.going ? 'Going' : 'Join'}</button>
  </div>`;

/* ============================================================
   CASUAL
============================================================ */
VIEWS.casual.now = s => `
  <div class="sp-sec"><h3>Happening now <span><button data-sp="new:now">Post</button></span></h3>
    ${contentOf(s.id, 'now').map(c => `
      <div class="sp-card">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
          ${avatar(personOf(c.authorId), 28, { status: false })}
          <span style="font-size:12.5px;font-weight:540">${esc(nameOf(c.authorId))}</span>
          <span class="ephem" style="margin-left:auto">${icon('clock')}${Math.max(1, Math.round((c.at + 6 * 36e5 - Date.now()) / 36e5))}h left</span>
        </div>
        <div style="font-size:14.5px;line-height:1.45">${esc(c.text)}</div>
      </div>`).join('') || spEmpty('Nothing yet. Casual Spaces clear themselves every few hours.', { t: 'Post something', a: 'new:now' })}
  </div>
  ${contentOf(s.id, 'poll').map(pollCard).join('')}
  <div class="sp-sec"><h3>Meeting point</h3>
    <div class="sp-card">
      <div style="font-size:14.5px;font-weight:555">${esc(contentOf(s.id, 'meet')[0] ? contentOf(s.id, 'meet')[0].title : 'Not set')}</div>
      <p style="font-size:12.5px;color:var(--muted);margin-top:6px;line-height:1.5">Shared only with people who have joined this Space. Never posted publicly.</p>
    </div>
  </div>`;

VIEWS.casual.around = s => {
  if (!hasLocation()) {
    return `<div class="sp-sec"><h3>Around</h3>${spEmpty('Location is off. Turn on location access to see who is close.', { t: 'Turn on location', a: 'loc' })}</div>`;
  }
  const near = people.filter(p => p.km !== null).sort((a, b) => a.km - b.km).slice(0, 6);
  return `<div class="sp-sec"><h3>Members nearby <span>${esc(areaLabel())}</span></h3>
    <div class="sp-card">
      ${near.map(p => `<div class="mrow">${avatar(p, 40)}
        <div class="m"><div class="n">${esc(p.short)}</div><div class="s">${esc(p.tag)}</div></div>
        <span class="dist-chip">${esc(distLabel(p.km))}</span></div>`).join('')}
    </div>
    <p style="font-size:12px;color:var(--muted);padding:6px 2px">Distances come from your device. No coordinates are shared with anyone in this Space.</p>
  </div>`;
};
VIEWS.casual.people = s => membersView(s, 'Casual Spaces can close themselves on a date you set.');

/* ============================================================
   SILLY
============================================================ */
const STICKERS = ['🥔','🦆','🛸','🧦','🐌','📎','🫠','🥁','🦖','🍌','🫡','🧃','🪿','🧠','🧌','🐸','🦐','🧯','🧍','🫥','👽','💀','🤡','🫠'];
VIEWS.silly.chaos = s => {
  const prompt = contentOf(s.id, 'prompt')[0];
  return `
  <div style="padding:14px 0 0">
    <div class="prompt">
      <div class="k">Prompt of the day</div>
      <h4>${esc(prompt ? prompt.title : 'Say something indefensible')}</h4>
      <div style="margin-top:14px"><button class="btn btn--primary btn--sm" data-sp="new:answer">Answer it</button></div>
    </div>
  </div>
  <div class="sp-sec"><h3>Answers</h3>
    ${contentOf(s.id, 'answer').map(a => `
      <div class="sp-card">
        <div style="font-size:15px;line-height:1.4;font-weight:600">${esc(a.text)}</div>
        <div style="font-size:11.5px;margin-top:9px">— ${esc(nameOf(a.authorId))}</div>
      </div>`).join('') || spEmpty('Nobody has embarrassed themselves yet.', { t: 'Go first', a: 'new:answer' })}
  </div>`;
};
VIEWS.silly.wall = s => `
  <div class="sp-sec"><h3>Sticker wall <span>Tap to throw</span></h3></div>
  <div class="stickers">${STICKERS.map((e, i) => `<button class="sticker" data-sp="sticker:${i}" aria-label="Throw sticker">${e}</button>`).join('')}</div>
  <div class="sp-sec"><h3>Thrown</h3>
    <div class="sp-card">${contentOf(s.id, 'sticker').slice(0, 12).map(c => `
      <div class="scoreline"><span>${c.emoji} ${esc(nameOf(c.authorId))}</span><span style="color:var(--muted);font-size:12px">${esc(timeAgo(c.at))}</span></div>`).join('')
      || '<p style="font-size:13.5px;color:var(--muted)">The wall is clean. Fix that.</p>'}</div>
  </div>`;
VIEWS.silly.game = s => {
  const scores = contentOf(s.id, 'score').sort((a, b) => b.score - a.score);
  return `
  <div class="sp-sec"><h3>Hold the button</h3>
    <div class="sp-card" style="text-align:center;padding:24px 18px">
      <div style="font-size:13px;color:var(--muted)">Press and hold. Let go at exactly 5.00 seconds.</div>
      <div id="game-clock" style="font-size:44px;font-weight:800;letter-spacing:-.04em;margin:12px 0">0.00</div>
      <button class="btn btn--primary btn--block" id="game-btn">Hold</button>
    </div>
  </div>
  <div class="sp-sec"><h3>Scoreboard</h3>
    <div class="sp-card">${scores.length ? scores.map((c, i) => `
      <div class="scoreline"><span>${i + 1}. ${esc(nameOf(c.authorId))}</span><b>${c.score.toFixed(2)}s</b></div>`).join('')
      : '<p style="font-size:13.5px;color:var(--muted)">No scores. Cowards.</p>'}</div>
  </div>`;
};
VIEWS.silly.people = s => membersView(s, 'Everyone here can be removed by the owner, instantly, for any reason.');

/* ============================================================
   ROMANTIC
============================================================ */
VIEWS.romantic.us = s => {
  const plan = contentOf(s.id, 'plan')[0];
  const ms = contentOf(s.id, 'milestone');
  return `
  <div class="rom-love-actions"><button class="btn btn--primary" data-sp="thinking-of-you">♡ Thinking of You</button><button class="btn btn--soft" data-sp="new:loveletter">Write a Love Letter</button></div>
  <div class="sp-sec"><h3>Next</h3>
    <div class="sp-card">
      ${plan ? `<div style="font-size:16px">${esc(plan.title)}</div>
        <div style="font-size:12.5px;color:var(--muted);margin-top:6px">${esc(plan.when)} · ${esc(plan.where)}</div>`
        : '<p style="font-size:13.5px;color:var(--muted)">Nothing planned. That is also allowed.</p>'}
      <div style="margin-top:14px"><button class="btn btn--soft btn--sm" data-sp="new:plan">Add a plan</button></div>
    </div>
  </div>
  <div class="sp-sec"><h3>Lately</h3>
    ${contentOf(s.id, 'love_note').slice(0, 3).map(n => `<article class="sp-card rom-love-note"><span>♡ A LITTLE REMINDER</span><p>${esc(n.text || 'Thinking of you ♡')}</p><small>${esc(nameOf(n.authorId))} · ${esc(timeAgo(n.at))}</small></article>`).join('')}
    ${contentOf(s.id, 'memory').slice(0, 3).map(m => `
      <div class="sp-card"><div style="font-size:14.5px;line-height:1.55">${esc(m.text)}</div>
      <div style="font-size:11.5px;color:var(--muted);margin-top:8px">${esc(m.when)}</div></div>`).join('')
      || spEmpty('Nothing kept yet.', { t: 'Write something', a: 'new:memory' })}
  </div>
  ${ms.length ? `<div class="sp-sec"><h3>Dates that matter</h3><div class="sp-card">
    ${ms.map(m => `<div class="milestone"><span class="d">${esc(m.d)}</span><span>${esc(m.title)}</span></div>`).join('')}
  </div></div>` : ''}
  <div class="privacy-seal">${icon('lock')}
    <span>This Space is invitation only and never appears in Discover. Nothing here is counted, ranked or shown anywhere else in Tweaklr.</span></div>`;
};
VIEWS.romantic.memories = s => `
  <div class="sp-sec"><h3>Memories <span><button data-sp="new:memory">Keep one</button></span></h3>
    <div class="sp-card">
      ${contentOf(s.id, 'memory').map(m => `
        <div class="memory"><span class="when">${esc(m.when)}</span><span class="tx">${esc(m.text)}</span></div>`).join('')
        || '<p style="font-size:13.5px;color:var(--muted)">Nothing yet.</p>'}
    </div>
  </div>`;
VIEWS.romantic.letters = s => {
  const letters = contentOf(s.id, 'love_letter').slice().sort((a,b) => Number(b.at||0)-Number(a.at||0));
  return '<div class="privacy-seal">' + icon('lock') + '<span>Love letters stay inside this private Space. Once sent, a letter cannot be edited.</span></div>' +
    '<div class="sp-sec"><h3>Love letters <span><button data-sp="new:loveletter">Write a letter</button></span></h3>' +
    (letters.length ? letters.map(l => '<article class="sp-card rom-letter"><div class="rom-letter__eyebrow">SEALED WITH LOVE</div><h4>' + esc(l.title || 'A letter for you') + '</h4><p>' + esc(l.body || '') + '</p><div class="rom-letter__foot">From ' + esc(nameOf(l.authorId)) + ' · ' + esc(l.at ? new Date(l.at).toLocaleDateString([], {day:'numeric',month:'short',year:'numeric'}) : 'Just now') + '</div></article>').join('') : spEmpty('A few honest words can become a favourite memory.', {t:'Write your first letter',a:'new:loveletter'})) +
    '</div>';
};
VIEWS.romantic.plans = s => `
  <div class="sp-sec"><h3>Plans <span><button data-sp="new:plan">Add</button></span></h3>
    ${contentOf(s.id, 'plan').map(p => `
      <div class="sp-card"><div style="font-size:15px">${esc(p.title)}</div>
      <div style="font-size:12.5px;color:var(--muted);margin-top:5px">${esc(p.when)} · ${esc(p.where)}</div></div>`).join('')
      || spEmpty('No plans yet.', { t: 'Add one', a: 'new:plan' })}
  </div>`;
VIEWS.romantic.lists = s => `
  <div class="sp-sec"><h3>Shared lists</h3>
    ${contentOf(s.id, 'list').map(l => `
      <div class="sp-card">
        <div style="font-size:15px;margin-bottom:8px">${esc(l.title)}</div>
        ${l.items.map((it, i) => `
          <button class="check" aria-pressed="${it.done}" data-sp="listtoggle:${l.id}:${i}" style="padding:7px 0">
            <span class="box">${icon('check')}</span><span class="lb">${esc(it.t)}</span></button>`).join('')}
        <button class="btn btn--soft btn--sm" style="margin-top:10px" data-sp="listadd:${l.id}">Add to list</button>
      </div>`).join('')}
  </div>`;

/* ============================================================
   MARKETPLACE
============================================================ */
VIEWS.marketplace.market = s => {
  const prods = Server.db.products.filter(p => p.spaceId === s.id && (sp.marketTab === 'all' || p.category === sp.marketTab));
  const cats = ['all', ...new Set(Server.db.products.filter(p => p.spaceId === s.id).map(p => p.category))];
  const isSeller = Server.can(s.id, 'product.create');
  return `
  <div style="padding:12px 16px 10px">
    <div class="searchbar"><svg><use href="#i-search"/></svg>
      <input id="mk-search" type="text" placeholder="Search listings" aria-label="Search listings" /></div>
  </div>
  <div class="chips">${cats.map(c => `<button class="chip ${sp.marketTab === c ? 'is-on' : ''}" data-sp="mkcat:${c}">${c === 'all' ? 'Everything' : esc(c)}</button>`).join('')}</div>
  <div class="sp-sec"><h3>Listings <span>${prods.length}</span></h3></div>
  <div class="mk-grid" id="mk-grid">${prods.map(productCard).join('') || `<div style="grid-column:1/-1">${spEmpty('Nothing listed yet.', isSeller ? { t: 'List an item', a: 'new:product' } : null)}</div>`}</div>
  ${isSeller ? `<div style="padding:16px"><button class="btn btn--primary btn--block" data-sp="new:product">${icon('plus')}List an item</button></div>` : `
    <div style="padding:16px"><div class="sp-card"><div style="font-size:14px;font-weight:550">Want to sell here?</div>
    <p style="font-size:12.5px;color:var(--muted);margin-top:5px;line-height:1.5">Sellers are approved by a moderator. Listing without the seller role is rejected by the server, not hidden in the app.</p>
    <button class="btn btn--soft btn--sm" style="margin-top:12px" data-sp="ask-seller">Request seller role</button></div></div>`}
  <div style="padding:0 16px 8px"><div class="sp-card" style="display:flex;gap:11px">
    ${icon('shield')}<p style="font-size:12.5px;color:var(--muted);line-height:1.5">Every purchase here is held in escrow until you confirm delivery. Tweaklr Wallet is in development mode — no real money moves.</p>
  </div></div>`;
};

const productCard = p => `
  <button class="mk-prod" data-sp="product:${p.id}">
    <span class="art" style="display:block;background:linear-gradient(150deg,hsl(${p.hue} 30% 86%),hsl(${(p.hue + 40) % 360} 26% 62%))">
      <span class="cond">${esc(p.condition)}</span>
    </span>
    <span class="b" style="display:block">
      <span class="n" style="display:block">${esc(p.title)}</span>
      <span class="p" style="display:block">${esc(money(p.price, p.asset))}</span>
      <span class="s" style="display:block">${esc(nameOf(p.sellerId))}${p.status === 'sold' ? ' · sold' : ''}</span>
    </span>
  </button>`;

VIEWS.marketplace.orders = s => {
  const mine = Server.db.orders.filter(o => o.spaceId === s.id &&
    (o.buyerId === Server.session.userId || o.sellerId === Server.session.userId));
  return `<div class="sp-sec"><h3>Your orders <span>${mine.length}</span></h3>
    ${mine.length ? mine.map(o => {
      const st = ORDER_STATES[o.status];
      const prod = Server.db.products.find(x => x.id === o.productId);
      return `<button class="sp-card" style="display:block;width:100%;text-align:left" data-sp="order:${o.id}">
        <div style="display:flex;gap:12px;align-items:center">
          <div style="flex:1"><div style="font-size:14.5px;font-weight:555">${esc(prod ? prod.title : 'Listing removed')}</div>
          <div style="font-size:11.5px;color:var(--muted);margin-top:3px">${esc(o.id)} · ${esc(o.buyerId === Server.session.userId ? 'buying from ' + nameOf(o.sellerId) : 'selling to ' + nameOf(o.buyerId))}</div></div>
          <div style="text-align:right"><div style="font-weight:600;font-variant-numeric:tabular-nums">${esc(money(o.total, o.asset))}</div></div>
        </div>
        <div style="margin-top:10px"><span class="state-pill ${st.cls}">${esc(st.t)}</span></div>
      </button>`;
    }).join('') : spEmpty('No orders yet.')}
  </div>`;
};

VIEWS.marketplace.sellers = s => {
  const sellers = Server.db.members.filter(m => m.spaceId === s.id && ['seller', 'owner'].includes(m.role));
  return `<div class="sp-sec"><h3>Sellers</h3>
    ${sellers.map(m => {
      const p = personOf(m.userId);
      const sold = Server.db.orders.filter(o => o.sellerId === m.userId && o.status === 'completed').length;
      const disputes = Server.db.disputes.filter(d => {
        const o = Server.db.orders.find(x => x.id === d.orderId); return o && o.sellerId === m.userId;
      }).length;
      return `<div class="sp-card">
        <div class="mrow" style="padding:0">${avatar(p, 44)}
          <div class="m"><div class="n">${esc(p.short || p.name)}</div>
          <div class="s">${sold} completed · ${disputes} disputes · joined ${esc(timeAgo(m.joinedAt))}</div></div>
        </div>
        <div style="display:flex;gap:7px;margin-top:11px;flex-wrap:wrap">
          <span class="trust">${icon('check')}Tweaklr member</span>
          ${sold >= 2 ? `<span class="trust">${icon('sp-box')}${sold} settled sales</span>` : `<span class="trust warn">${icon('clock')}New seller</span>`}
          <span class="trust warn">${icon('shield')}Identity not verified</span>
        </div>
      </div>`;
    }).join('')}
    <p style="font-size:12px;color:var(--muted);padding:4px 2px;line-height:1.5">Trust signals are facts Tweaklr can actually check. Identity verification needs a provider that is not connected yet, so no seller here is shown as verified.</p>
  </div>`;
};

VIEWS.marketplace.cases = s => {
  const ds = Server.db.disputes.filter(d => d.spaceId === s.id);
  return `<div class="sp-sec"><h3>Dispute centre <span>${ds.length} open</span></h3>
    ${ds.length ? ds.map(d => {
      const o = Server.db.orders.find(x => x.id === d.orderId);
      return `<button class="sp-card" style="display:block;width:100%;text-align:left" data-sp="order:${d.orderId}">
        <div style="font-size:14px;font-weight:555">${esc(d.reason)}</div>
        <div style="font-size:12px;color:var(--muted);margin-top:4px">${esc(d.orderId)} · opened ${esc(timeAgo(d.openedAt))} by ${esc(nameOf(d.openedBy))}</div>
        <div style="margin-top:10px"><span class="state-pill disputed">Funds held · ${Server.evidenceFor(d.id).length} pieces of evidence</span></div>
      </button>`;
    }).join('') : spEmpty('No disputes. Funds move only when a buyer confirms.')}
    <div class="sp-card" style="margin-top:4px">
      <div style="font-size:14px;font-weight:550">How a dispute is decided</div>
      <p style="font-size:12.5px;color:var(--muted);margin-top:6px;line-height:1.55">Opening a dispute does not refund anyone. It freezes the money where it already is — held by Tweaklr — and opens a 96-hour window for both sides to submit evidence. A moderator reviews the order timeline, the delivery record, the messages and both submissions, then releases, refunds or splits. Nothing is automatic in either direction.</p>
    </div>
  </div>`;
};

/* ---- product detail + checkout ---- */
function openBidSheet(productId) {
  const p = Server.db.products.find(x => x.id === productId);
  const bids = Server.db.bids.filter(b => b.productId === productId).sort((a,b) => b.amount - a.amount);
  const high = bids[0]?.amount || p?.price || 0;
  openSheet({
    title: 'Place a bid', sub: p ? p.title : 'Auction',
    body: '<div class="sp-card"><div style="font-size:12px;color:var(--muted)">Current highest</div><div style="font-size:24px;font-weight:750;margin-top:5px">' + esc(money(high)) + '</div></div>' +
      '<div class="field"><label for="bid-amount">Your bid in USDT</label><input id="bid-amount" type="number" min="' + (high + 0.01) + '" step="0.01" placeholder="' + (high + 1) + '" /></div>' +
      '<div class="ephemeral-note">' + icon('shield') + '<span>Bids are timestamped and saved to this Space. Payment still uses Tweaklr’s development-mode transaction flow.</span></div>',
    foot: '<button class="btn btn--primary btn--block" data-sp="bid-submit:' + productId + '">Place bid</button>'
  });
}
function openProduct(id) {
  const p = Server.db.products.find(x => x.id === id);
  const s = spaceById(p.spaceId);
  const seller = personOf(p.sellerId);
  const sold = Server.db.orders.filter(o => o.sellerId === p.sellerId && o.status === 'completed').length;
  openSheet({
    title: p.title,
    sub: `${money(p.price, p.asset)} · ${p.condition} · ${p.handover}`,
    body: `
      <div style="height:150px;border-radius:14px;margin:4px 0 14px;background:linear-gradient(150deg,hsl(${p.hue} 30% 86%),hsl(${(p.hue + 40) % 360} 26% 60%))"></div>
      <p style="font-size:14px;line-height:1.55">${esc(p.description)}</p>
      <div style="display:flex;gap:7px;margin-top:14px;flex-wrap:wrap">
        <span class="trust">${icon('shield')}Escrow protected</span>
        ${sold >= 2 ? `<span class="trust">${icon('check')}${sold} settled sales</span>` : `<span class="trust warn">${icon('clock')}New seller</span>`}
        <span class="trust">${icon('sp-box')}${p.qty} in stock</span>
      </div>
      <div class="mrow" style="margin-top:14px;border-top:1px solid var(--border);padding-top:14px">
        ${avatar(seller, 36)}<div class="m"><div class="n">${esc(seller.short || seller.name)}</div>
        <div class="s">Seller · ${esc(s.name)}</div></div>
        <button class="btn btn--soft btn--sm" data-sp="msg-seller:${p.sellerId}">Message</button>
      </div>`,
    foot: p.sellerId === Server.session.userId
      ? `<button class="btn btn--soft btn--block" data-action="close-sheet">This is your listing</button>`
      : `<button class="btn btn--primary btn--block" data-sp="buy:${p.id}">Buy · ${esc(money(p.price, p.asset))}</button>`
  });
}

function openCheckout(productId) {
  const p = Server.db.products.find(x => x.id === productId);
  const acct = Server.account(Server.session.userId, 'USDT');
  const fee = Math.round(p.price * 0.015 * 100) / 100;
  openSheet({
    title: 'Checkout',
    sub: `${p.title} · ${money(p.price, p.asset)}`,
    body: `
      <div class="sp-card" style="background:var(--surface-2);border:0">
        <div style="display:flex;justify-content:space-between;font-size:14px;padding:4px 0"><span>Item</span><b>${esc(money(p.price))}</b></div>
        <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--muted);padding:4px 0"><span>Tweaklr fee, paid by seller</span><span>${esc(money(fee))}</span></div>
        <div style="display:flex;justify-content:space-between;font-size:15px;padding:8px 0 2px;border-top:1px solid var(--border);margin-top:6px"><b>You pay</b><b>${esc(money(p.price))}</b></div>
      </div>
      <div class="field"><label>Pay from</label>
        <div class="pick">
          <button type="button" aria-pressed="true">USDT · ${esc(acct.available.toFixed(2))} available</button>
          <button type="button" aria-pressed="false" disabled>BTC</button>
        </div>
      </div>
      <div class="ephemeral-note">${icon('shield')}<span>Your payment is held by Tweaklr, not sent to the seller. It is released when you confirm delivery, or refunded if the dispute goes your way.</span></div>
      <div class="dev-banner" style="margin:14px 0 0;color:#8A5310;background:rgba(214,150,40,.1);border-color:rgba(214,150,40,.28)">
        ${icon('flag')}<span>Development mode. Balances are internal test figures, there is no custody provider connected and nothing settles on a blockchain.</span></div>`,
    foot: `<button class="btn btn--primary btn--block" data-sp="pay:${p.id}">Place order and hold ${esc(money(p.price))}</button>`
  });
}

/* ---- order detail: the escrow lifecycle ---- */
function openOrder(id) {
  sp.activeOrder = id;
  const o = Server.db.orders.find(x => x.id === id);
  const s = spaceById(o.spaceId);
  $('#screen-order').dataset.nature = s.nature;
  renderOrder();
  pushStack('order');
}

function renderOrder() {
  const o = Server.db.orders.find(x => x.id === sp.activeOrder);
  const prod = Server.db.products.find(x => x.id === o.productId);
  const party = Server.partyOf(o);
  const st = ORDER_STATES[o.status];
  const dispute = Server.db.disputes.find(d => d.orderId === o.id);
  const events = Server.orderEvents(o.id);
  const reached = new Set(events.map(e => e.to));
  const idx = FLOW_ORDER.indexOf(o.status);

  $('#ord-title').textContent = prod ? prod.title : 'Order';
  $('#ord-sub').textContent = `${o.id} · ${money(o.total, o.asset)}`;

  const actions = Object.entries(Server.ORDER_FLOW[o.status] || {})
    .filter(([, rule]) => party && rule.who.includes(party))
    .map(([t]) => t);

  $('#ord-body').innerHTML = `
    <div class="sp-sec">
      <div class="sp-card">
        <div style="display:flex;align-items:center;gap:12px">
          <div style="flex:1"><div style="font-size:15px;font-weight:570">${esc(prod ? prod.title : 'Listing removed')}</div>
          <div style="font-size:12px;color:var(--muted);margin-top:3px">${esc(party === 'buyer' ? 'From ' + nameOf(o.sellerId) : party === 'seller' ? 'To ' + nameOf(o.buyerId) : 'Reviewing as moderator')}</div></div>
          <div style="font-weight:650;font-variant-numeric:tabular-nums">${esc(money(o.total, o.asset))}</div>
        </div>
        <div style="margin-top:12px"><span class="state-pill ${st.cls}">${esc(st.t)}</span></div>
        ${o.status === 'delivered' && o.acceptanceDeadline ? `<p style="font-size:12.5px;color:var(--muted);margin-top:10px;line-height:1.5">Accept or raise a problem before ${esc(new Date(o.acceptanceDeadline).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }))}. After that the platform releases the funds.</p>` : ''}
      </div>
    </div>

    <div class="sp-sec"><h3>Escrow</h3>
      <div class="sp-card">
        <div class="flow">
          ${FLOW_ORDER.map((k, i) => {
            const done = reached.has(k) || (idx > -1 && i < idx);
            const current = o.status === k;
            const ev = events.find(e => e.to === k);
            return `<div class="flow-step ${done ? 'done' : ''} ${current ? 'current' : ''} ${!done && !current ? 'pendingstep' : ''}">
              <span class="node">${icon('check')}</span>
              <span class="tx"><span class="t" style="display:block">${FLOW_COPY[k][0]}</span>
              <span class="s" style="display:block">${ev ? esc(nameOf(ev.actor)) + ' · ' + esc(timeAgo(ev.at)) : FLOW_COPY[k][1]}</span></span>
            </div>`;
          }).join('')}
        </div>
        ${['disputed', 'refunded', 'cancelled'].includes(o.status) ? `
          <div style="border-top:1px solid var(--border);padding-top:12px;margin-top:4px">
            <span class="state-pill ${st.cls}">${esc(st.t)}</span>
            <p style="font-size:12.5px;color:var(--muted);margin-top:9px;line-height:1.5">${o.status === 'disputed'
              ? 'The money has not moved. It stays held by Tweaklr until a moderator decides.'
              : o.status === 'refunded' ? 'Returned to the buyer’s wallet.' : 'The hold was released back to the buyer.'}</p>
          </div>` : ''}
      </div>
    </div>

    ${dispute ? renderDisputePanel(dispute, o, party) : ''}

    ${actions.length ? `<div style="padding:4px 16px 16px;display:flex;flex-direction:column;gap:9px">
      ${actions.map(t => `<button class="btn ${PRIMARY_TRANSITIONS.includes(t) ? 'btn--primary' : 'btn--soft'} btn--block" data-sp="trans:${o.id}:${t}">${TRANSITION_LABEL[t]}</button>`).join('')}
    </div>` : `<p style="font-size:12.5px;color:var(--muted);padding:4px 18px 18px;line-height:1.5">
      Nothing for you to do here right now. ${party === 'buyer' ? 'The seller has the next step.' : party === 'seller' ? 'Waiting on the buyer.' : ''}</p>`}

    <div class="sp-sec"><h3>Record</h3>
      <div class="sp-card">
        ${events.slice().reverse().map(e => `
          <div style="display:flex;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);font-size:12.5px">
            <span style="color:var(--muted);min-width:96px">${esc(new Date(e.at).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }))}</span>
            <span style="flex:1">${esc(nameOf(e.actor))} · ${esc(e.transition.replace(/_/g, ' '))}${e.from ? ` (${esc(e.from)} → ${esc(e.to)})` : ''}</span>
          </div>`).join('')}
        <p style="font-size:11.5px;color:var(--muted);margin-top:10px">Transaction ${esc(o.id)} · records are append-only and cannot be edited by either party.</p>
      </div>
    </div>`;
}

const TRANSITION_LABEL = {
  fund: 'Pay and hold funds',
  cancel: 'Cancel order',
  seller_confirm: 'Confirm the order',
  ship: 'Mark as handed over',
  confirm_delivery: 'I received it',
  accept: 'Accept and release funds',
  dispute: 'Report a problem',
  resolve_release: 'Resolve · release to seller',
  resolve_refund: 'Resolve · refund buyer'
};
const PRIMARY_TRANSITIONS = ['fund', 'seller_confirm', 'ship', 'confirm_delivery', 'accept'];

function renderDisputePanel(d, o, party) {
  const ev = Server.evidenceFor(d.id);
  return `<div class="sp-sec"><h3>Dispute</h3>
    <div class="sp-card">
      <div style="font-size:14.5px;font-weight:555">${esc(d.reason)}</div>
      <p style="font-size:13px;color:var(--muted);margin-top:6px;line-height:1.5">${esc(d.detail || '')}</p>
      <p style="font-size:12px;color:var(--muted);margin-top:10px">Opened by ${esc(nameOf(d.openedBy))} · evidence closes ${esc(new Date(d.evidenceDeadline).toLocaleDateString([], { day: 'numeric', month: 'short' }))}</p>
      <div style="margin-top:12px">
        ${ev.length ? ev.map(e => `<div class="evidence-item">${icon(e.kind === 'photo' ? 'sp-camera' : 'sp-doc')}
          <span style="flex:1">${esc(e.label)}</span><span class="who">${esc(e.party)}</span></div>`).join('')
          : '<p style="font-size:12.5px;color:var(--muted)">No evidence submitted yet.</p>'}
      </div>
      ${party ? `<button class="btn btn--soft btn--sm" style="margin-top:12px" data-sp="evidence:${d.id}">Add evidence</button>` : ''}
    </div>
  </div>`;
}

/* ============================================================
   WALLET
============================================================ */
function openWallet() {
  pushStack('wallet');
  try { renderWallet(); }
  catch (error) {
    console.error('Tweaklr: Wallet screen render failed:', error);
    toast('Wallet could not be loaded right now.', 'alert');
  }
}

function renderWallet() {
  const assets = ['USDT', 'BTC'].map(a => Server.account(Server.session.userId, a));
  const entries = Server.db.walletEntries.filter(e => e.userId === Server.session.userId).slice(0, 20);
  $('#wallet-body').innerHTML = `
    <div class="dev-banner">${icon('flag')}
      <span><b>Development mode.</b> These balances are internal test figures. No custody provider is connected, no address is watched and nothing here settles on a blockchain. Deposits and withdrawals are disabled until a regulated custodian is integrated.</span></div>

    <div style="padding:0 16px 8px">
      ${assets.map(a => `
        <div class="asset">
          <span class="sym">${a.asset === 'USDT' ? '₮' : '₿'}</span>
          <span class="m"><span class="n" style="display:block">${a.asset}</span>
          <span class="s" style="display:block">${a.held > 0 ? money(a.held, a.asset) + ' held in escrow' : 'Nothing held'}</span></span>
          <span class="amt"><span class="v" style="display:block">${esc(money(a.available, a.asset))}</span>
          <span class="s" style="display:block">available</span></span>
        </div>`).join('')}
    </div>

    <div style="display:flex;gap:9px;padding:14px 16px">
      <button class="btn btn--soft" style="flex:1" data-sp="wallet-blocked:Deposit">Deposit</button>
      <button class="btn btn--soft" style="flex:1" data-sp="wallet-blocked:Withdraw">Withdraw</button>
      <button class="btn btn--soft" style="flex:1" data-sp="wallet-blocked:Send">Send</button>
    </div>

    <div class="section">${sectionHead('Activity', 'Internal ledger')}
      ${entries.length ? entries.map(e => `
        <div class="ledger-row">
          <span class="m"><span style="display:block">${esc(e.note)}</span>
          <span class="s">${esc(new Date(e.at).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }))}${e.ref ? ' · ' + esc(e.ref) : ''}</span></span>
          <span class="v ${e.amount < 0 ? 'out' : e.amount > 0 ? 'in' : ''}">${e.amount === 0 ? '—' : (e.amount > 0 ? '+' : '') + esc(money(e.amount, e.asset))}</span>
        </div>`).join('') : `<p style="padding:18px;color:var(--muted);font-size:13.5px">No activity yet.</p>`}
    </div>
    <p style="font-size:12px;color:var(--muted);padding:14px 18px 28px;line-height:1.6">
      Balances are derived from these entries rather than stored as a number, so every change has a record behind it.
      A production wallet adds withdrawal address allowlists, per-transaction limits, step-up authentication and an
      idempotency key on every write. Private keys never touch this app.</p>`;
}

/* ============================================================
   COMPOSERS (space-native content)
============================================================ */
const COMPOSERS = {
  file: { title: 'Add a file', fields: [['title', 'Description', 'input']], kind: 'doc', accepts: '*/*' },
  announcement: { title: 'Post an announcement', fields: [['title', 'Headline', 'input'], ['body', 'Details', 'textarea']], kind: 'announcement' },
  task: { title: 'Add a task', fields: [['title', 'Task', 'input'], ['owner', 'Owner', 'input'], ['due', 'Due', 'input']], kind: 'task' },
  moment: { title: 'Share a moment', fields: [['text', 'What happened?', 'textarea']], kind: 'moment' },
  event: { title: 'Plan something', fields: [['title', 'What', 'input'], ['where', 'Where', 'input'], ['time', 'When', 'input']], kind: 'event' },
  now: { title: 'Happening now', fields: [['text', 'What is going on?', 'textarea']], kind: 'now' },
  answer: { title: 'Answer the prompt', fields: [['text', 'Go on then', 'textarea']], kind: 'answer' },
  memory: { title: 'Keep a memory', fields: [['text', 'What do you want to remember?', 'textarea'], ['when', 'When', 'input']], kind: 'memory' },
  loveletter: { title: 'Write a love letter', fields: [['title', 'Give your letter a title', 'input'], ['body', 'Write from the heart', 'textarea']], kind: 'love_letter' },
  plan: { title: 'Add a plan', fields: [['title', 'What', 'input'], ['when', 'When', 'input'], ['where', 'Where', 'input']], kind: 'plan' },
  milestone: { title: 'Pin a special date', fields: [['title', 'What matters?', 'input'], ['when', 'Date', 'input']], kind: 'milestone' },
  nickname: { title: 'Choose a sweet name', fields: [['name', 'Sweet name', 'input']], kind: 'nickname' },
  meeting: { title: 'Host a meeting', fields: [['title', 'Meeting', 'input'], ['when', 'When', 'input'], ['agenda', 'Agenda', 'textarea']], kind: 'meeting' },
  poll: { title: 'Create a poll', fields: [['question', 'Question', 'input'], ['option1', 'Option one', 'input'], ['option2', 'Option two', 'input'], ['option3', 'Option three', 'input']], kind: 'poll' },
  health: { title: 'Private wellness entry', fields: [['metric', 'Metric', 'input'], ['value', 'Value', 'input'], ['when', 'Date', 'input']], kind: 'health' }
};

function taskMemberOptions(spaceId,selected=''){return Server.db.members.filter(m=>m.spaceId===spaceId&&m.approved!==false).map(m=>{const p=personOf(m.userId);return '<option value="'+esc(m.userId)+'"'+(m.userId===selected?' selected':'')+'>'+esc(p.short||p.name||p.username||('Member · '+m.userId.slice(0,8)))+'</option>';}).join('');}
function taskStatus(t){return t.status||(t.done?'completed':'todo');}
function openTaskComposer(taskId=null){
 const task=taskId?Server.db.content.find(t=>t.id===taskId&&t.spaceId===sp.activeId):null;if(taskId&&!task){toast('Task not found. Refresh the Space and try again.','x');return;}
 const statuses=[['todo','To do'],['in_progress','In progress'],['in_review','In review'],['completed','Completed']];
 openSheet({title:task?'Refine task':'Create a task',sub:'A clear owner. A real deadline. Visible progress.',body:'<div class="sp-task-form"><div class="sp-task-form-intro"><span class="sp-task-eyebrow">TASK DETAILS</span><p>Give the team enough context to do their best work.</p></div><div class="field"><label for="cx-title">Task name *</label><input id="cx-title" maxlength="100" placeholder="e.g. Finalise launch checklist" value="'+esc(task?.title||'')+'"/></div><div class="field"><label for="cx-description">Description &amp; success criteria</label><textarea id="cx-description" maxlength="1200" rows="4" placeholder="What needs to happen, and what does done look like?">'+esc(task?.description||'')+'</textarea></div><div class="sp-task-form-row"><div class="field"><label for="cx-assignee">Assign to a Space member</label><select id="cx-assignee"><option value="">Unassigned</option>'+taskMemberOptions(sp.activeId,task?.assigneeId||'')+'</select></div><div class="field"><label for="cx-due">Deadline</label><input id="cx-due" type="date" value="'+esc(task?.due||'')+'"/></div></div><div class="sp-task-form-row"><div class="field"><label for="cx-priority">Priority</label><select id="cx-priority">'+[['low','Low'],['medium','Medium'],['high','High'],['urgent','Urgent']].map(([v,l])=>'<option value="'+v+'"'+((task?.priority||'medium')===v?' selected':'')+'>'+l+'</option>').join('')+'</select></div><div class="field"><label for="cx-status">Status</label><select id="cx-status">'+statuses.map(([v,l])=>'<option value="'+v+'"'+((task?.status||(task?.done?'completed':'todo'))===v?' selected':'')+'>'+l+'</option>').join('')+'</select></div></div></div>',foot:'<button type="button" class="btn btn--soft" data-sp="task-cancel">Cancel</button><button type="button" class="btn btn--primary" data-sp="'+(task?'task-save:'+task.id:'post:task')+'">'+(task?'Save changes':'Create task')+'</button>'});
}
async function saveTaskRow(task,changes,success='Task updated'){
 const before={...task,subtasks:Array.isArray(task.subtasks)?task.subtasks.map(x=>({...x})):[],comments:Array.isArray(task.comments)?task.comments.map(x=>({...x})):[]};Object.assign(task,changes);task.done=task.status==='completed';
 const res=await Server.submit('content.mutate',{id:task.id,op:'taskupdate'});if(!res.ok){Object.keys(task).forEach(k=>delete task[k]);Object.assign(task,before);toast(res.error||'Task could not be saved.','x');return false;}toast(success,'check');return true;
}
function openTaskDetails(id){
 const t=Server.db.content.find(x=>x.id===id&&x.spaceId===sp.activeId);if(!t){toast('Task not found. Refresh the Space and try again.','x');return;}
 const st=taskStatus(t),subs=Array.isArray(t.subtasks)?t.subtasks:[],comments=Array.isArray(t.comments)?t.comments:[],p=t.assigneeId?personOf(t.assigneeId):null,owner=p?(p.short||p.name||p.username||'Space member'):(t.owner||'Unassigned');
 const subHtml=subs.length?subs.map((x,i)=>'<label class="sp-task-subtask '+(x.done?'is-done':'')+'"><input type="checkbox" data-task-subtoggle="'+i+'" data-task-parent="'+t.id+'"'+(x.done?' checked':'')+'/><span>'+esc(x.title||x.t||'Checklist item')+'</span></label>').join(''):'<p class="sp-task-muted">Break the work into smaller, checkable steps.</p>';
 const commentHtml=comments.length?comments.map(x=>'<article class="sp-task-comment"><span class="sp-task-comment-avatar">'+esc((x.authorName||'M').slice(0,1).toUpperCase())+'</span><div><b>'+esc(x.authorName||'Space member')+'</b><small>'+esc(x.at?new Date(x.at).toLocaleString([],{dateStyle:'medium',timeStyle:'short'}):'')+'</small><p>'+esc(x.text)+'</p></div></article>').join(''):'<p class="sp-task-muted">Keep decisions and updates attached to the work.</p>';
 const taskFiles=Server.db.files.filter(file=>file.contentId===t.id&&file.spaceId===t.spaceId);
 const attachmentsHtml='<section class="sp-task-detail-section"><div class="sp-task-detail-section-head"><h3>Attachments</h3><span>'+taskFiles.length+' files</span></div>'+(taskFiles.length?taskFiles.map(file=>'<div class="sp-task-attachment"><span class="sp-task-attachment-icon">↗</span><div><b>'+esc(file.filename||'Shared file')+'</b><small>'+esc(file.contentType||'File')+' · '+(Number(file.sizeBytes||0)>1048576?(Number(file.sizeBytes)/1048576).toFixed(1)+' MB':Math.max(1,Math.round(Number(file.sizeBytes||0)/1024))+' KB')+'</small></div><button type="button" class="btn btn--soft btn--sm" data-sp="file-open:'+file.id+'">Open</button></div>').join(''):'<p class="sp-task-muted">Keep briefs and working files alongside the task.</p>')+'<label class="sp-task-attach-pick">＋ Attach file<input id="sp-task-attachment" type="file" accept="*/*" data-task-attachment-id="'+t.id+'"/></label></section>';
 openSheet({title:'Task details',sub:'Review the work, update progress and keep everyone aligned.',body:'<div class="sp-task-detail"><div class="sp-task-detail-top"><span class="sp-task-priority p-'+esc(t.priority||'medium')+'"><i></i>'+esc(({urgent:'Urgent',high:'High',medium:'Medium',low:'Low'}[t.priority||'medium']||'Medium'))+' priority</span><span class="sp-task-detail-id">TASK · '+esc(t.id.slice(0,8).toUpperCase())+'</span></div><h2>'+esc(t.title)+'</h2><p class="sp-task-detail-description">'+esc(t.description||'No description added yet.')+'</p><div class="sp-task-detail-stats"><div><small>ASSIGNED TO</small><b>'+esc(owner)+'</b></div><div><small>DEADLINE</small><b>'+esc(t.due||'Not set')+'</b></div><div><small>STATUS</small><b>'+esc(({todo:'To do',in_progress:'In progress',in_review:'In review',completed:'Completed'}[st]||'To do'))+'</b></div></div><div class="field"><label for="sp-task-detail-status">Update status</label><select id="sp-task-detail-status">'+[['todo','To do'],['in_progress','In progress'],['in_review','In review'],['completed','Completed']].map(([v,l])=>'<option value="'+v+'"'+(st===v?' selected':'')+'>'+l+'</option>').join('')+'</select></div><section class="sp-task-detail-section"><div class="sp-task-detail-section-head"><h3>Checklist</h3><button type="button" class="btn btn--soft btn--sm" data-sp="task-subadd:'+t.id+'">＋ Add step</button></div>'+subHtml+'</section>'+attachmentsHtml+'<section class="sp-task-detail-section"><div class="sp-task-detail-section-head"><h3>Discussion</h3><span>'+comments.length+' updates</span></div>'+commentHtml+'<button type="button" class="btn btn--soft sp-task-comment-button" data-sp="task-comment:'+t.id+'">＋ Add update</button></section></div>',foot:'<button type="button" class="btn btn--soft" data-sp="task-edit:'+t.id+'">Edit task</button><button type="button" class="btn btn--primary" data-sp="task-detail-save:'+t.id+'">Save status</button>'});
}
function openTaskTextPrompt(id,comment=false){openSheet({title:comment?'Add a task update':'Add a checklist step',sub:comment?'Share context with the team.':'Turn the work into a small next action.',body:'<div class="field"><label for="sp-task-text">'+(comment?'Update':'Checklist item')+'</label><textarea id="sp-task-text" maxlength="1200" rows="4" placeholder="'+(comment?'What should the team know?':'What is the next step?')+'"></textarea></div>',foot:'<button type="button" class="btn btn--soft" data-sp="task-cancel">Cancel</button><button type="button" class="btn btn--primary" data-sp="'+(comment?'task-comment-save:':'task-subadd-save:')+id+'">Save</button>'});}
function applyTaskFilters(){const root=document.getElementById('screen-space');if(!root)return;const q=(root.querySelector('#sp-task-search')?.value||'').trim().toLowerCase(),status=root.querySelector('#sp-task-filter-status')?.value||'',priority=root.querySelector('#sp-task-filter-priority')?.value||'',assignee=root.querySelector('#sp-task-filter-assignee')?.value||'';let count=0;root.querySelectorAll('[data-task-card]').forEach(card=>{const ok=(!q||(card.dataset.taskTitle||'').includes(q))&&(!status||card.dataset.taskStatus===status)&&(!priority||card.dataset.taskPriority===priority)&&(!assignee||card.dataset.taskAssignee===assignee);card.hidden=!ok;if(ok)count++;});const empty=root.querySelector('#sp-task-no-results');if(empty)empty.hidden=count>0;}
document.addEventListener('input',e=>{if(e.target.id==='sp-task-search')applyTaskFilters();});
document.addEventListener('input',e=>{if(e.target.id==='sp-activity-search')applySpaceActivityFilters();});
document.addEventListener('change',e=>{if(['sp-activity-category','sp-activity-period'].includes(e.target.id))applySpaceActivityFilters();});
document.addEventListener('change',e=>{if(['sp-task-filter-status','sp-task-filter-priority','sp-task-filter-assignee'].includes(e.target.id))applyTaskFilters();});
document.addEventListener('change',async e=>{const sel=e.target.closest('[data-task-status-id]');if(!sel)return;const task=Server.db.content.find(t=>t.id===sel.dataset.taskStatusId&&t.spaceId===sp.activeId);if(!task)return;const prior=taskStatus(task);if(!['todo','in_progress','in_review','completed'].includes(sel.value))return;const ok=await saveTaskRow(task,{status:sel.value},'Task status updated');if(ok)renderSpace();else sel.value=prior;});
document.addEventListener('change',async e=>{const input=e.target.closest('[data-task-attachment-id]');if(!input)return;const task=Server.db.content.find(t=>t.id===input.dataset.taskAttachmentId&&t.spaceId===sp.activeId),file=input.files?.[0];if(!task||!file)return;if(file.size>25*1024*1024){toast('Attachments must be 25 MB or smaller.','x');input.value='';return;}const result=await Server.uploadSpaceFile(sp.activeId,file,'task',task.id,null);if(!result.ok){toast(result.error||'Attachment upload failed.','x');return;}toast('Task attachment added','check');closeSheet();await loadSpacesFromDatabase();if(sp.activeId===task.spaceId)openTaskDetails(task.id);});
document.addEventListener('change',async e=>{const input=e.target.closest('[data-task-subtoggle]');if(!input)return;const id=input.dataset.taskParent,index=Number(input.dataset.taskSubtoggle),task=Server.db.content.find(t=>t.id===id&&t.spaceId===sp.activeId);if(!task||!task.subtasks?.[index])return;const subtasks=task.subtasks.map((x,i)=>i===index?{...x,done:input.checked}:x);if(await saveTaskRow(task,{subtasks},'Checklist updated')){closeSheet();openTaskDetails(id);}});
function openComposerFor(key) {
  const c = COMPOSERS[key];
  openSheet({
    title: c.title,
    sub: '',
    body: c.fields.map(([k, label, type]) => `
      <div class="field"><label for="cx-${k}">${label}</label>
        ${type === 'input' ? `<input id="cx-${k}" type="text" maxlength="${key === 'loveletter' && k === 'title' ? 100 : 80}" />` : `<textarea id="cx-${k}" maxlength="${key === 'loveletter' ? 4000 : 240}" ${key === 'loveletter' ? 'rows="9" placeholder="Tell them what you want them to remember."' : ''}></textarea>`}
      </div>`).join('') + (c.accepts ? `<div class="field"><label for="cx-file">Attach a file</label><input id="cx-file" type="file" accept="${c.accepts}" /></div>` : ''),
    foot: `<button class="btn btn--primary btn--block" data-sp="post:${key}">Post</button>`
  });
  setTimeout(() => { const f = $('#cx-' + c.fields[0][0]); if (f) f.focus(); }, 240);
}


async function startSpaceMediaRecording(kind) {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    toast('Recording is not supported by this browser.', 'x');
    return;
  }
  const audio = kind === 'audio';
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(audio ? { audio: true } : { video: true, audio: true });
    const mime = audio
      ? (MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '')
      : (MediaRecorder.isTypeSupported('video/webm') ? 'video/webm' : '');
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks = [];
    recorder.ondataavailable = e => { if (e.data?.size) chunks.push(e.data); };
    recorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(chunks, { type: recorder.mimeType || (audio ? 'audio/webm' : 'video/webm') });
      const ext = audio ? 'webm' : 'webm';
      sp.pendingMedia.push(new File([blob], 'ming-recording-' + Date.now() + '.' + ext, { type: blob.type }));
      toast(audio ? 'Voice recording attached' : 'Video recording attached', 'check');
    };
    recorder.start();
    toast('Recording… tap OK in 10 seconds to finish.', 'sp-game');
    setTimeout(() => { if (recorder.state !== 'inactive') recorder.stop(); }, 10000);
  } catch (error) {
    if (stream) stream.getTracks().forEach(t => t.stop());
    toast(error?.message || 'Recording permission was denied.', 'x');
  }
}

function openProductComposer() {
  sp.pendingMedia = [];
  openSheet({
    title: 'List an item',
    sub: 'The price you set here is the price the server charges. It cannot be changed by the buyer.',
    body: `
      <div class="field"><label for="pf-title">What are you selling?</label><input id="pf-title" type="text" maxlength="60" /></div>
      <div class="field"><label for="pf-files">Photos, video or audio</label><input id="pf-files" type="file" multiple accept="image/*,video/*,audio/*" capture="environment" /></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn btn--soft btn--sm" data-sp="record-video">Record video</button><button type="button" class="btn btn--soft btn--sm" data-sp="record-audio">Record sound</button></div>
      <div class="field"><label for="pf-price">Price in USDT</label><input id="pf-price" type="text" inputmode="decimal" placeholder="250" /></div>
      <div class="field"><label for="pf-desc">Description</label><textarea id="pf-desc" maxlength="300" placeholder="Condition, what's included, anything wrong with it."></textarea></div>
      <div class="field"><label>Condition</label><div class="pick" id="pf-cond">
        ${['New', 'Like new', 'Used', 'For parts'].map((c, i) => `<button type="button" data-pick="${c}" aria-pressed="${i === 1}">${c}</button>`).join('')}</div></div>
      <div class="field"><label>Category</label><div class="pick" id="pf-cat">
        ${['Electronics', 'Home', 'Clothing', 'Services'].map((c, i) => `<button type="button" data-pick="${c}" aria-pressed="${i === 0}">${c}</button>`).join('')}</div></div>
      <div class="field"><label>Auction</label><div class="toggle-row"><span class="tx"><span class="t" style="display:block">Accept bids</span><span class="s" style="display:block">Highest valid bid wins when you close the auction.</span></span><input id="pf-auction" type="checkbox" /></div></div>
      <div class="field"><label for="pf-auction-end">Auction end (optional)</label><input id="pf-auction-end" type="datetime-local" /></div>
      <div class="field"><label>Handover</label><div class="pick" id="pf-hand">
        ${['Pickup', 'Delivery', 'Either'].map((c, i) => `<button type="button" data-pick="${c}" aria-pressed="${i === 2}">${c}</button>`).join('')}</div></div>
      <div class="ephemeral-note">${icon('sp-camera')}<span>Photos, video and audio are uploaded to the private Space media vault and linked to this listing.</span></div>`,
    foot: `<button class="btn btn--primary btn--block" data-sp="product-submit">List it</button>`
  });
}

function openDisputeSheet(orderId) {
  openSheet({
    title: 'Report a problem',
    sub: 'This freezes the funds where they are. It does not refund you automatically.',
    body: `
      <div class="field"><label>What went wrong?</label>
        <div class="pick" id="dp-reason">
          ${['Not delivered', 'Not as described', 'Damaged', 'Wrong item', 'Other'].map((r, i) => `
            <button type="button" data-pick="${r}" aria-pressed="${i === 0}">${r}</button>`).join('')}
        </div></div>
      <div class="field"><label for="dp-detail">What happened?</label>
        <textarea id="dp-detail" maxlength="400" placeholder="Be specific. Dates, condition, what you expected."></textarea></div>
      <div class="ephemeral-note">${icon('sp-scale')}<span>Both sides get 96 hours to submit evidence. A moderator reviews the order timeline, delivery record and both submissions before deciding. Filing a dispute you cannot support counts against your account.</span></div>`,
    foot: `<button class="btn btn--primary btn--block" data-sp="dispute-submit:${orderId}">Open dispute</button>`
  });
}

function openEvidenceSheet(disputeId) {
  openSheet({
    title: 'Add evidence',
    sub: 'Anything that shows the state of the item or the handover.',
    body: `
      <div class="field"><label>Type</label><div class="pick" id="ev-kind">
        ${[['photo', 'Photo'], ['doc', 'Document'], ['doc', 'Tracking'], ['doc', 'Messages']].map(([k, t], i) => `
          <button type="button" data-pick="${k}" data-label="${t}" aria-pressed="${i === 0}">${t}</button>`).join('')}</div></div>
      <div class="field"><label for="ev-label">Describe it</label><input id="ev-label" type="text" maxlength="70" placeholder="Photo of the screen taken at handover" /></div>
      <div class="ephemeral-note">${icon('lock')}<span>Evidence is timestamped when it arrives at the server and cannot be edited afterwards. File upload needs storage that is not connected yet, so this records the description only.</span></div>`,
    foot: `<button class="btn btn--primary btn--block" data-sp="evidence-submit:${disputeId}">Submit</button>`
  });
}

function openSpaceSettings(spaceId) {
  const s = spaceById(spaceId);
  const role = Server.roleOf(spaceId);
  openSheet({
    title: 'Space settings',
    sub: `${s.name} · you are ${role}`,
    body: `
      <button class="opt" data-sp="invite:${s.id}"><span class="ic">${icon('sp-key')}</span>
        <span class="tx"><span class="t" style="display:block">Invitation</span><span class="s" style="display:block">Share, or regenerate and lock everyone else out</span></span>
        <span class="go">${icon('chev')}</span></button>
      <div class="opt" style="pointer-events:none"><span class="ic">${icon('shield')}</span>
        <span class="tx"><span class="t" style="display:block">Privacy</span>
        <span class="s" style="display:block">${{ private: 'Invitation only', approval: 'Invitation, with approval', discoverable: 'Discoverable nearby' }[s.privacy]}</span></span></div>
      <div class="opt" style="pointer-events:none"><span class="ic">${icon('users')}</span>
        <span class="tx"><span class="t" style="display:block">Roles</span>
        <span class="s" style="display:block">${Server.ROLE_SETS[s.nature].join(' · ')}</span></span></div>
      ${role === 'owner' ? `<button class="opt" data-sp="delete-space:${s.id}"><span class="ic">${icon('trash')}</span>
        <span class="tx"><span class="t" style="display:block">Delete Space</span><span class="s" style="display:block">Permanently delete this Space and its invitation.</span></span>
        <span class="go">${icon('chev')}</span></button>` : ''}
      <button class="opt" data-sp="leave:${s.id}"><span class="ic">${icon('x')}</span>
        <span class="tx"><span class="t" style="display:block">Leave Space</span><span class="s" style="display:block">You would need a new code to come back</span></span>
        <span class="go">${icon('chev')}</span></button>`,
    foot: `<button class="btn btn--soft btn--block" data-action="close-sheet">Close</button>`
  });
}

/* ---- shared small views ---- */
function spEmpty(text, cta) {
  return `<div class="sp-empty"><p>${esc(text)}</p>${cta ? `<button class="btn btn--soft btn--sm" data-sp="${cta.a}">${esc(cta.t)}</button>` : ''}</div>`;
}

function membersView(s, note) {
  const ms = Server.db.members.filter(m => m.spaceId === s.id);
  const canRole = Server.can(s.id, 'space.member.role');
  return `<div class="sp-sec"><h3>Members <span>${ms.length}</span></h3>
    <div class="sp-card">
      ${ms.map(m => {
        const p = personOf(m.userId);
        return `<div class="mrow">${avatar(p, 40)}
          <div class="m"><div class="n">${esc(p.short || p.name)}</div>
          <div class="s">Joined ${esc(timeAgo(m.joinedAt))}${m.approved === false ? ' · awaiting approval' : ''}</div></div>
          ${canRole && m.role !== 'owner'
            ? `<button class="role" data-sp="role:${s.id}:${m.userId}">${esc(m.role)}</button>`
            : `<span class="role">${esc(m.role)}</span>`}
        </div>`;
      }).join('')}
    </div>
    <p style="font-size:12px;color:var(--muted);padding:6px 2px;line-height:1.5">${esc(note)}</p>
    <button class="btn btn--soft btn--block" style="margin-top:6px" data-sp="invite:${s.id}">${icon('sp-key')}Invite someone</button>
  </div>`;
}

/* Business Documents interactions, isolated from other Spaces and screens. */
document.addEventListener('input',e=>{if(e.target.id==='docs-search')filterBusinessDocuments();});
document.addEventListener('change',e=>{if(e.target.id==='docs-category')filterBusinessDocuments();});
function filterBusinessDocuments(){const search=document.getElementById('docs-search'),category=document.getElementById('docs-category'),grid=document.getElementById('docs-grid');if(!search||!category||!grid)return;const q=search.value.trim().toLowerCase(),cat=category.value;let visible=0;grid.querySelectorAll('[data-doc-card]').forEach(card=>{const match=(!q||(card.dataset.docName||'').includes(q))&&(!cat||card.dataset.docCategory===cat);card.hidden=!match;if(match)visible++;});const empty=document.getElementById('docs-no-results');if(empty)empty.hidden=visible>0;}
function openBusinessDocumentUpload(){if(!sp.activeId)return;openSheet({title:'Add to Documents',sub:'Shared securely with approved Space members.',body:'<div class="sp-doc-upload-panel"><div class="sp-doc-upload-drop"><div class="sp-doc-empty-icon">'+icon('sp-doc')+'</div><b>Choose a document</b><p>PDF, Word, Excel, PowerPoint, images, text and other file types.</p><input id="docs-upload-file" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.rtf,.md,.odt,.ods,.odp,image/*,video/mp4,video/webm" /></div><div class="field"><label for="docs-upload-name">Display name (optional)</label><input id="docs-upload-name" type="text" maxlength="120" placeholder="Use the original filename" /></div><div class="field"><label for="docs-upload-category">Category</label><select id="docs-upload-category"><option>General</option><option>Contracts</option><option>Finance</option><option>Design</option><option>Reports</option><option>Policies</option><option>Other</option></select></div><p class="sp-doc-upload-hint">Files use this Space’s existing private storage. Only share documents you have permission to upload.</p></div>',foot:'<button type="button" class="btn btn--soft" data-sp="doc-upload-cancel">Cancel</button><button type="button" class="btn btn--primary" data-sp="doc-upload-save">Upload document</button>'});}
function openDocumentMetaSheet(fileId,field){const file=Server.db.files.find(f=>f.id===fileId&&f.spaceId===sp.activeId);if(!file){toast('Document not found. Refresh the Space and try again.','x');return;}const nameMode=field==='name';openSheet({title:nameMode?'Rename document':'Organise document',sub:'Your original uploaded file stays in place.',body:nameMode?'<div class="field"><label for="docs-rename-value">Document name</label><input id="docs-rename-value" type="text" maxlength="120" value="'+esc(file.displayName||file.filename||'')+'" /></div>':'<div class="field"><label for="docs-category-value">Category</label><select id="docs-category-value">'+['General','Contracts','Finance','Design','Reports','Policies','Other'].map(x=>'<option'+((file.category||'General')===x?' selected':'')+'>'+x+'</option>').join('')+'</select></div>',foot:'<button type="button" class="btn btn--soft" data-sp="doc-meta-cancel">Cancel</button><button type="button" class="btn btn--primary" data-sp="doc-meta-save:'+fileId+':'+field+'">Save changes</button>'});}
/* ============================================================
   EVENTS
============================================================ */
document.addEventListener('click', async e => {
  const returnLatest = e.target.closest('[data-action="chat-return-latest"]');
  if (returnLatest) {
    const thread = document.querySelector('#chat-thread');
    if (thread) thread.scrollTo({ top: thread.scrollHeight, behavior: 'smooth' });
    return;
  }

  const host = e.target.closest('[data-sp]');
  if (!host) return;
  const [verb, a, b] = host.dataset.sp.split(':');
  const S = () => spaceById(sp.activeId);

  switch (verb) {
    case 'create': openWizard(); break;
    case 'create-type': openWizard(a); break;
    case 'spaces': closeSheet(); openSpaces(); break;
    case 'join': openJoinSheet(); break;
    case 'open': openSpace(a); break;
    case 'filter':
      sp.indexFilter = a || 'all';
      renderSpaces();
      break;
    case 'wallet': openWallet(); break;
    case 'tab': sp.tab = a; renderSpace(); if (S().nature === 'business' && a === 'brief') void refreshOpenRoles(S().id); if (S().nature === 'business' && a === 'log') void refreshSpaceActivity(S().id); break;
    case 'invite': closeSheet(); setTimeout(() => openInviteSheet(a), 150); break;
    case 'settings': openSpaceSettings(a); break;
    case 'delete-space': {
      const s = spaceById(a);
      if (!s || Server.roleOf(a) !== 'owner') { toast('Only the creator can delete this Space.', 'x'); break; }
      openModal({
        title: 'Delete this Space?',
        lede: 'This permanently removes the Space, its members, invitation code and Space data. This cannot be undone.',
        actions: [{ t: 'Keep Space', cls: 'btn--soft', a: 'close-modal' }, { t: 'Delete Space', cls: 'btn--danger', a: 'confirm-delete-space' }]
      });
      $('#modal').querySelector('[data-action="confirm-delete-space"]').addEventListener('click', async () => {
        const res = await Server.submit('space.delete', { spaceId: a });
        closeModal();
        if (!res.ok) { toast(res.error, 'x'); return; }
        closeSheet();
        sp.activeId = null;
        await loadSpacesFromDatabase();
        renderSpaces();
        popStack();
        toast('Space deleted', 'check');
      });
      break;
    }

    /* wizard */
    case 'wz-nature': wzSet({ nature: a }); break;
    case 'wz-privacy': wzSet({ privacy: a }); break;
    case 'wz-hue': wzSet({ hue: a === 'null' ? null : +a }); break;
    case 'wz-theme': { const palette = (NATURES[sp.wizard.nature]?.palettes || []).find(p => p.name === a); if (palette) wzSet({ theme: palette, hue: null }); break; }
    case 'wz-ttlh': wzSet({ inviteTtlHours: +a }); break;
    case 'wz-maxuses': wzSet({ inviteMaxUses: +a || null }); break;
    case 'wz-toggle': captureWizardInputs(); wzSet({ [a]: !sp.wizard[a] }); break;
    case 'wz-feature': {
      const f = sp.wizard.features;
      f[a] = f[a] === false ? true : false;
      renderWizard();
      break;
    }

    /* invitations */
    case 'toggle-code': {
      if (!sp.shownCodes[a]) break;
      sp.codeVisibility[a] = sp.codeVisibility[a] === false;
      openInviteSheet(a);
      break;
    }
    case 'copy-code': {
      const code = sp.shownCodes[a];
      if (!code) break;
      try { await navigator.clipboard.writeText(code); toast('Code copied', 'check'); }
      catch (_) { toast('Copy is blocked here — write it down', 'x'); }
      break;
    }
    case 'share-code': {
      const s = spaceById(a), code = sp.shownCodes[a];
      const text = `Join "${s.name}" on Tweaklr. Code: ${code}`;
      if (navigator.share) { try { await navigator.share({ text }); } catch (_) {} }
      else { try { await navigator.clipboard.writeText(text); toast('Invitation copied', 'check'); } catch (_) { toast('Sharing is unavailable here', 'x'); } }
      break;
    }
    case 'rotate-code': {
      openModal({
        title: 'Regenerate the code?',
        lede: 'The current code stops working immediately. Anyone who has it but has not joined will be locked out.',
        actions: [{ t: 'Keep it', cls: 'btn--soft', a: 'close-modal' }, { t: 'Regenerate', cls: 'btn--primary', a: 'noop' }]
      });
      $('#modal').querySelector('[data-action="noop"]').addEventListener('click', async () => {
        const res = await Server.submit('space.invite.rotate', { spaceId: a, ttlHours: 24 });
        closeModal();
        if (!res.ok) { toast(res.error, 'x'); return; }
        sp.shownCodes[a] = res.data.code;
        openInviteSheet(a);
        toast('New code issued — the old one is dead', 'check');
      });
      break;
    }
    case 'join-submit': {
      const v = $('#join-code').value;
      const res = await Server.submit('space.join', { code: v });
      if (!res.ok) { toast(res.error, 'x'); return; }
      closeSheet();
      renderSpaces();
      toast(`Joined ${res.data.space.name}`, 'check');
      setTimeout(() => openSpace(res.data.space.id), 260);
      break;
    }

    /* Business Documents — only affects the active Space's document library. */
    case 'doc-upload': openBusinessDocumentUpload(); break;
    case 'doc-upload-cancel': closeSheet(); break;
    case 'doc-upload-save': {
      const file=$('#docs-upload-file')?.files?.[0]; if(!file){toast('Choose a document to upload first.','x');break;}
      if(file.size>25*1024*1024){toast('Documents must be 25 MB or smaller.','x');break;}
      const spaceId=sp.activeId,category=$('#docs-upload-category')?.value||'General',displayName=($('#docs-upload-name')?.value.trim()||file.name).slice(0,120);
      const up=await Server.uploadSpaceFile(spaceId,file,'document',null,null);if(!up.ok){toast(up.error||'The document could not be uploaded.','x');break;}
      const row=up.data.file;Server.recordActivity(spaceId,'document.uploaded',{fileId:row.id});const {data:details,error:metaError}=await supabaseClient.rpc('update_ming_space_file_details',{p_file_id:row.id,p_display_name:displayName,p_category:category});
      if(metaError){console.warn('Tweaklr: document uploaded but its details could not be saved.',metaError.message);toast('Uploaded, but details could not be saved. Run the Documents migration in Supabase.','x');}
      else{row.displayName=details?.display_name||displayName;row.category=details?.category||category;toast('Document uploaded','check');}
      closeSheet();await loadSpacesFromDatabase();if(sp.activeId===spaceId){sp.tab='files';renderSpace();}break;
    }
    case 'file-open': await openSpaceFile(a); break;
    case 'file-download': await openSpaceFile(a, true); break;
    case 'doc-rename': openDocumentMetaSheet(a,'name'); break;
    case 'doc-category': openDocumentMetaSheet(a,'category'); break;
    case 'doc-meta-cancel': closeSheet(); break;
    case 'doc-meta-save': {
      const file=Server.db.files.find(f=>f.id===a&&f.spaceId===sp.activeId);if(!file){toast('Document not found.','x');break;}
      const field=b,displayName=field==='name'?($('#docs-rename-value')?.value.trim()||''):(file.displayName||file.filename),category=field==='category'?($('#docs-category-value')?.value||'General'):(file.category||'General');
      if(field==='name'&&!displayName){toast('Enter a document name.','x');break;}
      const {data:details,error}=await supabaseClient.rpc('update_ming_space_file_details',{p_file_id:a,p_display_name:displayName,p_category:category});
      if(error){toast(error.message||'Document details could not be saved.','x');break;}
      file.displayName=details?.display_name||displayName;file.category=details?.category||category;Server.recordActivity(file.spaceId,field==='name'?'document.renamed':'document.categorized',{fileId:file.id});closeSheet();renderSpace();toast(field==='name'?'Document renamed':'Category updated','check');break;
    }
    case 'doc-delete': {
      const file=Server.db.files.find(f=>f.id===a&&f.spaceId===sp.activeId);if(!file){toast('Document not found.','x');break;}
      openModal({title:'Delete this document?',lede:'This removes the shared file from this Space. This action cannot be undone.',actions:[{t:'Keep document',cls:'btn--soft',a:'close-modal'},{t:'Delete document',cls:'btn--danger',a:'noop'}]});
      $('#modal').querySelector('[data-action="noop"]').addEventListener('click',async()=>{const {error:storageError}=await supabaseClient.storage.from('ming-space-media').remove([file.storagePath]);if(storageError){closeModal();toast(storageError.message||'File could not be removed from storage.','x');return;}const {error}=await supabaseClient.rpc('delete_ming_space_file',{p_file_id:file.id});closeModal();if(error){toast(error.message||'File storage was removed but its record could not be deleted. Contact a Space admin.','x');return;}Server.recordActivity(file.spaceId,'document.deleted',{fileId:file.id});Server.db.files=Server.db.files.filter(f=>f.id!==file.id);renderSpace();toast('Document deleted','check');});break;
    }

    /* Business Space Open Roles */
    case 'role-new': openRoleComposer(); break;
    case 'role-edit': openRoleComposer(a); break;
    case 'role-close': await setOpenRoleStatus(a, 'closed'); break;
    case 'role-reopen': await setOpenRoleStatus(a, 'open'); break;
    case 'role-save': {
      const spaceId = sp.activeId;
      if (!spaceId || !Server.can(spaceId, 'space.post.pin')) { toast('You cannot manage Open Roles here.', 'x'); break; }
      const title = $('#or-title')?.value.trim() || '';
      const description = $('#or-description')?.value.trim() || '';
      if (title.length < 2 || !description) { toast('Add a role title and description first.', 'x'); break; }
      const deadlineValue = $('#or-deadline')?.value || '';
      const deadline = deadlineValue ? new Date(deadlineValue) : null;
      if (deadline && Number.isNaN(deadline.getTime())) { toast('Check the application deadline.', 'x'); break; }
      const args = {
        p_title:title,
        p_employment_type:$('#or-type')?.value || 'full-time',
        p_work_mode:$('#or-mode')?.value || 'remote',
        p_location:$('#or-location')?.value.trim() || '',
        p_department:$('#or-department')?.value.trim() || '',
        p_description:description,
        p_responsibilities:($('#or-responsibilities')?.value || '').split('\n').map(x=>x.trim()).filter(Boolean).slice(0,30),
        p_required_skills:($('#or-skills')?.value || '').split(/[\n,]/).map(x=>x.trim()).filter(Boolean).slice(0,40),
        p_compensation:$('#or-compensation')?.value.trim() || '',
        p_application_deadline:deadline ? deadline.toISOString() : null
      };
      const result = a === 'new'
        ? await supabaseClient.rpc('create_ming_space_open_role', { p_space_id:spaceId, ...args })
        : await supabaseClient.rpc('update_ming_space_open_role', { p_role_id:a, ...args, p_status:$('#or-status')?.value || 'open' });
      if (result.error) { toast(result.error.message || 'The role could not be saved.', 'x'); break; }
      closeSheet();
      await refreshOpenRoles(spaceId);
      toast(a === 'new' ? 'Role published' : 'Role updated', 'check');
      break;
    }
    case 'role-apply': {
      const role = Server.db.openRoles.find(r => r.id === a);
      openRoleApplicationSheet(role);
      break;
    }
    case 'role-apply-submit': {
      const introduction = $('#oa-intro')?.value.trim() || '';
      const skillsExperience = $('#oa-experience')?.value.trim() || '';
      const portfolioUrl = $('#oa-portfolio')?.value.trim() || '';
      const message = $('#oa-message')?.value.trim() || '';
      if (!introduction || !skillsExperience || !message) { toast('Complete your introduction, skills, and application message.', 'x'); break; }
      const { error } = await supabaseClient.rpc('apply_ming_space_open_role', {
        p_role_id:a, p_introduction:introduction, p_skills_experience:skillsExperience,
        p_portfolio_url:portfolioUrl, p_message:message
      });
      if (error) { toast(error.message || 'Your application could not be submitted.', 'x'); break; }
      closeSheet();
      await refreshOpenRoles(sp.activeId);
      toast('Application submitted', 'check');
      break;
    }
    case 'role-applicants': await openRoleApplicants(a); break;
    case 'appstatus': {
      const select = $('#ra-status-' + a);
      if (!select) { toast('Choose an application status first.', 'x'); break; }
      const { error } = await supabaseClient.rpc('update_ming_space_role_application_status', {
        p_application_id:a, p_status:select.value
      });
      if (error) { toast(error.message || 'Application status could not be saved.', 'x'); break; }
      const roleId = sp.activeRoleApplicantsId;
      await refreshOpenRoles(sp.activeId);
      toast('Applicant status updated', 'check');
      if (roleId) await openRoleApplicants(roleId);
      break;
    }
    case 'msg-applicant': closeSheet(); setTimeout(() => openChat(a), 180); break;

    /* space content */
    case 'thinking-of-you': {
      const active = spaceById(sp.activeId);
      if (!active || active.nature !== 'romantic' || !Server.can(sp.activeId, 'space.post')) { toast('This moment is only available inside your Romantic Space.', 'x'); break; }
      const recent = contentOf(sp.activeId, 'love_note').find(n => n.authorId === currentUser.id && Date.now() - Number(n.at || 0) < 30000);
      if (recent) { toast('Your little reminder has already been sent. Give it a moment.', 'x'); break; }
      const res = await Server.submit('space.post', { spaceId: sp.activeId, kind: 'love_note', payload: { text: 'Thinking of you ♡', createdAt: new Date().toISOString() } });
      if (!res.ok) { toast(res.error || 'Could not send your reminder.', 'x'); break; }
      refreshSpace(); toast('A little love has been sent ♡', 'check'); break;
    }
    case 'new': a === 'product' ? openProductComposer() : (a === 'task' ? openTaskComposer() : openComposerFor(a)); break;
    case 'task-cancel': closeSheet(); break;
    case 'task-view-toggle': sp.taskBoard=!sp.taskBoard; renderSpace(); break;
    case 'task-open': openTaskDetails(a); break;
    case 'task-edit': openTaskComposer(a); break;
    case 'task-save': {const t=Server.db.content.find(x=>x.id===a&&x.spaceId===sp.activeId);if(!t)break;const title=$('#cx-title')?.value.trim()||'';if(!title){toast('Add a task name first.','x');break;}const assigneeId=$('#cx-assignee')?.value||null,m=Server.db.members.find(x=>x.spaceId===sp.activeId&&x.userId===assigneeId&&x.approved!==false),p=assigneeId?personOf(assigneeId):null,status=$('#cx-status')?.value||'todo';if(!['todo','in_progress','in_review','completed'].includes(status))break;const ok=await saveTaskRow(t,{title,description:$('#cx-description')?.value.trim()||'',assigneeId:m?assigneeId:null,owner:m?(p.short||p.name||p.username||'Space member'):'Unassigned',due:$('#cx-due')?.value||'',priority:$('#cx-priority')?.value||'medium',status},'Task saved');if(ok){closeSheet();renderSpace();}break;}
    case 'task-detail-save': {const t=Server.db.content.find(x=>x.id===a&&x.spaceId===sp.activeId);if(!t)break;const status=$('#sp-task-detail-status')?.value||taskStatus(t);if(await saveTaskRow(t,{status},'Task status updated')){closeSheet();renderSpace();}break;}
    case 'task-subadd': openTaskTextPrompt(a,false); break;
    case 'task-comment': openTaskTextPrompt(a,true); break;
    case 'task-subadd-save': {const t=Server.db.content.find(x=>x.id===a&&x.spaceId===sp.activeId),title=$('#sp-task-text')?.value.trim()||'';if(!t||!title){toast('Enter a checklist item.','x');break;}const subs=Array.isArray(t.subtasks)?[...t.subtasks]:[];if(subs.length>=30){toast('A task can have up to 30 checklist items.','x');break;}if(await saveTaskRow(t,{subtasks:[...subs,{title,done:false}]},'Checklist item added')){closeSheet();openTaskDetails(a);}break;}
    case 'task-comment-save': {const t=Server.db.content.find(x=>x.id===a&&x.spaceId===sp.activeId),textValue=$('#sp-task-text')?.value.trim()||'';if(!t||!textValue){toast('Write an update first.','x');break;}const comments=Array.isArray(t.comments)?[...t.comments]:[];if(comments.length>=100){toast('This task has reached its update limit.','x');break;}const p=personOf(currentUser.id);if(await saveTaskRow(t,{comments:[...comments,{id:'tc_'+Date.now(),authorId:currentUser.id,authorName:p.short||p.name||p.username||'You',text:textValue,at:Date.now()}]},'Task update added')){closeSheet();openTaskDetails(a);}break;}
    case 'post': {
      const c = COMPOSERS[a];
      const payload = {};
      if(a==='task'){const title=$('#cx-title')?.value.trim()||'';if(!title){toast('Add a task name first.','x');return;}const assigneeId=$('#cx-assignee')?.value||null,m=Server.db.members.find(x=>x.spaceId===sp.activeId&&x.userId===assigneeId&&x.approved!==false),p=assigneeId?personOf(assigneeId):null;payload.title=title;payload.description=$('#cx-description')?.value.trim()||'';payload.assigneeId=m?assigneeId:null;payload.owner=m?(p.short||p.name||p.username||'Space member'):'Unassigned';payload.due=$('#cx-due')?.value||'';payload.priority=$('#cx-priority')?.value||'medium';payload.status=$('#cx-status')?.value||'todo';payload.done=payload.status==='completed';payload.subtasks=[];payload.comments=[];payload.createdBy=currentUser.id;}else c.fields.forEach(([k])=>{payload[k]=($('#cx-'+k)||{}).value||'';});
      if (!payload[c.fields[0][0]].trim()) { toast(a === 'loveletter' ? 'Give your letter a title first.' : 'Say something first', 'x'); return; }
      if (a === 'loveletter') {
        payload.title = payload.title.trim();
        payload.body = (payload.body || '').trim();
        if (!payload.body) { toast('Write a few words before sealing your letter.', 'x'); return; }
        if (payload.body.length > 4000) { toast('Your letter is too long.', 'x'); return; }
      }
      if (a === 'moment') payload.hue = Math.floor(Math.random() * 360);
      if (a === 'poll') {
        payload.options = [payload.option1, payload.option2, payload.option3].filter(Boolean).map(t => ({ t, votes: 0 }));
        payload.voted = null;
        payload.reacts = {};
      }
      if (a === 'event') { const d = new Date(); payload.day = String(d.getDate()); payload.month = d.toLocaleDateString([], { month: 'short' }); payload.title = payload.title; }
      const res = await Server.submit('space.post', { spaceId: sp.activeId, kind: c.kind, payload });
      if (!res.ok) { toast(res.error, 'x'); return; }
      const attachment = $('#cx-file')?.files?.[0];
      if (attachment) {
        const up = await Server.uploadSpaceFile(sp.activeId, attachment, c.kind, res.data.row.id, null);
        if (!up.ok) { toast(up.error, 'x'); return; }
      }
      closeSheet(); refreshSpace(); toast(attachment ? 'Saved with file' : 'Posted', 'check');
      break;
    }
    case 'react': await Server.submit('content.mutate', { id: a, op: 'react', key: b }); refreshSpace(); break;
    case 'vote': await Server.submit('content.mutate', { id: a, op: 'vote', index: +b }); refreshSpace(); break;
    case 'task': {
      const res = await Server.submit('content.mutate', { id: a, op: 'toggle' });
      if (!res.ok) { toast(res.error, 'x'); return; }
      renderSpace();
      break;
    }
    case 'listtoggle': await Server.submit('content.mutate', { id: a, op: 'listtoggle', index: +b }); refreshSpace(); break;
    case 'listadd': {
      openModal({
        title: 'Add to the list', lede: null,
        fields: `<div class="field"><label for="li-t">Item</label><input id="li-t" type="text" maxlength="60" /></div>`,
        actions: [{ t: 'Cancel', cls: 'btn--soft', a: 'close-modal' }, { t: 'Add', cls: 'btn--primary', a: 'noop' }]
      });
      $('#modal').querySelector('[data-action="noop"]').addEventListener('click', async () => {
        const t = $('#li-t').value.trim();
        if (!t) return closeModal();
        await Server.submit('content.mutate', { id: a, op: 'listadd', text: t });
        closeModal(); refreshSpace();
      });
      break;
    }
    case 'rsvp': {
      const row = Server.db.content.find(c => c.id === a);
      row.going = !row.going;
      refreshSpace();
      toast(row.going ? 'You are going' : 'Removed', 'check');
      break;
    }
    case 'sticker': {
      host.classList.remove('pop'); void host.offsetWidth; host.classList.add('pop');
      await Server.submit('space.post', { spaceId: sp.activeId, kind: 'sticker', payload: { emoji: STICKERS[+a] } });
      setTimeout(refreshSpace, 300);
      break;
    }
    case 'member': toast(`${nameOf(a)} — open their Tweaklr profile from Discover`, 'users'); break;
    case 'apply': toast('Interest registered with the space owner', 'check'); break;
    case 'ask-seller': toast('Request sent to the moderators', 'check'); break;
    case 'file-open': await Server.openSpaceFile(a); break;
    case 'record-video': await startSpaceMediaRecording('video'); break;
    case 'record-audio': await startSpaceMediaRecording('audio'); break;
    case 'loc': requestLocation(() => refreshSpace()); break;
    case 'leave': {
      const res = await Server.submit('space.leave', { spaceId: a });
      if (!res.ok) { toast(res.error, 'x'); break; }
      closeSheet(); sp.activeId = null; await loadSpacesFromDatabase(); renderSpaces(); popStack(); toast('Left Space', 'check'); break;
    }

    case 'role': {
      const s = spaceById(a);
      const m = Server.db.members.find(x => x.spaceId === a && x.userId === b);
      const roles = Server.ROLE_SETS[s.nature].filter(r => r !== 'owner');
      openSheet({
        title: `Role for ${nameOf(b)}`,
        sub: 'Enforced on the server. Hiding buttons is not a permission system.',
        body: roles.map(r => `<button class="opt" data-sp="setrole:${a}:${b}|${r}">
          <span class="ic">${icon('users')}</span>
          <span class="tx"><span class="t" style="display:block">${r}</span>
          <span class="s" style="display:block">${ROLE_COPY[r] || ''}</span></span>
          ${m.role === r ? icon('check') : `<span class="go">${icon('chev')}</span>`}</button>`).join('')
      });
      break;
    }
    case 'setrole': {
      const [userId, role] = b.split('|');
      const res = await Server.submit('space.member.role', { spaceId: a, userId, role });
      if (!res.ok) { toast(res.error, 'x'); return; }
      closeSheet(); renderSpace(); toast(`${nameOf(userId)} is now ${role}`, 'check');
      break;
    }

    /* marketplace */
    case 'mkcat': sp.marketTab = a; refreshSpace(); break;
    case 'product': openProduct(a); break;
    case 'buy': closeSheet(); setTimeout(() => openCheckout(a), 180); break;
    case 'bid': openBidSheet(a); break;
    case 'bid-submit': {
      const amount = Number($('#bid-amount')?.value || 0);
      const { data, error } = await supabaseClient.rpc('place_ming_space_product_bid', { p_product_id: a, p_amount: amount });
      if (error) { toast(error.message || 'Bid could not be placed.', 'x'); return; }
      Server.db.bids.unshift({ id:data.id, productId:data.product_id, bidderId:data.bidder_id, amount:Number(data.amount), createdAt:new Date(data.created_at).getTime() });
      closeSheet(); refreshSpace(); toast('Bid placed', 'check'); break;
    }
    case 'pay': {
      const idem = 'idem_' + a + '_' + Date.now();
      const created = await Server.submit('order.create', { productId: a, idempotencyKey: idem });
      if (!created.ok) { toast(created.error, 'x'); return; }
      const funded = await Server.submit('order.transition', { orderId: created.data.order.id, transition: 'fund' });
      closeSheet();
      if (!funded.ok) { toast(funded.error, 'x'); renderSpace(); return; }
      toast('Payment held in escrow', 'shield');
      setTimeout(() => openOrder(created.data.order.id), 240);
      break;
    }
    case 'order': openOrder(a); break;
    case 'trans': {
      if (b === 'dispute') { openDisputeSheet(a); break; }
      const res = await Server.submit('order.transition', { orderId: a, transition: b });
      if (!res.ok) { toast(res.error, 'x'); return; }
      renderOrder();
      const st = ORDER_STATES[res.data.order.status];
      toast(st.t, res.data.order.status === 'completed' ? 'check' : 'shield');
      break;
    }
    case 'dispute-submit': {
      const reason = $('#dp-reason').querySelector('[aria-pressed="true"]').dataset.pick;
      const res = await Server.submit('dispute.open', { orderId: a, reason, detail: $('#dp-detail').value.trim() });
      if (!res.ok) { toast(res.error, 'x'); return; }
      closeSheet(); renderOrder();
      toast('Dispute opened — funds stay held', 'shield');
      break;
    }
    case 'evidence': openEvidenceSheet(a); break;
    case 'evidence-submit': {
      const sel = $('#ev-kind').querySelector('[aria-pressed="true"]');
      const label = $('#ev-label').value.trim();
      if (!label) { toast('Describe the evidence', 'x'); return; }
      const res = await Server.submit('dispute.evidence', { disputeId: a, kind: sel.dataset.pick, label });
      if (!res.ok) { toast(res.error, 'x'); return; }
      closeSheet(); renderOrder(); toast('Evidence recorded', 'check');
      break;
    }
    case 'product-submit': {
      const price = parseFloat($('#pf-price').value);
      const res = await Server.submit('product.create', {
        spaceId: sp.activeId,
        title: $('#pf-title').value.trim(),
        price,
        description: $('#pf-desc').value.trim() || 'No description given.',
        condition: $('#pf-cond').querySelector('[aria-pressed="true"]').dataset.pick,
        category: $('#pf-cat').querySelector('[aria-pressed="true"]').dataset.pick,
        handover: $('#pf-hand').querySelector('[aria-pressed="true"]').dataset.pick,
        auction: { enabled: !!$('#pf-auction')?.checked, endsAt: $('#pf-auction-end')?.value ? new Date($('#pf-auction-end').value).toISOString() : null }
      });
      if (!res.ok) { toast(res.error, 'x'); return; }
      const files = Array.from($('#pf-files')?.files || []).concat(sp.pendingMedia || []);
      for (const file of files) {
        const kind = file.type.startsWith('image/') ? 'photo' : file.type.startsWith('video/') ? 'video' : 'audio';
        const up = await Server.uploadSpaceFile(sp.activeId, file, kind, null, res.data.row.id);
        if (!up.ok) { toast(up.error, 'x'); break; }
      }
      closeSheet(); refreshSpace(); toast(files.length ? 'Listing saved with media' : 'Listed', 'check');
      break;
    }
    case 'msg-seller': closeSheet(); setTimeout(() => openChat(a), 180); break;
    case 'wallet-blocked':
      openModal({
        title: a + ' is not available',
        lede: 'Moving real funds needs a custodial provider and the compliance work around it. Tweaklr will not fake a deposit address, a transaction hash or a confirmation. This stays disabled until that integration is real.',
        actions: [{ t: 'Understood', cls: 'btn--primary', a: 'close-modal' }]
      });
      break;
  }
});

const ROLE_COPY = {
  admin: 'Everything except deleting the Space',
  manager: 'Can moderate and assign work',
  moderator: 'Can moderate content and resolve disputes',
  seller: 'Can create listings',
  buyer: 'Can buy and open disputes',
  member: 'Can post and take part',
  guest: 'Read only'
};

/* silly mini-game */
document.addEventListener('pointerdown', e => {
  const btn = e.target.closest('#game-btn');
  if (!btn) return;
  const start = performance.now();
  const clock = $('#game-clock');
  const tick = () => {
    if (!btn.dataset.holding) return;
    clock.textContent = ((performance.now() - start) / 1000).toFixed(2);
    requestAnimationFrame(tick);
  };
  btn.dataset.holding = '1';
  tick();
  const stop = async () => {
    delete btn.dataset.holding;
    window.removeEventListener('pointerup', stop);
    const t = (performance.now() - start) / 1000;
    clock.textContent = t.toFixed(2);
    await Server.submit('space.post', { spaceId: sp.activeId, kind: 'score', payload: { score: t } });
    const off = Math.abs(t - 5);
    toast(off < 0.05 ? 'Suspiciously good.' : off < 0.3 ? 'Respectable.' : 'Terrible. Again.', 'sp-game');
    setTimeout(refreshSpace, 400);
  };
  window.addEventListener('pointerup', stop);
});

/* marketplace search */
document.addEventListener('input', e => {
  if (e.target.id !== 'mk-search') return;
  const q = e.target.value.toLowerCase();
  $$('#mk-grid .mk-prod').forEach(card => {
    const id = card.dataset.sp.split(':')[1];
    const p = Server.db.products.find(x => x.id === id);
    card.style.display = !q || (p.title + p.description + p.category).toLowerCase().includes(q) ? '' : 'none';
  });
});

/* ------------------------------------------------------------
   HOME RAIL — a small entry point on Tweaklr's Home screen
------------------------------------------------------------ */
(function mountHomeRail() {
  if (document.getElementById('home-spaces')) return;

  const anchor = document.getElementById('home-people');
  const homeScreen = document.querySelector('#screen-home .scroll, [data-tab="home"] .scroll');

  if (!anchor && !homeScreen) {
    console.warn('Tweaklr: Home Spaces rail could not find a Home container yet.');
    return;
  }

  const sec = document.createElement('div');
  sec.className = 'section';
  sec.id = 'home-spaces';

  if (anchor?.parentNode) {
    anchor.parentNode.insertBefore(sec, anchor.nextSibling);
  } else {
    homeScreen.appendChild(sec);
  }
})();

function renderHomeSpaces() {
  const host = document.getElementById('home-spaces');
  if (!host) return;
  const list = mySpaces();
  host.innerHTML = sectionHead('Your Spaces', null, { t: 'All', a: 'noop' }).replace('data-action="noop"', 'data-sp="spaces"') +
    `<div class="rail">
      ${list.map(s => {
        const n = NATURES[s.nature] || NATURES.friendly || { label: 'Space' };
        return `
        <button class="pcard" style="width:150px;padding:0;overflow:hidden" data-sp="open:${s.id}">
          <span style="display:block;height:58px;background:${coverFor(s)}"></span>
          <span style="display:block;padding:11px 12px 13px;text-align:left">
            <span class="name" style="margin:0;display:block">${esc(s.name)}</span>
            <span class="tag" style="display:block">${esc(n.label)} · ${Server.memberCount(s.id)}</span>
          </span>
        </button>`;
      }).join('')}
      <button class="pcard" style="width:120px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px" data-sp="create">
        <span class="new-space-glyph" aria-hidden="true">${icon('sp-grid')}</span>
        <span class="tag" style="white-space:normal">New Space</span>
      </button>
    </div>`;
}

/* ============================================================
   REAL SPACES ONLY
   No demo Spaces, members, posts, products, orders or fake balances
   are injected here. The Spaces UI renders only data that exists in
   the active backend/session.
============================================================ */
renderHomeSpaces();

function seedNewSpace(space) {
  /* Intentionally empty: new Spaces start with no fabricated content. */
  return space;
}





















/*=================================
   THEME.JS
=================================*/
/* ============================================================
   Tweaklr — theme toggle
   theme.js  ·  sun ⇄ moon, one control, reused everywhere it appears

   Priority for the resolved theme:
     explicit Tweaklr choice (localStorage) → system preference → light
   The inline snippet in <head> already applied the initial value to
   <html data-theme="..."> before paint; this file only wires the
   button(s) and orchestrates the transition from here on.
   ============================================================ */
(function () {
  const KEY = 'ming-theme';
  const EXPLICIT_KEY = 'ming-theme-explicit';
  const root = document.documentElement;
  const sweep = document.getElementById('theme-sweep');
  const toggles = () => Array.from(document.querySelectorAll('[data-theme-toggle]'));
  const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  function current() {
    return root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  function syncButtons() {
    const dark = current() === 'dark';
    toggles().forEach(btn => {
      btn.setAttribute('aria-pressed', String(dark));
      btn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
    });
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#100D0B' : '#F7F2EC');
  }

  function persist(theme) {
    try {
      localStorage.setItem(KEY, theme);
      localStorage.setItem(EXPLICIT_KEY, '1');
    } catch (e) {}
  }

  /* Sun → dusk → moon, or moon → dawn → sun. The sweep visually
     covers the moment the CSS variables actually flip, which is what
     makes an instant variable swap read as something continuous. */
  function transition(fromBtn) {
    const next = current() === 'dark' ? 'light' : 'dark';
    const rm = reduceMotion();
    const app = document.getElementById('app');

    if (fromBtn && app) {
      const r = fromBtn.getBoundingClientRect();
      const a = app.getBoundingClientRect();
      sweep.style.setProperty('--sweep-x', (r.left + r.width / 2 - a.left) + 'px');
      sweep.style.setProperty('--sweep-y', (r.top + r.height / 2 - a.top) + 'px');
    }

    sweep.classList.remove('to-dark', 'to-light', 'is-sweeping');
    toggles().forEach(b => b.classList.remove('is-pulsing'));

    if (!rm) {
      root.classList.add('theme-transitioning');
      sweep.classList.add(next === 'dark' ? 'to-dark' : 'to-light');
      // restart the animation even if one just ran
      void sweep.offsetWidth;
      sweep.classList.add('is-sweeping');
      toggles().forEach(b => { void b.offsetWidth; b.classList.add('is-pulsing'); });
    }

    // flip the variables while the sweep is at its most opaque, so the
    // swap itself is hidden rather than felt as a snap
    const flipDelay = rm ? 0 : 320;
    setTimeout(() => {
      root.setAttribute('data-theme', next);
      persist(next);
      syncButtons();
    }, flipDelay);

    const cleanupDelay = rm ? 60 : 900;
    setTimeout(() => {
      root.classList.remove('theme-transitioning');
      sweep.classList.remove('is-sweeping', 'to-dark', 'to-light');
      toggles().forEach(b => b.classList.remove('is-pulsing'));
    }, cleanupDelay);
  }

  toggles().forEach(btn => {
    btn.addEventListener('click', () => transition(btn));
  });

  // Live-follow the system only until the person makes an explicit choice.
  try {
    if (!localStorage.getItem(EXPLICIT_KEY)) {
      matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
        if (localStorage.getItem(EXPLICIT_KEY)) return;
        root.setAttribute('data-theme', e.matches ? 'dark' : 'light');
        syncButtons();
      });
    }
  } catch (e) {}

  syncButtons();
})();






}

/* ------------------------------------------------------------
   TWEAKLR AUTH — STRICT FORM VALIDATION + SUPABASE AUTH
------------------------------------------------------------ */

document.addEventListener('DOMContentLoaded', () => {
  const loginForm = document.getElementById('login-form');
  const signupForm = document.getElementById('signup-form');

  const showSignup = document.getElementById('show-signup');
  const showLogin = document.getElementById('show-login');

  /* ----------------------------------------------------------
     SECURITY HELPERS
  ---------------------------------------------------------- */

  const MAX_NAME_LENGTH = 60;
  const MAX_USERNAME_LENGTH = 30;
  const MAX_EMAIL_LENGTH = 254;
  const MIN_PASSWORD_LENGTH = 12;
  const MAX_PASSWORD_LENGTH = 128;
  /*
     Reject Unicode control characters, null bytes,
     zero-width characters and other invisible characters
     that should never be present in profile fields.
  */
  function containsUnsafeCharacters(value) {
    return /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/u.test(value);
  }

  /*
     Normalize user-controlled text without modifying passwords.
  */
  function normalizeText(value) {
    return value.normalize('NFKC').trim();
  }

  /*
     Username policy:
     - 3–30 characters
     - ASCII letters
     - numbers
     - underscore
     - hyphen
     - must begin/end with letter or number
  */
  function isValidUsername(username) {
    return /^[A-Za-z0-9](?:[A-Za-z0-9_-]{1,28}[A-Za-z0-9])?$/.test(
      username
    );
  }

  /*
     Reasonable email validation.
     Supabase remains the authoritative authentication layer.
  */
  function isValidEmail(email) {
    if (!email || email.length > MAX_EMAIL_LENGTH) {
      return false;
    }

    if (containsUnsafeCharacters(email)) {
      return false;
    }

    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function isValidDisplayName(name) {
    if (!name || name.length > MAX_NAME_LENGTH) {
      return false;
    }

    if (containsUnsafeCharacters(name)) {
      return false;
    }

    return true;
  }

  function isValidPassword(password) {
    /*
       Do NOT normalize, trim, lowercase, or otherwise modify
       passwords. Passwords must reach Supabase exactly as entered.
    */
    return (
      password.length >= MIN_PASSWORD_LENGTH &&
      password.length <= MAX_PASSWORD_LENGTH &&
      !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(password)
    );
  }

  function setMessage(element, text) {
    if (element) {
      element.textContent = text;
    }
  }

  function setButtonState(form, disabled) {
    const button = form?.querySelector('button[type="submit"]');

    if (!button) return;

    button.disabled = disabled;
    button.setAttribute('aria-busy', disabled ? 'true' : 'false');
  }

  /* ----------------------------------------------------------
     LOGIN ↔ SIGNUP SWITCHING
  ---------------------------------------------------------- */

  if (showSignup && loginForm && signupForm) {
    showSignup.addEventListener('click', (event) => {
      event.preventDefault();

      loginForm.hidden = true;
      signupForm.hidden = false;

      setMessage(
        document.getElementById('login-message'),
        ''
      );
    });
  }

  if (showLogin && loginForm && signupForm) {
    showLogin.addEventListener('click', (event) => {
      event.preventDefault();

      signupForm.hidden = true;
      loginForm.hidden = false;

      setMessage(
        document.getElementById('signup-message'),
        ''
      );
    });
  }

  /* ----------------------------------------------------------
     SIGN UP
  ---------------------------------------------------------- */

  if (signupForm) {
    signupForm.addEventListener('submit', async (event) => {
      event.preventDefault();

      const message = document.getElementById('signup-message');

      /*
         Prevent double submissions while Supabase is processing
         the request.
      */
      if (signupForm.dataset.submitting === 'true') {
        return;
      }

      signupForm.dataset.submitting = 'true';
      setButtonState(signupForm, true);

      try {
        const nameInput = document.getElementById('signup-name');
        const usernameInput = document.getElementById('signup-username');
        const emailInput = document.getElementById('signup-email');
        const passwordInput = document.getElementById('signup-password');

        if (
          !nameInput ||
          !usernameInput ||
          !emailInput ||
          !passwordInput
        ) {
          setMessage(
            message,
            'The signup form is temporarily unavailable.'
          );
          return;
        }

        const name = normalizeText(nameInput.value);
        const username = normalizeText(usernameInput.value);
        const email = normalizeText(emailInput.value);
        const password = passwordInput.value;

        /* ------------------------------------------------------
           STRICT VALIDATION
        ------------------------------------------------------ */

        if (!isValidDisplayName(name)) {
          setMessage(
            message,
            'Please enter a valid display name using 1–60 characters.'
          );
          return;
        }

        if (!isValidUsername(username)) {
          setMessage(
            message,
            'Username must be 3–30 characters and contain only letters, numbers, underscores, or hyphens.'
          );
          return;
        }

        if (!isValidEmail(email)) {
          setMessage(
            message,
            'Please enter a valid email address.'
          );
          return;
        }

        if (!isValidPassword(password)) {
          setMessage(
            message,
            'Password must be 12–128 characters long.'
          );
          return;
        }

        /*
           Keep username canonical.
           This prevents visually confusing variants such as
           "Connell", "CONNELL", and "connell".
        */
        const canonicalUsername = username.toLowerCase();

        /* ------------------------------------------------------
           SUPABASE AUTH
           Supabase handles the actual authentication request.
           No SQL is constructed from these values.
        ------------------------------------------------------ */

        const { data, error } =
          await supabaseClient.auth.signUp({
            email,
            password,
            options: {
              data: {
                display_name: name,
                username: canonicalUsername
              }
            }
          });

        if (error) {
          /*
             Do not expose raw backend errors unnecessarily.
             Do not log passwords, tokens, or authentication data.
          */
          console.error('Tweaklr signup failed:', error.message);

          setMessage(
            message,
            'We could not create your account. Please check your details and try again.'
          );

          return;
        }

        /*
           Do not log `data`.
           It can contain authentication-related information.
        */

        if (data?.user && !data?.session) {
          setMessage(
            message,
            'Account created. Check your email to confirm your account.'
          );
        } else {
          setMessage(
            message,
            'Account created successfully.'
          );
        }

      } catch (error) {
        console.error(
          'Tweaklr signup request failed.'
        );

        setMessage(
          message,
          'Something went wrong. Please try again.'
        );

      } finally {
        signupForm.dataset.submitting = 'false';
        setButtonState(signupForm, false);
      }
    });
  }

  /* ----------------------------------------------------------
     LOG IN
  ---------------------------------------------------------- */

  if (loginForm) {
    loginForm.addEventListener('submit', async (event) => {
      event.preventDefault();

      const message = document.getElementById('login-message');

      if (loginForm.dataset.submitting === 'true') {
        return;
      }

      loginForm.dataset.submitting = 'true';
      setButtonState(loginForm, true);

      try {
        const emailInput = document.getElementById('login-email');
        const passwordInput = document.getElementById('login-password');

        if (!emailInput || !passwordInput) {
          setMessage(
            message,
            'The login form is temporarily unavailable.'
          );
          return;
        }

        const email = normalizeText(emailInput.value);
        const password = passwordInput.value;

        /* ------------------------------------------------------
           LOGIN VALIDATION
        ------------------------------------------------------ */

        if (!isValidEmail(email)) {
          setMessage(
            message,
            'Please enter a valid email address.'
          );
          return;
        }

        if (
          password.length < 1 ||
          password.length > MAX_PASSWORD_LENGTH
        ) {
          setMessage(
            message,
            'Email or password is incorrect.'
          );
          return;
        }

        /* ------------------------------------------------------
           SUPABASE LOGIN
        ------------------------------------------------------ */
        
const { error } =
  await supabaseClient.auth.signInWithPassword({
    email,
    password
  });

if (error) {
  /*
     Generic authentication error helps avoid unnecessarily
     revealing whether a particular account exists.
  */
  console.error('Tweaklr login failed:', error.message);

  setMessage(
    message,
    'Email or password is incorrect.'
  );

  return;
}

setMessage(
  message,
  'Signed in successfully.'
);


/* ------------------------------------------------------
   OPEN TWEAKLR AFTER SUCCESSFUL LOGIN
------------------------------------------------------ */

window.location.href = 'app.html';


} catch (error) {
  console.error(
    'Tweaklr login request failed.'
  );

  setMessage(
    message,
    'Something went wrong. Please try again.'
  );

} finally {
  loginForm.dataset.submitting = 'false';
  setButtonState(loginForm, false);
}
});
}
});


/* ------------------------------------------------------------
   TWEAKLR AUTH SESSION
------------------------------------------------------------ */

(async function initMingAuthSession() {

  const isAppPage =
    window.location.pathname.endsWith('app.html');

  if (!isAppPage) {
    return;
  }

  const {
    data: { session },
    error
  } = await supabaseClient.auth.getSession();

  if (error || !session?.user) {
    console.log('Tweaklr: no authenticated session. Returning to login.');

    window.location.href = 'index.html';

    return;
  }

  console.log('Tweaklr: authenticated session detected.');

})();