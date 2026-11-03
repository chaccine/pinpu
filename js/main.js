/* 入口与组装：初始化状态仓库、音频引擎、渲染器、UI 与全局事件，驱动主循环，暴露调试接口。 */
/* 各模块通过状态仓库订阅与回调通信；本文件只负责装配，不实现具体业务/绘制逻辑。 */

import { $, clamp, shortName } from './utils.js';
import { initState, getState, set as setState, subscribe } from './state.js';
import { AudioEngine } from './audio/engine.js';
import { createRenderer } from './render/renderer.js';
import { createToast } from './ui/toast.js';
import { createAutoHide } from './ui/autohide.js';
import { initDock } from './ui/dock.js';
import { initThemePanel } from './ui/theme-panel.js';
import { ThemeController, applyThemeCSS, THEMES } from './theme.js';

// 阶段1 仅有 3 种模式；阶段2 扩展为 5
const MODE_COUNT = 3;

// 能力位：随阶段实现逐项置真，测试据此判断是否跳过尚未实现的特性
const features = {
  themes: false, fiveModes: false, playlist: false,
  id3: false, webgl: false, help: false, persist: false, settings: false,
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
const renderer = createRenderer(canvas, engine);
const toast = createToast($('#toast'));
const autohide = createAutoHide();

// 主题：400ms 平滑过渡，逐帧驱动渲染器着色与 CSS 变量
const themeCtrl = new ThemeController((interp) => {
  renderer.setTheme(interp);
  applyThemeCSS(interp);
});
renderer.setTheme(THEMES[0]);
applyThemeCSS(THEMES[0]);
features.themes = true;

// 模式变化 → 通知渲染器（渲染层只读状态，不改业务状态）
subscribe('mode', (mode) => renderer.setMode(mode));

// ---- 布局：读取 dock 尺寸，保证主体不被遮挡 ----
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

// ---- 全屏（含 webkit 前缀）----
function toggleFullscreen() {
  const doc = document;
  const el = document.documentElement;
  if (doc.fullscreenElement || doc.webkitFullscreenElement) {
    const exit = doc.exitFullscreen || doc.webkitExitFullscreen;
    if (exit) Promise.resolve(exit.call(doc)).catch(() => {});
    return;
  }
  const request = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!request) { toast('当前浏览器不支持全屏'); return; }
  Promise.resolve(request.call(el)).catch(() => toast('无法进入全屏'));
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
    if (!engine.isAudioFile(f)) { toast('请选择音频文件'); return; }
    const res = await engine.loadFile(f);
    if (res === 'played') toast(`已载入：${shortName(f.name)}`);
    else if (res === 'loaded') toast('已载入音频，点击播放开始');
  },
  async handleFiles(list) {
    // 阶段1：仅取第一个文件；阶段2 扩展为播放列表
    if (list && list.length) actions.handleFile(list[0]);
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
    const res = await engine.togglePlay();
    if (res === 'nosource') toast('请先选择音频来源');
    else if (res === 'error') toast('播放失败，请重试');
  },
  toggleFullscreen,
  setTheme(id) {
    themeCtrl.setTheme(id);
    setState({ theme: id });
  },
  cycleTheme() {
    const id = themeCtrl.cycle();
    setState({ theme: id });
    const t = THEMES.find((x) => x.id === id);
    toast(`主题：${t ? t.label : id}`);
  },
};

// ---- 装配 dock 与主题面板 ----
const dock = initDock({ engine, actions, autohide });
initThemePanel({ setTheme: (id) => actions.setTheme(id) });

// ---- 键盘快捷键（阶段3 迁移到统一配置表）----
window.addEventListener('keydown', (e) => {
  const tag = e.target && e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  if (e.code === 'Space') { e.preventDefault(); actions.togglePlay(); }
  else if (e.key === '1' || e.key === '2' || e.key === '3') actions.setMode(Number(e.key) - 1);
  else if (e.key === 'f' || e.key === 'F') actions.toggleFullscreen();
  else if (e.key === 't' || e.key === 'T') actions.cycleTheme();
});

// ---- 拖拽载入（阶段2 扩展为多文件/文件夹）----
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
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  dropVeil.classList.remove('show');
  const files = e.dataTransfer && e.dataTransfer.files;
  if (files && files.length) actions.handleFiles(Array.from(files));
});

// ---- 尺寸/方向/全屏变化 ----
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 120));
if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
document.addEventListener('fullscreenchange', resize);
document.addEventListener('webkitfullscreenchange', resize);

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
  }

  engine.update(dt, ts / 1000);
  themeCtrl.update(dt);
  renderer.render(dt);
  dock.updateTransport();
}

// ---- 调试接口 ----
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
    features,
    setMode: (i) => actions.setMode(i),
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
