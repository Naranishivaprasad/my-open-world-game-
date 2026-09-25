/**
 * PALM COAST living-world test (spec 37, WORLD section).
 *
 * Asserts on live traffic / pedestrian / police state in a real browser.
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
  await sleep(3000);
  const canvas = await page.$('canvas');
  await canvas?.click({ offset: { x: 800, y: 600 } });
  await sleep(700);

  // Stand on the Palm Boulevard pavement, looking east along the street.
  await page.evaluate(() => {
    window.__PALM__.teleport(-60, 0.5, 9.4);
    window.__PALM__.sim.camera.yaw = -Math.PI / 2;
    window.__PALM__.sim.camera.pitch = 0.1;
  });
  await sleep(11000); // let both populations build up

  const readTraffic = () =>
    page.evaluate(() => {
      const sys = window.__PALM__.traffic;
      if (!sys) return null;
      return sys.agents.map((a) => {
        const t = a.body.translation();
        const v = a.body.linvel();
        // Perpendicular distance from this agent to the centreline of its lane.
        const vx = a.lane.bx - a.lane.ax;
        const vz = a.lane.bz - a.lane.az;
        const len2 = vx * vx + vz * vz || 1;
        let s = ((t.x - a.lane.ax) * vx + (t.z - a.lane.az) * vz) / len2;
        s = Math.max(0, Math.min(1, s));
        const cx = a.lane.ax + vx * s;
        const cz = a.lane.az + vz * s;
        return {
          id: a.id,
          x: +t.x.toFixed(2),
          y: +t.y.toFixed(2),
          z: +t.z.toFixed(2),
          speed: +Math.hypot(v.x, v.z).toFixed(2),
          laneOffset: +Math.hypot(t.x - cx, t.z - cz).toFixed(2),
          lane: a.lane.id,
          knocked: a.knockedFor > 0,
          braking: a.braking,
          internalSpeed: +a.speed.toFixed(2),
          desired: +a.desiredSpeed.toFixed(2),
          distToEnd: +((1 - a.t) * a.lane.length).toFixed(1),
          endsAtJunction: a.lane.endsAtJunction,
          nextTurn: a.nextTurn,
        };
      });
    });

  const a0 = await readTraffic();
  record('traffic system is present', a0 !== null);
  if (!a0) return finish(browser, { consoleErrors, pageErrors });

  record('traffic spawns', a0.length >= 4, `${a0.length} vehicles active`);

  const upright = a0.filter((a) => a.y > -1 && a.y < 4).length;
  record('traffic sits on the road surface', upright === a0.length, `${upright}/${a0.length} at road height`);

  console.log('      agent table:');
  for (const a of a0) {
    console.log(
      `      #${String(a.id).padStart(2)} lane=${a.lane.padEnd(12)} v=${String(a.speed).padStart(5)} int=${String(a.internalSpeed).padStart(5)} want=${String(a.desired).padStart(5)} toEnd=${String(a.distToEnd).padStart(6)} jn=${a.endsAtJunction ? 'Y' : 'n'} turn=${a.nextTurn.padEnd(8)} brake=${a.braking}`,
    );
  }
  console.log('');

  const moving = a0.filter((a) => a.speed > 1).length;
  record('traffic is driving, not parked', moving >= Math.ceil(a0.length * 0.5), `${moving}/${a0.length} moving`);

  const onLane = a0.filter((a) => a.laneOffset < 2.0).length;
  record(
    'traffic follows its lane',
    onLane >= a0.length - 1,
    `${onLane}/${a0.length} within 2 m of their lane centreline (max ${Math.max(...a0.map((a) => a.laneOffset)).toFixed(2)} m)`,
  );

  await page.screenshot({ path: path.join(SHOTS, '40-traffic.png') });

  // --- traffic must actually progress around the network, not orbit one spot
  const before = new Map(a0.map((a) => [a.id, a]));
  await sleep(13000);
  const a1 = await readTraffic();
  let progressed = 0;
  let changedLane = 0;
  for (const a of a1) {
    const b = before.get(a.id);
    if (!b) continue;
    if (Math.hypot(a.x - b.x, a.z - b.z) > 8) progressed++;
    if (a.lane !== b.lane) changedLane++;
  }
  record('traffic travels along the network', progressed >= 1, `${progressed} vehicles moved >8 m in 13 s`);
  record(
    'traffic routes through junctions onto new lanes',
    changedLane >= 1,
    `${changedLane} vehicles changed lane/edge in 13 s`,
  );

  // --- blocking a lane must make traffic brake, not drive through (spec 37)
  const blocked = await page.evaluate(async () => {
    const sys = window.__PALM__.traffic;
    // Find a moving vehicle with clear road ahead, then park the player car in
    // front of it and watch what happens.
    // Only consider vehicles near the player: a distant one can drive past the
    // despawn radius during the measurement window.
    const pp = window.__PALM__.sim.player.position;
    const candidates = sys.agents.filter(
      (x) => !x.knockedFor && Math.hypot(x.x - pp.x, x.z - pp.z) < 130,
    );
    const a = candidates
      .filter((x) => Math.hypot(x.body.linvel().x, x.body.linvel().z) > 3)
      .sort((p, q) => q.speed - p.speed)[0];
    if (!a || a.speed < 2) {
      return {
        failed: true,
        total: sys.agents.length,
        candidates: candidates.length,
        speeds: sys.agents.map((x) => +x.speed.toFixed(1)),
        hasTeleportCar: typeof window.__PALM__.teleportCar,
      };
    }
    const t = a.body.translation();
    const fx = Math.sin(a.lane.heading);
    const fz = Math.cos(a.lane.heading);
    window.__PALM__.teleportCar(t.x + fx * 22, 0.6, t.z + fz * 22, a.lane.heading);
    return { id: a.id, speedBefore: Math.hypot(a.body.linvel().x, a.body.linvel().z) };
  });

  if (blocked && blocked.failed) {
    console.log('      braking-test diagnostic:', JSON.stringify(blocked));
  }
  if (blocked && !blocked.failed) {
    await sleep(2600);
    const after = await page.evaluate((id) => {
      const sys = window.__PALM__.traffic;
      const a = sys.agents.find((x) => x.id === id);
      if (!a) return null;
      const v = a.body.linvel();
      return { speed: Math.hypot(v.x, v.z), braking: a.braking, knocked: a.knockedFor > 0 };
    }, blocked.id);
    record(
      'traffic brakes for an obstacle in its lane',
      after !== null && (after.speed < blocked.speedBefore * 0.55 || after.braking),
      after
        ? `${blocked.speedBefore.toFixed(1)} -> ${after.speed.toFixed(1)} m/s, braking=${after.braking}`
        : 'vehicle despawned before it could be measured',
    );
  } else {
    record(
      'traffic brakes for an obstacle in its lane',
      false,
      blocked ? `no vehicle above 2 m/s (max ${Math.max(...blocked.speeds)})` : 'no vehicles at all',
    );
  }

  // --- traffic must not spawn on top of the player
  const near = await page.evaluate(() => {
    const sys = window.__PALM__.traffic;
    const p = window.__PALM__.sim.player.position;
    let min = Infinity;
    for (const a of sys.agents) {
      const t = a.body.translation();
      min = Math.min(min, Math.hypot(t.x - p.x, t.z - p.z));
    }
    return min;
  });
  record('no vehicle spawned on top of the player', near > 3, `nearest vehicle ${near.toFixed(1)} m`);

  // ----------------------------------------------------------- pedestrians
  const readPeds = () =>
    page.evaluate(() => {
      const sys = window.__PALM__.pedestrians;
      if (!sys) return null;
      return sys.peds.map((p) => {
        const t = p.body.translation();
        const v = p.body.linvel();
        return {
          id: p.id,
          x: +t.x.toFixed(2),
          y: +t.y.toFixed(2),
          z: +t.z.toFixed(2),
          speed: +Math.hypot(v.x, v.z).toFixed(2),
          state: p.state,
          heading: +p.heading.toFixed(2),
        };
      });
    });

  const p0 = await readPeds();
  record('pedestrian system is present', p0 !== null);
  if (p0) {
    record('pedestrians spawn', p0.length >= 4, `${p0.length} pedestrians active`);
    record(
      'pedestrians stand on the ground, not floating or sunk',
      p0.every((p) => p.y > -0.5 && p.y < 3),
      `y range ${Math.min(...p0.map((p) => p.y)).toFixed(2)} .. ${Math.max(...p0.map((p) => p.y)).toFixed(2)}`,
    );

    const walking = p0.filter((p) => p.speed > 0.3).length;
    record(
      'pedestrians are walking, not frozen',
      walking >= Math.ceil(p0.length * 0.4),
      `${walking}/${p0.length} moving (states: ${[...new Set(p0.map((p) => p.state))].join(', ')})`,
    );

    // Pedestrians must keep off the carriageway except while crossing.
    const offRoad = await page.evaluate(() => {
      const sys = window.__PALM__.pedestrians;
      const graph = window.__PALM__.roadGraph;
      let onRoad = 0;
      for (const p of sys.peds) {
        const t = p.body.translation();
        if (graph.isOnCarriageway(t.x, t.z, -0.8)) onRoad++;
      }
      return { onRoad, total: sys.peds.length };
    });
    record(
      'pedestrians keep off the carriageway',
      offRoad.onRoad <= Math.max(1, Math.floor(offRoad.total * 0.34)),
      `${offRoad.onRoad}/${offRoad.total} on the road (crossings allowed)`,
    );

    // Personal space: nobody should be standing inside somebody else.
    let tooClose = 0;
    for (let i = 0; i < p0.length; i++) {
      for (let k = i + 1; k < p0.length; k++) {
        if (Math.hypot(p0[i].x - p0[k].x, p0[i].z - p0[k].z) < 0.55) tooClose++;
      }
    }
    record('pedestrians do not overlap each other', tooClose === 0, `${tooClose} overlapping pairs`);

    await sleep(6000);
    const p1 = await readPeds();
    const beforeP = new Map(p0.map((p) => [p.id, p]));
    let moved = 0;
    for (const p of p1) {
      const b = beforeP.get(p.id);
      if (b && Math.hypot(p.x - b.x, p.z - b.z) > 2.5) moved++;
    }
    record('pedestrians travel to destinations', moved >= 1, `${moved} walked >2.5 m in 6 s`);

    await page.screenshot({ path: path.join(SHOTS, '41-pedestrians.png') });

    // Driving at them must make them react (spec 22).
    const reacted = await page.evaluate(() => {
      const sys = window.__PALM__.pedestrians;
      const p = sys.peds.find((x) => x.state === 'walk' || x.state === 'idle');
      if (!p) return null;
      const t = p.body.translation();
      // Place the car beside the pedestrian and give it genuine velocity.
      // Writing sim.vehicle.* directly does nothing: it is republished from the
      // controller every frame.
      window.__PALM__.teleportCar(t.x + 7, 0.6, t.z, -Math.PI / 2);
      window.__PALM__.vehicle.body.setLinvel({ x: -12, y: 0, z: 0 }, true);
      return { id: p.id };
    });
    if (reacted) {
      // Sample repeatedly: the alarm is transient by design.
      let seen = 'never sampled';
      for (let i = 0; i < 12; i++) {
        await sleep(120);
        const st = await page.evaluate((id) => {
          const sys = window.__PALM__.pedestrians;
          const p = sys.peds.find((x) => x.id === id);
          return p ? p.state : 'removed';
        }, reacted.id);
        seen = st;
        if (st === 'alarmed' || st === 'knocked' || st === 'removed') break;
      }
      record(
        'pedestrians react to a nearby moving vehicle',
        seen === 'alarmed' || seen === 'knocked' || seen === 'removed',
        `state became "${seen}"`,
      );
    } else {
      record('pedestrians react to a nearby moving vehicle', false, 'no pedestrian available');
    }
  }

  // ---------------------------------------------------------------- police
  const readPolice = () =>
    page.evaluate(() => {
      const p = window.__PALM__.police;
      const pp = window.__PALM__.sim.player.position;
      return {
        state: p.state,
        wanted: p.wanted,
        units: p.units.length,
        hasSight: p.units.some((u) => u.hasSight),
        lastKnown: { x: +p.lastKnown.x.toFixed(1), z: +p.lastKnown.z.toFixed(1), valid: p.lastKnown.valid },
        player: { x: +pp.x.toFixed(1), z: +pp.z.toFixed(1) },
        nearest: p.units.length
          ? Math.min(...p.units.map((u) => Math.hypot(u.x - pp.x, u.z - pp.z)))
          : Infinity,
      };
    });

  // Clean slate: park the car away from the pedestrians that the collision
  // tests above deliberately ran into, or their reports land mid-test.
  await page.evaluate(() => {
    window.__PALM__.teleportCar(140, 0.6, -26, 0);
    window.__PALM__.teleport(0, 0.5, 9.4);
  });
  await sleep(2500);
  await page.evaluate(() => window.__PALM__.police.clear());
  await sleep(900);

  const preCondition = await readPolice();
  record(
    'wanted level starts clean for the police tests',
    preCondition.wanted === 0,
    `wanted ${preCondition.wanted}, state "${preCondition.state}"`,
  );

  // 1. An UNWITNESSED offence must not raise the wanted level (spec 23).
  await page.evaluate(() => {
    const pp = window.__PALM__.sim.player.position;
    window.__PALM__.police.reportOffence('hitPedestrian', false, pp.x, pp.z);
  });
  await sleep(500);
  const quiet = await readPolice();
  record(
    'an unwitnessed offence does not raise the wanted level',
    quiet.wanted === 0 && quiet.state === 'unaware',
    `wanted ${quiet.wanted}, state "${quiet.state}"`,
  );

  // 2. A WITNESSED offence starts a response.
  await page.evaluate(() => {
    const pp = window.__PALM__.sim.player.position;
    window.__PALM__.police.reportOffence('hitPedestrian', true, pp.x, pp.z);
  });
  await sleep(700);
  const alerted = await readPolice();
  record(
    'a witnessed offence raises the wanted level',
    alerted.wanted >= 1,
    `wanted ${alerted.wanted}, state "${alerted.state}"`,
  );

  // 3. Units are dispatched and approach from a distance.
  let dispatched = null;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    dispatched = await readPolice();
    if (dispatched.units > 0) break;
  }
  record('police units are dispatched', (dispatched?.units ?? 0) > 0, `${dispatched?.units ?? 0} units`);
  record(
    'units do not appear on top of the player',
    dispatched === null || dispatched.nearest > 40,
    dispatched && Number.isFinite(dispatched.nearest)
      ? `nearest unit spawned ${dispatched.nearest.toFixed(0)} m away`
      : 'no units',
  );

  // 4. They must actually close the distance (plausible road approach).
  const approach0 = await readPolice();
  await sleep(9000);
  const approach1 = await readPolice();
  record(
    'units close in on the last known position',
    approach1.nearest < approach0.nearest - 5 || approach1.hasSight,
    `${approach0.nearest.toFixed(0)} m -> ${approach1.nearest.toFixed(0)} m, sight=${approach1.hasSight}`,
  );

  await page.screenshot({ path: path.join(SHOTS, '42-police.png') });

  // 5. Breaking line of sight degrades pursuit into a search, and the police
  //    must NOT track the player's live position (spec 23).
  //
  //    Wait for an actual pursuit first: degrading FROM pursuit is what is
  //    being tested, and units do not always acquire sight immediately.
  let pursued = null;
  for (let i = 0; i < 50; i++) {
    await sleep(600);
    pursued = await readPolice();
    if (pursued.state === 'pursuing') break;
  }
  record(
    'units escalate to an active pursuit once they see the player',
    pursued?.state === 'pursuing',
    `state "${pursued?.state}", sight ${pursued?.hasSight}`,
  );

  await page.evaluate(() => window.__PALM__.teleport(-180, 0.5, 170));
  let searched = null;
  for (let i = 0; i < 40; i++) {
    await sleep(600);
    searched = await readPolice();
    if (searched.state === 'searching' || searched.state === 'cooling' || searched.wanted === 0) break;
  }
  record(
    'losing line of sight degrades pursuit to a search',
    searched !== null && (searched.state === 'searching' || searched.state === 'cooling' || searched.wanted === 0),
    `state became "${searched?.state}"`,
  );
  if (searched) {
    const drift = Math.hypot(searched.lastKnown.x - searched.player.x, searched.lastKnown.z - searched.player.z);
    record(
      'police do not know the player position without line of sight',
      drift > 30 || searched.wanted === 0,
      `last known is ${drift.toFixed(0)} m from where the player actually is`,
    );
  }

  // 6. Escaping clears the wanted level.
  let escaped = null;
  for (let i = 0; i < 70; i++) {
    await sleep(700);
    escaped = await readPolice();
    if (escaped.wanted === 0) break;
  }
  record(
    'staying hidden eventually clears the wanted level',
    escaped?.wanted === 0,
    `final state "${escaped?.state}", wanted ${escaped?.wanted}, units ${escaped?.units}`,
  );

  // Let the world settle after the deliberate collisions above, then average
  // several samples - a single reading right after a pile-up is not typical.
  await page.evaluate(() => {
    window.__PALM__.teleportCar(140, 0.6, -26, 0);
    window.__PALM__.teleport(-60, 0.5, 9.4);
  });
  await sleep(4000);
  const fpsSamples = [];
  for (let i = 0; i < 8; i++) {
    await sleep(400);
    fpsSamples.push(await page.evaluate(() => window.__PALM__.sim.stats.fps));
  }
  const avgFps = fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length;
  const minFps = Math.min(...fpsSamples);

  const perf = await page.evaluate(() => ({
    fps: window.__PALM__.sim.stats.fps,
    draws: window.__PALM__.sim.stats.drawCalls,
    tris: window.__PALM__.sim.stats.triangles,
    traffic: window.__PALM__.sim.stats.trafficCount,
    peds: window.__PALM__.sim.stats.pedestrianCount,
  }));
  record(
    'frame rate with a living world',
    avgFps >= 50,
    `avg ${avgFps.toFixed(1)} fps, min ${minFps.toFixed(1)}, with ${perf.traffic} vehicles and ${perf.peds} pedestrians`,
  );
  console.log(`\n      draw calls ${perf.draws} | triangles ${perf.tris.toLocaleString()}`);

  await finish(browser, { consoleErrors, pageErrors });
}

async function finish(browser, extra) {
  const { consoleErrors = [], pageErrors = [] } = extra;
  record('no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
  record('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | ').slice(0, 240));
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  await writeFile(path.join(SHOTS, 'world-results.json'), JSON.stringify({ results }, null, 2));
  await browser.close();
  process.exit(results.every((r) => r.pass) ? 0 : 1);
}

main().catch((err) => {
  console.error('world test crashed:', err);
  process.exit(2);
});
