/* 手写音频标签解析器：ID3v2.2/2.3/2.4（TIT2/TPE1/TALB/APIC 及 v2.2 的 TT2/TP1/TAL/PIC）， */
/* 支持 4 种文本编码、同步安全整数、扩展头、整体/帧级去同步化；另附 FLAC（Vorbis Comment + PICTURE）。 */
/* 仅用 file.slice 读取标签区间，不整文件载入；任何异常都返回 null/部分结果，绝不抛出。 */

// ---- 整数读取 ----
function synchsafe(b, o) {
  return ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);
}
function uint32(b, o) { return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0; }
function uint24(b, o) { return ((b[o] << 16) | (b[o + 1] << 8) | b[o + 2]) >>> 0; }
function uint32le(b, o) { return ((b[o + 3] << 24) | (b[o + 2] << 16) | (b[o + 1] << 8) | b[o]) >>> 0; }
function ascii(b, o, n) {
  let s = '';
  for (let i = 0; i < n; i++) s += String.fromCharCode(b[o + i]);
  return s;
}

// 去同步化：把 FF 00 还原为 FF
function deunsync(bytes) {
  const out = new Uint8Array(bytes.length);
  let j = 0;
  for (let i = 0; i < bytes.length; i++) {
    out[j++] = bytes[i];
    if (bytes[i] === 0xff && bytes[i + 1] === 0x00) i++;
  }
  return out.subarray(0, j);
}

// 文本解码：0=ISO-8859-1 1=UTF-16(带BOM) 2=UTF-16BE 3=UTF-8
function decodeText(bytes, encoding) {
  const label = encoding === 0 ? 'iso-8859-1'
    : encoding === 1 ? 'utf-16'
      : encoding === 2 ? 'utf-16be' : 'utf-8';
  let text = '';
  try {
    text = new TextDecoder(label).decode(bytes);
  } catch (err) {
    try { text = new TextDecoder('utf-8').decode(bytes); } catch (e2) { return ''; }
  }
  return text.replace(/\0+$/g, '').replace(/^\uFEFF/, '').trim();
}

// 找描述/_mime 的结束位置（宽编码按 2 字节对齐找 00 00）
function findTerm(buf, start, encoding) {
  const wide = encoding === 1 || encoding === 2;
  if (wide) {
    for (let i = start; i + 1 < buf.length; i += 2) {
      if (buf[i] === 0 && buf[i + 1] === 0) return i;
    }
    return buf.length;
  }
  for (let i = start; i < buf.length; i++) if (buf[i] === 0) return i;
  return buf.length;
}

function readPicture(tag, payload, encoding, isV2) {
  let p = 1; // 跳过编码字节
  let mime = '';
  if (isV2) {
    const fmt = ascii(payload, p, 3).toUpperCase();
    mime = fmt === 'PNG' ? 'image/png' : `image/${fmt.toLowerCase()}`;
    if (fmt === 'JPG') mime = 'image/jpeg';
    p += 3;
  } else {
    const end = findTerm(payload, p, 0);
    mime = ascii(payload, p, end - p).toLowerCase() || 'image/jpeg';
    p = end + 1;
  }
  p += 1; // picture type
  const descEnd = findTerm(payload, p, encoding);
  p = descEnd + (encoding === 1 || encoding === 2 ? 2 : 1);
  if (p >= payload.length) return;
  const bytes = payload.subarray(p);
  if (bytes.length > 0) tag.picture = { mime, bytes };
}

function handleFrame(tag, id, payload, major) {
  if (payload.length === 0) return;
  const enc = payload[0];
  if (id === 'TIT2' || id === 'TT2') tag.title = decodeText(payload.subarray(1), enc);
  else if (id === 'TPE1' || id === 'TP1') tag.artist = decodeText(payload.subarray(1), enc);
  else if (id === 'TALB' || id === 'TAL') tag.album = decodeText(payload.subarray(1), enc);
  else if (id === 'APIC') readPicture(tag, payload, enc, false);
  else if (id === 'PIC') readPicture(tag, payload, enc, true);
}

