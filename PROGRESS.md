# 进度记录（PROGRESS）

> 每阶段结束后追加一条：阶段名、完成时间、通过/失败项、下一步。

## 阶段 0：摸底与测试基建
- 完成时间：2026-11-03
- 产出：
  - `ARCHITECTURE.md`：v1 单文件（app.js 1213 行）结构、数据流、渲染循环、12 条已知问题。
  - `test/fixtures/`：6 个素材（ID3v2.3 中文标签+封面 mp3、ID3v2.4 UTF-8 mp3、无标签 mp3、wav、损坏 mp3、封面 png），合计 236KB。
  - `test/run_all.py`：自起 http.server，桌面 1440x900 + 手机 390x844 触屏双环境，基线验收 + v2 专项（特性缺失记 SKIP），截图存 `shots/v2/`，结果落 `test/last_run.txt`。
- 测试：v1 基线 **PASS=28 FAIL=0 SKIP=14**（14 项 v2 特性尚未实现，按预期 SKIP）。
- 关键决策：headless Chrome 默认即提供软件 WebGL2（SwiftShader）且 Canvas2D 满帧 60fps；强制 `--use-angle=swiftshader` 会把 2D 拖到 4~18fps，故 run_all 采用默认标志，FPS 阈值设为 ≥30（实测 60）。
- 下一步：阶段 1，把 app.js 拆成 ES Modules，行为与视觉保持不变。

## 阶段 1：架构重构为 ES Modules
- 完成时间：2026-11-03
- 产出：app.js(1213行) 拆为 12 个模块（utils/state/storage、audio/{engine,beat,demo}、render/{canvas2d,renderer}、ui/{toast,autohide,dock}、main）。最大文件 canvas2d.js 528 行（<600）。删除旧 app.js/demo.js，index.html 改 module 脚本。
- 通信：状态仓库订阅 + onBeat/onEnded 回调；渲染层只读分析帧，不改业务状态。
- 测试：**PASS=28 FAIL=0 SKIP=14**（14 项 v2 特性按 features 能力位 SKIP）。三模式截图与旧版目视一致，fps=60，控制台无 error/warning、无 404。
- 修复：多处模块把 `get`(按key取值) 误别名成 `getState` 导致启动抛错，已改为导入真正的 `getState`。
- 下一步：阶段 2，五种模式/四套主题/全屏增强/播放列表/ID3 解析。

## 阶段 2：五种模式 / 四套主题 / 播放列表 / ID3 / 全屏自动隐藏
- 完成时间：2026-11-04
- 产出：
  - 渲染：新增模式 3「封面环」与模式 4「3D 地形」（频谱历史环形缓冲 + 透视网格 + 地平线辉光），共 5 种模式（按键 1–5 / 按钮切换）。
  - 主题：`theme.js` 四套配色（霓虹/落日/冰蓝/极光）颜色插值 400ms，同时驱动 canvas 与 CSS 变量（阶段2 前半已提交 1ca67f7）。
  - 播放列表：`playlist.js` + 右侧抽屉/移动端底部抽屉，多文件/文件夹拖拽递归加入、拖动排序、删除、空态、四种循环模式（顺序/列表循环/单曲/随机）、上/下一首、自动续播、封面 objectURL 生命周期、Media Session 与 document.title 同步。
  - ID3：`audio/id3.js` 纯前端解析 ID3v2.2/2.3/2.4（含中文编码/APIC）与 FLAC Vorbis Comment/PICTURE，损坏文件安全降级；`test/id3_node_test.mjs` 10/10 通过。
  - 体验：全屏（含 iOS 沉浸模式回退）、UI 3.2s 自动隐藏且悬停/聚焦抑制、快捷键表 `shortcuts.js` 单一来源驱动按键与帮助浮层、进度缓冲显示、音量/静音、iOS AudioContext 手势解锁。
- 测试：**PASS=60 FAIL=0 SKIP=4 总计=64**（仅 `渲染器`、`持久化` 两项按 features 能力位 SKIP）；控制台无 error/warning、无 404。
- 下一步：阶段 3，WebGL 渲染器、持久化、设置面板、性能与无障碍。

## 已知问题
（暂无）
