/* 自动切换模式：纯逻辑状态机（无 DOM / 定时器），由主循环按 dt 驱动，可在 Node 中直接测试。 */
/* 定时策略只累计播放时长；surge 用慢速能量均值判断突增，带绝对阈值、8 秒防抖与手动抑制。 */

export const AUTO_SWITCH_POLICIES = ['off', '15', '30', '60', 'surge'];

const SURGE_RATIO = 1.6;
const SURGE_THRESHOLD = 0.22;
const SURGE_COOLDOWN = 8;
const SURGE_TAU = 4;
const MANUAL_SUPPRESS_MIN = 10;

export function normalizeAutoSwitch(value) {
  const v = String(value == null ? 'off' : value).trim().toLowerCase();
  return AUTO_SWITCH_POLICIES.includes(v) ? v : 'off';
}

export function createAutoSwitcher(opts = {}) {
  const modeCount = Math.max(1, Math.floor(Number(opts.modeCount) || 1));
  const getMode = typeof opts.getMode === 'function' ? opts.getMode : () => 0;
  const setMode = typeof opts.setMode === 'function' ? opts.setMode : () => {};
  const getEnergy = typeof opts.getEnergy === 'function' ? opts.getEnergy : () => 0;
  const now = typeof opts.now === 'function' ? opts.now : () => 0;

  let policy = 'off';
  let elapsed = 0;              // 仅累计播放中的秒数
  let suppressUntil = 0;        // 手动切换后的绝对时间闸门
  let lastSwitchAt = -Infinity;
  let avg = 0;                  // surge 慢速滑动均值
  let avgReady = false;
  let switches = 0;
  let lastSwitchMode = -1;

  function currentMode() {
    const m = Math.floor(Number(getMode()));
    if (!Number.isFinite(m)) return 0;
    return Math.min(modeCount - 1, Math.max(0, m));
  }

  // 顺序轮换到下一个不同模式；modeCount=1 时保持不动
  function nextMode() {
    const cur = currentMode();
    for (let step = 1; step < modeCount; step++) {
      const candidate = (cur + step) % modeCount;
      if (candidate !== cur) return candidate;
    }
    return cur;
  }

  function period() {
    if (policy === 'off' || policy === 'surge') return 0;
    return Number(policy) || 0;
  }

  function suppressed() {
    return now() < suppressUntil;
  }

  function applySwitch() {
    const target = nextMode();
    if (target === currentMode()) return false;
    setMode(target);
    elapsed = 0;
    lastSwitchAt = now();
    lastSwitchMode = target;
    switches++;
    return true;
  }

  function setPolicy(next) {
    policy = normalizeAutoSwitch(next);
    elapsed = 0;
    suppressUntil = 0;
    lastSwitchAt = -Infinity;
    avg = 0;
    avgReady = false;
    return policy;
  }

  function reset() {
    elapsed = 0;
    suppressUntil = 0;
    lastSwitchAt = -Infinity;
    avg = 0;
    avgReady = false;
    switches = 0;
    lastSwitchMode = -1;
  }

  // 用户点击模式按钮或按 1-5：重置计时，并让自动切换暂停至少半周期 / 10 秒
  function notifyManualSwitch() {
    const at = now();
    elapsed = 0;
    suppressUntil = at + Math.max(MANUAL_SUPPRESS_MIN, period() / 2);
    lastSwitchAt = at;
    return suppressUntil;
  }

  function update(dt, signal = {}) {
    if (policy === 'off') return;
    const step = Math.max(0, Number(dt) || 0);
    const playing = !!signal.playing;
    if (!playing || step <= 0) return;

    if (policy !== 'surge') {
      elapsed += step;
      if (elapsed >= period() && !suppressed()) {
        elapsed = 0;
        applySwitch();
      }
      return;
    }

    const raw = Number(signal.energy);
    const energy = Number.isFinite(raw)
      ? Math.max(0, raw)
      : Math.max(0, Number(getEnergy()) || 0);

    // 先用上一帧均值判定突增，再把本帧能量并入慢速均值
    const alpha = 1 - Math.exp(-step / SURGE_TAU);
    if (!avgReady) {
      avg = energy;
      avgReady = true;
      return;
    }
    const base = avg;
    avg += (energy - avg) * alpha;
    if (energy > base * SURGE_RATIO
        && energy > SURGE_THRESHOLD
        && now() - lastSwitchAt >= SURGE_COOLDOWN
        && !suppressed()) {
      applySwitch();
    }
  }

  function getState() {
    return {
      policy,
      elapsed,
      period: period(),
      suppressed: suppressed(),
      suppressUntil,
      energyAvg: avg,
      lastSwitchAt,
      lastSwitchMode,
      switches,
    };
  }

  return { setPolicy, update, reset, notifyManualSwitch, getState };
}
