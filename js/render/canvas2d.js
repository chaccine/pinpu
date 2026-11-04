/* Canvas2D 渲染器：绘制背景与三种视觉模式（环形频谱/镜像波形/粒子星系）。 */
/* 只读音频引擎的分析帧 frame 与应用状态，不修改业务状态；粒子/星系/贴图等视觉资源自持。 */
/* 节拍到来时由外部调用 onBeat() 触发爆发粒子，保持与旧版一致的观感。 */

import { TAU, clamp, hueOf, isMobile, prefersReducedMotion } from '../utils.js';
import { getState } from '../state.js';
import { THEMES } from '../theme.js';
import { drawCoverRing, drawTerrain, drawGalaxy } from './modes-extra.js';

const HUE_SEGMENTS = 12;   // 色相分段合批
const SPRITE_COUNT = 18;   // 预渲染发光贴图数量

const wrapMod = (x, w) => ((x % w) + w) % w;

export const MODES_2D = [
  { key: 'ring', label: '环形频谱' },
  { key: 'mirror', label: '镜像波形' },
  { key: 'galaxy', label: '粒子星系' },
  { key: 'coverring', label: '律动封面环' },
  { key: 'terrain', label: '3D波形地形' },
];

export class Canvas2DRenderer {
  constructor(canvas, engine) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d', { alpha: false });
    this.engine = engine;
    this.kind = '2d';

    this.W = 0; this.H = 0; this.DPR = 1;
    this.bgGrad = null;
    this.isShort = false;
    this.stageCY = 0; this.stageUnit = 0;
    this.dockInfo = { bottom: 18, height: 150 };

    this.mode = 0;
    this.time = 0;
    this.theme = THEMES[0];
    this.coverImg = null;
    this.galaxy = [];
    this.sparks = [];
    this.sprites = [];
    this.maxSparks = 160;

    // 画质（阶段3自适应）：粒子/柱条/发光/DPR 上限的缩放因子
    this.quality = { dprCap: 2, particleScale: 1, glow: 1, barsScale: 1 };
    this.reducedMotion = prefersReducedMotion();
    this._gradCache = new Map();

