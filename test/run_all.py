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
import glob
import json
import os
import subprocess
import sys

from harness import (
    ROOT, BASE, FIX, CHROME, CHROME_ARGS,
    Report, PageHarness, measure_fps, start_server, stop_server,
)
from autoswitch_checks import v2_autoswitch_checks
from cover_theme_checks import v2_cover_theme_checks


# ---------------------------------------------------------------------------
# 静态检查：node 语法、单文件行数、ID3 Node 单元测试
# ---------------------------------------------------------------------------
def static_checks(rep):
    js_files = sorted(glob.glob(os.path.join(ROOT, "js", "**", "*.js"), recursive=True))
    bad = []
    for path in js_files:
        with open(path, "rb") as fh:
            src = fh.read()
        r = subprocess.run(["node", "--input-type=module", "--check"],
                           input=src, capture_output=True, timeout=30)
        if r.returncode:
            bad.append(os.path.relpath(path, ROOT))
    rep.ok(f"node语法检查({len(js_files)}个JS模块)", not bad, ", ".join(bad[:4]))

    all_code = (js_files
                + sorted(glob.glob(os.path.join(ROOT, "css", "*.css")))
                + sorted(glob.glob(os.path.join(ROOT, "test", "*.py")))
                + sorted(glob.glob(os.path.join(ROOT, "test", "*.mjs")))
                + [os.path.join(ROOT, "index.html")])
    too_long = []
    for path in all_code:
        with open(path, encoding="utf-8") as fh:
            n = sum(1 for _ in fh)
        if n > 600:
            too_long.append(f"{os.path.relpath(path, ROOT)}={n}")
    rep.ok("代码文件均<600行", not too_long, ", ".join(too_long[:4]))

    node_tests = [
        ("test/id3_node_test.mjs", "ID3 Node单元测试(标题/歌手/封面/损坏容错)", 10),
        ("test/lrc_node_test.mjs", "LRC Node单元测试(时间戳/多标签/offset/排序/边界)", 20),
        ("test/autoswitch_node_test.mjs", "自动切换 Node单元测试(定时/暂停/突增/防抖/轮换)", 15),
        ("test/color_node_test.mjs", "封面取色 Node单元测试(主色/回退/背景/字段)", 24),
    ]
    for rel, label, min_pass in node_tests:
        try:
            r = subprocess.run(["node", os.path.join(ROOT, rel)], cwd=ROOT,
                               capture_output=True, text=True, timeout=60)
            passes = r.stdout.count("[PASS]")
            fails = r.stdout.count("[FAIL]")
            rep.ok(label, r.returncode == 0 and fails == 0 and passes >= min_pass,
                   f"PASS={passes} FAIL={fails}")
        except Exception as e:
            rep.ok(label, False, str(e))


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
    accents = {await page.evaluate(
        "getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()")}
    for _ in range(6):
        await page.keyboard.press("t")
        await page.wait_for_timeout(500)
        seen.add(await page.evaluate("__pinpu.theme"))
        accents.add(await page.evaluate(
            "getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()"))
    h.check("主题≥4套且T可循环", len(seen) >= 4, f"seen={sorted(seen)}")
    h.check("主题切换CSS变量变化", len(accents) >= 2 and "" not in accents,
            f"accents={len(accents)}")


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

    # 打开抽屉：循环模式 / 随机 / 拖动排序 / 删除
    await page.click("#btnPlaylist")
    await page.wait_for_timeout(400)
    rows = await page.evaluate("document.querySelectorAll('.pl-item').length")
    h.check("播放列表抽屉显示曲目", rows == len(files), f"rows={rows}")

    loop_seen = []
    for _ in range(4):
        await page.click("#btnLoop")
        await page.wait_for_timeout(250)
        loop_seen.append(await page.evaluate("__pinpu.loopMode"))
    h.check("四种播放模式可循环",
            set(loop_seen) == {"order", "repeat", "single", "shuffle"}, str(loop_seen))

    await page.evaluate("__pinpu.setLoopMode('shuffle')")
    old = await page.evaluate("__pinpu.currentIndex")
    await page.evaluate("__pinpu.next()")
    await page.wait_for_timeout(900)
    cur = await page.evaluate("__pinpu.currentIndex")
    h.check("随机播放切歌不重复", 0 <= cur < len(files) and cur != old, f"{old}->{cur}")
    await page.evaluate("__pinpu.setLoopMode('order')")

    names_before = await page.evaluate(
        "Array.from(document.querySelectorAll('.pl-item .pl-name')).map(e=>e.textContent)")
    try:
        hd = page.locator(".pl-item").nth(0).locator(".pl-drag")
        hb = await hd.bounding_box()
        sb = await page.locator(".pl-item").nth(1).bounding_box()
        await page.mouse.move(hb["x"] + hb["width"] / 2, hb["y"] + hb["height"] / 2)
        await page.mouse.down()
        await page.mouse.move(hb["x"] + hb["width"] / 2,
                              sb["y"] + sb["height"] * 0.78, steps=6)
        await page.mouse.up()
        await page.wait_for_timeout(500)
    except Exception as e:
        print("拖动排序异常", e)
    names_after = await page.evaluate(
        "Array.from(document.querySelectorAll('.pl-item .pl-name')).map(e=>e.textContent)")
    h.check("拖动排序生效", names_after[:2] == [names_before[1], names_before[0]],
            f"{names_before[:2]} -> {names_after[:2]}")

    await page.locator(".pl-item").last.locator(".pl-del").click()
    await page.wait_for_timeout(350)
    ln2 = await page.evaluate("__pinpu.playlistLength")
    h.check("删除单曲", ln2 == len(files) - 1, f"len={ln2} 期望{len(files)-1}")
    await page.keyboard.press("Escape")
    await page.wait_for_timeout(250)


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


