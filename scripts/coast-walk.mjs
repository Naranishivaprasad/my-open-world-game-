import puppeteer from 'puppeteer-core';
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const b = await puppeteer.launch({ executablePath: CHROME, headless: false, defaultViewport:{width:1280,height:720} });
const p = await b.newPage();
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
await p.goto('http://localhost:3000',{waitUntil:'domcontentloaded',timeout:60000});
await p.waitForSelector('.title',{timeout:60000});
await p.evaluate(()=>[...document.querySelectorAll('button')].find(x=>x.textContent?.includes('New session'))?.click());
await p.waitForFunction(()=>!!document.querySelector('canvas[aria-label="Minimap"]'),{timeout:300000});
await sleep(5000);
const c=await p.$('canvas'); await c.click({offset:{x:640,y:400}});
await sleep(700);
for (const x of [340, 370, 390, 405, 430]) {
  await p.evaluate((xx)=>{ window.__PALM__.teleport(xx, 3.0, 0); window.__PALM__.sim.camera.yaw = Math.PI/2; window.__PALM__.sim.camera.pitch = 0.0; }, x);
  await sleep(2200);
  const st = await p.evaluate(()=>({ y:+window.__PALM__.sim.player.position.y.toFixed(2), g:window.__PALM__.sim.player.grounded }));
  console.log(`x=${String(x).padStart(4)}  settled y=${String(st.y).padStart(6)}  grounded=${st.g}`);
  await p.screenshot({path:`.testshots/C-coast-${x}.png`});
}
await b.close();
