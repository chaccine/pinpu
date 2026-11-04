/* 拖拽载入：递归读取文件夹（webkitGetAsEntry，降级 DataTransfer.files）。 */
/* 只负责收集文件与显隐遮罩，具体处理交给 onFiles 回调。 */

export function initDrop({ veil, onFiles } = {}) {
  const notify = typeof onFiles === 'function' ? onFiles : () => {};

  function readEntry(entry) {
    if (!entry) return Promise.resolve([]);
    if (entry.isFile) {
      return new Promise((resolve) => {
        entry.file((f) => resolve([f]), () => resolve([]));
      });
    }
    if (entry.isDirectory) {
      return new Promise((resolve) => {
        const reader = entry.createReader();
        const out = [];
        const step = () => {
          reader.readEntries(async (ents) => {
            if (!ents.length) { resolve(out); return; }
            for (const en of ents) {
              out.push(...await readEntry(en));
              if (out.length > 2000) break;
            }
            step();
          }, () => resolve(out));
        };
        step();
      });
    }
    return Promise.resolve([]);
  }

  async function collect(dt) {
    if (!dt) return [];
    const entries = [];
    if (dt.items && dt.items.length) {
      for (const item of dt.items) {
        if (item.kind !== 'file') continue;
        const en = item.webkitGetAsEntry && item.webkitGetAsEntry();
        if (en) entries.push(en);
      }
    }
    if (entries.length) {
      const files = [];
      for (const en of entries) {
        files.push(...await readEntry(en));
        if (files.length > 2000) break;
      }
      return files;
    }
    return Array.from(dt.files || []);
  }

  let depth = 0;
  const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');

  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth++;
    if (veil) veil.classList.add('show');
  });
  window.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (depth === 0 && veil) veil.classList.remove('show');
  });
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    depth = 0;
    if (veil) veil.classList.remove('show');
    let files = [];
    try { files = await collect(e.dataTransfer); } catch (err) { files = []; }
    if (files.length) notify(files);
  });
}
