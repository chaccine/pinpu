# 频谱 · 音乐可视化

纯静态、零依赖的浏览器音乐频谱可视化。原生 ES Modules + Canvas2D + WebGL，无构建步骤、无 CDN、无框架，直接用任意静态文件服务器打开即可。

## 功能

- **五种视觉模式**：环形频谱、镜像波形、粒子星系、律动封面环、3D 波形地形。
- **五套配色主题**：霓虹、落日、冰蓝、极光，以及第五项「封面」——从当前专辑封面提取主色动态生成；无封面时自动回退到上一个静态主题。
- **三种音源**：内置 120 BPM 合成演示曲、本地音频（MP3 / WAV / OGG / M4A 等）、麦克风输入。
- **播放列表**：多文件选择、文件夹/多文件拖拽递归加入、拖动排序、单曲删除、清空、点击切歌；顺序 / 列表循环 / 单曲循环 / 随机四种播放模式。
- **ID3 标签**：自研 ID3v2.2/2.3/2.4（含中文编码与封面）及 FLAC Vorbis Comment/PICTURE 解析；损坏文件安全降级为文件名。
- **WebGL 加速**：粒子星系与 3D 地形支持 GPU 渲染（WebGL2 → WebGL1 → Canvas2D 自动降级）；`?renderer=2d` 可强制 2D；上下文丢失自动恢复/降级。
- **自适应画质**：根据帧率自动在高/中/低画质间调整（柱数、粒子密度、辉光、分辨率），也可在设置中手动锁定。
- **设置面板**：画质、频谱柱数、粒子密度、节拍灵敏度、平滑度、FPS 显示、渲染器偏好、恢复默认。
- **持久化**：主题、模式、音量、静音、循环模式、设置项、播放列表开关与文件名在刷新后保留；URL `?mode=&theme=&renderer=` 可分享初始状态。
- **桌面与移动端**：全屏 / iOS 沉浸模式、界面自动淡出、横屏两行布局、模式按钮自适应不溢出、触屏拖动排序。
- **无障碍**：按钮 aria-label / aria-pressed、键盘 Tab 焦点、`prefers-reduced-motion` 降低粒子与镜头摇摆。
- **性能**：页面隐藏或失焦暂停渲染、暂停时限帧、渐变缓存、零逐帧分配、30 次切歌无线性内存增长。

## 本地运行

无需安装依赖或打包：

```bash
cd pinpu3
python3 -m http.server 8080
# 浏览器打开 http://localhost:8080/
```

> 必须通过 HTTP 访问（ES Modules 不能直接用 `file://` 打开）。任意静态服务器均可，例如 `npx serve`、Nginx。

可选 URL 参数：

| 参数 | 示例 | 说明 |
| --- | --- | --- |
| `mode` | `?mode=3` | 初始模式 0–4（环形/镜像/星系/封面环/地形） |
| `theme` | `?theme=cover` | 初始主题 `neon` / `sunset` / `ice` / `aurora` / `cover` |
| `renderer` | `?renderer=2d` | 强制 Canvas2D，不创建 WebGL 上下文 |

## 快捷键

| 按键 | 功能 |
| --- | --- |
| `空格` | 播放 / 暂停 |
| `1` – `5` | 切换视觉模式 |
| `T` | 循环切换配色主题 |
| `F` | 全屏 / iOS 沉浸模式 |
| `M` | 静音 / 取消静音 |
| `N` | 下一首 |
| `P` | 上一首 |
| `L` | 打开 / 关闭播放列表 |
| `S` | 切换播放模式（顺序/循环/单曲/随机） |
| `←` / `→` | 快退 / 快进 5 秒 |
| `↑` / `↓` | 音量 ±5% |
| `?` 或 `H` | 快捷键帮助 |
| `Esc` | 依次关闭帮助 / 设置 / 播放列表 / 沉浸模式 |

模式、主题、播放列表、快捷键帮助也可通过顶栏按钮打开。

## 目录结构

