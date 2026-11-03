/* 主逻辑：音频输入、频谱分析、节拍检测、三种视觉模式与界面控制 */
(() => {
  'use strict';

  // ===== 基础工具 =====
  const $ = (sel) => document.querySelector(sel);
  const TAU = Math.PI * 2;
  const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);
  const hueOf = (v) => ((v % 360) + 360) % 360;
  const isMobile = window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 720;
  const BARS = isMobile ? 56 : 80;      // 频谱柱条数量
  const HUE_SEGMENTS = 12;              // 色相分段数（合批绘制，降低开销）
  const SPRITE_COUNT = 18;              // 预渲染的发光粒子贴图数量

  // ===== DOM =====
  const canvas = $('#stage');
  const g = canvas.getContext('2d', { alpha: false });
  const ui = {
    play: $('#btnPlay'),
    demo: $('#btnDemo'),
    file: $('#btnFile'),
    mic: $('#btnMic'),
    fileInput: $('#fileInput'),
    fullscreen: $('#btnFullscreen'),
    progress: $('#progress'),
    timeNow: $('#timeNow'),
    timeTotal: $('#timeTotal'),
    sourceTag: $('#sourceTag'),
    modeBtns: Array.from(document.querySelectorAll('.mode')),
    toast: $('#toast'),
    dropVeil: $('#dropVeil'),
    hint: $('#hint'),
    dock: $('#dock'),
  };

  // ===== 运行状态 =====
  const state = {
    mode: 0,
    source: 'none',   // none | demo | file | mic
    playing: false,
    beats: 0,
    fps: 60,
  };

  const bars = new Float32Array(BARS);
  const barsTarget = new Float32Array(BARS);
  let bassAvg = 0;
  let beatEnergy = 0;
  let beatRatio = 0;
  let beatArmed = true;
  let lastBeat = -1;

  let audioCtx = null;
  let analyser = null;
  let masterGain = null;
  let freqBytes = null;
  let waveBytes = null;
  let bands = [];

  const audioEl = new Audio();
  audioEl.preload = 'auto';
  let mediaSource = null;
  let objectUrl = null;
  let demo = null;
  let micNode = null;
  let micStream = null;
  let sourceToken = 0;

  let W = 0;
  let H = 0;
  let DPR = 1;
  let bgGrad = null;
  let isShort = false;      // 横屏等低高度视口
  let stageCY = 0;          // 可视化中心
  let stageUnit = 0;        // 依据可用高度缩放的单位长度

  let galaxy = [];
  let sparks = [];
  let sprites = [];
  let maxSparks = 160;
  let beatPulse = 0;
  let hueBase = 202;
  let hueTarget = 202;
  let energyAvg = 0;
  let time = 0;
  let lastTs = 0;
  let fpsAcc = 0;
  let fpsFrames = 0;

  let idleTimer = 0;
  let seeking = false;
  let toastTimer = 0;
  let dragDepth = 0;

  // ===== 音频初始化 =====
  function ensureAudio() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) {
        toast('当前浏览器不支持 Web Audio');
        return null;
      }
      audioCtx = new AC();
      masterGain = audioCtx.createGain();
      masterGain.gain.value = 1;

      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.4;
      analyser.minDecibels = -90;
      analyser.maxDecibels = -22;

      masterGain.connect(analyser);
      analyser.connect(audioCtx.destination);

      freqBytes = new Uint8Array(analyser.frequencyBinCount);
      waveBytes = new Uint8Array(analyser.fftSize);
      computeBands();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  // 按对数频率划分柱条，低频更细腻
  function computeBands() {
    const binHz = audioCtx.sampleRate / analyser.fftSize;
    const binCount = analyser.frequencyBinCount;
    const minHz = 24;
    const maxHz = 16000;
    bands = [];
    for (let i = 0; i < BARS; i++) {
      const f0 = minHz * Math.pow(maxHz / minHz, i / BARS);
      const f1 = minHz * Math.pow(maxHz / minHz, (i + 1) / BARS);
      const a = clamp(Math.floor(f0 / binHz), 1, binCount - 1);
      const b = clamp(Math.ceil(f1 / binHz), a + 1, binCount);
      bands.push([a, b]);
    }
  }

  function readSpectrum() {
    for (let i = 0; i < BARS; i++) {
      const band = bands[i];
      let sum = 0;
      for (let j = band[0]; j < band[1]; j++) sum += freqBytes[j];
      let v = sum / ((band[1] - band[0]) * 255);
      v = Math.pow(v, 0.82) * (1 + (i / BARS) * 0.45);
      barsTarget[i] = clamp(v, 0, 1);
    }
  }

  function smoothBars(dt, active) {
    const attack = 1 - Math.exp(-dt * 17);
    const release = 1 - Math.exp(-dt * 7);
    for (let i = 0; i < BARS; i++) {
      const target = active ? barsTarget[i] : 0;
      bars[i] += (target - bars[i]) * (target > bars[i] ? attack : release);
    }
  }

  function averageBars() {
    let sum = 0;
    for (let i = 0; i < BARS; i++) sum += bars[i];
    return sum / BARS;
  }

  // ===== 节拍检测（低频能量 + 滑动平均 + 最小间隔） =====
  function detectBeat(now, dt) {
    // 低频段能量使用平方幅度，保留更多动态
    let sum = 0;
    for (let i = 1; i <= 12; i++) {
      const v = freqBytes[i] / 255;
      sum += v * v;
    }
    const energy = sum / 12;

    // 与时间常数约 0.8s 的滑动平均比较（先比较，再更新）
    const ratio = energy / (bassAvg + 0.0005);
    beatEnergy = energy;
    beatRatio = ratio;
    // 能量回落后才重新武装，避免持续低音被重复计数
    if (ratio < 1.06) beatArmed = true;
    if (beatArmed && ratio > 1.32 && energy > 0.02 && now - lastBeat > 0.3) {
      lastBeat = now;
      beatArmed = false;
      onBeat(energy);
    }

    const alpha = 1 - Math.exp(-dt / 0.6);
    bassAvg += (energy - bassAvg) * alpha;
  }

  function onBeat(energy) {
    state.beats++;
    beatPulse = 1;
    hueTarget += 26 + Math.random() * 20;
    spawnBurst(Math.round(10 + energy * 24));
  }

  function resetAnalysis() {
    bars.fill(0);
    barsTarget.fill(0);
    bassAvg = 0;
    beatEnergy = 0;
    beatRatio = 0;
    beatArmed = true;
    lastBeat = -1;
    beatPulse = 0;
    energyAvg = 0;
    state.beats = 0;
    if (waveBytes) waveBytes.fill(128);
    sparks.length = 0;
  }

  // ===== 画布尺寸与粒子 =====
  function resizeCanvas() {
    DPR = clamp(window.devicePixelRatio || 1, 1, 2); // 限制像素比，兼顾清晰度与移动端性能
    W = Math.max(1, window.innerWidth);
    H = Math.max(1, window.innerHeight);
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    g.setTransform(DPR, 0, 0, DPR, 0, 0);

    // 低高度视口按“顶栏到控制面板”的可用空间缩放
    isShort = H < 560 || (W > H && H < 820);
    if (isShort) {
      const bottomOffset = parseFloat(getComputedStyle(ui.dock).bottom) || 0;
      const dockTop = H - bottomOffset - ui.dock.offsetHeight;
      const avail = Math.max(120, dockTop - 54);
      stageCY = 54 + avail * 0.5;
      stageUnit = Math.min(W * 0.9, (avail * 0.46) / 0.45);
    } else {
      stageUnit = Math.min(W, H);
    }

    bgGrad = g.createRadialGradient(W * 0.5, H * 0.42, 0, W * 0.5, H * 0.42, Math.max(W, H) * 0.85);
    bgGrad.addColorStop(0, '#0a1222');
    bgGrad.addColorStop(0.55, '#05070e');
    bgGrad.addColorStop(1, '#03040a');

    buildGalaxy();
    maxSparks = isMobile ? 80 : 160;
  }

  function buildGalaxy() {
    const area = W * H;
    const count = isMobile ? 180 : clamp(Math.round(area / 2600), 220, 620);
    galaxy = [];
    for (let i = 0; i < count; i++) {
      const r = 0.12 + Math.pow(Math.random(), 0.65) * 0.88;
      const arm = i % 3;
      galaxy.push({
        // 三条旋臂：半径越大角度越偏移，形成旋涡感
        a: arm * (TAU / 3) + r * 4.4 + (Math.random() - 0.5) * 0.85,
        r: r,
        spin: 0.8 + Math.random() * 0.3,
        size: 3.5 + Math.random() * 9,
        depth: Math.random(),
        phase: Math.random() * TAU,
        wob: 0.4 + Math.random() * 1.6,
        hueOff: Math.random() * 160 - 80,
      });
    }
  }

  function buildSprites() {
    sprites = [];
    const size = 64;
    for (let k = 0; k < SPRITE_COUNT; k++) {
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      const x = c.getContext('2d');
      const h = (k / SPRITE_COUNT) * 360;
      const grad = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, 'rgba(255,255,255,0.95)');
      grad.addColorStop(0.18, `hsla(${h}, 100%, 74%, 0.85)`);
      grad.addColorStop(0.48, `hsla(${h}, 100%, 58%, 0.22)`);
      grad.addColorStop(1, `hsla(${h}, 100%, 50%, 0)`);
      x.fillStyle = grad;
      x.fillRect(0, 0, size, size);
      sprites.push(c);
    }
  }

  function spriteFor(hueValue) {
    return sprites[Math.floor((hueOf(hueValue) / 360) * SPRITE_COUNT) % SPRITE_COUNT];
  }

  function centerY() {
    return isShort ? stageCY : H * (isMobile ? 0.44 : 0.47);
  }

  function spawnBurst(count) {
    const cx = W / 2;
    const cy = centerY();
    const total = Math.min(count, maxSparks - sparks.length);
    for (let i = 0; i < total; i++) {
      const a = Math.random() * TAU;
      const speed = (70 + Math.random() * 400) * (isMobile ? 0.8 : 1);
      sparks.push({
        x: cx,
        y: cy,
        px: cx,
        py: cy,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed * 0.9,
        life: 1,
        w: 1 + Math.random() * 1.6,
        hue: hueBase + Math.random() * 140 - 70,
      });
    }
    if (sparks.length > maxSparks) {
      sparks.splice(0, sparks.length - maxSparks);
    }
  }

  // ===== 绘制：背景 =====
  function drawBackdrop() {
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.fillStyle = bgGrad || '#04060b';
    g.fillRect(0, 0, W, H);

    // 随节拍呼吸的中心辉光
    const cx = W / 2;
    const cy = centerY();
    const radius = Math.max(W, H) * 0.62;
    const grad = g.createRadialGradient(cx, cy, 0, cx, cy, radius);
    grad.addColorStop(0, `hsla(${hueOf(hueBase + 30)}, 88%, 48%, ${0.1 + beatPulse * 0.09})`);
    grad.addColorStop(0.55, `hsla(${hueOf(hueBase + 90)}, 85%, 42%, 0.035)`);
    grad.addColorStop(1, 'hsla(0, 0%, 0%, 0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
  }

  // ===== 绘制：模式一 · 环形频谱 =====
  function drawRing() {
    const cx = W / 2;
    const cy = centerY();
    const unit = isShort ? stageUnit : Math.min(W, H);
    const baseR = unit * (isMobile ? 0.18 : 0.15) * (1 + beatPulse * 0.06);
    const maxLen = unit * 0.25;
    const rot = time * 0.09;
    const segBars = Math.ceil(BARS / HUE_SEGMENTS);

    g.save();
    g.translate(cx, cy);
    g.globalCompositeOperation = 'lighter';

    // 中心光晕
    const glow = g.createRadialGradient(0, 0, baseR * 0.15, 0, 0, baseR * 1.7);
    glow.addColorStop(0, `hsla(${hueOf(hueBase + 20)}, 95%, 66%, ${0.1 + beatPulse * 0.1})`);
    glow.addColorStop(0.6, `hsla(${hueOf(hueBase + 70)}, 90%, 55%, 0.03)`);
    glow.addColorStop(1, 'hsla(0, 0%, 0%, 0)');
    g.fillStyle = glow;
    g.beginPath();
    g.arc(0, 0, baseR * 1.7, 0, TAU);
    g.fill();

    // 两道细圆环作参照
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
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        g.moveTo(ca * r0, sa * r0);
        g.lineTo(ca * r1, sa * r1);
      }

      const h = hueOf(hueBase + seg * 26);

      // 多层描边模拟发光，比 shadowBlur 更省性能
      g.strokeStyle = `hsla(${h}, 100%, 55%, 0.055)`;
      g.lineWidth = lineWidth * 4.5;
      g.stroke();

      g.strokeStyle = `hsla(${h}, 100%, 58%, 0.12)`;
      g.lineWidth = lineWidth * 2.6;
      g.stroke();

      g.strokeStyle = `hsla(${h}, 100%, 62%, 0.3)`;
      g.lineWidth = lineWidth * 1.6;
      g.stroke();

      g.strokeStyle = `hsla(${h}, 95%, 63%, 0.92)`;
      g.lineWidth = lineWidth;
      g.stroke();

      // 白色高光让柱条更利落
      g.strokeStyle = 'rgba(235, 248, 255, 0.34)';
      g.lineWidth = Math.max(1, lineWidth * 0.26);
      g.stroke();
    }

    // 中心圆核 + 节拍脉冲
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

    // 缓慢旋转的弧线
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

  // ===== 绘制：模式二 · 镜像柱状波形 =====
  function drawMirror() {
    const midY = isShort ? stageCY : H * 0.49;
    const usable = Math.min(W * 0.92, 1180);
    const x0 = (W - usable) / 2;
    const slot = usable / BARS;
    const barW = Math.max(2, slot * 0.52);
    const maxH = (isShort ? Math.min(stageUnit * 0.4, 290) : Math.min(H * 0.32, 290)) *
      (1 + beatPulse * 0.035);
    const segBars = Math.ceil(BARS / HUE_SEGMENTS);

    g.save();
    g.globalCompositeOperation = 'lighter';

    // 中线光带
    const lineGrad = g.createLinearGradient(x0, 0, x0 + usable, 0);
    lineGrad.addColorStop(0, 'hsla(0, 0%, 100%, 0)');
    lineGrad.addColorStop(0.2, `hsla(${hueOf(hueBase + 160)}, 95%, 68%, 0.45)`);
    lineGrad.addColorStop(0.8, `hsla(${hueOf(hueBase + 220)}, 95%, 68%, 0.45)`);
    lineGrad.addColorStop(1, 'hsla(0, 0%, 100%, 0)');
    g.fillStyle = lineGrad;
    g.fillRect(x0, midY - 1.2, usable, 2.4);

    // 对称柱条（按色相分段合批）
    for (let seg = 0; seg < HUE_SEGMENTS; seg++) {
      const from = seg * segBars;
      const to = Math.min(BARS, from + segBars);
      if (from >= to) continue;

      const hcol = hueOf(hueBase + seg * 26);

      // 外层柔光：逐层放大的柱条
      for (let layer = 0; layer < 2; layer++) {
        const grow = layer === 0 ? 6 : 3;
        g.beginPath();
        for (let i = from; i < to; i++) {
          const v = Math.pow(bars[i], 1.15);
          const h = 3 + v * maxH;
          const x = x0 + slot * (i + 0.5) - barW / 2;
          addRoundRect(x - grow, midY - 2 - h - grow, barW + grow * 2, h + grow,
            Math.min(4, barW / 2 + grow));
          addRoundRect(x - grow, midY + 2, barW + grow * 2, h + grow,
            Math.min(4, barW / 2 + grow));
        }
        g.fillStyle = layer === 0
          ? `hsla(${hcol}, 100%, 58%, 0.07)`
          : `hsla(${hcol}, 100%, 62%, 0.16)`;
        g.fill();
      }

      // 柱体：中间亮、两端稍暗，增强体积感
      const grad = g.createLinearGradient(0, midY - maxH, 0, midY + maxH);
      grad.addColorStop(0, `hsla(${hueOf(hcol + 18)}, 100%, 62%, 0.55)`);
      grad.addColorStop(0.5, `hsla(${hcol}, 98%, 66%, 0.95)`);
      grad.addColorStop(1, `hsla(${hueOf(hcol + 18)}, 100%, 62%, 0.55)`);
      g.beginPath();
      for (let i = from; i < to; i++) {
        const v = Math.pow(bars[i], 1.15);
        const h = 3 + v * maxH;
        const x = x0 + slot * (i + 0.5) - barW / 2;
        addRoundRect(x, midY - 2 - h, barW, h, Math.min(3, barW / 2));
        addRoundRect(x, midY + 2, barW, h, Math.min(3, barW / 2));
      }
      g.fillStyle = grad;
      g.fill();
    }

    // 柱条顶端高光
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

    // 上下对称的波形线
    if (state.playing && waveBytes) {
      const amp = maxH * 0.56;
      const step = usable / (waveBytes.length - 1);
      g.beginPath();
      for (let i = 0; i < waveBytes.length; i++) {
        const v = (waveBytes[i] - 128) / 128;
        const x = x0 + i * step;
        const y = midY - v * amp;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
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
      for (let i = 0; i < waveBytes.length; i++) {
        const v = (waveBytes[i] - 128) / 128;
        const x = x0 + i * step;
        const y = midY + v * amp;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
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

  // ===== 绘制：模式三 · 粒子星系 =====
  function drawGalaxy(dt) {
    const cx = W / 2;
    const cy = centerY();
    const unit = isShort ? stageUnit : Math.min(W, H);
    const radius = unit * 0.46;
    const rotSpeed = 0.1 + energyAvg * 0.9;

    g.save();
    g.globalCompositeOperation = 'lighter';

    // 星轨
    g.strokeStyle = 'rgba(120, 190, 255, 0.055)';
    g.lineWidth = 1;
    for (let k = 1; k <= 3; k++) {
      g.beginPath();
      g.ellipse(cx, cy, radius * 0.34 * k, radius * 0.34 * k * 0.7, 0, 0, TAU);
      g.stroke();
    }

    // 低频刻度环，呼应频谱
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

    // 星系粒子
    for (let i = 0; i < galaxy.length; i++) {
      const p = galaxy[i];
      p.a += dt * rotSpeed * (0.4 + p.spin * 0.9);
      const rr = p.r * radius * (1 + beatPulse * 0.05 * (0.5 + p.depth));
      const wob = Math.sin(time * p.wob + p.phase) * unit * 0.012;
      const x = cx + Math.cos(p.a) * rr + wob;
      const y = cy + Math.sin(p.a) * rr * 0.72 + wob * 0.6;
      const size = p.size * (1 + beatPulse * 0.4) * (0.7 + p.depth * 0.7);
      g.globalAlpha = 0.2 + p.depth * 0.42 + energyAvg * 0.3;
      g.drawImage(spriteFor(hueBase + p.hueOff), x - size / 2, y - size / 2, size, size);
    }
    g.globalAlpha = 1;

    // 核心
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

    // 节拍爆发粒子
    for (let i = 0; i < sparks.length; i++) {
      const s = sparks[i];
      const alpha = clamp(s.life, 0, 1);
      g.strokeStyle = `hsla(${hueOf(s.hue)}, 100%, 70%, ${0.68 * alpha})`;
      g.lineWidth = s.w;
      g.beginPath();
      g.moveTo(s.px - s.vx * 0.022, s.py - s.vy * 0.022);
      g.lineTo(s.x, s.y);
      g.stroke();

      const size = 10 + 20 * s.life;
      g.globalAlpha = alpha * 0.85;
      g.drawImage(spriteFor(s.hue), s.x - size / 2, s.y - size / 2, size, size);
    }
    g.globalAlpha = 1;

    g.restore();
  }

  // 爆发粒子独立更新：任何模式下都会自然消散
  function updateSparks(dt) {
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.life -= dt * 1.15;
      if (s.life <= 0) {
        sparks.splice(i, 1);
        continue;
      }
      s.px = s.x;
      s.py = s.y;
      const drag = Math.exp(-dt * 2.4);
      s.vx *= drag;
      s.vy *= drag;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
    }
  }

  // 圆角矩形路径（兼容不支持 roundRect 的浏览器）
  function addRoundRect(x, y, w, h, r) {
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

  // ===== 主循环 =====
  function frame(ts) {
    requestAnimationFrame(frame);

    if (!lastTs) lastTs = ts;
    let dt = (ts - lastTs) / 1000;
    lastTs = ts;
    dt = clamp(dt, 0.001, 0.05);
    time += dt;

    fpsAcc += dt;
    fpsFrames++;
    if (fpsAcc >= 0.5) {
      state.fps = Math.round(fpsFrames / fpsAcc);
      fpsAcc = 0;
      fpsFrames = 0;
    }

    const active = state.playing && !!analyser;
    if (active) {
      analyser.getByteFrequencyData(freqBytes);
      analyser.getByteTimeDomainData(waveBytes);
      readSpectrum();
      detectBeat(ts / 1000, dt);
    }

    smoothBars(dt, active);
    energyAvg += (averageBars() - energyAvg) * (1 - Math.exp(-dt * 6));

    beatPulse *= Math.exp(-dt * 4.2);
    if (beatPulse < 0.001) beatPulse = 0;
    updateSparks(dt);

    // 颜色缓慢漂移，并在节拍时整体跳变
    hueTarget += dt * 2;
    hueBase += (hueTarget - hueBase) * (1 - Math.exp(-dt * 3.2));

    drawBackdrop();
    if (state.mode === 0) drawRing();
    else if (state.mode === 1) drawMirror();
    else drawGalaxy(dt);

    updateTransport();
  }

  // ===== 界面：状态与提示 =====
  function toast(message) {
    ui.toast.textContent = message;
    ui.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 2300);
  }

  const SOURCE_NAMES = { none: '未连接', demo: '演示曲目', file: '本地音频', mic: '麦克风' };

  function updateSourceUI() {
    ui.sourceTag.textContent = SOURCE_NAMES[state.source] || '未连接';
    ui.demo.classList.toggle('is-active', state.source === 'demo');
    ui.file.classList.toggle('is-active', state.source === 'file');
    ui.mic.classList.toggle('is-active', state.source === 'mic');
    ui.timeTotal.classList.toggle('wide', state.source === 'demo');
    document.body.classList.toggle('started', state.source !== 'none');
  }

  function setPlaying(playing) {
    state.playing = playing;
    document.body.classList.toggle('is-playing', playing);
    ui.play.setAttribute('aria-label', playing ? '暂停' : '播放');
    if (playing) armIdle();
    else wake();
  }

  function setMode(index) {
    const i = Number(index);
    if (!Number.isFinite(i)) return;
    state.mode = clamp(Math.round(i), 0, 2);
    ui.modeBtns.forEach((btn) => {
      const active = Number(btn.dataset.mode) === state.mode;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  // ===== 界面：自动淡出 =====
  function armIdle() {
    clearTimeout(idleTimer);
    if (!state.playing) {
      document.body.classList.remove('ui-hidden');
      return;
    }
    idleTimer = setTimeout(() => {
      if (state.playing && !seeking) document.body.classList.add('ui-hidden');
    }, 3200);
  }

  function wake() {
    document.body.classList.remove('ui-hidden');
    armIdle();
  }

  ['pointermove', 'pointerdown', 'touchstart', 'wheel', 'keydown'].forEach((evt) => {
    window.addEventListener(evt, wake, { passive: true });
  });

  // ===== 界面：进度条 =====
  function formatTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) return '0:00';
    const total = Math.floor(sec);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  let paintedProgress = -1;

  function paintProgress(value) {
    const pct = clamp(value / 10, 0, 100);
    ui.progress.style.setProperty('--p', `${pct}%`);
  }

  function updateTransport() {
    if (state.source === 'file') {
      ui.progress.disabled = false;
      const dur = audioEl.duration;
      if (Number.isFinite(dur) && dur > 0) {
        if (!seeking) {
          const p = clamp(audioEl.currentTime / dur, 0, 1);
          const value = Math.round(p * 1000);
          if (value !== paintedProgress) {
            ui.progress.value = String(value);
            paintProgress(value);
            paintedProgress = value;
          }
        }
        setText(ui.timeNow, formatTime(audioEl.currentTime));
        setText(ui.timeTotal, formatTime(dur));
      }
    } else {
      ui.progress.disabled = true;
      if (paintedProgress !== 0) {
        ui.progress.value = '0';
        paintProgress(0);
        paintedProgress = 0;
      }
      if (state.source === 'demo') {
        setText(ui.timeNow, '循环');
        setText(ui.timeTotal, '120 BPM');
      } else if (state.source === 'mic') {
        setText(ui.timeNow, '实时');
        setText(ui.timeTotal, '—');
      } else {
        setText(ui.timeNow, '0:00');
        setText(ui.timeTotal, '0:00');
      }
    }
  }

  function setText(el, text) {
    if (el.textContent !== text) el.textContent = text;
  }

  function bindProgress() {
    const seek = () => {
      if (state.source !== 'file') return;
      const dur = audioEl.duration;
      if (!Number.isFinite(dur) || dur <= 0) return;
      const p = clamp(Number(ui.progress.value) / 1000, 0, 1);
      audioEl.currentTime = p * dur;
      paintProgress(p * 1000);
      paintedProgress = Number(ui.progress.value);
    };

    ui.progress.addEventListener('pointerdown', () => { seeking = true; });
    ui.progress.addEventListener('input', () => {
      seeking = true;
      seek();
    });
    ui.progress.addEventListener('change', () => {
      seek();
      seeking = false;
    });
    window.addEventListener('pointerup', () => {
      seeking = false;
      if (state.playing) armIdle();
    });
    ui.progress.addEventListener('blur', () => { seeking = false; });
    ui.progress.addEventListener('keyup', () => { seeking = false; });
  }

  // ===== 音频源 =====
  function stopSources() {
    sourceToken++;
    if (demo) {
      demo.stop();
      demo = null;
    }
    if (micStream) {
      micStream.getTracks().forEach((track) => track.stop());
      micStream = null;
    }
    if (micNode) {
      try { micNode.disconnect(); } catch (err) { /* ignore */ }
      micNode = null;
    }
    if (state.source === 'file') audioEl.pause();
    state.source = 'none';
    setPlaying(false);
    updateSourceUI();
  }

  async function startDemo() {
    const ac = ensureAudio();
    if (!ac || !window.PinpuDemo) {
      toast('音频初始化失败');
      return;
    }
    stopSources();
    const token = ++sourceToken;
    try {
      await ac.resume();
    } catch (err) { /* 某些浏览器会拒绝，仍然尝试播放 */ }
    if (token !== sourceToken) return;

    demo = new window.PinpuDemo.DemoTrack(ac, masterGain);
    demo.start();
    state.source = 'demo';
    resetAnalysis();
    updateSourceUI();
    setPlaying(true);
    hueBase = hueTarget = 202;
    toast('演示曲目 · 120 BPM');
  }

  async function loadFile(file) {
    if (!file) return;
    const looksAudio = (file.type && file.type.startsWith('audio/')) ||
      /\.(mp3|wav|ogg|oga|m4a|aac|flac|webm|opus|aif|aiff|wma)$/i.test(file.name || '');
    if (!looksAudio) {
      toast('请选择音频文件');
      return;
    }

    const ac = ensureAudio();
    if (!ac) return;

    stopSources();
    const token = ++sourceToken;
    try {
      await ac.resume();
    } catch (err) { /* ignore */ }

    if (token !== sourceToken) return;

    if (!mediaSource) {
      mediaSource = ac.createMediaElementSource(audioEl);
      mediaSource.connect(masterGain);
    }
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(file);
    audioEl.src = objectUrl;
    audioEl.load();

    state.source = 'file';
    resetAnalysis();
    updateSourceUI();
    setPlaying(false);

    let started = false;
    try {
      await audioEl.play();
      if (token !== sourceToken) {
        audioEl.pause();
        return;
      }
      started = true;
      setPlaying(true);
    } catch (err) {
      if (token !== sourceToken) return;
    }

    if (started) {
      toast(`已载入：${file.name.length > 28 ? file.name.slice(0, 26) + '…' : file.name}`);
    } else {
      toast('已载入音频，点击播放开始');
    }
  }

  async function startMic() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast('当前环境不支持麦克风输入');
      return;
    }
    const ac = ensureAudio();
    if (!ac) return;

    stopSources();
    const token = ++sourceToken;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      if (token !== sourceToken) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      await ac.resume().catch(() => {});
      micStream = stream;
      micNode = ac.createMediaStreamSource(stream);
      micNode.connect(masterGain);
      state.source = 'mic';
      resetAnalysis();
      updateSourceUI();
      setPlaying(true);
      toast('麦克风已接入，播放音乐试试');
    } catch (err) {
      if (token === sourceToken) toast('无法访问麦克风，请检查浏览器权限');
    }
  }

  async function togglePlay() {
    if (state.source === 'none') {
      toast('请先选择音频来源');
      return;
    }

    if (state.source === 'file') {
      if (!audioEl.paused) {
        audioEl.pause();
        setPlaying(false);
        return;
      }
      if (audioEl.ended) audioEl.currentTime = 0;
      try {
        await audioCtx.resume();
      } catch (err) { /* ignore */ }
      try {
        await audioEl.play();
        setPlaying(true);
      } catch (err) {
        toast('播放失败，请重试');
      }
      return;
    }

    if (!audioCtx) return;
    if (state.playing) {
      try { await audioCtx.suspend(); } catch (err) { /* ignore */ }
      setPlaying(false);
    } else {
      try { await audioCtx.resume(); } catch (err) { /* ignore */ }
      setPlaying(true);
    }
  }

  // ===== 全屏 =====
  function toggleFullscreen() {
    const doc = document;
    const el = document.documentElement;
    if (doc.fullscreenElement || doc.webkitFullscreenElement) {
      const exit = doc.exitFullscreen || doc.webkitExitFullscreen;
      if (exit) Promise.resolve(exit.call(doc)).catch(() => {});
      return;
    }
    const request = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!request) {
      toast('当前浏览器不支持全屏');
      return;
    }
    Promise.resolve(request.call(el)).catch(() => toast('无法进入全屏'));
  }

  // ===== 事件绑定 =====
  function bindUI() {
    ui.demo.addEventListener('click', () => { startDemo(); });

    ui.file.addEventListener('click', () => {
      ui.fileInput.value = '';
      ui.fileInput.click();
    });

    ui.fileInput.addEventListener('change', () => {
      const file = ui.fileInput.files && ui.fileInput.files[0];
      if (file) loadFile(file);
    });

    ui.mic.addEventListener('click', () => {
      if (state.source === 'mic') {
        stopSources();
        toast('已停止麦克风');
      } else {
        startMic();
      }
    });

    ui.play.addEventListener('click', () => { togglePlay(); });

    ui.modeBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        setMode(Number(btn.dataset.mode));
        wake();
      });
    });

    ui.fullscreen.addEventListener('click', toggleFullscreen);

    audioEl.addEventListener('ended', () => {
      setPlaying(false);
      if (Number.isFinite(audioEl.duration)) {
        paintProgress(1000);
        paintedProgress = 1000;
      }
    });

    bindProgress();

    // 键盘快捷键
    window.addEventListener('keydown', (e) => {
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === '1' || e.key === '2' || e.key === '3') {
        setMode(Number(e.key) - 1);
      } else if (e.key === 'f' || e.key === 'F') {
        toggleFullscreen();
      }
    });

    // 拖拽载入
    const hasFiles = (e) => {
      const dt = e.dataTransfer;
      if (!dt) return false;
      return Array.from(dt.types || []).includes('Files');
    };

    window.addEventListener('dragenter', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth++;
      ui.dropVeil.classList.add('show');
    });

    window.addEventListener('dragover', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });

    window.addEventListener('dragleave', () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) ui.dropVeil.classList.remove('show');
    });

    window.addEventListener('drop', (e) => {
      e.preventDefault();
      dragDepth = 0;
      ui.dropVeil.classList.remove('show');
      const files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length) loadFile(files[0]);
    });

    window.addEventListener('resize', resizeCanvas);
    window.addEventListener('orientationchange', () => setTimeout(resizeCanvas, 120));
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', resizeCanvas);
    }
    document.addEventListener('fullscreenchange', resizeCanvas);
    document.addEventListener('webkitfullscreenchange', resizeCanvas);

    setMode(0);
    updateSourceUI();
    paintProgress(0);
  }

  // ===== 调试接口 =====
  function exposeDebugApi() {
    const api = {
      get mode() { return state.mode; },
      get beats() { return state.beats; },
      get playing() { return state.playing; },
      get source() { return state.source; },
      get fps() { return state.fps; },
      get audioState() { return audioCtx ? audioCtx.state : 'none'; },
      get beatInfo() { return { energy: beatEnergy, avg: bassAvg, ratio: beatRatio }; },
      get levels() { return Array.from(bars); },
      get spectrum() { return freqBytes ? Array.from(freqBytes.slice(0, 24)) : []; },
      setMode: (i) => setMode(i),
    };
    try {
      Object.defineProperty(window, '__pinpu', { value: api, configurable: true });
    } catch (err) {
      window.__pinpu = api;
    }
  }

  // ===== 启动 =====
  buildSprites();
  resizeCanvas();
  bindUI();
  exposeDebugApi();
  requestAnimationFrame(frame);
})();
