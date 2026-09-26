import { LANE_WIDTH, SIDEWALK_WIDTH_MAIN, SIDEWALK_WIDTH_SIDE } from '../config/world';

/**
 * The road network is a connected node/edge graph (spec 21).
 *
 * It is the SINGLE source of truth for:
 *   - road surface geometry and kerbs
 *   - lane markings
 *   - sidewalk strips pedestrians walk on
 *   - the lane centrelines traffic will drive along
 *   - which rectangles are free for buildings
 *
 * Deriving geometry and AI routing from one structure is what keeps the visual
 * road and the drivable road in agreement (spec 20).
 */

export type RoadKind = 'boulevard' | 'street' | 'alley';
export type CentreLine = 'double-yellow' | 'dashed-white' | 'none';

export interface RoadNode {
  id: string;
  x: number;
  z: number;
  /** Edge ids touching this node; length 1 means a map-edge terminus. */
  edges: string[];
}

export interface RoadEdgeDef {
  id: string;
  name: string;
  from: string;
  to: string;
  kind: RoadKind;
  lanesForward: number;
  lanesBackward: number;
  centreLine: CentreLine;
  /** Sidewalk on the left / right of the from->to direction. */
  sidewalk: [boolean, boolean];
}

export interface Lane {
  id: string;
  edgeId: string;
  /** +1 travels from->to, -1 travels to->from. */
  dir: 1 | -1;
  /** Index outward from the centreline, 0 = innermost. */
  index: number;
  /** Centreline of the lane, in travel order. */
  a: { x: number; z: number };
  b: { x: number; z: number };
  speedLimit: number;
}

export interface RoadEdge extends RoadEdgeDef {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  /** Unit direction from->to. */
  dx: number;
  dz: number;
  /** Unit right-hand normal of the direction (three.js: right = dir x up). */
  rx: number;
  rz: number;
  length: number;
  /** Half the carriageway width, excluding sidewalks. */
  halfWidth: number;
  sidewalkWidth: number;
  lanes: Lane[];
}

export interface RoadGraph {
  nodes: Map<string, RoadNode>;
  edges: RoadEdge[];
  lanes: Lane[];
  /** Square footprint of each intersection, used to cut markings and place lights. */
  intersections: { id: string; x: number; z: number; half: number }[];
}

// ---------------------------------------------------------------- map definition

/**
 * NEO TOKYO — Vista Del Mar and the seafront.
 *
 * The map is GENERATED from two lists of roads rather than a hand-written node
 * table, so the city can grow without the table becoming unmaintainable. Every
 * north-south road crosses every east-west road, which produces the junctions,
 * the blocks between them, and the lane connections automatically.
 *
 *                             N (-Z)
 *   Bay Street        z = +420  ------------------------------
 *   North Avenue      z = +280  ------------------------------
 *   Dock Street       z = +130  ---------------(industrial)---
 *   Palm Boulevard    z =    0  ===============(4 lanes)======   <- the spine
 *   Coral Lane        z = -125  ------------------------------
 *   Sunset Way        z = -270  ------------------------------
 *   South End Road    z = -400  ------------------------------
 *
 *      x =  -430   -290   -105  -18   +85   +235        +355
 *          Ridge   West  Marina alley Calle Harbor      Ocean Dr
 *                                                        |  beach -> sea
 */

type RoadKindName = RoadKind;

interface RoadLine {
  id: string;
  name: string;
  /** Fixed coordinate: x for north-south roads, z for east-west roads. */
  at: number;
  kind: RoadKindName;
}

/** North-south roads, listed west to east. */
const NS_ROADS: RoadLine[] = [
  { id: 'ridge', name: 'Ridge Road', at: -430, kind: 'street' },
  { id: 'west', name: 'West Avenue', at: -290, kind: 'street' },
  { id: 'marina', name: 'Marina Road', at: -105, kind: 'street' },
  { id: 'calle', name: 'Calle Verde', at: 85, kind: 'street' },
  { id: 'harbor', name: 'Harbor Boulevard', at: 235, kind: 'boulevard' },
  { id: 'ocean', name: 'Ocean Drive', at: 355, kind: 'boulevard' },
];

