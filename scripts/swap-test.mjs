import puppeteer from 'puppeteer-core';
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const b = await puppeteer.launch({ executablePath: CHROME, headless: false, defaultViewport:{width:1400,height:800} });
const p = await b.newPage();
const errs=[];
p.on('pageerror',e=>{errs.push(e.message); console.log('PAGEERROR:', e.message.slice(0,200));});
p.on('console',m=>{ const t=m.text(); if(m.type()==='error'||m.type()==='warning'){ errs.push(t); console.log('['+m.type()+']', t.slice(0,200)); } });
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
await p.goto('http://localhost:3000',{waitUntil:'domcontentloaded',timeout:60000});
await p.waitForSelector('.title',{timeout:60000});
await p.evaluate(()=>[...document.querySelectorAll('button')].find(x=>x.textContent?.includes('New session'))?.click());
await p.waitForFunction(()=>!!document.querySelector('canvas[aria-label="Minimap"]'),{timeout:300000});
await sleep(5000);
const c=await p.$('canvas'); await c.click({offset:{x:700,y:500}});
await sleep(600);

let pass=0, fail=0;
const rec=(n,ok,d)=>{ (ok?pass++:fail++); console.log(`${ok?'PASS':'FAIL'}  ${n}${d?' - '+d:''}`); };

for (const kind of ['suv','pickup','van','coupe']) {
  // Put the driven vehicle on a clear straight, then rebuild it as `kind`.
  await p.evaluate((k)=>{
    window.__PALM__.vehicleOwner.requestSwap(k, { x:-140, y:0.8, z:3.6, heading: Math.PI/2 }, '#c8503c');
  }, kind);
  await sleep(1500);
  const applied = await p.evaluate(()=>({ kind: window.__PALM__.sim.vehicle.kind }));
  console.log(`   swap applied -> kind="${applied.kind}"`);
  const tp = await p.evaluate(()=>{
    try { window.__PALM__.teleport(-139, 0.5, 6.0); return 'ok'; }
    catch (e) { return 'THREW: ' + (e && e.message ? e.message : String(e)); }
  });
  console.log('   character teleport:', tp);
  await sleep(600);
  await p.keyboard.press('KeyF');
  await sleep(2600);
  const seated = await p.evaluate(()=>({ mode: window.__PALM__.sim.controlMode, kind: window.__PALM__.sim.vehicle.kind, label: window.__PALM__.sim.vehicle.label }));
  rec(`${kind}: player can get in`, seated.mode==='vehicle', `mode "${seated.mode}", kind "${seated.kind}" (${seated.label})`);

  await p.keyboard.down('w');
  await sleep(3000);
  const moving = await p.evaluate(()=>{ const v=window.__PALM__.vehicle; const t=v.body.translation(); return { kph:v.speedKph, gear:v.currentGear, y:t.y, over:v.isOverturned, wheels:v.wheelStates.filter(w=>w.grounded).length }; });
  await p.keyboard.up('w');
  rec(`${kind}: accelerates`, moving.kph > 25, `${moving.kph.toFixed(1)} km/h, gear ${moving.gear}`);
  // The chassis origin sits at the wheel-contact plane, so resting y is ~0.
  rec(`${kind}: sits on its wheels, not flipped`, !moving.over && moving.wheels >= 3 && moving.y > -0.5 && moving.y < 2.0,
      `overturned=${moving.over}, ${moving.wheels}/4 wheels grounded, y=${moving.y.toFixed(2)}`);

  // Exit is refused above ~21 km/h (spec 17), so brake to a stop first.
  await p.keyboard.down('s');
  for (let i=0;i<20;i++){ await sleep(250); const k=await p.evaluate(()=>Math.abs(window.__PALM__.vehicle.speedKph)); if(k<3) break; }
  await p.keyboard.up('s');
  await sleep(400);
  await p.keyboard.press('KeyF');
  await sleep(1800);
  const out = await p.evaluate(()=>window.__PALM__.sim.controlMode);
  rec(`${kind}: player can get out`, out==='foot', `mode "${out}"`);
}
await p.screenshot({path:'.testshots/95-driving-swapped.png'});
rec('no console errors', errs.length===0, errs.slice(0,2).join(' | ').slice(0,200) || 'none');
console.log(`\n${pass}/${pass+fail} checks passed`);
await b.close();
