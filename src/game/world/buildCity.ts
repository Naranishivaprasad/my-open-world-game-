import * as THREE from 'three';
import {
  MeshBuilder,
  boxCollider,
  splitIntoChunks,
  type BoxColliderDef,
  type GeometryChunk,
} from './meshBuilder';
import {
  getBlocks,
  getRoadGraph,
  isOnCarriageway,
  rectsOverlap,
  type ReservedArea,
  type RoadEdge,
} from './roadGraph';
import { chance, hashSeed, makeRng, pick, randInt, randRange, type Rng } from '../core/rng';
import { CAR_KEYS, VEHICLE_TYPES, pickVehicleKey, type VehicleKey } from './vehicleGeometry';

/** Body classes that park on pavements and promenades rather than in lanes. */
const BIKE_KEYS: VehicleKey[] = ['motorcycle', 'scooter'];
import {
  ACCENT_COLORS,
  FACADE_COLORS,
  GROUND_HALF,
  KERB_HEIGHT,
  LANE_WIDTH,
  MARKING_Y,
  ROOF_COLORS,
  SIDEWALK_Y,
  SEA_LEVEL,
  SEA_X,
  BEACH,
  PROMENADE_X,
  SHORE_X,
  WATER_TOWER,
  WORLD_HALF,
} from '../config/world';

/**
 * Builds the entire static city once, deterministically, from the road graph.
 *
 * This is a PURE function of its seed (spec 33: the city must not rearrange
 * itself because a menu re-rendered). It produces merged geometry plus the
 * matching collider list, so the visual road and the physical road cannot
 * disagree (spec 20).
 */

export interface PropInstance {
  x: number;
  y: number;
  z: number;
  rotY: number;
  scale: number;
  /** Per-instance tint, applied via InstancedMesh.setColorAt. */
  color?: string;
}

/** Surface classes, each drawn with one shared material. */
export type SurfaceKey =
  | 'ground'
  | 'road'
  | 'sidewalk'
  | 'markings'
  | 'facade'
  | 'roof'
  | 'metal'
  | 'glass'
  | 'accent'
  | 'sand';

export interface CityBuild {
  /**
   * Geometry split into spatial chunks per surface class, so the renderer can
   * frustum-cull districts the player cannot see (spec 34).
   */
  geometry: Record<SurfaceKey, GeometryChunk[]>;
  colliders: BoxColliderDef[];
  props: {
    streetlight: PropInstance[];
    utilityPole: PropInstance[];
    bin: PropInstance[];
    bench: PropInstance[];
    hydrant: PropInstance[];
    bollard: PropInstance[];
    cone: PropInstance[];
    acUnit: PropInstance[];
    /** Parked vehicles, grouped by body class so each gets one instanced mesh. */
    parkedVehicles: Record<VehicleKey, PropInstance[]>;
  };
  vegetation: {
    palm: PropInstance[];
    shrub: PropInstance[];
  };
  stats: {
    triangles: number;
    colliders: number;
    buildings: number;
  };
}

/**
 * Side of a geometry chunk, metres.
 *
 * Small chunks cull better but cost more draw calls; large ones the reverse.
 * Measured on the expanded map, the view is neither draw-call nor triangle
 * bound: a seaward view costing 267 calls and 1.0M triangles runs at the same
 * frame rate as a downtown view costing 187 and 0.88M, and disabling the
 * shadow map halves both counts without changing the frame rate at all. 260 m
 * is therefore a comfortable middle rather than a tuned optimum.
 */
export const CHUNK_SIZE = 260;

const TILE = {
  asphalt: 6,
  concrete: 3,
  facade: 4,
  roof: 3,
  metal: 2.5,
  grass: 8,
};

const MARK_WHITE = '#e8e6de';
const MARK_YELLOW = '#e0b83a';

/** Sun-faded paint colours typical of a coastal town (refs 1, 3, 4). */
const CAR_COLORS = [
  '#b8453a', '#d8d5cf', '#2f3f52', '#7a8288', '#264a3d',
  '#c9b184', '#3b3f45', '#8c5a3c', '#5d6e84', '#a8aeb2',
];

/**
 * Place a parked vehicle of a randomly chosen body class.
 *
 * Only axis-aligned orientations are used so the collider stays a plain AABB
 * that matches the visual bounds exactly (spec 20). The collider is sized from
 * the chosen class, so a van no longer shares a saloon's footprint.
 */
function addParkedCar(
  rng: Rng,
  props: CityBuild['props'],
  colliders: BoxColliderDef[],
  x: number,
  z: number,
  alongZ: boolean,
  keys: VehicleKey[] = CAR_KEYS,
) {
  const key = pickVehicleKey(rng(), keys);
  const spec = VEHICLE_TYPES[key];
  const index = props.parkedVehicles[key].length;
  props.parkedVehicles[key].push({
    x,
    y: 0,
    z,
    rotY: alongZ ? Math.PI / 2 : 0,
    scale: 1,
    color: pick(rng, CAR_COLORS),
  });
  const sx = alongZ ? spec.width : spec.length;
  const sz = alongZ ? spec.length : spec.width;
  const col = boxCollider(x, spec.height / 2, z, sx, spec.height, sz);
  col.parked = { key, index };
  colliders.push(col);
}

/** Horizontal edges run along X; vertical edges run along Z. All axis-aligned. */
const isHorizontal = (e: RoadEdge) => Math.abs(e.dz) < 1e-6;

