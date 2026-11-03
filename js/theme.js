/* 主题系统：定义四套配色（霓虹/落日/冰蓝/极光），提供颜色插值与 CSS 变量应用。 */
/* ThemeController 负责切换时约 400ms 的平滑过渡，逐帧回调渲染器与 CSS。 */

import { clamp, lerp, lerpHue } from './utils.js';

// 每套主题：hue 基准色相、window 色相漂移窗口、spread 分段色相步长、
// bg 背景渐变三色、accent/accent2 UI 强调色、highlight 高光色
export const THEMES = [
  {
    id: 'neon', label: '霓虹',
    hue: 202, window: 360, spread: 26,
    bg: ['#0a1222', '#05070e', '#03040a'],
    accent: '#5ce1ff', accent2: '#ff63d8', highlight: '#eaf2ff',
  },
  {
    id: 'sunset', label: '落日',
    hue: 24, window: 24, spread: -5,
    bg: ['#22101a', '#150810', '#0a0408'],
    accent: '#ff9a5c', accent2: '#ff4d6d', highlight: '#ffe8d6',
  },
  {
    id: 'ice', label: '冰蓝',
    hue: 196, window: 40, spread: 8,
    bg: ['#08151f', '#050d14', '#02070b'],
    accent: '#7fd8ff', accent2: '#9aa8ff', highlight: '#e6f7ff',
  },
  {
    id: 'aurora', label: '极光',
    hue: 150, window: 60, spread: 12,
    bg: ['#06170f', '#04100e', '#020808'],
    accent: '#5cffc0', accent2: '#8a7dff', highlight: '#eafff5',
  },
];

export function themeById(id) {
  return THEMES.find((t) => t.id === id) || THEMES[0];
}

// ---- 颜色工具 ----
export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r, g, b) {
  const h = (v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function lerpHex(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return rgbToHex(lerp(A[0], B[0], t), lerp(A[1], B[1], t), lerp(A[2], B[2], t));
}

// 插值两套主题，得到中间主题（数值线性、色相走最短路径、颜色逐通道）
export function lerpTheme(a, b, t) {
  return {
    id: t < 0.5 ? a.id : b.id,
    label: t < 0.5 ? a.label : b.label,
    hue: lerpHue(a.hue, b.hue, t),
    window: lerp(a.window, b.window, t),
    spread: lerp(a.spread, b.spread, t),
    bg: [lerpHex(a.bg[0], b.bg[0], t), lerpHex(a.bg[1], b.bg[1], t), lerpHex(a.bg[2], b.bg[2], t)],
    accent: lerpHex(a.accent, b.accent, t),
    accent2: lerpHex(a.accent2, b.accent2, t),
    highlight: lerpHex(a.highlight, b.highlight, t),
  };
}

// 将主题写入 CSS 变量（UI 强调色跟随）
export function applyThemeCSS(theme) {
  const root = document.documentElement;
  root.style.setProperty('--accent', theme.accent);
  root.style.setProperty('--accent-2', theme.accent2);
  root.style.setProperty('--fg', theme.highlight);
  root.style.setProperty('--bg', theme.bg[2]);
}

// ---- 过渡控制器 ----
export class ThemeController {
  constructor(onUpdate) {
    this.onUpdate = onUpdate || (() => {});
    this.current = THEMES[0];
    this.from = THEMES[0];
    this.to = THEMES[0];
    this.t = 1;
    this.duration = 0.4;
  }

  get id() { return this.current.id; }

  setTheme(id, animate = true) {
    const target = themeById(id);
    if (target.id === this.to.id && this.t >= 1) return;
    this.from = Object.assign({}, this.current);
    this.to = target;
    this.t = animate ? 0 : 1;
    if (!animate) {
      this.current = target;
      this.onUpdate(this.current);
    }
  }

  // 循环到下一套主题
  cycle() {
    const i = THEMES.findIndex((t) => t.id === this.to.id);
    const next = THEMES[(i + 1) % THEMES.length];
    this.setTheme(next.id);
    return next.id;
  }

  update(dt) {
    if (this.t >= 1) return;
    this.t = Math.min(1, this.t + dt / this.duration);
    // ease-in-out 让过渡更柔和
    const e = this.t < 0.5 ? 2 * this.t * this.t : 1 - Math.pow(-2 * this.t + 2, 2) / 2;
    this.current = lerpTheme(this.from, this.to, e);
    this.onUpdate(this.current);
  }
}
