/* 通用工具：数学、DOM、时间格式化、环境探测。无业务状态，纯函数为主。 */

export const TAU = Math.PI * 2;

export const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);

export const hueOf = (v) => ((v % 360) + 360) % 360;

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export const isMobile = () =>
  window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 720;

export const prefersReducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function formatTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const total = Math.floor(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// 仅当文本变化时写入，减少无谓的重排
export function setText(el, text) {
  if (el && el.textContent !== text) el.textContent = text;
}

// 线性插值
export const lerp = (a, b, t) => a + (b - a) * t;

// 角度插值（走最短路径），用于色相/主题平滑过渡
export function lerpHue(a, b, t) {
  let d = ((b - a) % 360 + 540) % 360 - 180;
  return hueOf(a + d * t);
}

// 指数逼近系数：与帧率无关的平滑
export const approach = (dt, rate) => 1 - Math.exp(-dt * rate);

// 生成 [min,max) 随机数
export const rand = (min, max) => min + Math.random() * (max - min);

export function shortName(name, max = 28) {
  if (!name) return '';
  return name.length > max ? name.slice(0, max - 2) + '…' : name;
}
