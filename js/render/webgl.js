/* WebGL 渲染器：为「粒子星系」与「3D 波形地形」提供 GPU 版本。 */
/* 可见画布仍由 Canvas2D 绘制背景与静态骨架，WebGL 透明叠加层用点精灵/线段做加法混合， */
/* 两种后端共享主题与布局参数；上下文丢失时降级 2D，恢复后自动重建资源。 */

import { clamp, isMobile, prefersReducedMotion } from '../utils.js';
import { Canvas2DRenderer } from './canvas2d.js';
import {
  drawTerrainGlow, drawGalaxyScaffold, drawSparks, advanceGalaxySpin,
  terrainDims, TERRAIN_STEP, TERRAIN_AMP,
} from './modes-extra.js';

const HSV_FN = `
vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}`;

const GALAXY_VS = `
attribute vec4 aOrbit; // angle0, radius, spin, depth
attribute vec4 aLook;  // size, hueOff, phase, wob
uniform float uTime;
uniform float uSpin;
uniform float uBeat;
uniform float uEnergy;
uniform vec2 uCenter;
uniform vec2 uRadius;
uniform float uWob;
uniform float uPixelRatio;
uniform float uHueBase;
varying vec3 vColor;
varying float vAlpha;
${HSV_FN}
void main() {
  float a = aOrbit.x + uSpin * (1.0 + 0.2 * (1.0 - aOrbit.y));
  float rr = aOrbit.y * (1.0 + uBeat * 0.025);
  float wob = sin(uTime * aLook.w + aLook.z) * uWob;
  vec2 pos = uCenter + vec2(cos(a) * rr * uRadius.x + wob,
                            sin(a) * rr * uRadius.y + wob * 0.6);
  gl_Position = vec4(pos, 0.0, 1.0);
  float size = aLook.x * (1.0 + uBeat * 0.12) * (0.7 + aOrbit.w * 0.7);
  gl_PointSize = clamp(size * uPixelRatio, 1.0, 64.0);
  vAlpha = min(1.0, 0.2 + aOrbit.w * 0.42 + uEnergy * 0.2 + uBeat * 0.22);
  vColor = hsv2rgb(vec3(fract((uHueBase + aLook.y) / 360.0), 0.72, 0.9));
}`;

const GALAXY_FS = `
precision mediump float;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 d = gl_PointCoord - vec2(0.5);
  float r = length(d) * 2.0;
  float glow = pow(max(0.0, 1.0 - r), 2.2);
  float core = smoothstep(0.42, 0.0, r);
  vec3 col = mix(vColor, vec3(1.0), core * 0.7);
  float a = vAlpha * glow;
  gl_FragColor = vec4(col * a, a);
}`;

