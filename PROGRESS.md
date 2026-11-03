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

## 已知问题
（暂无）
