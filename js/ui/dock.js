/* 底部控制面板（dock）：绑定音源/播放/模式/进度/全屏控件，订阅状态仓库刷新 DOM。 */
/* 仅把用户操作转发给 actions/engine，并据 store 更新界面；不持有业务逻辑。 */

import { $, $$, clamp, formatTime, setText } from '../utils.js';
import { subscribe, getState, set as setState } from '../state.js';
import { BUILTIN_SONGS } from '../builtin.js';

const SOURCE_NAMES = { none: '未连接', demo: '演示曲目', file: '本地音频', mic: '麦克风' };

export function initDock({ engine, actions, autohide, playlist = null }) {
  const ui = {
    play: $('#btnPlay'),
    prev: $('#btnPrev'),
    next: $('#btnNext'),
    demo: $('#btnDemo'),
    builtin: $('#btnBuiltin'),
    file: $('#btnFile'),
    mic: $('#btnMic'),
    fileInput: $('#fileInput'),
    fullscreen: $('#btnFullscreen'),
    progress: $('#progress'),
    progressTip: $('#progressTip'),
    rangeWrap: $('#progress') ? $('#progress').parentElement : null,
    timeNow: $('#timeNow'),
    timeTotal: $('#timeTotal'),
    volume: $('#volume'),
    mute: $('#btnMute'),
    sourceTag: $('#sourceTag'),
    nowPlaying: $('#nowPlaying'),
    npCover: $('#npCover'),
    npTitle: $('#npTitle'),
    modeBtns: $$('.mode'),
  };

  let seeking = false;
  let painted = -1;
  let paintedBuffered = -1;

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
    const cur = playlist && playlist.current;
    const onBuiltin = source === 'file' && cur && BUILTIN_SONGS.some((s) => s.fileName === cur.name);
    if (ui.builtin) ui.builtin.classList.toggle('is-active', !!onBuiltin);
    ui.timeTotal.classList.toggle('wide', source === 'demo');
    document.body.classList.toggle('started', source !== 'none');
    syncNowPlaying();
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

  function syncVolume() {
    const v = Math.round((getState().muted ? 0 : getState().volume) * 100);
    if (Number(ui.volume.value) !== v) ui.volume.value = String(v);
    ui.volume.style.setProperty('--v', `${v}%`);
  }

  function syncMuted() {
    const muted = getState().muted;
    document.body.classList.toggle('is-muted', muted);
    ui.mute.classList.toggle('is-muted', muted);
    ui.mute.setAttribute('aria-label', muted ? '取消静音' : '静音');
    ui.mute.setAttribute('aria-pressed', muted ? 'true' : 'false');
    syncVolume();
  }

  // 正在播放信息：封面 + 标题/歌手跑马灯
  function syncNowPlaying() {
    const meta = getState().meta;
    const isFile = getState().source === 'file';
    const show = isFile && !!(meta && meta.title);
    ui.nowPlaying.hidden = !show;
    if (!show) return;
    const text = meta.artist ? `${meta.title} — ${meta.artist}` : meta.title;
    if (ui.npTitle.textContent !== text) ui.npTitle.textContent = text;
    const coverUrl = playlist && playlist.current ? playlist.current.coverUrl : null;
    if (coverUrl) {
      if (!ui.npCover.querySelector('img')) {
        ui.npCover.textContent = '';
        const img = document.createElement('img');
        img.alt = '';
        ui.npCover.appendChild(img);
      }
      const img = ui.npCover.querySelector('img');
      if (img.getAttribute('src') !== coverUrl) img.setAttribute('src', coverUrl);
    } else {
      ui.npCover.textContent = '';
    }
    // 溢出时启用跑马灯
    requestAnimationFrame(() => {
      const wrap = ui.npTitle.parentElement;
      const over = ui.npTitle.scrollWidth - wrap.clientWidth;
      if (over > 4) {
        ui.npTitle.style.setProperty('--np-shift', `${-over - 24}px`);
        ui.npTitle.classList.add('is-scroll');
      } else {
        ui.npTitle.classList.remove('is-scroll');
      }
    });
  }

  subscribe('source', syncSource);
  subscribe('currentIndex', syncSource);
  subscribe('playing', syncPlaying);
  subscribe('mode', syncMode);
  subscribe('volume', syncVolume);
  subscribe('muted', syncMuted);
  subscribe('meta', syncNowPlaying);

  // ---- 走带刷新（每帧调用）----
  function updateTransport() {
    const source = getState().source;
    if (source === 'file') {
      ui.progress.disabled = false;
      const dur = engine.duration;
      if (Number.isFinite(dur) && dur > 0) {
        const p = clamp(engine.currentTime / dur, 0, 1);
        if (!seeking) {
          const value = Math.round(p * 1000);
          if (value !== painted) {
            ui.progress.value = String(value);
            paintProgress(value);
            painted = value;
          }
        }
        const buf = Math.round(Math.max(engine.buffered, p) * 100);
        if (buf !== paintedBuffered) {
          ui.progress.style.setProperty('--b', `${buf}%`);
          paintedBuffered = buf;
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

  // 进度条悬浮/拖动时间提示
  if (ui.rangeWrap && ui.progressTip) {
    const showTip = (clientX) => {
      const dur = engine.duration;
      if (getState().source !== 'file' || !Number.isFinite(dur) || dur <= 0) return;
      const rect = ui.progress.getBoundingClientRect();
      const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
      setText(ui.progressTip, formatTime(ratio * dur));
      ui.progressTip.style.left = `${ratio * 100}%`;
      ui.progressTip.hidden = false;
    };
    const showTipByValue = () => {
      const dur = engine.duration;
      if (getState().source !== 'file' || !Number.isFinite(dur) || dur <= 0) return;
      const ratio = clamp(Number(ui.progress.value) / 1000, 0, 1);
      setText(ui.progressTip, formatTime(ratio * dur));
      ui.progressTip.style.left = `${ratio * 100}%`;
      ui.progressTip.hidden = false;
    };
    const hideTip = () => { ui.progressTip.hidden = true; };
    ui.rangeWrap.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch' && !seeking) return;
      showTip(e.clientX);
    });
    ui.rangeWrap.addEventListener('pointerdown', (e) => { showTip(e.clientX); });
    ui.progress.addEventListener('input', showTipByValue);
    ui.rangeWrap.addEventListener('pointerleave', () => { if (!seeking) hideTip(); });
    window.addEventListener('pointerup', hideTip);
    ui.progress.addEventListener('blur', hideTip);
  }

  // ---- 按钮事件 ----
  ui.demo.addEventListener('click', () => actions.startDemo());
  if (ui.builtin) ui.builtin.addEventListener('click', () => actions.playBuiltin('color-your-night'));
  ui.file.addEventListener('click', () => { ui.fileInput.value = ''; ui.fileInput.click(); });
  ui.fileInput.addEventListener('change', () => {
    const files = ui.fileInput.files;
    if (files && files.length) actions.handleFiles(Array.from(files));
  });
  ui.mic.addEventListener('click', () => actions.toggleMic());
  ui.play.addEventListener('click', () => actions.togglePlay());
  ui.fullscreen.addEventListener('click', () => actions.toggleFullscreen());
  if (ui.prev) ui.prev.addEventListener('click', () => actions.prev());
  if (ui.next) ui.next.addEventListener('click', () => actions.next());
  if (ui.mute) ui.mute.addEventListener('click', () => actions.toggleMute());
  if (ui.volume) {
    ui.volume.addEventListener('input', () => {
      const v = clamp(Number(ui.volume.value) / 100, 0, 1);
      if (getState().muted) setState({ muted: false });
      actions.setVolume(v);
    });
  }

  ui.modeBtns.forEach((btn) => {
    btn.addEventListener('click', () => { actions.setMode(Number(btn.dataset.mode)); autohide.wake(); });
  });

  // 曲目自然结束由 playlist 统一处理（自动下一首/停止），dock 仅靠 updateTransport 刷新进度

  // 初始绘制
  syncSource();
  syncPlaying(getState().playing);
  syncMode(getState().mode);
  syncMuted();
  syncVolume();
  syncNowPlaying();
  paintProgress(0);
  updateTransport();

  return { updateTransport, ui, paintProgress };
}
