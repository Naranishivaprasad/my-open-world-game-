# PALM COAST

An original, browser-playable open-world action game set in a fictional tropical
coastal city. No Unreal Engine, no Unity, no cloud streaming — it runs in a
normal desktop browser.

**Current state: Milestone E — a bigger city you can drive anything in.**
You can walk, run, sprint and jump around a 1030 m x 1030 m city with an ocean
and a beach along its eastern edge, get into **any car, van, pickup or
motorcycle you find** and drive it with chase or cockpit cameras, among traffic
that follows lanes and queues at junctions, pedestrians that use the pavements
and wait at kerbs, and a police force that responds to what it actually
witnesses — and you can play **FIRST DELIVERY** from briefing to payment.

---

## Run it

```bash
npm install
npm run assets      # downloads CC0/CC-BY assets (~48 MB) into /public
npm run dev         # http://localhost:3000
```

`npm run assets` is required once before the first run. Without it the game
still runs, but surfaces fall back to flat colours and the car will not load.

| Script | What it does |
|---|---|
| `npm run dev` | Dev server on :3000 |
| `npm run build` / `npm start` | Production build and serve |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run assets` | Fetch third-party assets (idempotent) |
| `node scripts/smoke-test.mjs` | On-foot suite, real Chrome, real GPU |
| `node scripts/drive-test.mjs` | Driving suite, real Chrome, real GPU |
| `node scripts/world-test.mjs` | Traffic / pedestrian / police suite |
| `node scripts/mission-test.mjs` | Plays FIRST DELIVERY start to finish |
| `node scripts/takeover-test.mjs` | Taking over a parked car and returning to the hero car |
| `node scripts/swap-test.mjs` | Driving each body class in turn |
| `node scripts/bike-test.mjs` | Riding a parked two-wheeler |
| `node scripts/map-test.mjs` | Map opens, pauses the world, and closes |
| `node scripts/signal-test.mjs` | Signal phases, and traffic stopping at red |
| `node scripts/campaign-test.mjs` | Plays all five missions and the fail-on-timeout |
| `node scripts/timelapse.mjs` | Screenshots the day across eight hours |
| `node scripts/profile.mjs` | A/B frame-rate attribution (skinned meshes, shadows, city) |
| `node scripts/tricount.mjs` | Scene triangles bucketed by group |

To performance-test what a player actually runs, build with the test hook left
in — it is gated on its own flag, not on `NODE_ENV`:

```bash
NEXT_PUBLIC_PALM_DEBUG=1 npm run build && npx next start
```

A plain `npm run build` ships without the hook. There is also a development-only
vehicle showroom at `/showroom` (`?view=side|front|rear|iso&only=<class>`).

---

## Controls

### On foot

| Key | Action |
|---|---|
| `W A S D` | Move (camera-relative) |
| Mouse | Look |
| `Shift` | Sprint |
| `Alt` / `Z` | Walk (hold) |
| `Space` | Jump |
| `F` | Get in / out of the car |
| `Esc` | Pause and release the mouse |
| `F3` | Dev overlay (fps, position, animation state, car telemetry) |
| `F4` | Collider wireframes |

### Driving

| Key | Action |
|---|---|
| `W` / `S` | Accelerate / brake, then reverse |
| `A` / `D` | Steer |
| `Space` | Handbrake |
| `M` | City map |
| `V` | Switch chase ↔ cockpit camera |
| `L` | Headlights (automatic after dark until first used) |
| `H` | Horn |
| `R` | Recover a flipped car |
| `F` | Get in / out. Near a parked vehicle, takes that one instead |

Pointer lock is requested on click and can be released at any time with `Esc`.

---

## What actually works

Verified by four suites that drive real Chrome on the real GPU and assert
against live simulation state, not pixels:

- `node scripts/smoke-test.mjs` - on foot - **23/23 passing**
- `node scripts/drive-test.mjs` - driving - **33/33 passing**
- `node scripts/world-test.mjs` - traffic, pedestrians, police - **30/30 passing**
- `node scripts/mission-test.mjs` - the mission loop - **25/25 passing**

### On foot (Milestone A)

- Kinematic capsule controller with slope limits, autostep over the 0.15 m kerb,
  snap-to-ground and wall sliding.
- Diagonal movement is **not** faster than straight (measured 5.88 m vs 5.90 m).
- Three distinct ground speeds: walk 1.7, run 4.2, sprint 6.6 m/s.
- Jump with coyote time; one held key cannot re-trigger it.
- Animation state machine over the clips actually present in the GLB, with
  playback rate scaled to real ground speed.
- Third-person camera with a sphere-cast boom that will not pass through walls.
- 1030 m x 1030 m city: 13 named roads (6 north-south x 7 east-west) giving 42
  intersections, kerbs, lane markings, crosswalks, gas station, parking lot,
  service alley, water-tower landmark — and an ocean, beach and promenade along
  the eastern edge.
- Five districts generated from the road graph — downtown, commercial,
  residential, industrial and seafront — each with its own building massing,
  setbacks and storey range.
- Visual road and physical road are generated from the same road graph, so they
  cannot disagree.
- Minimap drawn from the actual road graph.
- Pause genuinely freezes physics (measured drift 0.0000 m). Focus loss clears
  held keys; resize works; no console errors.

### Driving (Milestone B)

- Rapier raycast vehicle: four independently suspended wheels, RWD, with
  wheelbase (2.800 m), track (1.952 m) and hub height (0.384 m) **measured from
  the model**, not estimated.
- Enter/exit is an explicit state machine with obstruction checks. Entry is
  refused from too far away, from a moving car, or when both doors are blocked.
  Verified over 3 consecutive enter/exit cycles with no state leak.
- Lifting off does **not** stop the car dead (measured 57 → 51 km/h over 1.2 s).
- Pressing reverse while rolling forward **brakes first** (measured 51 → 30 km/h
  while still moving forward), and only engages R once stopped.
- Brakes: 51 km/h to a standstill in ~1.7 s (≈8.5 m/s²).
- Steering turns the car the correct way (measured +2.06 rad/s left,
  −2.33 rad/s right) and loses authority with speed (0.580 rad at rest →
  0.405 rad at 85 km/h).
- Chase and cockpit cameras. Switching between them moves the car 0.000 m.
- The cockpit renders the car's **real modelled cabin** — dash, instrument
  cluster, a steering wheel that follows the road wheels, wipers.
- Working brake / reverse / head lights, seated `Driving_Loop` animation,
  flip-recovery, and a speed/gear HUD fed from the controller.
- Engine, tyre and horn audio synthesised from live RPM.

### Missions, the map and the coast (Milestone G)

- **A five-mission campaign**, not one job: First Delivery, Night Shift (a
  timed three-drop run at night), Hot Property (steal a car off the Calle
  Verde lot), Shake Them (starts with three stars on you; lose them), and
  Coast Run (five markers down Ocean Drive against the clock). Rewards run
  250 -> 400 -> 600 -> 800 -> 1100. Finishing one puts the next on offer back
  at Mara's forecourt. New objective kinds - checkpoint, steal, evade - are
  each checked against live simulation state, and timed missions really do
  fail when the clock runs out.
- **The map is a city map**, not a wire grid: building footprints from the
  generator's own block rectangles, district tints and names, street names,
  road casing, scale bar, the coast, every parked vehicle and your own parked
  car. Scroll to zoom, drag to pan, click to drop a waypoint - which then
  shows on the minimap and as a live distance beside the clock.
- **The beach actually exists now.** It was being generated all along and
  buried: the grass plane and its collider ran to the world edge, so the sand
  sloped away UNDERNEATH it and you walked on grass out over the water. The
  land now stops at the promenade, the beach has its own walkable surface, and
  a boundary fence that was standing in the sea has been moved to the northern
  edge where it belonged.
- **Water with structure.** The sea is tessellated non-uniformly - about a
  metre between vertices at the waterline, tens of metres at the horizon - so
  the swell is visible where you stand rather than averaged away across 25 m
  quads. Waves shoal as the water shallows, the shader knows the beach profile
  underneath it so depth drives the colour, and surf foams in the last half
  metre and on breaking crests. There is a timber **pier** out over the water.
- Beach sand is a real CC0 texture (ambientCG Ground054), not tinted dirt.

### Time, weather and the crowd (Milestone F)

- **A full day/night cycle.** One number - the hour - drives the sun's arc, its
  colour and strength, the sky gradient, the hemisphere fill, the fog, the
  image-based lighting and the stars, so a sunset sky with midday shadows is
  not expressible. A day is 24 real minutes. Windows across the city light up
  at dusk and go out at dawn, and headlights come on by themselves after dark
  until you touch the light switch.
- **A full-screen city map on `M`**, drawn from the same road graph as the
  city itself, showing the coast, the beach, every parked vehicle, the mission
  route and named landmarks. Opening it pauses the world (measured drift
  0.0000 m).
- **People wear clothes.** Each vertex of the mannequin is classified into a
  body region from the bone it is skinned to, and a shader paints skin, hair,
  shirt, trousers and shoes separately. Pedestrians get randomised outfits from
  the seeded generator, so a city seed always dresses the same crowd. The
  geometry stays shared; only five colour uniforms differ per person.
- **Working traffic lights** at all 19 boulevard junctions. The function that
  decides which lamp is lit is the one traffic reads to decide whether to stop,
  so the signal cannot disagree with the behaviour. Measured: 32 of 42 cars
  approaching a red came to a stop, and the two directions are never green
  together. Quieter street-on-street junctions keep the give-way rule.

### Driving anything (Milestone E)

- **Every parked vehicle is drivable.** Walk up to any of the ~150 parked cars,
  vans, pickups or bikes in the city, press `F`, and you drive it. The car you
  were in stays exactly where you left it and can be walked back to and taken
  again — including the hero car.
- Eight original body classes — saloon, hatchback, coupe, SUV, pickup, van,
  motorcycle, scooter — plus a liveried police cruiser, all procedural geometry
  with tapered bodies, wheel-arch cutouts and inset glazing. No two handle the
  same: measured 0–2.6 s, a coupe reaches 55.6 km/h, a saloon 37.7, a van 29.4
  and a 125 scooter 25.1.
- Physics is **derived from the body class**, not hand-authored per vehicle:
  mass, inertia, centre of gravity, collider, wheelbase, track and engine force
  all scale from the hero car's measured tuning, so a van rolls lazily and a
  coupe changes direction because their numbers say so.
- There is only ever **one raycast vehicle** in the world. Taking over a car
  reconfigures that chassis in place rather than building a second one — see
  "One controller, many vehicles" below.

### The living world (Milestone C)

- **Traffic** follows a lane network derived from the same road graph as the
  geometry, so the drivable road and the routed road cannot disagree. Measured:
  8/8 vehicles moving, every one within **0.00 m** of its lane centreline, 6
  routing through junctions onto new lanes in 13 s.
- Junctions use an explicit **reservation** — one vehicle crosses at a time,
  with a held-too-long release — so they cannot deadlock.
- Traffic **brakes for obstacles** instead of driving through them (measured
  9.7 → 2.5 m/s for a car parked in its lane) and treats the hero car as an
  obstacle whether or not you are sitting in it.
- Agents are velocity-driven **dynamic** bodies, so ramming one shoves it out of
  its lane; it then stops steering and behaves like the loose object it is.
- **Pedestrians** walk a sidewalk graph with crossings flagged wherever a link
  crosses a carriageway. Measured: 12 active, 11 walked >2.5 m in 6 s, **0**
  overlapping pairs, 11/12 off the carriageway. They wait at kerbs for traffic
  and become alarmed near a fast vehicle.
- Each pedestrian has its **own skeleton and mixer** (SkeletonUtils.clone) with
  a per-agent time offset, so a crowd never steps in unison. Distant ones skip
  mixer updates entirely.
- **Police** run a real state machine:
  `unaware → responding → pursuing → searching → cooling → unaware`.
  Measured end to end: units dispatched **188 m away**, closed to **35 m** with
  line of sight, degraded to `searching` when sight broke, and the last-known
  position stayed **241 m from where the player actually was**. The police are
  not omniscient.
- Detection needs a real raycast through the world inside a forward sight cone.
  An **unwitnessed offence does not raise the wanted level at all** (verified).
- Units route to their objective along the lane network, picking the successor
  that closes the distance — a plausible road approach, not a straight line
  through buildings. They never spawn near the player (measured 188 m).
- Siren audio follows the real police state, and the wanted stars show the
  actual state machine (`SPOTTED` / `IN PURSUIT` / `SEARCHING 14s`).

### The gameplay loop (Milestone D)

**FIRST DELIVERY** runs end to end, verified by playing it in a browser:

1. Find **Mara Vance** on the Sunfuel forecourt and press `E`.
2. Take the car.
3. Drive to the service alley behind Calderon Imports.
4. Get out and collect the crate.
5. Drive it to the Dock Street yard.
6. Drop it and get paid **$250**.

- Every objective has a **real completion condition** checked against live
  simulation state — position, on-foot vs driving, and an actual key press.
  Verified: standing in the objective for 1.2 s without pressing `E` does
  **not** complete it.
- **Route guidance is A\* over the lane network**, so the line on the minimap
  follows real roads. Measured on the first leg: **121 m along roads vs 42 m
  straight-line** — it is routing around the block, not drawing through it.
- The reward is paid **once**. Verified by mashing interact four more times
  after completion: still $250.
- Restart re-arms from objective 1, clears the carried crate and resets the
  paid flag. Failure (getting busted) and abandon both work, and the pause
  menu offers **Restart mission** and a confirmed **Abandon mission**.
- No stale markers: after completion the objective label is `null` and the
  route is empty. The contact never despawns, so the mission is always
  replayable (spec 24: mission-critical entities must not disappear).
- Dialogue is original, queued line by line, and skippable with `M`.

**Measured performance**, at 1600×900 on the medium preset, on the development
machine's GPU in Chrome:

| Scenario | Frame rate |
|---|---|
| On foot, full world live | **60.0 fps** avg / 60.0 min |
| Driving | **59.3 fps** |
| 8 vehicles + 12 pedestrians + police | **57.3 fps** avg / 52.9 min |
| Playing the mission | **59.5 fps** avg / 55.9 min |

This is **vsync-capped at 60 Hz**, so headroom above 60 is unknown. About 200
draw calls and ~730k triangles with everything running.

One optimisation worth naming, because it was measured rather than assumed: the
car's `Glass` material uses `KHR_materials_transmission`, which makes three.js
render an extra full scene pass every frame. Replacing it with alpha blending
took driving from **22.8 fps to 60.1 fps**.

---

## What is NOT built

Stated plainly so nothing here is mistaken for finished work:

- **Five missions, one contact.** There is a campaign, but every job is handed
  out by Mara at the same forecourt; there are no rival contacts, no random
  encounters and no branching.
- **No progression beyond the cash number.** Money is earned and displayed but
  buys nothing — no shops, garages, upgrades or clothing.
- **Police are ground units only** — no roadblocks, helicopters or coordinated
  manoeuvres. Arrest is detected but there is no bust/respawn flow yet.
- **Hitting a pedestrian** removes them after a short stumble. There is no
  injury model; presentation is deliberately non-graphic.
- **Audio is engine / tyre / horn / siren only**, and it is synthesised, not
  recorded. No footsteps, impacts, doors, ambience or music. The Ambience and
  Music sliders are stored but unused, and say so on screen.
- **No live mirrors.** The car's mirrors are geometry, not render targets.
- **No hands on the wheel in cockpit view.** The character is hidden in first
  person rather than left to clip through the camera; posing the mannequin's
  arms onto this car's wheel needs IK that is not implemented.
- **No damage model.** Collisions are rigid-body only — no deformation, no
  broken glass, no performance loss.
- **No saving.** Settings persist to `localStorage`; game progress does not
  persist at all. "Continue" is disabled until a session exists, and is
  session-only.
- **No combat**, by design — the brief puts it after core gameplay.
- **No rebinding UI, no gamepad, no mobile/touch support.**
- **Motorcycles do not lean.** They are held upright by a 0.44 m *virtual*
  track given to the raycast vehicle, because Rapier's vehicle controller has
  no notion of balance. They ride and steer, but this is an arcade
  approximation, not motorcycle dynamics — no countersteer, no lean angle, no
  falling off. The rider also uses the car's seated `Driving_Loop` clip, so the
  pose is plausible but not a proper riding posture, and there is no helmet.
- **Traffic cars cannot be commandeered while moving.** Only parked vehicles
  can be taken; pulling a driver out of moving traffic is not implemented.
- **The drive frame-rate check is marginal.** On this machine it oscillates
  between roughly 31 and 51 fps across runs at 1600x900, against a 50 fps
  threshold, so it sometimes fails. The other three frame-rate checks pass
  (52.6 on foot, 54.8 with a full living world, 60.0 during the mission).

### The hero car is not the convertible the brief asked for

Reference images 1 and 3 show an older red convertible. No free, cleanly
licensed convertible with a usable interior exists — see [`ASSETS.md`](./ASSETS.md)
for the full list of candidates and why each was rejected. The car shipped is a
modern **concept car** (CC BY 4.0), painted red, with a fixed roof and a centre
driving position. That is a real deviation from the brief, not a match.

### The player character is a placeholder

The body is an **untextured articulated mannequin**, not a finished character.
It is the only rigged humanoid found that is simultaneously free, downloadable
without an account, and cleanly licensed. It is styled as a deliberate two-tone
dummy rather than dressed up as a realistic human.

To replace it, the cleanest route is Quaternius's **Universal Base Characters**
(textured, same 53-joint rig) from itch.io — its download is CSRF-gated so a
script cannot fetch it, but a person can in about a minute. Drop the GLB in
`public/models/vendor/` and point `CHARACTER_MODEL.url` at it.

---

## Architecture

```
src/
  app/                  Next.js App Router shell; the game is dynamically
                        imported with ssr:false (WebGL never runs on the server)
  game/
    config/             All tuning: world, character, vehicle, quality presets,
                        key bindings. No magic numbers elsewhere.
    core/               sim.ts   — mutable, NON-reactive per-frame state
                        store.ts — zustand, discrete UI/game state only
                        rng.ts   — seeded, so the city never rearranges itself
    input/              Key bindings, pointer lock, focus-loss handling
    world/              roadGraph.ts        source of truth for road geometry
                        laneNetwork.ts      routable lanes + junction links
                        sidewalkNetwork.ts  walkable graph, crossings flagged
                        buildCity.ts        pure seeded geometry + colliders
                        vehicleGeometry.ts  the eight body classes, procedural
                        Sea.tsx             displaced ocean surface
    character/          Rapier kinematic controller + animation state machine
    vehicle/            Raycast vehicle, enter/exit state machine, car rig,
                        VehicleOwner (which vehicle is being driven),
                        parkedVehicles (registry), takeover (swapping)
    traffic/            Lane-following traffic + sidewalk pedestrians
    police/             Wanted state machine, pursuit, offence reporting
    audio/              Synthesised engine / tyre / horn
    camera/             Foot, chase and cockpit rigs with shape-cast collision
    ui/                 HUD, minimap, menus, settings, credits
    debug/              Dev-only stats probe and the /showroom page
