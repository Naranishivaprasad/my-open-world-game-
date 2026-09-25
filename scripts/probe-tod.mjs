import puppeteer from 'puppeteer-core';
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const b = await puppeteer.launch({ executablePath: CHROME, headless: false, defaultViewport:{width:1600,height:900} });
const p = await b.newPage();
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
await p.goto('http://localhost:3000',{waitUntil:'domcontentloaded',timeout:60000});
await p.waitForSelector('.title',{timeout:60000});
await p.evaluate(()=>[...document.querySelectorAll('button')].find(x=>x.textContent?.includes('New session'))?.click());
await p.waitForFunction(()=>!!document.querySelector('canvas[aria-label="Minimap"]'),{timeout:300000});
await sleep(5000);
const c=await p.$('canvas'); await c.click({offset:{x:800,y:600}});
await sleep(800);
await p.mouse.move(900,600); await p.mouse.move(1200,600);
await p.keyboard.down('w'); await sleep(3000);

const sample = async (label) => {
  const s=[]; for(let i=0;i<8;i++){ await sleep(400); s.push(await p.evaluate(()=>window.__PALM__.sim.stats.fps)); }
  const avg=s.reduce((a,b)=>a+b,0)/s.length;
  const st=await p.evaluate(()=>({d:window.__PALM__.sim.stats.drawCalls,t:window.__PALM__.sim.stats.triangles}));
  console.log(label.padEnd(30),'fps',avg.toFixed(1),' draws',st.d,' tris',st.t.toLocaleString());
};
await sample('A baseline');
await p.evaluate(()=>window.__PALM__.setTimeScale(0));
await sleep(1500); await sample('B clock frozen');
await p.evaluate(()=>{ window.__PALM__.sim.scene.traverse(o=>{ if(o.isPoints) o.visible=false; }); });
await sleep(1500); await sample('C + stars hidden');
await p.evaluate(()=>{ window.__PALM__.sim.scene.traverse(o=>{ if(o.isMesh && o.geometry?.type==='SphereGeometry' && o.renderOrder===1000) o.visible=false; }); });
await sleep(1500); await sample('D + sky dome hidden');
await p.evaluate(()=>{ window.__PALM__.sim.scene.traverse(o=>{ if(o.isSkinnedMesh) o.visible=false; }); });
await sleep(1500); await sample('E + skinned meshes hidden');
await p.keyboard.up('w');
await b.close();
