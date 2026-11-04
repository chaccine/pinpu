/* 自适应画质：按帧率在 高/中/低 三档间升降，调整粒子数、发光、DPR 上限与柱条数。 */
/* 设置里可锁定「高/低」；自动模式带迟滞，避免在阈值附近抖动。 */

import { densityScale } from './settings.js';

const PROFILES = {
  high: { dprCap: 2, particleScale: 1, glow: 1, barsScale: 1 },
  mid: { dprCap: 1.5, particleScale: 0.72, glow: 0.7, barsScale: 0.82 },
  low: { dprCap: 1.15, particleScale: 0.45, glow: 0.35, barsScale: 0.62 },
};

export function createQualityManager({ engine, renderer, baseBars, density, mode, onApply }) {
  let tier = 'high';
  let base = baseBars;
  let dens = density || 'mid';
  let locked = mode && mode !== 'auto';
  let lowStreak = 0;
  let highStreak = 0;

  if (locked) tier = mode === 'low' ? 'low' : 'high';

  function apply() {
    const p = PROFILES[tier];
    engine.setBarsCount(Math.max(24, Math.round(base * p.barsScale)));
    renderer.setQuality({
      dprCap: p.dprCap,
      glow: p.glow,
      barsScale: p.barsScale,
      particleScale: p.particleScale * densityScale(dens),
    });
    if (onApply) onApply(tier);
    return tier;
  }

  // 每 2 秒由主循环采样一次；仅在全速渲染（播放且可见）时调用
  function sample(fps) {
    if (locked) return tier;
    if (fps < 45) {
      lowStreak++;
      highStreak = 0;
    } else if (fps > 55) {
      highStreak++;
      lowStreak = 0;
    } else {
      lowStreak = 0;
      highStreak = 0;
    }
    if (lowStreak >= 2 && tier !== 'low') {
      tier = tier === 'high' ? 'mid' : 'low';
      lowStreak = 0;
      apply();
    } else if (highStreak >= 3 && tier !== 'high') {
      tier = tier === 'low' ? 'mid' : 'high';
      highStreak = 0;
      apply();
    }
    return tier;
  }

  function setMode(next) {
    locked = next && next !== 'auto';
    if (locked) tier = next === 'low' ? 'low' : 'high';
    else tier = 'high';
    lowStreak = 0;
    highStreak = 0;
    apply();
  }

  function setDensity(next) { dens = next || 'mid'; apply(); }
  function setBaseBars(n) { base = Math.max(24, Math.round(n || 80)); apply(); }

  apply();

  return {
    sample,
    setMode,
    setDensity,
    setBaseBars,
    apply,
    get tier() { return tier; },
    get locked() { return locked; },
    get profile() { return PROFILES[tier]; },
  };
}