export function buildCity(seed = hashSeed('palm-coast-v1')): CityBuild {
  const rng = makeRng(seed);
  const graph = getRoadGraph();

  const ground = new MeshBuilder();
  const road = new MeshBuilder();
  const sidewalk = new MeshBuilder();
  const markings = new MeshBuilder({ vertexColors: true });
  const facade = new MeshBuilder({ vertexColors: true });
  const roof = new MeshBuilder({ vertexColors: true });
  const metal = new MeshBuilder({ vertexColors: true });
  const glass = new MeshBuilder({ vertexColors: true });
  const accent = new MeshBuilder({ vertexColors: true });
  const sand = new MeshBuilder();

  const colliders: BoxColliderDef[] = [];
  const props: CityBuild['props'] = {
    streetlight: [],
    utilityPole: [],
    bin: [],
    bench: [],
    hydrant: [],
    bollard: [],
    cone: [],
    acUnit: [],
    parkedVehicles: Object.fromEntries(
      (Object.keys(VEHICLE_TYPES) as VehicleKey[]).map((k) => [k, [] as PropInstance[]]),
    ) as Record<VehicleKey, PropInstance[]>,
  };
  const vegetation: CityBuild['vegetation'] = { palm: [], shrub: [] };
  /** Driveway slots collected during the frontage pass. */
  const parkedDriveway: { x: number; z: number; alongZ: boolean }[] = [];
  let buildingCount = 0;

  // ---------------------------------------------------------------- ground

  // Large base plane so the horizon is never an empty void (spec 8).
  // Land stops at the promenade: east of it the beach provides the surface.
  ground.addFloor(-GROUND_HALF, -GROUND_HALF, PROMENADE_X, GROUND_HALF, -0.06, TILE.grass);

  // ------------------------------------------------------- road trim helper

  /**
   * How far an edge must stop short of a node so it does not overlap the
   * crossing carriageway. Returns 0 at map termini.
   */
  function trimAt(nodeId: string, self: RoadEdge): number {
    const node = graph.nodes.get(nodeId);
    if (!node) return 0;
    let t = 0;
    for (const eid of node.edges) {
      if (eid === self.id) continue;
      const other = graph.edges.find((e) => e.id === eid);
      if (!other) continue;
      // Only perpendicular roads cut this one.
      if (isHorizontal(other) !== isHorizontal(self)) t = Math.max(t, other.halfWidth);
    }
    return t;
  }

  /** Trimmed extent of an edge along its own axis. */
  function extentOf(e: RoadEdge) {
    const tA = trimAt(e.from, e);
    const tB = trimAt(e.to, e);
    if (isHorizontal(e)) {
      const lo = Math.min(e.ax, e.bx) + (e.ax < e.bx ? tA : tB);
      const hi = Math.max(e.ax, e.bx) - (e.ax < e.bx ? tB : tA);
      return { lo, hi, fixed: e.az };
    }
    const lo = Math.min(e.az, e.bz) + (e.az < e.bz ? tA : tB);
    const hi = Math.max(e.az, e.bz) - (e.az < e.bz ? tB : tA);
    return { lo, hi, fixed: e.ax };
  }

  // ------------------------------------------------------ roads + sidewalks

  for (const e of graph.edges) {
    const { lo, hi, fixed } = extentOf(e);
    if (hi <= lo) continue;
    const H = e.halfWidth;
    const S = e.sidewalkWidth;

    if (isHorizontal(e)) {
      road.addFloor(lo, fixed - H, hi, fixed + H, 0, TILE.asphalt);
      if (S > 0) {
        addSidewalkSlab(sidewalk, colliders, lo, fixed - H - S, hi, fixed - H);
        addSidewalkSlab(sidewalk, colliders, lo, fixed + H, hi, fixed + H + S);
      }
    } else {
      road.addFloor(fixed - H, lo, fixed + H, hi, 0, TILE.asphalt);
      if (S > 0) {
        addSidewalkSlab(sidewalk, colliders, fixed - H - S, lo, fixed - H, hi);
        addSidewalkSlab(sidewalk, colliders, fixed + H, lo, fixed + H + S, hi);
      }
    }

    addLaneMarkings(markings, e, lo, hi, fixed);
  }

  // -------------------------------------------- intersections + corner kerbs

  for (const node of graph.nodes.values()) {
    if (node.edges.length < 3) continue;
    let hEW = 0;
    let hNS = 0;
    let sEW = 0;
    let sNS = 0;
    for (const eid of node.edges) {
      const e = graph.edges.find((x) => x.id === eid);
      if (!e) continue;
      if (isHorizontal(e)) {
        hEW = Math.max(hEW, e.halfWidth);
        sEW = Math.max(sEW, e.sidewalkWidth);
      } else {
        hNS = Math.max(hNS, e.halfWidth);
        sNS = Math.max(sNS, e.sidewalkWidth);
      }
    }
    if (hEW === 0 || hNS === 0) continue;

    // Carriageway patch filling the junction.
    road.addFloor(node.x - hNS, node.z - hEW, node.x + hNS, node.z + hEW, 0, TILE.asphalt);

    // Four corner kerb blocks.
    if (sEW > 0 && sNS > 0) {
      for (const sx of [-1, 1] as const) {
        for (const sz of [-1, 1] as const) {
          const x0 = node.x + sx * hNS;
          const z0 = node.z + sz * hEW;
          addSidewalkSlab(
            sidewalk,
            colliders,
            Math.min(x0, x0 + sx * sNS),
            Math.min(z0, z0 + sz * sEW),
            Math.max(x0, x0 + sx * sNS),
            Math.max(z0, z0 + sz * sEW),
          );
        }
      }
    }

    addCrosswalks(markings, node.x, node.z, hEW, hNS);

    // Streetlights on opposing corners (ref 5, ref 7).
    props.streetlight.push(
      { x: node.x - hNS - 1.4, y: 0, z: node.z - hEW - 1.4, rotY: Math.PI * 0.25, scale: 1 },
      { x: node.x + hNS + 1.4, y: 0, z: node.z + hEW + 1.4, rotY: Math.PI * 1.25, scale: 1 },
    );
  }

  // ------------------------------------------------------------- districts

  /*
   * Blocks come from the road grid, so they can never overlap a carriageway,
   * and the district each one belongs to is decided by WHERE it is rather than
   * by a hand-written list. Hand-authored places (the gas station, the parking
   * lot, the water-tower yard, the beach) are reserved and skipped.
   */
  const reserved: ReservedArea[] = [
    { x0: 88, z0: -92, x1: 180, z1: -14 }, // Sunfuel gas station
    { x0: 92, z0: 10, x1: 180, z1: 100 }, // parking lot + mural wall
    { x0: -200, z0: 40, x1: -130, z1: 110 }, // water-tower yard + delivery
    { x0: SHORE_X - 24, z0: -WORLD_HALF, x1: WORLD_HALF, z1: WORLD_HALF }, // beach and sea
  ];

  for (const block of getBlocks()) {
    if (reserved.some((r) => rectsOverlap(block, r, 2))) continue;

    const district = districtFor(block.cx, block.cz);
    buildingCount += buildFrontages(rng, {
      facade, roof, glass, accent, metal, colliders, props, vegetation, parkedDriveway,
      rect: [block.x0, block.z0, block.x1, block.z1],
      // Every side of a grid block faces a street.
      sides: { south: true, north: true, west: true, east: true },
      district,
    });
  }

  // ------------------------------------------------------ bespoke landmarks

  addParkingLot(rng, { road, markings, facade, roof, glass, accent, metal, colliders, props, vegetation, parkedDriveway });
  addGasStation(rng, { road, markings, facade, roof, glass, accent, metal, colliders, props, vegetation, parkedDriveway });
  // Driveway cars, emitted after the frontage pass so they never land on a road.
  for (const slot of parkedDriveway) {
    if (isOnCarriageway(slot.x, slot.z, 1.4)) continue;
    addParkedCar(rng, props, colliders, slot.x, slot.z, slot.alongZ);
  }

  addCoast(rng, sand, accent, metal, props, vegetation, colliders);
  addWaterTower(metal, accent, colliders);
  addBoundary(rng, { metal, accent, colliders, vegetation, ground });

  // ------------------------------------------------------- street furniture

  addStreetFurniture(rng, graph, props, vegetation, colliders);

  // ------------------------------------------------------------------ done

  const geometry: Record<SurfaceKey, GeometryChunk[]> = {
    // The ground plane is two triangles covering everything; chunking it would
    // achieve nothing, so it stays whole.
    ground: [{ cx: 0, cz: 0, geometry: ground.build() }],
    road: splitIntoChunks(road.build(), CHUNK_SIZE),
    sidewalk: splitIntoChunks(sidewalk.build(), CHUNK_SIZE),
    markings: splitIntoChunks(markings.build(), CHUNK_SIZE),
    facade: splitIntoChunks(facade.build(), CHUNK_SIZE),
    roof: splitIntoChunks(roof.build(), CHUNK_SIZE),
    metal: splitIntoChunks(metal.build(), CHUNK_SIZE),
    glass: splitIntoChunks(glass.build(), CHUNK_SIZE),
    accent: splitIntoChunks(accent.build(), CHUNK_SIZE),
    sand: splitIntoChunks(sand.build(), CHUNK_SIZE),
  };

  const triangles =
    ground.triangleCount +
    road.triangleCount +
    sidewalk.triangleCount +
    markings.triangleCount +
    facade.triangleCount +
    roof.triangleCount +
    metal.triangleCount +
    glass.triangleCount +
    accent.triangleCount +
    sand.triangleCount;

  return {
    geometry,
    colliders,
    props,
    vegetation,
    stats: { triangles, colliders: colliders.length, buildings: buildingCount },
  };
}

// ============================================================ sub-builders

/** Raised concrete slab with a visible kerb face, plus its step-up collider. */
function addSidewalkSlab(
  mb: MeshBuilder,
  colliders: BoxColliderDef[],
  x0: number,
  z0: number,
  x1: number,
  z1: number,
) {
  const sx = x1 - x0;
  const sz = z1 - z0;
  if (sx <= 0.01 || sz <= 0.01) return;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  mb.addBox(cx, KERB_HEIGHT / 2, cz, sx, KERB_HEIGHT, sz, TILE.concrete, undefined, { bottom: false });
  colliders.push(boxCollider(cx, KERB_HEIGHT / 2, cz, sx, KERB_HEIGHT, sz));
}

/** An axis-aligned painted stripe on the road surface. */
function addStripe(
  mb: MeshBuilder,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  color: string,
) {
  mb.addFloor(x0, z0, x1, z1, MARKING_Y, 1, color);
}

