import puppeteer from 'puppeteer-core';
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const b = await puppeteer.launch({ executablePath: CHROME, headless: false, defaultViewport:{width:1000,height:600} });
const p = await b.newPage();
p.on('console',m=>{ const t=m.text(); if(/shader|WebGL|GLSL|ERROR/i.test(t)) console.log('['+m.type()+']', t.slice(0,600)); });
p.on('pageerror',e=>console.log('PAGEERROR:', e.message.slice(0,300)));
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
await p.goto('http://localhost:3000',{waitUntil:'domcontentloaded',timeout:60000});
await p.waitForSelector('.title',{timeout:60000});
await p.evaluate(()=>[...document.querySelectorAll('button')].find(x=>x.textContent?.includes('New session'))?.click());
await p.waitForFunction(()=>!!document.querySelector('canvas[aria-label="Minimap"]'),{timeout:300000});
await sleep(6000);
const info = await p.evaluate(()=>{
  let found = null;
  window.__PALM__.sim.scene.traverse(o=>{
    if (o.isMesh && o.geometry && o.geometry.attributes.position &&
        o.geometry.attributes.position.count > 15000 && o.geometry.attributes.position.count < 30000) {
      const bb = o.geometry.boundingBox || (o.geometry.computeBoundingBox(), o.geometry.boundingBox);
      found = { verts:o.geometry.attributes.position.count, visible:o.visible,
        matType:o.material.type, colour:o.material.color?.getHexString(),
        rough:o.material.roughness, env:o.material.envMapIntensity,
        bbx:[bb.min.x.toFixed(0), bb.max.x.toFixed(0)], bby:[bb.min.y.toFixed(2), bb.max.y.toFixed(2)],
        renderOrder:o.renderOrder, depthWrite:o.material.depthWrite, depthTest:o.material.depthTest };
    }
  });
  return found;
});
console.log('sea mesh:', JSON.stringify(info));
await b.close();
