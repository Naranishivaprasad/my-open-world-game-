import puppeteer from 'puppeteer-core';
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const b = await puppeteer.launch({ executablePath: CHROME, headless: false, defaultViewport:{width:1600,height:900} });
const p = await b.newPage();
await p.goto('http://localhost:3000',{waitUntil:'domcontentloaded',timeout:60000});
await p.waitForSelector('.title',{timeout:60000});
await p.evaluate(()=>[...document.querySelectorAll('button')].find(x=>x.textContent?.includes('New session'))?.click());
await p.waitForFunction(()=>!!document.querySelector('canvas[aria-label="Minimap"]'),{timeout:300000});
await new Promise(r=>setTimeout(r,5000));
const c=await p.$('canvas'); await c.click({offset:{x:800,y:600}});
await new Promise(r=>setTimeout(r,800));
// Park downtown looking along Palm toward the sea.
// Reproduce the smoke test's pose exactly: it mouse-looks to yaw ~-0.88
// BEFORE sampling, so it measures a different view from a fresh spawn.
await p.mouse.move(900,600); await p.mouse.move(1200,600);
await new Promise(r=>setTimeout(r,300));
await p.keyboard.down('w');
await new Promise(r=>setTimeout(r,3000));

const sample = async (label) => {
  const s=[]; for(let i=0;i<8;i++){ await new Promise(r=>setTimeout(r,400));
    s.push(await p.evaluate(()=>window.__PALM__.sim.stats.fps)); }
  const avg=s.reduce((a,b)=>a+b,0)/s.length;
  const info=await p.evaluate(()=>({d:window.__PALM__.sim.stats.drawCalls,t:window.__PALM__.sim.stats.triangles}));
  console.log(label.padEnd(30),'fps',avg.toFixed(1),' draws',info.d,' tris',info.t.toLocaleString());
};

await sample('A baseline at spawn (moving)');
await p.evaluate(()=>{ window.__PALM__.sim.scene.traverse(o=>{ if(o.isSkinnedMesh) o.visible=false; }); });
await new Promise(r=>setTimeout(r,2000));
await sample('B skinned meshes hidden');
await p.evaluate(()=>{ const r=window.__PALM__.renderer; if(r) r.shadowMap.enabled=false; });
await new Promise(r=>setTimeout(r,2000));
await sample('C + shadow map off');
await p.evaluate(()=>{ const g=window.__PALM__.sim.scene.getObjectByName('city'); if(g) g.visible=false; });
await new Promise(r=>setTimeout(r,2000));
await sample('D + city hidden');
await b.close();
