import type Rapier from '@dimforge/rapier3d-compat';
import type { Collider, RigidBody, World } from '@dimforge/rapier3d-compat';
import { getLaneNetwork, type RoutableLane } from '../world/laneNetwork';
import { POLICE } from '../config/police';
import { TRAFFIC } from '../config/traffic';
import { makeRng, hashSeed, type Rng } from '../core/rng';
import { sim } from '../core/sim';
import { POLICE_SPEC } from '../world/vehicleGeometry';
import { audio } from '../audio/AudioSystem';

/**
 * Police and wanted system (spec 23).
 *
 * A real state machine:
 *
 *   unaware -> responding -> pursuing -> searching -> cooling -> unaware
 *
 * Detection depends on an officer actually SEEING the player: a raycast through
 * the world, inside a forward sight cone, within range. Losing line of sight
 * does not teleport that knowledge to the rest of the force — units fall back
 * to the last position anybody actually saw, and search around it. Police never
 * read the player's exact position through a building.
 */

export type PoliceState = 'unaware' | 'responding' | 'pursuing' | 'searching' | 'cooling' | 'busted';

export interface PoliceUnit {
  id: number;
  body: RigidBody;
  collider: Collider;
  lane: RoutableLane;
  t: number;
  speed: number;
  x: number;
  z: number;
  heading: number;
  /** Seconds this unit has continuously held line of sight. */
  sightFor: number;
  hasSight: boolean;
  /** Seconds spent inside arrest range of a slow player on foot. */
  arrestFor: number;
  switchGrace: number;
}

export class PoliceSystem {
  readonly units: PoliceUnit[] = [];
  private world: World;
  private rapier: typeof Rapier;
  private rng: Rng;
  private nextId = 1;

  state: PoliceState = 'unaware';
  wanted = 0;
  /** The last position anyone actually observed the player at. */
  lastKnown = { x: 0, z: 0, valid: false };

  private stateTimer = 0;
  private sinceSight = 0;
  private dispatchTimer = 0;
  private escalationLock = 0;
  private enabled = true;

  constructor(world: World, rapier: typeof Rapier, seed = hashSeed('palm-coast-police')) {
    this.world = world;
    this.rapier = rapier;
    this.rng = makeRng(seed);
  }

  setEnabled(v: boolean) {
    this.enabled = v;
    if (!v) this.clear();
  }

  dispose() {
    for (const u of this.units) {
      try {
        this.world.removeRigidBody(u.body);
      } catch {
        /* world already gone */
      }
    }
    this.units.length = 0;
  }

  // ------------------------------------------------------------- offences

  /**
   * Report an offence. It only counts if somebody saw it: an officer with line
   * of sight, or a civilian witness close enough to notice (spec 23).
   */
  reportOffence(kind: keyof typeof POLICE.offence, witnessed: boolean, x: number, z: number) {
    if (!this.enabled) return;
    if (this.escalationLock > 0) return;
    if (!witnessed && this.state === 'unaware') return;

    const level = POLICE.offence[kind];
    const next = Math.min(POLICE.maxWanted, Math.max(this.wanted, level));
    if (next <= this.wanted && this.state !== 'unaware') return;

    this.wanted = next;
    this.escalationLock = POLICE.escalationCooldown;
    this.lastKnown = { x, z, valid: true };
    if (this.state === 'unaware' || this.state === 'cooling') {
      this.state = 'responding';
      this.stateTimer = 0;
      this.dispatchTimer = POLICE.dispatchInterval; // dispatch the first unit at once
    }
  }

  /**
   * Put the player at a wanted level directly, bypassing the "did anyone see
   * it" rule (spec 24).
   *
   * Used by missions that begin with the police already looking for you - the
   * offence happened off-screen, before the mission started, so there is
   * nothing for a witness to have seen.
   */
  setWanted(level: number, x: number, z: number) {
    if (!this.enabled) return;
    this.wanted = Math.max(0, Math.min(POLICE.maxWanted, Math.round(level)));
    if (this.wanted === 0) {
      this.clear();
      return;
    }
    this.lastKnown = { x, z, valid: true };
    this.state = 'responding';
    this.stateTimer = 0;
    this.escalationLock = POLICE.escalationCooldown;
    this.dispatchTimer = POLICE.dispatchInterval;
  }

  clear() {
    this.wanted = 0;
    this.state = 'unaware';
    this.lastKnown.valid = false;
    this.sinceSight = 0;
    for (let i = this.units.length - 1; i >= 0; i--) this.removeUnit(i);
  }

