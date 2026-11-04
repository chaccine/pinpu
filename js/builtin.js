/* 内置曲目：仅在用户点击时按需下载，转为 File 后复用本地文件的播放与标签解析流程。 */

export const BUILTIN_SONGS = [
  {
    id: 'color-your-night',
    url: 'assets/music/color-your-night.mp3',
    fileName: 'color-your-night.mp3',
    label: 'Color Your Night',
  },
];

// 同一会话内缓存已下载的 File，并复用进行中的请求，避免重复下载
const cache = new Map();
const pending = new Map();

export async function fetchBuiltinFile(song, onProgress) {
  if (!song || !song.url) throw new Error('无效的内置曲目');
  if (cache.has(song.id)) return cache.get(song.id);
  if (pending.has(song.id)) return pending.get(song.id);

  const task = (async () => {
    const res = await fetch(song.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const total = Number(res.headers.get('content-length')) || 0;
    let blob;
    if (res.body && res.body.getReader && typeof onProgress === 'function') {
      const reader = res.body.getReader();
      const chunks = [];
      let loaded = 0;
      if (total) onProgress(0);
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.length;
        if (total) onProgress(Math.min(loaded / total, 1));
      }
      blob = new Blob(chunks, { type: 'audio/mpeg' });
      onProgress(1);
    } else {
      blob = await res.blob();
      if (typeof onProgress === 'function') onProgress(1);
    }
    const file = new File([blob], song.fileName, { type: 'audio/mpeg' });
    cache.set(song.id, file);
    return file;
  })();

  pending.set(song.id, task);
  try {
    return await task;
  } finally {
    pending.delete(song.id);
  }
}
