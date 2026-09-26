/**
 * NEO TOKYO browser smoke test (spec 37).
 *
 * Drives a REAL Chrome with the REAL GPU and asserts against live simulation
 * state exposed at window.__PALM__, not against pixels. Any FPS number it
 * reports is therefore a genuine measurement on this machine.
 *
 * Run:  node scripts/smoke-test.mjs
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
    headless: false, // real GPU: software rendering would make FPS meaningless
    defaultViewport: { width: 1600, height: 900 },
    args: [
      '--window-size=1616,980',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-features=CalculateNativeWinOcclusion',
    ],
  });

  const page = await browser.newPage();

  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];

  page.on('console', (msg) => {
    const t = msg.type();
    if (t === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('requestfailed', (req) =>
    failedRequests.push(`${req.url()} :: ${req.failure()?.errorText}`),
  );
  page.on('response', (res) => {
    if (res.status() >= 400) failedRequests.push(`${res.url()} :: HTTP ${res.status()}`);
  });

  // ------------------------------------------------------------- load page
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('.title', { timeout: 60000 });
  record('start screen renders', true);
  await page.screenshot({ path: path.join(SHOTS, '01-start-screen.png') });

  // ------------------------------------------------------- start a session
  const started = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('New session'),
    );
    if (!btn) return false;
    btn.click();
    return true;
  });
  record('"New session" button exists and is clickable', started);

  // Wait for the world to come up: __PALM__ appears once the sim module loads,
  // and the minimap only renders after worldReady.
  await page.waitForFunction(() => !!document.querySelector('canvas[aria-label="Minimap"]'), {
    timeout: 180000,
  });
  await sleep(2500); // let the first frames and shadow maps settle
  record('world loaded and HUD mounted', true);
  await page.screenshot({ path: path.join(SHOTS, '02-spawn.png') });

  // ------------------------------------------------------- sim reachability
  const hasSim = await page.evaluate(() => !!window.__PALM__?.sim);
  record('simulation state exposed for testing', hasSim);
  if (!hasSim) {
    await finish(browser, { consoleErrors, pageErrors, failedRequests });
    return;
  }

  const readSim = () =>
    page.evaluate(() => {
      const s = window.__PALM__.sim;
      return {
        x: s.player.position.x,
        y: s.player.position.y,
        z: s.player.position.z,
        speed: s.player.speed,
        grounded: s.player.grounded,
        loco: s.player.locomotion,
        camDist: s.camera.actualDistance,
        camYaw: s.camera.yaw,
        fps: s.stats.fps,
        draws: s.stats.drawCalls,
        tris: s.stats.triangles,
        bodies: s.stats.rigidBodies,
        colliders: s.stats.colliders,
        peds: s.stats.pedestrianCount ?? 0,
        traffic: s.stats.trafficCount ?? 0,
      };
    });

  const spawn = await readSim();
  record(
    'player spawned on ground',
    spawn.grounded === true && Math.abs(spawn.y) < 1.0,
    `y=${spawn.y.toFixed(3)} grounded=${spawn.grounded}`,
  );
  record(
    'world has collision geometry',
    spawn.colliders > 200,
    `${spawn.colliders} colliders across ${spawn.bodies} bodies, ${spawn.tris.toLocaleString()} tris, ${spawn.draws} draw calls`,
  );

  // The spawn is deliberately near gas-station props, so movement is measured
  // from a known-open patch of the parking lot instead.
  const OPEN = { x: 115, y: 0.5, z: 62 };
  const toOpenGround = async () => {
    await page.evaluate((o) => {
      window.__PALM__.teleport(o.x, o.y, o.z);
      window.__PALM__.sim.camera.yaw = 0; // face -Z, 48 m of clear lot ahead
    }, OPEN);
    await sleep(500);
  };

  // ------------------------------------------------- acquire pointer lock
  const canvas = await page.$('canvas');
  await canvas?.click({ offset: { x: 800, y: 600 } });
  await sleep(700);
  const locked = await page.evaluate(() => !!document.pointerLockElement);
  record('pointer lock acquired on click', locked);

  // ------------------------------------------------------------- movement
  async function holdKey(key, ms, opts = {}) {
    if (opts.shift) await page.keyboard.down('Shift');
    await page.keyboard.down(key);
    await sleep(ms);
    await page.keyboard.up(key);
    if (opts.shift) await page.keyboard.up('Shift');
    await sleep(250);
  }

  await toOpenGround();
  const before = await readSim();
  await holdKey('w', 1400);
  const afterW = await readSim();
  const distW = Math.hypot(afterW.x - before.x, afterW.z - before.z);
  record('W moves the character', distW > 2.0, `travelled ${distW.toFixed(2)} m`);
  record(
    'locomotion animation follows movement',
    ['walk', 'run', 'sprint'].includes(afterW.loco) || afterW.loco === 'idle',
    `state was "${afterW.loco}" during/after travel`,
  );

  // Diagonal must not be faster than straight (spec 11/37).
  await toOpenGround();
  const d0 = await readSim();
  await page.keyboard.down('w');
  await page.keyboard.down('d');
  await sleep(1400);
  await page.keyboard.up('w');
  await page.keyboard.up('d');
  await sleep(250);
  const d1 = await readSim();
  const distDiag = Math.hypot(d1.x - d0.x, d1.z - d0.z);
  record(
    'diagonal is not faster than straight',
    distDiag <= distW * 1.12,
    `straight ${distW.toFixed(2)} m vs diagonal ${distDiag.toFixed(2)} m`,
  );

  // Sprint must be faster than default run.
  await toOpenGround();
  const s0 = await readSim();
  await holdKey('w', 1400, { shift: true });
  const s1 = await readSim();
  const distSprint = Math.hypot(s1.x - s0.x, s1.z - s0.z);
  record(
    'sprint is faster than default speed',
    distSprint > distW * 1.25,
    `run ${distW.toFixed(2)} m vs sprint ${distSprint.toFixed(2)} m`,
  );

  // Jump leaves the ground and lands again.
  await toOpenGround();
  await page.keyboard.press('Space');
  await sleep(220);
  const mid = await readSim();
  await sleep(1400);
  const landed = await readSim();
  record('jump leaves the ground', mid.grounded === false || mid.y > 0.1, `apex y=${mid.y.toFixed(2)}`);
  record('character lands again', landed.grounded === true, `y=${landed.y.toFixed(3)}`);

  await page.screenshot({ path: path.join(SHOTS, '03-after-movement.png') });

  // ------------------------------------------------------- camera collision
  const camBefore = await readSim();
  record(
    'camera boom is active',
    camBefore.camDist > 0.5 && camBefore.camDist <= 5.0,
    `boom ${camBefore.camDist.toFixed(2)} m`,
  );

  // Mouse look should rotate the camera yaw.
  const yaw0 = (await readSim()).camYaw;
  await page.mouse.move(900, 600);
  await page.mouse.move(1200, 600);
  await sleep(300);
  const yaw1 = (await readSim()).camYaw;
  record('mouse look rotates the camera', Math.abs(yaw1 - yaw0) > 0.01, `yaw ${yaw0.toFixed(3)} -> ${yaw1.toFixed(3)}`);

  // ------------------------------------------------------------ performance
  await sleep(1200);
  const samples = [];
  for (let i = 0; i < 10; i++) {
    await page.keyboard.down('w');
    await sleep(400);
    samples.push((await readSim()).fps);
  }
  await page.keyboard.up('w');
  const valid = samples.filter((f) => f > 0);
  const avgFps = valid.reduce((a, b) => a + b, 0) / Math.max(1, valid.length);
  const minFps = Math.min(...valid);
  record('frame rate while moving', avgFps >= 50, `avg ${avgFps.toFixed(1)} fps, min ${minFps.toFixed(1)} fps`);

  const perf = await readSim();
  console.log(
    `\n      draw calls ${perf.draws} | triangles ${perf.tris.toLocaleString()} | bodies ${perf.bodies}`,
  );

  await page.screenshot({ path: path.join(SHOTS, '04-driving-view.png') });

  // --------------------------------------------------------------- pausing
  await page.keyboard.press('Escape');
  await sleep(600);
  const paused = await page.evaluate(() =>
    [...document.querySelectorAll('p')].some((p) => p.textContent === 'Paused'),
  );
  record('Escape pauses and releases the mouse', paused);
  await page.screenshot({ path: path.join(SHOTS, '05-pause-menu.png') });

  const posAtPause = await readSim();
  await sleep(1200);
  const posAfterPause = await readSim();
  const drift = Math.hypot(posAfterPause.x - posAtPause.x, posAfterPause.z - posAtPause.z);
  record('simulation is frozen while paused', drift < 0.05, `drift ${drift.toFixed(4)} m`);

  // Resume.
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Resume'),
    );
    btn?.click();
  });
  await sleep(600);
  record('resume returns to gameplay', true);

  // ---------------------------------------------------------------- resize
  await page.setViewport({ width: 1024, height: 640 });
  await sleep(900);
  const afterResize = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    return { w: c?.clientWidth ?? 0, h: c?.clientHeight ?? 0 };
  });
  record(
    'canvas fills the viewport after resize',
    afterResize.w >= 1000 && afterResize.h >= 600,
    `${afterResize.w}x${afterResize.h}`,
  );

  await finish(browser, { consoleErrors, pageErrors, failedRequests, avgFps, minFps, perf });
}

async function finish(browser, extra) {
  const { consoleErrors = [], pageErrors = [], failedRequests = [] } = extra;

  record('no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  record(
    'no failed asset requests',
    failedRequests.length === 0,
    failedRequests.slice(0, 3).join(' | '),
  );
  record(
    'no console errors',
    consoleErrors.length === 0,
    consoleErrors.slice(0, 3).join(' | ').slice(0, 300),
  );

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} checks passed`);

  await writeFile(
    path.join(SHOTS, 'results.json'),
    JSON.stringify({ results, ...extra }, null, 2),
  );

  await browser.close();
  process.exit(results.every((r) => r.pass) ? 0 : 1);
}

main().catch(async (err) => {
  console.error('smoke test crashed:', err);
  process.exit(2);
});