    this.buildSprites();
  }

  get barsCount() { return this.engine.barsCount; }

  // 渐变缓存：键含色相/几何桶，避免每帧创建 CanvasGradient
  grad(key, make) {
    let g = this._gradCache.get(key);
    if (!g) {
      g = make();
      if (this._gradCache.size > 96) {
        this._gradCache.delete(this._gradCache.keys().next().value);
      }
      this._gradCache.set(key, g);
    }
    return g;
  }

  hueBucket(hue, step = 6) { return Math.round(hue / step) * step; }

  // 主题：保存插值后的主题对象；背景渐变随之重建
  setTheme(theme) {
    this.theme = theme || THEMES[0];
    if (this._gradCache) this._gradCache.clear();
    this.rebuildBgGradient();
  }

  // 封面图（律动封面环用）：传入 objectURL 或 null
  setCover(url) {
    if (!url) { this.coverImg = null; return; }
    const img = new Image();
    img.onload = () => { this.coverImg = img; };
    img.onerror = () => { this.coverImg = null; };
    img.src = url;
  }

  // 将引擎漂移色相映射进当前主题的色相窗口，得到绘制基准色相
  baseHue() {
    const t = this.theme;
    return t.hue + wrapMod(this.engine.frame.hueBase - 202, t.window);
  }

  rebuildBgGradient() {
    if (!this.W || !this.H) return;
    const g = this.g;
    const bg = this.theme.bg;
    this.bgGrad = g.createRadialGradient(this.W * 0.5, this.H * 0.42, 0, this.W * 0.5, this.H * 0.42, Math.max(this.W, this.H) * 0.85);
    this.bgGrad.addColorStop(0, bg[0]);
    this.bgGrad.addColorStop(0.55, bg[1]);
    this.bgGrad.addColorStop(1, bg[2]);
  }

  // ---- 资源构建 ----
  buildSprites() {
    this.sprites = [];
    const size = 64;
    for (let k = 0; k < SPRITE_COUNT; k++) {
      const c = document.createElement('canvas');
      c.width = size; c.height = size;
      const x = c.getContext('2d');
      const h = (k / SPRITE_COUNT) * 360;
      const grad = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, 'rgba(255,255,255,0.95)');
      grad.addColorStop(0.18, `hsla(${h}, 100%, 74%, 0.85)`);
      grad.addColorStop(0.48, `hsla(${h}, 100%, 58%, 0.22)`);
      grad.addColorStop(1, `hsla(${h}, 100%, 50%, 0)`);
      x.fillStyle = grad;
      x.fillRect(0, 0, size, size);
      this.sprites.push(c);
    }
  }

  spriteFor(hueValue) {
    return this.sprites[Math.floor((hueOf(hueValue) / 360) * SPRITE_COUNT) % SPRITE_COUNT];
  }

  buildGalaxy() {
    const area = this.W * this.H;
    const mobile = isMobile();
    let count = mobile ? 180 : clamp(Math.round(area / 2600), 220, 620);
    count = Math.round(count * this.quality.particleScale);
    if (this.reducedMotion) count = Math.round(count * 0.4);
    this.galaxy = [];
    for (let i = 0; i < count; i++) {
      const r = 0.12 + Math.pow(Math.random(), 0.65) * 0.88;
      const arm = i % 3;
      this.galaxy.push({
        a: arm * (TAU / 3) + r * 4.4 + (Math.random() - 0.5) * 0.85,
        r,
        spin: 0.8 + Math.random() * 0.3,
        size: 3.5 + Math.random() * 9,
        depth: Math.random(),
        phase: Math.random() * TAU,
        wob: 0.4 + Math.random() * 1.6,
        hueOff: Math.random() * 160 - 80,
      });
    }
  }

  // ---- 尺寸/布局 ----
  resize(w, h, dpr, dockInfo) {
    if (dockInfo) this.dockInfo = dockInfo;
    this.DPR = clamp(dpr || 1, 1, this.quality.dprCap);
    this.W = Math.max(1, w);
    this.H = Math.max(1, h);
    this._gradCache.clear();
    this.canvas.width = Math.round(this.W * this.DPR);
    this.canvas.height = Math.round(this.H * this.DPR);
    this.g.setTransform(this.DPR, 0, 0, this.DPR, 0, 0);

    const W = this.W, H = this.H;
    this.isShort = H < 560 || (W > H && H < 820);
    const dockTop = H - this.dockInfo.bottom - this.dockInfo.height;
    const avail = Math.max(120, dockTop - 54);

    if (this.isShort) {
      this.stageCY = 54 + avail * 0.5;
      this.stageUnit = Math.min(W * 0.9, (avail * 0.46) / 0.45);
    } else if (isMobile()) {
      this.stageCY = H * 0.44;
      this.stageUnit = Math.min(W, H);
    } else {
      this.stageCY = 54 + avail * 0.5;
      this.stageUnit = Math.min(W * 0.9, (avail * 0.46) / 0.45);
    }

    this.rebuildBgGradient();

    this.buildGalaxy();
    this.maxSparks = Math.round((isMobile() ? 80 : 160) * this.quality.particleScale
      * (this.reducedMotion ? 0.4 : 1));
  }

  centerY() { return this.stageCY; }

  // ---- 节拍爆发 ----
  onBeat(energy) {
    const count = Math.round(10 + energy * 24);
    this.spawnBurst(count);
  }

  spawnBurst(count) {
    const cx = this.W / 2;
    const cy = this.centerY();
    const hueBase = this.engine.frame.hueBase;
    const total = Math.min(count, this.maxSparks - this.sparks.length);
    const speedScale = isMobile() ? 0.8 : 1;
    for (let i = 0; i < total; i++) {
      const a = Math.random() * TAU;
      const speed = (70 + Math.random() * 400) * speedScale;
      this.sparks.push({
        x: cx, y: cy, px: cx, py: cy,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed * 0.9,
        life: 1,
        w: 1 + Math.random() * 1.6,
        hue: hueBase + Math.random() * 140 - 70,
      });
    }
    if (this.sparks.length > this.maxSparks) {
      this.sparks.splice(0, this.sparks.length - this.maxSparks);
    }
  }

  clearSparks() { this.sparks.length = 0; }

  updateSparks(dt) {
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.life -= dt * 1.15;
      if (s.life <= 0) { this.sparks.splice(i, 1); continue; }
      s.px = s.x; s.py = s.y;
      const drag = Math.exp(-dt * 2.4);
      s.vx *= drag; s.vy *= drag;
      s.x += s.vx * dt; s.y += s.vy * dt;
    }
  }

  setMode(i) { this.mode = clamp(i | 0, 0, MODES_2D.length - 1); }
  setQuality(q) { Object.assign(this.quality, q); }

  // ---- 主绘制 ----
  render(dt) {
    this.time += dt;
    this.updateSparks(dt);
    this.drawBackdrop();
    if (this.mode === 0) this.drawRing();
    else if (this.mode === 1) this.drawMirror();
    else if (this.mode === 2) drawGalaxy(this, dt);
    else if (this.mode === 3) drawCoverRing(this, dt);
    else drawTerrain(this, dt);
  }

  drawBackdrop() {
    const g = this.g, W = this.W, H = this.H;
    const hueBase = this.baseHue();
    const beatPulse = this.engine.frame.beatPulse;
    g.setTransform(this.DPR, 0, 0, this.DPR, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.fillStyle = this.bgGrad || '#04060b';
    g.fillRect(0, 0, W, H);

    const cx = W / 2, cy = this.centerY();
    const radius = Math.max(W, H) * 0.62;
    const hb = this.hueBucket(hueBase);
    const pb = Math.round(beatPulse * 4) / 4;
    const grad = this.grad(`bd:${hb}:${pb}:${W}:${H}`, () => {
      const gr = g.createRadialGradient(cx, cy, 0, cx, cy, radius);
      gr.addColorStop(0, `hsla(${hueOf(hb + 30)}, 88%, 48%, ${0.1 + pb * 0.09})`);
      gr.addColorStop(0.55, `hsla(${hueOf(hb + 90)}, 85%, 42%, 0.035)`);
      gr.addColorStop(1, 'hsla(0, 0%, 0%, 0)');
      return gr;
    });
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
  }

  addRoundRect(x, y, w, h, r) {
    const g = this.g;
    if (w <= 0 || h <= 0.6) return;
    const rr = Math.max(0, Math.min(r, w / 2, h / 2));
    g.moveTo(x + rr, y);
    g.lineTo(x + w - rr, y);
    g.quadraticCurveTo(x + w, y, x + w, y + rr);
    g.lineTo(x + w, y + h - rr);
    g.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    g.lineTo(x + rr, y + h);
    g.quadraticCurveTo(x, y + h, x, y + h - rr);
    g.lineTo(x, y + rr);
    g.quadraticCurveTo(x, y, x + rr, y);
    g.closePath();
  }

  drawRing() {
    const g = this.g;
    const { bars, beatPulse } = this.engine.frame;
    const hueBase = this.baseHue();
    const spread = this.theme.spread;
    const BARS = bars.length;
    const cx = this.W / 2, cy = this.centerY(), unit = this.stageUnit;
    const mobile = isMobile();
    const baseR = unit * (mobile ? 0.18 : 0.15) * (1 + beatPulse * 0.06);
    const maxLen = unit * 0.25;
    const rot = this.time * 0.09;
    const segBars = Math.ceil(BARS / HUE_SEGMENTS);

    g.save();
    g.translate(cx, cy);
    g.globalCompositeOperation = 'lighter';

    const hb = this.hueBucket(hueBase);
    const pb = Math.round(beatPulse * 4) / 4;
    const glow = this.grad(`rg:${hb}:${pb}:${Math.round(baseR * 10)}`, () => {
      const gr = g.createRadialGradient(0, 0, baseR * 0.15, 0, 0, baseR * 1.7);
      gr.addColorStop(0, `hsla(${hueOf(hb + 20)}, 95%, 66%, ${0.1 + pb * 0.1})`);
      gr.addColorStop(0.6, `hsla(${hueOf(hb + 70)}, 90%, 55%, 0.03)`);
      gr.addColorStop(1, 'hsla(0, 0%, 0%, 0)');
      return gr;
    });
    g.fillStyle = glow;
    g.beginPath();
    g.arc(0, 0, baseR * 1.7, 0, TAU);
    g.fill();

    g.strokeStyle = 'rgba(150, 205, 255, 0.055)';
    g.lineWidth = 1;
    g.beginPath();
    g.arc(0, 0, baseR + maxLen + unit * 0.02, 0, TAU);
    g.stroke();

    g.lineCap = 'round';
    const lineWidth = Math.max(2, ((TAU * baseR) / BARS) * 0.62);

    for (let seg = 0; seg < HUE_SEGMENTS; seg++) {
      const from = seg * segBars;
      const to = Math.min(BARS, from + segBars);
      if (from >= to) continue;
      g.beginPath();
      for (let i = from; i < to; i++) {
        const a = -Math.PI / 2 + ((i + 0.5) / BARS) * TAU + rot;
        const v = Math.pow(bars[i], 0.9);
        const r0 = baseR * (1 + beatPulse * 0.03);
        const r1 = r0 + 2 + v * maxLen;
        const ca = Math.cos(a), sa = Math.sin(a);
        g.moveTo(ca * r0, sa * r0);
        g.lineTo(ca * r1, sa * r1);
      }
      const h = hueOf(hueBase + seg * spread);
      const glowMul = this.quality.glow;
      g.strokeStyle = `hsla(${h}, 100%, 55%, ${0.055 * glowMul})`;
      g.lineWidth = lineWidth * 4.5;
      g.stroke();
      g.strokeStyle = `hsla(${h}, 100%, 58%, ${0.12 * glowMul})`;
      g.lineWidth = lineWidth * 2.6;
      g.stroke();
      g.strokeStyle = `hsla(${h}, 100%, 62%, ${0.3 * glowMul})`;
      g.lineWidth = lineWidth * 1.6;
      g.stroke();
      g.strokeStyle = `hsla(${h}, 95%, 63%, 0.92)`;
      g.lineWidth = lineWidth;
      g.stroke();
      g.strokeStyle = 'rgba(235, 248, 255, 0.34)';
      g.lineWidth = Math.max(1, lineWidth * 0.26);
      g.stroke();
    }

    const coreR = baseR * 0.34 * (1 + beatPulse * 0.22);
    const core = this.grad(`rc:${hb}:${pb}:${Math.round(coreR * 10)}`, () => {
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, coreR);
      gr.addColorStop(0, 'rgba(255, 255, 255, 0.96)');
      gr.addColorStop(0.45, `hsla(${hueOf(hb + 18)}, 100%, 72%, 0.9)`);
      gr.addColorStop(1, `hsla(${hueOf(hb + 40)}, 100%, 56%, 0.04)`);
      return gr;
    });
    g.beginPath();
    g.arc(0, 0, coreR, 0, TAU);
    g.fillStyle = core;
    g.fill();

    g.strokeStyle = `hsla(${hueOf(hueBase + 150)}, 100%, 70%, 0.12)`;
    g.lineWidth = 16;
    g.stroke();
    g.strokeStyle = `hsla(${hueOf(hueBase + 150)}, 100%, 78%, ${0.45 + beatPulse * 0.45})`;
    g.lineWidth = 1.5;
    g.stroke();

    g.beginPath();
    g.arc(0, 0, coreR * 1.9, rot * 2.4, rot * 2.4 + Math.PI * 1.1);
    g.strokeStyle = `hsla(${hueOf(hueBase + 300)}, 100%, 72%, 0.1)`;
    g.lineWidth = 7;
    g.stroke();
    g.strokeStyle = `hsla(${hueOf(hueBase + 300)}, 100%, 78%, 0.4)`;
    g.lineWidth = 1;
    g.stroke();

    g.restore();
  }

  drawMirror() {
    const g = this.g;
    const { bars, beatPulse, wave } = this.engine.frame;
    const hueBase = this.baseHue();
    const spread = this.theme.spread;
    const BARS = bars.length;
    const playing = getState().playing;
    const mobile = isMobile();
    const W = this.W, H = this.H;
    const midY = this.isShort || !mobile ? this.stageCY : H * 0.49;
    const usable = Math.min(W * 0.92, 1180);
    const x0 = (W - usable) / 2;
    const slot = usable / BARS;
    const barW = Math.max(2, slot * 0.52);
    const maxH = (this.isShort || !mobile
      ? Math.min(this.stageUnit * 0.4, 290)
      : Math.min(H * 0.32, 290)) * (1 + beatPulse * 0.035);
    const segBars = Math.ceil(BARS / HUE_SEGMENTS);

    g.save();
    g.globalCompositeOperation = 'lighter';

    const hb = this.hueBucket(hueBase);
    const lineGrad = this.grad(`ml:${hb}:${Math.round(x0)}:${Math.round(usable)}`, () => {
      const gr = g.createLinearGradient(x0, 0, x0 + usable, 0);
      gr.addColorStop(0, 'hsla(0, 0%, 100%, 0)');
      gr.addColorStop(0.2, `hsla(${hueOf(hb + 160)}, 95%, 68%, 0.45)`);
      gr.addColorStop(0.8, `hsla(${hueOf(hb + 220)}, 95%, 68%, 0.45)`);
      gr.addColorStop(1, 'hsla(0, 0%, 100%, 0)');
      return gr;
    });
    g.fillStyle = lineGrad;
    g.fillRect(x0, midY - 1.2, usable, 2.4);

    for (let seg = 0; seg < HUE_SEGMENTS; seg++) {
      const from = seg * segBars;
      const to = Math.min(BARS, from + segBars);
      if (from >= to) continue;
      const hcol = hueOf(hueBase + seg * spread);
      const hcolB = this.hueBucket(hcol);
      const glowMul = this.quality.glow;

      for (let layer = 0; layer < 2; layer++) {
        const grow = layer === 0 ? 6 : 3;
        g.beginPath();
        for (let i = from; i < to; i++) {
          const v = Math.pow(bars[i], 1.15);
          const h = 3 + v * maxH;
          const x = x0 + slot * (i + 0.5) - barW / 2;
          this.addRoundRect(x - grow, midY - 2 - h - grow, barW + grow * 2, h + grow, Math.min(4, barW / 2 + grow));
          this.addRoundRect(x - grow, midY + 2, barW + grow * 2, h + grow, Math.min(4, barW / 2 + grow));
        }
        g.fillStyle = layer === 0
          ? `hsla(${hcol}, 100%, 58%, ${0.07 * glowMul})`
          : `hsla(${hcol}, 100%, 62%, ${0.16 * glowMul})`;
        g.fill();
      }

      const grad = this.grad(`mg:${hcolB}:${Math.round(midY)}:${Math.round(maxH)}`, () => {
        const gr = g.createLinearGradient(0, midY - maxH, 0, midY + maxH);
        gr.addColorStop(0, `hsla(${hueOf(hcolB + 18)}, 100%, 62%, 0.55)`);
        gr.addColorStop(0.5, `hsla(${hcolB}, 98%, 66%, 0.95)`);
        gr.addColorStop(1, `hsla(${hueOf(hcolB + 18)}, 100%, 62%, 0.55)`);
        return gr;
      });
      g.beginPath();
      for (let i = from; i < to; i++) {
        const v = Math.pow(bars[i], 1.15);
        const h = 3 + v * maxH;
        const x = x0 + slot * (i + 0.5) - barW / 2;
        this.addRoundRect(x, midY - 2 - h, barW, h, Math.min(3, barW / 2));
        this.addRoundRect(x, midY + 2, barW, h, Math.min(3, barW / 2));
      }
      g.fillStyle = grad;
      g.fill();
    }

    g.beginPath();
    for (let i = 0; i < BARS; i++) {
      const v = Math.pow(bars[i], 1.15);
      const h = 3 + v * maxH;
      const x = x0 + slot * (i + 0.5) - barW / 2;
      g.moveTo(x, midY - 2 - h);
      g.lineTo(x + barW, midY - 2 - h);
      g.moveTo(x, midY + 2 + h);
      g.lineTo(x + barW, midY + 2 + h);
    }
    g.strokeStyle = 'rgba(200, 240, 255, 0.18)';
    g.lineWidth = 6;
    g.stroke();
    g.strokeStyle = 'rgba(240, 250, 255, 0.6)';
    g.lineWidth = 1.4;
    g.stroke();

    if (playing && wave) {
      const amp = maxH * 0.56;
      const step = usable / (wave.length - 1);
      g.beginPath();
      for (let i = 0; i < wave.length; i++) {
        const v = (wave[i] - 128) / 128;
        const x = x0 + i * step;
        const y = midY - v * amp;
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      const waveHue = hueOf(hueBase + 195);
      g.strokeStyle = `hsla(${waveHue}, 100%, 62%, 0.12)`;
      g.lineWidth = 8;
      g.stroke();
      g.strokeStyle = `hsla(${waveHue}, 100%, 68%, 0.28)`;
      g.lineWidth = 3.4;
      g.stroke();
      g.strokeStyle = `hsla(${waveHue}, 100%, 78%, 0.95)`;
      g.lineWidth = 1.8;
      g.stroke();

      g.beginPath();
      for (let i = 0; i < wave.length; i++) {
        const v = (wave[i] - 128) / 128;
        const x = x0 + i * step;
        const y = midY + v * amp;
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.globalAlpha = 0.35;
      g.strokeStyle = `hsla(${hueOf(hueBase + 280)}, 100%, 74%, 0.9)`;
      g.lineWidth = 1.2;
      g.stroke();
      g.globalAlpha = 1;
    } else {
      g.beginPath();
      g.moveTo(x0, midY);
      g.lineTo(x0 + usable, midY);
      g.strokeStyle = 'rgba(150, 205, 255, 0.22)';
      g.lineWidth = 1;
      g.stroke();
    }

    g.restore();
  }

  destroy() {
    this.galaxy.length = 0;
    this.sparks.length = 0;
    this.sprites.length = 0;
  }
}