/** East-west roads, listed south to north (-Z is north, so ascending z). */
const EW_ROADS: RoadLine[] = [
  { id: 'south', name: 'South End Road', at: -400, kind: 'street' },
  { id: 'sunset', name: 'Sunset Way', at: -270, kind: 'street' },
  { id: 'coral', name: 'Coral Lane', at: -125, kind: 'street' },
  { id: 'palm', name: 'Palm Boulevard', at: 0, kind: 'boulevard' },
  { id: 'dock', name: 'Dock Street', at: 130, kind: 'street' },
  { id: 'north', name: 'North Avenue', at: 280, kind: 'street' },
  { id: 'bay', name: 'Bay Street', at: 420, kind: 'street' },
];

/** How far north-south roads run past the outermost east-west road. */
const NS_OVERRUN = 55;
/** How far east-west roads run west past Ridge Road. */
const EW_WEST_OVERRUN = 40;

/** The service alley: a short north-south cut between Palm and Dock. */
const ALLEY_X = -18;

const NODE_POSITIONS = new Map<string, { x: number; z: number }>();
const EDGE_DEFS: RoadEdgeDef[] = [];

function node(id: string, x: number, z: number) {
  if (!NODE_POSITIONS.has(id)) NODE_POSITIONS.set(id, { x, z });
  return id;
}

function makeEdge(
  id: string,
  name: string,
  from: string,
  to: string,
  kind: RoadKindName,
): RoadEdgeDef {
  const boulevard = kind === 'boulevard';
  return {
    id,
    name,
    from,
    to,
    kind,
    lanesForward: boulevard ? 2 : 1,
    lanesBackward: boulevard ? 2 : 1,
    centreLine: boulevard ? 'double-yellow' : 'dashed-white',
    sidewalk: [true, true],
  };
}

(function generateGrid() {
  const zMin = EW_ROADS[0]!.at - NS_OVERRUN;
  const zMax = EW_ROADS[EW_ROADS.length - 1]!.at + NS_OVERRUN;
  const xMin = NS_ROADS[0]!.at - EW_WEST_OVERRUN;

  // --- north-south roads: terminus, every crossing, terminus ---
  for (const road of NS_ROADS) {
    const stops = [
      node(`${road.id}_s`, road.at, zMin),
      ...EW_ROADS.map((ew) => node(`x_${road.id}_${ew.id}`, road.at, ew.at)),
      node(`${road.id}_n`, road.at, zMax),
    ];
    for (let i = 0; i < stops.length - 1; i++) {
      EDGE_DEFS.push(makeEdge(`${road.id}_${i}`, road.name, stops[i]!, stops[i + 1]!, road.kind));
    }
  }

  /*
   * East-west roads. They stop AT Ocean Drive, which fronts the beach.
   *
   * Palm and Dock are additionally split at the service alley, so the alley's
   * ends are genuine junctions rather than isolated stubs that traffic could
   * enter but never leave.
   */
  for (const road of EW_ROADS) {
    const crossings = NS_ROADS.map((ns) => ({
      at: ns.at,
      id: node(`x_${ns.id}_${road.id}`, ns.at, road.at),
    }));

    if (road.id === 'palm') crossings.push({ at: ALLEY_X, id: node('alley_s', ALLEY_X, road.at) });
    if (road.id === 'dock') crossings.push({ at: ALLEY_X, id: node('alley_n', ALLEY_X, road.at) });
    crossings.sort((a, b) => a.at - b.at);

    const stops = [node(`${road.id}_w`, xMin, road.at), ...crossings.map((c) => c.id)];
    for (let i = 0; i < stops.length - 1; i++) {
      EDGE_DEFS.push(makeEdge(`${road.id}_${i}`, road.name, stops[i]!, stops[i + 1]!, road.kind));
    }
  }

  // The alley itself, between the two junctions created above.
  EDGE_DEFS.push({
    id: 'alley_1',
    name: 'Service Alley',
    from: 'alley_s',
    to: 'alley_n',
    kind: 'alley',
    lanesForward: 1,
    lanesBackward: 1,
    centreLine: 'none',
    sidewalk: [false, false],
  });
})();

