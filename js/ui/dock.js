/* 底部控制面板（dock）：绑定音源/播放/模式/进度/全屏控件，订阅状态仓库刷新 DOM。 */
/* 仅把用户操作转发给 actions/engine，并据 store 更新界面；不持有业务逻辑。 */

import { $, $$, clamp, formatTime, setText } from '../utils.js';
import { subscribe, getState, set as setState } from '../state.js';

const SOURCE_NAMES = { none: '未连接', demo: '演示曲目', file: '本地音频', mic: '麦克风' };

export function initDock({ engine, actions, autohide }) {
  const ui = {
    play: $('#btnPlay'),
    demo: $('#btnDemo'),
    file: $('#btnFile'),
    mic: $('#btnMic'),
    fileInput: $('#fileInput'),
    fullscreen: $('#btnFullscreen'),
    progress: $('#progress'),
    timeNow: $('#timeNow'),
    timeTotal: $('#timeTotal'),
    sourceTag: $('#sourceTag'),
    modeBtns: $$('.mode'),
  };

  let seeking = false;
  let painted = -1;

  function paintProgress(value) {
    const pct = clamp(value / 10, 0, 100);
    ui.progress.style.setProperty('--p', `${pct}%`);
  }

  // ---- 状态订阅 → DOM ----
  function syncSource() {
    const source = getState().source;
    setText(ui.sourceTag, SOURCE_NAMES[source] || '未连接');
    ui.demo.classList.toggle('is-active', source === 'demo');
    ui.file.classList.toggle('is-active', source === 'file');
    ui.mic.classList.toggle('is-active', source === 'mic');
    ui.timeTotal.classList.toggle('wide', source === 'demo');
    document.body.classList.toggle('started', source !== 'none');
  }

  function syncPlaying(playing) {
    document.body.classList.toggle('is-playing', playing);
    ui.play.setAttribute('aria-label', playing ? '暂停' : '播放');
  }

  function syncMode(mode) {
    ui.modeBtns.forEach((btn) => {
      const active = Number(btn.dataset.mode) === mode;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  subscribe('source', syncSource);
  subscribe('playing', syncPlaying);
  subscribe('mode', syncMode);

  // ---- 走带刷新（每帧调用）----
  function updateTransport() {
    const source = getState().source;
    if (source === 'file') {
      ui.progress.disabled = false;
      const dur = engine.duration;
      if (Number.isFinite(dur) && dur > 0) {
        if (!seeking) {
          const p = clamp(engine.currentTime / dur, 0, 1);
          const value = Math.round(p * 1000);
          if (value !== painted) {
            ui.progress.value = String(value);
            paintProgress(value);
            painted = value;
          }
        }
        setText(ui.timeNow, formatTime(engine.currentTime));
        setText(ui.timeTotal, formatTime(dur));
      }
    } else {
      ui.progress.disabled = true;
      if (painted !== 0) {
        ui.progress.value = '0';
        paintProgress(0);
        painted = 0;
      }
      if (source === 'demo') {
        setText(ui.timeNow, '循环');
        setText(ui.timeTotal, '120 BPM');
      } else if (source === 'mic') {
        setText(ui.timeNow, '实时');
        setText(ui.timeTotal, '—');
      } else {
        setText(ui.timeNow, '0:00');
        setText(ui.timeTotal, '0:00');
      }
    }
  }

  // ---- 进度条拖动 ----
  function seekFromInput() {
    if (getState().source !== 'file') return;
    const dur = engine.duration;
    if (!Number.isFinite(dur) || dur <= 0) return;
    const p = clamp(Number(ui.progress.value) / 1000, 0, 1);
    engine.seekRatio(p);
    paintProgress(p * 1000);
    painted = Math.round(Number(ui.progress.value));
  }

  ui.progress.addEventListener('pointerdown', () => { seeking = true; autohide.setSeeking(true); });
  ui.progress.addEventListener('input', () => { seeking = true; autohide.setSeeking(true); seekFromInput(); });
  ui.progress.addEventListener('change', () => { seekFromInput(); seeking = false; autohide.setSeeking(false); });
  window.addEventListener('pointerup', () => { seeking = false; autohide.setSeeking(false); });
  ui.progress.addEventListener('blur', () => { seeking = false; autohide.setSeeking(false); });
  ui.progress.addEventListener('keyup', () => { seeking = false; autohide.setSeeking(false); });

  // ---- 按钮事件 ----
  ui.demo.addEventListener('click', () => actions.startDemo());
  ui.file.addEventListener('click', () => { ui.fileInput.value = ''; ui.fileInput.click(); });
  ui.fileInput.addEventListener('change', () => {
    const files = ui.fileInput.files;
    if (files && files.length) actions.handleFiles(Array.from(files));
  });
  ui.mic.addEventListener('click', () => actions.toggleMic());
  ui.play.addEventListener('click', () => actions.togglePlay());
  ui.fullscreen.addEventListener('click', () => actions.toggleFullscreen());

  ui.modeBtns.forEach((btn) => {
    btn.addEventListener('click', () => { actions.setMode(Number(btn.dataset.mode)); autohide.wake(); });
  });

  // 曲目自然结束：暂停并置满进度（阶段2改为自动下一首）
  engine.onEnded(() => {
    if (getState().source !== 'file') return;
    setState({ playing: false });
    if (Number.isFinite(engine.duration)) { paintProgress(1000); painted = 1000; }
  });

  // 初始绘制
  syncSource();
  syncPlaying(getState().playing);
  syncMode(getState().mode);
  paintProgress(0);
  updateTransport();

  return { updateTransport, ui, paintProgress };
}