// 地形：每条线段/山体都展开成三角形（WebGL 的 gl.lineWidth 基本固定为 1，无法加粗）。
// 顶点属性 aCols=(本端列, 另一端列)、aAge、aKind(0 亮线 1 外发光 2 山体 3 纵向网格)、aSide(线两侧 ±1 / 山体 0 顶 1 底)。
// 绘制顺序为从远到近逐行：山体(深色不透明，遮挡后方) → 外发光 → 亮线；使用预乘 alpha 的 over 混合。
const TERRAIN_VS = `
attribute vec2 aCols;
attribute float aAge;
attribute float aKind;
attribute float aSide;
uniform sampler2D uHistory;
uniform float uRows;
uniform float uTexCols;
uniform float uRowOffset;
uniform float uFrac;
uniform float uCenterX;
uniform float uCamX;
uniform float uHorizon;
uniform float uDepth;
uniform float uAmp;
uniform float uLift;
uniform float uBeat;
uniform float uHueBase;
uniform float uSpread;
uniform float uColsN;
uniform vec2 uPx;     // CSS 像素 → 裁剪空间
uniform float uLineW; // 亮线宽度（CSS 像素）
varying vec4 vColor;
${HSV_FN}
vec3 terrainPoint(float col, float age, out float h, out float t) {
  float ageF = age + uFrac;
  t = max(0.0, 1.0 - ageF / (uRows - 1.0));
  float rowIdx = mod(uRowOffset - 1.0 - age + uRows, uRows);
  float u = (col * (uColsN - 1.0) + 0.5) / uTexCols;
  float raw = texture2D(uHistory, vec2(u, (rowIdx + 0.5) / uRows)).r;
  h = pow(raw, 0.85) * sin(col * 3.14159265);
  float scale = 0.22 + t * 1.05;
  float x = uCenterX + uCamX * (0.4 + t) + (col * 2.0 - 1.0) * 0.92 * scale;
  float y0 = uHorizon - t * t * uDepth;
  float y = y0 + h * uAmp * (0.3 + t) * (1.0 + uBeat * 0.35) + uLift * t * uBeat;
  return vec3(x, y, y0);
}
void main() {
  float h, t, hb, tb;
  vec3 p = terrainPoint(aCols.x, aAge, h, t);
  vec2 pos = p.xy;
  float fade = min(1.0, t / 0.16);
  float rowHue = uHueBase + (1.0 - t) * uSpread * 6.0;
  vec4 col;
  if (aKind > 1.5 && aKind < 2.5) {
    float drop = uDepth * (2.0 * t + 0.12) / (uRows - 1.0) * 1.35;
    pos.y = mix(p.xy.y, p.z - drop, aSide);
    vec3 dark = hsv2rgb(vec3(fract((rowHue + uSpread * 3.0) / 360.0), 0.78, mix(0.20, 0.045, aSide)));
    float a = mix(0.9, 0.94, aSide) * fade;
    col = vec4(dark * a, a);
  } else {
    float otherAge = aAge;
    if (aKind > 3.5) otherAge = aAge - 1.0;
    else if (aKind > 2.5) otherAge = aAge + 1.0;
    vec3 q = terrainPoint(aCols.y, otherAge, hb, tb);
    vec2 d = (q.xy - p.xy) / uPx;
    float len = max(length(d), 0.0001);
    vec2 n = vec2(-d.y, d.x) / len;
    float hm = (h + hb) * 0.5;
    float bf = clamp(hm * 1.6, 0.0, 1.0);
    // 与 2D 的 hsl(h,100%,L) 等价：v=1, s=2(1-L)
    float L = clamp(0.56 + t * 0.08 + bf * 0.22, 0.5, 0.9);
    vec3 rgb = hsv2rgb(vec3(fract((rowHue + bf * uSpread * 4.0) / 360.0), 2.0 * (1.0 - L), 1.0));
    float w = uLineW * (1.8 + t * 3.8) / 3.8;
    float a;
    if (aKind < 0.5) {
      a = (0.3 + t * 0.7) * fade;
    } else if (aKind < 1.5) {
      w *= 3.0;
      a = 0.16 * fade;
    } else {
      w = 1.2;
      a = 0.14;
      rgb = hsv2rgb(vec3(fract((uHueBase + uSpread * 3.0) / 360.0), 0.9, 0.6));
    }
    pos += n * aSide * w * 0.5 * uPx;
    col = vec4(rgb * a, a);
  }
  gl_Position = vec4(pos, 0.0, 1.0);
  vColor = col;
}`;

const TERRAIN_FS = `
precision mediump float;
varying vec4 vColor;
void main() {
  gl_FragColor = vColor;
}`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  return gl.getShaderParameter(sh, gl.COMPILE_STATUS) ? sh : null;
}

function link(gl, vsSrc, fsSrc) {
  const vs = compile(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc);
  if (!vs || !fs) return null;
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return gl.getProgramParameter(p, gl.LINK_STATUS) ? p : null;
}

