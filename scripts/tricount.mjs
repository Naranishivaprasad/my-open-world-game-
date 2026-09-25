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
  const tally = {};
  const tris = (g) => { const i=g.index; return i? i.count/3 : (g.attributes.position?.count??0)/3; };
  window.__PALM__.sim.scene.traverse(o=>{
    if (!o.geometry) return;
    // Walk up to the nearest named ancestor for a bucket label.
    let n=o, label='(root)';
    while(n){ if(n.name){label=n.name;break;} n=n.parent; }
    const mult = o.isInstancedMesh ? o.count : 1;
    tally[label] = (tally[label]??0) + tris(o.geometry)*mult;
  });
  return Object.entries(tally).sort((a,b)=>b[1]-a[1]);
});
let total=0; for(const [,v] of out) total+=v;
for(const [k,v] of out) console.log(String(Math.round(v)).padStart(9), (100*v/total).toFixed(1).padStart(5)+'%', k);
console.log('TOTAL in scene:', Math.round(total).toLocaleString());
await b.close();
