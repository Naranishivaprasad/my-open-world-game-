import * as THREE from 'three';
import { MeshBuilder } from './meshBuilder';

/**
 * Procedural geometry for every non-hero vehicle in Palm Coast (spec 15, 16).
 *
 * COORDINATE CONVENTION
 * Forward is +X, up is +Y, right is +Z. The wheels sit on y = 0, so an
 * instance can be placed directly on the road surface with no offset. This
 * matches the convention the original parked-car prop used, so the traffic and
 * prop instancing code needs no change of frame.
 *
 * PAINT is left pure white in vertex colour so `InstancedMesh.setColorAt` can
 * tint each body separately; glass, tyres, bumpers and trim are baked to fixed
 * colours so they stay put whatever the paint is.
 *
 * All designs are ORIGINAL silhouettes built from generic body classes (saloon,
 * coupe, SUV, pickup, van, hatchback, motorcycle, scooter). No real
 * manufacturer's bodywork, badging or model name is reproduced.
 */

// --------------------------------------------------------------- primitives

interface Pt {
  x: number;
  y: number;
  z: number;
}

/** An axis-aligned rectangle in the XZ plane, used as a prism cross-section. */
interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

const PAINT = '#ffffff'; // tinted per instance
const GLASS = '#1d242c';
const TYRE = '#191b1d';
const TRIM = '#2a2e33';
const CHROME = '#9aa1a7';
const LAMP = '#f2ecd8';
const TAIL = '#9c2f24';
/** Panel gaps and creases: dark, but not as dark as the bumpers. */
const SHUT = '#4a5158';

const lerp3 = (a: Pt, b: Pt, t: number): Pt => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: a.z + (b.z - a.z) * t,
});

/**
 * A prism whose top cross-section may differ from its bottom.
 *
 * This is what separates a car from a stack of boxes: it gives bodies a rocker
 * taper, greenhouses a tumblehome, and bonnets and screens a genuine rake.
 */
function addPrism(
  mb: MeshBuilder,
  bot: Rect,
  top: Rect,
  y0: number,
  y1: number,
  tile: number,
  color: string,
  faces: { top?: boolean; bottom?: boolean; px?: boolean; nx?: boolean; pz?: boolean; nz?: boolean } = {},
) {
  const { top: fTop = true, bottom: fBot = false, px = true, nx = true, pz = true, nz = true } = faces;
  const bl = (r: Rect, y: number, xKey: 'x0' | 'x1', zKey: 'z0' | 'z1'): Pt => ({ x: r[xKey], y, z: r[zKey] });

  if (pz) {
    mb.addQuad(bl(bot, y0, 'x0', 'z1'), bl(bot, y0, 'x1', 'z1'), bl(top, y1, 'x1', 'z1'), bl(top, y1, 'x0', 'z1'), tile, color);
  }
  if (nz) {
    mb.addQuad(bl(bot, y0, 'x1', 'z0'), bl(bot, y0, 'x0', 'z0'), bl(top, y1, 'x0', 'z0'), bl(top, y1, 'x1', 'z0'), tile, color);
  }
  if (px) {
    mb.addQuad(bl(bot, y0, 'x1', 'z1'), bl(bot, y0, 'x1', 'z0'), bl(top, y1, 'x1', 'z0'), bl(top, y1, 'x1', 'z1'), tile, color);
  }
  if (nx) {
    mb.addQuad(bl(bot, y0, 'x0', 'z0'), bl(bot, y0, 'x0', 'z1'), bl(top, y1, 'x0', 'z1'), bl(top, y1, 'x0', 'z0'), tile, color);
  }
  if (fTop) {
    mb.addQuad(bl(top, y1, 'x0', 'z1'), bl(top, y1, 'x1', 'z1'), bl(top, y1, 'x1', 'z0'), bl(top, y1, 'x0', 'z0'), tile, color);
  }
  if (fBot) {
    mb.addQuad(bl(bot, y0, 'x0', 'z0'), bl(bot, y0, 'x1', 'z0'), bl(bot, y0, 'x1', 'z1'), bl(bot, y0, 'x0', 'z1'), tile, color);
  }
}

/** The four corners of one face of a prism, wound CCW seen from outside. */
type FaceCorners = [Pt, Pt, Pt, Pt];

function prismFace(bot: Rect, top: Rect, y0: number, y1: number, side: 'px' | 'nx' | 'pz' | 'nz'): FaceCorners {
  const p = (r: Rect, y: number, xKey: 'x0' | 'x1', zKey: 'z0' | 'z1'): Pt => ({ x: r[xKey], y, z: r[zKey] });
  switch (side) {
    case 'pz':
      return [p(bot, y0, 'x0', 'z1'), p(bot, y0, 'x1', 'z1'), p(top, y1, 'x1', 'z1'), p(top, y1, 'x0', 'z1')];
    case 'nz':
      return [p(bot, y0, 'x1', 'z0'), p(bot, y0, 'x0', 'z0'), p(top, y1, 'x0', 'z0'), p(top, y1, 'x1', 'z0')];
    case 'px':
      return [p(bot, y0, 'x1', 'z1'), p(bot, y0, 'x1', 'z0'), p(top, y1, 'x1', 'z0'), p(top, y1, 'x1', 'z1')];
    default:
      return [p(bot, y0, 'x0', 'z0'), p(bot, y0, 'x0', 'z1'), p(top, y1, 'x0', 'z1'), p(top, y1, 'x0', 'z0')];
  }
}