export class WebGLRenderer {
  constructor(canvas, engine) {
    this.canvas = canvas;
    this.engine = engine;
    this.inner = new Canvas2DRenderer(canvas, engine);
    this.mode = 0;
    this.time = 0;
    this.kind = '2d';
    this.lost = false;
    this.level = 0;
    this.quality = { dprCap: 2, particleScale: 1, glow: 1, barsScale: 1 };
    this.reducedMotion = prefersReducedMotion();
    this._kindListeners = [];
    this._galaxyCount = 0;
    this._terrainKey = '';
    this._writeRow = 0;
    this._acc = 0;
    this._rowBytes = null;

    this.glCanvas = document.createElement('canvas');
    this.glCanvas.className = 'stage-gl';
    this.glCanvas.setAttribute('aria-hidden', 'true');
    this.glCanvas.style.display = 'none';
    document.body.insertBefore(this.glCanvas, canvas.nextSibling);

    this.gl = null;
    this._createContext();
    if (this.gl) this._initResources();
    if (!this.gl || !this.galaxyProg || !this.terrainProg) {
      this.kind = '2d';
      this.glCanvas.remove();
      this.glCanvas = null;
      if (this.gl) {
        const lose = this.gl.getExtension('WEBGL_lose_context');
        if (lose) lose.loseContext();
        this.gl = null;
      }
    } else {
      this.kind = 'webgl';
    }
    this._bindLossEvents();
  }

  onKindChange(fn) { this._kindListeners.push(fn); }

  _setKind(kind) {
    if (this.kind === kind) return;
    this.kind = kind;
    this._syncVisibility();
    this._kindListeners.forEach((fn) => fn(kind));
  }

