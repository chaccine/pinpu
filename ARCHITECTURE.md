# 频谱 · 音乐可视化 — 架构说明（v1 现状）

> 本文件描述重构前（v1）的代码结构，作为阶段 1 模块化重构的基线。重构后会在文末追加「v2 模块划分」。

## 1. 文件构成

| 文件 | 行数 | 职责 |
| --- | --- | --- |
| `index.html` | 91 | 页面骨架：画布、顶栏、提示、底部 dock（音源/走带/模式）、拖拽遮罩、toast |
| `style.css` | 747 | 全部样式：CSS 变量主题、玻璃拟态 dock、进度条、移动端/横屏/低高度媒体查询、自动淡出 |
| `demo.js` | 295 | IIFE，合成 120BPM 演示曲（底鼓/低音/旋律/踩镲/铺底和弦），暴露 `window.PinpuDemo` |
| `app.js` | 1213 | 单个 IIFE，承载全部业务逻辑与渲染 |
| `verify.py` | 43 | Playwright 桌面+手机验收脚本，依赖 `window.__pinpu` |
| `touch.py` | 16 | Playwright 触屏交互冒烟脚本 |

## 2. app.js 内部逻辑分区

按源码顺序，单文件 IIFE 内部大致分为以下区块：

1. **基础工具**（6–13 行）：`$` 选择器、`TAU`、`clamp`、`hueOf`、`isMobile`、常量 `BARS`/`HUE_SEGMENTS`/`SPRITE_COUNT`。
2. **DOM 引用**（15–34 行）：`canvas`、2D 上下文 `g`、`ui` 对象集中持有各控件。
3. **运行状态**（36–93 行）：`state`（mode/source/playing/beats/fps）、频谱数组 `bars`/`barsTarget`、节拍检测变量、AudioContext 相关句柄、画布尺寸变量、粒子数组、色相漂移变量、计时器句柄。
4. **音频初始化**（95–166 行）：`ensureAudio`（建 AudioContext/Analyser/masterGain）、`computeBands`（对数分频）、`readSpectrum`、`smoothBars`（attack/release 平滑）、`averageBars`。
5. **节拍检测**（168–214 行）：`detectBeat`（低频平方能量 vs 0.8s 滑动平均，带重新武装与最小间隔）、`onBeat`（累加 beats、触发色相跳变与粒子爆发）、`resetAnalysis`。
6. **画布与粒子**（216–323 行）：`resizeCanvas`（DPR 限制、可用高度布局、背景渐变、重建星系）、`buildGalaxy`（三旋臂粒子）、`buildSprites`/`spriteFor`（预渲染发光贴图）、`spawnBurst`（节拍爆发粒子）。
7. **绘制**（325–705 行）：`drawBackdrop`、`drawRing`（模式0 环形频谱）、`drawMirror`（模式1 镜像波形）、`drawGalaxy`（模式2 粒子星系）、`updateSparks`、`addRoundRect`。
8. **主循环**（707–750 行）：`frame(ts)` —— requestAnimationFrame 驱动，计算 dt/fps、读频谱、检测节拍、平滑、更新粒子、色相漂移、按模式绘制、更新走带 UI。
9. **界面状态与提示**（752–809 行）：`toast`、`updateSourceUI`、`setPlaying`、`setMode`、自动淡出 `armIdle`/`wake`。
10. **进度条**（811–894 行）：`formatTime`、`paintProgress`、`updateTransport`、`bindProgress`（拖动跳转）。
11. **音频源**（896–1063 行）：`stopSources`、`startDemo`、`loadFile`（单文件）、`startMic`、`togglePlay`，用 `sourceToken` 防竞态。
12. **全屏**（1065–1080 行）：`toggleFullscreen`（含 webkit 前缀）。
13. **事件绑定**（1082–1184 行）：`bindUI` —— 各按钮、模式、键盘（空格/1/2/3/F）、拖拽（dragenter/over/leave/drop，单文件）、resize/orientation/fullscreenchange。
14. **调试接口**（1186–1205 行）：`exposeDebugApi` 定义 `window.__pinpu`（mode/beats/playing/source/fps/audioState/beatInfo/levels/spectrum/setMode）。
15. **启动**（1207–1213 行）：buildSprites → resizeCanvas → bindUI → exposeDebugApi → requestAnimationFrame(frame)。

