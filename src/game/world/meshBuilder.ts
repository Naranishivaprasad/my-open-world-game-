import * as THREE from 'three';

/**
 * Accumulates triangles into a single merged BufferGeometry.
 *
 * UVs are emitted in WORLD METRES divided by a tile size, so a texture tiles at
 * true physical scale no matter how large the merged mesh is, and one material
 * can cover the whole surface class (spec 34: instancing/shared materials, few
 * draw calls).
 *
 * Per-vertex colours carry surface variation (building paint, marking colour)
 * so a single material still yields a varied city.
 */
export class MeshBuilder {
  private pos: number[] = [];
  private nor: number[] = [];
  private uv: number[] = [];
  private col: number[] = [];
  private idx: number[] = [];
  private readonly useColor: boolean;
  private tmpColor = new THREE.Color();

  constructor(opts: { vertexColors?: boolean } = {}) {
    this.useColor = !!opts.vertexColors;
  }

  get triangleCount() {
    return this.idx.length / 3;
  }

  get isEmpty() {
    return this.idx.length === 0;
  }

  /**
   * Add a quad from four world-space corners wound counter-clockwise when
   * viewed from the front. UVs are projected onto the plane the quad lies in.
   *
   * @param tile metres per texture repeat
   */
  addQuad(
    a: THREE.Vector3Like,
    b: THREE.Vector3Like,
    c: THREE.Vector3Like,
    d: THREE.Vector3Like,
    tile: number,
    color?: THREE.ColorRepresentation,
  ) {
    const base = this.pos.length / 3;

    // Face normal from the first triangle.
    const ux = b.x - a.x;
    const uy = b.y - a.y;
    const uz = b.z - a.z;
    const vx = d.x - a.x;
    const vy = d.y - a.y;
    const vz = d.z - a.z;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl;
    ny /= nl;
    nz /= nl;

    // Project onto whichever world plane the face most faces, so UVs stay in
    // metres regardless of orientation.
    const ax = Math.abs(nx);
    const ay = Math.abs(ny);
    const az = Math.abs(nz);
    const project = (p: THREE.Vector3Like): [number, number] => {
      if (ay >= ax && ay >= az) return [p.x / tile, p.z / tile]; // floor/ceiling
      if (ax >= az) return [p.z / tile, p.y / tile]; // wall facing +/-X
      return [p.x / tile, p.y / tile]; // wall facing +/-Z
    };

    for (const p of [a, b, c, d]) {
      this.pos.push(p.x, p.y, p.z);
      this.nor.push(nx, ny, nz);
      const [u, v] = project(p);
      this.uv.push(u, v);
      if (this.useColor) {
        this.tmpColor.set(color ?? 0xffffff);
        this.col.push(this.tmpColor.r, this.tmpColor.g, this.tmpColor.b);
      }
    }

    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** Axis-aligned horizontal rectangle at height y, facing up. */
  addFloor(x0: number, z0: number, x1: number, z1: number, y: number, tile: number, color?: THREE.ColorRepresentation) {
    const ax = Math.min(x0, x1);
    const bx = Math.max(x0, x1);
    const az = Math.min(z0, z1);
    const bz = Math.max(z0, z1);
    this.addQuad(
      { x: ax, y, z: bz },
      { x: bx, y, z: bz },
      { x: bx, y, z: az },
      { x: ax, y, z: az },
      tile,
      color,
    );
  }

  /**
   * Axis-aligned box. `faces` lets callers skip hidden faces (a building's
   * underside, a kerb's inner wall) to keep the triangle budget honest.
   */
  addBox(
    cx: number,
    cy: number,
    cz: number,
    sx: number,
    sy: number,
    sz: number,
    tile: number,
    color?: THREE.ColorRepresentation,
    faces: { top?: boolean; bottom?: boolean; px?: boolean; nx?: boolean; pz?: boolean; nz?: boolean } = {},
  ) {
    const {
      top = true,
      bottom = false,
      px = true,
      nx = true,
      pz = true,
      nz = true,
    } = faces;
    const x0 = cx - sx / 2;
    const x1 = cx + sx / 2;
    const y0 = cy - sy / 2;
    const y1 = cy + sy / 2;
    const z0 = cz - sz / 2;
    const z1 = cz + sz / 2;

    if (top) {
      this.addQuad({ x: x0, y: y1, z: z1 }, { x: x1, y: y1, z: z1 }, { x: x1, y: y1, z: z0 }, { x: x0, y: y1, z: z0 }, tile, color);
    }
    if (bottom) {
      this.addQuad({ x: x0, y: y0, z: z0 }, { x: x1, y: y0, z: z0 }, { x: x1, y: y0, z: z1 }, { x: x0, y: y0, z: z1 }, tile, color);
    }
    if (pz) {
      this.addQuad({ x: x0, y: y0, z: z1 }, { x: x1, y: y0, z: z1 }, { x: x1, y: y1, z: z1 }, { x: x0, y: y1, z: z1 }, tile, color);
    }
    if (nz) {
      this.addQuad({ x: x1, y: y0, z: z0 }, { x: x0, y: y0, z: z0 }, { x: x0, y: y1, z: z0 }, { x: x1, y: y1, z: z0 }, tile, color);
    }
    if (px) {
      this.addQuad({ x: x1, y: y0, z: z1 }, { x: x1, y: y0, z: z0 }, { x: x1, y: y1, z: z0 }, { x: x1, y: y1, z: z1 }, tile, color);
    }
    if (nx) {
      this.addQuad({ x: x0, y: y0, z: z0 }, { x: x0, y: y0, z: z1 }, { x: x0, y: y1, z: z1 }, { x: x0, y: y1, z: z0 }, tile, color);
    }
  }

  build(): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    // aoMap requires a second UV channel; reuse the first.
    geo.setAttribute('uv1', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.useColor) {
      geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    }
    geo.setIndex(this.idx);
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    return geo;
  }
}