function addLaneMarkings(mb: MeshBuilder, e: RoadEdge, lo: number, hi: number, fixed: number) {
  if (e.kind === 'alley') return;
  const H = e.halfWidth;
  const horiz = isHorizontal(e);

  const stripe = (offset: number, halfW: number, color: string, a: number, b: number) => {
    if (horiz) addStripe(mb, a, fixed + offset - halfW, b, fixed + offset + halfW, color);
    else addStripe(mb, fixed + offset - halfW, a, fixed + offset + halfW, b, color);
  };

  // Solid edge lines just inside the kerb.
  stripe(-(H - 0.25), 0.06, MARK_WHITE, lo, hi);
  stripe(H - 0.25, 0.06, MARK_WHITE, lo, hi);

  if (e.centreLine === 'double-yellow') {
    // Two solid yellow lines, 0.2 m apart (ref 3).
    stripe(-0.16, 0.055, MARK_YELLOW, lo, hi);
    stripe(0.16, 0.055, MARK_YELLOW, lo, hi);
    // Dashed white between the two same-direction lanes on each side.
    dashed(mb, horiz, fixed, -LANE_WIDTH, 0.055, MARK_WHITE, lo, hi);
    dashed(mb, horiz, fixed, LANE_WIDTH, 0.055, MARK_WHITE, lo, hi);
  } else {
    dashed(mb, horiz, fixed, 0, 0.06, MARK_YELLOW, lo, hi);
  }
}

function dashed(
  mb: MeshBuilder,
  horiz: boolean,
  fixed: number,
  offset: number,
  halfW: number,
  color: string,
  lo: number,
  hi: number,
) {
  const DASH = 3;
  const GAP = 5;
  for (let t = lo + GAP; t < hi - DASH; t += DASH + GAP) {
    const a = t;
    const b = Math.min(t + DASH, hi - 0.5);
    if (horiz) addStripe(mb, a, fixed + offset - halfW, b, fixed + offset + halfW, color);
    else addStripe(mb, fixed + offset - halfW, a, fixed + offset + halfW, b, color);
  }
}

/** Zebra crossings and stop bars on every approach to a junction (ref 7). */
function addCrosswalks(mb: MeshBuilder, x: number, z: number, hEW: number, hNS: number) {
  const BAND = 2.6;
  const STRIPE_W = 0.5;
  const GAP = 0.45;

  // North and south approaches (crossing the E-W road).
  for (const sz of [-1, 1] as const) {
    const zc = z + sz * (hEW + 0.45);
    for (let sx = -hNS + 0.4; sx < hNS - 0.4; sx += STRIPE_W + GAP) {
      addStripe(mb, sx + x, zc - BAND / 2, sx + x + STRIPE_W, zc + BAND / 2, MARK_WHITE);
    }
  }
  // East and west approaches (crossing the N-S road).
  for (const sx of [-1, 1] as const) {
    const xc = x + sx * (hNS + 0.45);
    for (let sz = -hEW + 0.4; sz < hEW - 0.4; sz += STRIPE_W + GAP) {
      addStripe(mb, xc - BAND / 2, sz + z, xc + BAND / 2, sz + z + STRIPE_W, MARK_WHITE);
    }
  }
}

// ------------------------------------------------------------- buildings

interface BuildCtx {
  /** Driveway car slots, filled in after the frontage pass. */
  parkedDriveway: { x: number; z: number; alongZ: boolean }[];
  facade: MeshBuilder;
  roof: MeshBuilder;
  glass: MeshBuilder;
  accent: MeshBuilder;
  metal: MeshBuilder;
  colliders: BoxColliderDef[];
  props: CityBuild['props'];
  vegetation: CityBuild['vegetation'];
}

export type District = 'commercial' | 'residential' | 'industrial' | 'downtown' | 'seafront';

/**
 * Which district a block belongs to, from its position (spec 8: a coherent,
 * readable neighbourhood rather than uniform blocks everywhere).
 */
export function districtFor(cx: number, cz: number): District {
  // The strip behind Ocean Drive: low-rise seafront apartments and hotels.
  if (cx > 250) return 'seafront';
  // Around the Palm / Harbor crossing: the tallest commercial frontage.
  if (cx > 90 && Math.abs(cz) < 90) return 'downtown';
  // North of Dock Street is the working end of town.
  if (cz > 150) return 'industrial';
  // South of Coral Lane is housing.
  if (cz < -140) return 'residential';
  return 'commercial';
}

const DISTRICT_SPEC: Record<
  District,
  { width: [number, number]; depth: [number, number]; storeys: [number, number]; setback: number }
> = {
  commercial: { width: [11, 22], depth: [14, 22], storeys: [1, 3], setback: 0.8 },
  residential: { width: [12, 18], depth: [11, 15], storeys: [1, 2], setback: 4.5 },
  industrial: { width: [20, 34], depth: [18, 28], storeys: [1, 2], setback: 2.5 },
  downtown: { width: [14, 26], depth: [16, 26], storeys: [3, 8], setback: 0.6 },
  seafront: { width: [13, 22], depth: [14, 20], storeys: [2, 5], setback: 3.2 },
};

const STOREY = 3.3;

/**
 * Walks each street-facing side of a block rectangle placing buildings that
 * front the pavement, with varied widths, depths and heights (spec 9).
 */
function buildFrontages(
  rng: Rng,
  opts: BuildCtx & {
    rect: [number, number, number, number];
    sides: { north?: boolean; south?: boolean; east?: boolean; west?: boolean };
    district: District;
  },
): number {
  const [x0, z0, x1, z1] = opts.rect;
  const spec = DISTRICT_SPEC[opts.district];
  let count = 0;

  const runSide = (
    axis: 'x' | 'z',
    fixed: number,
    from: number,
    to: number,
    /** +1 means the building extends toward increasing fixed-axis value. */
    inward: 1 | -1,
  ) => {
    let t = from + randRange(rng, 1, 4);
    while (t < to - spec.width[0]) {
      const w = Math.min(randRange(rng, spec.width[0], spec.width[1]), to - t);
      if (w < spec.width[0] * 0.8) break;
      const d = randRange(rng, spec.depth[0], spec.depth[1]);
      const storeys = randInt(rng, spec.storeys[0], spec.storeys[1]);
      const h = storeys * STOREY;

      const centreAlong = t + w / 2;
      const centreFixed = fixed + inward * (spec.setback + d / 2);

      const bx = axis === 'x' ? centreAlong : centreFixed;
      const bz = axis === 'x' ? centreFixed : centreAlong;
      const sx = axis === 'x' ? w : d;
      const sz = axis === 'x' ? d : w;

      addBuilding(rng, opts, bx, bz, sx, sz, h, storeys, opts.district, axis, -inward as 1 | -1);
      count++;

      // A gap between lots: alley slot, yard, or loading bay.
      t += w + randRange(rng, 1.5, opts.district === 'residential' ? 8 : 4);
    }
  };

  if (opts.sides.south) runSide('x', z0, x0, x1, 1); // fronts the road at z0, extends +z
  if (opts.sides.north) runSide('x', z1, x0, x1, -1);
  if (opts.sides.west) runSide('z', x0, z0, z1, 1);
  if (opts.sides.east) runSide('z', x1, z0, z1, -1);

  return count;
}

/** Multiply a hex colour toward black (k<1) or white (k>1), clamped. */
function shade(hex: string, k: number): string {
  const c = new THREE.Color(hex);
  c.r = Math.min(1, c.r * k);
  c.g = Math.min(1, c.g * k);
  c.b = Math.min(1, c.b * k);
  return `#${c.getHexString()}`;
}

/**
 * One exposed wall of a building.
 *
 * `span` is the axis the wall RUNS ALONG; its outward normal is therefore on
 * the other horizontal axis, pointing in `dir`.
 */
interface Face {
  span: 'x' | 'z';
  dir: 1 | -1;
}

/**
 * One building, detailed as real street architecture rather than a painted box
 * (spec 9, art direction refs 1-5).
 *
 * From the ground up: a plinth, a ground floor that is either a glazed
 * shopfront with a signage band or a domestic wall, glazing bands with proud
 * sills, lintels and mullions on ALL FOUR sides, corner pilasters, a
 * projecting cornice, then a parapet roof with clutter.
 *
 * The previous version windowed only the street-facing wall, so any building
 * seen from an alley, a corner or across a block read as a blank slab.
 *
 * TRIANGLE BUDGET: mullions dominate the cost and stop being resolvable a few
 * storeys up, so above `MULLION_STOREYS` the glazing is divided half as often.
 */
