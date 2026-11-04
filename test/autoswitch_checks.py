#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""自动切换模式的浏览器用例：面板档位、测试钩子快进、持久化、快速切换无报错。"""
import json

from harness import BASE


async def _has_feature(page, name):
    return await page.evaluate(
        f"!!(window.__pinpu && __pinpu.features && __pinpu.features[{json.dumps(name)}])")


async def v2_autoswitch_checks(h):
    page = h.page
    if not await _has_feature(page, "autoSwitch"):
        h.skip("自动切换模式", "features.autoSwitch 未启用")
        return

    await page.goto(BASE)
    await page.wait_for_timeout(500)

    # 设置面板五档控件
    await page.evaluate("document.querySelector('#btnSettings').click()")
    await page.wait_for_timeout(250)
    n = await page.evaluate("document.querySelectorAll('.sp-autoswitch .seg-btn').length")
    h.check("设置面板含自动切换5档", n == 5, f"count={n}")
    await page.keyboard.press("Escape")
    await page.wait_for_timeout(200)

    await page.click("#btnDemo")
    await page.wait_for_function("__pinpu.playing === true", timeout=5000)
    await page.wait_for_timeout(300)
    pol = await page.evaluate("__pinpu.setAutoSwitch('15')")
    h.check("测试钩子设置15秒", pol == "15", str(pol))

    before = await page.evaluate("__pinpu.mode")
    await page.evaluate("__pinpu.tickAutoSwitch(16, 0.6)")
    await page.wait_for_timeout(250)
    after = await page.evaluate("__pinpu.mode")
    h.check("快进到点自动切到不同模式", after != before, f"{before}->{after}")
    switches = await page.evaluate("__pinpu.autoSwitch.switches")
    h.check("自动切换计数递增", switches >= 1, str(switches))

    # 快速连续手动切换：快照层应双缓冲合并，不产生报错
    base_errors = len(h.errors)
    for i in range(8):
        await page.evaluate(f"__pinpu.setMode({i % 5})")
        await page.wait_for_timeout(60)
    await page.wait_for_timeout(700)
    errs = [e for e in h.errors[base_errors:] if "favicon" not in e[1].lower()]
    h.check("快速连续切换无error", len(errs) == 0, str(errs[:3]))

    # 切换后应出现旧画面快照层，并在 0.3~0.6s 内自动隐藏
    await page.wait_for_timeout(800)
    fade = await page.evaluate(
        """()=>new Promise(r=>{
        __pinpu.setMode((__pinpu.mode+1)%5);
        requestAnimationFrame(()=>requestAnimationFrame(()=>{
          const f=document.querySelector('.stage-fade');
          r(f?{hidden:f.hidden,opacity:Number(f.style.opacity),w:f.width,h:f.height}:null);
        }));})""")
    h.check("切换时显示旧画面快照层",
            bool(fade) and not fade["hidden"] and 0 < fade["opacity"] <= 1 and fade["w"] > 0,
            str(fade))
    await page.wait_for_timeout(900)
    gone = await page.evaluate(
        "()=>{const f=document.querySelector('.stage-fade');"
        "return f?{hidden:f.hidden,opacity:Number(f.style.opacity)}:null;}")
    h.check("快照淡出后自动隐藏", bool(gone) and gone["hidden"] and gone["opacity"] == 0,
            str(gone))

    saved = await page.evaluate("__pinpu.settings.autoSwitch")
    h.check("自动切换写入持久化设置", saved == "15", str(saved))

    await page.reload()
    await page.wait_for_timeout(800)
    kept = await page.evaluate(
        "({setting:__pinpu.settings.autoSwitch,policy:__pinpu.autoSwitch.policy})")
    h.check("刷新后自动切换保留", kept["setting"] == "15" and kept["policy"] == "15", str(kept))
    active = await page.evaluate(
        "()=>{const b=document.querySelector('.sp-autoswitch .seg-btn.is-active');"
        "return b?b.dataset.value:null;}")
    h.check("设置面板回显15秒", active == "15", str(active))

    # 恢复关闭，避免影响后续用例
    await page.evaluate("__pinpu.setAutoSwitch('off')")
    await page.wait_for_timeout(150)
    off = await page.evaluate(
        "({setting:__pinpu.settings.autoSwitch,policy:__pinpu.autoSwitch.policy})")
    h.check("自动切换恢复关闭", off["setting"] == "off" and off["policy"] == "off", str(off))

    errs = [e for e in h.errors[base_errors:] if "favicon" not in e[1].lower()]
    h.check("自动切换用例无error", len(errs) == 0, str(errs[:3]))
