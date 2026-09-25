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

// Park the car and photograph it ON FOOT, so the chase camera does not fight us.
await p.evaluate(()=>{ window.__PALM__.teleportCar(120, 0.6, 60, Math.PI/2); });
await sleep(1200);
const shots = [
  { x:126, z:60,   yaw:Math.PI/2, pitch:0.02, name:'G1-front' },
  { x:125, z:55,   yaw:Math.PI/2+0.7, pitch:0.02, name:'G2-front-quarter' },
  { x:120, z:55,   yaw:Math.PI,   pitch:0.02, name:'G3-side' },
];
for (const s of shots) {
  await p.evaluate((o)=>{ window.__PALM__.teleport(o.x,0.5,o.z); window.__PALM__.sim.camera.yaw=o.yaw; window.__PALM__.sim.camera.pitch=o.pitch; }, s);
  await sleep(1600);
  await p.evaluate((o)=>{ window.__PALM__.sim.camera.yaw=o.yaw; window.__PALM__.sim.camera.pitch=o.pitch; }, s);
  await sleep(220);
  await p.screenshot({path:`.testshots/${s.name}.png`});
}
await b.close();
