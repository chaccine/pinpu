/* 入口与组装：初始化状态仓库、音频引擎、渲染器、UI 与全局事件，驱动主循环，暴露调试接口。 */
/* 各模块通过状态仓库订阅与回调通信；本文件只负责装配，不实现具体业务/绘制逻辑。 */

import { $, clamp } from './utils.js';
import { initState, getState, set as setState, subscribe } from './state.js';
import { AudioEngine } from './audio/engine.js';
import { Playlist } from './playlist.js';
import { createRenderer } from './render/renderer.js';
import { createToast } from './ui/toast.js';
import { createAutoHide } from './ui/autohide.js';
import { initDock } from './ui/dock.js';
import { initThemePanel } from './ui/theme-panel.js';
import { initPlaylistPanel } from './ui/playlist-panel.js';
import { initHelpPanel } from './ui/help.js';
import { ThemeController, applyThemeCSS, THEMES } from './theme.js';
import { SHORTCUTS } from './shortcuts.js';

const MODE_COUNT = 5;

// 能力位：随阶段实现逐项置真，测试据此判断是否跳过尚未实现的特性
const features = {
  themes: true, fiveModes: true, playlist: true,
  id3: true, webgl: false, help: true, persist: false, settings: false,
};

// ---- 初始化状态仓库 ----
initState({
  mode: 0,
  source: 'none',
  playing: false,
  fps: 60,
  theme: 'neon',
  renderer: '2d',
  volume: 1,
  muted: false,
  loopMode: 'order',
  currentIndex: -1,
  playlistLength: 0,
  meta: { title: '', artist: '', hasCover: false },
});

// ---- 创建核心对象 ----
const canvas = $('#stage');
const engine = new AudioEngine();
const playlist = new Playlist(engine);
const renderer = createRenderer(canvas, engine);
const toast = createToast($('#toast'));
const autohide = createAutoHide();

// ---- 主题：400ms 平滑过渡，逐帧驱动渲染器着色与 CSS 变量 ----
const themeCtrl = new ThemeController((interp) => {
  renderer.setTheme(interp);
  applyThemeCSS(interp);
});
renderer.setTheme(THEMES[0]);
applyThemeCSS(THEMES[0]);

subscribe('theme', (id) => themeCtrl.setTheme(id));
subscribe('mode', (mode) => renderer.setMode(mode));

// 节拍 → 渲染器粒子爆发/地形起伏
engine.onBeat((energy) => {
  if (renderer.onBeat) renderer.onBeat(energy);
});

// 封面（律动封面环 + dock）跟随当前文件曲目
let lastCoverUrl = null;
function syncCover() {
  const cur = getState().source === 'file' ? playlist.current : null;
  const url = cur && cur.coverUrl ? cur.coverUrl : null;
  if (url === lastCoverUrl) return;
  lastCoverUrl = url;
  renderer.setCover(url);
}
subscribe('meta', syncCover);
subscribe('source', syncCover);

// ---- 布局：读取 dock 尺寸，保证可视化主体不被控制面板遮挡 ----
function measureDock() {
  const dock = $('#dock');
  if (!dock) return { bottom: 18, height: 150 };
  const bottom = parseFloat(getComputedStyle(dock).bottom) || 0;
  return { bottom, height: dock.offsetHeight || 0 };
}

function resize() {
  const dpr = window.devicePixelRatio || 1;
  renderer.resize(window.innerWidth, window.innerHeight, dpr, measureDock());
}

// ---- 全屏（含 webkit 前缀与 iOS 沉浸模式降级）----
function fsElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

function isImmersive() {
  return document.body.classList.contains('is-immersive');
}

function enterImmersive() {
  document.body.classList.add('is-immersive');
  toast('已进入沉浸模式，按 F 或 Esc 退出');
}

function exitImmersive() {
  document.body.classList.remove('is-immersive');
}

function toggleFullscreen() {
  if (isImmersive()) { exitImmersive(); return; }
  const doc = document;
  if (fsElement()) {
    const exit = doc.exitFullscreen || doc.webkitExitFullscreen;
    if (exit) Promise.resolve(exit.call(doc)).catch(() => {});
    return;
  }
  const el = doc.documentElement;
  const request = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!request) { enterImmersive(); return; }
  Promise.resolve(request.call(el)).catch(() => enterImmersive());
}