// ------------------------------------------------------------------- building

const SPEED_LIMITS: Record<RoadKind, number> = {
  boulevard: 16, // ~58 km/h
  street: 12, // ~43 km/h
  alley: 6, // ~22 km/h
};

/** Alleys are deliberately narrower than a full lane pair. */
function halfWidthFor(def: RoadEdgeDef): number {
  if (def.kind === 'alley') return 2.6;
  return (LANE_WIDTH * (def.lanesForward + def.lanesBackward)) / 2;
}

function sidewalkWidthFor(def: RoadEdgeDef): number {
  if (def.kind === 'alley') return 0;
  return def.kind === 'boulevard' ? SIDEWALK_WIDTH_MAIN : SIDEWALK_WIDTH_SIDE;
}

let cached: RoadGraph | null = null;

export function getRoadGraph(): RoadGraph {
  if (cached) return cached;

  const nodes = new Map<string, RoadNode>();
  for (const [id, p] of NODE_POSITIONS) nodes.set(id, { id, x: p.x, z: p.z, edges: [] });

  const edges: RoadEdge[] = [];
  const lanes: Lane[] = [];

  for (const def of EDGE_DEFS) {
    const a = nodes.get(def.from);
    const b = nodes.get(def.to);
    if (!a || !b) throw new Error(`road edge ${def.id} references a missing node`);

    a.edges.push(def.id);
    b.edges.push(def.id);

    const vx = b.x - a.x;
    const vz = b.z - a.z;
    const length = Math.hypot(vx, vz);
    const dx = vx / length;
    const dz = vz / length;
    // Right-hand normal in three.js coords: right = direction x up(0,1,0).
    const rx = -dz;
    const rz = dx;

    const halfWidth = halfWidthFor(def);
    const speedLimit = SPEED_LIMITS[def.kind];

    const built: RoadEdge = {
      ...def,
      ax: a.x,
      az: a.z,
      bx: b.x,
      bz: b.z,
      dx,
      dz,
      rx,
      rz,
      length,
      halfWidth,
      sidewalkWidth: sidewalkWidthFor(def),
      lanes: [],
    };

    // Forward lanes keep to the RIGHT of the centreline (drive-on-right, as in
    // the reference frames). Backward lanes mirror them.
    for (let i = 0; i < def.lanesForward; i++) {
      const off = LANE_WIDTH * (i + 0.5);
      const lane: Lane = {
        id: `${def.id}:f${i}`,
        edgeId: def.id,
        dir: 1,
        index: i,
        a: { x: a.x + rx * off, z: a.z + rz * off },
        b: { x: b.x + rx * off, z: b.z + rz * off },
        speedLimit,
      };
      built.lanes.push(lane);
      lanes.push(lane);
    }
    for (let i = 0; i < def.lanesBackward; i++) {
      const off = LANE_WIDTH * (i + 0.5);
      const lane: Lane = {
        id: `${def.id}:b${i}`,
        edgeId: def.id,
        dir: -1,
        index: i,
        a: { x: b.x - rx * off, z: b.z - rz * off },
        b: { x: a.x - rx * off, z: a.z - rz * off },
        speedLimit,
      };
      built.lanes.push(lane);
      lanes.push(lane);
    }

    edges.push(built);
  }

  // Intersections are nodes with 3+ incident edges (T or cross).
  const intersections = [...nodes.values()]
    .filter((n) => n.edges.length >= 3)
    .map((n) => {
      const half = Math.max(
        ...n.edges.map((eid) => edges.find((e) => e.id === eid)?.halfWidth ?? 0),
      );
      return { id: n.id, x: n.x, z: n.z, half };
    });

  cached = { nodes, edges, lanes, intersections };
  return cached;
}

// --------------------------------------------------------------------- queries

/** True if the point lies on carriageway or sidewalk of any road. */
export function isOnRoadOrSidewalk(x: number, z: number, pad = 0): boolean {
  const g = getRoadGraph();
  for (const e of g.edges) {
    const w = e.halfWidth + e.sidewalkWidth + pad;
    if (pointNearSegment(x, z, e, w)) return true;
  }
  return false;
}