  // --------------------------------------------------------------- update

  update(dt: number) {
    if (this.escalationLock > 0) this.escalationLock -= dt;

    const px = sim.controlMode === 'vehicle' ? sim.vehicle.position.x : sim.player.position.x;
    const pz = sim.controlMode === 'vehicle' ? sim.vehicle.position.z : sim.player.position.z;
    const py = sim.player.position.y + 1.2;

    // ---- per-unit sight, movement and arrest ----
    let anySight = false;
    for (let i = this.units.length - 1; i >= 0; i--) {
      const u = this.units[i]!;
      const t = u.body.translation();
      u.x = t.x;
      u.z = t.z;
      if (t.y < -8) {
        this.removeUnit(i);
        continue;
      }

      const sees = this.canSee(u, px, py, pz);
      u.hasSight = sees;
      u.sightFor = sees ? u.sightFor + dt : 0;
      if (sees && u.sightFor >= POLICE.sightConfirmTime) {
        anySight = true;
        this.lastKnown = { x: px, z: pz, valid: true };
      }

      this.driveUnit(u, dt);
      this.checkArrest(u, dt, px, pz);
    }

    // ---- state machine ----
    this.stateTimer += dt;
    switch (this.state) {
      case 'responding':
        this.dispatch(dt, px, pz);
        if (anySight) {
          this.state = 'pursuing';
          this.stateTimer = 0;
          this.sinceSight = 0;
        } else if (this.stateTimer >= POLICE.respondTimeout) {
          // Units arrived but never found anybody: fall back to sweeping the
          // reported area, which then cools down and clears normally.
          this.state = 'searching';
          this.stateTimer = 0;
        }
        break;

      case 'pursuing':
        this.dispatch(dt, px, pz);
        if (anySight) {
          this.sinceSight = 0;
        } else {
          this.sinceSight += dt;
          if (this.sinceSight >= POLICE.loseSightTime) {
            // Nobody can see the player any more: fall back to searching the
            // last place anyone actually saw them (spec 23).
            this.state = 'searching';
            this.stateTimer = 0;
          }
        }
        break;

      case 'searching':
        if (anySight) {
          this.state = 'pursuing';
          this.stateTimer = 0;
          this.sinceSight = 0;
        } else if (this.stateTimer >= POLICE.searchTime) {
          this.state = 'cooling';
          this.stateTimer = 0;
        }
        break;

      case 'cooling':
        if (anySight) {
          this.state = 'pursuing';
          this.stateTimer = 0;
          this.sinceSight = 0;
        } else if (this.stateTimer >= POLICE.cooldownTime) {
          this.clear();
        }
        break;

      default:
        break;
    }

    // Units stand down once the alert ends.
    if (this.state === 'unaware' && this.units.length > 0) {
      for (let i = this.units.length - 1; i >= 0; i--) this.removeUnit(i);
    }

    this.publish();
  }

  private publish() {
    sim.police.state = this.state;
    sim.police.wanted = this.wanted;
    sim.police.units = this.units.length;
    sim.police.hasSight = this.units.some((u) => u.hasSight);
    sim.police.lastKnownX = this.lastKnown.x;
    sim.police.lastKnownZ = this.lastKnown.z;
    sim.police.searchRemaining =
      this.state === 'searching' ? Math.max(0, POLICE.searchTime - this.stateTimer) : 0;
  }

  // --------------------------------------------------------------- sight

  /**
   * True when this officer can actually see the player: in range, inside the
   * forward sight cone, with an unobstructed raycast.
   */
  private canSee(u: PoliceUnit, px: number, py: number, pz: number): boolean {
    const dx = px - u.x;
    const dz = pz - u.z;
    const dist = Math.hypot(dx, dz);
    if (dist > POLICE.sightRange || dist < 0.01) return false;

    // Sight cone, centred on the way the car is facing.
    const fx = Math.sin(u.heading);
    const fz = Math.cos(u.heading);
    const dot = (dx / dist) * fx + (dz / dist) * fz;
    if (Math.acos(Math.max(-1, Math.min(1, dot))) > POLICE.sightFov / 2) return false;

    // Line of sight: anything solid between officer and player blocks it.
    const originY = 1.1;
    const dirY = (py - originY) / dist;
    const ray = new this.rapier.Ray(
      { x: u.x, y: originY, z: u.z },
      { x: dx / dist, y: dirY, z: dz / dist },
    );
    const hit = this.world.castRay(
      ray,
      dist,
      true,
      this.rapier.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      u.collider,
      u.body,
    );
    if (!hit) return true;
    // Something was hit before reaching the player: view is blocked.
    return hit.timeOfImpact >= dist - 2.0;
  }

