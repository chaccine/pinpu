#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""阶段4视觉自检截图：5 模式 × 4 主题 × 桌面/手机，共 40 张，另截 WebGL/2D 对照 10 张。

用法： /workspace/pwenv/bin/python test/visual_shots.py
输出： shots/v4/{desktop|mobile}-{theme}-{mode}.png 与 compare-{webgl|2d}-{mode}.png
"""
import asyncio
import os
import signal
import socket
import subprocess
import sys
import time
import urllib.request

from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8766
BASE = f"http://localhost:{PORT}/index.html"
OUT = os.path.join(ROOT, "shots", "v4")
CHROME = "/usr/bin/google-chrome"
THEMES = ["neon", "sunset", "ice", "aurora"]
MODES = ["ring", "mirror", "galaxy", "cover", "terrain"]

os.makedirs(OUT, exist_ok=True)


def start_server():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        if s.connect_ex(("127.0.0.1", PORT)) == 0:
            return None
    proc = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"],
        cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
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
    if proc:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
        except Exception:
            pass


async def shoot(page, path):
    await page.evaluate("document.body.classList.remove('ui-hidden')")
    await page.screenshot(path=path)


async def setup_page(ctx, url):
    page = await ctx.new_page()
    await page.goto(url, wait_until="load")
    await page.click("#btnDemo")
    await page.wait_for_timeout(4200)  # 演示曲播放 4 秒后开始截图
    return page


async def main():
    server = start_server()
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(executable_path=CHROME, headless=True,
                                              args=["--no-sandbox", "--disable-dev-shm-usage",
                                                    "--autoplay-policy=no-user-gesture-required"])
            for label, viewport, mobile in [
                ("desktop", {"width": 1440, "height": 900}, False),
                ("mobile", {"width": 390, "height": 844}, True),
            ]:
                ctx = await browser.new_context(viewport=viewport, device_scale_factor=1,
                                                is_mobile=mobile, has_touch=mobile)
                page = await setup_page(ctx, BASE)
                for theme in THEMES:
                    for mi, mname in enumerate(MODES):
                        await page.evaluate(f"__pinpu.setTheme('{theme}')")
                        await page.wait_for_timeout(700)
                        await page.evaluate(f"__pinpu.setMode({mi})")
                        await page.wait_for_timeout(600)
                        path = os.path.join(OUT, f"{label}-{theme}-{mname}.png")
                        await shoot(page, path)
                        print("shot", os.path.relpath(path, ROOT), flush=True)
                await ctx.close()

            # WebGL 与 2D 对照（桌面霓虹，各 5 模式）
            for renderer, url in [("webgl", BASE), ("2d", f"{BASE}?renderer=2d")]:
                ctx = await browser.new_context(viewport={"width": 1440, "height": 900},
                                                device_scale_factor=1)
                page = await setup_page(ctx, url)
                await page.evaluate("__pinpu.setTheme('neon')")
                await page.wait_for_timeout(700)
                for mi, mname in enumerate(MODES):
                    await page.evaluate(f"__pinpu.setMode({mi})")
                    await page.wait_for_timeout(600)
                    path = os.path.join(OUT, f"compare-{renderer}-{mname}.png")
                    await shoot(page, path)
                    print("shot", os.path.relpath(path, ROOT), flush=True)
                await ctx.close()
            await browser.close()
    finally:
        stop_server(server)
    print("完成：40 张主截图 + 10 张对照截图，目录 shots/v4/", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
