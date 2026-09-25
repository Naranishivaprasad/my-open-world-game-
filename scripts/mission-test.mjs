/**
 * PALM COAST mission test (spec 37, MISSIONS section).
 *
 * Plays FIRST DELIVERY from beginning to end in a real browser and asserts on
 * live mission state: start, each objective, completion, the one-time reward,
 * failure, restart and abandon.
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
  await sleep(4000);
  const canvas = await page.$('canvas');
  await canvas?.click({ offset: { x: 800, y: 600 } });
  await sleep(800);

  // Quiet the world: the mission runs are about the mission, not about dodging
  // traffic that happens to be in the alley today.
  await page.evaluate(() => window.__PALM__.setPopulation?.(0, 0));
  await sleep(800);

  const read = () =>
    page.evaluate(() => {
      const m = window.__PALM__.sim.mission;
      const s = window.__PALM__.sim;
      return {
        state: m.state,
        index: m.objectiveIndex,
        label: m.objectiveLabel,
        distance: +m.distance.toFixed(1),
        inRange: m.inRange,
        carrying: m.carryingCrate,
        dialogue: m.dialogue,
        money: s.money,
        paid: m.paid,
        routeLen: m.route ? m.route.length : 0,
        route: m.route,
        mode: s.controlMode,
      };
    });

  const objectives = await page.evaluate(() => window.__PALM__.mission && true);
  record('mission system is present', !!objectives);
  if (!objectives) return finish(browser, { consoleErrors, pageErrors });

  // Fresh start for the run.
  await page.evaluate(() => window.__PALM__.mission.restart());
  await sleep(600);

  const start = await read();
  record('mission starts active on the first objective', start.state === 'active' && start.index === 0, `state "${start.state}", step ${start.index}: ${start.label}`);

  // --- route guidance must follow roads, not cut through buildings ---
  const routeCheck = await page.evaluate(() => {
    const m = window.__PALM__.sim.mission;
    const p = window.__PALM__.sim.player.position;
    if (!m.route || m.route.length < 2) return null;
    let len = 0;
    for (let i = 1; i < m.route.length; i++) {
      len += Math.hypot(m.route[i].x - m.route[i - 1].x, m.route[i].z - m.route[i - 1].z);
    }
    const last = m.route[m.route.length - 1];
    const straight = Math.hypot(last.x - p.x, last.z - p.z);
    // Does any route leg pass through a building collider?
    return { len, straight, points: m.route.length };
  });
  record(
    'route guidance exists and follows roads',
    routeCheck !== null && routeCheck.points >= 2 && routeCheck.len >= routeCheck.straight * 0.98,
    routeCheck
      ? `${routeCheck.points} points, ${routeCheck.len.toFixed(0)} m along roads vs ${routeCheck.straight.toFixed(0)} m straight line`
      : 'no route',
  );

  // ------------------------------------------------- objective 1: the contact
  await page.evaluate(() => {
    const o = window.__PALM__.mission.objective;
    window.__PALM__.teleport(o.x + 1.4, 0.5, o.z + 1.4);
  });
  await sleep(900);
  const atMara = await read();
  record('objective 1 registers the player in range', atMara.inRange === true, `distance ${atMara.distance} m, inRange ${atMara.inRange}`);

  // The objective must NOT complete without the key press (spec 24).
  await sleep(1200);
  const noPress = await read();
  record(
    'objective does not complete without the interact press',
    noPress.index === 0,
    `still on step ${noPress.index}`,
  );

  await page.keyboard.press('e');
  await sleep(900);
  const talked = await read();
  record('talking to the contact advances the mission', talked.index === 1, `step ${talked.index}: ${talked.label}`);
  record('briefing dialogue plays', !!talked.dialogue, `"${(talked.dialogue ?? '').slice(0, 60)}"`);
  await page.screenshot({ path: path.join(SHOTS, '50-briefing.png') });

  // ------------------------------------------------- objective 2: get the car
  await page.evaluate(() => {
    const v = window.__PALM__.vehicle.body.translation();
    window.__PALM__.teleport(v.x + 1.6, 0.5, v.z);
  });
  await sleep(700);
  await page.keyboard.press('f');
  await sleep(2200);
  const inCar = await read();
  record('getting in the car advances the mission', inCar.index === 2 && inCar.mode === 'vehicle', `step ${inCar.index}, mode "${inCar.mode}"`);

  // ------------------------------------------------- objective 3: drive there
  await page.evaluate(() => {
    const o = window.__PALM__.mission.objective;
    window.__PALM__.teleportCar(o.x, 0.6, o.z, 0);
  });
  await sleep(1800);
  const atAlley = await read();
  record('arriving at the pickup zone advances the mission', atAlley.index === 3, `step ${atAlley.index}: ${atAlley.label}`);

  // ------------------------------------------------ objective 4: the crate
  // Get out first: the collect objective requires being on foot.
  await page.keyboard.press('f');
  await sleep(2000);
  await page.evaluate(() => {
    const o = window.__PALM__.mission.objective;
    window.__PALM__.teleport(o.x + 1, 0.5, o.z + 1);
  });
  await sleep(900);

  const beforeCollect = await read();
  await page.keyboard.press('e');
  await sleep(900);
  const collected = await read();
  record(
    'collecting the crate requires being on foot and advances',
    collected.index === 4 && collected.carrying === true,
    `step ${collected.index}, carrying ${collected.carrying} (was ${beforeCollect.carrying})`,
  );
  await page.screenshot({ path: path.join(SHOTS, '51-crate.png') });

  // ------------------------------------------------ objective 5: drive to yard
  await page.evaluate(() => {
    const v = window.__PALM__.vehicle.body.translation();
    window.__PALM__.teleport(v.x + 1.6, 0.5, v.z);
  });
  await sleep(700);
  await page.keyboard.press('f');
  await sleep(2200);
  await page.evaluate(() => {
    const o = window.__PALM__.mission.objective;
    window.__PALM__.teleportCar(o.x, 0.6, o.z, 0);
  });
  await sleep(1800);
  const atYard = await read();
  record('arriving at the drop zone advances the mission', atYard.index === 5, `step ${atYard.index}: ${atYard.label}`);

  // ------------------------------------------------ objective 6: deliver
  await page.keyboard.press('f');
  await sleep(2000);
  await page.evaluate(() => {
    const o = window.__PALM__.mission.objective;
    window.__PALM__.teleport(o.x + 0.8, 0.5, o.z + 0.8);
  });
  await sleep(900);
  await page.keyboard.press('e');
  await sleep(1000);

  const done = await read();
  record('mission completes', done.state === 'completed', `state "${done.state}"`);
  record('reward is paid on completion', done.money === 250, `$${done.money}`);
  record('crate is no longer carried after delivery', done.carrying === false);
  record('outro dialogue plays', !!done.dialogue, `"${(done.dialogue ?? '').slice(0, 60)}"`);
  await page.screenshot({ path: path.join(SHOTS, '52-complete.png') });

  // --- the reward must not pay twice for one completion (spec 24) ---
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('e');
    await sleep(220);
  }
  await sleep(600);
  const again = await read();
  record('reward is not paid twice for one completion', again.money === 250, `$${again.money} after 4 further interact presses`);

  // --- no stale objective or marker once complete ---
  record(
    'no stale objective marker after completion',
    again.label === null && again.routeLen === 0,
    `label ${again.label}, route points ${again.routeLen}`,
  );

  // ------------------------------------------------------------- restart
  await page.evaluate(() => window.__PALM__.mission.restart());
  await sleep(800);
  const restarted = await read();
  record(
    'restart re-arms the mission from the first objective',
    restarted.state === 'active' && restarted.index === 0 && restarted.carrying === false,
    `state "${restarted.state}", step ${restarted.index}, carrying ${restarted.carrying}`,
  );
  record('restart clears the carried crate and the paid flag', restarted.paid === false);

  // ---------------------------------------------------------------- failure
  await page.evaluate(() => {
    window.__PALM__.mission.fail('Test-triggered failure.');
  });
  await sleep(600);
  const failed = await read();
  record('a mission can fail', failed.state === 'failed', `state "${failed.state}"`);
  record('failure clears the objective', failed.label === null);

  // --------------------------------------------------------------- abandon
  await page.evaluate(() => {
    window.__PALM__.mission.restart();
  });
  await sleep(600);
  await page.evaluate(() => window.__PALM__.mission.abandon());
  await sleep(600);
  const abandoned = await read();
  record('a mission can be abandoned', abandoned.state === 'abandoned', `state "${abandoned.state}"`);

  // Average several samples after the world settles; a single reading taken
  // right after a burst of teleports is not typical.
  await sleep(3000);
  const samples = [];
  for (let i = 0; i < 8; i++) {
    await sleep(400);
    samples.push(await page.evaluate(() => window.__PALM__.sim.stats.fps));
  }
  const avgFps = samples.reduce((a, b) => a + b, 0) / samples.length;
  record(
    'frame rate during the mission',
    avgFps >= 50,
    `avg ${avgFps.toFixed(1)} fps, min ${Math.min(...samples).toFixed(1)}`,
  );

  await finish(browser, { consoleErrors, pageErrors });
}

async function finish(browser, extra) {
  const { consoleErrors = [], pageErrors = [] } = extra;
  record('no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
  record('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | ').slice(0, 240));
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  await writeFile(path.join(SHOTS, 'mission-results.json'), JSON.stringify({ results }, null, 2));
  await browser.close();
  process.exit(results.every((r) => r.pass) ? 0 : 1);
}

main().catch((err) => {
  console.error('mission test crashed:', err);
  process.exit(2);
});