/** A static box collider handed to Rapier. All city collision is axis-aligned. */
export interface BoxColliderDef {
  /** Centre position. */
  x: number;
  y: number;
  z: number;
  /** HALF extents, as Rapier's cuboid expects. */
  hx: number;
  hy: number;
  hz: number;
  /**
   * Set when this collider belongs to a parked vehicle, so the renderer can
   * match it back to its instance and release it if the player drives away.
   */
  parked?: { key: string; index: number };
}

export function boxCollider(
  cx: number,
  cy: number,
  cz: number,
  sx: number,
  sy: number,
  sz: number,
): BoxColliderDef {
  return { x: cx, y: cy, z: cz, hx: sx / 2, hy: sy / 2, hz: sz / 2 };
}

// ------------------------------------------------------------------ chunking

export interface GeometryChunk {
  /** Chunk centre, world metres. */
  cx: number;
  cz: number;
  geometry: THREE.BufferGeometry;
}

/**
 * Split one merged geometry into a grid of spatial chunks (spec 34, 35).
 *
 * A single merged city mesh can never be frustum-culled: if any part of it is
 * on screen the whole thing is drawn. Splitting by position means a player
 * standing in one district does not pay for the geometry of the other eight.
 *
 * Triangles are assigned by centroid, so a triangle spanning a boundary lands
 * in exactly one chunk and nothing is duplicated or dropped.
 */
export function splitIntoChunks(
  source: THREE.BufferGeometry,
  chunkSize: number,
): GeometryChunk[] {
  const pos = source.getAttribute('position');
  const nor = source.getAttribute('normal');
  const uv = source.getAttribute('uv');
  const col = source.getAttribute('color');
  const index = source.getIndex();
  if (!pos || !index) return [{ cx: 0, cz: 0, geometry: source }];

  interface Bucket {
    p: number[];
    n: number[];
    u: number[];
    c: number[];
    i: number[];
    /** Maps a source vertex index to its index within this bucket. */
    remap: Map<number, number>;
  }
  const buckets = new Map<string, Bucket>();

  const triCount = index.count / 3;
  for (let t = 0; t < triCount; t++) {
    const a = index.getX(t * 3);
    const b = index.getX(t * 3 + 1);
    const c = index.getX(t * 3 + 2);

    const centroidX = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3;
    const centroidZ = (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3;
    const gx = Math.floor(centroidX / chunkSize);
    const gz = Math.floor(centroidZ / chunkSize);
    const key = `${gx},${gz}`;

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { p: [], n: [], u: [], c: [], i: [], remap: new Map() };
      buckets.set(key, bucket);
    }

    for (const v of [a, b, c]) {
      let local = bucket.remap.get(v);
      if (local === undefined) {
        local = bucket.p.length / 3;
        bucket.remap.set(v, local);
        bucket.p.push(pos.getX(v), pos.getY(v), pos.getZ(v));
        if (nor) bucket.n.push(nor.getX(v), nor.getY(v), nor.getZ(v));
        if (uv) bucket.u.push(uv.getX(v), uv.getY(v));
        if (col) bucket.c.push(col.getX(v), col.getY(v), col.getZ(v));
      }
      bucket.i.push(local);
    }
  }

  const chunks: GeometryChunk[] = [];
  for (const [key, bucket] of buckets) {
    const [gx, gz] = key.split(',').map(Number) as [number, number];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(bucket.p, 3));
    if (nor) geo.setAttribute('normal', new THREE.Float32BufferAttribute(bucket.n, 3));
    if (uv) {
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(bucket.u, 2));
      geo.setAttribute('uv1', new THREE.Float32BufferAttribute(bucket.u, 2));
    }
    if (col) geo.setAttribute('color', new THREE.Float32BufferAttribute(bucket.c, 3));
    geo.setIndex(bucket.i);
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    chunks.push({
      cx: (gx + 0.5) * chunkSize,
      cz: (gz + 0.5) * chunkSize,
      geometry: geo,
    });
  }

  source.dispose();
  return chunks;
}