```

The split that matters: **per-frame transforms live in `sim` and never touch
React.** The HUD samples `sim` at 10 Hz. React handles discrete state only.

Vehicle physics runs entirely on the fixed physics step; the renderer only ever
*reads* the chassis transform, so forces and transforms can never fight.

### One controller, many vehicles

There is exactly one Rapier raycast vehicle in the world, and "getting into
another car" **reconfigures that chassis in place** — mass properties, collider
extents, wheel connection points, wheel radius and engine force — rather than
building a second one.

That is not only a performance choice. Disposing a Rapier vehicle controller
and creating a replacement mid-session panics the wasm module outright
(`unreachable`), after which every later call into Rapier fails with a borrow
error and the simulation is dead. Rapier exposes setters for exactly the things
that differ between vehicles, so nothing needs tearing down at all. Swaps are
also queued and applied at the start of a physics step, never from an input
handler, so they can never land while the world is already borrowed.

Parked vehicles — both the ones the city generator lays out and the ones the
player abandons — live in a single registry (`vehicle/parkedVehicles.ts`), and
the renderer subscribes to it. From the moment the player steps out of a car it
is simply another parked car; there is no second system for it.

---

## Licences and attribution

Most third-party assets are **CC0 1.0**, which requires no attribution. The
**hero vehicle is CC BY 4.0 and attribution is mandatory**:

> CarConcept by Eric Chadwick / Darmstadt Graphics Group GmbH, licensed
> CC BY 4.0, from the Khronos glTF Sample Assets repository.

That licence explicitly excludes logos and trademarks, so the Khronos steering
emblem and the licence plate are stripped at load. Full manifest, including
verified triangle/joint/clip counts and the list of rejected candidates, is in
[`ASSETS.md`](./ASSETS.md). In-game credits are on the start screen under
**Credits & asset licences**.

Every other vehicle in the city — the eight body classes and the police
cruiser — is **procedural geometry generated at runtime** from original
silhouettes built out of generic body types. Nothing is downloaded and nothing
reproduces a real manufacturer's bodywork, badging or model name; the in-world
names (Marlin 400, Tarpon GT, Hauler 2500, Kestrel 650 and so on) are invented
for this project.

This is an original work, not affiliated with or derived from any commercial
game. No assets were extracted from another game.

---

## Notes

- **`AGENTS.md` / `CLAUDE.md` are generated by `next dev`**, not hand-written.
  They tell coding agents to read the Next.js docs bundled at
  `node_modules/next/dist/docs/` before writing code. Deleting them just
  recreates them on the next dev run.
- Two real deprecations in this dependency set were hit and fixed:
  `THREE.PCFSoftShadowMap` was **removed** in three 0.186 (constants are now
  Basic/PCF/VSM only) — and R3F sets the shadow type itself from the `<Canvas
  shadows>` prop, so it has to be passed as `shadows="percentage"` rather than
  corrected in `onCreated`. three also now warns on any material parameter
  explicitly set to `undefined`.
- The project lives inside a OneDrive folder. OneDrive syncing `node_modules`
  and `.next` can cause slow builds and occasional file locks; excluding those
  folders from sync is worth doing. OneDrive also interferes with the dev
  server's file watcher: if an edit does not seem to take effect, restart
  `npm run dev`.
- Asset weight is over a sensible web budget: ~24 MB textures, 5.2 MB HDRI,
  11.8 MB car, 6.7 MB character ≈ **48 MB**. Downscaling, stripping the 38
  unused animation clips, and KTX2/Basis + Draco compression are outstanding
  work. Khronos publishes a 3.4 MB KTX-BasisU-Draco variant of the car that
  would need `KTX2Loader` plus a Draco decoder wired in.