/**
 * Emit a sub-rectangle of a face in (u, v) parameter space, pushed `out`
 * metres along the face normal.
 *
 * Glazing is drawn this way rather than as its own box: the painted face stays
 * whole behind it, so the margin left around each pane reads as the A, B and C
 * pillars and the window frame, for two triangles per pane.
 */
function addFacePanel(
  mb: MeshBuilder,
  face: FaceCorners,
  u0: number,
  u1: number,
  v0: number,
  v1: number,
  out: number,
  tile: number,
  color: string,
) {
  const [bl, br, tr, tl] = face;
  const at = (u: number, v: number) => lerp3(lerp3(bl, br, u), lerp3(tl, tr, u), v);

  // Face normal from the outer edges, so the panel floats just proud of it.
  const e1 = { x: br.x - bl.x, y: br.y - bl.y, z: br.z - bl.z };
  const e2 = { x: tl.x - bl.x, y: tl.y - bl.y, z: tl.z - bl.z };
  let nx = e1.y * e2.z - e1.z * e2.y;
  let ny = e1.z * e2.x - e1.x * e2.z;
  let nz = e1.x * e2.y - e1.y * e2.x;
  const nl = Math.hypot(nx, ny, nz) || 1;
  nx = (nx / nl) * out;
  ny = (ny / nl) * out;
  nz = (nz / nl) * out;
  const off = (p: Pt): Pt => ({ x: p.x + nx, y: p.y + ny, z: p.z + nz });

  mb.addQuad(off(at(u0, v0)), off(at(u1, v0)), off(at(u1, v1)), off(at(u0, v1)), tile, color);
}

/**
 * A road wheel: tyre band, sidewalls and a lighter rim face.
 *
 * AXIS NOTE: vehicles face +X, so a wheel rolls about the Z axis. Its circular
 * profile therefore lies in the X-Y plane and its width runs along Z. Sweeping
 * the circle in Y-Z instead produces a wheel mounted sideways - thin front-to-
 * back and tall across the car - which is easy to miss until something else in
 * the same view (here, the arch cutout) is built on the correct axis.
 */
function addWheel(mb: MeshBuilder, cx: number, cy: number, cz: number, radius: number, width: number) {
  // 8 segments and a flat hub disc rather than 12 and a separate rim ring:
  // wheels were 54% of every vehicle's triangles, and at the distance traffic
  // is actually seen the extra tessellation is invisible.
  const SIDES = 8;
  const hw = width / 2;
  const rimR = radius * 0.6;
  for (let i = 0; i < SIDES; i++) {
    const a0 = (i / SIDES) * Math.PI * 2;
    const a1 = ((i + 1) / SIDES) * Math.PI * 2;
    const x0 = cx + Math.cos(a0) * radius;
    const y0 = cy + Math.sin(a0) * radius;
    const x1 = cx + Math.cos(a1) * radius;
    const y1 = cy + Math.sin(a1) * radius;
    const rx0 = cx + Math.cos(a0) * rimR;
    const ry0 = cy + Math.sin(a0) * rimR;
    const rx1 = cx + Math.cos(a1) * rimR;
    const ry1 = cy + Math.sin(a1) * rimR;

    // Tread band.
    mb.addQuad({ x: x0, y: y0, z: cz - hw }, { x: x0, y: y0, z: cz + hw }, { x: x1, y: y1, z: cz + hw }, { x: x1, y: y1, z: cz - hw }, 0.6, TYRE);
    // One face per side: tyre sidewall out to the rim, drawn as a single quad
    // from the hub centre so the disc closes without a separate ring.
    mb.addQuad({ x: cx, y: cy, z: cz + hw }, { x: x0, y: y0, z: cz + hw }, { x: x1, y: y1, z: cz + hw }, { x: cx, y: cy, z: cz + hw }, 0.6, TYRE);
    mb.addQuad({ x: cx, y: cy, z: cz - hw }, { x: x1, y: y1, z: cz - hw }, { x: x0, y: y0, z: cz - hw }, { x: cx, y: cy, z: cz - hw }, 0.6, TYRE);
    // A small bright hub so the wheel is not a flat black disc.
    mb.addQuad({ x: cx, y: cy, z: cz + hw + 0.004 }, { x: rx0, y: ry0, z: cz + hw + 0.004 }, { x: rx1, y: ry1, z: cz + hw + 0.004 }, { x: cx, y: cy, z: cz + hw + 0.004 }, 0.6, CHROME);
    mb.addQuad({ x: cx, y: cy, z: cz - hw - 0.004 }, { x: rx1, y: ry1, z: cz - hw - 0.004 }, { x: rx0, y: ry0, z: cz - hw - 0.004 }, { x: cx, y: cy, z: cz - hw - 0.004 }, 0.6, CHROME);
  }
}