  // ------------------------------------------------------------ dispatch

  private dispatch(dt: number, px: number, pz: number) {
    const want = POLICE.unitsPerLevel[Math.min(this.wanted, POLICE.maxWanted)] ?? 0;
    if (this.units.length >= want) return;

    this.dispatchTimer += dt;
    if (this.dispatchTimer < POLICE.dispatchInterval) return;
    this.dispatchTimer = 0;

    const net = getLaneNetwork();
    const lanes = net.spawnable;

    // Pick the lane that BUYS THE MOST GROUND, not just one pointing roughly
    // the right way.
    //
    // A unit may only change lane at a junction, so whichever lane it starts on
    // is committed to all the way to that lane's end. Checking only the
    // direction of travel at the spawn point is not enough: on this map a lane
    // can head toward the report, pass it, and carry on for another hundred
    // metres, which left responders further away than they started.
    //
    // So candidates are scored on how much closer the lane's END is to the
    // report than its spawn point - the distance the unit actually gains before
    // it gets its first choice of turn.
    let best: { lane: RoutableLane; t: number; x: number; z: number } | null = null;
    let bestGain = -Infinity;

    for (let attempt = 0; attempt < 48; attempt++) {
      const lane = lanes[Math.floor(this.rng() * lanes.length)]!;
      const t = 0.2 + this.rng() * 0.6;
      const x = lane.ax + (lane.bx - lane.ax) * t;
      const z = lane.az + (lane.bz - lane.az) * t;
      const d = Math.hypot(x - px, z - pz);
      // Units arrive from off-screen and drive in; they never appear on top of
      // the player (spec 23).
      if (d < POLICE.spawnMinDistance || d > POLICE.spawnMaxDistance) continue;

      const gain = d - Math.hypot(lane.bx - px, lane.bz - pz);
      if (gain > bestGain) {
        bestGain = gain;
        best = { lane, t, x, z };
      }
    }

    if (best) this.createUnit(best.lane, best.t, best.x, best.z);
  }

