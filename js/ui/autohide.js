/* 控件自动淡出：播放时 3 秒无操作隐藏 UI 与光标；任意输入唤出。 */
/* 暂停、拖动进度、面板悬停/聚焦时不隐藏（悬停/聚焦抑制在阶段2接入）。 */

import { subscribe, getState } from '../state.js';

export function createAutoHide() {
  let idleTimer = 0;
  let seeking = false;
  let suppressed = false;   // 面板悬停/聚焦时为 true

  const body = document.body;

  function hidden() { return body.classList.contains('ui-hidden'); }

  function armIdle() {
    clearTimeout(idleTimer);
    if (!getState().playing) {
      body.classList.remove('ui-hidden');
      return;
    }
    idleTimer = setTimeout(() => {
      if (getState().playing && !seeking && !suppressed) body.classList.add('ui-hidden');
    }, 3200);
  }

  function wake() {
    body.classList.remove('ui-hidden');
    armIdle();
  }

  const events = ['pointermove', 'pointerdown', 'touchstart', 'wheel', 'keydown'];
  const bound = events.map((evt) => {
    const fn = () => wake();
    window.addEventListener(evt, fn, { passive: true });
    return [evt, fn];
  });

  // 播放状态变化时重新计时或立即唤出
  subscribe('playing', (playing) => {
    if (playing) armIdle(); else wake();
  });

  return {
    armIdle,
    wake,
    hidden,
    setSeeking(v) { seeking = !!v; if (v) wake(); else armIdle(); },
    setSuppressed(v) { suppressed = !!v; if (v) wake(); else armIdle(); },
    destroy() {
      clearTimeout(idleTimer);
      bound.forEach(([evt, fn]) => window.removeEventListener(evt, fn));
    },
  };
}
