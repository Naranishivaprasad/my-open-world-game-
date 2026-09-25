import puppeteer from 'puppeteer-core';
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const b = await puppeteer.launch({ executablePath: CHROME, headless: false, defaultViewport:{width:1000,height:600} });
const p = await b.newPage();
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
await p.goto('http://localhost:3000',{waitUntil:'domcontentloaded',timeout:60000});
await p.waitForSelector('.title',{timeout:60000});
await p.evaluate(()=>[...document.querySelectorAll('button')].find(x=>x.textContent?.includes('New session'))?.click());
await p.waitForFunction(()=>!!document.querySelector('canvas[aria-label="Minimap"]'),{timeout:300000});
await sleep(5000);
const c=await p.$('canvas'); await c.click({offset:{x:640,y:400}});
await sleep(700);
await p.evaluate(()=>{ window.__PALM__.teleportCar(120, 0.6, 60, Math.PI/2); });
await sleep(900);
await p.evaluate(()=>{ const v=window.__PALM__.vehicle; const t=v.body.translation(); const a=v.build.anchors.driverDoor;
  window.__PALM__.teleport(t.x+a.x, 0.5, t.z+a.z); });
await sleep(900); await p.keyboard.press('KeyF'); await sleep(3500);

const measure = () => p.evaluate(()=>{
  const THREE = window.__PALM__.THREE;
  const scene = window.__PALM__.sim.scene;
  const box = new THREE.Box3();
  const car = window.__PALM__.vehicle.body.translation();
  const out = { steer:+window.__PALM__.vehicle.steer.toFixed(3) };
  const q = window.__PALM__.vehicle.body.rotation();
  const e = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(q.x,q.y,q.z,q.w), 'YXZ');
  out.chassisPitchDeg = +(e.x*180/Math.PI).toFixed(2);
  out.chassisRollDeg = +(e.z*180/Math.PI).toFixed(2);
  out.suspension = window.__PALM__.vehicle.wheelStates.map(w=>+w.suspension.toFixed(3));
  for (const n of ['WheelFrontL_pivot','WheelFrontR_pivot','WheelRearL_pivot','WheelRearR_pivot']) {
    const o = scene.getObjectByName(n);
    if (!o) { out[n]='missing'; continue; }
    const wp = new THREE.Vector3(); o.getWorldPosition(wp);
    box.setFromObject(o);
    // Relative to the chassis, so the car's own position drops out.
    out[n] = {
      cx:+((box.min.x+box.max.x)/2 - car.x).toFixed(3),
      cy:+((box.min.y+box.max.y)/2 - car.y).toFixed(3),
      cz:+((box.min.z+box.max.z)/2 - car.z).toFixed(3),
      pivotY:+(wp.y - car.y).toFixed(3),
      lowestY:+(box.min.y - car.y).toFixed(3),
    };
  }
  return out;
});

console.log('at rest      ', JSON.stringify(await measure()));
await p.keyboard.down('a'); await sleep(1600);
console.log('at full lock ', JSON.stringify(await measure()));
await p.keyboard.up('a');
await b.close();
