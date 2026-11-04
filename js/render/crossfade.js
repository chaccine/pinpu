/* 模式切换平滑过渡：把旧画面抓成离屏快照覆盖在新画面上，再让快照 0.6s 淡出。 */
/* 双缓冲合成保证快速连续切换不叠加残留；快照画布尺寸固定复用，不随切换次数增长。 */

import { isMobile, prefersReducedMotion } from '../utils.js';

const DURATION = 0.6;
const FAST_DURATION = 0.3;

export function createModeTransition(stage, glCanvas) {
  const front = document.createElement('canvas');
  front.className = 'stage-fade';
  front.hidden = true;
  front.setAttribute('aria-hidden', 'true');
  const anchor = glCanvas && glCanvas.parentNode ? glCanvas : stage;
  anchor.parentNode.insertBefore(front, anchor.nextSibling);

  const back = document.createElement('canvas');
  const fctx = front.getContext('2d');
  const bctx = back.getContext('2d');
  let active = false;
  let left = 0;
  let duration = DURATION;
  let opacity = 1;

  function fit() {
    const w = Math.max(1, stage.width || 0);
    const h = Math.max(1, stage.height || 0);
    if (front.width !== w || front.height !== h) {
      front.width = w;
      front.height = h;
      back.width = w;
      back.height = h;
    }
  }

  function drawSources(ctx, sources) {
    for (const src of sources) {
      if (!src || src === front || !src.width || !src.height) continue;
      if (src === glCanvas && glCanvas.style.display === 'none') continue;
      ctx.drawImage(src, 0, 0, front.width, front.height);
    }
  }

  // 在 setMode 改模式之前调用：sources 为当前可见的 2D 画布（及 WebGL 叠加层）
  function capture(sources) {
    fit();
    if (active) {
      // 当前可见 = 当下画面 + 正在淡出的旧快照；整体冻结后再淡出，避免多层叠加
      bctx.globalAlpha = 1;
      bctx.clearRect(0, 0, back.width, back.height);
      drawSources(bctx, sources);
      bctx.globalAlpha = opacity;
      bctx.drawImage(front, 0, 0);
      bctx.globalAlpha = 1;
      fctx.clearRect(0, 0, front.width, front.height);
      fctx.drawImage(back, 0, 0);
    } else {
      fctx.clearRect(0, 0, front.width, front.height);
      drawSources(fctx, sources);
    }
    active = true;
    duration = isMobile() || prefersReducedMotion() ? FAST_DURATION : DURATION;
    left = duration;
    opacity = 1;
    front.hidden = false;
    front.style.opacity = '1';
  }

  function update(dt) {
    if (!active) return;
    left -= Math.max(0, Number(dt) || 0);
    if (left <= 0) {
      active = false;
      opacity = 0;
      front.hidden = true;
      front.style.opacity = '0';
      return;
    }
    opacity = left / duration;
    front.style.opacity = String(opacity);
  }

  function cancel() {
    active = false;
    opacity = 0;
    front.hidden = true;
    front.style.opacity = '0';
  }

  function destroy() {
    cancel();
    if (front.parentNode) front.parentNode.removeChild(front);
    front.width = 1;
    front.height = 1;
    back.width = 1;
    back.height = 1;
  }

  return { capture, update, cancel, destroy };
}
