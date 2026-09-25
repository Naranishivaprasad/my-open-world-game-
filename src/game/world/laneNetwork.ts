import { getRoadGraph, type Lane } from './roadGraph';

/**
 * Routable lane network derived from the road graph (spec 21).
 *
 * The road graph knows where lanes ARE; this knows where a lane can GO. It adds
 * start/end nodes, direction and length to every lane, and connects each lane
 * to its legal successors through each junction, classified as left / straight
 * / right so traffic can yield correctly and signal later.
 *
 * Built once and cached: the network is a pure function of the road graph.
 */

export type Turn = 'straight' | 'left' | 'right' | 'uturn';

export interface LaneLink {
  laneId: string;
  turn: Turn;
}

export interface RoutableLane {
  id: string;
  edgeId: string;
  /** Graph node this lane leaves from / arrives at. */
  startNode: string;
  endNode: string;
  ax: number;
  az: number;
  bx: number;
  bz: number;
  /** Unit direction of travel. */
  dx: number;
  dz: number;
  length: number;
  /** Heading in the same atan2(dirX, dirZ) convention as everything else. */
  heading: number;
  speedLimit: number;
  successors: LaneLink[];
  /** True when this lane ends at a junction rather than a map terminus. */
  endsAtJunction: boolean;
}

export interface LaneNetwork {
  lanes: RoutableLane[];
  byId: Map<string, RoutableLane>;
  /** Lanes long enough to spawn traffic on. */
  spawnable: RoutableLane[];
}

let cached: LaneNetwork | null = null;

export function getLaneNetwork(): LaneNetwork {
  if (cached) return cached;

  const graph = getRoadGraph();
  const byId = new Map<string, RoutableLane>();
  const lanes: RoutableLane[] = [];

  for (const lane of graph.lanes) {
    const edge = graph.edges.find((e) => e.id === lane.edgeId);
    if (!edge) continue;

    // A forward lane runs from the edge's `from` node to its `to` node; a
    // backward lane is the reverse.
    const startNode = lane.dir === 1 ? edge.from : edge.to;
    const endNode = lane.dir === 1 ? edge.to : edge.from;

    const vx = lane.b.x - lane.a.x;
    const vz = lane.b.z - lane.a.z;
    const length = Math.hypot(vx, vz);
    if (length < 1e-3) continue;

    const r: RoutableLane = {
      id: lane.id,
      edgeId: lane.edgeId,
      startNode,
      endNode,
      ax: lane.a.x,
      az: lane.a.z,
      bx: lane.b.x,
      bz: lane.b.z,
      dx: vx / length,
      dz: vz / length,
      length,
      heading: Math.atan2(vx / length, vz / length),
      speedLimit: lane.speedLimit,
      successors: [],
      endsAtJunction: (graph.nodes.get(endNode)?.edges.length ?? 0) >= 3,
    };
    lanes.push(r);
    byId.set(r.id, r);
  }

  // --- connect ---
  for (const lane of lanes) {
    const candidates = lanes.filter((m) => m.startNode === lane.endNode);

    for (const next of candidates) {
      // Never turn back down the lane we just came from.
      const isUturn = next.edgeId === lane.edgeId;
      if (isUturn) continue;
      lane.successors.push({ laneId: next.id, turn: classifyTurn(lane, next) });
    }

    // A map terminus has nowhere to go; allow the U-turn there so traffic can
    // loop rather than pile up at the map edge.
    if (lane.successors.length === 0) {
      const back = candidates.find((m) => m.edgeId === lane.edgeId);
      if (back) lane.successors.push({ laneId: back.id, turn: 'uturn' });
    }
  }

  const spawnable = lanes.filter((l) => l.length > 26);

  cached = { lanes, byId, spawnable };
  return cached;
}

/**
 * Left / straight / right, from the signed turn between two lane directions.
 *
 * Sign convention matches the rest of the project: a POSITIVE rotation about
 * +Y is a left turn. For two ground-plane vectors the y component of a x b is
 * (az*bx - ax*bz), which is positive for a left turn.
 */
function classifyTurn(from: RoutableLane, to: RoutableLane): Turn {
  const cross = from.dz * to.dx - from.dx * to.dz;
  const dot = from.dx * to.dx + from.dz * to.dz;
  if (dot < -0.7) return 'uturn';
  if (Math.abs(cross) < 0.35) return 'straight';
  return cross > 0 ? 'left' : 'right';
}

/** Point at parameter t (0..1) along a lane. */
export function sampleLane(lane: RoutableLane, t: number, out: { x: number; z: number }) {
  out.x = lane.ax + (lane.bx - lane.ax) * t;
  out.z = lane.az + (lane.bz - lane.az) * t;
  return out;
}

