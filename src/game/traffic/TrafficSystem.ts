import type Rapier from '@dimforge/rapier3d-compat';
import type { Collider, RigidBody, World } from '@dimforge/rapier3d-compat';
import { getLaneNetwork, sampleLane, type RoutableLane, type Turn } from '../world/laneNetwork';
import { getRoadGraph } from '../world/roadGraph';
import { TRAFFIC } from '../config/traffic';
import { makeRng, hashSeed, type Rng } from '../core/rng';
import { sim } from '../core/sim';
import { axisOf, mayEnter, signalAt } from '../world/trafficSignals';
import { VEHICLE_KEYS, VEHICLE_TYPES, pickVehicleKey, type VehicleKey } from '../world/vehicleGeometry';

/**
 * Lane-following traffic (spec 21).
 *
 * Each vehicle tracks its current lane, a chosen successor, a desired speed, a
 * following distance and the junction ahead. Agents are DYNAMIC bodies driven
 * by velocity rather than kinematic bodies teleported along a spline, so they
 * collide properly with the player, with props and with each other — and when
 * one is hit hard enough to leave its lane, steering stops and it behaves like
 * the loose object it now is.
 *
 * Runs on the fixed physics step, outside React.
 */

export interface TrafficAgent {
  id: number;
  body: RigidBody;
  collider: Collider;
  lane: RoutableLane;
  nextLane: RoutableLane | null;
  nextTurn: Turn;
  /** Position along the current lane, 0..1. */
  t: number;
  speed: number;
  desiredSpeed: number;
  colour: string;
  /** Body class: drives the mesh, the collider size and the mass. */
  kind: VehicleKey;
  /** > 0 while the agent is uncontrolled after a collision. */
  knockedFor: number;
  /** Cached world position, refreshed each step. */
  x: number;
  z: number;
  heading: number;
  braking: boolean;
  /** Grace period after a lane switch, during which lateral error is expected. */
  switchGrace: number;
}

const CAR_COLOURS = [
  '#b8453a', '#d8d5cf', '#2f3f52', '#7a8288', '#264a3d',
  '#c9b184', '#3b3f45', '#8c5a3c', '#5d6e84', '#a8aeb2',
  '#31506b', '#6e4a3a',
];

export class TrafficSystem {
  readonly agents: TrafficAgent[] = [];
  private world: World;
  private rapier: typeof Rapier;
  private rng: Rng;
  private nextId = 1;
  private spawnTimer = 0;
  private targetCount = 0;
  /** Junction centres, for occupancy checks. */
  private junctions: { x: number; z: number }[];
  /**
   * Junction reservations: index -> { agent id, seconds held }.
   *
   * One agent at a time crosses a junction. Without an explicit reservation,
   * "is anyone near the junction?" counts APPROACHING vehicles as occupants,
   * so two cars arriving together each wait for the other and both stop
   * forever. The held timer is the blockage recovery spec 21 asks for.
   */
  private reservations = new Map<number, { id: number; held: number }>();

  constructor(world: World, rapier: typeof Rapier, seed = hashSeed('palm-coast-traffic')) {
    this.world = world;
    this.rapier = rapier;
    this.rng = makeRng(seed);
    this.junctions = getRoadGraph().intersections.map((i) => ({ x: i.x, z: i.z }));
  }

  setTargetCount(n: number) {
    this.targetCount = n;
  }

  /** Remove every active vehicle, properly releasing its physics body. */
  removeAll() {
    for (let i = this.agents.length - 1; i >= 0; i--) this.remove(i);
  }

  dispose() {
    for (const a of this.agents) {
      try {
        this.world.removeRigidBody(a.body);
      } catch {
        /* world already gone */
      }
    }
    this.agents.length = 0;
  }

  // -------------------------------------------------------------- spawning

