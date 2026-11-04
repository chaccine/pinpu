/* 播放列表模型：多文件/文件夹加入、四种播放模式、上/下一首、自动续播、封面 objectURL 管理、 */
/* Media Session 与 document.title 同步。结构变化通过 onChange 回调通知 UI，标量状态写入 store。 */

import { parseTags } from './audio/id3.js';
import { getState, set as setState, subscribe } from './state.js';

export const LOOP_MODES = [
  { id: 'order', label: '顺序播放', short: '顺序' },
  { id: 'repeat', label: '列表循环', short: '循环' },
  { id: 'single', label: '单曲循环', short: '单曲' },
  { id: 'shuffle', label: '随机播放', short: '随机' },
];

const PAGE_TITLE = '频谱 · 音乐可视化';

function baseName(name) {
  return String(name || '').replace(/\.[^.]+$/, '') || '未命名曲目';
}

export class Playlist {
  constructor(engine) {
    this.engine = engine;
    this.items = [];
    this.index = -1;
    this._listeners = [];
    this._metaToken = 0;

    engine.onEnded(() => this._handleEnded());
    subscribe('playing', () => this._syncMediaState());
    this._setupMediaSession();
  }

  get length() { return this.items.length; }
  get current() { return this.index >= 0 ? this.items[this.index] : null; }
  get loopMode() { return getState().loopMode || 'order'; }
  get hasPlayable() { return this.items.some((it) => it.file); }

  onChange(fn) { this._listeners.push(fn); }
  _emit() { this._listeners.forEach((fn) => fn()); }

  _sync() {
    setState({
      playlistLength: this.items.length,
      currentIndex: this.index,
      loopMode: this.loopMode,
    });
  }

  // ---- 播放模式 ----
  setLoopMode(id) {
    if (!LOOP_MODES.some((m) => m.id === id)) return;
    setState({ loopMode: id });
    this._emit();
  }

  cycleLoopMode() {
    const i = LOOP_MODES.findIndex((m) => m.id === this.loopMode);
    const next = LOOP_MODES[(i + 1) % LOOP_MODES.length];
    this.setLoopMode(next.id);
    return next;
  }

  // ---- 加入曲目 ----
  addFiles(files, { autoplay = true } = {}) {
    const list = Array.isArray(files) ? files : Array.from(files || []);
    const added = [];
    for (const f of list) {
      if (!this.engine.isAudioFile(f)) continue;
      added.push({
        file: f, name: f.name, title: '', artist: '', album: '',
        coverUrl: null, coverMime: '', parsed: false, duration: NaN, placeholder: false,
      });
    }
    if (!added.length) return 0;
    // 刷新后恢复的占位项在首次添加真实文件时清掉
    if (this.items.length && this.items.every((it) => it.placeholder)) {
      this.items = [];
      this.index = -1;
    }
    const firstNew = this.items.length;
    this.items.push(...added);
    this._sync();
    this._emit();
    added.forEach((item, k) => this._parseMeta(firstNew + k));
    const src = getState().source;
    if (autoplay && (this.index < 0 || src === 'none' || src === 'demo')) {
      this.playIndex(firstNew);
    }
    return added.length;
  }

  // 刷新后恢复曲目名（无文件对象，仅展示占位）
  restoreNames(names) {
    if (!Array.isArray(names) || !names.length || this.items.length) return 0;
    this.items = names.map((name) => ({
      file: null, name: String(name), title: '', artist: '', album: '',
      coverUrl: null, coverMime: '', parsed: true, duration: NaN, placeholder: true,
    }));
    this.index = -1;
    this._sync();
    this._emit();
    return this.items.length;
  }

  names() { return this.items.map((it) => it.name); }