/**
 * Whether a lane's end conflicts with another lane's end at the same junction.
 * Used for the simple priority rule: a turning vehicle yields to one going
 * straight through the same junction (spec 21).
 */
export function turnPriority(turn: Turn): number {
  switch (turn) {
    case 'straight':
      return 3;
    case 'right':
      return 2;
    case 'left':
      return 1;
    default:
      return 0;
  }
}

// --------------------------------------------------------------- routing

/** A point on the route line, in world space. */
export interface RoutePoint {
  x: number;
  z: number;
}

/**
 * Nearest lane to a world point, and how far along it that point projects.
 * Used to attach both ends of a route to the network.
 */
export function nearestRoutableLane(x: number, z: number): { lane: RoutableLane; t: number } | null {
  const net = getLaneNetwork();
  let best: { lane: RoutableLane; t: number } | null = null;
  let bestDist = Infinity;
  for (const lane of net.lanes) {
    const vx = lane.bx - lane.ax;
    const vz = lane.bz - lane.az;
    const len2 = vx * vx + vz * vz;
    if (len2 === 0) continue;
    let t = ((x - lane.ax) * vx + (z - lane.az) * vz) / len2;
    t = Math.max(0, Math.min(1, t));
    const cx = lane.ax + vx * t;
    const cz = lane.az + vz * t;
    const d = Math.hypot(x - cx, z - cz);
    if (d < bestDist) {
      bestDist = d;
      best = { lane, t };
    }
  }
  return best;
}

/**
 * A* over the lane network (spec 29: route guidance must follow valid roads,
 * not run straight through buildings).
 *
 * Returns a polyline from the start point, along legal lane directions, to the
 * lane nearest the destination, finishing with the destination itself. Returns
 * null when no legal route exists.
 */
export function findRoute(
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  maxExpansions = 4000,
): RoutePoint[] | null {
  const net = getLaneNetwork();
  const start = nearestRoutableLane(fromX, fromZ);
  const goal = nearestRoutableLane(toX, toZ);
  if (!start || !goal) return null;

  if (start.lane.id === goal.lane.id) {
    return [{ x: fromX, z: fromZ }, { x: toX, z: toZ }];
  }

  const h = (lane: RoutableLane) => Math.hypot(lane.bx - toX, lane.bz - toZ);

  const gScore = new Map<string, number>();
  const cameFrom = new Map<string, string>();
  const open: { id: string; f: number }[] = [];

  const push = (id: string, f: number) => {
    // Small network; a linear insert keeps this simple and allocation-free.
    let i = open.length;
    while (i > 0 && open[i - 1]!.f > f) i--;
    open.splice(i, 0, { id, f });
  };

  gScore.set(start.lane.id, 0);
  push(start.lane.id, h(start.lane));

  let expansions = 0;
  let found = false;

  while (open.length > 0 && expansions++ < maxExpansions) {
    const current = open.shift()!;
    if (current.id === goal.lane.id) {
      found = true;
      break;
    }
    const lane = net.byId.get(current.id);
    if (!lane) continue;
    const g = gScore.get(current.id) ?? Infinity;

    for (const link of lane.successors) {
      const next = net.byId.get(link.laneId);
      if (!next) continue;
      // Turning costs a little, so the route prefers straight runs.
      const penalty = link.turn === 'straight' ? 0 : link.turn === 'uturn' ? 60 : 12;
      const tentative = g + lane.length + penalty;
      if (tentative < (gScore.get(next.id) ?? Infinity)) {
        gScore.set(next.id, tentative);
        cameFrom.set(next.id, current.id);
        push(next.id, tentative + h(next));
      }
    }
  }

  if (!found) return null;

  // Walk the chain back, then emit each lane's end point in travel order.
  const chain: string[] = [goal.lane.id];
  let cursor = goal.lane.id;
  let guard = 0;
  while (cursor !== start.lane.id && guard++ < 500) {
    const prev = cameFrom.get(cursor);
    if (!prev) break;
    chain.push(prev);
    cursor = prev;
  }
  chain.reverse();

  const points: RoutePoint[] = [{ x: fromX, z: fromZ }];
  for (let i = 0; i < chain.length; i++) {
    const lane = net.byId.get(chain[i]!);
    if (!lane) continue;
    // Skip the start lane's end if we are already past it.
    if (i === 0 && start.t > 0.92) continue;
    if (i === chain.length - 1) break; // the goal lane finishes at the target
    points.push({ x: lane.bx, z: lane.bz });
  }
  points.push({ x: toX, z: toZ });
  return points;
}
