/* 播放列表抽屉：顶栏按钮开关；桌面右侧浮层、移动端底部抽屉。 */
/* 展示曲目（封面/标题/歌手/时长）、当前高亮、点击播放、单条移除、清空、循环模式、拖动排序。 */

import { LOOP_MODES } from '../playlist.js';
import { subscribe, getState } from '../state.js';
import { setText, formatTime } from '../utils.js';

const NOTE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V6l10-2v11"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="15" r="2.5"/></svg>';

export function initPlaylistPanel({ playlist, toast, onChange, onLoadLyrics }) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'icon-btn';
  btn.id = 'btnPlaylist';
  btn.title = '播放列表（L）';
  btn.setAttribute('aria-label', '打开播放列表');
  btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h11M4 12h11M4 18h7"/><path d="M17 14v6"/><circle cx="15.4" cy="20" r="1.8"/><path d="M17 14l4-1v5"/></svg>';

  const lrcInput = document.createElement('input');
  lrcInput.type = 'file';
  lrcInput.accept = '.lrc,text/plain';
  lrcInput.hidden = true;
  lrcInput.id = 'lyricsInput';
  lrcInput.setAttribute('aria-label', '选择歌词文件');

  const panel = document.createElement('aside');
  panel.className = 'playlist-panel ui';
  panel.id = 'playlistPanel';
  panel.setAttribute('aria-label', '播放列表');
  panel.hidden = true;
  panel.innerHTML =
    '<div class="pl-head">'
    + '<strong class="pl-title-main">播放列表</strong>'
    + '<span class="pl-count" id="plCount">0 首</span>'
    + '<span class="pl-spacer"></span>'
    + '<button type="button" class="pl-tool pl-loop" id="btnLoop" title="播放模式"></button>'
    + '<button type="button" class="pl-tool pl-lyrics" id="btnLyrics" title="加载歌词（.lrc）" aria-label="加载歌词文件">'
    + '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v12H9l-5 4z"/><path d="M8 9h8M8 12h5"/></svg>'
    + '<span>歌词</span></button>'
    + '<button type="button" class="pl-tool" id="btnClearList" title="清空列表" aria-label="清空列表">清空</button>'
    + '<button type="button" class="pl-tool" id="btnCloseList" title="关闭" aria-label="关闭播放列表">×</button>'
    + '</div>'
    + '<div class="playlist-list" id="plList" role="list"></div>'
    + '<p class="pl-empty" id="plEmpty">拖入音频文件或文件夹，或点击「本地音频」添加曲目</p>';

  document.body.appendChild(panel);
  document.body.appendChild(lrcInput);
  const list = panel.querySelector('#plList');
  const empty = panel.querySelector('#plEmpty');
  const count = panel.querySelector('#plCount');
  const loopBtn = panel.querySelector('#btnLoop');
  const lyricsBtn = panel.querySelector('#btnLyrics');
  const clearBtn = panel.querySelector('#btnClearList');
  const closeBtn = panel.querySelector('#btnCloseList');

  function toggle(force) {
    const show = force != null ? force : panel.hidden;
    panel.hidden = !show;
    btn.setAttribute('aria-expanded', show ? 'true' : 'false');
    btn.setAttribute('aria-label', show ? '关闭播放列表' : '打开播放列表');
    if (show) render();
    if (onChange) onChange(show);
  }

  function syncLoop() {
    const mode = LOOP_MODES.find((m) => m.id === getState().loopMode) || LOOP_MODES[0];
    setText(loopBtn, mode.short);
    loopBtn.title = `播放模式：${mode.label}（S 切换）`;
    loopBtn.setAttribute('aria-label', `播放模式 ${mode.label}`);
  }

  // ---- 拖动排序（pointer 事件，鼠标/触屏通用）----
  let drag = null;

  function endDrag(commit) {
    if (!drag) return;
    const { from, target, row } = drag;
    row.classList.remove('is-dragging');
    row.style.transform = '';
    list.querySelectorAll('.is-drop-target').forEach((el) => el.classList.remove('is-drop-target'));
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragUp);
    window.removeEventListener('pointercancel', onDragCancel);
    drag = null;
    if (commit && target !== from) playlist.move(from, target);
  }

  function onDragMove(e) {
    if (!drag) return;
    const dy = e.clientY - drag.startY;
    drag.row.style.transform = `translateY(${dy}px)`;
    let target = drag.from;
    Array.from(list.children).forEach((row, idx) => {
      const r = row.getBoundingClientRect();
      if (e.clientY > r.top + r.height / 2) target = idx;
    });
    drag.target = target;
    Array.from(list.children).forEach((row, idx) => {
      row.classList.toggle('is-drop-target', idx === target && idx !== drag.from);
    });
  }

  function onDragUp() { endDrag(true); }
  function onDragCancel() { endDrag(false); }

  function bindDrag(handle, index) {
    handle.addEventListener('pointerdown', (e) => {
      if (playlist.items.length < 2) return;
      e.preventDefault();
      e.stopPropagation();
      const row = handle.closest('.pl-item');
      drag = { from: index, target: index, startY: e.clientY, row };
      row.classList.add('is-dragging');
      window.addEventListener('pointermove', onDragMove, { passive: true });
      window.addEventListener('pointerup', onDragUp, { once: true });
      window.addEventListener('pointercancel', onDragCancel, { once: true });
    });
  }

  function render() {
    const items = playlist.items;
    const cur = getState().currentIndex;
    setText(count, `${items.length} 首`);
    empty.hidden = items.length > 0;
    list.textContent = '';
    items.forEach((item, i) => {
      const row = document.createElement('div');
      row.className = 'pl-item' + (i === cur ? ' is-active' : '');

      const handle = document.createElement('button');
      handle.type = 'button';
      handle.className = 'pl-drag';
      handle.setAttribute('aria-label', `拖动排序：${item.title || item.name}`);
      handle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="7" r="1.3"/><circle cx="15" cy="7" r="1.3"/><circle cx="9" cy="12" r="1.3"/><circle cx="15" cy="12" r="1.3"/><circle cx="9" cy="17" r="1.3"/><circle cx="15" cy="17" r="1.3"/></svg>';
      bindDrag(handle, i);

      const main = document.createElement('button');
      main.type = 'button';
      main.className = 'pl-main';
      main.setAttribute('aria-label', `播放 ${item.title || item.name}`);
      const cover = document.createElement('span');
      cover.className = 'pl-cover';
      if (item.coverUrl) {
        const img = document.createElement('img');
        img.src = item.coverUrl;
        img.alt = '';
        cover.appendChild(img);
      } else {
        cover.innerHTML = NOTE_SVG;
      }
      const meta = document.createElement('span');
      meta.className = 'pl-meta';
      const t = document.createElement('span');
      t.className = 'pl-name';
      t.textContent = item.title || item.name.replace(/\.[^.]+$/, '');
      const a = document.createElement('span');
      a.className = 'pl-artist';
      a.textContent = item.artist || (item.placeholder ? '请重新添加文件' : (item.parsed ? '未知歌手' : '读取中…'));
      meta.appendChild(t);
      meta.appendChild(a);

      const dur = document.createElement('span');
      dur.className = 'pl-duration';
      dur.textContent = item.placeholder ? '—' : (Number.isFinite(item.duration) ? formatTime(item.duration) : '--:--');

      main.appendChild(cover);
      main.appendChild(meta);
      main.appendChild(dur);
      main.addEventListener('click', async () => {
        const res = await playlist.playIndex(i);
        if (res === 'placeholder') toast('请重新添加该文件后再播放');
      });

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'pl-del';
      del.setAttribute('aria-label', `移除 ${item.title || item.name}`);
      del.textContent = '×';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        playlist.removeAt(i);
        toast('已从列表移除');
      });

      row.appendChild(handle);
      row.appendChild(main);
      row.appendChild(del);
      list.appendChild(row);
    });
    syncLoop();
  }

  btn.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
  closeBtn.addEventListener('click', () => toggle(false));
  loopBtn.addEventListener('click', () => {
    const m = playlist.cycleLoopMode();
    toast(`播放模式：${m.label}`);
  });
  lyricsBtn.addEventListener('click', () => {
    lrcInput.value = '';
    lrcInput.click();
  });
  lrcInput.addEventListener('change', () => {
    const f = lrcInput.files && lrcInput.files[0];
    if (f && typeof onLoadLyrics === 'function') onLoadLyrics(f);
  });
  clearBtn.addEventListener('click', () => {
    if (!playlist.items.length) { toast('列表已是空的'); return; }
    playlist.clear();
    toast('播放列表已清空');
  });
  document.addEventListener('pointerdown', (e) => {
    if (!panel.hidden && !panel.contains(e.target) && e.target !== btn && !btn.contains(e.target)) toggle(false);
  });

  const actions = document.querySelector('.top-actions');
  const fs = document.querySelector('#btnFullscreen');
  if (actions) actions.insertBefore(btn, fs || actions.firstChild);

  playlist.onChange(render);
  subscribe('currentIndex', render);
  subscribe('loopMode', syncLoop);
  render();

  return { toggle, render, isOpen: () => !panel.hidden, panel, btn };
}
