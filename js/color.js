/* 封面主题取色：纯函数，不依赖 DOM，可在 Node 中直接 import。 */
/* extractPalette 统计主色，buildThemeFromPalette 派生与 THEMES 同形状的动态主题。 */

// 静态主题副本：供空调色板回退使用，保持本模块自包含（Node data: URL 导入无相对依赖）
const BASE_THEMES = {
  neon: {
    id: 'neon', label: '霓虹',
    hue: 202, window: 360, spread: 26,
    bg: ['#0a1222', '#05070e', '#03040a'],
    accent: '#5ce1ff', accent2: '#ff63d8', highlight: '#eaf2ff',
  },
  sunset: {
    id: 'sunset', label: '落日',
    hue: 24, window: 24, spread: -5,
    bg: ['#22101a', '#150810', '#0a0408'],
    accent: '#ff9a5c', accent2: '#ff4d6d', highlight: '#ffe8d6',
  },
  ice: {
    id: 'ice', label: '冰蓝',
    hue: 196, window: 40, spread: 8,
    bg: ['#08151f', '#050d14', '#02070b'],
    accent: '#7fd8ff', accent2: '#9aa8ff', highlight: '#e6f7ff',
  },
  aurora: {
    id: 'aurora', label: '极光',
    hue: 150, window: 60, spread: 12,
    bg: ['#06170f', '#04100e', '#020808'],
    accent: '#5cffc0', accent2: '#8a7dff', highlight: '#eafff5',
  },
};

const DEFAULTS = {
  maxSamples: 4096,   // 下采样目标
  maxColors: 3,
  minHueGap: 25,      // 主色之间最小色相差
  minAlpha: 0.5,      // 低于该 alpha 视为近乎透明
  minValue: 0.08,     // 最大通道低于该值视为过暗
  maxValue: 0.95,     // 最大通道高于该值且最小通道也高，视为近白
  whiteChannel: 0.8,
  minSat: 0.08,       // 近乎灰度不计入
};

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const clamp01 = (v) => clamp(v, 0, 1);
const hueOf = (v) => ((v % 360) + 360) % 360;
const round4 = (v) => Math.round(v * 10000) / 10000;

function hueDist(a, b) {
  const d = Math.abs(hueOf(a) - hueOf(b)) % 360;
  return d > 180 ? 360 - d : d;
}

// 有符号色相差（-180..180）
function signedHue(a, b) {
  return ((hueOf(b) - hueOf(a) + 540) % 360) - 180;
}

function rgbToHsv(r, g, b) {
  const rr = r / 255; const gg = g / 255; const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === rr) h = ((gg - bb) / d) % 6;
    else if (max === gg) h = (bb - rr) / d + 2;
    else h = (rr - gg) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max > 0 ? d / max : 0, v: max };
}

function rgbToHsl(r, g, b) {
  const rr = r / 255; const gg = g / 255; const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d > 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === rr) h = ((gg - bb) / d) % 6;
    else if (max === gg) h = (bb - rr) / d + 2;
    else h = (rr - gg) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: clamp01(s), l };
}

function hslToRgb(h, s, l) {
  const hh = hueOf(h) / 360;
  const ss = clamp01(s);
  const ll = clamp01(l);
  if (ss === 0) {
    const v = Math.round(ll * 255);
    return [v, v, v];
  }
  const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss;
  const p = 2 * ll - q;
  const channel = (t) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [
    Math.round(channel(hh + 1 / 3) * 255),
    Math.round(channel(hh) * 255),
    Math.round(channel(hh - 1 / 3) * 255),
  ];
}

