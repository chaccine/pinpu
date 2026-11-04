#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""封面主题浏览器用例：封面取色、动态 accent、无封面回退与自动恢复。"""
import json
import os

from harness import BASE, FIX


async def _has_feature(page, name):
    return await page.evaluate(
        f"!!(window.__pinpu && __pinpu.features && __pinpu.features[{json.dumps(name)}])")


async def v2_cover_theme_checks(h):
    page = h.page
    if not await _has_feature(page, "coverTheme"):
        h.skip("封面主题", "features.coverTheme 未启用")
        return
    cover_file = os.path.join(FIX, "cover_color.mp3")
    no_cover = os.path.join(FIX, "notag.mp3")
    if not os.path.exists(cover_file):
        h.skip("封面主题", "缺少 cover_color.mp3 fixture")
        return

    # URL 参数支持
    await page.goto(BASE + "?theme=cover")
    await page.wait_for_timeout(600)
    url_theme = await page.evaluate("__pinpu.theme")
    h.check("URL ?theme=cover 生效", url_theme == "cover", str(url_theme))

    # 从霓虹开始，确保对比基线稳定
    await page.goto(BASE)
    await page.wait_for_timeout(500)
    await page.evaluate("__pinpu.setTheme('neon')")
    await page.wait_for_timeout(650)
    neon = await page.evaluate(
        "getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()")

    base_errors = len(h.errors)
    await page.set_input_files("#fileInput", [cover_file, no_cover])
    await page.wait_for_function("__pinpu.meta && __pinpu.meta.hasCover === true", timeout=10000)
    await page.wait_for_function(
        "Array.isArray(__pinpu.coverPalette) && __pinpu.coverPalette.length >= 2", timeout=8000)

    # 面板第 5 项「封面」可用，色块为彩色渐变
    await page.evaluate("document.querySelector('#btnTheme').click()")
    await page.wait_for_timeout(300)
    count = await page.evaluate("document.querySelectorAll('.theme-item').length")
    h.check("主题面板含封面项", count == 5, f"count={count}")
    ui = await page.evaluate(
        """()=>{const el=document.querySelector('.theme-item[data-theme="cover"]');
        const sw=el&&el.querySelector('.theme-swatch');
        return {disabled:el?el.getAttribute('aria-disabled'):null,
          cls:el?el.className:'', bg:sw?sw.style.background:''};}"""
    )
    h.check("有封面时封面项可用", ui["disabled"] == "false", str(ui["disabled"]))
    h.check("封面色块使用动态渐变", "gradient" in ui["bg"].lower()
            and "3b4354" not in ui["bg"].lower(), ui["bg"])

    await page.evaluate(
        "document.querySelector('.theme-item[data-theme=\"cover\"]').click()")
    await page.wait_for_timeout(950)
    st = await page.evaluate(
        """()=>({theme:__pinpu.theme,active:__pinpu.coverThemeActive,
        palette:__pinpu.coverPalette,accent:getComputedStyle(document.documentElement)
          .getPropertyValue('--accent').trim()})"""
    )
    h.check("选中封面主题", st["theme"] == "cover", str(st["theme"]))
    h.check("封面取色生效", st["active"] is True and isinstance(st["palette"], list)
            and len(st["palette"]) >= 2, str(st["palette"]))
    h.check("封面 accent 与霓虹不同", st["accent"] != neon and st["accent"] != "#5ce1ff",
            f"{neon} -> {st['accent']}")

    # 切到无封面曲目：回退到选择封面前的主题
    await page.evaluate("__pinpu.next()")
    await page.wait_for_function("__pinpu.currentIndex === 1", timeout=5000)
    await page.wait_for_timeout(1100)
    fb = await page.evaluate(
        """()=>({theme:__pinpu.theme,active:__pinpu.coverThemeActive,
        disabled:document.querySelector('.theme-item[data-theme="cover"]')
          .getAttribute('aria-disabled'),palette:__pinpu.coverPalette})"""
    )
    h.check("无封面回退到原主题", fb["theme"] == "neon", str(fb["theme"]))
    h.check("无封面时封面主题不激活", fb["active"] is False and fb["palette"] is None, str(fb))
    h.check("无封面时封面项 aria-disabled", fb["disabled"] == "true", str(fb["disabled"]))

    await page.evaluate(
        "document.querySelector('.theme-item[data-theme=\"cover\"]').click()")
    await page.wait_for_timeout(300)
    toast = await page.evaluate("document.querySelector('#toast').textContent")
    after_click = await page.evaluate("__pinpu.theme")
    h.check("点击无封面项提示且不切换", "没有封面" in toast and after_click == "neon",
            f"{toast}/{after_click}")

    # 回到有封面曲目：自动恢复 cover
    await page.evaluate("__pinpu.prev()")
    await page.wait_for_timeout(250)
    await page.evaluate("__pinpu.prev()")
    await page.wait_for_function("__pinpu.currentIndex === 0", timeout=5000)
    await page.wait_for_function(
        "__pinpu.theme === 'cover' && __pinpu.coverThemeActive === true", timeout=5000)
    await page.wait_for_timeout(700)
    back = await page.evaluate(
        """()=>({theme:__pinpu.theme,active:__pinpu.coverThemeActive,
        accent:getComputedStyle(document.documentElement)
          .getPropertyValue('--accent').trim()})"""
    )
    h.check("有封面曲目自动恢复封面主题",
            back["theme"] == "cover" and back["active"] is True, str(back))
    h.check("恢复后 accent 回到封面色", back["accent"] == st["accent"],
            f"{st['accent']} -> {back['accent']}")

    errs = [e for e in h.errors[base_errors:] if "favicon" not in e[1].lower()]
    h.check("封面主题用例无控制台error", len(errs) == 0, str(errs[:4]))
