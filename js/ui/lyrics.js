/* 歌词覆盖层：当前行大字高亮、下一行淡显；行切换淡入上移，节拍时轻微辉光。 */
/* update() 每帧调用，仅在行下标变化时改 DOM；loadLrc 接受 LRC 文本或已解析行数组。 */

import { findLineIndex, parseLRC } from '../lyrics/lrc.js';
import { clamp } from '../utils.js';

export function initLyrics({ getTime, getPlaying, toast, enabled = true } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'lyrics-overlay';
  overlay.id = 'lyricsOverlay';
  overlay.hidden = true;
  overlay.setAttribute('aria-hidden', 'true');

  const currentEl = document.createElement('div');
  currentEl.className = 'lyric-line lyric-current is-empty';
  currentEl.id = 'lyricCurrent';
  const nextEl = document.createElement('div');
  nextEl.className = 'lyric-line lyric-next is-empty';
  nextEl.id = 'lyricNext';
  overlay.appendChild(currentEl);
  overlay.appendChild(nextEl);
  document.body.appendChild(overlay);

  let lines = [];
  let lastIndex = -2;
  let on = !!enabled;
  let beatTimer = 0;

  const playing = () => (typeof getPlaying === 'function' ? !!getPlaying() : true);
  const now = () => (typeof getTime === 'function' ? Number(getTime()) || 0 : 0);

  function syncVisible() {
    const show = on && lines.length > 0;
    overlay.hidden = !show;
    overlay.classList.toggle('is-visible', show);
    overlay.setAttribute('aria-hidden', show ? 'false' : 'true');
  }

  function render(idx) {
    const current = idx >= 0 ? lines[idx] : null;
    const upcoming = idx >= 0 ? (lines[idx + 1] || null) : (lines[0] || null);
    currentEl.textContent = current ? current.text : '';
    nextEl.textContent = upcoming ? upcoming.text : '';
    currentEl.classList.toggle('is-empty', !current);
    nextEl.classList.toggle('is-empty', !upcoming);
    if (current) {
      currentEl.classList.remove('is-in');
      void currentEl.offsetWidth; // 强制重排，让同一元素可重复触发入场动画
      currentEl.classList.add('is-in');
    }
  }

  function update(timeSec) {
    if (!on || !lines.length) return;
    const idx = findLineIndex(lines, Number(timeSec));
    if (idx === lastIndex) return;
    lastIndex = idx;
    render(idx);
  }

  // 接受 LRC 文本、行数组或 parseLRC 的结果；返回有效行数
  function loadLrc(input) {
    let parsed = [];
    if (Array.isArray(input)) parsed = input;
    else if (input && Array.isArray(input.lines)) parsed = input.lines;
    else if (typeof input === 'string') parsed = parseLRC(input).lines;

    lines = parsed
      .filter((l) => l && Number.isFinite(l.time) && typeof l.text === 'string')
      .map((l) => ({ time: l.time, text: l.text }))
      .sort((a, b) => a.time - b.time);
    lastIndex = -2;

    if (!lines.length) {
      currentEl.textContent = '';
      nextEl.textContent = '';
      currentEl.classList.add('is-empty');
      nextEl.classList.add('is-empty');
    }
    syncVisible();
    if (lines.length) update(now());
    return lines.length;
  }

  function clear() {
    lines = [];
    lastIndex = -2;
    currentEl.textContent = '';
    nextEl.textContent = '';
    currentEl.classList.add('is-empty');
    nextEl.classList.add('is-empty');
    currentEl.classList.remove('is-in');
    syncVisible();
  }

  function setEnabled(v) {
    on = !!v;
    syncVisible();
    if (on && lines.length) {
      lastIndex = -2;
      update(now());
    }
  }

  // 节拍光晕：CSS 变量控制半径，class 负责短促收束
  function onBeat(energy) {
    if (!on || !lines.length || !playing()) return;
    overlay.style.setProperty('--lyric-beat', clamp(Number(energy) || 0, 0, 1).toFixed(3));
    overlay.classList.add('is-beat');
    clearTimeout(beatTimer);
    beatTimer = setTimeout(() => {
      overlay.classList.remove('is-beat');
      overlay.style.setProperty('--lyric-beat', '0');
    }, 150);
  }

  syncVisible();

  return {
    overlay,
    loadLrc,
    clear,
    setEnabled,
    update,
    onBeat,
    isLoaded: () => lines.length > 0,
    currentText: () => (lastIndex >= 0 && lines[lastIndex] ? lines[lastIndex].text : ''),
    currentIndex: () => lastIndex,
    lines: () => lines.slice(),
  };
}
