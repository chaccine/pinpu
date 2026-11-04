/* 封面主题（浏览器侧）：离屏画布读取封面像素、取色缓存、选曲联动与无封面回退。 */
/* 纯取色算法在 color.js；本模块只处理 Image/canvas 与主题控制器接线。 */

import { extractPalette, buildThemeFromPalette } from './color.js';
import { THEMES, setCoverTheme as applyCoverTheme } from './theme.js';
import { subscribe } from './state.js';

const MAX_SIDE = 64;
const MAX_CACHE = 32;
const FALLBACK_DELAY = 350;   // 等元数据解析，避免切歌瞬间误判「无封面」

const cache = new Map();
const listeners = new Set();
let view = {
  url: null, palette: null, theme: null,
  preferred: false, fallback: 'neon', available: false, active: false,
};

export function getCoverState() { return view; }

export function subscribeCover(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(next) {
  view = next;
  listeners.forEach((fn) => { try { fn(view); } catch (err) { /* 面板异常不影响播放 */ } });
}

/**
 * 读取封面并提取主色。跨域/解码失败或没有可用主色时返回 null。
 * 结果按 url 缓存（含失败的 null），blob URL 每次切歌唯一。
 */
export function loadCoverPalette(url) {
  if (!url) return Promise.resolve(null);
  if (cache.has(url)) return cache.get(url);
  const task = new Promise((resolve) => {
    if (typeof Image === 'undefined' || typeof document === 'undefined') { resolve(null); return; }
    let img;
    try { img = new Image(); } catch (err) { resolve(null); return; }
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => {
      try {
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        if (!w || !h) { resolve(null); return; }
        const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
        const cw = Math.max(1, Math.round(w * scale));
        const ch = Math.max(1, Math.round(h * scale));
        const canvas = document.createElement('canvas');
        canvas.width = cw;
        canvas.height = ch;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) { resolve(null); return; }
        ctx.drawImage(img, 0, 0, cw, ch);
        const data = ctx.getImageData(0, 0, cw, ch).data; // 跨域会抛 SecurityError
        const palette = extractPalette(data, cw, ch, { maxSamples: 4096 });
        resolve(palette.length ? palette : null);
      } catch (err) { resolve(null); }
    };
    img.onerror = () => resolve(null);
    try { img.src = url; } catch (err) { resolve(null); }
  });
  cache.set(url, task);
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
  return task;
}

/**
 * 接入主题系统与状态订阅。
 * @param {object} deps getCoverUrl/themeCtrl/getState/setState/toast/settings/persistTheme
 */
export function initCoverTheme({ getCoverUrl, themeCtrl, getState, setState, toast, settings, persistTheme }) {
  void toast;
  const store = setState;
  const initial = getState().theme;
  const isStatic = (id) => THEMES.some((t) => t.id === id);
  let preferred = initial === 'cover';
  let fallback = settings && isStatic(settings.theme)
    ? settings.theme
    : (isStatic(initial) ? initial : 'neon');
  if (!isStatic(fallback)) fallback = 'neon';

  let lastThemeId = initial;
  let lastUrl;
  let lastSource = null;
  let activeTheme = null;
  let palette = null;
  let request = 0;
  let timer = 0;
  let internal = false;

  const safeUrl = () => {
    try { return getCoverUrl() || null; } catch (err) { return null; }
  };
  const clearTimer = () => {
    if (timer) { clearTimeout(timer); timer = 0; }
  };
  const publish = () => emit({
    url: lastUrl === undefined ? null : lastUrl,
    palette,
    theme: activeTheme,
    preferred,
    fallback,
    available: !!activeTheme,
    active: !!activeTheme && getState().theme === 'cover',
  });

  // 无封面：清空动态主题并回退到选择封面前的主题（保持 preferred 以便自动恢复）
  function fallbackNow() {
    clearTimer();
    if (!preferred || getState().theme !== 'cover') return;
    internal = true;
    try { store({ theme: fallback }); } finally { internal = false; }
    lastThemeId = fallback;
    // 视觉回退是临时的：持久化层仍保留用户对封面主题的偏好
    if (persistTheme) persistTheme('cover');
  }

  // 有封面且用户仍期望封面主题：自动恢复
  function restoreCover() {
    if (!preferred) return;
    if (getState().theme !== 'cover') {
      internal = true;
      try { store({ theme: 'cover' }); } finally { internal = false; }
      lastThemeId = 'cover';
    }
    themeCtrl.setTheme('cover', true);
  }

  async function sync(force = false) {
    const url = safeUrl();
    const source = getState().source || 'none';
    if (!force && url === lastUrl && source === lastSource) { publish(); return; }
    lastUrl = url;
    lastSource = source;
    clearTimer();
    const token = ++request;

    if (!url) {
      activeTheme = null;
      palette = null;
      applyCoverTheme(null);
      // 启动时（source=none）保留封面选择；真正播放无封面曲目后再延时回退
      if (preferred && source !== 'none') {
        timer = setTimeout(() => {
          timer = 0;
          if (token === request) { fallbackNow(); publish(); }
        }, FALLBACK_DELAY);
      }
      publish();
      return;
    }

    const next = await loadCoverPalette(url);
    if (token !== request) return;
    if (!next || !next.length) {
      activeTheme = null;
      palette = null;
      applyCoverTheme(null);
      fallbackNow();
      publish();
      return;
    }

    palette = next;
    activeTheme = buildThemeFromPalette(next, fallback);
    applyCoverTheme(activeTheme);
    if (preferred) restoreCover();
    publish();
  }

  // 封面 URL 由 meta/source/currentIndex 间接驱动；URL 相同则无需重算
  const onTrackChange = () => { sync(false).catch(() => {}); };
  subscribe('meta', onTrackChange);
  subscribe('source', onTrackChange);
  subscribe('currentIndex', onTrackChange);

  subscribe('theme', (id) => {
    if (internal) {
      lastThemeId = id;
      publish();
      return;
    }
    if (id === 'cover') {
      if (lastThemeId !== 'cover' && isStatic(lastThemeId)) fallback = lastThemeId;
      preferred = true;
      lastThemeId = 'cover';
      publish();
      sync(true).catch(() => {});
      return;
    }
    preferred = false;
    if (isStatic(id)) fallback = id;
    lastThemeId = id;
    clearTimer();
    publish();
  });

  sync(true).catch(() => {});

  return {
    get active() { return !!activeTheme && getState().theme === 'cover'; },
    get palette() { return palette; },
    get theme() { return activeTheme; },
    refresh: () => sync(true),
  };
}