/**
 * The inner surface of a wheel well, bridging the arch opening in the flank
 * back to just outside the tyre.
 *
 * Without it you can see straight through the arch cutout into the hollow
 * body. It is deliberately SHALLOW - a lip, not a tunnel: a deep well reads as
 * a black hole around the tyre, because you are looking straight down its
 * inner wall. The tyre itself hides everything behind the lip.
 */
function addWheelWell(
  mb: MeshBuilder,
  cx: number,
  cy: number,
  radius: number,
  zOuter: number,
  zInner: number,
) {
  const SEGS = 8;
  for (let i = 0; i < SEGS; i++) {
    const a0 = Math.PI * (0.02 + (0.96 * i) / SEGS);
    const a1 = Math.PI * (0.02 + (0.96 * (i + 1)) / SEGS);
    const p0 = { x: cx + Math.cos(a0) * radius, y: cy + Math.sin(a0) * radius };
    const p1 = { x: cx + Math.cos(a1) * radius, y: cy + Math.sin(a1) * radius };
    // Wound so the visible side faces down into the well.
    const flip = zOuter > zInner;
    const q: [Pt, Pt, Pt, Pt] = flip
      ? [
          { x: p0.x, y: p0.y, z: zInner },
          { x: p0.x, y: p0.y, z: zOuter },
          { x: p1.x, y: p1.y, z: zOuter },
          { x: p1.x, y: p1.y, z: zInner },
        ]
      : [
          { x: p0.x, y: p0.y, z: zOuter },
          { x: p0.x, y: p0.y, z: zInner },
          { x: p1.x, y: p1.y, z: zInner },
          { x: p1.x, y: p1.y, z: zOuter },
        ];
    mb.addQuad(q[0], q[1], q[2], q[3], 0.6, TRIM);
  }
}

/**
 * One flank of the lower body, cut away above each wheel.
 *
 * The panel is emitted as vertical columns; a column that falls over an axle
 * starts at the arch profile instead of the floor, so the opening follows the
 * tyre. This is the difference between a wheel that sits in the bodywork and
 * one that is swallowed by it.
 */
function addFlank(mb: MeshBuilder, p: CarProfile, s: 1 | -1) {
  const x0 = -p.tailX;
  const x1 = p.noseX;
  const archR = p.wheelR + 0.05;
  const zAt = (y: number) => {
    const t = (y - p.floor) / (p.waist - p.floor);
    return s * (p.floorHalfW + (p.halfW - p.floorHalfW) * t);
  };
  /** Lowest point of bodywork at this station: the arch profile, or the floor. */
  const bottomAt = (x: number) => {
    let y = p.floor;
    for (const ax of [p.axleF, -p.axleR]) {
      const dx = Math.abs(x - ax);
      if (dx < archR) y = Math.max(y, p.wheelR + Math.sqrt(archR * archR - dx * dx));
    }
    return Math.min(y, p.waist - 0.02);
  };

  // Columns are placed ADAPTIVELY: dense across each arch so the opening reads
  // as a curve, sparse along the flat rocker and overhangs where a single quad
  // is exact. A uniform grid coarse enough to be cheap turns each arch into a
  // four-sided notch.
  const ARCH_STEPS = 8;
  const bounds = new Set<number>([x0, x1]);
  for (const ax of [p.axleF, -p.axleR]) {
    for (let i = 0; i <= ARCH_STEPS; i++) {
      const x = ax - archR + (2 * archR * i) / ARCH_STEPS;
      if (x > x0 && x < x1) bounds.add(x);
    }
  }
  const xs = [...bounds].sort((a, b) => a - b);

  for (let i = 0; i < xs.length - 1; i++) {
    const xa = xs[i]!;
    const xb = xs[i + 1]!;
    const ya = bottomAt(xa);
    const yb = bottomAt(xb);
    if (ya >= p.waist - 0.03 && yb >= p.waist - 0.03) continue;
    const A = { x: xa, y: ya, z: zAt(ya) };
    const B = { x: xb, y: yb, z: zAt(yb) };
    const C = { x: xb, y: p.waist, z: zAt(p.waist) };
    const D = { x: xa, y: p.waist, z: zAt(p.waist) };
    if (s > 0) mb.addQuad(A, B, C, D, 2, PAINT);
    else mb.addQuad(B, A, D, C, 2, PAINT);
  }
}

// ------------------------------------------------------------------ profiles

export type VehicleKey =
  | 'sedan'
  | 'coupe'
  | 'suv'
  | 'pickup'
  | 'van'
  | 'hatchback'
  | 'motorcycle'
  | 'scooter';

export interface VehicleSpec {
  key: VehicleKey;
  /** Original in-world model name, used by the HUD and mission text. */
  label: string;
  /** Overall bounds, metres. `height` is to the top of the roof. */
  length: number;
  width: number;
  height: number;
  /** Physics figures, used when the player takes the vehicle over. */
  mass: number;
  engineForce: number;
  topSpeedKph: number;
  wheelbase: number;
  track: number;
  wheelRadius: number;
  isBike: boolean;
  /** Relative frequency in traffic and parking. */
  weight: number;
}