  // 预加载时长（列表显示用）：临时 Audio 只读元数据，读完即释放 objectURL
  _loadDuration(i) {
    const item = this.items[i];
    if (!item || !item.file || Number.isFinite(item.duration)) return;
    try {
      const url = URL.createObjectURL(item.file);
      const probe = new Audio();
      probe.preload = 'metadata';
      const done = () => {
        URL.revokeObjectURL(url);
        probe.removeEventListener('loadedmetadata', done);
        probe.removeEventListener('error', done);
      };
      probe.addEventListener('loadedmetadata', () => {
        const cur = this.items[i];
        if (cur === item && Number.isFinite(probe.duration)) {
          item.duration = probe.duration;
          this._emit();
        }
        done();
      });
      probe.addEventListener('error', done);
      probe.src = url;
    } catch (err) { /* 环境不支持则忽略 */ }
  }

  // 预载下一首的时长与元数据
  preloadNext() {
    const n = this.items.length;
    if (this.index < 0 || !n) return;
    const ni = this._pickNext(false);
    if (ni >= 0 && ni !== this.index) {
      this._loadDuration(ni);
      if (!this.items[ni].parsed) this._parseMeta(ni);
    }
  }

  // ---- 拖动排序 ----
  move(from, to) {
    const n = this.items.length;
    if (from === to || from < 0 || to < 0 || from >= n || to >= n) return;
    const [item] = this.items.splice(from, 1);
    this.items.splice(to, 0, item);
    if (from === this.index) this.index = to;
    else if (from < this.index && to >= this.index) this.index--;
    else if (from > this.index && to <= this.index) this.index++;
    this._sync();
    this._emit();
  }

  // 异步解析标签与封面；失败静默降级为文件名
  async _parseMeta(i) {
    const item = this.items[i];
    if (!item || item.parsed || !item.file) return;
    item.parsed = true;
    const token = ++this._metaToken;
    let tag = null;
    try { tag = await parseTags(item.file); } catch (err) { tag = null; }
    if (!this.items[i] || this.items[i] !== item) return;
    if (tag) {
      item.title = tag.title || '';
      item.artist = tag.artist || '';
      item.album = tag.album || '';
      if (tag.picture && tag.picture.bytes && tag.picture.bytes.length) {
        if (item.coverUrl) URL.revokeObjectURL(item.coverUrl);
        try {
          item.coverMime = tag.picture.mime || 'image/jpeg';
          item.coverUrl = URL.createObjectURL(
            new Blob([tag.picture.bytes], { type: item.coverMime }));
        } catch (err) { item.coverUrl = null; }
      }
    }
    void token;
    this._emit();
    if (i === this.index) this.updateNowPlaying();
  }

  // ---- 播放控制 ----
  // 返回 'played' | 'loaded' | 'placeholder' | false
  async playIndex(i, autoplay = true) {
    const item = this.items[i];
    if (!item) return false;
    if (!item.file) return 'placeholder';
    this.index = i;
    this._sync();
    this._emit();
    const res = await this.engine.loadFile(item.file, autoplay);
    if (res === 'played' || res === 'loaded') {
      if (!item.parsed) await this._parseMeta(i);
      this.updateNowPlaying();
      this.preloadNext();
    }
    return res === 'played' || res === 'loaded' ? res : false;
  }

  _pickNext(auto) {
    const mode = this.loopMode;
    const n = this.items.length;
    if (!n) return -1;
    if (mode === 'single' && auto) return this.index;
    if (mode === 'shuffle' && n > 1) {
      let r = this.index;
      while (r === this.index) r = Math.floor(Math.random() * n);
      return r;
    }
    const nxt = this.index + 1;
    if (nxt >= n) return mode === 'repeat' ? 0 : -1;
    return nxt;
  }

  async next(auto = false) {
    const i = this._pickNext(auto);
    if (i < 0) {
      this.engine.pause();
      return false;
    }
    return this.playIndex(i);
  }

