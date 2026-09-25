import type Rapier from '@dimforge/rapier3d-compat';
import { makeOutfit, type Outfit } from '../character/outfits';
import type { Collider, RigidBody, World } from '@dimforge/rapier3d-compat';
import { getSidewalkNetwork, type WalkNode } from '../world/sidewalkNetwork';
import { PEDESTRIAN } from '../config/traffic';
import { CAPSULE } from '../config/character';
import { makeRng, hashSeed, type Rng } from '../core/rng';
import { sim } from '../core/sim';
import type { TrafficSystem } from './TrafficSystem';

/**
 * Pedestrians walking a sidewalk graph (spec 22).
 *
 * Each pedestrian holds a destination, a speed, an avoidance radius and a
 * perception range. They queue at kerbs before crossing, steer around each
 * other, and back off from vehicles that are both close and moving.
 *
 * Bodies are low-mass dynamic capsules with rotation locked to yaw: the player
 * bumps into them, a car shoves them aside rather than being stopped dead by
 * them, and nothing can tip over.
 *
 * Presentation is deliberately non-graphic (spec 25): a struck pedestrian
 * stumbles, stops steering, and is quietly removed.
 */

export type PedState = 'walk' | 'idle' | 'waitKerb' | 'alarmed' | 'knocked';

export interface Pedestrian {
  id: number;
  body: RigidBody;
  collider: Collider;
  /** Current and target node in the sidewalk network. */
  node: number;
  target: number;
  /** Where we came from, so we do not immediately turn back. */
  previous: number;
  state: PedState;
  stateTimer: number;
  speed: number;
  desiredSpeed: number;
  heading: number;
  x: number;
  z: number;
  /** Appearance variation. */
  scale: number;
  /** Clothing, generated from the seeded rng so a city seed dresses the same crowd. */
  outfit: Outfit;
  /** Phase offset so a crowd does not step in unison (spec 22). */
  animOffset: number;
  /** Throttles decision-making for distant pedestrians (spec 22, 34). */
  thinkTimer: number;
  knockedFor: number;
}

const TINTS = [
  '#d9d3c6', '#b8c0c6', '#c9b49a', '#9fae9a', '#c8a894',
  '#a8b4c2', '#cdbba6', '#8fa3ad', '#d2c2b0', '#b0a08e',
];

export class PedestrianSystem {
  readonly peds: Pedestrian[] = [];
  private world: World;
  private rapier: typeof Rapier;
  private rng: Rng;
  private nextId = 1;
  private spawnTimer = 0;
  private targetCount = 0;
  private nodes: WalkNode[];
  private traffic: TrafficSystem | null = null;

  constructor(world: World, rapier: typeof Rapier, seed = hashSeed('palm-coast-peds')) {
    this.world = world;
    this.rapier = rapier;
    this.rng = makeRng(seed);
    this.nodes = getSidewalkNetwork().nodes;
  }

  setTraffic(t: TrafficSystem | null) {
    this.traffic = t;
  }

  setTargetCount(n: number) {
    this.targetCount = n;
  }

  /** Remove every active pedestrian, properly releasing its physics body. */
  removeAll() {
    for (let i = this.peds.length - 1; i >= 0; i--) this.remove(i);
  }

  dispose() {
    for (const p of this.peds) {
      try {
        this.world.removeRigidBody(p.body);
      } catch {
        /* world already gone */
      }
    }
    this.peds.length = 0;
  }

  // -------------------------------------------------------------- spawning

  private spawn(px: number, pz: number) {
    const walkable = this.nodes.filter((n) => n.links.length > 0);
    if (walkable.length === 0) return;

    for (let attempt = 0; attempt < 16; attempt++) {
      const node = walkable[Math.floor(this.rng() * walkable.length)]!;
      const d = Math.hypot(node.x - px, node.z - pz);
      if (d < PEDESTRIAN.spawnMinDistance || d > PEDESTRIAN.spawnMaxDistance) continue;
      if (this.peds.some((p) => Math.hypot(p.x - node.x, p.z - node.z) < 3)) continue;
      this.create(node);
      return;
    }
  }