/** Body-class dimensions for the four-wheeled shapes. */
interface CarProfile {
  len: number;
  halfW: number;
  /** Chassis underside and waistline (top of the lower body). */
  floor: number;
  waist: number;
  /** Top of the greenhouse. */
  roof: number;
  /** Lower-body extent along X. */
  noseX: number;
  tailX: number;
  /** Greenhouse extent at the waistline, then at the roof (gives screen rake). */
  cabFrontLo: number;
  cabRearLo: number;
  cabFrontHi: number;
  cabRearHi: number;
  /** Half-width of the roof: less than halfW gives tumblehome. */
  roofHalfW: number;
  /** Rocker taper: half-width at the floor. */
  floorHalfW: number;
  wheelR: number;
  wheelW: number;
  axleF: number;
  axleR: number;
  track: number;
  /** Two side panes (saloon) or one long one (coupe). */
  sidePanes: 1 | 2;
  bonnetDrop: number;
}

/**
 * Build a four-wheeled body from a profile.
 *
 * The lower body and greenhouse are tapered prisms; the glazing is inset into
 * their faces so the surrounding paint becomes the pillars. Bumpers, arches,
 * lamps, mirrors and a waist crease finish it.
 */
function buildCar(
  p: CarProfile,
  extras?: (mb: MeshBuilder, p: CarProfile) => void,
  opts: { wheels?: boolean } = {},
): THREE.BufferGeometry {
  const withWheels = opts.wheels !== false;
  const mb = new MeshBuilder({ vertexColors: true });

  // ------------------------------------------------------------ lower body
  const bodyBot: Rect = { x0: -p.tailX + 0.06, z0: -p.floorHalfW, x1: p.noseX - 0.06, z1: p.floorHalfW };
  const bodyTop: Rect = { x0: -p.tailX, z0: -p.halfW, x1: p.noseX, z1: p.halfW };
  addPrism(mb, bodyBot, bodyTop, p.floor, p.waist, 2, PAINT, { top: true, bottom: false, pz: false, nz: false });
  for (const s of [1, -1] as const) addFlank(mb, p, s);

  // Bonnet and boot drop slightly below the waistline, so the car reads as
  // three volumes rather than one slab.
  const deck = p.waist - p.bonnetDrop;
  addPrism(
    mb,
    { x0: p.cabFrontLo, z0: -p.halfW + 0.03, x1: p.noseX, z1: p.halfW - 0.03 },
    { x0: p.cabFrontLo, z0: -p.halfW + 0.05, x1: p.noseX - 0.1, z1: p.halfW - 0.05 },
    deck,
    p.waist,
    2,
    PAINT,
    { top: true },
  );
  addPrism(
    mb,
    { x0: -p.tailX, z0: -p.halfW + 0.03, x1: p.cabRearLo, z1: p.halfW - 0.03 },
    { x0: -p.tailX + 0.08, z0: -p.halfW + 0.05, x1: p.cabRearLo, z1: p.halfW - 0.05 },
    deck,
    p.waist,
    2,
    PAINT,
    { top: true },
  );

  // A crease along the flank at the waistline catches the light.
  addPrism(
    mb,
    { x0: -p.tailX + 0.1, z0: -p.halfW - 0.012, x1: p.noseX - 0.1, z1: p.halfW + 0.012 },
    { x0: -p.tailX + 0.1, z0: -p.halfW - 0.012, x1: p.noseX - 0.1, z1: p.halfW + 0.012 },
    p.waist - 0.14,
    p.waist - 0.09,
    2,
    SHUT,
    { top: false },
  );

  // Door shut lines, above the arch openings.
  for (const s of [1, -1] as const) {
    for (const dx of p.sidePanes === 2 ? [p.cabFrontLo + 0.02, -0.55, p.cabRearLo - 0.02] : [p.cabFrontLo + 0.02, p.cabRearLo - 0.02]) {
      mb.addBox(dx, p.waist - 0.22, s * (p.halfW + 0.008), 0.02, 0.3, 0.02, 1, SHUT);
    }
  }

  // ------------------------------------------------------------ greenhouse
  const ghBot: Rect = { x0: p.cabRearLo, z0: -p.halfW + 0.05, x1: p.cabFrontLo, z1: p.halfW - 0.05 };
  const ghTop: Rect = { x0: p.cabRearHi, z0: -p.roofHalfW, x1: p.cabFrontHi, z1: p.roofHalfW };
  addPrism(mb, ghBot, ghTop, p.waist, p.roof, 2, PAINT, { top: true });

  // Glazing inset into each greenhouse face.
  addFacePanel(mb, prismFace(ghBot, ghTop, p.waist, p.roof, 'px'), 0.07, 0.93, 0.1, 0.9, 0.014, 1, GLASS);
  addFacePanel(mb, prismFace(ghBot, ghTop, p.waist, p.roof, 'nx'), 0.08, 0.92, 0.12, 0.88, 0.014, 1, GLASS);
  for (const side of ['pz', 'nz'] as const) {
    const f = prismFace(ghBot, ghTop, p.waist, p.roof, side);
    if (p.sidePanes === 2) {
      addFacePanel(mb, f, 0.08, 0.45, 0.14, 0.86, 0.014, 1, GLASS);
      addFacePanel(mb, f, 0.55, 0.92, 0.14, 0.86, 0.014, 1, GLASS);
    } else {
      addFacePanel(mb, f, 0.09, 0.91, 0.14, 0.86, 0.014, 1, GLASS);
    }
  }

  // --------------------------------------------------------------- bumpers
  addPrism(
    mb,
    { x0: p.noseX - 0.05, z0: -p.halfW + 0.1, x1: p.noseX + 0.05, z1: p.halfW - 0.1 },
    { x0: p.noseX - 0.05, z0: -p.halfW + 0.12, x1: p.noseX + 0.03, z1: p.halfW - 0.12 },
    p.floor + 0.16,
    p.floor + 0.42,
    1,
    TRIM,
  );
  addPrism(
    mb,
    { x0: -p.tailX - 0.04, z0: -p.halfW + 0.1, x1: -p.tailX + 0.05, z1: p.halfW - 0.1 },
    { x0: -p.tailX - 0.02, z0: -p.halfW + 0.12, x1: -p.tailX + 0.05, z1: p.halfW - 0.12 },
    p.floor + 0.16,
    p.floor + 0.42,
    1,
    TRIM,
  );

  // ----------------------------------------------------------- lamps, grille
  const lampY = p.floor + 0.58;
  for (const z of [p.halfW - 0.33, -p.halfW + 0.33]) {
    mb.addBox(p.noseX + 0.015, lampY, z, 0.06, 0.16, 0.42, 1, LAMP);
    mb.addBox(-p.tailX - 0.015, lampY + 0.04, z, 0.06, 0.15, 0.4, 1, TAIL);
  }
  mb.addBox(p.noseX + 0.01, p.floor + 0.56, 0, 0.05, 0.2, p.halfW * 1.05, 1, TRIM);

  // ------------------------------------------------ mirrors, arches, wheels
  // Mirrors hang off the A-pillar, not off thin air above the bonnet.
  for (const s of [1, -1] as const) {
    mb.addBox(p.cabFrontLo + 0.06, p.waist + 0.13, s * (p.halfW + 0.07), 0.09, 0.08, 0.16, 1, TRIM);
  }
  for (const ax of [p.axleF, -p.axleR]) {
    for (const s of [1, -1] as const) {
      addWheelWell(mb, ax, p.wheelR, p.wheelR + 0.05, s * (p.halfW + 0.01), s * (p.halfW - 0.07));
      // A driveable vehicle's wheels are separate meshes so suspension, steer
      // and spin can move them; a parked one bakes them into the shell.
      if (withWheels) addWheel(mb, ax, p.wheelR, s * (p.track / 2), p.wheelR, p.wheelW);
    }
  }

  extras?.(mb, p);
  return mb.build();
}

