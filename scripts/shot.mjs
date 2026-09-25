import puppeteer from 'puppeteer-core';
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const b = await puppeteer.launch({ executablePath: CHROME, headless: false, defaultViewport:{width:1600,height:900} });
const p = await b.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
await p.goto('http://localhost:3000',{waitUntil:'domcontentloaded',timeout:60000});
await p.waitForSelector('.title',{timeout:60000});
await p.evaluate(()=>[...document.querySelectorAll('button')].find(x=>x.textContent?.includes('New session'))?.click());
await p.waitForFunction(()=>!!document.querySelector('canvas[aria-label="Minimap"]'),{timeout:300000});
await new Promise(r=>setTimeout(r,5000));
const c=await p.$('canvas'); await c.click({offset:{x:800,y:600}});
await new Promise(r=>setTimeout(r,800));

/**
 * Measure, THEN screenshot.
 *
 * p.screenshot() stalls the GPU and compositor for several frames, so a single
 * sim.stats.fps read taken right after one reports a hitched frame, not the
 * steady state. Averaging over samples taken before the capture is the only
 * reading that means anything.
 */
async function probe(label, place, shot) {
  if (place) await p.evaluate(place);
  await new Promise(r=>setTimeout(r,3500));
  const s=[];
  for (let i=0;i<8;i++){ await new Promise(r=>setTimeout(r,400));
    s.push(await p.evaluate(()=>window.__PALM__.sim.stats.fps)); }
  const fps = s.reduce((a,b)=>a+b,0)/s.length;
  const st = await p.evaluate(()=>({d:window.__PALM__.sim.stats.drawCalls,t:window.__PALM__.sim.stats.triangles}));
  console.log(label.padEnd(14),'draws',String(st.d).padStart(4),'tris',st.t.toLocaleString().padStart(9),'fps',fps.toFixed(1));
  if (shot) await p.screenshot({path:shot});
}

await probe('at spawn', null, '.testshots/59-spawn.png');
await probe('at beach', ()=>{ window.__PALM__.teleport(350,0.5,40); window.__PALM__.sim.camera.yaw=-Math.PI/2; window.__PALM__.sim.camera.pitch=0.12; }, '.testshots/60-beach.png');
await probe('at sea', ()=>{ window.__PALM__.teleport(350,0.5,40); window.__PALM__.sim.camera.yaw=Math.PI/2; window.__PALM__.sim.camera.pitch=0.02; }, '.testshots/60b-sea.png');
await probe('downtown', ()=>{ window.__PALM__.teleport(160,0.5,9); window.__PALM__.sim.camera.yaw=Math.PI/2; window.__PALM__.sim.camera.pitch=0.06; }, '.testshots/61-downtown.png');
console.log('errors:', errs.length ? errs.slice(0,3).join(' | ').slice(0,300) : 'none');
await b.close();
