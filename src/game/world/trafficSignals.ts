import { getRoadGraph } from './roadGraph';

/**
 * Traffic signals at the major junctions (spec 21).
 *
 * The brief is explicit that a visible light must correspond to behaviour, so
 * these are not decoration: the same function that decides which lamp is lit
 * is the one traffic reads to decide whether to stop. There is no separate
 * "visual" state that could drift out of step with the simulation.
 *
 * The phase is a PURE FUNCTION of the clock and the junction's own offset -
 * no per-junction state, nothing to keep in sync, and the lights are identical
 * for every observer including the renderer, the traffic system and the tests.
 */

export type Lamp = 'red' | 'amber' | 'green';
/** Which way a road runs. North-south roads carry traffic along Z. */
export type Axis = 'ns' | 'ew';

const GREEN = 11.0;
const AMBER = 2.4;
/** All-red between phases, so a junction is never green in both directions. */
const CLEAR = 1.2;

const HALF = GREEN + AMBER + CLEAR;
export const CYCLE = HALF * 2;

export interface SignalJunction {
  id: string;
  x: number;
  z: number;
  half: number;
  /** Seconds this junction's cycle is shifted by, so the city is not in step. */
  offset: number;
}

let cached: SignalJunction[] | null = null;

/**
 * Signalised junctions.
 *
 * Only crossings wide enough to warrant it are signalised; the small ones keep
 * the unsignalised give-way rule, which is both realistic and avoids putting a
 * light on an alley mouth.
 */
export function getSignalJunctions(): SignalJunction[] {
  if (cached) return cached;
  const graph = getRoadGraph();
  cached = graph.intersections
    // A boulevard is 2+2 lanes (half 7 m); a street is 1+1 (half 3.5 m). This
    // threshold therefore signalises every crossing that involves a boulevard
    // and leaves the quieter street-on-street junctions on give-way.
    .filter((i) => i.half >= 6)
    .map((i) => ({
      id: i.id,
      x: i.x,
      z: i.z,
      half: i.half,
      // Deterministic per-junction stagger from its position, so a convoy does
      // not meet an identical red at every block.
      offset: (Math.abs(Math.round(i.x * 7 + i.z * 13)) % 1000) / 1000 * CYCLE,
    }));
  return cached;
}

/** Clear the cache when the world is rebuilt. */
export function resetSignals() {
  cached = null;
}

/** The lamp showing to traffic on `axis` at this junction, at time `t`. */
export function lampFor(junction: SignalJunction, t: number, axis: Axis): Lamp {
  const p = ((t + junction.offset) % CYCLE + CYCLE) % CYCLE;
  // First half of the cycle serves north-south, second half east-west.
  const nsTurn = p < HALF;
  const local = nsTurn ? p : p - HALF;
  const serving: Axis = nsTurn ? 'ns' : 'ew';

  if (axis !== serving) return 'red';
  if (local < GREEN) return 'green';
  if (local < GREEN + AMBER) return 'amber';
  return 'red';
}

/**
 * The axis a lane travels along.
 *
 * Lanes are axis-aligned in this city, so the larger component of the
 * direction decides it.
 */
export function axisOf(dx: number, dz: number): Axis {
  return Math.abs(dz) >= Math.abs(dx) ? 'ns' : 'ew';
}

/**
 * May a vehicle on `axis` enter this junction, given how far away it is?
 *
 * Amber means "stop if you can": a vehicle already close enough that stopping
 * would mean slamming on is allowed through, which is what stops a line of
 * traffic braking hard every time a light changes.
 */
export function mayEnter(
  junction: SignalJunction,
  t: number,
  axis: Axis,
  distanceToStopLine: number,
  speed: number,
): boolean {
  const lamp = lampFor(junction, t, axis);
  if (lamp === 'green') return true;
  if (lamp === 'red') return false;
  // Amber: committed if it could not stop comfortably in the distance left.
  const comfortableStop = (speed * speed) / (2 * 3.5);
  return distanceToStopLine < comfortableStop;
}

/** Nearest signalised junction to a point, within `radius`. */
export function signalAt(x: number, z: number, radius: number): SignalJunction | null {
  for (const j of getSignalJunctions()) {
    if (Math.hypot(j.x - x, j.z - z) < radius) return j;
  }
  return null;
}
