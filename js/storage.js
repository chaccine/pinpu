/* 设置持久化：localStorage 封装，key 前缀 pinpu.v2.，所有读写 try/catch。 */
/* 隐私模式/禁用存储时降级为内存 Map；带 schema 版本号，便于向前兼容迁移。 */

const PREFIX = 'pinpu.v2.';
const SCHEMA_KEY = PREFIX + 'schema';
export const SCHEMA_VERSION = 1;

const memory = new Map();
let usable = null;

function storageAvailable() {
  if (usable !== null) return usable;
  try {
    const k = PREFIX + '__test__';
    window.localStorage.setItem(k, '1');
    window.localStorage.removeItem(k);
    usable = true;
  } catch (err) {
    usable = false;
  }
  return usable;
}

export function load(key, fallback) {
  const full = PREFIX + key;
  try {
    if (storageAvailable()) {
      const raw = window.localStorage.getItem(full);
      if (raw == null) return fallback;
      return JSON.parse(raw);
    }
  } catch (err) { /* 解析失败按缺省处理 */ }
  if (memory.has(full)) return memory.get(full);
  return fallback;
}

export function save(key, value) {
  const full = PREFIX + key;
  memory.set(full, value);
  try {
    if (storageAvailable()) window.localStorage.setItem(full, JSON.stringify(value));
  } catch (err) { /* 写满/禁用时仅保留内存副本 */ }
}

export function remove(key) {
  const full = PREFIX + key;
  memory.delete(full);
  try {
    if (storageAvailable()) window.localStorage.removeItem(full);
  } catch (err) { /* ignore */ }
}

// 读取 schema 版本；不匹配时由调用方决定是否迁移/清空
export function schemaVersion() {
  return load('schema', 0);
}

export function writeSchema() {
  save('schema', SCHEMA_VERSION);
}

// 恢复默认：清除全部 pinpu.v2. 键
export function clearAll() {
  memory.clear();
  try {
    if (!storageAvailable()) return;
    const drop = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(PREFIX)) drop.push(k);
    }
    drop.forEach((k) => window.localStorage.removeItem(k));
  } catch (err) { /* ignore */ }
}