  private spawn(playerX: number, playerZ: number, playerHeading: number, playerSpeed: number) {
    const net = getLaneNetwork();
    const lanes = net.spawnable;
    if (lanes.length === 0) return;

    // Try a handful of candidates rather than scanning everything.
    for (let attempt = 0; attempt < 14; attempt++) {
      const lane = lanes[Math.floor(this.rng() * lanes.length)]!;
      const t = 0.12 + this.rng() * 0.7;
      sampleLane(lane, t, TMP);

      const dx = TMP.x - playerX;
      const dz = TMP.z - playerZ;
      const dist = Math.hypot(dx, dz);
      if (dist < TRAFFIC.spawnMinDistance || dist > TRAFFIC.spawnMaxDistance) continue;

      // Never drop a car into the player's path (spec 21).
      if (playerSpeed > 6) {
        const fx = Math.sin(playerHeading);
        const fz = Math.cos(playerHeading);
        const dot = (dx / dist) * fx + (dz / dist) * fz;
        if (dot > TRAFFIC.spawnAheadConeDot) continue;
      }

      // Do not spawn on top of another agent.
      if (this.agents.some((a) => Math.hypot(a.x - TMP.x, a.z - TMP.z) < 12)) continue;

      this.create(lane, t);
      return;
    }
  }

  private create(lane: RoutableLane, t: number) {
    const { rapier, world } = this;
    sampleLane(lane, t, TMP);

    const q = headingQuat(lane.heading);
    // Body class decides the mesh, the footprint and the mass.
    const kind = pickVehicleKey(this.rng(), VEHICLE_KEYS);
    const spec = VEHICLE_TYPES[kind];

    const body = world.createRigidBody(
      rapier.RigidBodyDesc.dynamic()
        .setTranslation(TMP.x, spec.height / 2 + 0.05, TMP.z)
        .setRotation(q)
        // Only yaw is free: a traffic car must never tip over on a kerb.
        .enabledRotations(false, true, false)
        .setLinearDamping(0.35)
        .setAngularDamping(3.5)
        .setAdditionalMass(spec.mass),
    );

    const collider = world.createCollider(
      rapier.ColliderDesc.cuboid(spec.width / 2, spec.height / 2, spec.length / 2)
        .setFriction(0.8)
        .setRestitution(0.05)
        .setDensity(0),
      body,
    );

    const factor =
      TRAFFIC.speedFactorMin + this.rng() * (TRAFFIC.speedFactorMax - TRAFFIC.speedFactorMin);

    const agent: TrafficAgent = {
      id: this.nextId++,
      body,
      collider,
      lane,
      nextLane: null,
      nextTurn: 'straight',
      t,
      speed: lane.speedLimit * factor * 0.6,
      desiredSpeed: lane.speedLimit * factor,
      colour: CAR_COLOURS[Math.floor(this.rng() * CAR_COLOURS.length)]!,
      kind,
      knockedFor: 0,
      x: TMP.x,
      z: TMP.z,
      heading: lane.heading,
      braking: false,
      switchGrace: 0,
    };
    this.chooseNextLane(agent);
    this.agents.push(agent);
  }

  private remove(index: number) {
    const a = this.agents[index];
    if (!a) return;
    try {
      this.world.removeRigidBody(a.body);
    } catch {
      /* already gone */
    }
    this.agents.splice(index, 1);
  }

  private chooseNextLane(agent: TrafficAgent) {
    const net = getLaneNetwork();
    const succ = agent.lane.successors;
    if (succ.length === 0) {
      agent.nextLane = null;
      return;
    }
    // Prefer going straight, so traffic reads as purposeful rather than random.
    const weights = succ.map((s) => (s.turn === 'straight' ? 3 : s.turn === 'uturn' ? 0.2 : 1));
    const total = weights.reduce((a, b) => a + b, 0);
    let roll = this.rng() * total;
    let picked = succ[0]!;
    for (let i = 0; i < succ.length; i++) {
      roll -= weights[i]!;
      if (roll <= 0) {
        picked = succ[i]!;
        break;
      }
    }
    agent.nextLane = net.byId.get(picked.laneId) ?? null;
    agent.nextTurn = picked.turn;
  }

