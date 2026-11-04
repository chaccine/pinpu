/* 音频引擎：AudioContext/Analyser/音量总线、来源管理（演示/文件/麦克风）、 */
/* 对数分频、频谱平滑、色相漂移与节拍检测集成。每帧调用 update() 产出只读分析帧 frame， */
/* 渲染层读取 frame 作画；引擎通过 store 写 playing/source，通过回调上报 beat/ended。 */

import { clamp, hueOf, approach, isMobile } from '../utils.js';
import { set as setState, getState } from '../state.js';
import { DemoTrack } from './demo.js';
import { BeatDetector } from './beat.js';

const AUDIO_EXT = /\.(mp3|wav|ogg|oga|m4a|aac|flac|webm|opus|aif|aiff|wma)$/i;

export class AudioEngine {
  constructor(opts = {}) {
    this.barsCount = opts.barsCount || (isMobile() ? 56 : 80);
    this.smoothing = opts.smoothing != null ? opts.smoothing : 0.4;

    this.audioCtx = null;
    this.analyser = null;
    this.inputGain = null;    // 各音源汇入（unity），供 analyser 取信号
    this.volumeGain = null;   // analyser 之后控制音量，不影响可视化强度
    this.bands = [];

    this.audioEl = new Audio();
    this.audioEl.preload = 'auto';
    this.mediaSource = null;
    this.objectUrl = null;
    this.demo = null;
    this.micNode = null;
    this.micStream = null;
    this.sourceToken = 0;

    this.beat = new BeatDetector();
    this._beatListeners = [];
    this._endedListeners = [];

    // 只读分析帧（渲染层每帧读取，避免每帧分配）
    this.frame = {
      bars: new Float32Array(this.barsCount),
      barsTarget: new Float32Array(this.barsCount),
      freq: null,
      wave: null,
      beatPulse: 0,
      energy: 0,
      hueBase: 202,
      hueTarget: 202,
      active: false,
    };

    this.audioEl.addEventListener('ended', () => {
      this._endedListeners.forEach((fn) => fn());
    });
  }