```
pinpu3/
├── index.html                 页面骨架（画布、顶栏、dock、提示、toast）
├── css/                       样式（按区域拆分，均 <600 行）
│   ├── base.css               全局变量、主题、画布、顶栏
│   ├── theme-panel.css        主题色块浮层
│   ├── dock.css               提示、拖拽遮罩、底部 dock、自动淡出、基础响应式
│   ├── playlist.css           正在播放行、走带扩展、五模式按钮、播放列表抽屉
│   ├── overlays.css           快捷键帮助、沉浸模式、多视口适配
│   └── settings.css           设置面板、FPS 表、移动端底部面板
├── js/
│   ├── main.js                启动、状态接线、主循环、快捷键、拖拽、调试接口
│   ├── state.js               轻量状态仓库（按键订阅）
│   ├── settings.js            设置默认值/清洗/持久化、柱数与密度档位
│   ├── storage.js             localStorage 封装（pinpu.v2.* 前缀、schema 版本）
│   ├── theme.js               四套静态主题 + 封面动态主题、颜色插值、CSS 变量、过渡控制器
│   ├── color.js               封面取色与主题生成纯函数（无 DOM 依赖）
│   ├── coverTheme.js          浏览器侧封面取色、缓存、切歌联动与无封面回退
│   ├── quality.js             自适应画质（高/中/低 + 迟滞 + 手动锁定）
│   ├── shortcuts.js           快捷键单一配置表（驱动按键与帮助浮层）
│   ├── utils.js               通用工具（色相、格式化、媒体查询）
│   ├── playlist.js            播放列表模型、循环/随机、Media Session、封面 URL 生命周期
│   ├── audio/
│   │   ├── engine.js          AudioContext、分析器、音源切换、音量、节拍检测接线
│   │   ├── beat.js            低频能量节拍检测
│   │   ├── demo.js            120 BPM 合成演示曲
│   │   └── id3.js             ID3v2 / FLAC 标签与封面解析
│   ├── render/
│   │   ├── renderer.js        渲染器工厂与能力检测
│   │   ├── canvas2d.js        Canvas2D 背景、环形、镜像、渐变缓存
│   │   ├── modes-extra.js     封面环、3D 地形、星系粒子与骨架
│   │   └── webgl.js           WebGL2/1 星系点精灵与地形历史纹理、上下文恢复
│   └── ui/
│       ├── dock.js            音源/走带/模式按钮与进度、音量交互
│       ├── autohide.js        播放时自动淡出界面
│       ├── help.js            快捷键帮助浮层
│       ├── toast.js           浮层消息
│       ├── theme-panel.js     主题面板
│       ├── playlist-panel.js  播放列表抽屉与拖动排序
│       └── settings-panel.js  设置面板与 FPS 表
├── test/
│   ├── run_all.py             Playwright 全量验收（桌面 + 手机）
│   ├── harness.py             测试基建（服务启停、报告、事件收集、FPS 测量）
│   ├── visual_shots.py        阶段4视觉自检截图（5 模式 × 4 主题 × 2 端）
│   ├── id3_node_test.mjs      ID3 解析 Node 单元测试
│   ├── fixtures/              测试音频与封面样本
│   └── last_run.txt           最近一次 run_all 结果
├── CHANGELOG.md               视觉自检与变更记录
├── PROGRESS.md                分阶段进度记录
└── ARCHITECTURE.md            v1 架构基线 + v2 模块划分
```

运行测试（Playwright 环境已预装在 `/workspace/pwenv`，使用系统 Chrome）：

```bash
/workspace/pwenv/bin/python test/run_all.py
```

测试会自动启动/关闭 `http.server`，输出 PASS/FAIL/SKIP 汇总并写入 `test/last_run.txt`；桌面 1440×900 与手机 390×844 两套环境，覆盖音源、模式、主题、播放列表、ID3、WebGL 回退、持久化、自动隐藏、快捷键、内存与零告警/零 404。

## 浏览器兼容

- 推荐 Chrome / Edge 90+、Firefox 90+、Safari 15+（含 iOS Safari）。
- WebGL2 可用时使用 GPU 星系/地形；仅 WebGL1 时 GPU 星系 + Canvas2D 地形；不可用时整体回退 Canvas2D。
- Safari 不支持 Fullscreen API 时，`F` 进入隐藏界面的沉浸模式。
- iOS 首次播放需在点击手势内解锁 AudioContext；失败会提示再次点击。
- 不支持 IE。文件夹拖拽递归依赖 `webkitGetAsEntry`，主流桌面浏览器均可用。

## 已知限制

- 纯前端站点，不包含音频文件上传/云端存储；播放列表刷新后仅恢复文件名，需要重新添加文件才能播放。
- WebGL 线段宽度受浏览器实现限制（通常固定 1px），地形近端线条略细于 Canvas2D，已通过透明度补偿。
- 音频解码与标签解析能力取决于浏览器；个别编码的 M4A/OGG 可能无法播放或读不到时长。
- 无 PWA/离线缓存（可选加分项未实现），需要 HTTP 服务器访问。
- headless Chrome + SwiftShader 截图读回会输出 `GL Driver Message ... ReadPixels` 驱动性能提示，属测试环境噪声；正常浏览无此提示。

## 调试接口

页面暴露 `window.__pinpu` 供自动化验收：

- 只读：`mode`、`beats`、`playing`、`source`、`fps`、`theme`、`renderer`、`playlistLength`、`currentIndex`、`meta`、`loopMode`、`volume`、`muted`、`quality`、`webglLevel`、`settings`、`features`
- 方法：`setMode(i)`、`setTheme(id)`、`next()`、`prev()`、`togglePlay()`、`setLoopMode(id)`