  // ---------------------------------------------------------------- update

  update(dt: number) {
    const px = sim.player.position.x;
    const pz = sim.player.position.z;
    const playerHeading = sim.controlMode === 'vehicle' ? sim.vehicle.heading : sim.player.heading;
    const playerSpeed =
      sim.controlMode === 'vehicle' ? Math.abs(sim.vehicle.forwardSpeed) : sim.player.speed;

    // --- population management ---
    this.spawnTimer += dt;
    if (this.spawnTimer >= TRAFFIC.spawnInterval) {
      this.spawnTimer = 0;
      if (this.agents.length < this.targetCount) {
        this.spawn(px, pz, playerHeading, playerSpeed);
      }
    }

    this.updateReservations(dt);

    for (let i = this.agents.length - 1; i >= 0; i--) {
      const a = this.agents[i]!;
      const pos = a.body.translation();
      a.x = pos.x;
      a.z = pos.z;

      const dist = Math.hypot(a.x - px, a.z - pz);
      if (dist > TRAFFIC.despawnDistance || this.agents.length > this.targetCount + 2) {
        if (dist > TRAFFIC.despawnDistance) {
          this.remove(i);
          continue;
        }
      }

      // Fell off the world, or was thrown somewhere silly.
      if (pos.y < -8 || pos.y > 12) {
        this.remove(i);
        continue;
      }

      this.updateAgent(a, dt);
    }
  }