  private create(node: WalkNode) {
    const { rapier, world } = this;
    const scale = 0.92 + this.rng() * 0.16;

    const body = world.createRigidBody(
      rapier.RigidBodyDesc.dynamic()
        .setTranslation(node.x, CAPSULE.centreToFeet * scale + 0.25, node.z)
        // Yaw only: a pedestrian must never topple or roll.
        .enabledRotations(false, true, false)
        .setLinearDamping(1.2)
        .setAngularDamping(6)
        .setAdditionalMass(72),
    );

    const collider = world.createCollider(
      rapier.ColliderDesc.capsule(CAPSULE.halfHeight * scale, CAPSULE.radius * scale)
        .setFriction(0)
        .setRestitution(0)
        .setDensity(0),
      body,
    );

    const first = node.links[Math.floor(this.rng() * node.links.length)]!;
    const ped: Pedestrian = {
      id: this.nextId++,
      body,
      collider,
      node: node.id,
      target: first,
      previous: node.id,
      state: 'walk',
      stateTimer: 0,
      speed: 0,
      desiredSpeed:
        PEDESTRIAN.speedMin + this.rng() * (PEDESTRIAN.speedMax - PEDESTRIAN.speedMin),
      heading: 0,
      x: node.x,
      z: node.z,
      scale,
      outfit: makeOutfit(this.rng),
      animOffset: this.rng() * 4,
      thinkTimer: this.rng() * PEDESTRIAN.farUpdateInterval,
      knockedFor: 0,
    };
    this.peds.push(ped);
  }

  private remove(i: number) {
    const p = this.peds[i];
    if (!p) return;
    try {
      this.world.removeRigidBody(p.body);
    } catch {
      /* already gone */
    }
    this.peds.splice(i, 1);
  }

  // ---------------------------------------------------------------- update

  update(dt: number) {
    const px = sim.player.position.x;
    const pz = sim.player.position.z;

    this.spawnTimer += dt;
    if (this.spawnTimer >= PEDESTRIAN.spawnInterval) {
      this.spawnTimer = 0;
      if (this.peds.length < this.targetCount) this.spawn(px, pz);
    }

    for (let i = this.peds.length - 1; i >= 0; i--) {
      const p = this.peds[i]!;
      const t = p.body.translation();
      p.x = t.x;
      p.z = t.z;

      if (t.y < -6 || Math.hypot(p.x - px, p.z - pz) > PEDESTRIAN.despawnDistance) {
        this.remove(i);
        continue;
      }
      if (p.state === 'knocked' && p.knockedFor <= 0) {
        this.remove(i);
        continue;
      }

      this.updatePed(p, dt, px, pz);
    }

    sim.stats.pedestrianCount = this.peds.length;
  }

  private updatePed(p: Pedestrian, dt: number, px: number, pz: number) {
    // --- knocked over: hand it to physics, then quietly remove ---
    if (p.state === 'knocked') {
      p.knockedFor -= dt;
      return;
    }

    // Being flung well above walking pace means something hit them.
    const vel = p.body.linvel();
    if (Math.hypot(vel.x, vel.z) > p.desiredSpeed * 2.5 + 2.5) {
      this.knock(p);
      return;
    }

    const distToPlayer = Math.hypot(p.x - px, p.z - pz);
    // Distant pedestrians think less often (spec 22, 34).
    const near = distToPlayer < PEDESTRIAN.nearUpdateDistance;
    p.thinkTimer -= dt;
    const think = near || p.thinkTimer <= 0;
    if (think && !near) p.thinkTimer = PEDESTRIAN.farUpdateInterval;

    const targetNode = this.nodes[p.target];
    if (!targetNode) {
      p.state = 'idle';
      p.stateTimer = 1;
      return;
    }

    // --- danger check: a close, moving vehicle (spec 22) ---
    let danger = false;
    if (think) danger = this.vehicleThreat(p);

    if (danger) {
      p.state = 'alarmed';
      p.stateTimer = 0.9;
    } else if (p.state === 'alarmed') {
      p.stateTimer -= dt;
      if (p.stateTimer <= 0) p.state = 'walk';
    }

    // --- idle ---
    if (p.state === 'idle') {
      p.stateTimer -= dt;
      p.speed = 0;
      this.drive(p, 0, 0, dt);
      if (p.stateTimer <= 0) p.state = 'walk';
      return;
    }

    // --- waiting at a kerb before crossing ---
    if (p.state === 'waitKerb') {
      p.speed = 0;
      this.drive(p, 0, 0, dt);
      p.stateTimer -= dt;
      if (think && p.stateTimer <= 0) {
        if (this.crossingClear(targetNode)) p.state = 'walk';
        else p.stateTimer = 0.4;
      }
      return;
    }

    // --- arrived? pick the next waypoint ---
    const dx = targetNode.x - p.x;
    const dz = targetNode.z - p.z;
    const dist = Math.hypot(dx, dz);

    if (dist < 1.6) {
      p.previous = p.node;
      p.node = p.target;
      const next = this.chooseNext(p);
      p.target = next.id;

      // Stop at the kerb if the next leg crosses a road (spec 22).
      if (next.isCrossing && !this.crossingClear(this.nodes[next.id]!)) {
        p.state = 'waitKerb';
        p.stateTimer = 0.3;
        return;
      }
      if (this.rng() < PEDESTRIAN.idleChance) {
        p.state = 'idle';
        p.stateTimer =
          PEDESTRIAN.idleMin + this.rng() * (PEDESTRIAN.idleMax - PEDESTRIAN.idleMin);
        return;
      }
    }

    // --- steering: toward the waypoint, away from other pedestrians ---
    let sx = dist > 0.001 ? dx / dist : 0;
    let sz = dist > 0.001 ? dz / dist : 0;

    for (const q of this.peds) {
      if (q === p || q.state === 'knocked') continue;
      const ox = p.x - q.x;
      const oz = p.z - q.z;
      const od = Math.hypot(ox, oz);
      if (od > PEDESTRIAN.avoidRange || od < 0.001) continue;
      const push = (1 - od / PEDESTRIAN.avoidRange) * 1.4;
      sx += (ox / od) * push;
      sz += (oz / od) * push;
    }

    // Give the player personal space too, so a crowd never pins them in.
    if (distToPlayer < 1.8 && distToPlayer > 0.001) {
      sx += ((p.x - px) / distToPlayer) * 1.6;
      sz += ((p.z - pz) / distToPlayer) * 1.6;
    }

    const sl = Math.hypot(sx, sz) || 1;
    sx /= sl;
    sz /= sl;

    const target = p.state === 'alarmed' ? 0 : p.desiredSpeed;
    p.speed += Math.sign(target - p.speed) * Math.min(6 * dt, Math.abs(target - p.speed));
    if (p.speed < 0) p.speed = 0;

    this.drive(p, sx, sz, dt);
  }