// ---- 动作集合（供 dock / 键盘 / 拖拽复用）----
const actions = {
  setMode(i) {
    const n = Number(i);
    if (!Number.isFinite(n)) return;
    setState({ mode: clamp(Math.round(n), 0, MODE_COUNT - 1) });
  },
  async startDemo() {
    const ok = await engine.startDemo();
    toast(ok ? '演示曲目 · 120 BPM' : '音频初始化失败');
  },
  async handleFile(f) {
    return actions.handleFiles([f]);
  },
  async handleFiles(list) {
    const arr = Array.from(list || []).filter(Boolean);
    if (!arr.length) return;
    const audio = arr.filter((f) => engine.isAudioFile(f));
    const skipped = arr.length - audio.length;
    const n = playlist.addFiles(audio);
    if (n > 0) {
      toast(skipped > 0
        ? `已加入 ${n} 首曲目，忽略 ${skipped} 个非音频文件`
        : `已加入 ${n} 首曲目`);
    } else if (skipped > 0) {
      toast('未找到可播放的音频文件');
    } else {
      toast('请选择音频文件');
    }
  },
  async startMic() {
    const res = await engine.startMic();
    if (res === 'unsupported') toast('当前环境不支持麦克风输入');
    else if (res === 'denied') toast('无法访问麦克风，请检查浏览器权限');
    else if (res) toast('麦克风已接入，播放音乐试试');
  },
  async toggleMic() {
    if (getState().source === 'mic') { engine.stopSources(); toast('已停止麦克风'); }
    else actions.startMic();
  },
  async togglePlay() {
    if (getState().source === 'none' && playlist.length) {
      const res = await playlist.playIndex(playlist.index >= 0 ? playlist.index : 0);
      if (res === 'placeholder') toast('请重新添加该文件后再播放');
      else if (!res) toast('播放失败，请重试');
      return;
    }
    const res = await engine.togglePlay();
    if (res === 'nosource') toast('请先选择音频来源');
    else if (res === 'error') toast('播放失败，请重试');
  },
  async next() {
    if (!playlist.length) { toast('播放列表为空'); return; }
    const res = await playlist.next(false);
    if (res === 'placeholder') toast('请重新添加该文件后再播放');
  },
  async prev() {
    if (!playlist.length) { toast('播放列表为空'); return; }
    const res = await playlist.prev();
    if (res === 'placeholder') toast('请重新添加该文件后再播放');
  },
  cycleLoop() {
    const m = playlist.cycleLoopMode();
    toast(`播放模式：${m.label}`);
  },
  seekBy(sec) {
    if (getState().source !== 'file') return;
    engine.seekBy(sec);
  },
  setVolume(v) {
    const vol = clamp(Number(v) || 0, 0, 1);
    setState({ volume: vol, muted: vol > 0 ? false : getState().muted });
    engine.setVolume(vol);
    engine.setMuted(getState().muted);
  },
  volumeBy(delta) {
    actions.setVolume(getState().volume + delta);
  },
  toggleMute() {
    const muted = !getState().muted;
    setState({ muted });
    engine.setMuted(muted);
    toast(muted ? '已静音' : '已取消静音');
  },
  toggleFullscreen,
  setTheme(id) {
    if (THEMES.some((t) => t.id === id)) setState({ theme: id });
  },
  cycleTheme() {
    const i = THEMES.findIndex((t) => t.id === getState().theme);
    const next = THEMES[(i + 1) % THEMES.length];
    setState({ theme: next.id });
    toast(`主题：${next.label}`);
  },
  togglePlaylist() {
    playlistPanel.toggle();
  },
  toggleHelp() {
    helpPanel.toggle();
  },
};

// ---- 装配 UI ----
const dock = initDock({ engine, actions, autohide, playlist });
const playlistPanel = initPlaylistPanel({ playlist, toast });
const helpPanel = initHelpPanel();
initThemePanel({ setTheme: (id) => actions.setTheme(id) });

// ---- 键盘：Esc 先处理浮层/沉浸，其余由统一配置表分发 ----
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (helpPanel.isOpen()) { helpPanel.close(); e.preventDefault(); return; }
    if (isImmersive()) { exitImmersive(); e.preventDefault(); return; }
  }
  if (e.defaultPrevented) return;
  const t = e.target;
  if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  for (const sc of SHORTCUTS) {
    if (sc.match(e)) {
      e.preventDefault();
      sc.run(actions, e);
      return;
    }
  }
});

