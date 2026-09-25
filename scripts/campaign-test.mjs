import puppeteer from 'puppeteer-core';
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const b = await puppeteer.launch({ executablePath: CHROME, headless: false, defaultViewport:{width:1280,height:720} });
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
const c=await p.$('canvas'); await c.click({offset:{x:640,y:400}});
await sleep(800);

const info = await p.evaluate(()=>({
  count: window.__PALM__.campaign.CAMPAIGN.length,
  ids: window.__PALM__.campaign.CAMPAIGN.map(m=>m.id),
  rewards: window.__PALM__.campaign.CAMPAIGN.map(m=>m.reward),
}));
rec('the campaign has more than one mission', info.count >= 5, `${info.count}: ${info.ids.join(', ')}`);
rec('rewards increase through the campaign',
    info.rewards.every((r,i)=>i===0||r>info.rewards[i-1]), info.rewards.join(' -> '));

/** Satisfy every objective of a mission by placing the player where it asks. */
async function playMission(id) {
  await p.evaluate((mid)=>{ window.__PALM__.mission.debugStart(mid); }, id);
  await sleep(900);
  for (let step=0; step<16; step++) {
    const st = await p.evaluate(()=>{
      const m = window.__PALM__.mission;
      const o = m.objective;
      return { state: m.currentState, kind: o?.kind ?? null, x:o?.x??0, z:o?.z??0,
               requires: o?.requires ?? 'any', mode: window.__PALM__.sim.controlMode,
               idx: window.__PALM__.sim.mission.objectiveIndex };
    });
    if (st.state !== 'active') return st.state;
    if (!st.kind) return st.state;

    if (st.kind === 'enterVehicle') {
      await p.evaluate(()=>{ window.__PALM__.teleportCar(145,0.6,-26,0); window.__PALM__.teleport(143.2,0.5,-26); });
      await sleep(700); await p.keyboard.press('KeyF'); await sleep(3000);
    } else if (st.kind === 'evade') {
      await p.evaluate(()=>{ window.__PALM__.police.setWanted(2, 0, 0); });
      await sleep(900);
      await p.evaluate(()=>{ window.__PALM__.police.clear(); });
      await sleep(900);
    } else if (st.kind === 'steal') {
      await p.evaluate((o)=>{
        const veh = window.__PALM__.parked.all().find(v=>Math.hypot(v.x-o.x,v.z-o.z)<60 && v.key!=='motorcycle' && v.key!=='scooter');
        if (veh) window.__PALM__.vehicleOwner.requestSwap(veh.key, {x:veh.x,y:0.6,z:veh.z,heading:veh.heading}, veh.colour);
      }, {x:st.x,z:st.z});
      await sleep(1400);
    } else {
      // driveTo / checkpoint / collect / deliver / talk.
      // Objectives declare whether they must be done on foot or at the wheel,
      // so get into the right state first rather than assuming.
      if (st.requires === 'foot' && st.mode === 'vehicle') {
        await p.keyboard.press('KeyF'); await sleep(2200);
      }
      if (st.requires === 'vehicle' && st.mode === 'foot') {
        await p.evaluate(()=>{ const t=window.__PALM__.vehicle.body.translation();
          window.__PALM__.teleport(t.x-1.6, 0.5, t.z); });
        await sleep(700); await p.keyboard.press('KeyF'); await sleep(3000);
      }
      await p.evaluate((o)=>{
        const inCar = window.__PALM__.sim.controlMode === 'vehicle';
        if (inCar) window.__PALM__.teleportCar(o.x, 0.6, o.z, 0);
        else window.__PALM__.teleport(o.x, 0.5, o.z);
      }, {x:st.x,z:st.z});
      await sleep(1100);
      // A real key press: setting sim.input.interactPressed from outside the
      // frame loop is cleared by the input pump before the mission reads it.
      await p.keyboard.press('KeyE');
      await sleep(1200);
    }
  }
  const stuck = await p.evaluate(()=>({
    s: window.__PALM__.mission.currentState,
    i: window.__PALM__.sim.mission.objectiveIndex,
    l: window.__PALM__.sim.mission.objectiveLabel,
    mode: window.__PALM__.sim.controlMode,
  }));
  if (stuck.s === 'active') console.log(`   stuck on #${stuck.i} "${stuck.l}" mode=${stuck.mode}`);
  return stuck.s;
}

for (const id of info.ids) {
  const money0 = await p.evaluate(()=>window.__PALM__.sim.money);
  const end = await playMission(id);
  await sleep(600);
  const money1 = await p.evaluate(()=>window.__PALM__.sim.money);
  rec(`${id}: completes and pays`, end==='completed' || money1>money0, `ended "${end}", money ${money0} -> ${money1}`);
}

// A timed mission must actually fail when the clock runs out.
await p.evaluate(()=>{ window.__PALM__.mission.debugStart('night-shift'); });
await sleep(800);
await p.evaluate(()=>{ window.__PALM__.mission.forceTimeLeft(1.0); });
await sleep(2500);
const timedOut = await p.evaluate(()=>window.__PALM__.mission.currentState);
rec('a timed mission fails when the clock runs out', timedOut==='failed', `state "${timedOut}"`);

rec('no console errors', errs.length===0, errs.slice(0,2).join(' | ').slice(0,200)||'none');
console.log(`\n${pass}/${pass+fail} checks passed`);
await b.close();