function addBuilding(
  rng: Rng,
  ctx: BuildCtx,
  cx: number,
  cz: number,
  sx: number,
  sz: number,
  h: number,
  storeys: number,
  district: District,
  frontAxis: 'x' | 'z',
  /** Direction from the building centre toward the street. */
  frontDir: 1 | -1,
) {
  const colour = pick(rng, FACADE_COLORS);
  const roofColour = pick(rng, ROOF_COLORS);
  const trim = shade(colour, chance(rng, 0.5) ? 1.14 : 0.82);
  const accent = pick(rng, ACCENT_COLORS);
  const glassTint = pick(rng, ['#2b3440', '#31404b', '#26323c', '#3a4a55']);

  // The front wall runs along `frontAxis`; its normal points at the street.
  const front: Face = { span: frontAxis, dir: frontDir };
  const faces: Face[] = [
    { span: 'x', dir: 1 },
    { span: 'x', dir: -1 },
    { span: 'z', dir: 1 },
    { span: 'z', dir: -1 },
  ];
  const isFront = (f: Face) => f.span === front.span && f.dir === front.dir;

  /** World point at `along` metres across the face and `out` metres proud. */
  const at = (f: Face, along: number, out: number) =>
    f.span === 'x'
      ? { x: cx + along, z: cz + f.dir * (sz / 2 + out) }
      : { x: cx + f.dir * (sx / 2 + out), z: cz + along };

  /** Half-width of a face, along its span axis. */
  const halfSpan = (f: Face) => (f.span === 'x' ? sx / 2 : sz / 2);

  /** A box sitting on a face, spanning `out` .. `out + outSize` outward. */
  const faceBox = (
    mb: MeshBuilder,
    f: Face,
    alongCentre: number,
    alongSize: number,
    yCentre: number,
    ySize: number,
    out: number,
    outSize: number,
    col: string,
    tile = TILE.facade,
  ) => {
    const p = at(f, alongCentre, out + outSize / 2);
    const bx = f.span === 'x' ? alongSize : outSize;
    const bz = f.span === 'x' ? outSize : alongSize;
    // The inward face is buried in the wall, so it is never emitted.
    const hide =
      f.span === 'x'
        ? f.dir === 1
          ? { nz: false }
          : { pz: false }
        : f.dir === 1
          ? { nx: false }
          : { px: false };
    mb.addBox(p.x, yCentre, p.z, bx, ySize, bz, tile, col, { bottom: true, ...hide });
  };

  /**
   * A flat quad on a face, wound counter-clockwise as seen from outside.
   *
   * The CCW direction along the face flips with the normal, which is why the
   * corners swap: the +z face runs with +x, but the +x face runs with -z.
   */
  const faceQuad = (
    mb: MeshBuilder,
    f: Face,
    a0: number,
    a1: number,
    y0: number,
    y1: number,
    out: number,
    col: string,
  ) => {
    const ccw = f.span === 'x' ? f.dir : -f.dir;
    const lo = ccw > 0 ? a0 : a1;
    const hi = ccw > 0 ? a1 : a0;
    const pt = (along: number, y: number) => {
      const w = at(f, along, out);
      return { x: w.x, y, z: w.z };
    };
    mb.addQuad(pt(lo, y0), pt(hi, y0), pt(hi, y1), pt(lo, y1), 1.2, col);
  };

  // --------------------------------------------------------------- shell
  ctx.facade.addBox(cx, h / 2, cz, sx, h, sz, TILE.facade, colour, { top: false, bottom: false });

  // -------------------------------------------------------------- plinth
  // A darker base band, slightly proud, so the wall does not run straight
  // into the pavement.
  const PLINTH = district === 'industrial' ? 1.3 : 0.85;
  ctx.facade.addBox(cx, PLINTH / 2, cz, sx + 0.22, PLINTH, sz + 0.22, TILE.facade, shade(colour, 0.7), {
    top: true,
    bottom: false,
  });

  // ----------------------------------------------------- corner pilasters
  const pilasters = district === 'downtown' || district === 'commercial';
  if (pilasters) {
    const pw = 0.55;
    for (const ox of [-1, 1] as const) {
      for (const oz of [-1, 1] as const) {
        ctx.facade.addBox(
          cx + ox * (sx / 2 + 0.07),
          (PLINTH + h) / 2,
          cz + oz * (sz / 2 + 0.07),
          pw,
          h - PLINTH,
          pw,
          TILE.facade,
          trim,
          { bottom: false },
        );
      }
    }
  }

  // -------------------------------------------------------------- glazing
  const shopfront = district === 'commercial' || district === 'downtown' || district === 'seafront';
  const MULLION_STOREYS = 2;

  // Downtown towers and seafront blocks are seen from every side - from across
  // a junction, from the promenade, from the water - so they are glazed all
  // round. Low-rise rear elevations back onto yards and alleys, so glazing
  // them costs triangles for a wall almost nobody gets to see.
  const glazeAllSides = district === 'downtown' || district === 'seafront';

  for (const f of faces) {
    const isRear = f.span === front.span && f.dir !== front.dir;
    if (isRear && !glazeAllSides) continue;
    const hs = halfSpan(f);
    // Keep glazing clear of the corner pilasters.
    const margin = pilasters ? 1.15 : 0.9;
    const usable = hs * 2 - margin * 2;
    if (usable < 1.6) continue;

    for (let s = 0; s < storeys; s++) {
      const yFloor = s * STOREY;
      const ground = s === 0;

      // ---- ground floor shopfront: tall glazing, bulkhead, signage band
      if (ground && shopfront && isFront(f)) {
        const gy0 = PLINTH + 0.05;
        const gy1 = STOREY - 0.75;
        faceQuad(ctx.glass, f, -usable / 2, usable / 2, gy0, gy1, 0.03, '#1c232b');
        faceBox(ctx.accent, f, 0, usable + 0.5, gy0 - 0.04, 0.3, 0.02, 0.14, trim);
        faceBox(ctx.accent, f, 0, usable + 0.5, gy1 + 0.1, 0.22, 0.02, 0.16, trim);
        // Signage band in a saturated accent (refs 1, 5).
        faceBox(ctx.accent, f, 0, hs * 2 - 0.3, STOREY - 0.36, 0.62, 0.02, 0.22, accent, 2);
        const bays = Math.max(2, Math.round(usable / 2.6));
        for (let i = 1; i < bays; i++) {
          const a = -usable / 2 + (usable * i) / bays;
          faceBox(ctx.accent, f, a, 0.14, (gy0 + gy1) / 2, gy1 - gy0, 0.02, 0.12, trim);
        }
        continue;
      }

      // ---- everything else: a glazing band with a proud frame
      const winH = 1.45;
      const yMid = yFloor + (ground ? PLINTH + 0.55 : 1.05) + winH / 2;
      if (yMid + winH / 2 > h - 0.75) continue;

      faceQuad(ctx.glass, f, -usable / 2, usable / 2, yMid - winH / 2, yMid + winH / 2, 0.03, glassTint);
      // Sill below and lintel above, both projecting so the glass reads inset.
      faceBox(ctx.facade, f, 0, usable + 0.55, yMid - winH / 2 - 0.09, 0.18, 0.02, 0.17, trim);
      if (s < MULLION_STOREYS) {
        faceBox(ctx.facade, f, 0, usable + 0.55, yMid + winH / 2 + 0.07, 0.14, 0.02, 0.13, trim);
      }

      // Mullions. Above a few storeys they are sub-pixel, so halve them.
      const step = s < MULLION_STOREYS ? 2.3 : 4.6;
      const bays = Math.max(1, Math.round(usable / step));
      for (let i = 1; i < bays; i++) {
        const a = -usable / 2 + (usable * i) / bays;
        faceBox(ctx.facade, f, a, 0.13, yMid, winH, 0.02, 0.11, trim);
      }
    }
  }

  // -------------------------------------------------------- string course
  // A thin band at each floor line on tall buildings, so storeys still read
  // from a distance once the mullions have thinned out.
  if (district === 'downtown') {
    for (let s = 1; s < storeys; s++) {
      const y = s * STOREY - 0.1;
      if (y > h - 0.6) break;
      ctx.facade.addBox(cx, y, cz, sx + 0.16, 0.16, sz + 0.16, TILE.facade, trim, { bottom: true });
    }
  }

  // ------------------------------------------------------------ balconies
  // Seafront apartments get projecting slabs with railings (refs 3, 4).
  if (district === 'seafront' && storeys >= 2) {
    const w = halfSpan(front) * 2 - 1.8;
    if (w >= 2) {
      for (let s = 1; s < storeys; s++) {
        const y = s * STOREY;
        const D = 1.25;
        faceBox(ctx.accent, front, 0, w, y + 0.07, 0.14, 0.0, D, shade(colour, 0.9));
        faceBox(ctx.metal, front, 0, w, y + 0.55, 0.08, D - 0.06, 0.06, '#8c9298', TILE.metal);
        for (const side of [-1, 1] as const) {
          faceBox(ctx.metal, front, (side * w) / 2, 0.06, y + 0.55, 0.08, 0.0, D, '#8c9298', TILE.metal);
          faceBox(ctx.metal, front, (side * w) / 2, 0.06, y + 0.3, 0.5, D - 0.06, 0.06, '#8c9298', TILE.metal);
        }
      }
    }
  }

  // -------------------------------------------------------------- cornice
  // A projecting band under the parapet: the cheapest single detail that
  // stops a facade reading as an extruded rectangle.
  ctx.facade.addBox(cx, h - 0.3, cz, sx + 0.42, 0.44, sz + 0.42, TILE.facade, trim, { top: true, bottom: true });

  // --------------------------------------------------------- roof + crown
  const deck = (dx: number, dz: number, dsx: number, dsz: number, y: number) => {
    ctx.roof.addFloor(dx - dsx / 2, dz - dsz / 2, dx + dsx / 2, dz + dsz / 2, y, TILE.roof, roofColour);
    const P = 0.5;
    ctx.roof.addBox(dx, y + P / 2, dz - dsz / 2 + 0.12, dsx, P, 0.24, TILE.roof, roofColour, { bottom: false });
    ctx.roof.addBox(dx, y + P / 2, dz + dsz / 2 - 0.12, dsx, P, 0.24, TILE.roof, roofColour, { bottom: false });
    ctx.roof.addBox(dx - dsx / 2 + 0.12, y + P / 2, dz, 0.24, P, dsz, TILE.roof, roofColour, { bottom: false });
    ctx.roof.addBox(dx + dsx / 2 - 0.12, y + P / 2, dz, 0.24, P, dsz, TILE.roof, roofColour, { bottom: false });
  };

  deck(cx, cz, sx, sz, h);

  // Some tall buildings step back to a crown, so the skyline has a silhouette
  // rather than a flat ceiling of equal-height boxes.
  const crownInset = 2.2;
  const csx = sx - crownInset * 2;
  const csz = sz - crownInset * 2;
  const crown = district === 'downtown' && storeys >= 5 && csx > 5 && csz > 5 && chance(rng, 0.55);
  const crownH = crown ? STOREY * randInt(rng, 1, 2) : 0;

  if (crown) {
    ctx.facade.addBox(cx, h + crownH / 2, cz, csx, crownH, csz, TILE.facade, colour, {
      top: false,
      bottom: false,
    });
    for (const f of faces) {
      const usable = (f.span === 'x' ? csx : csz) - 1.6;
      if (usable < 1.6) continue;
      const p =
        f.span === 'x'
          ? { x: cx, z: cz + f.dir * (csz / 2 + 0.03) }
          : { x: cx + f.dir * (csx / 2 + 0.03), z: cz };
      const bx = f.span === 'x' ? usable : 0.02;
      const bz = f.span === 'x' ? 0.02 : usable;
      ctx.glass.addBox(p.x, h + crownH / 2, p.z, Math.max(bx, 0.02), crownH - 1.2, Math.max(bz, 0.02), 1.2, glassTint);
    }
    ctx.facade.addBox(cx, h + crownH - 0.28, cz, csx + 0.38, 0.4, csz + 0.38, TILE.facade, trim, {
      top: true,
      bottom: true,
    });
    deck(cx, cz, csx, csz, h + crownH);
    ctx.colliders.push(boxCollider(cx, h + crownH / 2, cz, csx, crownH, csz));
  }

  // Stair bulkhead: the little hut every real flat roof has.
  if (!crown && district !== 'residential' && chance(rng, 0.7)) {
    const bw = Math.min(3.4, sx * 0.3);
    const bd = Math.min(3.0, sz * 0.3);
    const bh = 2.4;
    ctx.facade.addBox(
      cx + randRange(rng, -sx / 4, sx / 4),
      h + bh / 2,
      cz + randRange(rng, -sz / 5, sz / 5),
      bw,
      bh,
      bd,
      TILE.facade,
      shade(colour, 0.88),
      { bottom: false },
    );
  }

  // Roof clutter: AC units and vents (spec 9).
  const acCount = randInt(rng, 1, district === 'industrial' ? 4 : 3);
  for (let i = 0; i < acCount; i++) {
    ctx.props.acUnit.push({
      x: cx + randRange(rng, -sx / 2 + 1.5, sx / 2 - 1.5),
      y: h,
      z: cz + randRange(rng, -sz / 2 + 1.5, sz / 2 - 1.5),
      rotY: randRange(rng, 0, Math.PI * 2),
      scale: randRange(rng, 0.85, 1.25),
    });
  }

  // Commercial awning over the shopfront (refs 1, 5).
  if ((district === 'commercial' || district === 'seafront') && chance(rng, 0.55)) {
    const aDepth = 1.3;
    const w = halfSpan(front) * 2 * 0.86;
    faceBox(ctx.accent, front, 0, w, STOREY - 0.95, 0.14, 0.02, aDepth, accent, 2);
    for (const side of [-1, 1] as const) {
      faceBox(ctx.metal, front, (side * w) / 2.6, 0.06, STOREY - 0.6, 0.06, 0.02, aDepth, '#8c9298', TILE.metal);
    }
  }

  // Collider matches the visual shell exactly.
  ctx.colliders.push(boxCollider(cx, h / 2, cz, sx, h, sz));

  const frontFixed = frontAxis === 'x' ? cz + frontDir * (sz / 2) : cx + frontDir * (sx / 2);

  // A car on the driveway, parked in the setback rather than on the street.
  if (district === 'residential' && chance(rng, 0.45)) {
    const driveFixed = frontFixed + frontDir * 2.4;
    const along = randRange(rng, -sx / 4, sx / 4);
    ctx.parkedDriveway.push({
      x: frontAxis === 'x' ? cx + along : driveFixed,
      z: frontAxis === 'x' ? driveFixed : cz + along,
      alongZ: frontAxis === 'x',
    });
  }

  // Residential lots get a shrub or two in the setback.
  if (district === 'residential' && chance(rng, 0.8)) {
    const yardFixed = frontFixed + frontDir * randRange(rng, 1.2, 3.2);
    ctx.vegetation.shrub.push({
      x: frontAxis === 'x' ? cx + randRange(rng, -sx / 3, sx / 3) : yardFixed,
      y: 0,
      z: frontAxis === 'x' ? yardFixed : cz + randRange(rng, -sz / 3, sz / 3),
      rotY: randRange(rng, 0, Math.PI * 2),
      scale: randRange(rng, 0.7, 1.3),
    });
  }
}

