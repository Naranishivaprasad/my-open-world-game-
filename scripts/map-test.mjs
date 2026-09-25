import puppeteer from 'puppeteer-core';
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const b = await puppeteer.launch({ executablePath: CHROME, headless: false, defaultViewport:{width:1400,height:800} });
const p = await b.newPage();
const errs=[]; p.on('pageerror',e=>{errs.push(e.message);console.log('PAGEERROR:',e.message.slice(0,180));});
p.on('console',m=>{if(m.type()==='error'){errs.push(m.text());console.log('[error]',m.text().slice(0,180));}});
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
let pass=0,fail=0; const rec=(n,ok,d)=>{(ok?pass++:fail++);console.log(`${ok?'PASS':'FAIL'}  ${n}${d?' - '+d:''}`);};
await p.goto('http://localhost:3000',{waitUntil:'domcontentloaded',timeout:60000});
await p.waitForSelector('.title',{timeout:60000});
await p.evaluate(()=>[...document.querySelectorAll('button')].find(x=>x.textContent?.includes('New session'))?.click());
await p.waitForFunction(()=>!!document.querySelector('canvas[aria-label="Minimap"]'),{timeout:300000});
await sleep(5000);
const c=await p.$('canvas'); await c.click({offset:{x:700,y:500}});
await sleep(800);

const before = await p.evaluate(()=>({x:window.__PALM__.sim.player.position.x, z:window.__PALM__.sim.player.position.z}));
await p.keyboard.press('KeyM');
await sleep(2500);
const open = await p.evaluate(()=>!!document.querySelector('[aria-label="City map"]'));
rec('M opens the city map', open);
const dom = await p.evaluate(()=>({
  minimap: !!document.querySelector('canvas[aria-label="Minimap"]'),
  phase: document.querySelectorAll('canvas').length,
}));
console.log('   while map open:', JSON.stringify(dom));
await p.screenshot({path:'.testshots/99-map.png'});

// Zoom in and pan, then shoot again, so the detailed view is checked too.
const box = await (await p.$('[aria-label="City map"] canvas')).boundingBox();
await p.mouse.move(box.x + box.width/2, box.y + box.height/2);
for (let i=0;i<6;i++) { await p.mouse.wheel({deltaY:-220}); await sleep(90); }
await sleep(900);
await p.screenshot({path:'.testshots/99b-map-zoom.png'});

// A click with no drag drops a waypoint.
await p.mouse.click(box.x + box.width*0.42, box.y + box.height*0.55);
await sleep(700);
const wp = await p.evaluate(()=>window.__PALM__.sim.waypoint);
rec('clicking the map sets a waypoint', !!wp, wp?`(${wp.x.toFixed(0)}, ${wp.z.toFixed(0)})`:'none');
await p.screenshot({path:'.testshots/99c-map-waypoint.png'});

// The simulation must be frozen while the map is open.
await p.keyboard.down('w'); await sleep(1200); await p.keyboard.up('w');
const during = await p.evaluate(()=>({x:window.__PALM__.sim.player.position.x, z:window.__PALM__.sim.player.position.z}));
const drift = Math.hypot(during.x-before.x, during.z-before.z);
rec('the world is frozen while the map is open', drift < 0.01, `drift ${drift.toFixed(4)} m`);

await p.keyboard.press('KeyM');
await sleep(1000);
const closed = await p.evaluate(()=>!!document.querySelector('[aria-label="City map"]'));
rec('M closes the map again', !closed);

await p.evaluate(()=>document.querySelector('canvas')?.click());
await sleep(600);
await p.keyboard.press('KeyM'); await sleep(900);
await p.keyboard.press('Escape'); await sleep(900);
const escClosed = await p.evaluate(()=>!!document.querySelector('[aria-label="City map"]'));
rec('Escape also closes the map', !escClosed);

rec('no console errors', errs.length===0, errs.slice(0,2).join(' | ').slice(0,180)||'none');
console.log(`\n${pass}/${pass+fail} checks passed`);
await b.close();
