/* LRC 歌词解析：纯函数、无 DOM 依赖，浏览器与 Node 均可直接 import。 */
/* 支持 [mm:ss]/[mm:ss.xx]/[mm:ss.xxx]、一行多时间戳、[offset:±ms]、元信息、BOM/CRLF。 */

// 时间标签：[分:秒] 或 [分:秒.小数]，小数位数决定精度（.5=.5s，.05=.05s）
const TIME_RE = /\[(\d{1,3}):(\d{1,2})(?:\.(\d{1,3}))?\]/g;
// 只识别需求中的四项元信息，其余 [by:...] 等标签按无效行忽略
const META_RE = /^\s*\[(ti|ar|al|offset)\s*:\s*([^\]]*)\]\s*$/i;

function timeOf(min, sec, frac) {
  const f = frac ? Number(`0.${frac}`) : 0;
  return Number(min) * 60 + Number(sec) + f;
}

/**
 * 解析 LRC 文本。
 * offset 语义遵循 LRC 惯例：effectiveTime = 标签时间 - offset（正值让歌词提前）。
 * @returns {{lines: Array<{time:number,text:string}>, meta:{ti:string,ar:string,al:string,offset:number}}}
 */
export function parseLRC(text) {
  const result = { lines: [], meta: { ti: '', ar: '', al: '', offset: 0 } };
  if (text == null) return result;

  // 去掉 BOM；兼容 CRLF、CR、LF
  const src = String(text).replace(/^\uFEFF/, '');
  const rows = src.split(/\r\n|\r|\n/);
  const raw = [];

  for (const row of rows) {
    const line = row.trim();
    if (!line) continue;

    const meta = META_RE.exec(line);
    if (meta) {
      const key = meta[1].toLowerCase();
      const val = meta[2].trim();
      if (key === 'offset') {
        const n = Number(val);
        if (Number.isFinite(n)) result.meta.offset = n;
      } else {
        result.meta[key] = val;
      }
      continue;
    }

    // 收集本行的时间戳，并把时间标签从歌词文本中剔除
    const times = [];
    const parts = [];
    let last = 0;
    let m;
    TIME_RE.lastIndex = 0;
    while ((m = TIME_RE.exec(line))) {
      times.push(timeOf(m[1], m[2], m[3]));
      parts.push(line.slice(last, m.index));
      last = TIME_RE.lastIndex;
    }
    if (!times.length) continue;
    parts.push(line.slice(last));
    const content = parts.join('').trim();
    if (!content) continue;
    for (const t of times) raw.push({ time: t, text: content, order: raw.length });
  }

  const offset = result.meta.offset / 1000;
  result.lines = raw
    .map((r) => ({ time: Math.max(0, r.time - offset), text: r.text, order: r.order }))
    .sort((a, b) => a.time - b.time || a.order - b.order)
    .map(({ time, text }) => ({ time, text }));
  return result;
}

/**
 * 二分查找当前行：返回最后一个 time <= t 的下标；t 早于首行返回 -1。
 * lines 需按 time 升序（parseLRC 已排序）。
 */
export function findLineIndex(lines, t) {
  if (!Array.isArray(lines) || !lines.length || !Number.isFinite(t)) return -1;
  if (t < lines[0].time) return -1;
  let lo = 0;
  let hi = lines.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].time <= t) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}