  // ---- 初始化 ----
  ensureAudio() {
    if (!this.audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.audioCtx = new AC();

      this.inputGain = this.audioCtx.createGain();
      this.inputGain.gain.value = 1;

      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = this.smoothing;
      this.analyser.minDecibels = -90;
      this.analyser.maxDecibels = -22;

      this.volumeGain = this.audioCtx.createGain();
      this.volumeGain.gain.value = getState().muted ? 0 : (getState().volume != null ? getState().volume : 1);

      // 音源 → inputGain → analyser → volumeGain → 扬声器
      this.inputGain.connect(this.analyser);
      this.analyser.connect(this.volumeGain);
      this.volumeGain.connect(this.audioCtx.destination);

      this.frame.freq = new Uint8Array(this.analyser.frequencyBinCount);
      this.frame.wave = new Uint8Array(this.analyser.fftSize);
      this.computeBands();
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
    return this.audioCtx;
  }

  // 按对数频率划分柱条，低频更细腻
  computeBands() {
    const binHz = this.audioCtx.sampleRate / this.analyser.fftSize;
    const binCount = this.analyser.frequencyBinCount;
    const minHz = 24, maxHz = 16000;
    const N = this.barsCount;
    this.bands = [];
    for (let i = 0; i < N; i++) {
      const f0 = minHz * Math.pow(maxHz / minHz, i / N);
      const f1 = minHz * Math.pow(maxHz / minHz, (i + 1) / N);
      const a = clamp(Math.floor(f0 / binHz), 1, binCount - 1);
      const b = clamp(Math.ceil(f1 / binHz), a + 1, binCount);
      this.bands.push([a, b]);
    }
  }

  setBarsCount(n) {
    if (n === this.barsCount) return;
    this.barsCount = n;
    this.frame.bars = new Float32Array(n);
    this.frame.barsTarget = new Float32Array(n);
    if (this.analyser) this.computeBands();
  }

  setSmoothing(v) {
    this.smoothing = v;
    if (this.analyser) this.analyser.smoothingTimeConstant = v;
  }

  readSpectrum() {
    const N = this.barsCount;
    const freq = this.frame.freq;
    const target = this.frame.barsTarget;
    for (let i = 0; i < N; i++) {
      const band = this.bands[i];
      let sum = 0;
      for (let j = band[0]; j < band[1]; j++) sum += freq[j];
      let v = sum / ((band[1] - band[0]) * 255);
      v = Math.pow(v, 0.82) * (1 + (i / N) * 0.45);
      target[i] = clamp(v, 0, 1);
    }
  }

  smoothBars(dt, active) {
    const N = this.barsCount;
    const bars = this.frame.bars;
    const target = this.frame.barsTarget;
    const attack = approach(dt, 17);
    const release = approach(dt, 7);
    for (let i = 0; i < N; i++) {
      const t = active ? target[i] : 0;
      bars[i] += (t - bars[i]) * (t > bars[i] ? attack : release);
    }
  }

  averageBars() {
    const bars = this.frame.bars;
    let sum = 0;
    for (let i = 0; i < bars.length; i++) sum += bars[i];
    return sum / bars.length;
  }

  // ---- 每帧更新 ----
  update(dt, nowSec) {
    const f = this.frame;
    const active = !!getState().playing && !!this.analyser;
    f.active = active;
    if (active) {
      this.analyser.getByteFrequencyData(f.freq);
      this.analyser.getByteTimeDomainData(f.wave);
      this.readSpectrum();
      this.beat.detect(f.freq, nowSec, dt, (e) => this._fireBeat(e));
    }
    this.smoothBars(dt, active);
    f.energy += (this.averageBars() - f.energy) * approach(dt, 6);
    f.beatPulse *= Math.exp(-dt * 4.2);
    if (f.beatPulse < 0.001) f.beatPulse = 0;
    // 颜色缓慢漂移
    f.hueTarget += dt * 2;
    f.hueBase += (f.hueTarget - f.hueBase) * approach(dt, 3.2);
  }

  _fireBeat(energy) {
    const f = this.frame;
    f.beatPulse = 1;
    f.hueTarget += 26 + Math.random() * 20;
    this._beatListeners.forEach((fn) => fn(energy));
  }

  onBeat(fn) { this._beatListeners.push(fn); }
  onEnded(fn) { this._endedListeners.push(fn); }

  resetAnalysis() {
    const f = this.frame;
    f.bars.fill(0);
    f.barsTarget.fill(0);
    f.beatPulse = 0;
    f.energy = 0;
    if (f.wave) f.wave.fill(128);
    this.beat.reset();
  }

  resetHue(base = 202) {
    this.frame.hueBase = base;
    this.frame.hueTarget = base;
  }

  // ---- 来源管理 ----
  stopSources() {
    this.sourceToken++;
    if (this.demo) { this.demo.stop(); this.demo = null; }
    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
    }
    if (this.micNode) {
      try { this.micNode.disconnect(); } catch (err) { /* ignore */ }
      this.micNode = null;
    }
    if (getState().source === 'file') this.audioEl.pause();
    setState({ source: 'none', playing: false });
  }

  async startDemo() {
    const ac = this.ensureAudio();
    if (!ac) return false;
    this.stopSources();
    const token = ++this.sourceToken;
    try { await ac.resume(); } catch (err) { /* ignore */ }
    if (token !== this.sourceToken) return false;
    this.demo = new DemoTrack(ac, this.inputGain);
    this.demo.start();
    setState({ source: 'demo', playing: true });
    this.resetAnalysis();
    this.resetHue(202);
    return true;
  }

  isAudioFile(file) {
    return (file && ((file.type && file.type.startsWith('audio/')) || AUDIO_EXT.test(file.name || '')));
  }

  // 载入并播放单个文件（播放列表在阶段2基于此封装）
  // 返回：'invalid' 非音频 / 'noaudio' 无 Web Audio / 'race' 被新操作取代 / 'played' 已播放 / 'loaded' 已载入待播放
  async loadFile(file, autoplay = true) {
    if (!file || !this.isAudioFile(file)) return 'invalid';
    const ac = this.ensureAudio();
    if (!ac) return 'noaudio';
    this.stopSources();
    const token = ++this.sourceToken;
    try { await ac.resume(); } catch (err) { /* ignore */ }
    if (token !== this.sourceToken) return 'race';

    if (!this.mediaSource) {
      this.mediaSource = ac.createMediaElementSource(this.audioEl);
      this.mediaSource.connect(this.inputGain);
    }
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = URL.createObjectURL(file);
    this.audioEl.src = this.objectUrl;
    this.audioEl.load();

    setState({ source: 'file', playing: false });
    this.resetAnalysis();

    if (!autoplay) return 'loaded';
    try {
      await this.audioEl.play();
      if (token !== this.sourceToken) { this.audioEl.pause(); return 'race'; }
      setState({ playing: true });
      return 'played';
    } catch (err) {
      return token === this.sourceToken ? 'loaded' : 'race';
    }
  }