## 3. 数据流

```
音源(演示/文件/麦克风)
   │  ensureAudio(): AudioContext → masterGain → analyser → destination
   ▼
analyser.getByteFrequencyData / getByteTimeDomainData
   │
   ├─ readSpectrum() → barsTarget[]  (对数分频 + 幂律 + 高频补偿)
   │        │ smoothBars(dt) → bars[]
   │        ▼
   ├─ detectBeat() → onBeat() → state.beats++, beatPulse=1, hueTarget+=, spawnBurst()
   │
   ▼
frame(ts): dt/fps → 读频谱 → 检测节拍 → 平滑 → 更新粒子/色相 → drawBackdrop + draw{Ring|Mirror|Galaxy} → updateTransport
```

- **状态载体**：模块级闭包变量（`state`、`bars`、`hueBase`、`beatPulse`、粒子数组等），无订阅机制，UI 通过直接读写闭包变量同步。
- **渲染只读**：绘制函数读取 `bars`/`hueBase`/`beatPulse`/`state`，但 `drawGalaxy` 会就地修改粒子位置（`p.a += ...`），渲染与状态未完全分离。
- **色相**：`hueBase` 向 `hueTarget` 指数逼近，节拍时 `hueTarget` 跳变，实现颜色漂移+节拍闪变。

## 4. 渲染循环要点

- 单一 `requestAnimationFrame(frame)` 循环，无条件运行（即便暂停也持续绘制背景与静态柱条）。
- DPR 上限 2，移动端 `BARS=56`、桌面 `BARS=80`。
- 发光用「多层描边/放大填充」模拟，而非 `shadowBlur`（性能更好）。
- 粒子贴图 `sprites[]` 预渲染 18 个色相，`spriteFor(hue)` 取最近贴图，避免每帧建渐变。
- 布局：`resizeCanvas` 依据 dock 高度计算 `stageCY`/`stageUnit`，保证主体不被底部面板遮挡。

## 5. 已知问题 / 重构注意点

1. **单文件 1213 行**，职责高度耦合，闭包变量被 UI 与渲染共同读写，难以测试与扩展。
2. **状态无订阅**：UI 更新散落在 `setMode`/`setPlaying`/`updateSourceUI`/`updateTransport`，新增状态需手动同步多处。
3. **仅单文件载入**：`loadFile` 一次只处理 `files[0]`，无播放列表、无文件夹递归、无多选。
4. **无 ID3 解析**：不读取标题/歌手/封面，`document.title` 与 Media Session 均未设置。
5. **无主题系统**：颜色硬编码为青色/品红（`hueBase=202` 起），CSS 变量 `--accent` 固定，无法切换。
6. **仅 2D 渲染**：无 WebGL，粒子/地形全在 CPU 侧 Canvas2D 绘制。
7. **无持久化**：刷新后模式/音量/主题全部丢失。
8. **快捷键文档与代码分离风险**：帮助浮层尚未实现。
9. **渲染循环常驻**：页面不可见时仍跑 rAF，浪费电量；无自适应画质。
10. **全屏无 iOS 降级**：iOS Safari 不支持 Fullscreen API 时仅 toast「不支持」，无沉浸模式。
11. **`drawGalaxy` 修改粒子状态**：渲染层与业务状态未隔离，重构时需把粒子更新移出绘制函数。
12. **objectUrl 生命周期**：`loadFile` 会 revoke 旧 URL，但无播放列表时多 URL 管理需重新设计。

## 6. 调试接口契约（不可破坏）

`window.__pinpu` 现有字段：`mode`、`beats`、`playing`、`source`、`fps`、`audioState`、`beatInfo`、`levels`、`spectrum`、`setMode(i)`。
`verify.py` 依赖：`mode`/`beats`/`playing`/`fps`/`source` 与 `.mode[data-mode="N"]`、`#btnDemo`、`#btnPlay`、`#btnMic`、`#fileInput`、`#progress`、`#timeNow`/`#timeTotal` 选择器。重构与升级须保持这些可用。