// --------------------------------------------------------------- body types

const SEDAN: CarProfile = {
  len: 4.64, halfW: 0.92, floor: 0.19, waist: 0.95, roof: 1.46,
  noseX: 2.32, tailX: 2.32, cabFrontLo: 0.5, cabRearLo: -1.62, cabFrontHi: -0.05, cabRearHi: -1.32,
  roofHalfW: 0.74, floorHalfW: 0.84, wheelR: 0.33, wheelW: 0.22,
  axleF: 1.38, axleR: 1.38, track: 1.6, sidePanes: 2, bonnetDrop: 0.1,
};

const COUPE: CarProfile = {
  len: 4.36, halfW: 0.94, floor: 0.16, waist: 0.86, roof: 1.32,
  noseX: 2.18, tailX: 2.18, cabFrontLo: 0.42, cabRearLo: -1.5, cabFrontHi: -0.18, cabRearHi: -1.04,
  roofHalfW: 0.68, floorHalfW: 0.86, wheelR: 0.33, wheelW: 0.24,
  axleF: 1.34, axleR: 1.34, track: 1.64, sidePanes: 1, bonnetDrop: 0.08,
};

const HATCHBACK: CarProfile = {
  len: 4.02, halfW: 0.88, floor: 0.2, waist: 0.98, roof: 1.5,
  noseX: 2.01, tailX: 2.01, cabFrontLo: 0.36, cabRearLo: -1.52, cabFrontHi: -0.1, cabRearHi: -1.58,
  roofHalfW: 0.74, floorHalfW: 0.8, wheelR: 0.31, wheelW: 0.2,
  axleF: 1.24, axleR: 1.2, track: 1.52, sidePanes: 2, bonnetDrop: 0.1,
};

const SUV: CarProfile = {
  len: 4.86, halfW: 0.98, floor: 0.29, waist: 1.18, roof: 1.86,
  noseX: 2.43, tailX: 2.43, cabFrontLo: 0.62, cabRearLo: -2.0, cabFrontHi: 0.28, cabRearHi: -2.0,
  roofHalfW: 0.86, floorHalfW: 0.9, wheelR: 0.38, wheelW: 0.26,
  axleF: 1.48, axleR: 1.48, track: 1.68, sidePanes: 2, bonnetDrop: 0.12,
};

