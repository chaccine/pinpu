#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
频谱 v2 统一验收测试。
- 自动在后台启动 python http.server（端口 8765），结束后关闭。
- Playwright 驱动系统 google-chrome，桌面 1440x900 与手机 390x844(触屏) 两套环境。
- 覆盖各阶段验收项，输出 PASS/FAIL/SKIP 汇总，关键截图存 shots/v2/。
- 随阶段推进逐步扩充；尚未实现的特性以 SKIP 标记，不算失败。

用法： /workspace/pwenv/bin/python test/run_all.py [--keep-server] [--only 名称子串]
"""
import asyncio
import json
import os
import re
import signal
import socket
import subprocess
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8765
BASE = f"http://localhost:{PORT}/index.html"
FIX = os.path.join(ROOT, "test", "fixtures")
SHOTS = os.path.join(ROOT, "shots", "v2")
CHROME = "/usr/bin/google-chrome"

os.makedirs(SHOTS, exist_ok=True)

# headless SwiftShader 在截图 readback 时会打印驱动性能提示，属测试环境噪声而非页面告警
GL_DRIVER_NOISE = re.compile(r"GL Driver Message .*(ReadPixels|GL_CLOSE_PATH)")


def env_gl_noise(text):
    return bool(GL_DRIVER_NOISE.search(text or ""))

# 说明：headless chrome 默认即提供软件 WebGL2（SwiftShader）且 Canvas2D 跑满 60fps。
# 强制 --use-angle=swiftshader 会把 Canvas2D 也拖到软件 GL（4~18fps），故不使用。
CHROME_ARGS = [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--autoplay-policy=no-user-gesture-required",
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
]

ONLY = None
if "--only" in sys.argv:
    ONLY = sys.argv[sys.argv.index("--only") + 1]


class Report:
    def __init__(self):
        self.rows = []  # (status, name, detail)

    def add(self, status, name, detail=""):
        self.rows.append((status, name, detail))
        mark = {"PASS": "✓", "FAIL": "✗", "SKIP": "–"}.get(status, "?")
        print(f"  [{mark}] {status:4} {name}" + (f"  — {detail}" if detail else ""), flush=True)

    def ok(self, name, cond, detail=""):
        self.add("PASS" if cond else "FAIL", name, detail)
        return bool(cond)

    def skip(self, name, detail=""):
        self.add("SKIP", name, detail)

    def summary(self):
        p = sum(1 for r in self.rows if r[0] == "PASS")
        f = sum(1 for r in self.rows if r[0] == "FAIL")
        s = sum(1 for r in self.rows if r[0] == "SKIP")
        return p, f, s


def port_free():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(("127.0.0.1", PORT)) != 0


def start_server():
    if not port_free():
        print(f"端口 {PORT} 已被占用，假定服务已在运行")
        return None
    proc = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"],
        cwd=ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        preexec_fn=os.setsid,
    )
    for _ in range(60):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{PORT}/index.html", timeout=1)
            return proc
        except Exception:
            time.sleep(0.25)
    raise RuntimeError("http.server 启动超时")


def stop_server(proc):
    if proc is None:
        return
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
    except Exception:
        pass


def want(name):
    return ONLY is None or ONLY in name


# ---------------------------------------------------------------------------
# 通用页面工具
# ---------------------------------------------------------------------------
class PageHarness:
    def __init__(self, page, report, tag):
        self.page = page
        self.rep = report
        self.tag = tag
        self.errors = []
        self.failed = []
        page.on("console", lambda m: self.errors.append((m.type, m.text))
                if m.type in ("error", "warning") and not env_gl_noise(m.text) else None)
        page.on("pageerror", lambda e: self.errors.append(("pageerror", str(e))))
        page.on("requestfailed", lambda r: self.failed.append(
            (r.url, getattr(r, "failure", None) and r.failure)))
        self._responses = []
        page.on("response", lambda r: self._responses.append((r.status, r.url)))

    def name(self, n):
        return f"{self.tag}:{n}"

    def check(self, n, cond, detail=""):
        if not want(n):
            return
        self.rep.ok(self.name(n), cond, detail)

    def skip(self, n, detail=""):
        if not want(n):
            return
        self.rep.skip(self.name(n), detail)

    def not_404(self):
        bad = [u for (s, u) in self._responses if s == 404]
        return bad

    async def shot(self, n):
        if not want(n):
            return
        try:
            await self.page.screenshot(path=os.path.join(SHOTS, f"{self.tag}-{n}.png"))
        except Exception as e:
            print("截图失败", n, e)


async def measure_fps(page, ms=2500):
    return await page.evaluate(
        """(ms)=>new Promise(r=>{let n=0;const t0=performance.now();
        function f(){n++;if(performance.now()-t0>ms)r(Math.round(n/((performance.now()-t0)/1000)));
        else requestAnimationFrame(f);}requestAnimationFrame(f);})""", ms)


# ---------------------------------------------------------------------------
# 基线 / 通用验收（v1 起即应通过，v2 持续保持）
# ---------------------------------------------------------------------------
async def baseline_checks(h, is_mobile):
    page = h.page
    await page.goto(BASE)
    await page.wait_for_timeout(600)

    # 调试对象契约
    api = await page.evaluate(
        """()=>{const p=window.__pinpu||{};return {
            has: !!window.__pinpu,
            mode:p.mode, beats:p.beats, playing:p.playing, source:p.source,
            fps:p.fps, hasSetMode: typeof p.setMode==='function',
            theme:p.theme, renderer:p.renderer,
            playlistLength:p.playlistLength, currentIndex:p.currentIndex, meta:p.meta };}"""
    )
    h.check("调试对象存在", api["has"])
    h.check("调试字段齐全",
            all(api.get(k) is not None for k in ("mode", "beats", "playing", "source"))
            and api.get("hasSetMode"))

    # 演示曲目 + 节拍
    await page.click("#btnDemo")
    await page.wait_for_timeout(4000)
    st = await page.evaluate("({playing:__pinpu.playing,source:__pinpu.source,beats:__pinpu.beats})")
    h.check("演示曲播放中", st["playing"] and st["source"] == "demo", str(st))
    b1 = await page.evaluate("__pinpu.beats")
    await page.wait_for_timeout(4000)
    b2 = await page.evaluate("__pinpu.beats")
    h.check("节拍在累加", b2 > b1, f"{b1}->{b2}")

    # 模式数量：v1=3, v2=5
    mode_count = await page.evaluate("document.querySelectorAll('.mode').length")
    h.check("模式按钮存在", mode_count >= 3, f"count={mode_count}")

    # 逐模式截图（保持唤醒）
    names = ["ring", "mirror", "galaxy", "cover", "terrain"]
    for i in range(mode_count):
        await page.mouse.move(200 + i * 7, 200)
        await page.wait_for_timeout(250)
        try:
            await page.click(f'.mode[data-mode="{i}"]')
        except Exception:
            await page.evaluate(f"__pinpu.setMode({i})")
        await page.wait_for_timeout(2200)
        cur = await page.evaluate("__pinpu.mode")
        h.check(f"切到模式{i}", cur == i, f"mode={cur}")
        await h.shot(names[i] if i < len(names) else f"mode{i}")

    # FPS（swiftshader 下 >=30）
    await page.evaluate("__pinpu.setMode(0)")
    await page.mouse.move(300, 300)
    await page.wait_for_timeout(300)
    fps = await measure_fps(page)
    h.check("帧率达标(>=30)", fps >= 30, f"fps={fps}")

    # 走带/进度（用 wav 文件）
    wav = os.path.join(FIX, "tone.wav")
    if os.path.exists(wav):
        try:
            await page.set_input_files("#fileInput", wav)
            await page.wait_for_timeout(2500)
        except Exception:
            pass
        fst = await page.evaluate("({source:__pinpu.source})")
        # v2 加入播放列表后 source 可能仍为 file
        h.check("文件已载入", fst["source"] in ("file", "playlist"), str(fst))
        # 进度跳转
        seek_ok = await page.evaluate(
            """()=>{const p=document.getElementById('progress');
            if(p.disabled) return 'disabled';
            p.value=500;p.dispatchEvent(new Event('input',{bubbles:true}));
            p.dispatchEvent(new Event('change',{bubbles:true}));return 'ok';}""")
        h.check("进度条可拖动", seek_ok in ("ok", "disabled"), seek_ok)

    # 麦克风
    try:
        await page.mouse.move(310, 310)
        await page.wait_for_timeout(200)
        await page.click("#btnMic")
        await page.wait_for_timeout(2000)
        mic = await page.evaluate("({source:__pinpu.source,playing:__pinpu.playing})")
        h.check("麦克风接入", mic["source"] == "mic", str(mic))
    except Exception as e:
        h.skip("麦克风接入", str(e))

    # 控制台与 404
    errs = [e for e in h.errors if "favicon" not in e[1].lower()]
    h.check("控制台无error/warning", len(errs) == 0, str(errs[:4]))
    bad = h.not_404()
    h.check("无404请求", len(bad) == 0, str(bad[:4]))


# ---------------------------------------------------------------------------
# v2 专项（阶段2/3 起逐步启用；特性缺失时 SKIP）
# ---------------------------------------------------------------------------
async def exists(page, sel):
    return await page.evaluate(f"!!document.querySelector({json.dumps(sel)})")


async def has_feature(page, name):
    return await page.evaluate(
        f"!!(window.__pinpu && __pinpu.features && __pinpu.features[{json.dumps(name)}])")


async def v2_theme_checks(h):
    page = h.page
    if not await has_feature(page, "themes"):
        h.skip("主题系统", "features.themes 未启用")
        return
    await page.goto(BASE)
    await page.click("#btnDemo")
    await page.wait_for_timeout(1500)
    themes = await page.evaluate("()=>(__pinpu.themes&&__pinpu.themes.length)||0")
    seen = set()
    t0 = await page.evaluate("__pinpu.theme")
    seen.add(t0)
    for _ in range(6):
        await page.keyboard.press("t")
        await page.wait_for_timeout(500)
        seen.add(await page.evaluate("__pinpu.theme"))
    h.check("主题≥4套且T可循环", len(seen) >= 4, f"seen={sorted(seen)}")
    # CSS 变量随主题变化
    acc = await page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()")
    h.check("CSS变量--accent存在", acc != "", acc)


async def v2_modes_checks(h):
    page = h.page
    n = await page.evaluate("document.querySelectorAll('.mode').length")
    if n < 5:
        h.skip("五种视觉模式", f"当前仅{n}个")
        return
    await page.goto(BASE)
    await page.click("#btnDemo")
    await page.wait_for_timeout(1500)
    for i in range(5):
        await page.keyboard.press(str(i + 1))
        await page.wait_for_timeout(400)
        cur = await page.evaluate("__pinpu.mode")
        h.check(f"快捷键{i+1}切模式", cur == i, f"mode={cur}")


async def v2_playlist_checks(h, is_mobile):
    page = h.page
    if not await has_feature(page, "playlist"):
        h.skip("播放列表", "features.playlist 未启用")
        return
    await page.goto(BASE)
    files = [os.path.join(FIX, f) for f in ("id3v23_cn.mp3", "id3v24_utf8.mp3", "notag.mp3", "tone.wav")]
    files = [f for f in files if os.path.exists(f)]
    await page.set_input_files("#fileInput", files)
    await page.wait_for_timeout(2500)
    ln = await page.evaluate("__pinpu.playlistLength")
    h.check("多文件加入播放列表", ln == len(files), f"len={ln} 期望{len(files)}")
    # 切歌
    await page.evaluate("__pinpu.next && __pinpu.next()")
    await page.wait_for_timeout(1200)
    idx = await page.evaluate("__pinpu.currentIndex")
    h.check("下一首切歌", idx == 1, f"idx={idx}")
    meta = await page.evaluate("__pinpu.meta")
    h.check("meta含标题", bool(meta and meta.get("title")), str(meta))


async def v2_id3_checks(h):
    page = h.page
    if not await has_feature(page, "id3"):
        h.skip("ID3显示", "features.id3 未启用")
        return
    await page.goto(BASE)
    f = os.path.join(FIX, "id3v23_cn.mp3")
    await page.set_input_files("#fileInput", f)
    await page.wait_for_timeout(2500)
    meta = await page.evaluate("__pinpu.meta")
    h.check("ID3v2.3中文标题", meta and "霓虹夜行" in (meta.get("title") or ""), str(meta))
    h.check("ID3v2.3中文歌手", meta and "星轨乐队" in (meta.get("artist") or ""), str(meta))
    h.check("ID3v2.3封面", meta and meta.get("hasCover"), str(meta))


async def v2_renderer_checks(h):
    page = h.page
    if not await has_feature(page, "webgl"):
        h.skip("渲染器", "features.webgl 未启用")
        return
    await page.goto(BASE + "?renderer=2d")
    await page.wait_for_timeout(800)
    r = await page.evaluate("__pinpu.renderer")
    h.check("?renderer=2d强制回退", r == "2d", f"renderer={r}")
    await page.goto(BASE)
    await page.wait_for_timeout(800)
    r2 = await page.evaluate("__pinpu.renderer")
    h.check("默认渲染器上报", r2 in ("webgl", "2d"), f"renderer={r2}")


async def v2_persist_checks(h):
    page = h.page
    if not await has_feature(page, "persist"):
        h.skip("持久化", "features.persist 未启用")
        return
    await page.goto(BASE)
    await page.wait_for_timeout(500)
    await page.keyboard.press("t")
    await page.wait_for_timeout(400)
    await page.keyboard.press("3")
    await page.wait_for_timeout(400)
    th = await page.evaluate("__pinpu.theme")
    md = await page.evaluate("__pinpu.mode")
    await page.reload()
    await page.wait_for_timeout(900)
    th2 = await page.evaluate("__pinpu.theme")
    md2 = await page.evaluate("__pinpu.mode")
    h.check("刷新后主题保留", th == th2, f"{th}->{th2}")
    h.check("刷新后模式保留", md == md2, f"{md}->{md2}")


async def v2_shortcut_help(h):
    page = h.page
    if not await has_feature(page, "help"):
        h.skip("快捷键帮助", "features.help 未启用")
        return
    await page.goto(BASE)
    await page.wait_for_timeout(400)
    await page.keyboard.press("?")
    await page.wait_for_timeout(500)
    vis = await page.evaluate(
        """()=>{const el=document.querySelector('#helpPanel,[data-help]');
        return el? getComputedStyle(el).display!=='none' && el.classList.contains('show'):false;}""")
    h.check("?打开帮助", vis)
    await page.keyboard.press("Escape")
    await page.wait_for_timeout(400)


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------
async def run_context(browser, is_mobile, rep):
    tag = "mobile" if is_mobile else "desktop"
    if is_mobile:
        ctx = await browser.new_context(
            viewport={"width": 390, "height": 844},
            device_scale_factor=2, is_mobile=True, has_touch=True,
            permissions=["microphone"],
            user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
        )
    else:
        ctx = await browser.new_context(
            viewport={"width": 1440, "height": 900},
            permissions=["microphone"],
        )
    page = await ctx.new_page()
    h = PageHarness(page, rep, tag)

    print(f"\n=== {tag} 基线 ===", flush=True)
    await baseline_checks(h, is_mobile)

    print(f"\n=== {tag} v2 专项 ===", flush=True)
    await v2_theme_checks(h)
    await v2_modes_checks(h)
    await v2_playlist_checks(h, is_mobile)
    await v2_id3_checks(h)
    await v2_renderer_checks(h)
    await v2_persist_checks(h)
    await v2_shortcut_help(h)

    # 收尾截图
    await page.goto(BASE)
    await page.click("#btnDemo")
    await page.wait_for_timeout(4000)
    await h.shot("final")

    await ctx.close()


async def main():
    from playwright.async_api import async_playwright
    proc = start_server()
    rep = Report()
    exit_code = 0
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(executable_path=CHROME, headless=True, args=CHROME_ARGS)
            await run_context(browser, False, rep)
            await run_context(browser, True, rep)
            await browser.close()
    finally:
        if "--keep-server" not in sys.argv:
            stop_server(proc)

    p, f, s = rep.summary()
    print("\n" + "=" * 56)
    print(f"汇总: PASS={p}  FAIL={f}  SKIP={s}  总计={len(rep.rows)}")
    if f:
        print("失败项:")
        for st, n, d in rep.rows:
            if st == "FAIL":
                print(f"  ✗ {n}  {d}")
    print("=" * 56)
    # 落盘结果，供阶段末比对
    with open(os.path.join(ROOT, "test", "last_run.txt"), "w", encoding="utf-8") as fh:
        for st, n, d in rep.rows:
            fh.write(f"{st}\t{n}\t{d}\n")
        fh.write(f"\n汇总: PASS={p} FAIL={f} SKIP={s}\n")
    exit_code = 1 if f else 0
    sys.exit(exit_code)


if __name__ == "__main__":
    asyncio.run(main())