  /** Apply the steering result to the body. */
  private drive(p: Pedestrian, sx: number, sz: number, dt: number) {
    const vel = p.body.linvel();
    p.body.setLinvel({ x: sx * p.speed, y: vel.y, z: sz * p.speed }, true);

    if (p.speed > 0.05) {
      const want = Math.atan2(sx, sz);
      let diff = want - p.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      p.heading += clamp(diff, -PEDESTRIAN.turnRate * dt, PEDESTRIAN.turnRate * dt);
      const half = p.heading / 2;
      p.body.setRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) }, true);
    }
    p.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  /** Pick the next waypoint, preferring not to double back. */
  private chooseNext(p: Pedestrian): { id: number; isCrossing: boolean } {
    const node = this.nodes[p.node]!;
    const options = node.links
      .map((id, i) => ({ id, isCrossing: node.crossing[i] ?? false }))
      .filter((o) => o.id !== p.previous);
    const pool = options.length > 0 ? options : node.links.map((id, i) => ({ id, isCrossing: node.crossing[i] ?? false }));
    return pool[Math.floor(this.rng() * pool.length)]!;
  }

  /** No traffic near enough to make stepping into the road unwise. */
  private crossingClear(node: WalkNode): boolean {
    const traffic = this.traffic;
    if (!traffic) return true;
    for (const a of traffic.agents) {
      const d = Math.hypot(a.x - node.x, a.z - node.z);
      const speed = Math.hypot(a.body.linvel().x, a.body.linvel().z);
      if (d < 16 && speed > 1.5) return false;
    }
    // The player's car counts too.
    const v = sim.vehicle;
    if (
      Math.abs(v.forwardSpeed) > 2 &&
      Math.hypot(v.position.x - node.x, v.position.z - node.z) < 18
    ) {
      return false;
    }
    return true;
  }

  /** A vehicle that is both close and moving toward this pedestrian. */
  private vehicleThreat(p: Pedestrian): boolean {
    const check = (vx: number, vz: number, speed: number) => {
      if (speed < PEDESTRIAN.vehicleAlarmSpeed) return false;
      return Math.hypot(vx - p.x, vz - p.z) < PEDESTRIAN.vehicleAlarmRange;
    };

    if (check(sim.vehicle.position.x, sim.vehicle.position.z, Math.abs(sim.vehicle.forwardSpeed))) {
      return true;
    }
    const traffic = this.traffic;
    if (traffic) {
      for (const a of traffic.agents) {
        const v = a.body.linvel();
        if (check(a.x, a.z, Math.hypot(v.x, v.z))) return true;
      }
    }
    return false;
  }

  /** Called when something hits a pedestrian hard. Non-graphic by design. */
  knock(p: Pedestrian) {
    if (p.state === 'knocked') return;
    p.state = 'knocked';
    p.knockedFor = 3.5;
    p.speed = 0;
  }
}

function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}