// ------------------------------------------------------------ parking lot

/** Parking lot east of Calle Verde, facing a large blank wall (ref 1). */
function addParkingLot(
  rng: Rng,
  ctx: BuildCtx & { road: MeshBuilder; markings: MeshBuilder },
) {
  const x0 = 96;
  const z0 = 14;
  const x1 = 176;
  const z1 = 96;

  ctx.road.addFloor(x0, z0, x1, z1, 0.02, TILE.asphalt);

  // Parking bays in two rows, painted white (ref 1 foreground).
  //
  // 3.0 m rather than a realistic 2.5: the player has to be able to open a
  // door and get into these cars (spec 17), and at 2.7 m a car in the middle
  // of a full row was blocked on BOTH sides and could never be driven away.
  const BAY_W = 3.0;
  const BAY_D = 5.2;
  for (const row of [0, 1]) {
    const zTop = z0 + 10 + row * (BAY_D + 7);
    for (let x = x0 + 5; x < x1 - BAY_W - 5; x += BAY_W) {
      addStripe(ctx.markings, x, zTop, x + 0.12, zTop + BAY_D, MARK_WHITE);
    }
    addStripe(ctx.markings, x0 + 5, zTop + BAY_D, x1 - 5, zTop + BAY_D + 0.12, MARK_WHITE);
  }

  // The big windowless wall the lot faces - a mural surface (ref 1).
  const wallZ = z1 + 1;
  ctx.facade.addBox(136, 5, wallZ, 68, 10, 1.2, TILE.facade, '#cdc6b7', { bottom: false });
  ctx.colliders.push(boxCollider(136, 5, wallZ, 68, 10, 1.2));

  // Low kerb island with planting down the middle of the lot.
  ctx.vegetation.palm.push(
    ...[26, 46, 66].map((dz) => ({
      x: 136,
      y: 0,
      z: z0 + dz,
      rotY: randRange(rng, 0, Math.PI * 2),
      scale: randRange(rng, 0.9, 1.2),
    })),
  );

  // Bollards guarding the lot entrance off Calle Verde.
  for (let i = 0; i < 5; i++) {
    ctx.props.bollard.push({ x: x0 - 0.5, y: 0, z: z0 + 30 + i * 3, rotY: 0, scale: 1 });
  }

  // A bike bay at the head of the lot.
  for (let i = 0; i < 6; i++) {
    if (!chance(rng, 0.7)) continue;
    const key = pickVehicleKey(rng(), BIKE_KEYS);
    const spec = VEHICLE_TYPES[key];
    // Nose-in, side by side. Bikes are ~2.1 m long, so parking them END TO END
    // 1.1 m apart made their colliders overlap, and anything spawned on one sat
    // on top of its neighbour instead of on the road. The gap also has to leave
    // room to get on: packed tighter, mounting one is refused for lack of space.
    const bz = z0 + 4 + i * 1.9;
    const bayIndex = ctx.props.parkedVehicles[key].length;
    ctx.props.parkedVehicles[key].push({
      x: x0 + 8,
      y: 0,
      z: bz,
      rotY: 0,
      scale: 1,
      color: pick(rng, CAR_COLORS),
    });
    const bayCol = boxCollider(x0 + 8, spec.height / 2, bz, spec.length, spec.height, spec.width);
    bayCol.parked = { key, index: bayIndex };
    ctx.colliders.push(bayCol);
  }

  // Park cars in roughly half the bays, so the lot reads as used (ref 1).
  for (const row of [0, 1]) {
    const zTop = z0 + 10 + row * (BAY_D + 7);
    for (let x = x0 + 5; x < x1 - BAY_W - 5; x += BAY_W) {
      if (!chance(rng, 0.62)) continue;
      addParkedCar(rng, ctx.props, ctx.colliders, x + BAY_W / 2, zTop + BAY_D / 2, true);
    }
  }
}

