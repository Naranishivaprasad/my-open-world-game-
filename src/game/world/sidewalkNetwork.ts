import { getRoadGraph, isOnCarriageway, type RoadEdge } from './roadGraph';

/**
 * Walkable network for pedestrians (spec 22).
 *
 * Built from the same road graph as everything else: every road contributes two
 * sidewalk runs, waypoints are chained along each run, and at junctions the
 * nearby run-ends are linked to each other. Links whose midpoint lies on a
 * carriageway are flagged as CROSSINGS, so a pedestrian knows to check for
 * traffic before stepping off the kerb rather than walking blindly into a road.
 */

export interface WalkNode {
  id: number;
  x: number;
  z: number;
  /** Indices of connected nodes. */
  links: number[];
  /** Parallel to `links`: true when that link crosses a road. */
  crossing: boolean[];
  /** True when this node sits on a junction corner. */
  corner: boolean;
}

export interface SidewalkNetwork {
  nodes: WalkNode[];
}

const SPACING = 9;
const isHorizontal = (e: RoadEdge) => Math.abs(e.dz) < 1e-6;

let cached: SidewalkNetwork | null = null;

export function getSidewalkNetwork(): SidewalkNetwork {
  if (cached) return cached;

  const graph = getRoadGraph();
  const nodes: WalkNode[] = [];

  const addNode = (x: number, z: number, corner = false): number => {
    // Merge coincident points so runs actually join up.
    for (const n of nodes) {
      if (Math.abs(n.x - x) < 1.2 && Math.abs(n.z - z) < 1.2) return n.id;
    }
    const id = nodes.length;
    nodes.push({ id, x, z, links: [], crossing: [], corner });
    return id;
  };

  const link = (a: number, b: number) => {
    if (a === b) return;
    const na = nodes[a]!;
    const nb = nodes[b]!;
    if (na.links.includes(b)) return;
    const mx = (na.x + nb.x) / 2;
    const mz = (na.z + nb.z) / 2;
    const isCrossing = isOnCarriageway(mx, mz, -0.5);
    na.links.push(b);
    na.crossing.push(isCrossing);
    nb.links.push(a);
    nb.crossing.push(isCrossing);
  };

  /** End-of-run waypoints, so junction corners can be stitched together. */
  const runEnds: number[] = [];

  for (const e of graph.edges) {
    if (e.sidewalkWidth <= 0) continue;

    // Same trim the geometry uses, so waypoints land on real pavement.
    const tA = trimAt(e.from, e);
    const tB = trimAt(e.to, e);
    const horiz = isHorizontal(e);
    const fixed = horiz ? e.az : e.ax;
    const lo = (horiz ? Math.min(e.ax, e.bx) : Math.min(e.az, e.bz)) + tA;
    const hi = (horiz ? Math.max(e.ax, e.bx) : Math.max(e.az, e.bz)) - tB;
    if (hi - lo < 4) continue;

    const offset = e.halfWidth + e.sidewalkWidth / 2;

    for (const side of [-1, 1] as const) {
      const perp = fixed + side * offset;
      const count = Math.max(2, Math.round((hi - lo) / SPACING));
      let prev = -1;
      for (let i = 0; i <= count; i++) {
        const t = lo + ((hi - lo) * i) / count;
        const x = horiz ? t : perp;
        const z = horiz ? perp : t;
        const id = addNode(x, z, i === 0 || i === count);
        if (prev >= 0) link(prev, id);
        prev = id;
        if (i === 0 || i === count) runEnds.push(id);
      }
    }
  }

  // Stitch junction corners: walk around the corner, and cross the road.
  for (const j of graph.intersections) {
    const near = runEnds.filter((id) => {
      const n = nodes[id]!;
      return Math.hypot(n.x - j.x, n.z - j.z) < 26;
    });
    for (let i = 0; i < near.length; i++) {
      for (let k = i + 1; k < near.length; k++) {
        const a = nodes[near[i]!]!;
        const b = nodes[near[k]!]!;
        const d = Math.hypot(a.x - b.x, a.z - b.z);
        // Only join corners that are plausibly walkable in a straight line.
        if (d > 34) continue;
        link(a.id, b.id);
      }
    }
  }

  // Drop orphans: a waypoint with no links would strand any pedestrian on it.
  cached = { nodes: nodes.filter((n) => n.links.length > 0) };
  // Re-index after filtering would invalidate link ids, so keep the full array
  // and let callers skip link-less nodes when choosing a start point.
  cached = { nodes };
  return cached;
}

function trimAt(nodeId: string, self: RoadEdge): number {
  const graph = getRoadGraph();
  const node = graph.nodes.get(nodeId);
  if (!node) return 0;
  let t = 0;
  for (const eid of node.edges) {
    if (eid === self.id) continue;
    const other = graph.edges.find((e) => e.id === eid);
    if (!other) continue;
    if (isHorizontal(other) !== isHorizontal(self)) t = Math.max(t, other.halfWidth);
  }
  return t;
}
