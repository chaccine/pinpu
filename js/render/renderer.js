/* 渲染器工厂：根据能力与 URL 参数选择后端。 */
/* 阶段1 仅提供 Canvas2D；阶段3 扩展为「WebGL2→WebGL1→Canvas2D」自动回退，?renderer=2d 可强制 2D。 */

import { Canvas2DRenderer } from './canvas2d.js';

export function getRendererParam() {
  try {
    const p = new URLSearchParams(window.location.search);
    return (p.get('renderer') || '').toLowerCase();
  } catch (err) {
    return '';
  }
}

// 探测 WebGL 能力（阶段3 使用）
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

export function createRenderer(canvas, engine) {
  // 阶段1：统一使用 Canvas2D，行为与旧版一致
  return new Canvas2DRenderer(canvas, engine);
}
