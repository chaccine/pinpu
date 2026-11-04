/* 主题面板：顶栏调色板按钮 + 浮层色块列表，点击切换主题；当前主题高亮。 */
/* 面板 DOM 由本模块动态构建，避免污染 index.html；样式见 css/theme-panel.css 。 */

import { THEMES } from '../theme.js';
import { subscribe, getState } from '../state.js';

export function initThemePanel({ setTheme }) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'icon-btn';
  btn.id = 'btnTheme';
  btn.title = '配色主题（T）';
  btn.setAttribute('aria-label', '切换配色主题');
  btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18c1.4 0 2-.8 2-1.7 0-.8-.6-1.3-.6-2 0-1 .8-1.8 1.9-1.8H17a4.5 4.5 0 0 0 4.5-4.5C21.5 6.6 17.2 3 12 3z"/><circle cx="7.6" cy="10.2" r="1.1"/><circle cx="11" cy="7.4" r="1.1"/><circle cx="15" cy="8.2" r="1.1"/></svg>';

  const panel = document.createElement('div');
  panel.className = 'theme-panel ui';
  panel.id = 'themePanel';
  panel.setAttribute('role', 'menu');
  panel.setAttribute('aria-label', '配色主题');
  panel.hidden = true;

  THEMES.forEach((t) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'theme-item';
    item.dataset.theme = t.id;
    item.setAttribute('role', 'menuitem');
    item.setAttribute('aria-label', `主题 ${t.label}`);
    item.innerHTML =
      `<span class="theme-swatch" style="background:linear-gradient(135deg, ${t.accent}, ${t.accent2})"></span>` +
      `<span class="theme-name">${t.label}</span>`;
    item.addEventListener('click', () => { setTheme(t.id); sync(); });
    panel.appendChild(item);
  });

  function sync() {
    const cur = getState().theme;
    panel.querySelectorAll('.theme-item').forEach((el) => {
      el.classList.toggle('is-active', el.dataset.theme === cur);
    });
  }

  function toggle(force) {
    const show = force != null ? force : panel.hidden;
    panel.hidden = !show;
    btn.setAttribute('aria-expanded', show ? 'true' : 'false');
    if (show) sync();
  }

  btn.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
  document.addEventListener('pointerdown', (e) => {
    if (!panel.hidden && !panel.contains(e.target) && e.target !== btn && !btn.contains(e.target)) toggle(false);
  });

  const actions = document.querySelector('.top-actions');
  if (actions) actions.insertBefore(btn, actions.firstChild);
  document.body.appendChild(panel);

  subscribe('theme', sync);
  sync();

  return { toggle, sync, panel, btn };
}