// ------------------------------------------------------------ gas station

/** Forecourt with canopy and pumps - the player's spawn area (ref 4). */
function addGasStation(
  rng: Rng,
  ctx: BuildCtx & { road: MeshBuilder; markings: MeshBuilder },
) {
  const cx = 134;
  const cz = -52;

  // Concrete forecourt apron.
  ctx.road.addFloor(cx - 42, cz - 34, cx + 42, cz + 34, 0.03, TILE.concrete);

  // Canopy: deck on four columns, 5.2 m clear height so a car passes under.
  const CANOPY_Y = 5.4;
  ctx.accent.addBox(cx, CANOPY_Y, cz, 30, 0.85, 17, 3, '#e8e4dc', { bottom: true });
  ctx.accent.addBox(cx, CANOPY_Y - 0.55, cz, 30.6, 0.35, 17.6, 3, '#c8503c', { bottom: true });
  ctx.colliders.push(boxCollider(cx, CANOPY_Y, cz, 30, 0.85, 17));

  for (const dx of [-12, 12]) {
    for (const dz of [-6.2, 6.2]) {
      ctx.metal.addBox(cx + dx, CANOPY_Y / 2, cz + dz, 0.55, CANOPY_Y, 0.55, 2, '#d5d1c8', { bottom: false });
      ctx.colliders.push(boxCollider(cx + dx, CANOPY_Y / 2, cz + dz, 0.55, CANOPY_Y, 0.55));
    }
  }

  // Four pump islands under the canopy.
  for (const dx of [-6.5, 6.5]) {
    for (const dz of [-4, 4]) {
      const px = cx + dx;
      const pz = cz + dz;
      ctx.accent.addBox(px, 0.09, pz, 5.4, 0.18, 1.6, 2, '#b9b3a8', { bottom: false });
      ctx.metal.addBox(px, 0.85, pz, 1.1, 1.5, 0.75, 1.2, '#cfd3d6', { bottom: false });
      ctx.accent.addBox(px, 1.72, pz, 1.16, 0.3, 0.8, 1.2, '#c8503c', { bottom: false });
      ctx.colliders.push(boxCollider(px, 0.85, pz, 1.1, 1.7, 0.75));
    }
  }

  // Shop building on the north edge of the forecourt.
  const sx = cx - 2;
  const sz = cz - 25;
  ctx.facade.addBox(sx, 2.1, sz, 26, 4.2, 11, TILE.facade, '#ded8cb', { top: false, bottom: false });
  ctx.roof.addFloor(sx - 13, sz - 5.5, sx + 13, sz + 5.5, 4.2, TILE.roof, '#6f6a62');
  ctx.accent.addBox(sx, 4.55, sz, 26.6, 0.7, 11.6, 3, '#2f6f7e', { bottom: true });
  ctx.colliders.push(boxCollider(sx, 2.1, sz, 26, 4.2, 11));

  // Shopfront glazing facing the forecourt.
  for (let i = -4; i <= 4; i++) {
    ctx.glass.addBox(sx + i * 2.7, 1.85, sz + 5.56, 2.3, 2.5, 0.05, 1.2, '#20262e');
  }

  // Tall price sign at the roadside (ref 5 pole signs).
  ctx.metal.addBox(cx - 36, 4.5, cz + 16, 0.5, 9, 0.5, 2, '#b8bcc0', { bottom: false });
  ctx.accent.addBox(cx - 36, 10.2, cz + 16, 5.6, 3.4, 0.45, 2, '#c8503c', { bottom: true });
  ctx.colliders.push(boxCollider(cx - 36, 4.5, cz + 16, 0.5, 9, 0.5));

  // Air/water point, bins and a bench make the forecourt feel used.
  ctx.props.bin.push(
    { x: cx + 16, y: 0, z: cz - 15, rotY: 0.4, scale: 1 },
    { x: cx - 16, y: 0, z: cz - 15, rotY: -0.7, scale: 1 },
  );
  ctx.props.bench.push({ x: sx + 10, y: 0, z: sz + 7.4, rotY: 0, scale: 1 });
  ctx.props.bollard.push(
    ...[-10, -5, 0, 5, 10].map((d) => ({ x: cx + d, y: 0, z: cz - 18.5, rotY: 0, scale: 1 })),
  );

  // A few cars parked on the forecourt apron, clear of the pumps and canopy
  // (canopy spans z -8.5..8.5 about cz, pump islands at dz = +/-4).
  for (let i = 0; i < 5; i++) {
    addParkedCar(rng, ctx.props, ctx.colliders, cx + 23, cz - 12 + i * 5.6, false);
  }
  addParkedCar(rng, ctx.props, ctx.colliders, cx - 24, cz + 6, false);

  // Palms around the forecourt edge (ref 4).
  for (let i = 0; i < 9; i++) {
    const angle = (i / 9) * Math.PI * 2;
    ctx.vegetation.palm.push({
      x: cx + Math.cos(angle) * randRange(rng, 33, 40),
      y: 0,
      z: cz + Math.sin(angle) * randRange(rng, 26, 32),
      rotY: randRange(rng, 0, Math.PI * 2),
      scale: randRange(rng, 0.85, 1.25),
    });
  }
}

