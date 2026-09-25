import puppeteer from 'puppeteer-core';
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const b = await puppeteer.launch({ executablePath: CHROME, headless: false, defaultViewport:{width:1280,height:720} });
const p = await b.newPage();
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
await p.goto('http://localhost:3000',{waitUntil:'domcontentloaded',timeout:60000});
await p.waitForSelector('.title',{timeout:60000});
await p.evaluate(()=>[...document.querySelectorAll('button')].find(x=>x.textContent?.includes('New session'))?.click());
await p.waitForFunction(()=>!!document.querySelector('canvas[aria-label="Minimap"]'),{timeout:300000});
await sleep(5000);
const c=await p.$('canvas'); await c.click({offset:{x:640,y:400}});
await sleep(700);

// Park on the open lot and get in, standing at the driver door anchor.
await p.evaluate(()=>{
  window.__PALM__.teleportCar(120, 0.6, 60, Math.PI/2);
});
await sleep(900);
await p.evaluate(()=>{
  const v = window.__PALM__.vehicle;
  const t = v.body.translation();
  const a = v.build.anchors.driverDoor;
  window.__PALM__.teleport(t.x + a.x, 0.5, t.z + a.z);
});
await sleep(900); await p.keyboard.press('KeyF'); await sleep(3500);
const mode = await p.evaluate(()=>window.__PALM__.sim.controlMode);
console.log('control mode:', mode);

const geom = await p.evaluate(()=>{
  const THREE = window.__PALM__.THREE;
  const scene = window.__PALM__.sim.scene;
  const box = new THREE.Box3();
  const out = {};
  const grab = (name) => {
    const o = scene.getObjectByName(name);
    if (!o) return null;
    box.setFromObject(o);
    return { min:[+box.min.x.toFixed(3),+box.min.y.toFixed(3),+box.min.z.toFixed(3)],
             max:[+box.max.x.toFixed(3),+box.max.y.toFixed(3),+box.max.z.toFixed(3)] };
  };
  out.steeringPivot = grab('steering_pivot');
  out.wheel01 = grab('InteriorSteeringWheel01');
  out.shell = grab('hero-shell');
  const car = scene.getObjectByName('hero-shell');
  out.carPos = car ? [+car.position.x.toFixed(2), +car.position.y.toFixed(2), +car.position.z.toFixed(2)] : null;
  // The PLAYER's own mesh only - traversing every skinned mesh picked up
  // pedestrians standing on the pavement.
  const player = scene.getObjectByName('player');
  if (player) { box.setFromObject(player); out.headTopY = +box.max.y.toFixed(3); }
  else out.headTopY = null;
  return out;
});
console.log(JSON.stringify(geom, null, 1));

await p.screenshot({path:'.testshots/F0-straight.png'});
await p.keyboard.down('a'); await sleep(1400);
const steer = await p.evaluate(()=>({ steer:+window.__PALM__.vehicle.steer.toFixed(3) }));
console.log('steer at full lock:', JSON.stringify(steer));
await p.screenshot({path:'.testshots/F1-locked.png'});
// Swing the chase camera round to look at the front wheels head-on.
for (const [yaw,pitch,name] of [[Math.PI/2,0.02,'F3-front'],[Math.PI*0.75,0.10,'F4-front-quarter']]) {
  await p.evaluate(({y,pi})=>{ window.__PALM__.sim.camera.yaw=y; window.__PALM__.sim.camera.pitch=pi; },{y:yaw,pi:pitch});
  await sleep(1400);
  await p.screenshot({path:`.testshots/${name}.png`});
}
const wheels = await p.evaluate(()=>window.__PALM__.vehicle.wheelStates.map(w=>({
  s:+w.steering.toFixed(3), r:+w.rotation.toFixed(2), sus:+w.suspension.toFixed(3), g:w.grounded })));
console.log('wheelStates:', JSON.stringify(wheels));
// Cockpit view while locked.
await p.keyboard.press('KeyV'); await sleep(1200);
await p.screenshot({path:'.testshots/F2-cockpit.png'});
await p.keyboard.up('a');
await b.close();
