/* 渲染器工厂：根据能力与 URL 参数选择后端。 */
/* 优先 WebGL2 / WebGL1（星系与地形 GPU 化），不可用或 ?renderer=2d 时回退 Canvas2D。 */

import { Canvas2DRenderer } from './canvas2d.js';
import { WebGLRenderer } from './webgl.js';

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

export function createRenderer(canvas, engine, opts = {}) {
  const forced2d = getRendererParam() === '2d' || opts.prefer2d;
  if (forced2d || !detectWebGL()) return new Canvas2DRenderer(canvas, engine);
  try {
    const r = new WebGLRenderer(canvas, engine);
    if (r.kind === 'webgl') return r;
    return r.detach2D();
  } catch (err) {
    return new Canvas2DRenderer(canvas, engine);
  }
}
