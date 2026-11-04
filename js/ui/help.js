/* 快捷键帮助浮层：内容由 js/shortcuts.js 的同一份配置表生成。 */
/* ? / H 打开，Esc 或点击遮罩关闭；焦点进入浮层，关闭后归还触发按钮。 */

import { SHORTCUTS } from '../shortcuts.js';

export function initHelpPanel() {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'icon-btn';
  btn.id = 'btnHelp';
  btn.title = '快捷键帮助（?）';
  btn.setAttribute('aria-label', '打开快捷键帮助');
  btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.6 9.2a2.6 2.6 0 1 1 3.6 2.4c-.8.35-1.2.9-1.2 1.8"/><circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none"/></svg>';

  const panel = document.createElement('div');
  panel.className = 'help-panel ui';
  panel.id = 'helpPanel';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', '快捷键帮助');

  const rows = SHORTCUTS.map((s) => `<div class="help-row"><span class="help-keys">${s.keys}</span><span class="help-label">${s.label}</span></div>`).join('');
  panel.innerHTML =
    '<div class="help-card" role="document">'
    + '<div class="help-head"><strong>快捷键帮助</strong>'
    + '<button type="button" class="pl-tool" id="helpClose" aria-label="关闭快捷键帮助">×</button></div>'
    + `<div class="help-grid">${rows}</div>`
    + '<p class="help-tip">输入框聚焦时快捷键不生效；Esc 关闭本浮层。</p>'
    + '</div>';

  document.body.appendChild(panel);
  const closeBtn = panel.querySelector('#helpClose');

  function open() {
    panel.hidden = false;
    requestAnimationFrame(() => panel.classList.add('show'));
    btn.setAttribute('aria-expanded', 'true');
    closeBtn.focus({ preventScroll: true });
  }

  function close() {
    panel.classList.remove('show');
    panel.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    if (document.activeElement === closeBtn) btn.focus({ preventScroll: true });
  }

  function toggle(force) {
    const show = force != null ? force : panel.hidden;
    if (show) open(); else close();
  }

  function isOpen() { return !panel.hidden; }

  btn.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
  closeBtn.addEventListener('click', close);
  panel.addEventListener('pointerdown', (e) => { if (e.target === panel) close(); });

  const actions = document.querySelector('.top-actions');
  const fs = document.querySelector('#btnFullscreen');
  if (actions) actions.insertBefore(btn, fs || actions.firstChild);

  return { toggle, open, close, isOpen, panel, btn };
}