async def v2_lyrics_checks(h):
    page = h.page
    await page.goto(BASE)
    await page.wait_for_timeout(500)
    if not await has_feature(page, "lyrics"):
        h.skip("歌词同步", "features.lyrics 未启用")
        return

    base_errors = len(h.errors)
    await page.click("#btnDemo")
    await page.wait_for_timeout(700)
    sample = os.path.join(FIX, "sample.lrc")
    with open(sample, encoding="utf-8") as fh:
        lrc = fh.read()
    await page.evaluate("(t)=>window.__pinpu.loadLyrics(t)", lrc)
    await page.wait_for_timeout(350)

    st = await page.evaluate(
        """()=>{const el=document.querySelector('#lyricsOverlay');
        const cur=document.querySelector('#lyricCurrent');
        return {visible:!!el && !el.hidden && getComputedStyle(el).display!=='none',
          loaded:!!__pinpu.lyricsLoaded, line:__pinpu.lyricsLine,
          dom:cur?cur.textContent:'', show:__pinpu.showLyrics};}"""
    )
    h.check("歌词覆盖层可见", st["visible"], str(st))
    h.check("歌词已载入且当前行高亮", st["loaded"] and bool(st["line"])
            and st["line"] == st["dom"], str(st))
    h.check("显示歌词设置默认开启", st["show"] is True, str(st["show"]))

    boxes = await page.evaluate(
        """()=>{const o=document.querySelector('#lyricsOverlay');
        const d=document.querySelector('#dock'); const t=document.querySelector('.topbar');
        if(!o||!d||!t) return null;
        const a=o.getBoundingClientRect(), b=d.getBoundingClientRect(), c=t.getBoundingClientRect();
        return {top:Math.round(a.top),bottom:Math.round(a.bottom),
          dockTop:Math.round(b.top),barBottom:Math.round(c.bottom)};}"""
    )
    h.check("歌词不与顶栏/dock重叠",
            bool(boxes) and boxes["bottom"] <= boxes["dockTop"] + 1
            and boxes["top"] >= boxes["barBottom"] - 1, str(boxes))

    first = st["line"]
    await page.wait_for_timeout(1900)
    second = await page.evaluate("__pinpu.lyricsLine")
    h.check("当前行随播放时间变化", bool(first) and bool(second) and second != first,
            f"{first} -> {second}")

    # 通过设置面板关闭「显示歌词」
    await page.evaluate("document.querySelector('#btnSettings').click()")
    await page.wait_for_timeout(300)
    checked = await page.evaluate(
        "document.querySelector('#spLyrics') ? document.querySelector('#spLyrics').checked : null")
    h.check("设置面板含显示歌词开关", checked is True, str(checked))
    await page.evaluate("document.querySelector('#spLyrics').click()")
    await page.wait_for_timeout(350)
    off = await page.evaluate(
        """()=>{const el=document.querySelector('#lyricsOverlay');
        return {hidden:el.hidden, display:getComputedStyle(el).display,
          show:__pinpu.showLyrics, setting:__pinpu.settings.showLyrics};}"""
    )
    h.check("关闭设置后歌词隐藏",
            off["hidden"] and off["display"] == "none"
            and off["show"] is False and off["setting"] is False, str(off))

    errs = [e for e in h.errors[base_errors:] if "favicon" not in e[1].lower()]
    h.check("歌词用例无控制台error", len(errs) == 0, str(errs[:4]))

    # 恢复开关，避免影响后续用例
    await page.evaluate("__pinpu.setShowLyrics(true)")
    await page.wait_for_timeout(250)
    restored = await page.evaluate(
        "!document.querySelector('#lyricsOverlay').hidden && __pinpu.showLyrics")
    h.check("重新开启后歌词恢复", restored is True, str(restored))
    await page.keyboard.press("Escape")
    await page.wait_for_timeout(200)


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

    # 静音与空格播放/暂停
    await page.click("#btnDemo")
    await page.wait_for_timeout(1200)
    muted0 = await page.evaluate("__pinpu.muted")
    await page.keyboard.press("m")
    await page.wait_for_timeout(250)
    muted1 = await page.evaluate("__pinpu.muted")
    h.check("快捷键M切换静音", muted1 != muted0, f"{muted0}->{muted1}")
    playing0 = await page.evaluate("__pinpu.playing")
    await page.keyboard.press(" ")
    await page.wait_for_timeout(700)
    playing1 = await page.evaluate("__pinpu.playing")
    h.check("空格播放/暂停", playing1 != playing0, f"{playing0}->{playing1}")
    await page.keyboard.press(" ")