/** True if the point lies on the drivable carriageway. */
export function isOnCarriageway(x: number, z: number, pad = 0): boolean {
  const g = getRoadGraph();
  for (const e of g.edges) {
    if (pointNearSegment(x, z, e, e.halfWidth + pad)) return true;
  }
  return false;
}

function pointNearSegment(x: number, z: number, e: RoadEdge, halfWidth: number): boolean {
  const px = x - e.ax;
  const pz = z - e.az;
  const along = px * e.dx + pz * e.dz;
  if (along < -halfWidth || along > e.length + halfWidth) return false;
  const lateral = Math.abs(px * e.rx + pz * e.rz);
  return lateral <= halfWidth;
}

/** Nearest lane to a world point, for snapping spawned traffic onto the network. */
export function nearestLane(x: number, z: number): { lane: Lane; t: number; dist: number } | null {
  const g = getRoadGraph();
  let best: { lane: Lane; t: number; dist: number } | null = null;
  for (const lane of g.lanes) {
    const vx = lane.b.x - lane.a.x;
    const vz = lane.b.z - lane.a.z;
    const len2 = vx * vx + vz * vz;
    if (len2 === 0) continue;
    let t = ((x - lane.a.x) * vx + (z - lane.a.z) * vz) / len2;
    t = Math.max(0, Math.min(1, t));
    const cx = lane.a.x + vx * t;
    const cz = lane.a.z + vz * t;
    const dist = Math.hypot(x - cx, z - cz);
    if (!best || dist < best.dist) best = { lane, t, dist };
  }
  return best;
}

// --------------------------------------------------------------------- blocks

export interface CityBlock {
  /** Buildable interior, inset from the kerbs. */
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** Centre, for district classification. */
  cx: number;
  cz: number;
}

/**
 * The buildable rectangles between roads (spec 8).
 *
 * Derived from the same grid as the carriageways, inset by each bounding road's
 * half-width plus its pavement, so a block interior can never overlap a road or
 * a kerb. Generating these instead of hand-listing them is what lets the map
 * grow without the block table drifting out of sync with the streets.
 */
export function getBlocks(): CityBlock[] {
  const graph = getRoadGraph();

  // Gather the distinct road lines actually present, with their widths.
  const vertical = new Map<number, number>();
  const horizontal = new Map<number, number>();
  for (const e of graph.edges) {
    if (e.kind === 'alley') continue;
    const outer = e.halfWidth + e.sidewalkWidth;
    if (Math.abs(e.dz) < 1e-6) {
      horizontal.set(e.az, Math.max(horizontal.get(e.az) ?? 0, outer));
    } else {
      vertical.set(e.ax, Math.max(vertical.get(e.ax) ?? 0, outer));
    }
  }

  const xs = [...vertical.entries()].sort((a, b) => a[0] - b[0]);
  const zs = [...horizontal.entries()].sort((a, b) => a[0] - b[0]);

  const blocks: CityBlock[] = [];
  for (let i = 0; i < xs.length - 1; i++) {
    for (let k = 0; k < zs.length - 1; k++) {
      const [xa, wa] = xs[i]!;
      const [xb, wb] = xs[i + 1]!;
      const [za, ha] = zs[k]!;
      const [zb, hb] = zs[k + 1]!;
      const x0 = xa + wa;
      const x1 = xb - wb;
      const z0 = za + ha;
      const z1 = zb - hb;
      // Skip slivers: a block needs room for a building and its setback.
      if (x1 - x0 < 34 || z1 - z0 < 34) continue;
      blocks.push({ x0, z0, x1, z1, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2 });
    }
  }
  return blocks;
}

/** Rectangles reserved for hand-authored content; blocks avoid them. */
export interface ReservedArea {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export function rectsOverlap(a: ReservedArea, b: ReservedArea, pad = 0) {
  return !(
    a.x1 + pad < b.x0 ||
    a.x0 - pad > b.x1 ||
    a.z1 + pad < b.z0 ||
    a.z0 - pad > b.z1
  );
}
