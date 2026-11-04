/* 歌词来源：读取 .lrc（UTF-8 → GBK 回退）、解码内嵌 USLT、按路径/基名匹配音频。 */
/* 仅依赖 File/Blob/TextDecoder 与 ID3 解析器，不触碰 DOM。 */

import { parseTags } from '../audio/id3.js';

const LRC_RE = /\.lrc$/i;

export function isLrcFile(file) {
  return !!file && LRC_RE.test(String(file.name || ''));
}

// 字节解码：优先严格 UTF-8，失败再用 GBK；都失败时才宽松 UTF-8
export function decodeLrcBytes(input) {
  let bytes;
  try {
    bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  } catch (err) {
    return '';
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (err) {
    try {
      return new TextDecoder('gbk').decode(bytes);
    } catch (err2) {
      try { return new TextDecoder('utf-8').decode(bytes); } catch (err3) { return ''; }
    }
  }
}

export async function readLrcFile(file) {
  if (!file) return '';
  try {
    if (typeof file.arrayBuffer === 'function') {
      return decodeLrcBytes(await file.arrayBuffer());
    }
    if (typeof file.text === 'function') return await file.text();
  } catch (err) { /* 读取失败按空歌词处理 */ }
  return '';
}

// 内嵌 USLT：直接复用 parseTags（ID3 解析已包含 USLT 帧）
export async function readEmbeddedLyrics(file) {
  try {
    const tag = await parseTags(file);
    return tag && typeof tag.lyrics === 'string' ? tag.lyrics : '';
  } catch (err) {
    return '';
  }
}

function relPath(file) {
  return String(file.webkitRelativePath || file.relativePath || file.name || '');
}

function dirOf(path) {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

function baseOf(path) {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return name.replace(/\.[^.]+$/, '').toLowerCase();
}

function keyOf(file) {
  const path = relPath(file);
  return `${dirOf(path)}/${baseOf(path)}`.toLowerCase();
}

function hasDir(file) {
  return dirOf(relPath(file)) !== '';
}

/**
 * 音频与歌词配对：优先「同目录 + 同基名」，目录信息缺失（普通多选）时退回仅基名。
 * 基名比较忽略大小写与扩展名；返回顺序与 audioFiles 一致。
 * @returns {Array<{audio:File, lrc:File}>}
 */
export function matchLrcFiles(audioFiles, otherFiles) {
  const audios = Array.from(audioFiles || []).filter(Boolean);
  const lrcs = Array.from(otherFiles || []).filter(isLrcFile);
  if (!audios.length || !lrcs.length) return [];

  const exact = new Map();
  const loose = new Map();
  for (const lrc of lrcs) {
    exact.set(keyOf(lrc), lrc);
    const base = baseOf(relPath(lrc));
    if (!loose.has(base)) loose.set(base, lrc);
  }

  const pairs = [];
  for (const audio of audios) {
    let lrc = exact.get(keyOf(audio));
    if (!lrc) {
      const looseLrc = loose.get(baseOf(relPath(audio)));
      // 仅当至少一方缺少目录信息时才允许跨目录按基名兜底，避免误配不同文件夹的同名曲目
      if (looseLrc && (!hasDir(audio) || !hasDir(looseLrc))) lrc = looseLrc;
    }
    if (lrc) pairs.push({ audio, lrc });
  }
  return pairs;
}

// 拖入音频 + 歌词（或单独一份歌词）时配对并写入播放列表；返回成功绑定数
export async function bindLrcFiles(audioFiles, lrcFiles, playlist) {
  if (!playlist) return 0;
  const audios = Array.from(audioFiles || []).filter(Boolean);
  const lrcs = Array.from(lrcFiles || []).filter(isLrcFile);
  if (!lrcs.length) return 0;
  const pool = audios.length
    ? audios
    : playlist.items.map((it) => it.file).filter(Boolean);
  let pairs = matchLrcFiles(pool, lrcs);
  // 单独拖入一份歌词时无条件应用到当前曲目
  if (!pairs.length && !audios.length && lrcs.length === 1
      && playlist.current && playlist.current.file) {
    pairs = [{ audio: playlist.current.file, lrc: lrcs[0] }];
  }
  let bound = 0;
  for (const { audio, lrc } of pairs) {
    const text = await readLrcFile(lrc);
    if (text && playlist.setLyrics(audio, text)) bound++;
  }
  return bound;
}
