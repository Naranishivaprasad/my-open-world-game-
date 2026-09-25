import * as THREE from 'three';
import { MeshBuilder } from './meshBuilder';
import { makeRng, randRange } from '../core/rng';

/**
 * Geometry for repeated street props and vegetation.
 *
 * Each type is built ONCE and drawn with an InstancedMesh, so a hundred palms
 * cost one draw call (spec 34). Colour variation rides on vertex colours baked
 * into the shared geometry, and per-instance scale/rotation supplies the rest.
 */

/** Tapered vertical column with `sides` faces - trunks, poles, bollards. */
function addColumn(
  mb: MeshBuilder,
  cx: number,
  cz: number,
  y0: number,
  y1: number,
  r0: number,
  r1: number,
  sides: number,
  color: string,
  lean = 0,
) {
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2;
    const a1 = ((i + 1) / sides) * Math.PI * 2;
    const leanX = lean * (y1 - y0);
    const p0 = { x: cx + Math.cos(a0) * r0, y: y0, z: cz + Math.sin(a0) * r0 };
    const p1 = { x: cx + Math.cos(a1) * r0, y: y0, z: cz + Math.sin(a1) * r0 };
    const p2 = { x: cx + Math.cos(a1) * r1 + leanX, y: y1, z: cz + Math.sin(a1) * r1 };
    const p3 = { x: cx + Math.cos(a0) * r1 + leanX, y: y1, z: cz + Math.sin(a0) * r1 };
    mb.addQuad(p0, p1, p2, p3, 1.5, color);
  }
}

/** A streetlight: post, curved arm, and a lamp head (ref 5, ref 7). */
export function makeStreetlightGeometry(): THREE.BufferGeometry {
  const mb = new MeshBuilder({ vertexColors: true });
  const GREY = '#a8aeb2';
  addColumn(mb, 0, 0, 0, 7.6, 0.14, 0.1, 6, GREY);
  // Arm reaching over the carriageway, built as three short segments so it curves.
  mb.addBox(0.55, 7.7, 0, 1.2, 0.12, 0.12, 1.5, GREY, { bottom: true });
  mb.addBox(1.45, 7.55, 0, 0.9, 0.12, 0.12, 1.5, GREY, { bottom: true });
  mb.addBox(2.15, 7.3, 0, 0.7, 0.14, 0.2, 1.5, GREY, { bottom: true });
  // Lamp housing + emissive-looking lens underneath.
  mb.addBox(2.5, 7.16, 0, 0.72, 0.18, 0.34, 1, '#b8bec2', { bottom: false });
  mb.addBox(2.5, 7.04, 0, 0.6, 0.06, 0.26, 1, '#f3ecd8', { bottom: true });
  // Base plinth.
  mb.addBox(0, 0.12, 0, 0.44, 0.24, 0.44, 1, '#8e9498', { bottom: false });
  return mb.build();
}

/** Timber utility pole with a crossarm and insulators (ref 1, ref 2, ref 5). */
export function makeUtilityPoleGeometry(): THREE.BufferGeometry {
  const mb = new MeshBuilder({ vertexColors: true });
  const WOOD = '#6b5a47';
  addColumn(mb, 0, 0, 0, 9.2, 0.19, 0.14, 7, WOOD);
  mb.addBox(0, 8.35, 0, 0.14, 0.14, 2.4, 1.5, '#5d4e3d', { bottom: true });
  mb.addBox(0, 7.6, 0, 0.12, 0.12, 1.7, 1.5, '#5d4e3d', { bottom: true });
  for (const dz of [-1.0, -0.45, 0.45, 1.0]) {
    mb.addBox(0, 8.52, dz, 0.1, 0.2, 0.1, 1, '#2f3338', { bottom: true });
  }
  // Transformer can, on some poles.
  mb.addBox(0.32, 6.6, 0, 0.5, 0.8, 0.5, 1, '#8d9296', { bottom: true });
  return mb.build();
}

/** Municipal litter bin. */
export function makeBinGeometry(): THREE.BufferGeometry {
  const mb = new MeshBuilder({ vertexColors: true });
  addColumn(mb, 0, 0, 0, 0.95, 0.3, 0.34, 8, '#40474d');
  mb.addBox(0, 1.0, 0, 0.78, 0.1, 0.78, 1, '#2f3338', { bottom: true });
  return mb.build();
}

