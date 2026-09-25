import * as THREE from 'three';

/**
 * Shared material library (spec 34: shared materials, few draw calls).
 *
 * World geometry is merged into a handful of large meshes whose UVs are already
 * in world-metre space (u = x / tileSize). Textures therefore tile at 1:1 repeat
 * and a single material covers an entire surface class.
 *
 * Textures come from /public/textures/vendor (ambientCG, CC0) fetched by
 * `npm run assets`. If a map is absent the material degrades to a tuned flat
 * PBR colour rather than throwing - the game still runs, it just looks plainer.
 */

export type MaterialKey =
  | 'asphalt'
  | 'concrete'
  | 'plaster'
  | 'brick'
  | 'grass'
  | 'corrugated'
  | 'dirt'
  | 'sand';

interface MapSet {
  color?: THREE.Texture;
  normal?: THREE.Texture;
  roughness?: THREE.Texture;
  ao?: THREE.Texture;
}

/** Fallbacks used when a texture set failed to download. */
const FLAT_FALLBACK: Record<MaterialKey, { color: string; roughness: number; metalness: number }> = {
  asphalt: { color: '#4a4a4c', roughness: 0.94, metalness: 0 },
  concrete: { color: '#b3aea4', roughness: 0.88, metalness: 0 },
  plaster: { color: '#cfc7b8', roughness: 0.92, metalness: 0 },
  brick: { color: '#9d6a52', roughness: 0.93, metalness: 0 },
  grass: { color: '#6d7c46', roughness: 0.96, metalness: 0 },
  corrugated: { color: '#8e9296', roughness: 0.55, metalness: 0.85 },
  dirt: { color: '#8a7a63', roughness: 0.97, metalness: 0 },
  sand: { color: '#ddcba4', roughness: 0.97, metalness: 0 },
};

export class MaterialLibrary {
  private loader = new THREE.TextureLoader();
  private sets = new Map<MaterialKey, MapSet>();
  private materials = new Map<string, THREE.Material>();
  private anisotropy = 4;
  private disposed = false;

  constructor(anisotropy: number) {
    this.anisotropy = Math.min(16, Math.max(1, anisotropy));
  }

  /**
   * Load one texture, resolving to undefined (not rejecting) when the file is
   * missing, so a failed asset never blocks the whole world.
   */
  private loadTexture(url: string, srgb: boolean): Promise<THREE.Texture | undefined> {
    return new Promise((resolve) => {
      this.loader.load(
        url,
        (tex) => {
          tex.wrapS = THREE.RepeatWrapping;
          tex.wrapT = THREE.RepeatWrapping;
          tex.anisotropy = this.anisotropy;
          // Colour maps are sRGB; normal/roughness/AO are raw data (spec 7).
          tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
          resolve(tex);
        },
        undefined,
        () => resolve(undefined),
      );
    });
  }

  /**
   * Load every material set. `onStep` reports real progress for the loader UI.
   *
   * Which channels exist is read from /assets-manifest.json, written by
   * `npm run assets`. Several ambientCG materials ship no AmbientOcclusion map,
   * and requesting one unconditionally would 404 on every load.
   */
  async load(keys: MaterialKey[], onStep?: (done: number, total: number) => void): Promise<void> {
    const available = await this.readManifest();

    let done = 0;
    const total = keys.length;
    for (const key of keys) {
      const base = `/textures/vendor/${key}/${key}`;
      const has = available.get(key) ?? new Set(['color', 'normal', 'roughness']);
      const want = (name: string, srgb: boolean) =>
        has.has(name) ? this.loadTexture(`${base}_${name}.jpg`, srgb) : Promise.resolve(undefined);

      const [color, normal, roughness, ao] = await Promise.all([
        want('color', true),
        want('normal', false),
        want('roughness', false),
        want('ao', false),
      ]);
      if (this.disposed) return;
      this.sets.set(key, { color, normal, roughness, ao });
      done++;
      onStep?.(done, total);
    }
  }

  private async readManifest(): Promise<Map<string, Set<string>>> {
    const out = new Map<string, Set<string>>();
    try {
      const res = await fetch('/assets-manifest.json');
      if (!res.ok) return out;
      const data = (await res.json()) as {
        assets?: { key?: string; maps?: string[]; kind?: string }[];
      };
      for (const a of data.assets ?? []) {
        if (a.kind === 'pbr-material' && a.key && Array.isArray(a.maps)) {
          out.set(a.key, new Set(a.maps));
        }
      }
    } catch {
      // Manifest missing: fall back to the common three-channel set.
    }
    return out;
  }

