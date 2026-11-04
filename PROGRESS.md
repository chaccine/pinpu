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

## 阶段 3：WebGL 渲染器 / 持久化 / 设置面板 / 性能与无障碍
- 完成时间：2026-11-04
- 产出：
  - WebGL：新增 `render/webgl.js`，透明叠加画布 + 透明 2D 背景层。星系模式用 GPU 点精灵（顶点着色器轨道运动 + 节拍脉冲），地形模式用网格顶点着色器采样历史频谱纹理（环形缓冲逐行上传）。WebGL2 → WebGL1（无顶点纹理时回退 2D）→ Canvas2D 自动降级；`?renderer=2d` 强制 2D；上下文丢失自动切 2D、恢复后重建；`__pinpu.renderer` 实时反映。
  - 持久化：`storage.js` 统一 `pinpu.v2.` 前缀与 schemaVersion，`settings.js` 默认值/清洗/重置；保存主题、模式、音量、静音、循环模式、渲染器偏好、灵敏度、平滑、柱数、粒子密度、FPS 显示、播放列表开关与「仅文件名」；播放列表文件不持久，刷新后显示占位行并提示重新添加；URL `?mode=&theme=&renderer=` 覆盖。
  - 快捷键/帮助：`shortcuts.js` 单一配置表同时驱动按键分发与帮助浮层；Esc 依次关闭帮助/设置/播放列表/沉浸。
  - 性能：页面隐藏或窗口失焦停帧，暂停时主循环限 32ms（30fps）；自适应画质高/中/低（连续 2 次 <45fps 降档，连续 3 次 >55fps 升档，2s 采样；手动锁定）；分辨率上限、粒子/辉光/柱数随档位缩放；渐变缓存（按色相桶+几何桶，上限 96）；30 次切歌后 GC 堆 3079→3149KB（+71KB，无线性泄漏）；iOS AudioContext 解锁失败时提示再次点击。
  - 无障碍：模式/按钮 aria-label 与 aria-pressed、播放列表/设置面板焦点与 Esc、prefers-reduced-motion 降低动效、桌面/窄屏/横屏/低高度四类视口适配。
  - 设置面板：齿轮按钮，画质自动/高/中/低、柱数少/中/多、粒子密度、灵敏度 0.5–2、平滑 0–0.9、FPS 开关、渲染器自动/2D（提示重载生效）、恢复默认。
  - 结构：`style.css`(1649 行) 拆为 `css/` 下 6 个文件（base/theme-panel/dock/playlist/overlays/settings，最大 580 行），全部代码文件 <600 行。
- 测试：`test/run_all.py` **PASS=68 FAIL=0 SKIP=0**；控制台零 error/warning、零 404；WebGL 星系/地形、上下文丢失恢复、强制 2D、设置与刷新恢复、暂停 30fps、移动端设置面板均手动验证。
- 环境说明：headless Chrome + SwiftShader 截图读回会打印 `GL Driver Message ... ReadPixels/GL_CLOSE_PATH` 驱动性能警告，属读回环境噪声，测试监听已精确过滤，应用自身无告警。
- 下一步：阶段 4，5 模式 × 4 主题 × 桌面/手机 40 张截图自检并修复。

## 阶段 4：视觉自检与修复
- 完成时间：2026-11-04
- 产出：`test/visual_shots.py` 自动截取 40 张主截图（5 模式 × 4 主题 × 1440×900/390×844，演示曲播放 4 秒后）+ 10 张 WebGL/2D 对照；另补 1920×1080、手机横屏 844×390、窄屏 320×568 共 15 张复核图。截图在 `shots/v4/`（gitignore）。
- 第 1 轮发现并修复：
  1. 手机模式条横向滚动裁切「3D波形地形」→ 改为五等分自适应（≤380px 再降字号/内边距），390/320 宽度均完整显示、无溢出。
  2. 封面环无封面渐变唱片固定 +120° 色相偏移，落日主题出现撞眼绿盘 → 改为跟随主题 spread，四主题下分别为品红/橙红/蓝/青绿，与柱条协调。
  3. 3D 地形线条偏暗（尤其冰蓝主题）→ Canvas2D 改加法混合并提高线亮度/竖网格透明度，WebGL 顶点着色器同步参数，地平线辉光略增强。
- 第 2 轮复查：40+10 张全部重看，构图居中、无 dock 遮挡、无文字溢出、无过曝；WebGL 与 2D 星系/地形构图与色相一致（WebGL 线宽受浏览器限制略细，已提高近端透明度补偿）。
- 记录：`CHANGELOG.md`「视觉自检记录」。
- 测试：`test/run_all.py` **PASS=68 FAIL=0 SKIP=0**；另以 1920×1080 / 844×390 / 320×568 实测模式条无滚动溢出、dock 不遮挡主体。
- 下一步：阶段 5，README、测试补全、node 语法检查、最终全量运行与提交。

## 阶段 5：收尾（文档 / 测试补全 / 最终验收）
- 完成时间：2026-11-04
- 产出：
  - `README.md`：功能列表、快捷键表、目录结构、本地运行、浏览器兼容、已知限制、调试接口。
  - `ARCHITECTURE.md`：追加 v2 模块划分与 CSS 拆分说明（v1 内容保留为历史基线）。
  - `test/run_all.py` 扩展：node 语法检查（24 个 JS 模块）、全代码文件 <600 行、ID3 Node 单元测试（10/10）、主题切换 CSS 变量变化、播放列表抽屉/四种循环模式/随机切歌/拖动排序/删除、快捷键 M 与空格、自动隐藏与唤出、`?renderer=2d` 回退、全程零 error/warning 与零 404、30 次切歌内存无线性泄漏。
  - 测试基建拆分 `test/harness.py`（服务、报告、页面事件、FPS），`run_all.py` 501 行、`harness.py` 152 行，均 <600。
  - 最终全量运行 PASS=94 FAIL=0 SKIP=0，完整输出存 `test/last_run.txt`；`shots/v2/` 保存关键截图。
- 验收对照：5 模式/4 主题 ✓；多文件/文件夹拖入、播放列表、四种播放模式、拖动跳转、音量/静音 ✓；ID3 中文标题/歌手/封面与损坏容错 ✓；WebGL 可用/可回退、控制台干净、无 404 ✓；桌面/手机 fps≥30（SwiftShader 实测约 60）且主体不被遮挡 ✓；设置刷新保留 ✓；模块化且无 >600 行文件 ✓；测试全 PASS、分阶段提交 ✓。可选项 L（PWA）未实现，URL 分享参数已实现。
- 下一步：交付完成。

## 已知问题
（暂无）
