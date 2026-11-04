/* 封面取色 Node 单元测试：通过 data: URL 直接 import 纯函数模块，无 DOM 依赖。 */
/* 运行： node test/color_node_test.mjs   （由 run_all.py 静态检查调用） */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'js', 'color.js'));
const mod = await import('data:text/javascript;base64,' + src.toString('base64'));
const { extractPalette, buildThemeFromPalette } = mod;

let failed = 0;
function check(label, cond, extra = '') {
  if (cond) console.log(`  [PASS] ${label}`);
  else { console.log(`  [FAIL] ${label} ${extra}`); failed++; }
}

function makeImage(w, h, fn) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const [r, g, b, a] = fn(x, y);
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a == null ? 255 : a;
    }
  }
  return data;
}
const solid = (w, h, r, g, b, a) => makeImage(w, h, () => [r, g, b, a]);
const hueGap = (a, b) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

function hexToRgb(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHsl([r, g, b]) {
  const rr = r / 255; const gg = g / 255; const bb = b / 255;
  const max = Math.max(rr, gg, bb); const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2; const d = max - min;
  let h = 0; let s = 0;
  if (d > 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === rr) h = ((gg - bb) / d) % 6;
    else if (max === gg) h = (bb - rr) / d + 2;
    else h = (rr - gg) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s, l };
}
const luma = (hex) => {
  const [r, g, b] = hexToRgb(hex) || [0, 0, 0];
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
};
const isHex = (v) => /^#[0-9a-f]{6}$/i.test(v || '');

// ---- 纯红：单一主色，色相≈0，accent 满足 S/L 下限 ----
const redPal = extractPalette(solid(64, 64, 255, 0, 0), 64, 64);
check('纯红返回一个主色', redPal.length === 1, JSON.stringify(redPal));
check('纯红色相≈0', redPal.length > 0 && Math.min(redPal[0].h, 360 - redPal[0].h) <= 2,
      redPal[0] && String(redPal[0].h));
const redTheme = buildThemeFromPalette(redPal);
const redAccent = rgbToHsl(hexToRgb(redTheme.accent));
check('accent 饱和度≥55%', redAccent.s >= 0.55 - 1e-6, redAccent.s.toFixed(3));
check('accent 亮度≥55%', redAccent.l >= 0.55 - 1e-6, redAccent.l.toFixed(3));

// ---- 红蓝各半：两个主色，色相差距≥25°，权重降序 ----
const half = makeImage(64, 64, (x) => (x < 32 ? [255, 0, 0] : [0, 0, 255]));
const mixPal = extractPalette(half, 64, 64);
check('红蓝图至少两个主色', mixPal.length >= 2, String(mixPal.length));
check('两主色色相差≥25°', mixPal.length >= 2 && hueGap(mixPal[0].h, mixPal[1].h) >= 25,
      mixPal.length >= 2 ? `${mixPal[0].h}/${mixPal[1].h}` : '');
check('主色按权重降序', mixPal.every((c, i) => i === 0 || mixPal[i - 1].weight >= c.weight),
      JSON.stringify(mixPal.map((c) => c.weight)));
check('权重在 0~1 且总和≈1',
      Math.abs(mixPal.reduce((s, c) => s + c.weight, 0) - 1) < 0.01, '');

// ---- 回退：灰度/纯黑/纯白/空数组 ----
check('纯灰返回空', extractPalette(solid(32, 32, 128, 128, 128), 32, 32).length === 0);
check('纯黑返回空', extractPalette(solid(32, 32, 0, 0, 0), 32, 32).length === 0);
check('纯白返回空', extractPalette(solid(32, 32, 255, 255, 255), 32, 32).length === 0);
check('空数组返回空', extractPalette([], 0, 0).length === 0);
check('长度不足返回空', extractPalette([1, 2, 3], 4, 4).length === 0);
check('null 输入不抛异常', extractPalette(null, 8, 8).length === 0);

const fallback = buildThemeFromPalette([]);
check('空色板回退 neon',
      fallback.id === 'neon' && fallback.label === '霓虹' && fallback.accent === '#5ce1ff',
      JSON.stringify(fallback));
check('回退主题字段齐全',
      isHex(fallback.accent) && isHex(fallback.accent2) && isHex(fallback.highlight)
      && Array.isArray(fallback.bg) && fallback.bg.length === 3
      && fallback.bg.every(isHex), JSON.stringify(fallback.bg));
check('null 色板回退 neon', buildThemeFromPalette(null).id === 'neon');

// ---- 半透明/过暗像素被忽略 ----
check('半透明红被忽略', extractPalette(solid(32, 32, 255, 0, 0, 40), 32, 32).length === 0);
check('过暗红被忽略', extractPalette(solid(32, 32, 12, 0, 0), 32, 32).length === 0);
const mixedAlpha = makeImage(32, 32, (x) => (x < 16 ? [255, 0, 0, 20] : [0, 0, 255, 255]));
check('半透明部分不产生主色', extractPalette(mixedAlpha, 32, 32).length === 1
      && hueGap(extractPalette(mixedAlpha, 32, 32)[0].h, 240) < 5);

// ---- 主题形状：字段/颜色格式/背景暗度/窗口与 spread ----
const theme = buildThemeFromPalette(mixPal);
check('主题 id/label', theme.id === 'cover' && theme.label === '封面', `${theme.id}/${theme.label}`);
check('主题颜色均为 #rrggbb',
      [theme.accent, theme.accent2, theme.highlight, ...theme.bg].every(isHex),
      JSON.stringify([theme.accent, theme.accent2, theme.highlight, theme.bg]));
check('背景三色足够暗(luma<0.2)', theme.bg.every((c) => luma(c) < 0.2),
      theme.bg.map((c) => luma(c).toFixed(3)).join(','));
check('hue 取自主色', hueGap(theme.hue, mixPal[0].h) <= 2,
      `${theme.hue}/${mixPal[0].h}`);
check('window 在 40~80', theme.window >= 40 && theme.window <= 80, String(theme.window));
check('spread 在 ±30 内', Math.abs(theme.spread) <= 30, String(theme.spread));
const a2 = rgbToHsl(hexToRgb(theme.accent2));
check('accent2 与主色色相差≥40°', hueGap(a2.h, mixPal[0].h) >= 40,
      `${a2.h.toFixed(1)}/${mixPal[0].h}`);

// ---- 输出字段与类型 ----
check('主色字段齐全',
      redPal.every((c) => ['r', 'g', 'b', 'h', 's', 'v', 'weight'].every((k) => Number.isFinite(c[k]))),
      JSON.stringify(redPal[0]));

process.exit(failed ? 1 : 0);
