# NEO TOKYO — asset manifest

Every third-party asset used in this project, its source, its licence, and what
was changed. Required by the project brief (§6).

**NEO TOKYO is an original work.** It is not affiliated with, endorsed by, or
derived from any commercial game. No assets were extracted from another game.
The reference screenshots supplied at the start of the project were used only as
**art direction** — for composition, scale, material feel and camera framing.
No logo, sign, brand, character, vehicle or interface element from them has been
reproduced.

Binaries are **not** committed. Regenerate them with:

```bash
npm run assets
```

That script only downloads from URLs that were verified to return the file with
no login. A machine-readable copy of this table is written to
`public/assets-manifest.json`.

---
## Vehicles other than the hero car — no third-party assets

Every vehicle in Neo Tokyo except the player's hero car is **procedural
geometry generated at runtime** by `src/game/world/vehicleGeometry.ts`. Nothing
is downloaded, nothing is imported, and there is no licence to satisfy:

| In-world name | Body class | Source |
|---|---|---|
| Marlin 400 | saloon | procedural, original |
| Pebble | hatchback | procedural, original |
| Tarpon GT | coupe | procedural, original |
| Ridgeline Sierra | SUV | procedural, original |
| Hauler 2500 | pickup | procedural, original |
| Courier LWB | van | procedural, original |
| Kestrel 650 | motorcycle | procedural, original |
| Wasp 125 | scooter | procedural, original |
| Neo Tokyo PD Cruiser | saloon in livery | procedural, original |

The silhouettes are built from generic body types (three-box saloon, fastback
coupe, one-box van, cab-and-bed pickup, step-through scooter). They do not
reproduce any real manufacturer's bodywork, badging, grille signature or model
name, and the names above are invented for this project.

## Character rig and animation

| Field | Value |
|---|---|
| Asset | Universal Animation Library (Standard) |
| Author | Quaternius (@quaternius) |
| Licence | **CC0 1.0 Universal** (public domain dedication) |
| Licence URL | https://creativecommons.org/publicdomain/zero/1.0/ |
| Source page | https://opengameart.org/content/universal-animation-library |
| Download | Plain GET, no account. Uploaded by the rights holder themselves. |
| Local path | `public/models/vendor/character_anims.glb` |
| Licence copy | `public/models/vendor/quaternius_LICENSE.txt` |
| Attribution required | No (CC0). Credited anyway, in-game under Credits. |

**Verified by parsing the GLB, not assumed:**

- 1 skinned mesh, 1 skin, **53 joints**, Blender Rigify `DEF-*` naming
  (`root`, `DEF-hips`, `DEF-spine.001`, …).
- **13,744 triangles**, 2 materials, **0 embedded images**.
- **46 animation clips**, including every clip this game needs:
  `Idle_Loop`, `Walk_Loop`, `Jog_Fwd_Loop`, `Sprint_Loop`,
  `Jump_Start` / `Jump_Loop` / `Jump_Land`, `Interact`,
  `Sitting_Enter` / `Sitting_Idle_Loop` / `Sitting_Exit`, `Driving_Loop`.

**Modifications:** extracted the Godot GLB from the distributed archive and
renamed it. Materials are replaced at runtime (the source has none). No
geometry or skeleton changes.

> ### ⚠️ Licence status changed upstream
> The copy in this repository ships a `License.txt` reading verbatim
> "CC0 1.0 Universal (CC0 1.0) Public Domain Dedication", and CC0 is
> irrevocable for copies already distributed under it. However,
> quaternius.com now serves a "Quaternius Asset License (QAL) v1.0" instead,
> which permits commercial use without credit but forbids redistributing the
> assets "as a standalone asset, asset pack, stock file, template, or similar
> product". This project does not do that, so either licence permits this use —
> but do not re-download and assume CC0.

> ### ⚠️ The body is a placeholder
> This asset ships an **untextured articulated mannequin**, not a finished
> character. It is styled in-game as a deliberate two-tone dummy rather than
> dressed up as a photoreal human. Replacing it with a textured, clothed
> civilian is outstanding work, not a finished feature.

### Rejected character candidates, and why

Recorded so the decision is auditable rather than repeated.

