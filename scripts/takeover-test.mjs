import puppeteer from 'puppeteer-core';
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const b = await puppeteer.launch({ executablePath: CHROME, headless: false, defaultViewport:{width:1400,height:800} });
const p = await b.newPage();
const errs=[];
p.on('pageerror',e=>{errs.push(e.message); console.log('PAGEERROR:', e.message.slice(0,180));});
p.on('console',m=>{ if(m.type()==='error'){ errs.push(m.text()); console.log('[error]', m.text().slice(0,180)); } });
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
let pass=0,fail=0; const rec=(n,ok,d)=>{ (ok?pass++:fail++); console.log(`${ok?'PASS':'FAIL'}  ${n}${d?' - '+d:''}`); };

await p.goto('http://localhost:3000',{waitUntil:'domcontentloaded',timeout:60000});
await p.waitForSelector('.title',{timeout:60000});
await p.evaluate(()=>[...document.querySelectorAll('button')].find(x=>x.textContent?.includes('New session'))?.click());
await p.waitForFunction(()=>!!document.querySelector('canvas[aria-label="Minimap"]'),{timeout:300000});
await sleep(5000);
const c=await p.$('canvas'); await c.click({offset:{x:700,y:500}});
await sleep(600);

const state = () => p.evaluate(()=>({
  mode: window.__PALM__.sim.controlMode,
  kind: window.__PALM__.sim.vehicle.kind,
  label: window.__PALM__.sim.vehicle.label,
  prompt: window.__PALM__.sim.interaction ? window.__PALM__.sim.interaction.label : null,
  parkedCount: window.__PALM__.parked ? window.__PALM__.parked.all().length : -1,
}));

// Find a parked car and stand next to its driver door.
const target = await p.evaluate(()=>{
  const list = window.__PALM__.parked.all().filter(v=>v.key!=='motorcycle'&&v.key!=='scooter');
  const v = list[0];
  return v ? { id:v.id, key:v.key, x:v.x, z:v.z, heading:v.heading } : null;
});
rec('a parked car exists to take over', !!target, target ? `${target.key} at (${target.x.toFixed(0)},${target.z.toFixed(0)})` : 'none');

const before = await state();
const heroStart = await p.evaluate(()=>{ const t=window.__PALM__.vehicle.body.translation(); return {x:t.x,z:t.z}; });

// Stand beside it, on the driver side (car's left).
await p.evaluate((t)=>{
  const left = t.heading - Math.PI/2;
  window.__PALM__.teleport(t.x + Math.sin(left)*2.0, 0.5, t.z + Math.cos(left)*2.0);
}, target);
await sleep(1200);

const prompted = await state();
rec('prompt offers the parked car', !!prompted.prompt && /Drive the/.test(prompted.prompt), `prompt "${prompted.prompt}"`);

await p.keyboard.press('KeyF');
await sleep(3200);
const took = await state();
rec('player is driving the parked car', took.mode==='vehicle' && took.kind===target.key, `mode "${took.mode}", kind "${took.kind}" (${took.label}), toast=${JSON.stringify(await p.evaluate(()=>window.__PALM__.sim.toast))}`);
rec('the taken car is no longer parked scenery', took.parkedCount === before.parkedCount - 1, `${before.parkedCount} -> ${took.parkedCount}`);

const heroParked = await p.evaluate(()=>{ const h=window.__PALM__.parkedHero&&window.__PALM__.parkedHero(); return h?{x:h.at.x,z:h.at.z}:null; });
rec('the hero car was left where it stood', !!heroParked && Math.hypot(heroParked.x-heroStart.x, heroParked.z-heroStart.z) < 2,
    heroParked ? `hero parked at (${heroParked.x.toFixed(0)},${heroParked.z.toFixed(0)}), was (${heroStart.x.toFixed(0)},${heroStart.z.toFixed(0)})` : 'hero not parked');

await p.keyboard.down('w'); await sleep(2600);
const drove = await p.evaluate(()=>({kph:window.__PALM__.vehicle.speedKph, gear:window.__PALM__.vehicle.currentGear}));
await p.keyboard.up('w');
rec('the taken car drives', drove.kph > 15, `${drove.kph.toFixed(1)} km/h, gear ${drove.gear}`);
await p.screenshot({path:'.testshots/96-took-parked-car.png'});

// Brake, get out, then walk back to the hero car and take it again.
await p.keyboard.down('s');
for(let i=0;i<20;i++){ await sleep(250); const k=await p.evaluate(()=>Math.abs(window.__PALM__.vehicle.speedKph)); if(k<3) break; }
await p.keyboard.up('s'); await sleep(400);
await p.keyboard.press('KeyF'); await sleep(1800);
rec('player gets out of the taken car', (await state()).mode==='foot');

await p.evaluate((h)=>{ window.__PALM__.teleport(h.x - 2.0, 0.5, h.z); }, heroParked ?? {x:0,z:0});
await sleep(1200);
await p.keyboard.press('KeyF');
await sleep(3400);
const back = await state();
rec('player can get back into the hero car', back.mode==='vehicle' && back.kind==='hero', `mode "${back.mode}", kind "${back.kind}"`);
await p.screenshot({path:'.testshots/97-back-in-hero.png'});

rec('no console errors', errs.length===0, errs.slice(0,2).join(' | ').slice(0,200) || 'none');
console.log(`\n${pass}/${pass+fail} checks passed`);
await b.close();
