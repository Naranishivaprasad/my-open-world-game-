/**
 * NEO TOKYO driving test (spec 37, VEHICLE section).
 *
 * Drives real Chrome on the real GPU and asserts against live vehicle state.
 * Every check below maps to a line in the brief's vehicle test list.
 */

import puppeteer from 'puppeteer-core';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, '.testshots');
const URL = process.env.PALM_URL ?? 'http://localhost:3000';
const CHROME =
  process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  await mkdir(SHOTS, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: false,
    defaultViewport: { width: 1600, height: 900 },
    args: ['--window-size=1616,980', '--disable-features=CalculateNativeWinOcclusion'],
  });
  const page = await browser.newPage();

  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('.title', { timeout: 60000 });
  await page.evaluate(() =>
    [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('New session'))?.click(),
  );
  await page.waitForFunction(() => !!document.querySelector('canvas[aria-label="Minimap"]'), {
    timeout: 240000,
  });
  await sleep(4500); // let the car settle on its suspension
  // Quiet the world: the driving measurements need a clear straight, and live
  // traffic makes acceleration and steering runs non-deterministic.
  await page.evaluate(() => window.__PALM__.setPopulation?.(0, 0));
  await sleep(1200);
  record('world + vehicle loaded', true);

  const has = await page.evaluate(() => !!window.__PALM__?.vehicle && !!window.__PALM__?.interaction);
  record('vehicle and interaction exposed for testing', has);
  if (!has) return finish(browser, { consoleErrors, pageErrors });

  const read = () =>
    page.evaluate(() => {
      const s = window.__PALM__.sim;
      const v = window.__PALM__.vehicle;
      const t = v.body.translation();
      const r = v.body.rotation();
      return {
        mode: s.controlMode,
        camMode: null,
        px: s.player.position.x,
        pz: s.player.position.z,
        cx: t.x,
        cy: t.y,
        cz: t.z,
        crot: [r.x, r.y, r.z, r.w],
        speed: v.speed,
        kph: v.speedKph,
        gear: v.currentGear,
        steer: v.steer,
        engineOn: v.isEngineOn,
        grounded: v.wheelStates.filter((w) => w.grounded).length,
        wheelRot: v.wheelStates.map((w) => +w.rotation.toFixed(3)),
        susp: v.wheelStates.map((w) => +w.suspension.toFixed(3)),
        fps: s.stats.fps,
        prompt: s.interaction ? s.interaction.label : null,
        clip: s.player.clip,
      };
    });

  // Pointer lock so gameplay input is live.
  const canvas = await page.$('canvas');
  await canvas?.click({ offset: { x: 800, y: 600 } });
  await sleep(700);

  // ------------------------------------------------------- resting state
  const rest = await read();
  record(
    'car rests on all four wheels',
    rest.grounded === 4,
    `${rest.grounded}/4 wheels in contact, body y=${rest.cy.toFixed(3)}`,
  );
  record(
    'suspension is compressed under load, not bottomed out',
    rest.susp.every((s) => s > 0.05 && s < 0.26),
    `lengths ${rest.susp.join(', ')} (rest 0.26)`,
  );
  // Displacement over time is the meaningful test; instantaneous speed on a
  // settling suspension is noisy.
  const drift0 = await read();
  await sleep(2500);
  const drift1 = await read();
  const drift = Math.hypot(drift1.cx - drift0.cx, drift1.cz - drift0.cz);
  record('parked car stays put', drift < 0.25, `moved ${drift.toFixed(3)} m in 2.5 s`);

  // -------------------------------------------------- entry from too far
  await page.evaluate(() => window.__PALM__.teleport(120, 0.5, -26));
  await sleep(400);
  await page.keyboard.press('f');
  await sleep(600);
  const farTry = await read();
  record(
    'entry refused from too far away',
    farTry.mode === 'foot',
    `control mode stayed "${farTry.mode}"`,
  );

  // ------------------------------------------------------- walk up + enter
  await page.evaluate(() => window.__PALM__.teleport(146.6, 0.5, -26.0));
  // The refusal toast from the previous check owns the prompt for 2.2 s.
  await sleep(2600);
  const nearCar = await read();
  record('prompt appears next to the door', nearCar.prompt === 'Get in', `prompt: ${nearCar.prompt}`);

  await page.keyboard.press('f');
  await sleep(1800);
  const seated = await read();
  record('entering the car transfers control', seated.mode === 'vehicle', `mode "${seated.mode}"`);
  record('engine starts on entry', seated.engineOn === true);
  record(
    'character is placed in the seat, not left outside',
    Math.hypot(seated.px - seated.cx, seated.pz - seated.cz) < 1.2,
    `${Math.hypot(seated.px - seated.cx, seated.pz - seated.cz).toFixed(2)} m from car origin`,
  );
  record(
    'seated driving animation is playing',
    seated.clip === 'Driving_Loop',
    `clip "${seated.clip}"`,
  );
  await page.screenshot({ path: path.join(SHOTS, '10-seated.png') });

  // --------------------------------------------------------- open straight
  // Move the whole rig onto Palm Boulevard: ~300 m of clear, flat road, so the
  // driving numbers measure the car and not the gas-station furniture.
  const toStraight = async () => {
    await page.evaluate(() => {
      window.__PALM__.teleportCar(-140, 0.6, 3.6, Math.PI / 2); // heading = facing: +X
    });
    await sleep(1400);
  };
  await toStraight();

  // ----------------------------------------------------------- accelerate
  const a0 = await read();
  await page.keyboard.down('w');
  await sleep(3000);
  const a1 = await read();
  const travelled = Math.hypot(a1.cx - a0.cx, a1.cz - a0.cz);
  record(
    'throttle accelerates the car',
    a1.kph > 40,
    `${a1.kph.toFixed(1)} km/h after 3 s, at (${a1.cx.toFixed(0)},${a1.cz.toFixed(1)})`,
  );
  record('car actually travelled', travelled > 15, `${travelled.toFixed(1)} m`);
  record('gear reads D under power', a1.gear === 'D', `gear ${a1.gear}`);
  record(
    'wheels rotate with travel',
    Math.abs(a1.wheelRot[0] - a0.wheelRot[0]) > 20,
    `wheel spin delta ${(a1.wheelRot[0] - a0.wheelRot[0]).toFixed(1)} rad`,
  );
  await page.screenshot({ path: path.join(SHOTS, '11-driving-chase.png') });

  // ------------------------------------------- coasting must not stop dead
  await page.keyboard.up('w');
  const c0 = await read();
  await sleep(1200);
  const c1 = await read();
  record(
    'lifting off does not stop the car dead',
    c1.kph > c0.kph * 0.6 && c1.kph > 10,
    `${c0.kph.toFixed(1)} km/h @ (${c0.cx.toFixed(0)},${c0.cz.toFixed(1)}) -> ${c1.kph.toFixed(1)} km/h @ (${c1.cx.toFixed(0)},${c1.cz.toFixed(1)})`,
  );

  // ------------------------------------------- reverse while moving brakes
  const b0 = await read();
  await page.keyboard.down('s');
  await sleep(600);
  const b1 = await read();
  record(
    'reverse input while rolling forward brakes first',
    b1.kph < b0.kph - 5 && b1.speed > 0,
    `${b0.kph.toFixed(1)} -> ${b1.kph.toFixed(1)} km/h, still moving FORWARD at ${b1.speed.toFixed(2)} m/s`,
  );

  // -------------------------------------------------------------- braking
  let stopMs = null;
  const brakeStart = Date.now();
  for (let i = 0; i < 40; i++) {
    await sleep(80);
    const s2 = await read();
    if (Math.abs(s2.speed) < 0.6) {
      stopMs = Date.now() - brakeStart;
      break;
    }
  }
  record(
    'brakes bring the car to a stop',
    stopMs !== null,
    stopMs !== null
      ? `from ${b0.kph.toFixed(0)} km/h in ~${((stopMs + 600) / 1000).toFixed(1)} s`
      : 'did not reach a stop',
  );

  // Holding reverse past the stop engages R and pulls away backwards.
  await sleep(1800);
  const b2 = await read();
  await page.keyboard.up('s');
  record(
    'holding reverse past the stop engages R',
    b2.gear === 'R' && b2.speed < -0.4,
    `gear ${b2.gear}, speed ${b2.speed.toFixed(2)} m/s`,
  );
  await sleep(1200);

  // ---------------------------------------------------- steering direction
  // Full lock at ~40 km/h is a ~4.6 m radius turn, so holding it for 0.9 s
  // drove the car clean off the carriageway and into a building - after which
  // it sat stationary and the "steer right" sample read a yaw rate of zero.
  // 0.45 s is long enough for the yaw rate to establish and short enough to
  // stay on the road.
  const LOCK_MS = 450;
  await toStraight();
  await page.keyboard.down('w');
  await sleep(2200);
  await page.keyboard.down('a');
  await sleep(LOCK_MS);
  const leftTurn = await page.evaluate(() => {
    const v = window.__PALM__.vehicle;
    const t = v.body.translation();
    return { av: v.body.angvel().y, steer: v.steer, kph: v.speedKph, x: t.x, z: t.z };
  });
  await page.keyboard.up('a');
  await sleep(700);
  await page.keyboard.down('d');
  await sleep(LOCK_MS);
  const rightTurn = await page.evaluate(() => {
    const v = window.__PALM__.vehicle;
    const t = v.body.translation();
    return { av: v.body.angvel().y, steer: v.steer, kph: v.speedKph, x: t.x, z: t.z };
  });
  await page.keyboard.up('d');
  await page.keyboard.up('w');
  // Turning left is a positive rotation about +Y in three.js coordinates.
  record(
    'steering turns the car the correct way',
    leftTurn.av > 0.05 && rightTurn.av < -0.05,
    `left yaw rate ${leftTurn.av.toFixed(3)} rad/s, right ${rightTurn.av.toFixed(3)} rad/s | left ${leftTurn.kph.toFixed(0)}km/h @(${leftTurn.x.toFixed(0)},${leftTurn.z.toFixed(0)}) right ${rightTurn.kph.toFixed(0)}km/h @(${rightTurn.x.toFixed(0)},${rightTurn.z.toFixed(0)})`,
  );
  record(
    'steering input maps to opposite road-wheel angles',
    Math.sign(leftTurn.steer) !== Math.sign(rightTurn.steer),
    `left ${leftTurn.steer.toFixed(3)} rad, right ${rightTurn.steer.toFixed(3)} rad`,
  );
  await sleep(1500);

  // ------------------------------------------------ speed-sensitive steering
  await toStraight();
  await page.keyboard.down('a');
  await sleep(900);
  const steerSlow = (await read()).steer;
  await page.keyboard.up('a');
  await sleep(500);

  await page.keyboard.down('w');
  await sleep(7000); // build real speed on the straight
  await page.keyboard.down('a');
  await sleep(600);
  const fast = await read();
  await page.keyboard.up('a');
  await page.keyboard.up('w');
  record(
    'steering authority reduces with speed',
    Math.abs(fast.steer) < Math.abs(steerSlow) * 0.8,
    `${Math.abs(steerSlow).toFixed(3)} rad at rest vs ${Math.abs(fast.steer).toFixed(3)} rad at ${fast.kph.toFixed(0)} km/h`,
  );
  await sleep(2500);

  // ------------------------------------------------- camera switch is inert
  // Start from a guaranteed standstill, or residual roll from the previous
  // check is measured as "the camera moved the car".
  await toStraight();
  await sleep(1200);
  const preCam = await read();
  await page.keyboard.press('v');
  await sleep(500);
  const postCam = await read();
  const moved = Math.hypot(postCam.cx - preCam.cx, postCam.cz - preCam.cz);
  record(
    'switching camera does not disturb the vehicle',
    moved < 0.6 && Math.abs(postCam.speed - preCam.speed) < 0.6 && postCam.mode === 'vehicle',
    `moved ${moved.toFixed(3)} m, speed delta ${Math.abs(postCam.speed - preCam.speed).toFixed(3)} m/s`,
  );
  await sleep(400);
  await page.screenshot({ path: path.join(SHOTS, '12-cockpit.png') });

  // Drive a little in cockpit view to prove it tracks.
  await page.keyboard.down('w');
  await sleep(1500);
  await page.keyboard.up('w');
  await sleep(300);
  await page.screenshot({ path: path.join(SHOTS, '13-cockpit-moving.png') });
  await page.keyboard.press('v');
  await sleep(500);

  // ------------------------------------ chase camera stays behind the car
  //
  // Regression guard: free look used to accumulate without limit and never
  // recentre, so the camera could end up IN FRONT of the car looking back,
  // which makes correct steering read as inverted on screen.
  await toStraight();
  await sleep(600);
  await page.keyboard.down('w');
  // Sustained mouse movement, as a hand on a mouse actually produces.
  for (let i = 0; i < 40; i++) {
    await page.mouse.move(600 + (i % 2 ? 9 : -9), 400);
    await sleep(25);
  }
  await sleep(1400); // give it a chance to recentre
  const behind = await page.evaluate(() => {
    const v = window.__PALM__.vehicle;
    const cam = window.__PALM__.camera;
    const t = v.body.translation();
    const r = v.body.rotation();
    // Car forward = -Z in body space, rotated into the world.
    const q = { x: r.x, y: r.y, z: r.z, w: r.w };
    const rot = (vx, vy, vz) => {
      const ix = q.w * vx + q.y * vz - q.z * vy;
      const iy = q.w * vy + q.z * vx - q.x * vz;
      const iz = q.w * vz + q.x * vy - q.y * vx;
      const iw = -q.x * vx - q.y * vy - q.z * vz;
      return [
        ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
        iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
        iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
      ];
    };
    const f = rot(0, 0, -1);
    // Vector from camera to car, flattened.
    const dx = t.x - cam.position.x;
    const dz = t.z - cam.position.z;
    const len = Math.hypot(dx, dz) || 1;
    // Positive dot => camera is behind the car looking along its forward.
    return { dot: (dx / len) * f[0] + (dz / len) * f[2] };
  });
  await page.keyboard.up('w');
  record(
    'chase camera stays behind the car under mouse input',
    behind.dot > 0.45,
    `forward alignment ${behind.dot.toFixed(3)} (1 = directly behind, -1 = in front)`,
  );
  await sleep(1500);

  // ------------------------------------------------------------- headlights
  const l0 = await page.evaluate(() => window.__PALM__.sim.vehicle.headlights);
  await page.keyboard.press('l');
  await sleep(300);
  const l1 = await page.evaluate(() => window.__PALM__.sim.vehicle.headlights);
  record('headlights toggle', l0 !== l1, `${l0} -> ${l1}`);

  // ---------------------------------------------------------------- recovery
  await page.evaluate(() => {
    const v = window.__PALM__.vehicle;
    // Roll the car onto its roof to exercise the recovery path.
    v.body.setRotation({ x: 0.999, y: 0, z: 0, w: 0.04 }, true);
    v.body.setTranslation({ x: v.body.translation().x, y: 1.4, z: v.body.translation().z }, true);
  });
  await sleep(2600);
  const flipped = await read();
  await page.keyboard.press('r');
  await sleep(1400);
  const righted = await read();
  record(
    'overturned car can be recovered',
    righted.grounded >= 3,
    `${flipped.grounded}/4 wheels down when flipped, ${righted.grounded}/4 after recovery`,
  );

  // -------------------------------------------------------------------- exit
  await sleep(600);
  await page.keyboard.press('f');
  await sleep(1600);
  const out = await read();
  record('exiting returns control to the character', out.mode === 'foot', `mode "${out.mode}"`);
  const exitDist = Math.hypot(out.px - out.cx, out.pz - out.cz);
  record(
    'character is placed beside the car, not inside it',
    exitDist > 0.9 && exitDist < 4,
    `${exitDist.toFixed(2)} m from car origin`,
  );

  // Walking must work again straight after exiting.
  const w0 = await read();
  await page.keyboard.down('w');
  await sleep(1200);
  await page.keyboard.up('w');
  await sleep(300);
  const w1 = await read();
  record(
    'walking works immediately after exiting',
    Math.hypot(w1.px - w0.px, w1.pz - w0.pz) > 1.5,
    `${Math.hypot(w1.px - w0.px, w1.pz - w0.pz).toFixed(2)} m`,
  );

  // ------------------------------------------- repeated entry/exit (spec 17)
  let cycles = 0;
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => {
      const v = window.__PALM__.vehicle;
      const t = v.body.translation();
      window.__PALM__.teleport(t.x + 1.6, 0.5, t.z);
    });
    await sleep(450);
    await page.keyboard.press('f');
    await sleep(1700);
    const inCar = (await read()).mode === 'vehicle';
    await page.keyboard.press('f');
    await sleep(1600);
    const outCar = (await read()).mode === 'foot';
    if (inCar && outCar) cycles++;
  }
  record('entry/exit survives repetition', cycles === 3, `${cycles}/3 clean cycles`);

  const perf = await read();
  record('frame rate while driving', perf.fps >= 50, `${perf.fps.toFixed(1)} fps`);

  await finish(browser, { consoleErrors, pageErrors });
}

async function finish(browser, extra) {
  const { consoleErrors = [], pageErrors = [] } = extra;
  record('no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
  record(
    'no console errors',
    consoleErrors.length === 0,
    consoleErrors.slice(0, 2).join(' | ').slice(0, 240),
  );
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  await writeFile(path.join(SHOTS, 'drive-results.json'), JSON.stringify({ results }, null, 2));
  await browser.close();
  process.exit(results.every((r) => r.pass) ? 0 : 1);
}

main().catch(async (err) => {
  console.error('drive test crashed:', err);
  process.exit(2);
});