// ----------------------------------------------------------- water tower

/** The readable landmark, visible across the map (ref 1). */
function addWaterTower(metal: MeshBuilder, accent: MeshBuilder, colliders: BoxColliderDef[]) {
  const { x, z, legHeight, tankRadius } = WATER_TOWER;
  const SPREAD = 5.5;

  for (const dx of [-SPREAD, SPREAD]) {
    for (const dz of [-SPREAD, SPREAD]) {
      metal.addBox(x + dx, legHeight / 2, z + dz, 0.5, legHeight, 0.5, 3, '#9aa0a4', { bottom: false });
      colliders.push(boxCollider(x + dx, legHeight / 2, z + dz, 0.5, legHeight, 0.5));
    }
  }
  // Cross-bracing at two heights.
  for (const y of [legHeight * 0.36, legHeight * 0.72]) {
    metal.addBox(x, y, z - SPREAD, SPREAD * 2, 0.26, 0.26, 3, '#9aa0a4', { bottom: true });
    metal.addBox(x, y, z + SPREAD, SPREAD * 2, 0.26, 0.26, 3, '#9aa0a4', { bottom: true });
    metal.addBox(x - SPREAD, y, z, 0.26, 0.26, SPREAD * 2, 3, '#9aa0a4', { bottom: true });
    metal.addBox(x + SPREAD, y, z, 0.26, 0.26, SPREAD * 2, 3, '#9aa0a4', { bottom: true });
  }

  // Tank: a squat octagonal drum approximated with two stacked boxes and a cap.
  const tankY = legHeight + 4;
  accent.addBox(x, tankY, z, tankRadius * 2, 8, tankRadius * 2, 4, '#b7c3c7', { bottom: true });
  accent.addBox(x, tankY + 4.8, z, tankRadius * 1.5, 1.8, tankRadius * 1.5, 4, '#9fabb0', { bottom: true });
  colliders.push(boxCollider(x, tankY, z, tankRadius * 2, 8, tankRadius * 2));
}

// ----------------------------------------------------------------- coast

/**
 * The seafront: promenade, sloping sand, and the line where it meets the water
 * (spec 8 asks for a believable boundary rather than an invisible wall - here
 * the eastern edge of the map is simply the sea).
 *
 * The sand is built as strips so it can slope smoothly from the promenade down
 * below sea level, which is what makes the waterline read as a shore rather
 * than a cut-off edge.
 */
function addCoast(
  rng: Rng,
  sand: MeshBuilder,
  accent: MeshBuilder,
  metal: MeshBuilder,
  props: CityBuild['props'],
  vegetation: CityBuild['vegetation'],
  colliders: BoxColliderDef[],
) {
  const zFrom = -WORLD_HALF;
  const zTo = WORLD_HALF;
  // Ocean Drive's eastern pavement ends here.
  const promenadeX = BEACH.startX;
  const sandEnd = BEACH.endX;

  const STRIPS = 26;
  const SEG = 34; // metres along the shore per quad, so the slope tessellates

  /**
   * Beach profile: level with the land at the promenade, easing down past the
   * waterline.
   *
   * It has to pass THROUGH sea level rather than stopping above it, because
   * the waterline is wherever the sand drops below the sea surface - that is
   * what makes the sea meet the beach instead of ending at a straight edge.
   */
  const TOP = BEACH.topY;
  const BOTTOM = BEACH.bottomY;
  const heightAt = (x: number) => {
    const t = Math.min(1, Math.max(0, (x - promenadeX) / (sandEnd - promenadeX)));
    return TOP + (BOTTOM - TOP) * t * t;
  };

  for (let i = 0; i < STRIPS; i++) {
    const xa = promenadeX + ((sandEnd - promenadeX) * i) / STRIPS;
    const xb = promenadeX + ((sandEnd - promenadeX) * (i + 1)) / STRIPS;
    const ya = heightAt(xa);
    const yb = heightAt(xb);
    for (let z = zFrom; z < zTo; z += SEG) {
      const z1 = Math.min(z + SEG, zTo);
      sand.addQuad(
        { x: xa, y: ya, z: z1 },
        { x: xb, y: yb, z: z1 },
        { x: xb, y: yb, z },
        { x: xa, y: ya, z },
        7,
      );
    }

    // Each strip gets a slab to stand on. The land collider stops at the
    // promenade, so without these the beach is not walkable at all.
    const midX = (xa + xb) / 2;
    const midY = (ya + yb) / 2;
    colliders.push(
      boxCollider(midX, midY - 1.0, 0, xb - xa + 0.05, 2.0, (zTo - zFrom) + 4),
    );
  }

  // Past the waterline the sea bed keeps falling away, so an invisible barrier
  // stops the player simply walking out to the horizon. There is no swimming.
  const wadeLimit = promenadeX + (sandEnd - promenadeX) * 0.95;
  colliders.push(boxCollider(wadeLimit, 1.2, 0, 1.0, 4.0, (zTo - zFrom) + 4));

  // ------------------------------------------------------------- the pier
  //
  // A timber jetty out over the water. It gives the seafront something to
  // aim at, gives the sea a sense of scale, and is somewhere to stand with
  // water on both sides.
  {
    const pierZ = 46;
    const deckY = 1.55;
    const HALF_W = 3.2;
    const pierEnd = BEACH.endX + 26;

    // Deck.
    accent.addBox(
      (promenadeX + pierEnd) / 2,
      deckY,
      pierZ,
      pierEnd - promenadeX,
      0.26,
      HALF_W * 2,
      3,
      '#9a8467',
      { bottom: true },
    );
    colliders.push(
      boxCollider((promenadeX + pierEnd) / 2, deckY, pierZ, pierEnd - promenadeX, 0.26, HALF_W * 2),
    );

    // Piles, driven down to whatever the sand is doing beneath them.
    for (let x = promenadeX + 4; x < pierEnd; x += 7) {
      for (const s of [-1, 1] as const) {
        const foot = Math.min(heightAt(x), 0) - 0.6;
        const h = deckY - foot;
        metal.addBox(x, foot + h / 2, pierZ + s * (HALF_W - 0.45), 0.34, h, 0.34, TILE.metal, '#6d5c48');
      }
    }

    // Railings down both sides, with a post every few metres.
    for (const s of [-1, 1] as const) {
      const rz = pierZ + s * HALF_W;
      accent.addBox((promenadeX + pierEnd) / 2, deckY + 0.95, rz, pierEnd - promenadeX, 0.1, 0.1, 2, '#8d7a5f');
      accent.addBox((promenadeX + pierEnd) / 2, deckY + 0.58, rz, pierEnd - promenadeX, 0.08, 0.08, 2, '#8d7a5f');
      for (let x = promenadeX + 2; x < pierEnd; x += 3.5) {
        accent.addBox(x, deckY + 0.55, rz, 0.12, 1.06, 0.12, 2, '#8d7a5f');
      }
    }

    // A lamp at the seaward end, and a bench facing the water.
    props.streetlight.push({ x: pierEnd - 3, y: deckY + 0.13, z: pierZ, rotY: Math.PI, scale: 0.9 });
    props.bench.push({ x: pierEnd - 10, y: deckY + 0.13, z: pierZ - 1.6, rotY: 0, scale: 1 });
    props.bin.push({ x: pierEnd - 14, y: deckY + 0.13, z: pierZ + 1.9, rotY: 0, scale: 1 });
  }

  // A low sea wall between the pavement and the sand, with gaps to walk through.
  for (let z = zFrom + 20; z < zTo - 20; z += 46) {
    accent.addBox(promenadeX - 0.6, 0.35, z + 14, 1.2, 0.7, 28, 3, '#cdc6b7', { bottom: false });
    colliders.push(boxCollider(promenadeX - 0.6, 0.35, z + 14, 1.2, 0.7, 28));
  }

  // Palms along the promenade, and bins and benches facing the water.
  for (let z = zFrom + 30; z < zTo - 30; z += randRange(rng, 26, 42)) {
    vegetation.palm.push({
      x: promenadeX - randRange(rng, 3, 7),
      y: 0,
      z,
      rotY: randRange(rng, 0, Math.PI * 2),
      scale: randRange(rng, 0.95, 1.4),
    });
    if (chance(rng, 0.4)) {
      props.bench.push({ x: promenadeX - 3.2, y: 0, z: z + 8, rotY: Math.PI / 2, scale: 1 });
    }
    if (chance(rng, 0.25)) {
      props.bin.push({ x: promenadeX - 3.4, y: 0, z: z - 6, rotY: 0, scale: 1 });
    }
    // Bikes angle-parked against the promenade kerb (ref 3).
    if (chance(rng, 0.5)) {
      const key = pickVehicleKey(rng(), BIKE_KEYS);
      const spec = VEHICLE_TYPES[key];
      const index = props.parkedVehicles[key].length;
      const bikeZ = z + randRange(rng, -8, 8);
      props.parkedVehicles[key].push({
        x: promenadeX - 2.6,
        y: 0,
        z: bikeZ,
        rotY: Math.PI / 2,
        scale: 1,
        color: pick(rng, CAR_COLORS),
      });
      const bikeCol = boxCollider(promenadeX - 2.6, spec.height / 2, bikeZ, spec.width, spec.height, spec.length);
      bikeCol.parked = { key, index };
      colliders.push(bikeCol);
    }
  }
}