/** Slatted public bench. */
export function makeBenchGeometry(): THREE.BufferGeometry {
  const mb = new MeshBuilder({ vertexColors: true });
  const SLAT = '#8a6f52';
  for (let i = 0; i < 4; i++) {
    mb.addBox(0, 0.45, -0.3 + i * 0.2, 1.8, 0.06, 0.16, 1, SLAT, { bottom: true });
  }
  for (let i = 0; i < 3; i++) {
    mb.addBox(0, 0.66 + i * 0.19, -0.38, 1.8, 0.06, 0.14, 1, SLAT, { bottom: true });
  }
  for (const dx of [-0.75, 0.75]) {
    mb.addBox(dx, 0.22, 0, 0.09, 0.45, 0.62, 1, '#3d4348', { bottom: false });
    mb.addBox(dx, 0.62, -0.42, 0.09, 0.5, 0.09, 1, '#3d4348', { bottom: true });
  }
  return mb.build();
}

/** Fire hydrant. */
export function makeHydrantGeometry(): THREE.BufferGeometry {
  const mb = new MeshBuilder({ vertexColors: true });
  const RED = '#b8402f';
  addColumn(mb, 0, 0, 0, 0.62, 0.15, 0.13, 8, RED);
  mb.addBox(0, 0.7, 0, 0.34, 0.16, 0.34, 1, RED, { bottom: true });
  mb.addBox(0, 0.8, 0, 0.16, 0.08, 0.16, 1, '#8f3324', { bottom: true });
  mb.addBox(0, 0.45, 0.17, 0.12, 0.12, 0.14, 1, '#8f3324', { bottom: true });
  mb.addBox(0, 0.1, 0, 0.42, 0.2, 0.42, 1, '#8f3324', { bottom: false });
  return mb.build();
}

/** Protective bollard. */
export function makeBollardGeometry(): THREE.BufferGeometry {
  const mb = new MeshBuilder({ vertexColors: true });
  addColumn(mb, 0, 0, 0, 0.9, 0.09, 0.09, 8, '#c9a227');
  mb.addBox(0, 0.93, 0, 0.2, 0.06, 0.2, 1, '#8a6f18', { bottom: true });
  return mb.build();
}

/** Traffic cone. */
export function makeConeGeometry(): THREE.BufferGeometry {
  const mb = new MeshBuilder({ vertexColors: true });
  mb.addBox(0, 0.03, 0, 0.36, 0.06, 0.36, 1, '#3a3a3c', { bottom: false });
  addColumn(mb, 0, 0, 0.06, 0.34, 0.13, 0.09, 6, '#d4622c');
  addColumn(mb, 0, 0, 0.34, 0.46, 0.09, 0.07, 6, '#e8e4dc');
  addColumn(mb, 0, 0, 0.46, 0.62, 0.07, 0.03, 6, '#d4622c');
  return mb.build();
}

/** Rooftop air-conditioning unit (spec 9). */
export function makeAcUnitGeometry(): THREE.BufferGeometry {
  const mb = new MeshBuilder({ vertexColors: true });
  mb.addBox(0, 0.45, 0, 1.25, 0.9, 1.0, 1, '#9ba1a5', { bottom: false });
  mb.addBox(0, 0.94, 0, 1.05, 0.08, 0.82, 1, '#6f7579', { bottom: true });
  mb.addBox(0, 0.06, 0, 1.35, 0.12, 1.1, 1, '#6b7074', { bottom: false });
  return mb.build();
}

/**
 * Palm tree: a leaning segmented trunk with a crown of drooping fronds.
 * Fronds are built as tapered strips so they read from both sides without
 * needing an alpha-cut texture.
 */
