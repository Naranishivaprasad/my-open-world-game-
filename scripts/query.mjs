import puppeteer from 'puppeteer-core';
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const b = await puppeteer.launch({ executablePath: CHROME, headless: false, defaultViewport:{width:1200,height:700} });
const p = await b.newPage();
await p.goto('http://localhost:3000',{waitUntil:'domcontentloaded',timeout:60000});
await p.waitForSelector('.title',{timeout:60000});
await p.evaluate(()=>[...document.querySelectorAll('button')].find(x=>x.textContent?.includes('New session'))?.click());
await p.waitForFunction(()=>!!document.querySelector('canvas[aria-label="Minimap"]'),{timeout:300000});
await new Promise(r=>setTimeout(r,5000));
const out = await p.evaluate(()=>{
  const found=[];
  window.__PALM__.sim.scene.traverse(o=>{
    if (o.isInstancedMesh) found.push({name:o.name||'(unnamed)', count:o.count, visible:o.visible});
  });
  return found;
});
console.log(JSON.stringify(out,null,1));
await b.close();
