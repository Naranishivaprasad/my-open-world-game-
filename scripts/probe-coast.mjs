import puppeteer from 'puppeteer-core';
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const b = await puppeteer.launch({ executablePath: CHROME, headless: false, defaultViewport:{width:1000,height:600} });
const p = await b.newPage();
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
await p.goto('http://localhost:3000',{waitUntil:'domcontentloaded',timeout:60000});
await p.waitForSelector('.title',{timeout:60000});
await p.evaluate(()=>[...document.querySelectorAll('button')].find(x=>x.textContent?.includes('New session'))?.click());
await p.waitForFunction(()=>!!document.querySelector('canvas[aria-label="Minimap"]'),{timeout:300000});
await sleep(5000);
const out = await p.evaluate(()=>{
  const res = { sand: null, sea: null, easternBuildings: [], surfaces: {} };
  window.__PALM__.sim.scene.traverse(o=>{
    if (!o.isMesh || !o.geometry?.boundingBox) return;
    const n = o.parent?.name || o.name || '?';
    const bb = o.geometry.boundingBox;
    if (!res.surfaces[n]) res.surfaces[n] = { minX: Infinity, maxX: -Infinity };
    res.surfaces[n].minX = Math.min(res.surfaces[n].minX, bb.min.x);
    res.surfaces[n].maxX = Math.max(res.surfaces[n].maxX, bb.max.x);
  });
  return res;
});
for (const [k,v] of Object.entries(out.surfaces)) {
  if (Number.isFinite(v.minX)) console.log(k.padEnd(22), 'x', v.minX.toFixed(0), '..', v.maxX.toFixed(0));
}
await b.close();