  private updateAgent(a: TrafficAgent, dt: number) {
    if (a.switchGrace > 0) a.switchGrace -= dt;

    /*
     * Keep `t` synced to where the body ACTUALLY is, rather than integrating it
     * independently. An independently integrated parameter runs ahead of a body
     * that is still accelerating, and the resulting longitudinal gap was being
     * misread as "this car has been knocked out of its lane" - which flagged
     * every vehicle in normal traffic.
     *
     * Advancement onto the next lane is likewise driven by the body passing the
     * lane end, so the visual car and its routing can never disagree.
     */
    let s = projectAlong(a.lane, a.x, a.z);
    let guard = 0;
    while (s >= 1 && guard++ < 4) {
      const next = a.nextLane;
      if (!next) {
        s = 0.999;
        break;
      }
      a.lane = next;
      this.chooseNextLane(a);
      a.switchGrace = 0.9;
      s = projectAlong(a.lane, a.x, a.z);
    }
    a.t = clamp(s, 0, 0.999);

    // --- knocked out of lane? LATERAL deviation only ---
    const lateralErr = lateralOffset(a.lane, a.x, a.z);
    if (lateralErr > TRAFFIC.knockedDistance && a.switchGrace <= 0) {
      a.knockedFor = TRAFFIC.knockedRecovery;
    }

    if (a.knockedFor > 0) {
      a.knockedFor -= dt;
      // Let physics own it entirely; just read back its heading for rendering.
      const r = a.body.rotation();
      a.heading = quatHeading(r);
      a.braking = false;
      if (a.knockedFor <= 0) {
        // Re-acquire the nearest point on the lane rather than snapping.
        a.t = clamp(projectAlong(a.lane, a.x, a.z), 0, 0.999);
        a.speed = 0;
        a.switchGrace = 1.2;
      }
      return;
    }

    // --- look ahead for obstacles (spec 21) ---
    const gapNeeded = TRAFFIC.minGap + a.speed * TRAFFIC.headway;
    let closestGap: number = TRAFFIC.lookahead;

    const fx = Math.sin(a.lane.heading);
    const fz = Math.cos(a.lane.heading);

    // Other traffic.
    for (const b of this.agents) {
      if (b === a) continue;
      const rx = b.x - a.x;
      const rz = b.z - a.z;
      const along = rx * fx + rz * fz;
      if (along <= 0 || along > TRAFFIC.lookahead) continue;
      const lateral = Math.abs(rx * -fz + rz * fx);
      if (lateral > 2.4) continue;
      closestGap = Math.min(closestGap, along - TRAFFIC.length);
    }

    /*
     * Both the character AND the hero car are obstacles, independently.
     *
     * Checking only "wherever the player currently is" meant a parked hero car
     * abandoned in a lane was invisible to traffic, which then drove into it.
     * The car is a real object whether or not anyone is sitting in it.
     */
    const consider = (ox: number, oz: number, halfLength: number, halfWidth: number) => {
      const rx = ox - a.x;
      const rz = oz - a.z;
      const along = rx * fx + rz * fz;
      if (along <= 0 || along > TRAFFIC.lookahead) return;
      const lateral = Math.abs(rx * -fz + rz * fx);
      if (lateral > halfWidth) return;
      closestGap = Math.min(closestGap, along - halfLength);
    };
    consider(sim.vehicle.position.x, sim.vehicle.position.z, TRAFFIC.length * 0.6, 2.7);
    consider(sim.player.position.x, sim.player.position.z, 1.2, 1.8);

    // --- junction handling: signals first, then give-way (spec 21) ---
    const distToEnd = (1 - a.t) * a.lane.length;
    let junctionLimit = Infinity;
    if (a.lane.endsAtJunction && distToEnd < TRAFFIC.junctionApproach) {
      // A signalised junction is governed by its lights, and the give-way
      // reservation below does not apply: the signal already guarantees only
      // one axis is moving, and making cars also queue for a reservation on
      // green left whole green phases unused.
      const signal = signalAt(a.lane.bx, a.lane.bz, TRAFFIC.junctionRadius);
      if (signal) {
        const axis = axisOf(a.lane.dx, a.lane.dz);
        const stopLine = Math.max(0, distToEnd - signal.half);
        if (!mayEnter(signal, sim.elapsed, axis, stopLine, a.speed)) {
          junctionLimit = stopLine < 1.5 ? 0 : a.lane.speedLimit * 0.25;
          if (stopLine < 0.6) junctionLimit = 0;
        } else {
          junctionLimit = a.lane.speedLimit * TRAFFIC.junctionSpeedFactor;
        }
      } else {
        // Unsignalised: fall back to the one-at-a-time give-way reservation.
        junctionLimit = this.giveWayLimit(a, distToEnd);
      }
    }

    // --- target speed ---
    let target = Math.min(a.desiredSpeed, junctionLimit);
    if (closestGap < gapNeeded) {
      // Scale down smoothly, to a full stop when the gap closes completely.
      const ratio = Math.max(0, closestGap / Math.max(gapNeeded, 0.001));
      target = Math.min(target, a.desiredSpeed * ratio * ratio);
    }
    if (closestGap < TRAFFIC.minGap * 0.55) target = 0;

    const rate =
      target < a.speed
        ? closestGap < TRAFFIC.minGap ? TRAFFIC.hardBrake : TRAFFIC.brake
        : TRAFFIC.accel;
    a.braking = target < a.speed - 0.2;
    a.speed += Math.sign(target - a.speed) * Math.min(rate * dt, Math.abs(target - a.speed));
    if (a.speed < 0) a.speed = 0;

    // --- drive the body toward a point a little way down the lane ---
    // Aiming ahead rather than at the current projection keeps the steering
    // smooth through corners instead of chasing the car's own position.
    const aim = Math.min(0.999, a.t + Math.max(2.5, a.speed * 0.45) / a.lane.length);
    sampleLane(a.lane, aim, TMP);
    const vel = a.body.linvel();
    const desiredHeading = a.lane.heading;

    // Steer: correct lateral error as well as follow the lane direction, so an
    // agent nudged sideways eases back instead of driving parallel to its lane.
    const ex = TMP.x - a.x;
    const ez = TMP.z - a.z;
    const dirX = Math.sin(desiredHeading) + ex * 0.9;
    const dirZ = Math.cos(desiredHeading) + ez * 0.9;
    const dl = Math.hypot(dirX, dirZ) || 1;

    a.body.setLinvel(
      { x: (dirX / dl) * a.speed, y: vel.y, z: (dirZ / dl) * a.speed },
      true,
    );

    // Rotate toward the lane heading.
    const r = a.body.rotation();
    const current = quatHeading(r);
    let diff = desiredHeading - current;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    a.body.setAngvel({ x: 0, y: clamp(diff * 4, -TRAFFIC.turnRate, TRAFFIC.turnRate), z: 0 }, true);
    a.heading = current;
  }