  private createUnit(lane: RoutableLane, t: number, x: number, z: number) {
    const { rapier, world } = this;
    const half = (lane.heading + Math.PI) / 2;

    const body = world.createRigidBody(
      rapier.RigidBodyDesc.dynamic()
        .setTranslation(x, POLICE_SPEC.height / 2 + 0.05, z)
        .setRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) })
        .enabledRotations(false, true, false)
        .setLinearDamping(0.3)
        .setAngularDamping(3.2)
        .setAdditionalMass(POLICE_SPEC.mass),
    );
    const collider = world.createCollider(
      rapier.ColliderDesc.cuboid(POLICE_SPEC.width / 2, POLICE_SPEC.height / 2, POLICE_SPEC.length / 2)
        .setFriction(0.8)
        .setRestitution(0.05)
        .setDensity(0),
      body,
    );

    this.units.push({
      id: this.nextId++,
      body,
      collider,
      lane,
      t,
      speed: lane.speedLimit,
      x,
      z,
      heading: lane.heading,
      sightFor: 0,
      hasSight: false,
      arrestFor: 0,
      switchGrace: 0,
    });
  }

  private removeUnit(i: number) {
    const u = this.units[i];
    if (!u) return;
    try {
      this.world.removeRigidBody(u.body);
    } catch {
      /* already gone */
    }
    this.units.splice(i, 1);
  }

  // ---------------------------------------------------------- unit driving

  /**
   * Drive a unit along the lane network toward its objective, choosing at each
   * junction the successor that gets it closest — a plausible road route rather
   * than a straight line through buildings (spec 23).
   */
  private driveUnit(u: PoliceUnit, dt: number) {
    const net = getLaneNetwork();
    if (u.switchGrace > 0) u.switchGrace -= dt;

    const goal = this.goalFor(u);

    // Advance along the lane, driven by the body's real position.
    let s = projectAlong(u.lane, u.x, u.z);
    let guard = 0;
    while (s >= 1 && guard++ < 4) {
      const best = this.bestSuccessor(u.lane, goal.x, goal.z, net);
      if (!best) {
        s = 0.999;
        break;
      }
      u.lane = best;
      u.switchGrace = 0.9;
      s = projectAlong(u.lane, u.x, u.z);
    }
    u.t = Math.max(0, Math.min(0.999, s));

    const factor =
      this.state === 'pursuing'
        ? POLICE.pursuitSpeedFactor
        : this.state === 'searching'
          ? POLICE.searchSpeedFactor
          : POLICE.respondSpeedFactor;
    const target = u.lane.speedLimit * factor;
    u.speed += Math.sign(target - u.speed) * Math.min(TRAFFIC.accel * 1.6 * dt, Math.abs(target - u.speed));

    // Aim a little way down the lane so corners are taken smoothly.
    const aim = Math.min(0.999, u.t + Math.max(3, u.speed * 0.45) / u.lane.length);
    const ax = u.lane.ax + (u.lane.bx - u.lane.ax) * aim;
    const az = u.lane.az + (u.lane.bz - u.lane.az) * aim;

    const dirX = Math.sin(u.lane.heading) + (ax - u.x) * 0.9;
    const dirZ = Math.cos(u.lane.heading) + (az - u.z) * 0.9;
    const dl = Math.hypot(dirX, dirZ) || 1;

    const vel = u.body.linvel();
    u.body.setLinvel({ x: (dirX / dl) * u.speed, y: vel.y, z: (dirZ / dl) * u.speed }, true);

    const r = u.body.rotation();
    const current = quatHeading(r);
    let diff = u.lane.heading - current;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    u.body.setAngvel({ x: 0, y: Math.max(-3, Math.min(3, diff * 4)), z: 0 }, true);
    u.heading = current;
  }

  /** Where this unit is trying to get to, given the current state. */
  private goalFor(u: PoliceUnit) {
    if (!this.lastKnown.valid) return { x: u.x, z: u.z };
    if (this.state === 'searching') {
      // Sweep around the last known point rather than parking on it.
      const angle = (u.id * 1.7 + this.stateTimer * 0.35) % (Math.PI * 2);
      return {
        x: this.lastKnown.x + Math.cos(angle) * POLICE.searchRadius * 0.6,
        z: this.lastKnown.z + Math.sin(angle) * POLICE.searchRadius * 0.6,
      };
    }
    return { x: this.lastKnown.x, z: this.lastKnown.z };
  }

  /**
   * Pick the successor lane that best advances toward the goal.
   *
   * Scored as "distance still to travel once this lane is done", i.e. the
   * lane's own length plus the straight-line distance left from its far end.
   * Ranking purely on the far end's distance makes a unit commit to a long
   * lane that happens to finish slightly nearer, which on a sparse road graph
   * means a whole block driven the wrong way.
   */
  private bestSuccessor(lane: RoutableLane, gx: number, gz: number, net: ReturnType<typeof getLaneNetwork>) {
    let best: RoutableLane | null = null;
    let bestCost = Infinity;
    for (const link of lane.successors) {
      const cand = net.byId.get(link.laneId);
      if (!cand) continue;
      const cost = cand.length + Math.hypot(cand.bx - gx, cand.bz - gz);
      if (cost < bestCost) {
        bestCost = cost;
        best = cand;
      }
    }
    return best;
  }

  // ----------------------------------------------------------- arrest

  private checkArrest(u: PoliceUnit, dt: number, px: number, pz: number) {
    const slow = sim.controlMode === 'vehicle' 
      ? Math.abs(sim.vehicle.speedKph) < POLICE.arrestSpeed * 3.6
      : sim.player.speed < POLICE.arrestSpeed;
    const close = Math.hypot(u.x - px, u.z - pz) < POLICE.arrestRange;

    if (slow && close && u.hasSight && this.state === 'pursuing') {
      u.arrestFor += dt;
      if (u.arrestFor >= POLICE.arrestHold) {
        this.state = 'busted';
        sim.police.state = 'busted';
        audio.playBustedSound();
      }
    } else {
      u.arrestFor = 0;
    }
  }
}

// ------------------------------------------------------------------ helpers

function projectAlong(lane: RoutableLane, x: number, z: number) {
  const vx = lane.bx - lane.ax;
  const vz = lane.bz - lane.az;
  const len2 = vx * vx + vz * vz;
  if (len2 === 0) return 0;
  return ((x - lane.ax) * vx + (z - lane.az) * vz) / len2;
}

function quatHeading(r: { x: number; y: number; z: number; w: number }) {
  const x = 2 * (r.x * r.z + r.w * r.y);
  const z = 1 - 2 * (r.x * r.x + r.y * r.y);
  return Math.atan2(-x, -z);
}