| Candidate | Verdict | Reason |
|---|---|---|
| three.js `Soldier.glb` | **Rejected — licence** | Technically the best fit (11,376 tris, textured, Mixamo rig, Idle/Run/Walk). But it is Mixamo content redistributed in the three.js repo with **no asset-level grant**. The repo's MIT licence covers "the Software" (the library). Six probe paths for a per-model licence all returned 404; the only attribution is an inline HTML credit in an example page, which grants nothing. |
| three.js `Xbot.glb` | Rejected | Same licence problem, plus 0 textures and 49,112 triangles. |
| Khronos `CesiumMan` | Rejected | Clean CC-BY-4.0, but one *unnamed* clip (no idle, no run), 19 non-standard joints, and a Cesium logo the licence explicitly does not grant. |
| Khronos `RiggedFigure` | Rejected | 256 triangles, untextured, one unnamed clip. |
| Khronos `BrainStem` | Rejected | Listed under a proprietary "Poser EULA". |
| Kenney Blocky Characters | Rejected | `skins=0` — **not skinned at all**; rigid detached limbs, 72 tris. |
| Kenney Animated Protagonists | Rejected | FBX only (needs conversion) and has **no walk clip**. |
| GDQuest "Sophia" | Rejected — licence | Upstream relicensed art to **CC-BY-NC-SA 4.0**. NonCommercial + ShareAlike. |
| Mixamo | **Blocked** | Requires an Adobe account. No credential-free path exists. |
| Sketchfab | **Blocked** | Download API documentation requires an authenticated account even for CC0 models. |
| Ready Player Me | **Unverified** | DNS did not resolve from this machine; no status code observed, so no candidate is claimed. |
| Quaternius Universal Base Characters (textured) | **Blocked** | CC0, and the natural fix for the placeholder body — but its only download route is a CSRF-gated itch.io page. A human can grab it in about a minute; a script cannot. |

---

## Hero vehicle — ⚠️ ATTRIBUTION REQUIRED

| Field | Value |
|---|---|
| Asset | CarConcept |
| Author | Eric Chadwick / Darmstadt Graphics Group GmbH |
| Licence | **CC BY 4.0** — *this one is not CC0; attribution is mandatory* |
| Licence URL | https://creativecommons.org/licenses/by/4.0/ |
| Source page | https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/CarConcept |
| Local path | `public/models/vendor/hero_car.glb` (11.78 MB) |
| Licence copy | `public/models/vendor/hero_car_LICENSE.md` |

**Required attribution string** (shown in-game under Credits):

> CarConcept by Eric Chadwick / Darmstadt Graphics Group GmbH, licensed CC BY 4.0,
> from the Khronos glTF Sample Assets repository.

**Verified by parsing the GLB:**

- 101 nodes, 97 meshes, 29 materials, 14 textures.
- Four real wheel pivots — `WheelFrontL/R`, `WheelRearL/R` — each mesh-less with
  four children (rim, tyre, brake pad, brake disc).
- **Measured** geometry, which the physics config uses directly rather than
  estimating: wheelbase **2.800 m**, track **1.952 m**, hub height **0.384 m**.
- A genuinely modelled cabin: dash, seats, pedals with arms, mirrors, wipers,
  and a steering wheel at **x ≈ 0** — it is a centre-drive concept car, which is
  why the cockpit camera sits on the centreline.
- Extensions: `KHR_materials_clearcoat`, `emissive_strength`, `iridescence`,
  `transmission`, `variants`, `texture_transform`.

### ⚠️ Licence carve-out, and what we do about it

The LICENSE.md ends with: *"This license excludes logos and associated
trademarks."* The Khronos branding is licensed only as "Khronos Trademark or
Logo", **not** under CC BY. Two pieces of geometry are affected, and both are
**hidden at load** in `src/game/vehicle/HeroVehicle.tsx`:

- node `InteriorSteeringEmblem`
- node `License Plate` (and anything using material `License`)

### Other modifications

- The `Glass` material uses `KHR_materials_transmission`, and three.js renders a
  full extra scene pass per frame for transmission. Measured in-browser: it cost
  roughly **half the frame rate (22.8 → 60.1 fps)**. It is replaced at load with
  alpha-blended `MeshStandardMaterial`.
- Interior meshes have `castShadow` disabled — they add nothing to the
  silhouette and would double the car's shadow-pass cost.
- Wheels are re-parented into fresh pivots, because the GLB's wheel nodes carry
  baked matrices with arbitrary per-wheel rotations.

### Rejected vehicle candidates

| Candidate | Verdict | Reason |
|---|---|---|
| three.js `ferrari.glb` | **Rejected — licence** | Best-shaped asset found (separate wheel nodes, real interior, dedicated steering wheel), but the same unresolved Mixamo-style provenance as `Soldier.glb`: no per-asset grant. Also a real automaker marque, so trademark/design-right exposure. |
| Kenney Car Kit | Fallback only | CC0 and structurally correct (`body`, `wheel-front-left`, …) across all 50 GLBs — but flatly stylised and **no interior**, so it cannot carry a cockpit camera. Good future source for traffic/AI cars. |
| Khronos `ToyCar` | Rejected | 11 nodes, 3 meshes, zero wheel-named nodes, no interior. |
| Khronos `CesiumMilkTruck` | Rejected | One wheel mesh instanced twice plus a canned "Wheels" clip — not four addressable pivots. |
| Poly Haven models | Dead end | The API returns 521 models with **no** automotive category; only `covered_car`, `old_tyre` and two rusted rims. |

