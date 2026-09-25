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

const count = await p.evaluate(()=>window.__PALM__.signals.getSignalJunctions().length);
rec('junctions are signalised', count > 0, `${count} signalised junctions`);

// Over a full cycle each direction must get green, and never both at once.
const trace = await p.evaluate(()=>{
  const S = window.__PALM__.signals;
  const j = S.getSignalJunctions()[0];
  if (!j) return { ns:[], ew:[], bothGreen:-1, cycle:S.CYCLE };
  const seen = { ns:new Set(), ew:new Set() }; let bothGreen = 0;
  for (let t=0; t<S.CYCLE; t+=0.2) {
    const ns = S.lampFor(j,t,'ns'), ew = S.lampFor(j,t,'ew');
    seen.ns.add(ns); seen.ew.add(ew);
    if (ns==='green' && ew==='green') bothGreen++;
  }
  return { ns:[...seen.ns], ew:[...seen.ew], bothGreen, cycle:S.CYCLE };
});
rec('both directions get a full red/amber/green cycle',
    trace.ns.length===3 && trace.ew.length===3, `ns ${trace.ns.join('/')} | ew ${trace.ew.join('/')} over ${trace.cycle.toFixed(1)}s`);
rec('the two directions are never green together', trace.bothGreen===0, `${trace.bothGreen} samples with both green`);

// Traffic must actually stop for a red.
await p.evaluate(()=>{ window.__PALM__.teleport(70,0.5,-14); });
await sleep(1000);
let stopped = 0, redSeen = 0;
for (let i=0;i<40;i++){
  await sleep(500);
  const r = await p.evaluate(()=>{
    const S = window.__PALM__.signals, sim = window.__PALM__.sim;
    const t = window.__PALM__.traffic;
    let waiting = 0, red = 0;
    for (const a of t.agents) {
      const j = S.signalAt(a.lane.bx, a.lane.bz, 14);
      if (!j) continue;
      const axis = S.axisOf(a.lane.dx, a.lane.dz);
      const lamp = S.lampFor(j, sim.elapsed, axis);
      const distToEnd = (1-a.t)*a.lane.length;
      if (lamp==='red' && distToEnd < 16) { red++; if (a.speed < 1.0) waiting++; }
    }
    return { waiting, red };
  });
  redSeen += r.red; stopped += r.waiting;
}
rec('traffic holds at a red light', redSeen===0 || stopped > 0, `${stopped} stopped of ${redSeen} approaching a red`);
await p.screenshot({path:'.testshots/A3-signal-junction.png'});
rec('no console errors', errs.length===0, errs.slice(0,2).join(' | ').slice(0,180)||'none');
console.log(`\n${pass}/${pass+fail} checks passed`);
await b.close();