function rgbToHex(r, g, b) {
  const h = (v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

function hslToHex(h, s, l) {
  const [r, g, b] = hslToRgb(h, s, l);
  return rgbToHex(r, g, b);
}

function copyTheme(t) {
  return {
    id: t.id, label: t.label,
    hue: t.hue, window: t.window, spread: t.spread,
    bg: t.bg.slice(), accent: t.accent, accent2: t.accent2, highlight: t.highlight,
  };
}

/**
 * 从 RGBA 像素数组提取主色。
 * @param {Uint8ClampedArray|Array} rgba 长度至少 width*height*4
 * @param {number} width
 * @param {number} height
 * @param {object} [opts]
 * @returns {Array<{r:number,g:number,b:number,h:number,s:number,v:number,weight:number}>}
 */
export function extractPalette(rgba, width, height, opts = {}) {
  const w = Math.max(0, Math.floor(Number(width) || 0));
  const h = Math.max(0, Math.floor(Number(height) || 0));
  if (!rgba || !w || !h || typeof rgba.length !== 'number' || rgba.length < w * h * 4) return [];
  const cfg = Object.assign({}, DEFAULTS, opts || {});
  const maxColors = Math.max(1, Math.floor(Number(cfg.maxColors) || 3));
  const step = Math.max(1, Math.ceil(Math.sqrt((w * h) / Math.max(1, cfg.maxSamples))));

  // 12 色相 × 3 饱和度 × 3 明度桶
  const buckets = new Map();
  for (let y = 0; y < h; y += step) {
    const row = y * w;
    for (let x = 0; x < w; x += step) {
      const i = (row + x) * 4;
      const a = rgba[i + 3] / 255;
      if (a < cfg.minAlpha) continue;
      const r = rgba[i]; const g = rgba[i + 1]; const b = rgba[i + 2];
      const max = Math.max(r, g, b) / 255;
      const min = Math.min(r, g, b) / 255;
      if (max < cfg.minValue) continue;               // 过暗
      if (max > cfg.maxValue && min > cfg.whiteChannel) continue; // 近白
      const hsv = rgbToHsv(r, g, b);
      if (hsv.s < cfg.minSat) continue;               // 灰度/纯色无彩
      const hb = Math.min(11, Math.floor(hsv.h / 30));
      const sb = hsv.s < 1 / 3 ? 0 : hsv.s < 2 / 3 ? 1 : 2;
      const vb = hsv.v < 1 / 3 ? 0 : hsv.v < 2 / 3 ? 1 : 2;
      const key = hb * 9 + sb * 3 + vb;
      let cell = buckets.get(key);
      if (!cell) {
        cell = { r: 0, g: 0, b: 0, n: 0, score: 0 };
        buckets.set(key, cell);
      }
      cell.r += r; cell.g += g; cell.b += b;
      cell.n++;
      cell.score += hsv.s; // 数量 × 饱和度（逐像素累加）
    }
  }
  if (!buckets.size) return [];

  const candidates = [];
  for (const cell of buckets.values()) {
    const r = cell.r / cell.n;
    const g = cell.g / cell.n;
    const b = cell.b / cell.n;
    const hsv = rgbToHsv(r, g, b);
    candidates.push({
      r: Math.round(r), g: Math.round(g), b: Math.round(b),
      h: Math.round(hsv.h * 10) / 10,
      s: round4(hsv.s), v: round4(hsv.v),
      score: cell.score,
      count: cell.n,
    });
  }
  candidates.sort((a, b) => b.score - a.score || b.count - a.count);

  const picked = [];
  for (const c of candidates) {
    if (picked.length >= maxColors) break;
    if (picked.every((p) => hueDist(p.h, c.h) >= cfg.minHueGap)) picked.push(c);
  }
  if (!picked.length) return [];

  const total = picked.reduce((sum, c) => sum + c.score, 0) || 1;
  return picked.map((c) => ({
    r: c.r, g: c.g, b: c.b, h: c.h, s: c.s, v: c.v,
    weight: round4(c.score / total),
  }));
}

// 主色 → 满足亮度/饱和度下限的强调色（也接受仅含色相的互补色）
function accentFrom(color) {
  if (!Number.isFinite(color.r)) {
    const s = clamp(Math.max(Number(color.s) || 0, 0.55), 0, 1);
    return hslToHex(color.h, s, 0.62);
  }
  const hsl = rgbToHsl(color.r, color.g, color.b);
  const s = clamp(Math.max(hsl.s, 0.55), 0, 1);
  const l = clamp(hsl.l, 0.55, 0.72);
  return hslToHex(Number.isFinite(color.h) ? color.h : hsl.h, s, l);
}

/**
 * 由主色列表派生动态主题；空列表回退到 baseId 对应的静态主题。
 * @param {Array} palette extractPalette 的返回值
 * @param {string} [baseId='neon']
 */
export function buildThemeFromPalette(palette, baseId = 'neon') {
  const base = BASE_THEMES[baseId] || BASE_THEMES.neon;
  if (!Array.isArray(palette) || !palette.length) return copyTheme(base);
  const primary = palette[0];
  if (!primary || !Number.isFinite(primary.h)) return copyTheme(base);

  const primaryHue = hueOf(primary.h);
  const second = palette.slice(1).find((c) => c && Number.isFinite(c.h)
    && hueDist(primaryHue, c.h) >= 40);
  const secondHue = second ? hueOf(second.h) : (primaryHue + 180) % 360;
  const delta = signedHue(primaryHue, secondHue); // -180..180
  const primaryHsl = rgbToHsl(primary.r, primary.g, primary.b);
  const ps = clamp01(primary.s != null ? primary.s : primaryHsl.s);

  // 背景：主色低明度、低饱和派生，保证 luma 足够低
  const bg = [
    hslToHex(primaryHue, ps * 0.6, 0.1),
    hslToHex(secondHue, ps * 0.45, 0.065),
    hslToHex(primaryHue, ps * 0.3, 0.03),
  ];

  return {
    id: 'cover',
    label: '封面',
    hue: Math.round(primaryHue) % 360,
    window: clamp(Math.round(40 + Math.abs(delta) * 0.2), 40, 80),
    spread: clamp(Math.round(delta / 4), -30, 30),
    bg,
    accent: accentFrom(primary),
    accent2: accentFrom(second || { h: secondHue, s: ps, v: primary.v }),
    highlight: hslToHex(primaryHue, clamp(primaryHsl.s * 0.6, 0.25, 0.7), 0.9),
  };
}