const PICKUP: CarProfile = {
  len: 5.34, halfW: 0.99, floor: 0.31, waist: 1.2, roof: 1.88,
  noseX: 2.67, tailX: 2.67, cabFrontLo: 0.72, cabRearLo: -0.72, cabFrontHi: 0.34, cabRearHi: -0.74,
  roofHalfW: 0.88, floorHalfW: 0.92, wheelR: 0.39, wheelW: 0.27,
  axleF: 1.62, axleR: 1.66, track: 1.7, sidePanes: 2, bonnetDrop: 0.12,
};

const VAN: CarProfile = {
  len: 5.36, halfW: 1.0, floor: 0.26, waist: 1.12, roof: 2.22,
  noseX: 2.68, tailX: 2.68, cabFrontLo: 1.34, cabRearLo: -2.62, cabFrontHi: 1.02, cabRearHi: -2.62,
  roofHalfW: 0.94, floorHalfW: 0.94, wheelR: 0.36, wheelW: 0.24,
  axleF: 1.66, axleR: 1.74, track: 1.72, sidePanes: 1, bonnetDrop: 0.06,
};

/** The open cargo bed behind a pickup's cab. */
function pickupBed(mb: MeshBuilder, p: CarProfile) {
  const bedFront = p.cabRearLo - 0.04;
  const bedRear = -p.tailX + 0.05;
  const WALL = 0.09;
  const top = p.waist + 0.42;
  // Bed floor.
  mb.addBox((bedFront + bedRear) / 2, p.waist + 0.03, 0, bedFront - bedRear, 0.06, (p.halfW - 0.06) * 2, 2, TRIM);
  // Side walls and tailgate.
  for (const s of [1, -1] as const) {
    mb.addBox((bedFront + bedRear) / 2, (p.waist + top) / 2, s * (p.halfW - WALL / 2), bedFront - bedRear, top - p.waist, WALL, 2, PAINT);
  }
  mb.addBox(bedRear + WALL / 2, (p.waist + top) / 2, 0, WALL, top - p.waist, (p.halfW - 0.02) * 2, 2, PAINT);
  mb.addBox(bedFront - WALL / 2, (p.waist + top) / 2, 0, WALL, top - p.waist, (p.halfW - 0.02) * 2, 2, PAINT);
}

/** Roof rails and a spare-wheel-free tailgate handle for the SUV. */
function suvRails(mb: MeshBuilder, p: CarProfile) {
  for (const s of [1, -1] as const) {
    mb.addBox(-0.85, p.roof + 0.05, s * (p.roofHalfW - 0.14), 2.3, 0.07, 0.08, 1, TRIM);
  }
}

/** A roof vent and a body-side rubbing strip for the van. */
function vanTrim(mb: MeshBuilder, p: CarProfile) {
  mb.addBox(-1.2, p.roof + 0.06, 0, 0.7, 0.1, 0.7, 1, CHROME);
  for (const s of [1, -1] as const) {
    mb.addBox(-0.6, p.waist + 0.44, s * (p.halfW + 0.012), 3.4, 0.1, 0.03, 1, TRIM);
  }
}

// -------------------------------------------------------------- two-wheelers

/** A naked roadster motorcycle: wheels, forks, tank, seat, bars, pipe. */
function buildMotorcycle(): THREE.BufferGeometry {
  const mb = new MeshBuilder({ vertexColors: true });
  const R = 0.32;
  const AX_F = 0.72;
  const AX_R = -0.68;

  addWheel(mb, AX_F, R, 0, R, 0.12);
  addWheel(mb, AX_R, R, 0, R * 1.02, 0.15);

  // Engine block and frame spine.
  mb.addBox(0.02, 0.5, 0, 0.62, 0.36, 0.34, 1, TRIM);
  mb.addBox(-0.1, 0.72, 0, 1.3, 0.1, 0.14, 1, TRIM);
  // Fuel tank, tapered.
  addPrism(mb, { x0: -0.12, z0: -0.16, x1: 0.46, z1: 0.16 }, { x0: -0.06, z0: -0.1, x1: 0.34, z1: 0.1 }, 0.76, 0.95, 1, PAINT);
  // Seat and tail unit.
  mb.addBox(-0.42, 0.85, 0, 0.6, 0.1, 0.28, 1, TYRE);
  addPrism(mb, { x0: -0.82, z0: -0.13, x1: -0.34, z1: 0.13 }, { x0: -0.72, z0: -0.09, x1: -0.36, z1: 0.09 }, 0.86, 1.0, 1, PAINT);
  // Front forks, raked forward, and the headstock.
  for (const s of [1, -1] as const) {
    mb.addBox(AX_F - 0.06, R + 0.3, s * 0.1, 0.07, 0.72, 0.07, 1, CHROME);
  }
  mb.addBox(0.6, 0.98, 0, 0.14, 0.16, 0.16, 1, TRIM);
  // Handlebars and headlight.
  mb.addBox(0.6, 1.06, 0, 0.06, 0.05, 0.66, 1, TRIM);
  mb.addBox(0.68, 0.94, 0, 0.1, 0.19, 0.2, 1, LAMP);
  mb.addBox(-0.86, 0.94, 0, 0.06, 0.1, 0.14, 1, TAIL);
  // Exhaust and rear shock.
  mb.addBox(-0.3, 0.36, 0.16, 0.86, 0.1, 0.1, 1, CHROME);
  mb.addBox(-0.34, 0.6, 0, 0.09, 0.34, 0.09, 1, TRIM);
  // Footpegs.
  for (const s of [1, -1] as const) mb.addBox(-0.06, 0.38, s * 0.24, 0.16, 0.04, 0.14, 1, TRIM);
  return mb.build();
}

