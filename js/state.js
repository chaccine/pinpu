/* 订阅式状态仓库：保存应用级状态（模式/音源/播放/主题/音量/播放列表等）。 */
/* 提供细粒度订阅（按字段）与整体订阅，UI 模块通过订阅驱动 DOM，避免全局变量互写。 */

const listeners = new Map();   // key -> Set<fn>，key '*' 表示订阅全部
let state = {};

export function initState(initial) {
  state = Object.assign({}, initial);
  return state;
}

export function getState() {
  return state;
}

export function get(key) {
  return state[key];
}

// 写入补丁并通知订阅者；只有真正变化的字段才触发对应回调
export function set(patch) {
  const changed = [];
  for (const k in patch) {
    if (state[k] !== patch[k]) {
      state[k] = patch[k];
      changed.push(k);
    }
  }
  if (!changed.length) return;
  for (const k of changed) {
    const set_ = listeners.get(k);
    if (set_) set_.forEach((fn) => fn(state[k], k, state));
  }
  const all = listeners.get('*');
  if (all) all.forEach((fn) => fn(changed, state));
}

// 订阅某字段（或 '*' 订阅全部变化），返回取消订阅函数
export function subscribe(key, fn) {
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key).add(fn);
  return () => listeners.get(key).delete(fn);
}
