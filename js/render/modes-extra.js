/* 扩展视觉模式：模式3「律动封面环」与模式4「3D波形地形」。 */
/* 以函数形式接收渲染器实例 r，复用其 2d 上下文、分析帧、主题与发光贴图，避免 canvas2d 超行数。 */

import { TAU, clamp, hueOf } from '../utils.js';
import { getState } from '../state.js';

// ---- 模式3：律动封面环 ----
// 中心为旋转的专辑封面圆盘（无封面时为渐变唱片），外圈柱条随节拍放射。
export function drawCoverRing(r, dt) {
  const g = r.g;
  const f = r.engine.frame;
  const bars = f.bars;
  const beatPulse = f.beatPulse;
  const hueBase = r.baseHue();
  const spread = r.theme.spread;
  const cx = r.W / 2;
  const cy = r.centerY();
  const R = clamp(r.stageUnit * 0.20, 46, 150) * (1 + beatPulse * 0.05);

  // 外圈柱条
  const N = bars.length;
  g.lineCap = 'round';
  for (let i = 0; i < N; i++) {
    const t = i / N;
    const a = t * TAU - Math.PI / 2 + r.time * 0.12;
    const len = 6 + bars[i] * R * 1.15;
    const r0 = R + 10;
    const r1 = r0 + len;
    const hue = hueOf(hueBase + t * spread * 12);
    const x0 = cx + Math.cos(a) * r0, y0 = cy + Math.sin(a) * r0;
    const x1 = cx + Math.cos(a) * r1, y1 = cy + Math.sin(a) * r1;
    g.strokeStyle = `hsla(${hue}, 95%, 62%, 0.16)`;
    g.lineWidth = 7;
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    g.strokeStyle = `hsla(${hue}, 96%, 68%, 0.95)`;
    g.lineWidth = 2.6;
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
  }

  // 中心封面圆盘（旋转）
  g.save();
  g.translate(cx, cy);
  g.rotate(r.time * 0.5);
  g.beginPath();
  g.arc(0, 0, R, 0, TAU);
  g.clip();
  if (r.coverImg && r.coverImg.complete && r.coverImg.naturalWidth) {
    const d = R * 2;
    const iw = r.coverImg.naturalWidth, ih = r.coverImg.naturalHeight;
    const s = Math.max(d / iw, d / ih);
    g.drawImage(r.coverImg, -iw * s / 2, -ih * s / 2, iw * s, ih * s);
  } else {
    const hb = r.hueBucket(hueBase);
    const grad = r.grad(`cr:${hb}:${Math.round(R)}`, () => {
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, R);
      gr.addColorStop(0, `hsla(${hueOf(hb + 20)}, 90%, 60%, 0.9)`);
      gr.addColorStop(0.6, `hsla(${hueOf(hb + 60)}, 80%, 34%, 0.85)`);
      gr.addColorStop(1, `hsla(${hueOf(hb + 120)}, 70%, 16%, 0.9)`);
      return gr;
    });
    g.fillStyle = grad;
    g.fillRect(-R, -R, R * 2, R * 2);
  }
  // 唱片纹路与中心孔
  g.globalAlpha = 0.16;
  g.strokeStyle = '#000';
  for (let k = 1; k <= 4; k++) {
    g.beginPath(); g.arc(0, 0, R * (k / 5), 0, TAU); g.lineWidth = 1.4; g.stroke();
  }
  g.globalAlpha = 1;
  g.fillStyle = 'rgba(8,10,16,0.9)';
  g.beginPath(); g.arc(0, 0, R * 0.12, 0, TAU); g.fill();
  g.restore();

  // 无封面时在圆盘中央显示歌名首字（不随唱片旋转，保证可读）
  if (!(r.coverImg && r.coverImg.complete && r.coverImg.naturalWidth)) {
    const meta = getState().meta;
    const title = (meta && meta.title) || '';
    const ch = title ? Array.from(title)[0] : '♪';
    g.save();
    g.fillStyle = `hsla(${hueOf(hueBase + 40)}, 90%, 92%, 0.92)`;
    g.font = `600 ${Math.round(R * 0.5)}px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = `hsla(${hueOf(hueBase + 20)}, 100%, 70%, 0.8)`;
    g.shadowBlur = 18;
    g.fillText(ch, cx, cy + R * 0.02);
    g.restore();
  }

  // 圆盘描边光晕
  g.strokeStyle = `hsla(${hueOf(hueBase + 30)}, 95%, 72%, ${0.5 + beatPulse * 0.4})`;
  g.lineWidth = 2;
  g.beginPath(); g.arc(cx, cy, R + 2, 0, TAU); g.stroke();
}

// ---- 模式4：3D 波形地形 ----
// 环形缓冲区保存最近若干帧频谱，按透视网格从远到近绘制，形成向观察者滚动的 synthwave 地形。
function ensureTerrainState(r, rows, cols) {
  let st = r.terrainState;
  if (!st || st.rows !== rows || st.cols !== cols) {
    st = {
      rows, cols,
      buf: new Float32Array(rows * cols),
      pos: new Float32Array(rows * cols * 2),
      idx: 0, acc: 0,
    };
    r.terrainState = st;
  }
  return st;
}

export function drawTerrain(r, dt) {
  const g = r.g;
  const f = r.engine.frame;
  const bars = f.bars;
  const beatPulse = f.beatPulse;
  const hueBase = r.baseHue();
  const spread = r.theme.spread;
  const W = r.W, H = r.H;
  const cx = W / 2;
  const horizon = r.centerY() - r.stageUnit * 0.16;
  const depthSpan = clamp(H - horizon - 40, 120, r.stageUnit * 0.62);

  const ROWS = r.isShort ? 16 : 22;
  const COLS = Math.min(bars.length, r.isShort ? 40 : 56);
  const st = ensureTerrainState(r, ROWS, COLS);
  const reduced = r.reducedMotion;

  // 采样当前频谱写入历史（约 20 帧/秒，降低滚动手感突兀）
  st.acc += dt;
  if (st.acc >= 0.045) {
    st.acc = 0;
    const base = st.idx * COLS;
    for (let c = 0; c < COLS; c++) {
      const bi = Math.min(bars.length - 1, Math.floor((c / COLS) * (bars.length - 1)));
      st.buf[base + c] = bars[bi];
    }
    st.idx = (st.idx + 1) % ROWS;
  }

  const camX = reduced ? 0 : Math.sin(r.time * 0.27) * W * 0.009;
  g.lineJoin = 'round';

  // 从最旧一行画到最新一行（远 → 近）
  for (let age = ROWS - 1; age >= 0; age--) {
    const rowIdx = ((st.idx - 1 - age) % ROWS + ROWS) % ROWS;
    const rowBase = rowIdx * COLS;
    const t = 1 - age / (ROWS - 1);       // 0 远，1 近
    const scale = 0.22 + t * 1.05;
    const halfW = (W * 0.46) * scale;
    const y0 = horizon + t * t * depthSpan;
    const lift = beatPulse * r.stageUnit * 0.015 * t * (reduced ? 0.3 : 1);
    const amp = r.stageUnit * 0.16 * (0.25 + t) * (1 + beatPulse * 0.35);
    const alpha = 0.08 + t * 0.72;
    const hue = hueOf(hueBase + (1 - t) * spread * 6);
    const rowX = cx + camX * (0.4 + t);
    const posBase = rowIdx * COLS * 2;

    g.beginPath();
    for (let c = 0; c < COLS; c++) {
      const u = c / (COLS - 1);
      const env = Math.sin(u * Math.PI);
      const v = st.buf[rowBase + c] * env;
      const x = rowX - halfW + u * halfW * 2;
      const y = y0 - v * amp - lift;
      st.pos[posBase + c * 2] = x;
      st.pos[posBase + c * 2 + 1] = y;
      if (c === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.strokeStyle = `hsla(${hue}, 92%, ${48 + t * 22}%, ${alpha})`;
    g.lineWidth = 1 + t * 2.2;
    g.stroke();

    // 近处行下方补一条更暗的投影线，增强纵深
    if (t > 0.55) {
      g.strokeStyle = `hsla(${hue}, 90%, 30%, ${(t - 0.55) * 0.35})`;
      g.lineWidth = 1;
      g.beginPath();
      for (let c = 0; c < COLS; c++) {
        const x = st.pos[posBase + c * 2];
        const y = st.pos[posBase + c * 2 + 1] + 6 * t;
        if (c === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
    }
  }

  // 纵向网格线（稀疏），把相邻行连起来增强透视
  const VSTEP = Math.max(4, Math.floor(COLS / 8));
  g.lineWidth = 1;
  for (let c = 0; c < COLS; c += VSTEP) {
    g.beginPath();
    let started = false;
    for (let age = ROWS - 1; age >= 0; age--) {
      const rowIdx = ((st.idx - 1 - age) % ROWS + ROWS) % ROWS;
      const u = c / (COLS - 1);
      const x = st.pos[rowIdx * COLS * 2 + c * 2];
      const y = st.pos[rowIdx * COLS * 2 + c * 2 + 1];
      if (!started) { g.moveTo(x, y); started = true; } else g.lineTo(x, y);
    }
    g.strokeStyle = `hsla(${hueOf(hueBase + spread * 3)}, 90%, 60%, 0.10)`;
    g.stroke();
  }

  // 地平线辉光
  drawTerrainGlow(r);
}

// 地平线辉光单独导出：WebGL 地形叠加时由 Canvas2D 承担氛围层
export function drawTerrainGlow(r) {
  const g = r.g;
  const f = r.engine.frame;
  const W = r.W;
  const horizon = r.centerY() - r.stageUnit * 0.16;
  const hb = r.hueBucket(r.baseHue() + 40);
  const pb = Math.round(f.beatPulse * 4) / 4;
  const glow = r.grad(`tg:${hb}:${pb}:${W}:${Math.round(horizon)}`, () => {
    const gr = g.createLinearGradient(0, horizon - 40, 0, horizon + 30);
    gr.addColorStop(0, `hsla(${hueOf(hb)}, 90%, 60%, 0)`);
    gr.addColorStop(0.7, `hsla(${hueOf(hb)}, 90%, 60%, ${0.10 + pb * 0.10})`);
    gr.addColorStop(1, `hsla(${hueOf(hb)}, 90%, 60%, 0)`);
    return gr;
  });
  g.fillStyle = glow;
  g.fillRect(0, horizon - 40, W, 70);
}

// ---- 模式2：粒子星系（WebGL 版复用背景骨架与火花）----
export function drawGalaxy(r, dt) {
  drawGalaxyScaffold(r);
  drawGalaxyParticles(r, dt);
  drawSparks(r);
}

// 背景骨架：轨道椭圆、内圈频谱、中心核
export function drawGalaxyScaffold(r) {
  const g = r.g;
  const { bars, beatPulse } = r.engine.frame;
  const hueBase = r.baseHue();
  const BARS = bars.length;
  const cx = r.W / 2, cy = r.centerY(), unit = r.stageUnit;
  const radius = unit * 0.46;
  const time = r.time;

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

  const coreR = unit * 0.046 * (1 + beatPulse * 0.5);
  const hb = r.hueBucket(hueBase);
  const pb = Math.round(beatPulse * 4) / 4;
  const core = r.grad(`gc:${hb}:${pb}:${Math.round(coreR * 30)}:${Math.round(cx)}:${Math.round(cy)}`, () => {
    const gr = g.createRadialGradient(cx, cy, 0, cx, cy, coreR * 3);
    gr.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    gr.addColorStop(0.25, `hsla(${hueOf(hb + 175)}, 100%, 72%, 0.85)`);
    gr.addColorStop(0.6, `hsla(${hueOf(hb + 210)}, 100%, 60%, 0.25)`);
    gr.addColorStop(1, 'hsla(0, 0%, 0%, 0)');
    return gr;
  });
  g.fillStyle = core;
  g.beginPath();
  g.arc(cx, cy, coreR * 3, 0, TAU);
  g.fill();

  g.fillStyle = 'rgba(255, 255, 255, 0.92)';
  g.beginPath();
  g.arc(cx, cy, coreR * 0.42, 0, TAU);
  g.fill();

  g.restore();
}

function drawGalaxyParticles(r, dt) {
  const g = r.g;
  const { beatPulse, energy } = r.engine.frame;
  const hueBase = r.baseHue();
  const cx = r.W / 2, cy = r.centerY(), unit = r.stageUnit;
  const radius = unit * 0.46;
  const rotSpeed = 0.1 + energy * 0.9;
  const time = r.time;

  g.save();
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < r.galaxy.length; i++) {
    const p = r.galaxy[i];
    p.a += dt * rotSpeed * (0.4 + p.spin * 0.9);
    const rr = p.r * radius * (1 + beatPulse * 0.05 * (0.5 + p.depth));
    const wob = Math.sin(time * p.wob + p.phase) * unit * 0.012;
    const x = cx + Math.cos(p.a) * rr + wob;
    const y = cy + Math.sin(p.a) * rr * 0.72 + wob * 0.6;
    const size = p.size * (1 + beatPulse * 0.4) * (0.7 + p.depth * 0.7);
    g.globalAlpha = 0.2 + p.depth * 0.42 + energy * 0.3;
    g.drawImage(r.spriteFor(hueBase + p.hueOff), x - size / 2, y - size / 2, size, size);
  }
  g.globalAlpha = 1;
  g.restore();
}

export function drawSparks(r) {
  const g = r.g;
  g.save();
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < r.sparks.length; i++) {
    const s = r.sparks[i];
    const alpha = clamp(s.life, 0, 1);
    g.strokeStyle = `hsla(${hueOf(s.hue)}, 100%, 70%, ${0.68 * alpha})`;
    g.lineWidth = s.w;
    g.beginPath();
    g.moveTo(s.px - s.vx * 0.022, s.py - s.vy * 0.022);
    g.lineTo(s.x, s.y);
    g.stroke();
    const size = 10 + 20 * s.life;
    g.globalAlpha = alpha * 0.85;
    g.drawImage(r.spriteFor(s.hue), s.x - size / 2, s.y - size / 2, size, size);
  }
  g.globalAlpha = 1;
  g.restore();
}