/** A step-through scooter: leg shield, flat floor, under-seat body. */
function buildScooter(): THREE.BufferGeometry {
  const mb = new MeshBuilder({ vertexColors: true });
  const R = 0.24;
  const AX_F = 0.6;
  const AX_R = -0.56;

  addWheel(mb, AX_F, R, 0, R, 0.1);
  addWheel(mb, AX_R, R, 0, R, 0.12);

  // Flat floorpan between the wheels.
  mb.addBox(0.02, 0.34, 0, 0.78, 0.08, 0.34, 1, TRIM);
  // Leg shield, leaning back toward the rider.
  addPrism(mb, { x0: 0.38, z0: -0.19, x1: 0.52, z1: 0.19 }, { x0: 0.3, z0: -0.16, x1: 0.44, z1: 0.16 }, 0.36, 0.92, 1, PAINT);
  // Under-seat body and seat.
  addPrism(mb, { x0: -0.72, z0: -0.17, x1: -0.16, z1: 0.17 }, { x0: -0.64, z0: -0.14, x1: -0.14, z1: 0.14 }, 0.36, 0.76, 1, PAINT);
  mb.addBox(-0.4, 0.81, 0, 0.62, 0.1, 0.3, 1, TYRE);
  // Forks, bars, lamps.
  for (const s of [1, -1] as const) mb.addBox(AX_F - 0.02, R + 0.26, s * 0.08, 0.06, 0.6, 0.06, 1, CHROME);
  mb.addBox(0.54, 1.0, 0, 0.06, 0.05, 0.58, 1, TRIM);
  mb.addBox(0.47, 0.88, 0, 0.09, 0.16, 0.18, 1, LAMP);
  mb.addBox(-0.76, 0.82, 0, 0.06, 0.1, 0.13, 1, TAIL);
  // Rear rack.
  mb.addBox(-0.74, 0.86, 0, 0.26, 0.05, 0.26, 1, TRIM);
  return mb.build();
}

// ------------------------------------------------------------------- exports

/**
 * The catalogue, keyed by body class.
 *
 * `mass`, `engineForce` and `topSpeedKph` are plausible class figures used when
 * the player takes a vehicle over (spec 16); they are authored tuning values,
 * not measurements of a real vehicle.
 *
 * `engineForce` is the TOTAL tractive force, split across the driven wheels, so
 * a vehicle's acceleration is roughly engineForce / mass. The bikes were first
 * given car-sized numbers, which on 130-210 kg gave them over 11 m/s^2 - a
 * scooter out-accelerating everything else on the road.
 */
export const VEHICLE_TYPES: Record<VehicleKey, VehicleSpec> = {
  sedan: { key: 'sedan', label: 'Marlin 400', length: 4.64, width: 1.84, height: 1.46, mass: 1420, engineForce: 6800, topSpeedKph: 172, wheelbase: 2.76, track: 1.6, wheelRadius: 0.33, isBike: false, weight: 26 },
  hatchback: { key: 'hatchback', label: 'Pebble', length: 4.02, width: 1.76, height: 1.5, mass: 1150, engineForce: 5400, topSpeedKph: 158, wheelbase: 2.44, track: 1.52, wheelRadius: 0.31, isBike: false, weight: 20 },
  coupe: { key: 'coupe', label: 'Tarpon GT', length: 4.36, width: 1.88, height: 1.32, mass: 1360, engineForce: 8600, topSpeedKph: 205, wheelbase: 2.68, track: 1.64, wheelRadius: 0.33, isBike: false, weight: 10 },
  suv: { key: 'suv', label: 'Ridgeline Sierra', length: 4.86, width: 1.96, height: 1.86, mass: 1980, engineForce: 8200, topSpeedKph: 168, wheelbase: 2.96, track: 1.68, wheelRadius: 0.38, isBike: false, weight: 18 },
  pickup: { key: 'pickup', label: 'Hauler 2500', length: 5.34, width: 1.98, height: 1.88, mass: 2180, engineForce: 8800, topSpeedKph: 160, wheelbase: 3.28, track: 1.7, wheelRadius: 0.39, isBike: false, weight: 12 },
  van: { key: 'van', label: 'Courier LWB', length: 5.36, width: 2.0, height: 2.22, mass: 2320, engineForce: 7600, topSpeedKph: 142, wheelbase: 3.4, track: 1.72, wheelRadius: 0.36, isBike: false, weight: 8 },
  motorcycle: { key: 'motorcycle', label: 'Kestrel 650', length: 2.1, width: 0.74, height: 1.12, mass: 210, engineForce: 1750, topSpeedKph: 196, wheelbase: 1.4, track: 0, wheelRadius: 0.32, isBike: true, weight: 8 },
  scooter: { key: 'scooter', label: 'Wasp 125', length: 1.78, width: 0.66, height: 1.06, mass: 130, engineForce: 420, topSpeedKph: 92, wheelbase: 1.16, track: 0, wheelRadius: 0.24, isBike: true, weight: 6 },
};

