import asyncio
from playwright.async_api import async_playwright
async def main():
  async with async_playwright() as p:
    b=await p.chromium.launch(executable_path='/usr/bin/google-chrome',headless=True,args=['--no-sandbox','--autoplay-policy=no-user-gesture-required'])
    ctx=await b.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True)
    pg=await ctx.new_page(); errs=[]
    pg.on('pageerror',lambda e:errs.append(str(e)))
    await pg.goto('http://localhost:8765/index.html'); await pg.tap('#btnDemo'); await pg.wait_for_timeout(5000)
    print('hidden class:',await pg.evaluate("document.body.className+' | '+document.documentElement.className"))
    await pg.touchscreen.tap(200,300); await pg.wait_for_timeout(500)
    print('after tap:',await pg.evaluate("document.body.className+' | '+document.documentElement.className"))
    await pg.tap('.mode[data-mode="1"]'); print('mode',await pg.evaluate('__pinpu.mode'))
    await pg.tap('#btnFullscreen'); await pg.wait_for_timeout(500); print('fs',await pg.evaluate('!!document.fullscreenElement'))
    print(errs); await b.close()
asyncio.run(main())
