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
await p.evaluate(()=>{ window.__PALM__.teleportCar(120, 0.6, 60, Math.PI/2); });
await sleep(900);
await p.evaluate(()=>{ const v=window.__PALM__.vehicle; const t=v.body.translation(); const a=v.build.anchors.driverDoor;
  window.__PALM__.teleport(t.x+a.x, 0.5, t.z+a.z); });
await sleep(900); await p.keyboard.press('KeyF'); await sleep(3500);
console.log('mode:', await p.evaluate(()=>window.__PALM__.sim.controlMode));

await p.keyboard.down('a'); await sleep(1500);
// Pin the camera in front of the car, re-asserting faster than it recentres.
const pin = async (yaw, pitch, name) => {
  for (let i=0;i<24;i++){
    await p.evaluate((o)=>{ window.__PALM__.sim.camera.yaw=o.y; window.__PALM__.sim.camera.pitch=o.p; },{y:yaw,p:pitch});
    await sleep(40);
  }
  await p.screenshot({path:`.testshots/${name}.png`});
};
await pin(Math.PI/2, 0.10, 'H1-lock-front');
await pin(Math.PI*0.72, 0.12, 'H2-lock-quarter');
await p.keyboard.up('a');
await b.close();