  /**
   * Give-way limit at an UNSIGNALISED junction: one vehicle crosses at a time.
   *
   * Without an explicit reservation, "is anyone near the junction?" counts
   * approaching vehicles as occupants and every direction waits for every
   * other, which deadlocks.
   */
  private giveWayLimit(a: TrafficAgent, distToEnd: number): number {
    const jIdx = this.junctionIndexAt(a.lane.bx, a.lane.bz);
    if (jIdx < 0) return Infinity;

    const held = this.reservations.get(jIdx);
    if (!held || held.id === a.id) {
      this.reservations.set(jIdx, { id: a.id, held: 0 });
      return a.lane.speedLimit * TRAFFIC.junctionSpeedFactor;
    }
    // Straight-on traffic has priority over turners, so a turner waits back.
    const stopLine = a.nextTurn === 'straight' ? 5 : 7.5;
    return distToEnd < stopLine ? 0 : a.lane.speedLimit * 0.3;
  }

  private junctionIndexAt(x: number, z: number) {
    for (let i = 0; i < this.junctions.length; i++) {
      const j = this.junctions[i]!;
      if (Math.hypot(j.x - x, j.z - z) < TRAFFIC.junctionRadius) return i;
    }
    return -1;
  }

  /**
   * Release junction reservations once the holder has cleared, or has held one
   * too long (it was destroyed, knocked aside, or is otherwise stuck).
   */
  private updateReservations(dt: number) {
    for (const [idx, res] of this.reservations) {
      const holder = this.agents.find((a) => a.id === res.id);
      const jn = this.junctions[idx]!;
      if (!holder) {
        this.reservations.delete(idx);
        continue;
      }
      res.held += dt;
      const cleared = Math.hypot(holder.x - jn.x, holder.z - jn.z) > TRAFFIC.junctionRadius + 2;
      // A held-too-long reservation is released so the junction cannot lock up.
      if ((cleared && res.held > 0.4) || res.held > 8) this.reservations.delete(idx);
    }
  }
}

// ------------------------------------------------------------------ helpers

const TMP = { x: 0, z: 0 };

function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Heading -> quaternion, matching the vehicle's facing convention. */
function headingQuat(heading: number) {
  const half = (heading + Math.PI) / 2;
  return { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) };
}

/** Extract the facing heading from a body rotation (yaw only). */
function quatHeading(r: { x: number; y: number; z: number; w: number }) {
  // Rotate (0,0,-1) by r and take atan2(x, z).
  const x = 2 * (r.x * r.z + r.w * r.y);
  const z = 1 - 2 * (r.x * r.x + r.y * r.y);
  return Math.atan2(-x, -z);
}

/**
 * Parameter along a lane for a world point, NOT clamped: a value >= 1 means the
 * body has driven past the end of this lane and should move on to the next.
 */
function projectAlong(lane: RoutableLane, x: number, z: number) {
  const vx = lane.bx - lane.ax;
  const vz = lane.bz - lane.az;
  const len2 = vx * vx + vz * vz;
  if (len2 === 0) return 0;
  return ((x - lane.ax) * vx + (z - lane.az) * vz) / len2;
}

/** Perpendicular distance from a world point to a lane's centreline. */
function lateralOffset(lane: RoutableLane, x: number, z: number) {
  return Math.abs((x - lane.ax) * -lane.dz + (z - lane.az) * lane.dx);
}