  /** True when the real PBR maps for a key are present. */
  hasMaps(key: MaterialKey): boolean {
    return !!this.sets.get(key)?.color;
  }

  /**
   * A shared MeshStandardMaterial for a surface class.
   *
   * @param key      which texture set to use
   * @param opts.tint multiplied over the albedo; use for per-surface variation
   * @param opts.vertexColors enable when the merged geometry carries per-vertex tint
   */
  get(
    key: MaterialKey,
    opts: {
      tint?: THREE.ColorRepresentation;
      vertexColors?: boolean;
      roughness?: number;
      metalness?: number;
      normalScale?: number;
    } = {},
  ): THREE.MeshStandardMaterial {
    const cacheKey = `${key}|${opts.tint ?? 'none'}|${opts.vertexColors ? 'vc' : ''}|${opts.roughness ?? ''}|${opts.metalness ?? ''}|${opts.normalScale ?? ''}`;
    const cached = this.materials.get(cacheKey);
    if (cached) return cached as THREE.MeshStandardMaterial;

    const set = this.sets.get(key);
    const fb = FLAT_FALLBACK[key];

    /*
     * Only pass map slots that actually have a texture.
     *
     * three warns on any parameter explicitly set to undefined, and several of
     * these materials genuinely have no AO map (ambientCG does not ship one for
     * Concrete034 or PaintedPlaster017), so passing `aoMap: undefined` produced
     * a console warning on every material built.
     */
    const params: THREE.MeshStandardMaterialParameters = {
      color: opts.tint ?? (set?.color ? 0xffffff : fb.color),
      roughness: opts.roughness ?? (set?.roughness ? 1 : fb.roughness),
      metalness: opts.metalness ?? fb.metalness,
      vertexColors: !!opts.vertexColors,
    };
    if (set?.color) params.map = set.color;
    if (set?.normal) params.normalMap = set.normal;
    if (set?.roughness) params.roughnessMap = set.roughness;
    if (set?.ao) params.aoMap = set.ao;

    const mat = new THREE.MeshStandardMaterial(params);
    if (mat.normalMap && opts.normalScale !== undefined) {
      mat.normalScale.set(opts.normalScale, opts.normalScale);
    }
    this.materials.set(cacheKey, mat);
    return mat;
  }

  /** Register an externally built material so it is disposed with the library. */
  own<T extends THREE.Material>(id: string, make: () => T): T {
    const existing = this.materials.get(id);
    if (existing) return existing as T;
    const mat = make();
    this.materials.set(id, mat);
    return mat;
  }

  /**
   * Dispose every material and texture this library created.
   * Only called when the whole world is torn down - shared assets must not be
   * disposed while another entity still uses them (spec 7, spec 35).
   */
  dispose() {
    this.disposed = true;
    for (const mat of this.materials.values()) mat.dispose();
    this.materials.clear();
    for (const set of this.sets.values()) {
      set.color?.dispose();
      set.normal?.dispose();
      set.roughness?.dispose();
      set.ao?.dispose();
    }
    this.sets.clear();
  }
}

// ------------------------------------------------------------- canvas textures

/**
 * Small procedurally drawn textures for things we do not download: road
 * markings, window glass, signage. Drawing them gives crisp, controllable
 * results at tiny download cost.
 */

function makeCanvas(w: number, h: number): { cv: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  return { cv, ctx };
}

function toTexture(cv: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Slightly irregular grime/streak overlay, used to break up flat surfaces. */
export function makeGrimeTexture(seed = 1): THREE.CanvasTexture {
  const { cv, ctx } = makeCanvas(256, 256);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 256, 256);
  let s = seed * 9301;
  const rnd = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  ctx.globalAlpha = 0.06;
  for (let i = 0; i < 160; i++) {
    const x = rnd() * 256;
    const y = rnd() * 256;
    const r = 6 + rnd() * 40;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, '#000000');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  return toTexture(cv);
}

/**
 * A storefront / office window strip: dark glass with a sky gradient and a
 * frame, tiled horizontally along a facade.
 */
export function makeWindowTexture(accent: string): THREE.CanvasTexture {
  const { cv, ctx } = makeCanvas(128, 128);
  ctx.fillStyle = '#20252b';
  ctx.fillRect(0, 0, 128, 128);
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, 'rgba(168,200,240,0.85)');
  g.addColorStop(0.55, 'rgba(90,120,150,0.5)');
  g.addColorStop(1, 'rgba(30,38,46,0.9)');
  ctx.fillStyle = g;
  ctx.fillRect(6, 6, 116, 116);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, 122, 122);
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(64, 6);
  ctx.lineTo(64, 122);
  ctx.stroke();
  return toTexture(cv);
}