  _createContext() {
    const opts = {
      alpha: true, antialias: true, premultipliedAlpha: true,
      depth: false, stencil: false, powerPreference: 'high-performance',
      preserveDrawingBuffer: true,   // 模式切换时抓取上一帧做淡出快照
    };
    try {
      this.gl = this.glCanvas.getContext('webgl2', opts);
      if (this.gl) this.level = 2;
      else {
        this.gl = this.glCanvas.getContext('webgl', opts)
          || this.glCanvas.getContext('experimental-webgl', opts);
        if (this.gl) this.level = 1;
      }
    } catch (err) { this.gl = null; }
    if (this.gl) {
      const gl = this.gl;
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ONE, gl.ONE);
      gl.clearColor(0, 0, 0, 0);
    }
  }

  _bindLossEvents() {
    if (!this.glCanvas) return;
    this.glCanvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
      this._syncVisibility();
      this._setKind('2d');
    });
    this.glCanvas.addEventListener('webglcontextrestored', () => {
      this.lost = false;
      this._createContext();
      if (!this.gl) return;
      this._initResources();
      if (this.galaxyProg && this.terrainProg) {
        this.lost = false;
        this._setKind('webgl');
        this._buildGalaxy();
        this._buildTerrain();
      }
    });
  }

  _initResources() {
    const gl = this.gl;
    this.galaxyProg = link(gl, GALAXY_VS, GALAXY_FS);
    this.terrainProg = link(gl, TERRAIN_VS, TERRAIN_FS);
    this.terrainSupported = gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS) > 0;
    if (!this.galaxyProg) return;

    this.galaxyBuf = gl.createBuffer();
    this.galaxyUni = this._uniforms(this.galaxyProg, [
      'uTime', 'uSpin', 'uBeat', 'uEnergy', 'uCenter', 'uRadius',
      'uWob', 'uPixelRatio', 'uHueBase',
    ]);
    this.galaxyAttr = {
      orbit: gl.getAttribLocation(this.galaxyProg, 'aOrbit'),
      look: gl.getAttribLocation(this.galaxyProg, 'aLook'),
    };

    if (!this.terrainProg) return;
    const locs = this._uniforms(this.terrainProg, [
      'uHistory', 'uRows', 'uTexCols', 'uRowOffset', 'uFrac', 'uCenterX', 'uCamX', 'uHorizon',
      'uDepth', 'uAmp', 'uLift', 'uBeat', 'uHueBase', 'uSpread', 'uColsN', 'uPx', 'uLineW',
    ]);
    this.terrainUni = locs;
    this.terrainAttr = {
      cols: gl.getAttribLocation(this.terrainProg, 'aCols'),
      age: gl.getAttribLocation(this.terrainProg, 'aAge'),
      kind: gl.getAttribLocation(this.terrainProg, 'aKind'),
      side: gl.getAttribLocation(this.terrainProg, 'aSide'),
    };
    this.terrainBuf = gl.createBuffer();
    this.historyTex = gl.createTexture();
    this._terrainKey = '';
    gl.bindTexture(gl.TEXTURE_2D, this.historyTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  _uniforms(prog, names) {
    const out = {};
    names.forEach((n) => { out[n] = this.gl.getUniformLocation(prog, n); });
    return out;
  }

  // ---- 对外接口（与 Canvas2DRenderer 对齐）----
  setTheme(theme) { this.inner.setTheme(theme); }
  setCover(url) { this.inner.setCover(url); }
  setMode(i) {
    this.mode = clamp(i | 0, 0, 4);
    this.inner.setMode(this.mode);
    this._syncVisibility();
  }
  onBeat(energy) { this.inner.onBeat(energy); }

  setQuality(q) {
    Object.assign(this.quality, q);
    this.inner.setQuality(q);
    if (this.gl && this.galaxyProg) this._buildGalaxy();
  }

  get gpuTerrain() {
    return !!(this.gl && !this.lost && this.terrainSupported && this.terrainProg);
  }

  _gpuMode() {
    return !!(this.gl && !this.lost && (this.mode === 2
      || (this.mode === 4 && this.terrainSupported)));
  }

  _syncVisibility() {
    if (!this.glCanvas) return;
    const show = this._gpuMode();
    this.glCanvas.style.display = show ? 'block' : 'none';
  }

  resize(w, h, dpr, dockInfo) {
    this.inner.resize(w, h, dpr, dockInfo);
    if (!this.gl || !this.glCanvas) return;
    this.glCanvas.width = this.inner.canvas.width;
    this.glCanvas.height = this.inner.canvas.height;
    this.gl.viewport(0, 0, this.glCanvas.width, this.glCanvas.height);
    this._buildGalaxy();
    this._buildTerrain();
    this._syncVisibility();
  }

  // ---- 星系数据（位置在 GPU 顶点着色器里解算）----
  _buildGalaxy() {
    const gl = this.gl;
    if (!gl || !this.galaxyProg) return;
    const inner = this.inner;
    const area = inner.W * inner.H;
    const mobile = isMobile();
    let count = mobile ? 180 : clamp(Math.round(area / 2600), 220, 620);
    count = Math.round(count * this.quality.particleScale
      * (this.reducedMotion ? 0.4 : 1));
    count = clamp(count, 24, 2400);
    const data = new Float32Array(count * 8);
    for (let i = 0; i < count; i++) {
      const r = 0.12 + Math.pow(Math.random(), 0.65) * 0.88;
      const arm = i % 3;
      const o = i * 8;
      data[o] = arm * (Math.PI * 2 / 3) + r * 4.4 + (Math.random() - 0.5) * (0.22 + 0.3 * r);
      data[o + 1] = r;
      data[o + 2] = 1;
      data[o + 3] = Math.random();
      data[o + 4] = 3.5 + Math.random() * 8;
      data[o + 5] = (arm - 1) * 38 + (Math.random() - 0.5) * 16;   // 每条旋臂一个色调
      data[o + 6] = Math.random() * Math.PI * 2;
      data[o + 7] = 0.15 + Math.random() * 0.35;
    }
    this._galaxyCount = count;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.galaxyBuf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
  }

  // ---- 地形网格与历史频谱纹理 ----
  _buildTerrain() {
    const gl = this.gl;
    if (!gl || !this.terrainProg) return;
    const inner = this.inner;
    const { rows, cols } = terrainDims(inner.isShort, this.engine.barsCount);
    const key = `${rows}x${cols}`;
    if (key === this._terrainKey) return;
    this._terrainKey = key;
    this._terrainRows = rows;
    this._terrainCols = cols;
    this._writeRow = 0;
    this._acc = 0;

    // 每顶点 5 个 float：colA, colB, age, kind, side
    const step = Math.max(4, Math.floor(cols / 8));
    const out = [];
    const cu = (c) => c / (cols - 1);
    const quad = (cA, cB, age, kind) => {
      // 线条：A/B 两端各两侧，6 个顶点
      const V = (own, other, side) => out.push(cu(own), cu(other), age, kind, side);
      V(cA, cB, -1); V(cB, cA, -1); V(cA, cB, 1);
      V(cB, cA, -1); V(cB, cA, 1); V(cA, cB, 1);
    };
    const face = (cA, cB, age) => {
      const V = (own, side) => out.push(cu(own), cu(own), age, 2, side);
      V(cA, 0); V(cB, 0); V(cA, 1);
      V(cB, 0); V(cB, 1); V(cA, 1);
    };
    for (let age = rows - 1; age >= 0; age--) {   // 远 → 近
      for (let c = 0; c < cols - 1; c++) face(c, c + 1, age);
      for (let c = 0; c < cols - 1; c++) quad(c, c + 1, age, 1);
      for (let c = 0; c < cols - 1; c++) quad(c, c + 1, age, 0);
    }
    for (let c = 0; c < cols; c += step) {
      for (let age = 0; age < rows - 1; age++) {
        const A = cu(c);
        const V = (ag, kind, side) => out.push(A, A, ag, kind, side);
        V(age, 3, -1); V(age + 1, 4, -1); V(age, 3, 1);
        V(age + 1, 4, -1); V(age + 1, 4, 1); V(age, 3, 1);
      }
    }
    this._lineCount = out.length / 5;
    const verts = new Float32Array(out);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.terrainBuf);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);

    this._rowBytes = new Uint8Array(cols * 4);
    this._historyBytes = new Uint8Array(cols * rows * 4);
    gl.bindTexture(gl.TEXTURE_2D, this.historyTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, cols, rows, 0,
      gl.RGBA, gl.UNSIGNED_BYTE, this._historyBytes);
  }

  _sampleTerrain(dt) {
    const gl = this.gl;
    const rows = this._terrainRows;
    const cols = this._terrainCols;
    if (!rows || !cols || !this._rowBytes) return;
    this._acc += dt;
    if (this._acc < TERRAIN_STEP) return;
    this._acc -= TERRAIN_STEP;
    if (this._acc > TERRAIN_STEP) this._acc = 0;
    const bars = this.engine.frame.bars;
    const n = cols * 4;
    for (let c = 0; c < cols; c++) {
      const bi = Math.min(bars.length - 1, Math.floor((c / cols) * (bars.length - 1)));
      const v = Math.round(clamp(bars[bi], 0, 1) * 255);
      this._rowBytes[c * 4] = v;
      this._rowBytes[c * 4 + 1] = v;
      this._rowBytes[c * 4 + 2] = v;
      this._rowBytes[c * 4 + 3] = 255;
    }
    gl.bindTexture(gl.TEXTURE_2D, this.historyTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, this._writeRow, cols, 1,
      gl.RGBA, gl.UNSIGNED_BYTE, this._rowBytes.subarray(0, n));
    this._writeRow = (this._writeRow + 1) % rows;
  }

  // ---- 绘制 ----
  render(dt) {
    this.time += dt;
    if (!this._gpuMode()) {
      this.inner.render(dt);
      return;
    }
    const gl = this.gl;
    const inner = this.inner;
    inner.time += dt;
    inner.updateSparks(dt);
    inner.drawBackdrop();
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (this.mode === 2) {
      advanceGalaxySpin(inner, dt);
      drawGalaxyScaffold(inner);
      this._drawGalaxy();
      drawSparks(inner);
    } else {
      drawTerrainGlow(inner);
      this._drawTerrain(dt);
    }
  }

  _drawGalaxy() {
    const gl = this.gl;
    const inner = this.inner;
    const f = this.engine.frame;
    const prog = this.galaxyProg;
    const u = this.galaxyUni;
    const W = inner.W, H = inner.H;
    const cy = inner.centerY();
    const unit = inner.stageUnit;
    const radius = unit * 0.46;
    const dpr = this.glCanvas.width / Math.max(1, W);

    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.galaxyBuf);
    const stride = 8 * 4;
    gl.enableVertexAttribArray(this.galaxyAttr.orbit);
    gl.vertexAttribPointer(this.galaxyAttr.orbit, 4, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(this.galaxyAttr.look);
    gl.vertexAttribPointer(this.galaxyAttr.look, 4, gl.FLOAT, false, stride, 16);

    gl.uniform1f(u.uTime, inner.time);
    gl.uniform1f(u.uSpin, inner.galaxySpin || 0);
    gl.uniform1f(u.uBeat, f.beatPulse);
    gl.uniform1f(u.uEnergy, f.energy);
    gl.uniform2f(u.uCenter, 0, 1 - (2 * cy) / H);
    gl.uniform2f(u.uRadius, (2 * radius) / W, (1.44 * radius) / H);
    gl.uniform1f(u.uWob, (unit * 0.008) / W);
    gl.uniform1f(u.uPixelRatio, dpr);
    gl.uniform1f(u.uHueBase, inner.baseHue());
    gl.drawArrays(gl.POINTS, 0, this._galaxyCount);
  }

  _drawTerrain(dt) {
    const gl = this.gl;
    const inner = this.inner;
    const f = this.engine.frame;
    const u = this.terrainUni;
    const W = inner.W, H = inner.H;
    this._sampleTerrain(dt);
    const unit = inner.stageUnit;
    const horizon = inner.centerY() - unit * 0.16;
    const depthSpan = clamp(H - horizon - 40, 120, unit * 0.62);
    const camX = this.reducedMotion ? 0 : Math.sin(inner.time * 0.27) * W * 0.009;
    const frac = this.reducedMotion ? 0 : clamp(this._acc / TERRAIN_STEP, 0, 1);
    const lw = inner.isShort || isMobile() ? 0.8 : 1;

    gl.useProgram(this.terrainProg);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.terrainBuf);
    const A = this.terrainAttr, stride = 20;
    gl.enableVertexAttribArray(A.cols);
    gl.vertexAttribPointer(A.cols, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(A.age);
    gl.vertexAttribPointer(A.age, 1, gl.FLOAT, false, stride, 8);
    gl.enableVertexAttribArray(A.kind);
    gl.vertexAttribPointer(A.kind, 1, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(A.side);
    gl.vertexAttribPointer(A.side, 1, gl.FLOAT, false, stride, 16);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.historyTex);
    gl.uniform1i(u.uHistory, 0);
    gl.uniform1f(u.uRows, this._terrainRows);
    gl.uniform1f(u.uTexCols, this._terrainCols);
    gl.uniform1f(u.uColsN, this._terrainCols);
    gl.uniform1f(u.uRowOffset, this._writeRow);
    gl.uniform1f(u.uFrac, frac);
    gl.uniform1f(u.uCenterX, (2 * camX) / W);
    gl.uniform1f(u.uCamX, (2 * camX) / W);
    gl.uniform1f(u.uHorizon, 1 - (2 * horizon) / H);
    gl.uniform1f(u.uDepth, (2 * depthSpan) / H);
    gl.uniform1f(u.uAmp, (2 * unit * TERRAIN_AMP) / H);
    gl.uniform1f(u.uLift, (2 * unit * 0.015 * (this.reducedMotion ? 0.3 : 1)) / H);
    gl.uniform1f(u.uBeat, f.beatPulse);
    gl.uniform1f(u.uHueBase, inner.baseHue());
    gl.uniform1f(u.uSpread, inner.theme.spread);
    gl.uniform2f(u.uPx, 2 / W, 2 / H);
    gl.uniform1f(u.uLineW, 3.8 * lw);
    // 山体需要遮挡后方行：预乘 alpha 的 over 混合；画完恢复加法混合供星系使用
    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLES, 0, this._lineCount);
    gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ONE, gl.ONE);
  }

  detach2D() {
    if (this.glCanvas) {
      this.glCanvas.remove();
      this.glCanvas = null;
    }
    return this.inner;
  }

  destroy() {
    if (this.gl) {
      const lose = this.gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
      this.gl = null;
    }
    if (this.glCanvas) {
      this.glCanvas.remove();
      this.glCanvas = null;
    }
    this.inner.destroy();
  }
}
