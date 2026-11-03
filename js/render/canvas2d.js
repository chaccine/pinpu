/* Canvas2D 渲染器：绘制背景与三种视觉模式（环形频谱/镜像波形/粒子星系）。 */
/* 只读音频引擎的分析帧 frame 与应用状态，不修改业务状态；粒子/星系/贴图等视觉资源自持。 */
/* 节拍到来时由外部调用 onBeat() 触发爆发粒子，保持与旧版一致的观感。 */

import { TAU, clamp, hueOf, isMobile } from '../utils.js';
import { getState } from '../state.js';

const HUE_SEGMENTS = 12;   // 色相分段合批
const SPRITE_COUNT = 18;   // 预渲染发光贴图数量

export const MODES_2D = [
  { key: 'ring', label: '环形频谱' },
  { key: 'mirror', label: '镜像波形' },
  { key: 'galaxy', label: '粒子星系' },
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
    this.galaxy = [];
    this.sparks = [];
    this.sprites = [];
    this.maxSparks = 160;

    // 画质（阶段3自适应）：粒子/柱条/发光/DPR 上限的缩放因子
    this.quality = { dprCap: 2, particleScale: 1, glow: 1, barsScale: 1 };

    this.buildSprites();
  }

  get barsCount() { return this.engine.barsCount; }

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

    this.bgGrad = this.g.createRadialGradient(W * 0.5, H * 0.42, 0, W * 0.5, H * 0.42, Math.max(W, H) * 0.85);
    this.bgGrad.addColorStop(0, '#0a1222');
    this.bgGrad.addColorStop(0.55, '#05070e');
    this.bgGrad.addColorStop(1, '#03040a');

    this.buildGalaxy();
    this.maxSparks = Math.round((isMobile() ? 80 : 160) * this.quality.particleScale);
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
    else this.drawGalaxy(dt);
  }

  drawBackdrop() {
    const g = this.g, W = this.W, H = this.H;
    const hueBase = this.engine.frame.hueBase;
    const beatPulse = this.engine.frame.beatPulse;
    g.setTransform(this.DPR, 0, 0, this.DPR, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.fillStyle = this.bgGrad || '#04060b';
    g.fillRect(0, 0, W, H);

    const cx = W / 2, cy = this.centerY();
    const radius = Math.max(W, H) * 0.62;
    const grad = g.createRadialGradient(cx, cy, 0, cx, cy, radius);
    grad.addColorStop(0, `hsla(${hueOf(hueBase + 30)}, 88%, 48%, ${0.1 + beatPulse * 0.09})`);
    grad.addColorStop(0.55, `hsla(${hueOf(hueBase + 90)}, 85%, 42%, 0.035)`);
    grad.addColorStop(1, 'hsla(0, 0%, 0%, 0)');
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
    const { bars, hueBase, beatPulse } = this.engine.frame;
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

    const glow = g.createRadialGradient(0, 0, baseR * 0.15, 0, 0, baseR * 1.7);
    glow.addColorStop(0, `hsla(${hueOf(hueBase + 20)}, 95%, 66%, ${0.1 + beatPulse * 0.1})`);
    glow.addColorStop(0.6, `hsla(${hueOf(hueBase + 70)}, 90%, 55%, 0.03)`);
    glow.addColorStop(1, 'hsla(0, 0%, 0%, 0)');
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
      const h = hueOf(hueBase + seg * 26);
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
    const core = g.createRadialGradient(0, 0, 0, 0, 0, coreR);
    core.addColorStop(0, 'rgba(255, 255, 255, 0.96)');
    core.addColorStop(0.45, `hsla(${hueOf(hueBase + 18)}, 100%, 72%, 0.9)`);
    core.addColorStop(1, `hsla(${hueOf(hueBase + 40)}, 100%, 56%, 0.04)`);
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
    const { bars, hueBase, beatPulse, wave } = this.engine.frame;
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

    const lineGrad = g.createLinearGradient(x0, 0, x0 + usable, 0);
    lineGrad.addColorStop(0, 'hsla(0, 0%, 100%, 0)');
    lineGrad.addColorStop(0.2, `hsla(${hueOf(hueBase + 160)}, 95%, 68%, 0.45)`);
    lineGrad.addColorStop(0.8, `hsla(${hueOf(hueBase + 220)}, 95%, 68%, 0.45)`);
    lineGrad.addColorStop(1, 'hsla(0, 0%, 100%, 0)');
    g.fillStyle = lineGrad;
    g.fillRect(x0, midY - 1.2, usable, 2.4);

    for (let seg = 0; seg < HUE_SEGMENTS; seg++) {
      const from = seg * segBars;
      const to = Math.min(BARS, from + segBars);
      if (from >= to) continue;
      const hcol = hueOf(hueBase + seg * 26);
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

      const grad = g.createLinearGradient(0, midY - maxH, 0, midY + maxH);
      grad.addColorStop(0, `hsla(${hueOf(hcol + 18)}, 100%, 62%, 0.55)`);
      grad.addColorStop(0.5, `hsla(${hcol}, 98%, 66%, 0.95)`);
      grad.addColorStop(1, `hsla(${hueOf(hcol + 18)}, 100%, 62%, 0.55)`);
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

  drawGalaxy(dt) {
    const g = this.g;
    const { bars, hueBase, beatPulse, energy } = this.engine.frame;
    const BARS = bars.length;
    const cx = this.W / 2, cy = this.centerY(), unit = this.stageUnit;
    const radius = unit * 0.46;
    const rotSpeed = 0.1 + energy * 0.9;
    const time = this.time;

    g.save();
    g.globalCompositeOperation = 'lighter';

    g.strokeStyle = 'rgba(120, 190, 255, 0.055)';
    g.lineWidth = 1;
    for (let k = 1; k <= 3; k++) {
      g.beginPath();
      g.ellipse(cx, cy, radius * 0.34 * k, radius * 0.34 * k * 0.7, 0, 0, TAU);
      g.stroke();
    }

    g.beginPath();
    for (let i = 0; i < BARS; i++) {
      const a = (i / BARS) * TAU + time * 0.04;
      const r0 = radius * 0.24;
      const r1 = r0 + 2 + bars[i] * radius * 0.12;
      g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    }
    g.strokeStyle = 'rgba(150, 220, 255, 0.15)';
    g.lineWidth = 1;
    g.stroke();

    for (let i = 0; i < this.galaxy.length; i++) {
      const p = this.galaxy[i];
      p.a += dt * rotSpeed * (0.4 + p.spin * 0.9);
      const rr = p.r * radius * (1 + beatPulse * 0.05 * (0.5 + p.depth));
      const wob = Math.sin(time * p.wob + p.phase) * unit * 0.012;
      const x = cx + Math.cos(p.a) * rr + wob;
      const y = cy + Math.sin(p.a) * rr * 0.72 + wob * 0.6;
      const size = p.size * (1 + beatPulse * 0.4) * (0.7 + p.depth * 0.7);
      g.globalAlpha = 0.2 + p.depth * 0.42 + energy * 0.3;
      g.drawImage(this.spriteFor(hueBase + p.hueOff), x - size / 2, y - size / 2, size, size);
    }
    g.globalAlpha = 1;

    const coreR = unit * 0.046 * (1 + beatPulse * 0.5);
    const core = g.createRadialGradient(cx, cy, 0, cx, cy, coreR * 3);
    core.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    core.addColorStop(0.25, `hsla(${hueOf(hueBase + 175)}, 100%, 72%, 0.85)`);
    core.addColorStop(0.6, `hsla(${hueOf(hueBase + 210)}, 100%, 60%, 0.25)`);
    core.addColorStop(1, 'hsla(0, 0%, 0%, 0)');
    g.fillStyle = core;
    g.beginPath();
    g.arc(cx, cy, coreR * 3, 0, TAU);
    g.fill();

    g.fillStyle = 'rgba(255, 255, 255, 0.92)';
    g.beginPath();
    g.arc(cx, cy, coreR * 0.42, 0, TAU);
    g.fill();

    for (let i = 0; i < this.sparks.length; i++) {
      const s = this.sparks[i];
      const alpha = clamp(s.life, 0, 1);
      g.strokeStyle = `hsla(${hueOf(s.hue)}, 100%, 70%, ${0.68 * alpha})`;
      g.lineWidth = s.w;
      g.beginPath();
      g.moveTo(s.px - s.vx * 0.022, s.py - s.vy * 0.022);
      g.lineTo(s.x, s.y);
      g.stroke();
      const size = 10 + 20 * s.life;
      g.globalAlpha = alpha * 0.85;
      g.drawImage(this.spriteFor(s.hue), s.x - size / 2, s.y - size / 2, size, size);
    }
    g.globalAlpha = 1;

    g.restore();
  }

  destroy() {
    this.galaxy.length = 0;
    this.sparks.length = 0;
    this.sprites.length = 0;
  }
}
