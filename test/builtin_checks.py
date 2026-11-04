#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""内置曲目浏览器用例：懒加载（点击前不下载）、点击后走本地文件路径、标题/歌手/封面解析、重复点击不重复加入。"""
from harness import BASE

MP3 = "color-your-night.mp3"


async def v2_builtin_checks(h):
    page = h.page
    has = await page.evaluate("!!document.querySelector('#btnBuiltin')")
    if not has:
        h.skip("内置曲目", "无 #btnBuiltin")
        return
    reqs = []
    page.on("request", lambda r: reqs.append(r.url) if MP3 in r.url else None)
    await page.goto(BASE)
    await page.wait_for_timeout(1200)
    h.check("内置曲目按钮存在", has)
    h.check("加载页面时不下载内置曲目(懒加载)", len(reqs) == 0, str(reqs))

    base_errors = len(h.errors)
    await page.click("#btnBuiltin")
    await page.wait_for_function(
        "__pinpu.source === 'file' && __pinpu.meta && __pinpu.meta.title", timeout=30000)
    await page.wait_for_timeout(2500)
    st = await page.evaluate(
        """()=>({source:__pinpu.source, playing:__pinpu.playing, meta:__pinpu.meta,
          len:__pinpu.playlistLength,
          active:document.querySelector('#btnBuiltin').classList.contains('is-active')})""")
    h.check("点击后才请求 mp3", len(reqs) >= 1, str(reqs))
    h.check("内置曲目播放中(source=file)", st["source"] == "file" and st["playing"], str(st))
    h.check("内置曲目 ID3 标题解析", st["meta"]["title"] == "Color Your Night", str(st["meta"]))
    h.check("内置曲目 ID3 歌手解析", bool(st["meta"].get("artist")), str(st["meta"]))
    # 该 mp3 文件本身没有内嵌封面：hasCover 必须为 False（不得误判），封面环模式回退到渐变唱片且无报错
    h.check("内置曲目无内嵌封面时 hasCover=False", st["meta"].get("hasCover") is False, str(st["meta"]))
    await page.evaluate("__pinpu.setMode(3)")
    await page.wait_for_timeout(1500)
    h.check("内置曲目按钮高亮", st["active"], str(st))
    t0 = await page.evaluate("document.querySelector('#timeNow').textContent")
    await page.wait_for_timeout(2000)
    t1 = await page.evaluate("document.querySelector('#timeNow').textContent")
    h.check("内置曲目时间在走", t0 != t1, f"{t0}->{t1}")

    # 重复点击不重复加入播放列表
    await page.click("#btnBuiltin")
    await page.wait_for_timeout(1500)
    n = await page.evaluate("__pinpu.playlistLength")
    h.check("重复点击不重复加入列表", n == st["len"], f"{st['len']}->{n}")
    h.check("内置曲目无新增控制台错误", len(h.errors) == base_errors, str(h.errors[base_errors:][:3]))
    await h.shot("builtin")
