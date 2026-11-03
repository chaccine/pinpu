/* 演示曲目：纯 Web Audio 合成的 120BPM 循环（底鼓/低音线/旋律/踩镲/铺底和弦）。 */
/* 由 engine 在「演示」音源下实例化；start/stop 控制排程，stop 时断开全部节点。 */

const BPM = 120;
const BEAT = 60 / BPM;          // 一拍 0.5s
const STEP = BEAT / 4;          // 十六分音符
const BAR_STEPS = 16;
const BARS = 8;
const TOTAL_STEPS = BAR_STEPS * BARS;

// 低音根音（MIDI）：Am Am F F C C G G
const BASS_ROOTS = [33, 33, 29, 29, 36, 36, 31, 31];
// A 小调五声音阶（相对 A3 的半音）
const PENTA = [0, 3, 5, 7, 10, 12, 15];
// 每小节 16 步的旋律走向，-1 表示休止
const MELODY = [0, -1, 2, -1, 4, 3, 2, -1, 0, -1, 2, 3, 4, -1, 6, 4];
// 低音节奏：步号 -> 相对根音的半音
const BASS_STEPS = { 0: 0, 3: 0, 6: 12, 8: 0, 11: 7, 14: 0 };
// 铺底和弦（每两小节一个）
const PAD_CHORDS = [[0, 3, 7, 10], [0, 4, 7, 11], [0, 4, 7, 11], [0, 4, 7, 10]];

