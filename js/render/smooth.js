/* 镜像波形的平滑辅助：把频谱柱降采样并做时间/空间平滑，把时域波形降采样后低通。 */
/* 纯函数 + 小状态对象，不读取 DOM，渲染器每帧调用，使画面更平静清晰。 */

import { approach } from '../utils.js';

// 柱条：相邻 2 根合并，再按 (快升慢降) 做时间平滑，最后做 1-2-1 空间平滑
export function smoothMirrorBars(st, bars, dt) {
  const M = Math.max(8, bars.length >> 1);
  if (!st.bars || st.bars.length !== M) {
    st.bars = new Float32Array(M);
    st.tmp = new Float32Array(M);
  }
  const up = approach(dt, 9), down = approach(dt, 3.2);
  const out = st.bars, tmp = st.tmp;
  for (let i = 0; i < M; i++) {
    const a = bars[Math.min(bars.length - 1, i * 2)];
    const b = bars[Math.min(bars.length - 1, i * 2 + 1)];
    const t = (a + b) * 0.5;
    out[i] += (t - out[i]) * (t > out[i] ? up : down);
  }
  for (let i = 0; i < M; i++) {
    const l = out[i > 0 ? i - 1 : i], r = out[i < M - 1 ? i + 1 : i];
    tmp[i] = l * 0.25 + out[i] * 0.5 + r * 0.25;
  }
  return tmp;
}

// 波形：按窗口平均降采样到 N 点（滤掉高频抖动），再与上一帧做时间插值
export function smoothMirrorWave(st, wave, dt, N = 72) {
  if (!st.wave || st.wave.length !== N) st.wave = new Float32Array(N);
  const out = st.wave;
  const win = wave.length / N;
  const k = approach(dt, 7);
  for (let i = 0; i < N; i++) {
    const s = Math.floor(i * win), e = Math.max(s + 1, Math.floor((i + 1) * win));
    let sum = 0;
    for (let j = s; j < e; j++) sum += wave[j] - 128;
    const t = sum / (e - s) / 128;
    out[i] += (t - out[i]) * k;
  }
  return out;
}