  async startMic() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return 'unsupported';
    const ac = this.ensureAudio();
    if (!ac) return false;
    this.stopSources();
    const token = ++this.sourceToken;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      if (token !== this.sourceToken) {
        stream.getTracks().forEach((t) => t.stop());
        return false;
      }
      await ac.resume().catch(() => {});
      this.micStream = stream;
      this.micNode = ac.createMediaStreamSource(stream);
      this.micNode.connect(this.inputGain);
      setState({ source: 'mic', playing: true });
      this.resetAnalysis();
      return true;
    } catch (err) {
      if (token === this.sourceToken) return 'denied';
      return false;
    }
  }

  async togglePlay() {
    const source = getState().source;
    if (source === 'none') return 'nosource';
    if (source === 'file') {
      if (!this.audioEl.paused) {
        this.audioEl.pause();
        setState({ playing: false });
        return true;
      }
      if (this.audioEl.ended) this.audioEl.currentTime = 0;
      try { await this.audioCtx.resume(); } catch (err) { /* ignore */ }
      try {
        await this.audioEl.play();
        setState({ playing: true });
        return true;
      } catch (err) {
        return 'error';
      }
    }
    if (!this.audioCtx) return false;
    if (getState().playing) {
      try { await this.audioCtx.suspend(); } catch (err) { /* ignore */ }
      setState({ playing: false });
    } else {
      try { await this.audioCtx.resume(); } catch (err) { /* ignore */ }
      setState({ playing: true });
    }
    return true;
  }

  pause() {
    if (getState().source === 'file') this.audioEl.pause();
    setState({ playing: false });
  }

  async resume() {
    if (getState().source === 'file') {
      try { await this.audioCtx.resume(); } catch (err) { /* ignore */ }
      try { await this.audioEl.play(); setState({ playing: true }); } catch (err) { /* ignore */ }
    } else if (this.audioCtx) {
      try { await this.audioCtx.resume(); setState({ playing: true }); } catch (err) { /* ignore */ }
    }
  }

  // ---- 走带 / 音量 ----
  get currentTime() { return this.audioEl.currentTime; }
  get duration() { return this.audioEl.duration; }

  // 已缓冲到的比例（取覆盖当前播放位置的最远缓冲段末端）
  get buffered() {
    const dur = this.audioEl.duration;
    if (!Number.isFinite(dur) || dur <= 0) return 0;
    try {
      const ranges = this.audioEl.buffered;
      let end = 0;
      for (let i = 0; i < ranges.length; i++) {
        if (ranges.start(i) <= this.audioEl.currentTime + 0.25) end = Math.max(end, ranges.end(i));
      }
      return clamp(end / dur, 0, 1);
    } catch (err) {
      return 0;
    }
  }

  seekRatio(p) {
    const dur = this.audioEl.duration;
    if (!Number.isFinite(dur) || dur <= 0) return;
    this.audioEl.currentTime = clamp(p, 0, 1) * dur;
  }

  seekTo(sec) {
    const dur = this.audioEl.duration;
    if (!Number.isFinite(dur) || dur <= 0) return;
    this.audioEl.currentTime = clamp(sec, 0, dur);
  }

  seekBy(sec) {
    const dur = this.audioEl.duration;
    if (!Number.isFinite(dur) || dur <= 0) return;
    this.audioEl.currentTime = clamp(this.audioEl.currentTime + sec, 0, dur);
  }

  // iOS 需在用户手势中恢复 AudioContext；失败时返回 false 由上层提示
  async unlock() {
    if (!this.audioCtx) return true;
    try {
      await this.audioCtx.resume();
      return this.audioCtx.state === 'running';
    } catch (err) {
      return false;
    }
  }

  setVolume(v) {
    v = clamp(v, 0, 1);
    if (this.volumeGain) this.volumeGain.gain.value = getState().muted ? 0 : v;
  }

  setMuted(muted) {
    if (this.volumeGain) {
      this.volumeGain.gain.value = muted ? 0 : (getState().volume != null ? getState().volume : 1);
    }
  }

  async resumeContext() {
    if (!this.audioCtx) return;
    try { await this.audioCtx.resume(); } catch (err) { /* ignore */ }
  }

  // ---- 调试 ----
  get audioState() { return this.audioCtx ? this.audioCtx.state : 'none'; }
  get beats() { return this.beat.beats; }
  get beatInfo() {
    return { energy: this.beat.beatEnergy, avg: this.beat.bassAvg, ratio: this.beat.beatRatio };
  }
  get levels() { return Array.from(this.frame.bars); }
  get spectrum() { return this.frame.freq ? Array.from(this.frame.freq.slice(0, 24)) : []; }
  get hueBase() { return hueOf(this.frame.hueBase); }
}