// ---- 拖拽载入：多文件 + 文件夹递归（webkitGetAsEntry 降级为 files）----
function readEntry(entry) {
  if (!entry) return Promise.resolve([]);
  if (entry.isFile) {
    return new Promise((resolve) => {
      entry.file((f) => resolve([f]), () => resolve([]));
    });
  }
  if (entry.isDirectory) {
    return new Promise((resolve) => {
      const reader = entry.createReader();
      const out = [];
      const step = () => {
        reader.readEntries(async (ents) => {
          if (!ents.length) { resolve(out); return; }
          for (const en of ents) {
            out.push(...await readEntry(en));
            if (out.length > 2000) break;
          }
          step();
        }, () => resolve(out));
      };
      step();
    });
  }
  return Promise.resolve([]);
}

async function collectDropped(dt) {
  if (!dt) return [];
  const entries = [];
  if (dt.items && dt.items.length) {
    for (const item of dt.items) {
      if (item.kind !== 'file') continue;
      const en = item.webkitGetAsEntry && item.webkitGetAsEntry();
      if (en) entries.push(en);
    }
  }
  if (entries.length) {
    const files = [];
    for (const en of entries) {
      files.push(...await readEntry(en));
      if (files.length > 2000) break;
    }
    return files;
  }
  return Array.from(dt.files || []);
}

let dragDepth = 0;
const dropVeil = $('#dropVeil');
const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');

window.addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth++;
  dropVeil.classList.add('show');
});
window.addEventListener('dragover', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
});
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dropVeil.classList.remove('show');
});
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0;
  dropVeil.classList.remove('show');
  let files = [];
  try { files = await collectDropped(e.dataTransfer); } catch (err) { files = []; }
  if (files.length) actions.handleFiles(files);
});

// ---- 尺寸/方向/全屏变化 ----
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 120));
if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
document.addEventListener('fullscreenchange', () => { resize(); });
document.addEventListener('webkitfullscreenchange', () => { resize(); });
canvas.addEventListener('dblclick', (e) => { e.preventDefault(); toggleFullscreen(); });
// dock 高度会随「正在播放」行出现而改变，用 ResizeObserver 重新布局
const dockEl = $('#dock');
if (window.ResizeObserver && dockEl) new ResizeObserver(() => resize()).observe(dockEl);

// ---- 主循环 ----
let lastTs = 0;
let fpsAcc = 0;
let fpsFrames = 0;
let fps = 60;

function frame(ts) {
  requestAnimationFrame(frame);
  if (!lastTs) lastTs = ts;
  let dt = (ts - lastTs) / 1000;
  lastTs = ts;
  dt = clamp(dt, 0.001, 0.05);

  fpsAcc += dt;
  fpsFrames++;
  if (fpsAcc >= 0.5) {
    fps = Math.round(fpsFrames / fpsAcc);
    fpsAcc = 0;
    fpsFrames = 0;
    setState({ fps });
  }

  engine.update(dt, ts / 1000);
  themeCtrl.update(dt);
  renderer.render(dt);
  dock.updateTransport();
}

// ---- 调试接口（verify.py / run_all.py 依赖）----
function exposeDebugApi() {
  const api = {
    get mode() { return getState().mode; },
    get beats() { return engine.beats; },
    get playing() { return getState().playing; },
    get source() { return getState().source; },
    get fps() { return fps; },
    get audioState() { return engine.audioState; },
    get beatInfo() { return engine.beatInfo; },
    get levels() { return engine.levels; },
    get spectrum() { return engine.spectrum; },
    // v2 扩展字段
    get theme() { return getState().theme; },
    get themes() { return THEMES.map((t) => t.id); },
    get renderer() { return renderer.kind; },
    get playlistLength() { return getState().playlistLength; },
    get currentIndex() { return getState().currentIndex; },
    get meta() { return getState().meta; },
    get loopMode() { return getState().loopMode; },
    get volume() { return getState().volume; },
    get muted() { return getState().muted; },
    features,
    setMode: (i) => actions.setMode(i),
    setTheme: (id) => actions.setTheme(id),
    next: () => actions.next(),
    prev: () => actions.prev(),
    togglePlay: () => actions.togglePlay(),
    setLoopMode: (id) => { playlist.setLoopMode(id); return getState().loopMode; },
  };
  try {
    Object.defineProperty(window, '__pinpu', { value: api, configurable: true });
  } catch (err) {
    window.__pinpu = api;
  }
}

// ---- 启动 ----
resize();
renderer.setMode(getState().mode);
exposeDebugApi();
requestAnimationFrame(frame);