function midiToHz(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export class DemoTrack {
  constructor(ctx, destination) {
    this.ctx = ctx;
    this.started = false;
    this.timer = 0;
    this.step = 0;
    this.nextTime = 0;
    this.nodes = new Set();

    // 输出总线 + 轻压缩，避免多层叠加削波
    this.out = ctx.createGain();
    this.out.gain.value = 0.85;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.knee.value = 12;
    this.comp.ratio.value = 4;
    this.comp.attack.value = 0.003;
    this.comp.release.value = 0.24;
    this.out.connect(this.comp);
    this.comp.connect(destination);

    // 附点十六分延迟，给旋律一点空间感
    this.delay = ctx.createDelay(0.5);
    this.delay.delayTime.value = STEP * 1.5;
    this.feedback = ctx.createGain();
    this.feedback.gain.value = 0.26;
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.2;
    this.delay.connect(this.feedback);
    this.feedback.connect(this.delay);
    this.delay.connect(this.wet);
    this.wet.connect(this.out);

    // 白噪声缓冲（踩镲 / 拍手共用）
    this.noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 1.5), ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.08;
    this.timer = setInterval(() => this._schedule(), 25);
    this._schedule();
  }

  stop() {
    this.started = false;
    clearInterval(this.timer);
    this.timer = 0;
    this.nodes.forEach((node) => {
      try { node.stop(0); } catch (err) { /* 已停止的节点忽略 */ }
    });
    this.nodes.clear();
    [this.out, this.comp, this.delay, this.feedback, this.wet].forEach((node) => {
      try { node.disconnect(); } catch (err) { /* ignore */ }
    });
  }

  // 提前排程，抵抗定时器抖动
  _schedule() {
    if (!this.started) return;
    const ctx = this.ctx;
    // 标签页被节流后不要补播积压的音符，避免突然爆音
    if (this.nextTime < ctx.currentTime - 0.1) {
      this.nextTime = ctx.currentTime + 0.05;
    }
    while (this.nextTime < ctx.currentTime + 0.12) {
      this._playStep(this.step, this.nextTime);
      this.nextTime += STEP;
      this.step = (this.step + 1) % TOTAL_STEPS;
    }
  }

  _keep(node) {
    this.nodes.add(node);
    node.onended = () => {
      this.nodes.delete(node);
      try { node.disconnect(); } catch (err) { /* ignore */ }
    };
  }

  _playStep(step, t) {
    const inBar = step % BAR_STEPS;
    const bar = Math.floor(step / BAR_STEPS);

    // four-on-the-floor 底鼓
    if (inBar % 4 === 0) this._kick(t, inBar === 0 ? 1 : 0.9);
    // 二、四拍拍手
    if (inBar === 4 || inBar === 12) this._clap(t);
    // 八分音符踩镲，每两小节来一次开镲
    if (inBar % 2 === 0) {
      const open = inBar === 14 && bar % 2 === 0;
      this._hat(t, inBar % 4 === 0 ? 0.085 : 0.05, open ? 0.17 : 0.045);
    }
    // 低音线
    if (BASS_STEPS[inBar] !== undefined) {
      this._bass(t, BASS_ROOTS[bar] + BASS_STEPS[inBar], STEP * 1.5);
    }
    // 旋律
    const note = MELODY[inBar];
    if (note >= 0) this._lead(t, 57 + PENTA[note], STEP * 1.3);
    // 每两小节铺一层和弦
    if (inBar === 0 && bar % 2 === 0) {
      const chord = PAD_CHORDS[(bar / 2) % PAD_CHORDS.length];
      this._pad(t, BASS_ROOTS[bar] + 12, chord, BEAT * 4 - 0.12);
    }
  }

  _kick(t, vel) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(155, t);
    osc.frequency.exponentialRampToValueAtTime(43, t + 0.11);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.92 * vel, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
    osc.connect(gain);
    gain.connect(this.out);
    osc.start(t);
    osc.stop(t + 0.4);
    this._keep(osc);
  }

  _bass(t, midi, dur) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = midiToHz(midi);
    filter.type = 'lowpass';
    filter.Q.value = 5;
    filter.frequency.setValueAtTime(680, t);
    filter.frequency.exponentialRampToValueAtTime(170, t + dur * 0.95);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.3, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.out);
    osc.start(t);
    osc.stop(t + dur + 0.02);
    this._keep(osc);
  }

  _lead(t, midi, dur) {
    const ctx = this.ctx;
    const freq = midiToHz(midi);
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    const send = ctx.createGain();

    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.075, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    filter.type = 'lowpass';
    filter.frequency.value = 3200;
    filter.Q.value = 0.7;

    [0, 7].forEach((detune) => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      osc.detune.value = detune;
      osc.connect(gain);
      osc.start(t);
      osc.stop(t + dur + 0.05);
      this._keep(osc);
    });

    send.gain.value = 0.22;
    gain.connect(filter);
    filter.connect(this.out);
    filter.connect(send);
    send.connect(this.delay);
  }

  _pad(t, root, chord, dur) {
    const ctx = this.ctx;
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 860;
    filter.Q.value = 0.5;

    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.055, t + 0.5);
    gain.gain.setValueAtTime(0.05, t + dur - 0.6);
    gain.gain.linearRampToValueAtTime(0.0001, t + dur);

    chord.forEach((semi) => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = midiToHz(root + semi);
      osc.detune.value = (Math.random() - 0.5) * 8;
      osc.connect(filter);
      osc.start(t);
      osc.stop(t + dur + 0.05);
      this._keep(osc);
    });

    filter.connect(gain);
    gain.connect(this.out);
  }

  _hat(t, vel, decay) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    const hp = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    src.buffer = this.noise;
    hp.type = 'highpass';
    hp.frequency.value = 7200;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vel, t + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    src.connect(hp);
    hp.connect(gain);
    gain.connect(this.out);
    src.start(t, Math.random() * 1.2);
    src.stop(t + decay + 0.03);
    this._keep(src);
  }

  _clap(t) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    const bp = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    src.buffer = this.noise;
    bp.type = 'bandpass';
    bp.frequency.value = 1500;
    bp.Q.value = 1.3;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.2, t + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
    src.connect(bp);
    bp.connect(gain);
    gain.connect(this.out);
    src.start(t, Math.random() * 1.2);
    src.stop(t + 0.16);
    this._keep(src);

    // 一点低频厚度
    const body = ctx.createOscillator();
    const bg = ctx.createGain();
    body.type = 'triangle';
    body.frequency.value = 190;
    bg.gain.setValueAtTime(0.0001, t);
    bg.gain.exponentialRampToValueAtTime(0.09, t + 0.004);
    bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    body.connect(bg);
    bg.connect(this.out);
    body.start(t);
    body.stop(t + 0.11);
    this._keep(body);
  }
}

export { BPM };
