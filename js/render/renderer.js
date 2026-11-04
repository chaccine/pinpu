/* 渲染器工厂：根据能力与 URL 参数选择后端，并为所有模式切换套上快照淡入淡出。 */
/* 优先 WebGL2 / WebGL1（星系与地形 GPU 化），不可用或 ?renderer=2d 时回退 Canvas2D。 */

import { Canvas2DRenderer } from './canvas2d.js';
import { WebGLRenderer } from './webgl.js';
import { createModeTransition } from './crossfade.js';

export function getRendererParam() {
  try {
    const p = new URLSearchParams(window.location.search);
    return (p.get('renderer') || '').toLowerCase();
  } catch (err) {
    return '';
  }
}

// 探测 WebGL 能力（2 / 1 / 0）
export function detectWebGL() {
  try {
    const c = document.createElement('canvas');
    const gl2 = c.getContext('webgl2');
    if (gl2) return 2;
    const gl1 = c.getContext('webgl') || c.getContext('experimental-webgl');
    if (gl1) return 1;
  } catch (err) { /* ignore */ }
  return 0;
}

// 在真实渲染器外包裹一层模式过渡；其余接口原样转发，保持既有契约
function withTransition(inner, canvas) {
  const transition = createModeTransition(canvas, inner.glCanvas || null);
  const sources = () => (inner.glCanvas ? [canvas, inner.glCanvas] : [canvas]);
  let mode = inner.mode | 0;
  let rendered = false;

  return {
    get kind() { return inner.kind; },
    get level() { return inner.level || 0; },
    get mode() { return mode; },
    setTheme(theme) { inner.setTheme(theme); },
    setCover(url) { inner.setCover(url); },
    setQuality(q) { inner.setQuality(q); },
    onBeat(energy) { inner.onBeat(energy); },
    onKindChange(fn) { if (inner.onKindChange) inner.onKindChange(fn); },
    setMode(i) {
      const next = Math.max(0, Math.min(4, Math.round(Number(i) || 0)));
      if (next === mode) return;
      if (rendered) transition.capture(sources());
      mode = next;
      inner.setMode(next);
    },
    render(dt) {
      inner.render(dt);
      rendered = true;
      transition.update(dt);
    },
    resize(w, h, dpr, dockInfo) {
      transition.cancel();
      inner.resize(w, h, dpr, dockInfo);
    },
    destroy() {
      transition.destroy();
      if (inner.destroy) inner.destroy();
    },
  };
}

export function createRenderer(canvas, engine, opts = {}) {
  const forced2d = getRendererParam() === '2d' || opts.prefer2d;
  if (forced2d || !detectWebGL()) return withTransition(new Canvas2DRenderer(canvas, engine), canvas);
  try {
    const r = new WebGLRenderer(canvas, engine);
    if (r.kind === 'webgl') return withTransition(r, canvas);
    return withTransition(r.detach2D(), canvas);
  } catch (err) {
    return withTransition(new Canvas2DRenderer(canvas, engine), canvas);
  }
}
