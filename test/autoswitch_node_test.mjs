/* 自动切换 Node 单元测试：data: URL 直接 import 纯逻辑模块，覆盖定时/暂停/轮换/突增/防抖/抑制。 */
/* 运行： node test/autoswitch_node_test.mjs   （由 run_all.py 静态检查调用） */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'js', 'autoswitch.js'));
const mod = await import('data:text/javascript;base64,' + src.toString('base64'));
const { createAutoSwitcher, normalizeAutoSwitch } = mod;

let failed = 0;
function check(label, cond, extra = '') {
  if (cond) console.log(`  [PASS] ${label}`);
  else { console.log(`  [FAIL] ${label} ${extra}`); failed++; }
}

// 测试台：clock 与 dt 同步推进，同时允许“只走帧不计时”以单独验证抑制闸门
function rig(policy = 'off', startMode = 0, startClock = 0) {
  let cur = startMode;
  let clock = startClock;
  const sw = createAutoSwitcher({
    modeCount: 5,
    getMode: () => cur,
    setMode: (m) => { cur = m; },
    getEnergy: () => 0,
    now: () => clock,
  });
  sw.setPolicy(policy);
  return {
    sw,
    get mode() { return cur; },
    setMode(m) { cur = m; },
    step(dt, energy = 0, playing = true) {
      clock += dt;
      return sw.update(dt, { energy, playing, beat: 0 });
    },
    frame(dt, energy = 0, playing = true) {
      return sw.update(dt, { energy, playing, beat: 0 });
    },
    setClock(v) { clock = v; },
  };
}

// ---- 策略归一化 ----
check('有效策略原样保留', ['off', '15', '30', '60', 'surge']
  .every((p) => normalizeAutoSwitch(p) === p));
check('非法/空值回退 off', normalizeAutoSwitch('abc') === 'off'
  && normalizeAutoSwitch(null) === 'off' && normalizeAutoSwitch(undefined) === 'off');
check('数字策略按字符串归一', normalizeAutoSwitch(15) === '15');
const bad = rig('15');
check('setPolicy 返回归一化策略', bad.sw.setPolicy('xxx') === 'off');

// ---- off：永不切换 ----
const off = rig('off');
off.step(300, 0.9);
check('off 不切换', off.mode === 0, String(off.mode));

// ---- 15 秒定时 ----
const timer = rig('15');
timer.step(14.9, 0.1);
check('15秒未到不切换', timer.mode === 0, String(timer.mode));
timer.step(0.2, 0.1);
check('15秒到点切到不同模式', timer.mode === 1, String(timer.mode));

// ---- 暂停/无音源不计时 ----
const paused = rig('15');
paused.step(10, 0.1, true);
paused.step(120, 0.1, false);
check('暂停期间不切换', paused.mode === 0, String(paused.mode));
paused.step(4.8, 0.1, true);
check('恢复播放后继续累计', paused.mode === 0, String(paused.mode));
paused.step(0.3, 0.1, true);
check('补齐剩余时长后切换', paused.mode === 1, String(paused.mode));

// ---- 顺序轮换覆盖全部模式 ----
const rotate = rig('15');
const seen = [];
for (let i = 0; i < 5; i++) {
  rotate.step(15.1, 0.1);
  seen.push(rotate.mode);
}
check('轮换覆盖全部 5 个模式', new Set(seen).size === 5, seen.join(','));
check('相邻两次切换模式不同', seen.every((m, i) => i === 0 || m !== seen[i - 1]), seen.join(','));
const fromThree = rig('15', 3);
fromThree.step(15.1);
check('从当前模式继续顺序轮换', fromThree.mode === 4, String(fromThree.mode));

// ---- 手动切换后抑制 ----
const manual = rig('15');
manual.sw.notifyManualSwitch();
const ms = manual.sw.getState();
check('手动切换后计时清零并进入抑制', ms.elapsed === 0 && ms.suppressed, JSON.stringify(ms));
manual.frame(15.1, 0.1, true);
check('抑制期间到点也不切换', manual.mode === 0, String(manual.mode));
manual.setClock(10.1);
manual.frame(0.1, 0.1, true);
check('抑制结束后恢复自动切换', manual.mode === 1, String(manual.mode));
const m60 = rig('60');
m60.sw.notifyManualSwitch();
check('长周期抑制取半周期(30s)', m60.sw.getState().suppressUntil === 30,
  String(m60.sw.getState().suppressUntil));

// ---- surge：慢速均值 + 绝对阈值 + 8 秒防抖 ----
const surge = rig('surge');
for (let i = 0; i < 20; i++) surge.step(0.5, 0.2);
check('surge 平稳期不切换', surge.mode === 0, String(surge.mode));
surge.step(0.1, 0.9);
check('surge 能量突增触发切换', surge.mode === 1, String(surge.mode));
check('surge 切换计数', surge.sw.getState().switches === 1, String(surge.sw.getState().switches));
surge.step(0.2, 0.9);
check('surge 8 秒内不重复切换', surge.mode === 1, String(surge.mode));
for (let i = 0; i < 42; i++) surge.step(0.2, 0.2);
surge.step(0.1, 0.9);
check('surge 防抖结束后可再次触发', surge.mode === 2, String(surge.mode));

const quiet = rig('surge');
for (let i = 0; i < 20; i++) quiet.step(0.5, 0.02);
quiet.step(0.1, 0.15);
check('surge 低于绝对阈值不触发', quiet.mode === 0, String(quiet.mode));

// ---- reset 后重新计时 ----
const reset = rig('15');
reset.step(10, 0.1);
reset.sw.reset();
check('reset 清零计时', reset.sw.getState().elapsed === 0);
reset.step(14, 0.1);
check('reset 后重新累计', reset.mode === 0, String(reset.mode));
reset.step(1.1, 0.1);
check('reset 后到点仍能切换', reset.mode === 1, String(reset.mode));

process.exit(failed ? 1 : 0);
