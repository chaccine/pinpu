#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""run_all.py 的共享测试基建：服务启停、报告、页面事件收集、FPS 测量。"""
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
    "--js-flags=--expose-gc",
]

ONLY = None
if "--only" in sys.argv:
    ONLY = sys.argv[sys.argv.index("--only") + 1]


def want(name):
    return ONLY is None or ONLY in name


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
