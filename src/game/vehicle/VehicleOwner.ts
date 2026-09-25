import type Rapier from '@dimforge/rapier3d-compat';
import type { World } from '@dimforge/rapier3d-compat';
import { VehicleController } from './VehicleController';
import { HERO_BUILD, buildFromSpec } from '../config/vehicle';
import { VEHICLE_TYPES, type VehicleKey } from '../world/vehicleGeometry';
import { sim } from '../core/sim';

/** Which vehicle the player is currently in: the hero car, or a body class. */
export type DrivenKind = 'hero' | VehicleKey;

export interface Transform {
  x: number;
  y: number;
  z: number;
  heading: number;
}

/**
 * Owns the ONE physics vehicle the player drives, and can rebuild it as a
 * different vehicle in place (spec 17).
 *
 * There is deliberately only ever one raycast vehicle in the world. Giving
 * every parked car and every traffic car a full suspension model would cost far
 * more than it is worth when at most one of them is ever being driven. So
 * "getting into another car" is implemented as rebuilding this controller to
 * that car's specification at that car's position - the car the player leaves
 * behind becomes a parked shell, and the car they take over stops being one.
 *
 * The controller instance is STABLE across swaps - it is reconfigured in place,
 * not replaced - but `onSwap` still fires so renderers can switch shells.
 */
export class VehicleOwner {
  private controller: VehicleController;
  private listeners = new Set<(c: VehicleController) => void>();
  private pending: { kind: DrivenKind; at: Transform; colour?: string } | null = null;

  kind: DrivenKind = 'hero';
  /** Paint colour, carried across when a vehicle is taken over. */
  colour = '#d8d5cf';

  constructor(
    private world: World,
    private rapier: typeof Rapier,
    spawn: Transform,
  ) {
    this.controller = new VehicleController(world, rapier, spawn, HERO_BUILD);
    sim.vehicle.kind = 'hero';
    sim.vehicle.label = 'Hero car';
  }

  get current() {
    return this.controller;
  }

  onSwap(fn: (c: VehicleController) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Where the current vehicle is, for handing it over to a parked shell. */
  snapshot(): Transform {
    const t = this.controller.body.translation();
    const r = this.controller.body.rotation();
    // Facing, in the shared atan2(dirX, dirZ) convention.
    const fx = 2 * (r.x * r.z + r.w * r.y);
    const fz = 1 - 2 * (r.x * r.x + r.y * r.y);
    return { x: t.x, y: t.y, z: t.z, heading: Math.atan2(-fx, -fz) };
  }

  /**
   * Queue a swap to be applied at the start of the next physics step.
   *
   * Swapping tears down a rigid body and a vehicle controller and builds new
   * ones. Doing that from arbitrary code - an input handler, a console call -
   * can land in the middle of the physics pipeline, where Rapier already holds
   * a mutable borrow of the world and any further call into it fails with
   * "recursive use of an object". Deferring to a known-safe point removes the
   * whole class of problem.
   */
  requestSwap(kind: DrivenKind, at: Transform, colour?: string) {
    this.pending = { kind, at, colour };
  }

  /** Apply a queued swap. Called once per physics step, before the step runs. */
  applyPendingSwap() {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    this.swapTo(p.kind, p.at, p.colour);
  }

  /**
   * Rebuild the driven vehicle as `kind`, sitting at `at`.
   *
   * The caller is responsible for having already removed whatever used to
   * occupy that spot, and for parking whatever the player was driving before.
   */
  swapTo(kind: DrivenKind, at: Transform, colour?: string) {
    const build = kind === 'hero' ? HERO_BUILD : buildFromSpec(VEHICLE_TYPES[kind]);

    this.controller.reconfigure(build, at);
    this.kind = kind;
    if (colour) this.colour = colour;

    sim.vehicle.kind = kind;
    sim.vehicle.label = kind === 'hero' ? 'Hero car' : VEHICLE_TYPES[kind].label;

    for (const fn of this.listeners) fn(this.controller);
  }

  dispose() {
    this.listeners.clear();
    this.controller.dispose();
  }
}
