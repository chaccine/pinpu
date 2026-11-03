import asyncio, json
from playwright.async_api import async_playwright
URL='http://localhost:8765/index.html'
async def main():
  async with async_playwright() as p:
    b=await p.chromium.launch(executable_path='/usr/bin/google-chrome',headless=True,args=['--no-sandbox','--autoplay-policy=no-user-gesture-required','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream'])
    res={}
    errs=[]
    async def run(name,ctxargs):
      ctx=await b.new_context(**ctxargs,permissions=['microphone'])
      pg=await ctx.new_page()
      pg.on('console',lambda m: errs.append((name,m.type,m.text)) if m.type in('error','warning') else None)
      pg.on('pageerror',lambda e: errs.append((name,'pageerror',str(e))))
      await pg.goto(URL); await pg.wait_for_timeout(500)
      await pg.screenshot(path=f'shots/verify/{name}-idle.png')
      await pg.click('#btnDemo'); await pg.wait_for_timeout(4000)
      for i,mn in enumerate(['ring','mirror','galaxy']):
        await pg.mouse.move(300+i,300); await pg.wait_for_timeout(400); await pg.click(f'.mode[data-mode="{i}"]'); await pg.wait_for_timeout(2500)
        await pg.screenshot(path=f'shots/verify/{name}-{mn}.png')
      st=await pg.evaluate('({mode:__pinpu.mode,beats:__pinpu.beats,playing:__pinpu.playing,fps:__pinpu.fps,source:__pinpu.source})')
      # fps own measure
      fps=await pg.evaluate('new Promise(r=>{let n=0,t0=performance.now();function f(){n++;if(performance.now()-t0>3000)r(n/3);else requestAnimationFrame(f)}requestAnimationFrame(f)})')
      b1=await pg.evaluate('__pinpu.beats'); await pg.wait_for_timeout(5000); b2=await pg.evaluate('__pinpu.beats')
      st['raf_fps']=fps; st['beats_per_5s']=b2-b1
      res[name]=st
      if name=='desktop':
        await pg.mouse.move(310,310); await pg.wait_for_timeout(400); await pg.click('#btnPlay'); await pg.wait_for_timeout(500); st['paused']=await pg.evaluate('__pinpu.playing')
        await pg.click('#btnPlay')
        # file
        await pg.set_input_files('#fileInput','/tmp/test.wav'); await pg.wait_for_timeout(3000)
        st['file']=await pg.evaluate('({playing:__pinpu.playing,source:__pinpu.source,beats:__pinpu.beats})')
        await pg.screenshot(path='shots/verify/desktop-file.png')
        st['time']=[await pg.inner_text('#timeNow'),await pg.inner_text('#timeTotal')]
        await pg.evaluate("(()=>{const p=document.getElementById('progress');p.value=700;p.dispatchEvent(new Event('input',{bubbles:true}));p.dispatchEvent(new Event('change',{bubbles:true}))})()")
        await pg.wait_for_timeout(1000); st['after_seek']=await pg.inner_text('#timeNow')
        await pg.mouse.move(320,320); await pg.wait_for_timeout(400); await pg.click('#btnMic'); await pg.wait_for_timeout(2500)
        st['mic']=await pg.evaluate('({playing:__pinpu.playing,source:__pinpu.source})'); await pg.screenshot(path='shots/verify/desktop-mic.png')
      await ctx.close()
    await run('desktop',dict(viewport={'width':1440,'height':900}))
    await run('mobile',dict(viewport={'width':390,'height':844},device_scale_factor=3,is_mobile=True,has_touch=True))
    print(json.dumps(res,ensure_ascii=False,indent=1)); print('CONSOLE:',errs)
    await b.close()
asyncio.run(main())
