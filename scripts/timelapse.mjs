import puppeteer from 'puppeteer-core';
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const b = await puppeteer.launch({ executablePath: CHROME, headless: false, defaultViewport:{width:1280,height:720} });
const p = await b.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
await p.goto('http://localhost:3000',{waitUntil:'domcontentloaded',timeout:60000});
await p.waitForSelector('.title',{timeout:60000});
await p.evaluate(()=>[...document.querySelectorAll('button')].find(x=>x.textContent?.includes('New session'))?.click());
await p.waitForFunction(()=>!!document.querySelector('canvas[aria-label="Minimap"]'),{timeout:300000});
await sleep(5000);
const c=await p.$('canvas'); await c.click({offset:{x:640,y:400}});
await sleep(600);
// Freeze the clock and stand on Palm looking east down the boulevard.
await p.evaluate(()=>{ window.__PALM__.setTimeScale(0); window.__PALM__.teleport(60,0.5,9); window.__PALM__.sim.camera.yaw=Math.PI/2; window.__PALM__.sim.camera.pitch=0.05; });
await sleep(1500);
for (const h of [5.5, 6.5, 9, 13, 18.3, 19.4, 21, 1]) {
  await p.evaluate((hh)=>window.__PALM__.setHour(hh), h);
  await sleep(1800);
  const name = String(h).replace('.','_');
  await p.screenshot({path:`.testshots/tod-${name}.png`});
  const st = await p.evaluate(()=>({d:+window.__PALM__.sim.time.darkness.toFixed(2), ph:window.__PALM__.sim.time.phase, fps:+window.__PALM__.sim.stats.fps.toFixed(0)}));
  console.log(`hour ${String(h).padStart(5)}  phase ${st.ph.padEnd(9)} darkness ${st.d}  fps ${st.fps}`);
}
console.log('errors:', errs.length? errs.slice(0,2).join(' | ').slice(0,200):'none');
await b.close();