// ---- ID3v2 ----
export async function parseID3(file) {
  try {
    const head = new Uint8Array(await file.slice(0, 10).arrayBuffer());
    if (head.length < 10 || head[0] !== 0x49 || head[1] !== 0x44 || head[2] !== 0x33) return null;
    const major = head[3];
    if (major < 2 || major > 4) return null;
    const flags = head[5];
    const size = synchsafe(head, 6);
    if (size <= 0) return null;
    const body = new Uint8Array(await file.slice(10, 10 + size).arrayBuffer());
    const data = (flags & 0x80) ? deunsync(body) : body;

    const tag = { title: '', artist: '', album: '', picture: null };
    let off = 0;

    // 扩展头：v3 的 size 不含自身 4 字节；v4 的 size 含自身
    if (major >= 3 && (flags & 0x40) && data.length > 4) {
      off = major === 3 ? 4 + uint32(data, 0) : synchsafe(data, 0);
    }

    const hdrLen = major === 2 ? 6 : 10;
    while (off + hdrLen <= data.length) {
      let id; let fsize; let format = 0;
      if (major === 2) {
        id = ascii(data, off, 3);
        fsize = uint24(data, off + 3);
      } else {
        id = ascii(data, off, 4);
        fsize = major === 4 ? synchsafe(data, off + 4) : uint32(data, off + 4);
        format = data[off + 9];
      }
      off += hdrLen;
      if (!id || id.charCodeAt(0) === 0) break; // 进入填充区

      // 压缩/加密帧无法解出，跳过
      const compressed = major === 4 ? (format & 0x08) : (major === 3 && (format & 0x80));
      const encrypted = major === 4 ? (format & 0x04) : (major === 3 && (format & 0x40));
      if (compressed || encrypted) { off += fsize; continue; }
      // 分组标识占 1 字节
      if ((major === 4 && (format & 0x40)) || (major === 3 && (format & 0x20))) off += 1;
      // v4 数据长度指示器占 4 字节
      if (major === 4 && (format & 0x01)) off += 4;

      if (fsize <= 0 || off + fsize > data.length) break;
      let payload = data.subarray(off, off + fsize);
      if (major === 4 && (format & 0x02)) payload = deunsync(payload);
      off += fsize;
      handleFrame(tag, id, payload, major);
    }
    return tag;
  } catch (err) {
    return null;
  }
}

// ---- FLAC：fLaC + 元数据块（VORBIS_COMMENT=4, PICTURE=6）----
export async function parseFLAC(file) {
  try {
    const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    if (ascii(head, 0, 4) !== 'fLaC') return null;
    const tag = { title: '', artist: '', album: '', picture: null };
    let off = 4;
    for (let guard = 0; guard < 64; guard++) {
      const hb = new Uint8Array(await file.slice(off, off + 4).arrayBuffer());
      if (hb.length < 4) break;
      const last = !!(hb[0] & 0x80);
      const type = hb[0] & 0x7f;
      const len = uint24(hb, 1);
      off += 4;
      if (type === 4 || type === 6) {
        const block = new Uint8Array(await file.slice(off, off + len).arrayBuffer());
        if (type === 4) readVorbis(tag, block);
        else readFlacPicture(tag, block);
      }
      off += len;
      if (last) break;
    }
    return tag;
  } catch (err) {
    return null;
  }
}

function readVorbis(tag, b) {
  let p = 4 + uint32le(b, 0); // vendor
  const count = uint32le(b, p);
  p += 4;
  for (let i = 0; i < count && p + 4 <= b.length; i++) {
    const len = uint32le(b, p);
    p += 4;
    const kv = decodeText(b.subarray(p, p + len), 3);
    p += len;
    const eq = kv.indexOf('=');
    if (eq < 0) continue;
    const key = kv.slice(0, eq).toUpperCase();
    const val = kv.slice(eq + 1).trim();
    if (key === 'TITLE') tag.title = val;
    else if (key === 'ARTIST') tag.artist = val;
    else if (key === 'ALBUM') tag.album = val;
  }
}

function readFlacPicture(tag, b) {
  let p = 8; // type + mime len 前置
  const mimeLen = uint32(b, 4);
  const mime = ascii(b, 8, mimeLen).toLowerCase() || 'image/jpeg';
  p = 8 + mimeLen;
  const descLen = uint32(b, p);
  p += 4 + descLen;
  p += 16; // 宽/高/深/色数
  const dataLen = uint32(b, p);
  p += 4;
  const bytes = b.subarray(p, p + dataLen);
  if (bytes.length > 0) tag.picture = { mime, bytes };
}

// ---- 统一入口：按容器分发，失败返回 null ----
export async function parseTags(file) {
  if (!file) return null;
  try {
    const probe = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    if (probe.length >= 3 && probe[0] === 0x49 && probe[1] === 0x44 && probe[2] === 0x33) {
      return await parseID3(file);
    }
    if (probe.length >= 4 && ascii(probe, 0, 4) === 'fLaC') return await parseFLAC(file);
    return null;
  } catch (err) {
    return null;
  }
}
