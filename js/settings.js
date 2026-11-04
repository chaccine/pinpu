/* 用户设置：默认值、校验、localStorage 持久化（pinpu.v2.）、恢复默认。 */
/* 只保存可序列化的标量与曲目名列表；文件对象无法持久化，由播放列表恢复为占位项。 */

import { load, save, clearAll, schemaVersion, writeSchema, SCHEMA_VERSION } from './storage.js';
import { isMobile } from './utils.js';

export const DEFAULT_SETTINGS = {
  theme: 'neon',
  mode: 0,
  volume: 1,
  muted: false,
  loopMode: 'order',
  renderer: 'auto',
  sensitivity: 1,
  smoothing: 0.4,
  barsLevel: 'mid',
  density: 'mid',
  showFps: false,
  quality: 'auto',
  playlistOpen: false,
  playlistNames: [],
};

const THEMES = ['neon', 'sunset', 'ice', 'aurora'];
const LOOPS = ['order', 'repeat', 'single', 'shuffle'];
const LEVELS = ['low', 'mid', 'high'];
const QUALITIES = ['auto', 'high', 'low'];
const RENDERERS = ['auto', '2d'];

function oneOf(v, list, fallback) {
  return list.includes(v) ? v : fallback;
}

function num(v, min, max, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

export function sanitizeSettings(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const names = Array.isArray(r.playlistNames)
    ? r.playlistNames.filter((s) => typeof s === 'string').slice(0, 2000)
    : [];
  return {
    theme: oneOf(r.theme, THEMES, DEFAULT_SETTINGS.theme),
    mode: Math.round(num(r.mode, 0, 4, DEFAULT_SETTINGS.mode)),
    volume: num(r.volume, 0, 1, DEFAULT_SETTINGS.volume),
    muted: typeof r.muted === 'boolean' ? r.muted : DEFAULT_SETTINGS.muted,
    loopMode: oneOf(r.loopMode, LOOPS, DEFAULT_SETTINGS.loopMode),
    renderer: oneOf(r.renderer, RENDERERS, DEFAULT_SETTINGS.renderer),
    sensitivity: num(r.sensitivity, 0.5, 2, DEFAULT_SETTINGS.sensitivity),
    smoothing: num(r.smoothing, 0, 0.9, DEFAULT_SETTINGS.smoothing),
    barsLevel: oneOf(r.barsLevel, LEVELS, DEFAULT_SETTINGS.barsLevel),
    density: oneOf(r.density, LEVELS, DEFAULT_SETTINGS.density),
    showFps: typeof r.showFps === 'boolean' ? r.showFps : DEFAULT_SETTINGS.showFps,
    quality: oneOf(r.quality, QUALITIES, DEFAULT_SETTINGS.quality),
    playlistOpen: typeof r.playlistOpen === 'boolean' ? r.playlistOpen : DEFAULT_SETTINGS.playlistOpen,
    playlistNames: names,
  };
}

export const settings = sanitizeSettings(load('settings', {}));

// 首次运行或版本变化：保留可识别字段并写入当前 schema 版本，未知字段自然丢弃
if (schemaVersion() !== SCHEMA_VERSION) {
  writeSchema();
  save('settings', settings);
}

export function updateSettings(patch) {
  Object.assign(settings, sanitizeSettings(Object.assign({}, settings, patch)));
  save('settings', settings);
  return settings;
}

export function resetSettings() {
  clearAll();
  Object.assign(settings, DEFAULT_SETTINGS);
  writeSchema();
  save('settings', settings);
  return settings;
}

// 频谱柱条数（低/中/高）：移动端更少，避免拥挤
export function barsCountFor(level) {
  const map = isMobile()
    ? { low: 40, mid: 56, high: 72 }
    : { low: 56, mid: 80, high: 112 };
  return map[level] || map.mid;
}

export function densityScale(level) {
  return { low: 0.55, mid: 1, high: 1.5 }[level] || 1;
}