export function makePalmGeometry(seed = 7): THREE.BufferGeometry {
  const mb = new MeshBuilder({ vertexColors: true });
  const rng = makeRng(seed);
  const TRUNK = '#7d6b52';
  const H = 8.2;

  // Segmented trunk that leans slightly and narrows toward the crown.
  const SEGS = 7;
  let px = 0;
  let pz = 0;
  const leanX = randRange(rng, -0.22, 0.22);
  for (let i = 0; i < SEGS; i++) {
    const y0 = (i / SEGS) * H;
    const y1 = ((i + 1) / SEGS) * H;
    const r0 = 0.3 - (i / SEGS) * 0.13;
    const r1 = 0.3 - ((i + 1) / SEGS) * 0.13;
    const nx = leanX * Math.pow((i + 1) / SEGS, 2) * H * 0.35;
    const nz = leanX * 0.4 * Math.pow((i + 1) / SEGS, 2) * H * 0.2;
    // Approximate the curve by offsetting each segment's centre.
    addColumnBetween(mb, px, pz, nx, nz, y0, y1, r0, r1, 6, i % 2 ? '#786549' : TRUNK);
    px = nx;
    pz = nz;
  }

  // Crown.
  const FRONDS = 11;
  for (let i = 0; i < FRONDS; i++) {
    const a = (i / FRONDS) * Math.PI * 2 + randRange(rng, -0.12, 0.12);
    const len = randRange(rng, 2.6, 3.7);
    const droop = randRange(rng, 0.9, 1.7);
    const green = i % 3 === 0 ? '#4e7a3a' : i % 3 === 1 ? '#5d8a42' : '#436b33';
    addFrond(mb, px, H, pz, a, len, droop, green);
  }
  // Coconut cluster.
  mb.addBox(px, H - 0.25, pz, 0.5, 0.4, 0.5, 1, '#6d5c44', { bottom: true });
  return mb.build();
}

function addColumnBetween(
  mb: MeshBuilder,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  y0: number,
  y1: number,
  r0: number,
  r1: number,
  sides: number,
  color: string,
) {
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2;
    const a1 = ((i + 1) / sides) * Math.PI * 2;
    mb.addQuad(
      { x: x0 + Math.cos(a0) * r0, y: y0, z: z0 + Math.sin(a0) * r0 },
      { x: x0 + Math.cos(a1) * r0, y: y0, z: z0 + Math.sin(a1) * r0 },
      { x: x1 + Math.cos(a1) * r1, y: y1, z: z1 + Math.sin(a1) * r1 },
      { x: x1 + Math.cos(a0) * r1, y: y1, z: z1 + Math.sin(a0) * r1 },
      1.2,
      color,
    );
  }
}

/** One drooping frond: a 4-segment tapered strip that curves downward. */
function addFrond(
  mb: MeshBuilder,
  ox: number,
  oy: number,
  oz: number,
  angle: number,
  length: number,
  droop: number,
  color: string,
) {
  const SEG = 4;
  const dx = Math.cos(angle);
  const dz = Math.sin(angle);
  for (let i = 0; i < SEG; i++) {
    const t0 = i / SEG;
    const t1 = (i + 1) / SEG;
    const r0 = length * t0;
    const r1 = length * t1;
    // Parabolic droop: flat at the base, falling away at the tip.
    const y0 = oy + 0.35 - droop * t0 * t0;
    const y1 = oy + 0.35 - droop * t1 * t1;
    const w0 = 0.42 * (1 - t0 * 0.75);
    const w1 = 0.42 * (1 - t1 * 0.75);
    // Perpendicular in the ground plane gives the frond its width.
    const nx = -dz;
    const nz = dx;
    mb.addQuad(
      { x: ox + dx * r0 - nx * w0, y: y0, z: oz + dz * r0 - nz * w0 },
      { x: ox + dx * r0 + nx * w0, y: y0, z: oz + dz * r0 + nz * w0 },
      { x: ox + dx * r1 + nx * w1, y: y1, z: oz + dz * r1 + nz * w1 },
      { x: ox + dx * r1 - nx * w1, y: y1, z: oz + dz * r1 - nz * w1 },
      1.5,
      color,
    );
  }
}

