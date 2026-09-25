import type { World } from '@dimforge/rapier3d-compat';
import type { VehicleKey } from '../world/vehicleGeometry';

/**
 * A vehicle standing in the world that nobody is driving.
 *
 * `heading` is a FACING in the shared atan2(dirX, dirZ) convention, the same
 * one the character, the camera and the chassis use.
 */
export interface ParkedVehicle {
  id: number;
  key: VehicleKey;
  x: number;
  y: number;
  z: number;
  heading: number;
  colour: string;
  /** Static collider, removed when the player drives it away. */
  colliderHandle: number | null;
}

/**
 * The single registry of parked vehicles (spec 17).
 *
 * It holds BOTH the cars the city generator laid out and the ones the player
 * abandons, because from the moment the player gets out of a car it is simply
 * another parked car - there is no reason for those to be two systems.
 *
 * Deliberately outside React: it is mutated from the physics step, and the
 * renderer subscribes for a redraw rather than owning the data.
 */
class ParkedVehicleRegistry {
  private items = new Map<number, ParkedVehicle>();
  private nextId = 1;
  private listeners = new Set<() => void>();

  /** Bumped on every change, so a renderer can memo on it. */
  version = 0;

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed() {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  /** Drop everything, e.g. when the world is rebuilt. */
  clear() {
    this.items.clear();
    this.changed();
  }

  add(v: Omit<ParkedVehicle, 'id'>): ParkedVehicle {
    const item: ParkedVehicle = { ...v, id: this.nextId++ };
    this.items.set(item.id, item);
    this.changed();
    return item;
  }

  all(): ParkedVehicle[] {
    return [...this.items.values()];
  }

  /**
   * Take a vehicle out of the world so the player can drive it.
   *
   * Its static collider has to go with it, or the car the player is now driving
   * is stuck inside an invisible box of its own former self.
   */
  take(id: number, world: World): ParkedVehicle | null {
    const item = this.items.get(id);
    if (!item) return null;
    if (item.colliderHandle !== null) {
      const col = world.getCollider(item.colliderHandle);
      if (col) world.removeCollider(col, false);
    }
    this.items.delete(id);
    this.changed();
    return item;
  }

  /** Nearest parked vehicle to a point, within `maxDist` metres. */
  nearest(x: number, z: number, maxDist: number): { item: ParkedVehicle; distance: number } | null {
    let best: ParkedVehicle | null = null;
    let bestD = maxDist;
    for (const item of this.items.values()) {
      const d = Math.hypot(item.x - x, item.z - z);
      if (d < bestD) {
        bestD = d;
        best = item;
      }
    }
    return best ? { item: best, distance: bestD } : null;
  }
}

export const parkedVehicles = new ParkedVehicleRegistry();

/**
 * Convert a facing to the Y rotation a parked instance needs.
 *
 * Vehicle geometry is authored facing +X, so at rotY = 0 it faces +X, which is
 * heading PI/2. Rotating by rotY turns the facing to (cos rotY, 0, -sin rotY);
 * inverting that gives the expression below.
 */
export function headingToRotY(heading: number) {
  return Math.atan2(-Math.cos(heading), Math.sin(heading));
}

/** The inverse of {@link headingToRotY}. */
export function rotYToHeading(rotY: number) {
  return Math.atan2(Math.cos(rotY), -Math.sin(rotY));
}