  async prev() {
    if (getState().source === 'file' && this.engine.currentTime > 3) {
      this.engine.seekRatio(0);
      return true;
    }
    const n = this.items.length;
    if (!n) return false;
    let i = this.index - 1;
    if (i < 0) i = this.loopMode === 'repeat' ? n - 1 : 0;
    return this.playIndex(i);
  }

  _handleEnded() {
    if (getState().source !== 'file' || !this.items.length) return;
    if (this.loopMode === 'single') { this.playIndex(this.index); return; }
    this.next(true);
  }

  // ---- 删除 / 清空 ----
  removeAt(i) {
    const item = this.items[i];
    if (!item) return;
    if (item.coverUrl) URL.revokeObjectURL(item.coverUrl);
    const wasCurrent = i === this.index;
    const wasPlaying = wasCurrent && getState().playing;
    this.items.splice(i, 1);
    if (wasCurrent) {
      this.index = -1;
      if (getState().source === 'file') this.engine.stopSources();
      if (this.items.length) this.playIndex(Math.min(i, this.items.length - 1), wasPlaying);
    } else if (i < this.index) {
      this.index--;
    }
    this._sync();
    this._emit();
    if (!this.items.length) this.updateNowPlaying();
  }

  clear() {
    this.items.forEach((it) => { if (it.coverUrl) URL.revokeObjectURL(it.coverUrl); });
    this.items = [];
    this.index = -1;
    // 只暂停文件音源；演示曲/麦克风与播放列表互不干扰
    if (getState().source === 'file') this.engine.stopSources();
    this.updateNowPlaying();
    this._sync();
    this._emit();
  }

  // ---- 正在播放：store.meta / document.title / Media Session ----
  updateNowPlaying() {
    const item = this.current;
    if (!item || !item.file) {
      setState({ meta: { title: '', artist: '', hasCover: false } });
      document.title = PAGE_TITLE;
      this._setMediaMetadata(null);
      return;
    }
    const title = item.title || baseName(item.name);
    setState({
      meta: { title, artist: item.artist || '', hasCover: !!item.coverUrl },
    });
    document.title = item.artist ? `${title} - ${item.artist} · 频谱` : `${title} · 频谱`;
    this._setMediaMetadata(item, title);
  }

  _setMediaMetadata(item, title) {
    if (!('mediaSession' in navigator)) return;
    try {
      if (!item) { navigator.mediaSession.metadata = null; return; }
      const artwork = item.coverUrl
        ? [{ src: item.coverUrl, sizes: '512x512', type: item.coverMime || 'image/jpeg' }]
        : [];
      navigator.mediaSession.metadata = new MediaMetadata({
        title,
        artist: item.artist || '',
        album: item.album || '',
        artwork,
      });
    } catch (err) { /* 环境不支持则忽略 */ }
  }

  _setupMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const set = (name, fn) => {
      try { navigator.mediaSession.setActionHandler(name, fn); } catch (err) { /* 部分浏览器不支持 */ }
    };
    set('play', () => this._resumeFromSession());
    set('pause', () => this.engine.pause());
    set('previoustrack', () => this.prev());
    set('nexttrack', () => this.next(false));
    set('seekto', (d) => { if (d && Number.isFinite(d.seekTime)) this.engine.seekTo(d.seekTime); });
    set('seekbackward', (d) => this.engine.seekBy(-(d && Number.isFinite(d.seekOffset) ? d.seekOffset : 5)));
    set('seekforward', (d) => this.engine.seekBy(d && Number.isFinite(d.seekOffset) ? d.seekOffset : 5));
  }

  _resumeFromSession() {
    if (getState().source === 'file') this.engine.resume();
    else if (this.index >= 0 && this.current && this.current.file) this.playIndex(this.index);
    else this.engine.resume();
  }

  _syncMediaState() {
    if (!('mediaSession' in navigator)) return;
    try { navigator.mediaSession.playbackState = getState().playing ? 'playing' : 'paused'; } catch (err) { /* ignore */ }
  }
}