/** Low ornamental shrub - a cluster of overlapping leafy blocks. */
export function makeShrubGeometry(seed = 3): THREE.BufferGeometry {
  const mb = new MeshBuilder({ vertexColors: true });
  const rng = makeRng(seed);
  const GREENS = ['#4c6f39', '#577d42', '#41632f'];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const r = randRange(rng, 0.15, 0.5);
    mb.addBox(
      Math.cos(a) * r,
      randRange(rng, 0.3, 0.75),
      Math.sin(a) * r,
      randRange(rng, 0.6, 1.0),
      randRange(rng, 0.5, 0.9),
      randRange(rng, 0.6, 1.0),
      1.2,
      GREENS[i % 3],
      { bottom: false },
    );
  }
  return mb.build();
}

/** A wheel: short cylinder whose axis runs along X. */
function addWheel(mb: MeshBuilder, cx: number, cy: number, cz: number, radius: number, width: number) {
  const SIDES = 10;
  const hw = width / 2;
  for (let i = 0; i < SIDES; i++) {
    const a0 = (i / SIDES) * Math.PI * 2;
    const a1 = ((i + 1) / SIDES) * Math.PI * 2;
    const y0 = cy + Math.sin(a0) * radius;
    const z0 = cz + Math.cos(a0) * radius;
    const y1 = cy + Math.sin(a1) * radius;
    const z1 = cz + Math.cos(a1) * radius;
    // Tread band.
    mb.addQuad(
      { x: cx - hw, y: y0, z: z0 },
      { x: cx + hw, y: y0, z: z0 },
      { x: cx + hw, y: y1, z: z1 },
      { x: cx - hw, y: y1, z: z1 },
      0.6,
      '#1c1e20',
    );
    // Hub faces.
    mb.addQuad(
      { x: cx + hw, y: cy, z: cz },
      { x: cx + hw, y: y0, z: z0 },
      { x: cx + hw, y: y1, z: z1 },
      { x: cx + hw, y: cy, z: cz },
      0.6,
      '#6e7477',
    );
    mb.addQuad(
      { x: cx - hw, y: cy, z: cz },
      { x: cx - hw, y: y1, z: z1 },
      { x: cx - hw, y: y0, z: z0 },
      { x: cx - hw, y: cy, z: cz },
      0.6,
      '#6e7477',
    );
  }
}

/**
 * A traffic signal: post, mast arm, and a three-lamp head facing the traffic
 * it governs (spec 21).
 *
 * The lamp lenses are left WHITE in vertex colour so the renderer can tint
 * them per instance: one instance per lamp, so a head is three instances and
 * only the lit one is bright. Baking colours in would mean either three
 * separate meshes or a shader, for no gain.
 */
export function makeSignalPostGeometry(): THREE.BufferGeometry {
  const mb = new MeshBuilder({ vertexColors: true });
  const DARK = '#2c3136';
  // Post, facing +X by convention; the instance is rotated to face its traffic.
  addColumn(mb, 0, 0, 0, 4.6, 0.09, 0.075, 8, DARK);
  // Mast arm reaching out over the carriageway.
  mb.addBox(1.3, 4.5, 0, 2.6, 0.1, 0.1, 1, DARK);
  // Backing board behind the lamps.
  mb.addBox(2.45, 3.95, 0, 0.1, 1.1, 0.4, 1, DARK, { bottom: true });
  return mb.build();
}

/** One signal lens. Tinted per instance to whichever colour is showing. */
export function makeSignalLampGeometry(): THREE.BufferGeometry {
  const mb = new MeshBuilder({ vertexColors: true });
  // A short disc facing +X, slightly proud of the backing board.
  const R = 0.13;
  const SIDES = 10;
  for (let i = 0; i < SIDES; i++) {
    const a0 = (i / SIDES) * Math.PI * 2;
    const a1 = ((i + 1) / SIDES) * Math.PI * 2;
    const y0 = Math.sin(a0) * R;
    const z0 = Math.cos(a0) * R;
    const y1 = Math.sin(a1) * R;
    const z1 = Math.cos(a1) * R;
    mb.addQuad(
      { x: 0, y: 0, z: 0 },
      { x: 0, y: y0, z: z0 },
      { x: 0, y: y1, z: z1 },
      { x: 0, y: 0, z: 0 },
      0.4,
      '#ffffff',
    );
    void y1;
    void z1;
  }
  return mb.build();
}
