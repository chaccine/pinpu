/* WebGL 渲染器：为「粒子星系」与「3D 波形地形」提供 GPU 版本。 */
/* 可见画布仍由 Canvas2D 绘制背景与静态骨架，WebGL 透明叠加层用点精灵/线段做加法混合， */
/* 两种后端共享主题与布局参数；上下文丢失时降级 2D，恢复后自动重建资源。 */

import { clamp, isMobile, prefersReducedMotion } from '../utils.js';
import { Canvas2DRenderer } from './canvas2d.js';
import { drawTerrainGlow, drawGalaxyScaffold, drawSparks } from './modes-extra.js';

const HSV_FN = `
vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}`;

const GALAXY_VS = `
attribute vec4 aOrbit; // angle0, radius, spin, depth
attribute vec4 aLook;  // size, hueOff, phase, wob
uniform float uTime;
uniform float uRotSpeed;
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
  float a = aOrbit.x + uTime * uRotSpeed * (0.4 + aOrbit.z * 0.9);
  float rr = aOrbit.y * (1.0 + uBeat * 0.05 * (0.5 + aOrbit.w));
  float wob = sin(uTime * aLook.w + aLook.z) * uWob;
  vec2 pos = uCenter + vec2(cos(a) * rr * uRadius.x + wob,
                            sin(a) * rr * uRadius.y + wob * 0.6);
  gl_Position = vec4(pos, 0.0, 1.0);
  float size = aLook.x * (1.0 + uBeat * 0.4) * (0.7 + aOrbit.w * 0.7);
  gl_PointSize = clamp(size * uPixelRatio, 1.0, 64.0);
  vAlpha = 0.2 + aOrbit.w * 0.42 + uEnergy * 0.3;
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

const TERRAIN_VS = `
attribute float aCol;
attribute float aAge;
attribute float aKind;
uniform sampler2D uHistory;
uniform float uRows;
uniform float uRowOffset;
uniform float uCenterX;
uniform float uCamX;
uniform float uHorizon;
uniform float uDepth;
uniform float uAmp;
uniform float uLift;
uniform float uBeat;
uniform float uHueBase;
uniform float uSpread;
uniform float uVertAlpha;
varying vec3 vColor;
varying float vAlpha;
${HSV_FN}
void main() {
  float t = 1.0 - aAge / (uRows - 1.0);
  float rowIdx = mod(uRowOffset - 1.0 - aAge + uRows, uRows);
  float v = texture2D(uHistory, vec2(aCol, (rowIdx + 0.5) / uRows)).r;
  float env = sin(aCol * 3.14159265);
  float scale = 0.22 + t * 1.05;
  float x = uCenterX + uCamX * (0.4 + t) + (aCol * 2.0 - 1.0) * 0.92 * scale;
  float y = uHorizon - t * t * uDepth
          + v * env * uAmp * (0.25 + t) * (1.0 + uBeat * 0.35)
          + uLift * t * uBeat;
  gl_Position = vec4(x, y, 0.0, 1.0);
  float hue;
  if (aKind < 0.5) {
    vAlpha = 0.08 + t * 0.72;
    hue = uHueBase + (1.0 - t) * uSpread * 6.0;
    vColor = hsv2rgb(vec3(fract(hue / 360.0), 0.92, 0.48 + t * 0.22));
  } else {
    vAlpha = uVertAlpha;
    hue = uHueBase + uSpread * 3.0;
    vColor = hsv2rgb(vec3(fract(hue / 360.0), 0.9, 0.6));
  }
  vColor *= vAlpha;
}`;

const TERRAIN_FS = `
precision mediump float;
varying vec3 vColor;
varying float vAlpha;
void main() {
  gl_FragColor = vec4(vColor, vAlpha);
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
      'uTime', 'uRotSpeed', 'uBeat', 'uEnergy', 'uCenter', 'uRadius',
      'uWob', 'uPixelRatio', 'uHueBase',
    ]);
    this.galaxyAttr = {
      orbit: gl.getAttribLocation(this.galaxyProg, 'aOrbit'),
      look: gl.getAttribLocation(this.galaxyProg, 'aLook'),
    };

    if (!this.terrainProg) return;
    const locs = this._uniforms(this.terrainProg, [
      'uHistory', 'uRows', 'uRowOffset', 'uCenterX', 'uCamX', 'uHorizon',
      'uDepth', 'uAmp', 'uLift', 'uBeat', 'uHueBase', 'uSpread', 'uVertAlpha',
    ]);
    this.terrainUni = locs;
    this.terrainAttr = {
      col: gl.getAttribLocation(this.terrainProg, 'aCol'),
      age: gl.getAttribLocation(this.terrainProg, 'aAge'),
      kind: gl.getAttribLocation(this.terrainProg, 'aKind'),
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
      data[o] = arm * (Math.PI * 2 / 3) + r * 4.4 + (Math.random() - 0.5) * 0.85;
      data[o + 1] = r;
      data[o + 2] = 0.8 + Math.random() * 0.3;
      data[o + 3] = Math.random();
      data[o + 4] = 3.5 + Math.random() * 9;
      data[o + 5] = Math.random() * 160 - 80;
      data[o + 6] = Math.random() * Math.PI * 2;
      data[o + 7] = 0.4 + Math.random() * 1.6;
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
    const rows = inner.isShort ? 16 : 22;
    const cols = Math.min(this.engine.barsCount, inner.isShort ? 40 : 56);
    const key = `${rows}x${cols}`;
    if (key === this._terrainKey) return;
    this._terrainKey = key;
    this._terrainRows = rows;
    this._terrainCols = cols;
    this._writeRow = 0;
    this._acc = 0;

    const hVerts = rows * (cols - 1) * 2;
    const step = Math.max(4, Math.floor(cols / 8));
    const vCols = Math.ceil(cols / step);
    const vVerts = vCols * (rows - 1) * 2;
    const verts = new Float32Array((hVerts + vVerts) * 3);
    let p = 0;
    for (let age = 0; age < rows; age++) {
      for (let c = 0; c < cols - 1; c++) {
        verts[p++] = c / (cols - 1); verts[p++] = age; verts[p++] = 0;
        verts[p++] = (c + 1) / (cols - 1); verts[p++] = age; verts[p++] = 0;
      }
    }
    for (let c = 0; c < cols; c += step) {
      for (let age = 0; age < rows - 1; age++) {
        verts[p++] = c / (cols - 1); verts[p++] = age; verts[p++] = 1;
        verts[p++] = c / (cols - 1); verts[p++] = age + 1; verts[p++] = 1;
      }
    }
    this._lineCount = (hVerts + vVerts);
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
    if (this._acc < 0.045) return;
    this._acc = 0;
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
    gl.uniform1f(u.uRotSpeed, 0.1 + f.energy * 0.9);
    gl.uniform1f(u.uBeat, f.beatPulse);
    gl.uniform1f(u.uEnergy, f.energy);
    gl.uniform2f(u.uCenter, 0, 1 - (2 * cy) / H);
    gl.uniform2f(u.uRadius, (2 * radius) / W, (1.44 * radius) / H);
    gl.uniform1f(u.uWob, (unit * 0.024) / W);
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
    const horizon = inner.centerY() - inner.stageUnit * 0.16;
    const depthSpan = clamp(H - horizon - 40, 120, inner.stageUnit * 0.62);
    const camX = this.reducedMotion ? 0 : Math.sin(inner.time * 0.27) * W * 0.009;

    gl.useProgram(this.terrainProg);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.terrainBuf);
    gl.enableVertexAttribArray(this.terrainAttr.col);
    gl.vertexAttribPointer(this.terrainAttr.col, 1, gl.FLOAT, false, 12, 0);
    gl.enableVertexAttribArray(this.terrainAttr.age);
    gl.vertexAttribPointer(this.terrainAttr.age, 1, gl.FLOAT, false, 12, 4);
    gl.enableVertexAttribArray(this.terrainAttr.kind);
    gl.vertexAttribPointer(this.terrainAttr.kind, 1, gl.FLOAT, false, 12, 8);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.historyTex);
    gl.uniform1i(u.uHistory, 0);
    gl.uniform1f(u.uRows, this._terrainRows);
    gl.uniform1f(u.uRowOffset, this._writeRow);
    gl.uniform1f(u.uCenterX, (2 * camX) / W);
    gl.uniform1f(u.uCamX, (2 * camX) / W);
    gl.uniform1f(u.uHorizon, 1 - (2 * horizon) / H);
    gl.uniform1f(u.uDepth, (2 * depthSpan) / H);
    gl.uniform1f(u.uAmp, (2 * inner.stageUnit * 0.16) / H);
    gl.uniform1f(u.uLift, (2 * inner.stageUnit * 0.015 * (this.reducedMotion ? 0.3 : 1)) / H);
    gl.uniform1f(u.uBeat, f.beatPulse);
    gl.uniform1f(u.uHueBase, inner.baseHue());
    gl.uniform1f(u.uSpread, inner.theme.spread);
    gl.uniform1f(u.uVertAlpha, 0.12);
    gl.drawArrays(gl.LINES, 0, this._lineCount);
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