**Honest limitation:** the brief asked for an older red **convertible** (ref 1,
ref 3). No free candidate is a convertible — CarConcept has a fixed
`BodyRoofPanel`, verified. It is a modern concept car, not a 1970s muscle car.
It is painted red to match the references.

---

## Environment lighting and sky

| Field | Value |
|---|---|
| Asset | `aristea_wreck_puresky` (2K HDR) |
| Author | Poly Haven |
| Licence | **CC0 1.0 Universal** |
| Licence URL | https://polyhaven.com/license |
| Source page | https://polyhaven.com/a/aristea_wreck_puresky |
| Local path | `public/hdri/vendor/sky_midday.hdr` (5.2 MB) |
| Used for | Skybox **and** image-based lighting |
| Modifications | None — 2K HDR exactly as published |

Chosen because it is midday, partly cloudy, medium contrast — the big cumulus
and deep blue of the reference frames.

---

## Surface materials (PBR)

All from **ambientCG** (Lennart Demes), all **CC0 1.0**.
Licence: https://docs.ambientcg.com/license/

| Local key | ambientCG ID | Used for | Maps kept |
|---|---|---|---|
| `asphalt` | Asphalt033 | Carriageway | colour, normal, roughness, AO |
| `concrete` | Concrete034 | Sidewalks, kerbs, forecourt | colour, normal, roughness |
| `plaster` | PaintedPlaster017 | Painted-block facades | colour, normal, roughness |
| `brick` | Bricks104 | Older commercial frontages | colour, normal, roughness, AO |
| `grass` | Grass004 | Verges and open ground | colour, normal, roughness, AO |
| `corrugated` | CorrugatedSteel005 | Industrial sheds, fencing | colour, normal, roughness, AO |
| `dirt` | Ground037 | Worn ground | colour, normal, roughness, AO |
| `sand` | Ground054 | Beach along Vista del Mar | colour, normal, roughness, AO |

Source pages follow the pattern `https://ambientcg.com/view?id=<ID>`.

**Modifications:** downloaded as `<ID>_1K-JPG.zip`, Displacement map discarded,
remaining files renamed to `<key>_<channel>.jpg`. Note that Concrete034 and
PaintedPlaster017 genuinely ship **no** AmbientOcclusion map — the runtime reads
`assets-manifest.json` to know which channels exist rather than requesting files
that are not there.

Total downloaded weight: **~24 MB** of textures + **5.2 MB** HDRI.
This is over budget for web delivery and is flagged as outstanding work
(downscale to 512px where it is not noticeable, and convert to KTX2/Basis).

---

## Audio — synthesised, not sampled

There is **no audio asset in this project**. The engine note, tyre roll/slip
noise and horn are generated at runtime with the Web Audio API in
`src/game/audio/AudioSystem.ts`, driven by the vehicle's real `rpm01` and
speed.

This was a deliberate choice, not an oversight: no engine recording was found
that is simultaneously (a) licensed for redistribution inside a packaged
downloadable product and (b) obtainable without an account. Freesound requires
an API key; several "free" libraries forbid redistribution inside a product.
Rather than ship an unlicensed sample or claim audio that does not exist, the
sound is synthesised.

**Not implemented:** footsteps, collision impacts, doors, world ambience,
sirens, weather audio, music.

---

## Authored in-project (no external source)

These are generated in code and have no third-party licence:

- All road, kerb, sidewalk, lane-marking and crosswalk geometry — generated from
  the road graph in `src/game/world/buildCity.ts`.
- All buildings, the gas station, the water tower, the boundary hoarding.
- All street props: streetlights, utility poles, bins, benches, hydrants,
  bollards, cones, rooftop AC units, parked cars (`src/game/world/propGeometry.ts`).
- Palms and shrubs.
- The minimap, all HUD and menu artwork, the favicon.
- Business names, street names and the district name.

---

## Libraries

| Library | Licence |
|---|---|
| three.js | MIT |
| @react-three/fiber, @react-three/drei | MIT |
| @react-three/rapier | MIT |
| @dimforge/rapier3d-compat | Apache-2.0 |
| Next.js | MIT |
| React | MIT |
| Zustand | MIT |
| puppeteer-core (dev only) | Apache-2.0 |

---

## Redistribution note

CC0 assets carry no attribution requirement and may be packaged into a web
build. They are credited in-game regardless, under **Credits & asset licences**
on the start screen. This project does not redistribute any source asset as a
standalone asset pack.