// -------------------------------------------------------------- boundary

/**
 * Closes the playable area with construction hoarding and planting instead of
 * an invisible wall or a drop into nothing (spec 8).
 */
function addBoundary(
  rng: Rng,
  ctx: { metal: MeshBuilder; accent: MeshBuilder; colliders: BoxColliderDef[]; vegetation: CityBuild['vegetation']; ground: MeshBuilder },
) {
  const L = WORLD_HALF;
  const H = 2.6;
  const T = 0.3;

  const runFence = (axis: 'x' | 'z', fixed: number) => {
    for (let t = -L; t < L; t += 24) {
      const len = Math.min(24, L - t) - 0.6;
      if (len < 3) continue;
      const cx = axis === 'x' ? t + len / 2 : fixed;
      const cz = axis === 'x' ? fixed : t + len / 2;
      const sx = axis === 'x' ? len : T;
      const sz = axis === 'x' ? T : len;
      ctx.metal.addBox(cx, H / 2, cz, sx, H, sz, TILE.metal, chance(rng, 0.25) ? '#8f9aa0' : '#a7aeb2', {
        bottom: false,
      });
      ctx.colliders.push(boxCollider(cx, H / 2, cz, sx, H, sz));
    }
  };

  /*
   * Only three sides get hoarding. The EASTERN edge is the sea, which is a
   * believable boundary in its own right (spec 8).
   *
   * Note what the arguments mean: runFence('z', v) puts a fence AT x = v that
   * runs along z, i.e. an east or west edge. The east side was being fenced
   * and the north side left open, which put a line of hoarding standing in the
   * water across the whole seaward view.
   */
  runFence('x', -L); // south
  runFence('x', L); // north
  runFence('z', -L); // west

  // Distant filler scenery beyond the fence: low blocks and tree masses so the
  // skyline reads as a continuing town rather than a cut-off (ref 4 horizon).
  for (let i = 0; i < 90; i++) {
    const side = randInt(rng, 0, 3);
    const far = randRange(rng, L + 40, L + 420);
    const along = randRange(rng, -L - 300, L + 300);
    let x = side === 0 ? -far : side === 1 ? far : along;
    const z = side === 2 ? -far : side === 3 ? far : along;
    // Nothing stands in the water.
    if (x > SHORE_X - 40) x = -Math.abs(x);
    const h = randRange(rng, 6, 26);
    const w = randRange(rng, 16, 46);
    ctx.accent.addBox(x, h / 2, z, w, h, randRange(rng, 16, 40), 8, pick(rng, ['#b3ada0', '#9ea89f', '#a8a89e', '#95a0a6']), {
      bottom: false,
    });
  }
}

// -------------------------------------------------- street furniture pass

function addStreetFurniture(
  rng: Rng,
  graph: ReturnType<typeof getRoadGraph>,
  props: CityBuild['props'],
  vegetation: CityBuild['vegetation'],
  colliders: BoxColliderDef[],
) {
  for (const e of graph.edges) {
    if (e.kind === 'alley') continue;
    const horiz = isHorizontal(e);
    const fixed = horiz ? e.az : e.ax;
    const lo = horiz ? Math.min(e.ax, e.bx) : Math.min(e.az, e.bz);
    const hi = horiz ? Math.max(e.ax, e.bx) : Math.max(e.az, e.bz);
    const outer = e.halfWidth + e.sidewalkWidth;

    // Utility poles with wires run down ONE side only (ref 1, ref 5).
    const poleSide = chance(rng, 0.5) ? 1 : -1;
    for (let t = lo + 14; t < hi - 10; t += randRange(rng, 30, 42)) {
      const px = horiz ? t : fixed + poleSide * (outer - 0.7);
      const pz = horiz ? fixed + poleSide * (outer - 0.7) : t;
      props.utilityPole.push({ x: px, y: 0, z: pz, rotY: horiz ? 0 : Math.PI / 2, scale: 1 });
      colliders.push(boxCollider(px, 4.5, pz, 0.34, 9, 0.34));
    }

    // Streetlights alternate sides along the boulevard.
    if (e.kind === 'boulevard') {
      let flip = 1;
      for (let t = lo + 22; t < hi - 14; t += 34) {
        const sx = horiz ? t : fixed + flip * (outer - 1.1);
        const sz = horiz ? fixed + flip * (outer - 1.1) : t;
        props.streetlight.push({
          x: sx,
          y: 0,
          z: sz,
          rotY: horiz ? (flip > 0 ? Math.PI : 0) : flip > 0 ? Math.PI * 1.5 : Math.PI * 0.5,
          scale: 1,
        });
        flip = flip === 1 ? -1 : 1;
      }
    }

    // Palms along the verge, staggered so they never form a perfect row.
    for (let t = lo + 10; t < hi - 8; t += randRange(rng, 13, 24)) {
      const side = chance(rng, 0.5) ? 1 : -1;
      const px = horiz ? t + randRange(rng, -2, 2) : fixed + side * (outer - 1.5);
      const pz = horiz ? fixed + side * (outer - 1.5) : t + randRange(rng, -2, 2);
      vegetation.palm.push({
        x: px,
        y: 0,
        z: pz,
        rotY: randRange(rng, 0, Math.PI * 2),
        scale: randRange(rng, 0.8, 1.35),
      });
    }

    /*
     * No kerbside parking. These roads have no parking lane: a 1.9 m car set
     * 1.25 m inside the kerb overlaps the outermost TRAFFIC lane on both the
     * boulevard and the side streets, so parked cars sat directly in the path
     * of moving traffic and jammed the network. Parked cars now live only
     * off-carriageway - the lot, the forecourt and residential driveways.
     */

    // Bins, benches and hydrants, sparsely.
    for (let t = lo + 20; t < hi - 16; t += randRange(rng, 40, 70)) {
      const side = chance(rng, 0.5) ? 1 : -1;
      const px = horiz ? t : fixed + side * (outer - 1.2);
      const pz = horiz ? fixed + side * (outer - 1.2) : t;
      const roll = rng();
      if (roll < 0.4) props.bin.push({ x: px, y: 0, z: pz, rotY: randRange(rng, 0, 6.28), scale: 1 });
      else if (roll < 0.7) props.bench.push({ x: px, y: 0, z: pz, rotY: horiz ? 0 : Math.PI / 2, scale: 1 });
      else props.hydrant.push({ x: px, y: 0, z: pz, rotY: randRange(rng, 0, 6.28), scale: 1 });
    }
  }

  // A few cones around a patched section of the alley.
  for (let i = 0; i < 6; i++) {
    props.cone.push({ x: -18 + randRange(rng, -1.6, 1.6), y: 0, z: 56 + i * 2.4, rotY: randRange(rng, 0, 6.28), scale: 1 });
  }
}