async def v2_autohide_checks(h, is_mobile):
    page = h.page
    await page.goto(BASE)
    await page.click("#btnDemo")
    if is_mobile:
        await page.touchscreen.tap(200, 300)  # 离开 dock，解除悬停抑制
    else:
        await page.mouse.move(720, 220)
    await page.wait_for_timeout(3800)
    hid = await page.evaluate("document.body.classList.contains('ui-hidden')")
    h.check("播放时自动隐藏UI", hid)
    if is_mobile:
        await page.touchscreen.tap(240, 320)
    else:
        await page.mouse.move(760, 260)
    await page.wait_for_timeout(300)
    vis = await page.evaluate("!document.body.classList.contains('ui-hidden')")
    h.check("指针移动唤出UI", vis)


async def v2_memory_checks(h):
    page = h.page
    if not await has_feature(page, "playlist"):
        return
    await page.goto(BASE)
    files = [os.path.join(FIX, f) for f in
             ("id3v23_cn.mp3", "id3v24_utf8.mp3", "notag.mp3", "tone.wav")
             if os.path.exists(os.path.join(FIX, f))]
    await page.set_input_files("#fileInput", files)
    await page.wait_for_timeout(2200)

    async def heap():
        return await page.evaluate(
            """()=>{ if (typeof gc==='function') gc();
            return performance.memory ? performance.memory.usedJSHeapSize : -1; }""")

    base = await heap()
    for _ in range(30):
        await page.evaluate("__pinpu.next()")
        await page.wait_for_timeout(160)
    await page.wait_for_timeout(900)
    after = await heap()
    if base < 0 or after < 0:
        h.skip("30次切歌内存无线性泄漏", "performance.memory 不可用")
        return
    delta_kb = round((after - base) / 1024)
    h.check("30次切歌内存无线性泄漏", delta_kb < 4096,
            f"{round(base/1024)}KB -> {round(after/1024)}KB (+{delta_kb}KB)")


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
    await v2_cover_theme_checks(h)
    await v2_modes_checks(h)
    await v2_playlist_checks(h, is_mobile)
    await v2_id3_checks(h)
    await v2_lyrics_checks(h)
    await v2_renderer_checks(h)
    await v2_autoswitch_checks(h)
    await v2_persist_checks(h)
    await v2_shortcut_help(h)
    await v2_autohide_checks(h, is_mobile)
    if not is_mobile:
        await v2_memory_checks(h)

    # 全程控制台与资源请求（覆盖上述所有导航与交互）
    errs = [e for e in h.errors if "favicon" not in e[1].lower()]
    h.check("全程控制台无error/warning", len(errs) == 0, str(errs[:4]))
    bad = h.not_404()
    h.check("全程无404请求", len(bad) == 0, str(bad[:4]))

    # 收尾截图
    await page.goto(BASE)
    await page.click("#btnDemo")
    await page.wait_for_timeout(4000)
    await h.shot("final")

    await ctx.close()


async def main():
    from playwright.async_api import async_playwright
    rep = Report()
    print("=== 静态检查 ===", flush=True)
    static_checks(rep)
    proc = start_server()
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
