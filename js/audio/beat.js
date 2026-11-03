/* 节拍检测：低频段平方能量 vs ~0.8s 滑动平均，超过阈值且满足最小间隔即判定一拍。 */
/* 仅做检测并通过回调上报，不触碰视觉/业务状态；灵敏度可调（阶段3高级设置使用）。 */

export class BeatDetector {
  constructor(opts = {}) {
    this.bassAvg = 0;
    this.beatEnergy = 0;
    this.beatRatio = 0;
    this.armed = true;
    this.lastBeat = -1;
    this.beats = 0;
    // 灵敏度 0.5~2，越大越容易触发；阈值随之下移
    this.sensitivity = opts.sensitivity || 1;
    this.lowBins = opts.lowBins || 12;
  }

  setSensitivity(s) {
    this.sensitivity = s;
  }

  reset() {
    this.bassAvg = 0;
    this.beatEnergy = 0;
    this.beatRatio = 0;
    this.armed = true;
    this.lastBeat = -1;
    this.beats = 0;
  }

  // freqBytes: Uint8Array；now: 秒；dt: 秒；onBeat(energy) 回调
  detect(freqBytes, now, dt, onBeat) {
    const n = Math.min(this.lowBins, freqBytes.length - 1);
    let sum = 0;
    for (let i = 1; i <= n; i++) {
      const v = freqBytes[i] / 255;
      sum += v * v;
    }
    const energy = sum / n;
    const ratio = energy / (this.bassAvg + 0.0005);
    this.beatEnergy = energy;
    this.beatRatio = ratio;

    // 能量回落后重新武装，避免持续低音被重复计数
    if (ratio < 1.06) this.armed = true;
    // 灵敏度越高，触发阈值越低（1.32 为基线）
    const threshold = 1.32 / this.sensitivity;
    if (this.armed && ratio > threshold && energy > 0.02 && now - this.lastBeat > 0.3) {
      this.lastBeat = now;
      this.armed = false;
      this.beats++;
      if (onBeat) onBeat(energy);
    }

    const alpha = 1 - Math.exp(-dt / 0.6);
    this.bassAvg += (energy - this.bassAvg) * alpha;
    return energy;
  }
}
