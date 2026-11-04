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

  // 面板悬停/聚焦时抑制自动隐藏（事件委托，覆盖动态创建的浮层）
  const isUi = (el) => !!(el && el.closest && el.closest('.ui'));
  const onPointerOver = (e) => { if (isUi(e.target)) setSuppressed(true); };
  const onPointerOut = (e) => { if (!isUi(e.relatedTarget)) setSuppressed(false); };
  const onFocusIn = (e) => { if (isUi(e.target)) setSuppressed(true); };
  const onFocusOut = () => {
    setTimeout(() => { if (!isUi(document.activeElement)) setSuppressed(false); }, 0);
  };
  document.addEventListener('pointerover', onPointerOver, { passive: true });
  document.addEventListener('pointerout', onPointerOut, { passive: true });
  document.addEventListener('focusin', onFocusIn);
  document.addEventListener('focusout', onFocusOut);

  // 播放状态变化时重新计时或立即唤出
  subscribe('playing', (playing) => {
    if (playing) armIdle(); else wake();
  });

  function setSuppressed(v) {
    suppressed = !!v;
    if (suppressed) { clearTimeout(idleTimer); body.classList.remove('ui-hidden'); } else armIdle();
  }

  return {
    armIdle,
    wake,
    hidden,
    setSeeking(v) { seeking = !!v; if (v) wake(); else armIdle(); },
    setSuppressed,
    destroy() {
      clearTimeout(idleTimer);
      bound.forEach(([evt, fn]) => window.removeEventListener(evt, fn));
      document.removeEventListener('pointerover', onPointerOver);
      document.removeEventListener('pointerout', onPointerOut);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
    },
  };
}