export const VEHICLE_KEYS = Object.keys(VEHICLE_TYPES) as VehicleKey[];

/** Body classes that lane traffic and parking bays may use. */
export const CAR_KEYS = VEHICLE_KEYS.filter((k) => !VEHICLE_TYPES[k].isBike);

/** Build the geometry for one body class. Call once and instance it. */
const CAR_PROFILES: Partial<Record<VehicleKey, { profile: CarProfile; extras?: (mb: MeshBuilder, p: CarProfile) => void }>> = {
  sedan: { profile: SEDAN },
  coupe: { profile: COUPE },
  hatchback: { profile: HATCHBACK },
  suv: { profile: SUV, extras: suvRails },
  pickup: { profile: PICKUP, extras: pickupBed },
  van: { profile: VAN, extras: vanTrim },
};

/**
 * The shell of a driveable vehicle, WITHOUT wheels, in PHYSICS body space.
 *
 * The catalogue is authored with forward = +X, but the chassis uses forward =
 * -Z, so the rotation is baked into the geometry here rather than applied as a
 * parent transform. That way the renderer can place wheel pivots straight from
 * the body-space connection points in the vehicle config, with no mirroring.
 */
export function makeVehicleBodyGeometry(key: VehicleKey): THREE.BufferGeometry {
  const entry = CAR_PROFILES[key];
  const geo = entry
    ? buildCar(entry.profile, entry.extras, { wheels: false })
    : makeVehicleGeometry(key);
  geo.rotateY(Math.PI / 2);
  geo.computeBoundingSphere();
  return geo;
}

/** One road wheel for a driveable vehicle, also rotated into body space. */
export function makeVehicleWheelGeometry(key: VehicleKey): THREE.BufferGeometry {
  const p = CAR_PROFILES[key]?.profile;
  const mb = new MeshBuilder({ vertexColors: true });
  addWheel(mb, 0, 0, 0, p?.wheelR ?? VEHICLE_TYPES[key].wheelRadius, p?.wheelW ?? 0.22);
  const geo = mb.build();
  geo.rotateY(Math.PI / 2);
  geo.computeBoundingSphere();
  return geo;
}

export function makeVehicleGeometry(key: VehicleKey): THREE.BufferGeometry {
  switch (key) {
    case 'sedan':
      return buildCar(SEDAN);
    case 'coupe':
      return buildCar(COUPE);
    case 'hatchback':
      return buildCar(HATCHBACK);
    case 'suv':
      return buildCar(SUV, suvRails);
    case 'pickup':
      return buildCar(PICKUP, pickupBed);
    case 'van':
      return buildCar(VAN, vanTrim);
    case 'motorcycle':
      return buildMotorcycle();
    case 'scooter':
      return buildScooter();
  }
}

/**
 * Pick a body class by weight.
 *
 * `roll` is a uniform number in [0, 1) from the seeded generator, so the mix of
 * traffic is reproducible for a given seed (spec 33).
 */
export function pickVehicleKey(roll: number, keys: VehicleKey[] = CAR_KEYS): VehicleKey {
  const total = keys.reduce((s, k) => s + VEHICLE_TYPES[k].weight, 0);
  let acc = roll * total;
  for (const k of keys) {
    acc -= VEHICLE_TYPES[k].weight;
    if (acc <= 0) return k;
  }
  return keys[keys.length - 1];
}

/**
 * The police cruiser (spec 22): a saloon shell in a two-tone livery, with a
 * push-bar, a light-bar mount and a boot-lid aerial.
 *
 * It shares the saloon profile so a cruiser reads as the same class of car as
 * civilian traffic, which is what makes the livery rather than the silhouette
 * the thing the player recognises.
 */
export function makePoliceGeometry(): THREE.BufferGeometry {
  return buildCar(SEDAN, (mb, p) => {
    // Two-tone door panels, the classic livery.
    for (const s of [1, -1] as const) {
      mb.addBox(-0.56, p.waist - 0.36, s * (p.halfW + 0.014), 2.3, 0.5, 0.03, 1, TRIM);
    }
    // Push-bar on the nose.
    mb.addBox(p.noseX + 0.12, p.floor + 0.36, 0, 0.1, 0.56, p.halfW * 1.5, 1, TRIM);
    for (const s of [1, -1] as const) {
      mb.addBox(p.noseX + 0.08, p.floor + 0.36, s * p.halfW * 0.72, 0.16, 0.08, 0.08, 1, TRIM);
    }
    // Light-bar mount on the roof, and a boot aerial.
    mb.addBox(-0.3, p.roof + 0.04, 0, 1.2, 0.08, 0.4, 1, TRIM, { bottom: true });
    mb.addBox(-1.9, p.waist + 0.3, 0.4, 0.04, 0.52, 0.04, 1, TRIM);
  });
}

/** Physical figures for the cruiser, so its collider matches its bodywork. */
export const POLICE_SPEC: VehicleSpec = {
  ...VEHICLE_TYPES.sedan,
  key: 'sedan',
  label: 'Palm Coast PD Cruiser',
  mass: 1560,
  engineForce: 9200,
  topSpeedKph: 190,
};
