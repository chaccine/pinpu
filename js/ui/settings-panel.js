/* 高级设置面板：画质、频谱柱条、粒子密度、节拍灵敏度、平滑度、FPS 与渲染器偏好。 */
/* 齿轮按钮位于顶栏；改动通过 onPatch 实时生效并持久化，另提供恢复默认与 FPS 指示。 */

import { setText } from '../utils.js';

const LEVEL_LABELS = { low: '低', mid: '中', high: '高' };

function segmented(items, current, cls) {
  return '<div class="seg ' + cls + '">' + items.map((it) =>
    `<button type="button" class="seg-btn${it.id === current ? ' is-active' : ''}" `
    + `data-value="${it.id}" aria-label="${it.label}" aria-pressed="${it.id === current}">${it.label}</button>`).join('') + '</div>';
}

export function initSettingsPanel({ settings, onPatch, onReset, toast }) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'icon-btn';
  btn.id = 'btnSettings';
  btn.title = '设置';
  btn.setAttribute('aria-label', '打开设置');
  btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">'
    + '<circle cx="12" cy="12" r="3.2"/>'
    + '<path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4L18 18M18 6l-1.6 1.6M7.6 16.4L6 18"/>'
    + '</svg>';

  const panel = document.createElement('aside');
  panel.className = 'settings-panel ui';
  panel.id = 'settingsPanel';
  panel.setAttribute('aria-label', '设置');
  panel.hidden = true;
  panel.innerHTML =
    '<div class="sp-head"><strong>设置</strong><span class="sp-spacer"></span>'
    + '<button type="button" class="pl-tool" id="btnCloseSettings" aria-label="关闭设置">×</button></div>'
    + '<div class="sp-body">'
    + '<div class="sp-row"><span class="sp-label">画质</span>'
    + segmented([{ id: 'auto', label: '自动' }, { id: 'high', label: '高' }, { id: 'low', label: '低' }], settings.quality, 'sp-quality')
    + '</div>'
    + '<div class="sp-row"><span class="sp-label">频谱柱条</span>'
    + segmented([{ id: 'low', label: '低' }, { id: 'mid', label: '中' }, { id: 'high', label: '高' }], settings.barsLevel, 'sp-bars')
    + '</div>'
    + '<div class="sp-row"><span class="sp-label">粒子密度</span>'
    + segmented([{ id: 'low', label: '低' }, { id: 'mid', label: '中' }, { id: 'high', label: '高' }], settings.density, 'sp-density')
    + '</div>'
    + '<div class="sp-row sp-col"><span class="sp-label">节拍灵敏度 <output class="sp-val" id="spSensVal"></output></span>'
    + '<input type="range" id="spSens" min="0.5" max="2" step="0.05" value="1" aria-label="节拍灵敏度"></div>'
    + '<div class="sp-row sp-col"><span class="sp-label">频谱平滑度 <output class="sp-val" id="spSmoothVal"></output></span>'
    + '<input type="range" id="spSmooth" min="0" max="0.9" step="0.05" value="0.4" aria-label="频谱平滑度"></div>'
    + '<div class="sp-row"><span class="sp-label">显示帧率</span>'
    + '<label class="sp-check"><input type="checkbox" id="spFps" aria-label="显示帧率"><span>FPS</span></label></div>'
    + '<div class="sp-row"><span class="sp-label">渲染器</span>'
    + segmented([{ id: 'auto', label: '自动' }, { id: '2d', label: '2D' }], settings.renderer, 'sp-renderer')
    + '</div>'
    + '<div class="sp-row sp-col sp-note">更改渲染器偏好会在刷新页面后生效；当前引擎：<span id="spEngine">—</span></div>'
    + '<div class="sp-foot"><button type="button" class="sp-reset" id="spReset" aria-label="恢复默认设置">恢复默认</button>'
    + '<span class="sp-quality" id="spQuality">画质：自动</span></div>'
    + '</div>';

  document.body.appendChild(panel);
  const actions = document.querySelector('.top-actions');
  const fs = document.querySelector('#btnFullscreen');
  if (actions) actions.insertBefore(btn, fs || actions.firstChild);

  const fpsEl = document.createElement('div');
  fpsEl.className = 'fps-meter ui';
  fpsEl.id = 'fpsMeter';
  fpsEl.hidden = true;
  fpsEl.setAttribute('aria-hidden', 'true');
  document.body.appendChild(fpsEl);

  const sens = panel.querySelector('#spSens');
  const smooth = panel.querySelector('#spSmooth');
  const fpsCheck = panel.querySelector('#spFps');
  const qualityLabel = panel.querySelector('#spQuality');
  const engineLabel = panel.querySelector('#spEngine');

  function syncValues() {
    sens.value = String(settings.sensitivity);
    smooth.value = String(settings.smoothing);
    fpsCheck.checked = !!settings.showFps;
    panel.querySelector('#spSensVal').textContent = Number(settings.sensitivity).toFixed(2);
    panel.querySelector('#spSmoothVal').textContent = Number(settings.smoothing).toFixed(2);
    [['.sp-quality', settings.quality], ['.sp-bars', settings.barsLevel],
      ['.sp-density', settings.density], ['.sp-renderer', settings.renderer]].forEach(([sel, val]) => {
      panel.querySelectorAll(`${sel} .seg-btn`).forEach((b) => {
        const on = b.dataset.value === val;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    });
    if (!settings.showFps) fpsEl.hidden = true;
  }

  function toggle(force) {
    const show = force != null ? force : panel.hidden;
    panel.hidden = !show;
    btn.setAttribute('aria-expanded', show ? 'true' : 'false');
    if (show) syncValues();
  }

  panel.querySelectorAll('.seg').forEach((seg) => {
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('.seg-btn');
      if (!b) return;
      const val = b.dataset.value;
      if (seg.classList.contains('sp-quality')) onPatch('quality', val);
      else if (seg.classList.contains('sp-bars')) onPatch('barsLevel', val);
      else if (seg.classList.contains('sp-density')) onPatch('density', val);
      else if (seg.classList.contains('sp-renderer')) {
        onPatch('renderer', val);
        toast(val === '2d' ? '已选择 Canvas2D，刷新后生效' : '已选择自动渲染，刷新后生效');
      }
      syncValues();
    });
  });

  sens.addEventListener('input', () => {
    onPatch('sensitivity', Number(sens.value));
    panel.querySelector('#spSensVal').textContent = Number(sens.value).toFixed(2);
  });
  smooth.addEventListener('input', () => {
    onPatch('smoothing', Number(smooth.value));
    panel.querySelector('#spSmoothVal').textContent = Number(smooth.value).toFixed(2);
  });
  fpsCheck.addEventListener('change', () => {
    onPatch('showFps', fpsCheck.checked);
    if (!fpsCheck.checked) fpsEl.hidden = true;
  });
  panel.querySelector('#spReset').addEventListener('click', () => {
    onReset();
    syncValues();
  });

  btn.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
  panel.querySelector('#btnCloseSettings').addEventListener('click', () => toggle(false));
  document.addEventListener('pointerdown', (e) => {
    if (!panel.hidden && !panel.contains(e.target) && e.target !== btn && !btn.contains(e.target)) toggle(false);
  });

  syncValues();

  return {
    toggle,
    close: () => toggle(false),
    isOpen: () => !panel.hidden,
    panel,
    btn,
    refresh: syncValues,
    setQualityText(tier) {
      const map = { high: '高', mid: '中', low: '低' };
      const mode = settings.quality === 'auto' ? '自动' : (settings.quality === 'high' ? '高' : '低');
      qualityLabel.textContent = settings.quality === 'auto'
        ? `画质：自动（当前 ${map[tier] || tier}）` : `画质：${mode}`;
    },
    setEngine(kind) {
      engineLabel.textContent = kind === 'webgl' ? 'WebGL（GPU 加速）' : 'Canvas2D';
    },
    setFps(value, kind, visible) {
      if (!visible) { fpsEl.hidden = true; return; }
      fpsEl.hidden = false;
      setText(fpsEl, `${value} FPS · ${kind === 'webgl' ? 'WebGL' : '2D'}`);
    },
  };
}
