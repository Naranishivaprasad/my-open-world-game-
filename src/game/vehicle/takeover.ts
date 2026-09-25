import type Rapier from '@dimforge/rapier3d-compat';
import type { World } from '@dimforge/rapier3d-compat';
import { parkedVehicles } from './parkedVehicles';
import type { VehicleOwner, Transform } from './VehicleOwner';
import { VEHICLE_TYPES, type VehicleKey } from '../world/vehicleGeometry';
import { HERO_BUILD } from '../config/vehicle';

/** A vehicle the player could get into, other than the one they last drove. */
export interface TakeoverTarget {
  kind: 'hero' | VehicleKey;
  at: Transform;
  colour?: string;
  distance: number;
  label: string;
  /** Removes the target from the world. Call immediately before swapping. */
  commit: () => void;
}

/**
 * The hero car parked up while the player drives something else.
 *
 * It is not in the parked registry because it is a GLB rather than one of the
 * procedural body classes, so it is rendered by its own component. Everything
 * else about it - a transform, a static collider, being re-enterable - works
 * the same way.
 */
export interface ParkedHero {
  at: Transform;
  colliderHandle: number | null;
}

let parkedHero: ParkedHero | null = null;

export function getParkedHero() {
  return parkedHero;
}

/**
 * Leave the currently driven vehicle standing where it is, so the player can
 * take a different one.
 *
 * Without this the car being driven would simply cease to exist the moment the
 * player got into another, which is both wrong and a quiet way to lose the
 * hero car forever.
 */
export function parkCurrentVehicle(owner: VehicleOwner, world: World, rapier: typeof Rapier) {
  const at = owner.snapshot();
  // Sit it on the road rather than wherever the suspension happened to be.
  at.y = Math.max(at.y, 0.05);

  if (owner.kind === 'hero') {
    const c = HERO_BUILD.chassis.collider;
    const body = world.createRigidBody(
      rapier.RigidBodyDesc.fixed().setTranslation(at.x, at.y + c.cy, at.z),
    );
    const col = world.createCollider(
      rapier.ColliderDesc.cuboid(c.hx, c.hy, c.hz).setFriction(0.9),
      body,
    );
    parkedHero = { at, colliderHandle: col.handle };
    return;
  }

  const spec = VEHICLE_TYPES[owner.kind];
  // Axis-aligned footprint: a rotated box would need a rotated collider, and
  // the whole static layer is axis-aligned by design (spec 20).
  const alongZ = Math.abs(Math.cos(at.heading)) > Math.abs(Math.sin(at.heading));
  const sx = alongZ ? spec.width : spec.length;
  const sz = alongZ ? spec.length : spec.width;
  const body = world.createRigidBody(
    rapier.RigidBodyDesc.fixed().setTranslation(at.x, spec.height / 2, at.z),
  );
  const col = world.createCollider(
    rapier.ColliderDesc.cuboid(sx / 2, spec.height / 2, sz / 2).setFriction(0.9),
    body,
  );
  parkedVehicles.add({
    key: owner.kind,
    x: at.x,
    y: 0,
    z: at.z,
    heading: at.heading,
    colour: owner.colour,
    colliderHandle: col.handle,
  });
}

/**
 * The nearest vehicle the player could take over, or null.
 *
 * Only the vehicle they are NOT already driving counts: the car they last got
 * out of is handled by the ordinary enter/exit path.
 */
export function findTakeoverTarget(
  world: World,
  px: number,
  pz: number,
  radius: number,
): TakeoverTarget | null {
  let best: TakeoverTarget | null = null;

  const hit = parkedVehicles.nearest(px, pz, radius);
  if (hit) {
    const { item, distance } = hit;
    best = {
      kind: item.key,
      at: { x: item.x, y: VEHICLE_TYPES[item.key].wheelRadius + 0.25, z: item.z, heading: item.heading },
      colour: item.colour,
      distance,
      label: VEHICLE_TYPES[item.key].label,
      commit: () => {
        parkedVehicles.take(item.id, world);
      },
    };
  }

  if (parkedHero) {
    const hero = parkedHero;
    const d = Math.hypot(hero.at.x - px, hero.at.z - pz);
    if (d < radius && (!best || d < best.distance)) {
      best = {
        kind: 'hero',
        at: { ...hero.at, y: hero.at.y + 0.2 },
        distance: d,
        label: 'Hero car',
        commit: () => {
          if (hero.colliderHandle !== null) {
            const col = world.getCollider(hero.colliderHandle);
            // The collider owns a body of its own; removing the body takes both.
            if (col) {
              const parent = col.parent();
              if (parent) world.removeRigidBody(parent);
              else world.removeCollider(col, false);
            }
          }
          parkedHero = null;
        },
      };
    }
  }

  return best;
}

/** Forget any parked hero car, e.g. when the world is rebuilt. */
export function resetTakeover() {
  parkedHero = null;
}
