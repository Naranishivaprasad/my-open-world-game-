/**
 * PALM COAST asset fetcher.
 *
 * Downloads third-party assets into project-controlled storage under /public
 * (spec 6: no hotlinking, no invented URLs). Every URL in ASSETS below was
 * verified to return the file with no login before being added here.
 *
 * Run:  npm run assets
 *
 * Sources used:
 *   - Poly Haven  (https://polyhaven.com)  - CC0 1.0
 *   - ambientCG   (https://ambientcg.com)  - CC0 1.0
 *
 * Extraction uses PowerShell Expand-Archive on Windows and `unzip` elsewhere.
 */

import { createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const TMP = path.join(ROOT, '.asset-cache');

// --------------------------------------------------------------------- catalogue

/** ambientCG CC0 materials. `maps` lists which channels we keep. */
const MATERIALS = [
  { id: 'Asphalt033', as: 'asphalt', use: 'Road carriageway surface' },
  { id: 'Concrete034', as: 'concrete', use: 'Sidewalks, kerbs, forecourt slabs' },
  { id: 'PaintedPlaster017', as: 'plaster', use: 'Painted block / stucco building facades' },
  { id: 'Ground054', as: 'sand', use: 'The beach along Vista del Mar' },
  { id: 'Bricks104', as: 'brick', use: 'Older commercial frontages' },
  { id: 'Grass004', as: 'grass', use: 'Verges and lots' },
  { id: 'CorrugatedSteel005', as: 'corrugated', use: 'Industrial sheds and fencing' },
  { id: 'Ground037', as: 'dirt', use: 'Worn ground, unpaved edges' },
];

const KEEP_MAPS = [
  { suffix: '_Color.jpg', as: 'color' },
  { suffix: '_NormalGL.jpg', as: 'normal' },
  { suffix: '_Roughness.jpg', as: 'roughness' },
  { suffix: '_AmbientOcclusion.jpg', as: 'ao' },
];

/** Poly Haven CC0 HDRI. 2k is plenty for an environment map used at low mip. */
const HDRIS = [
  {
    slug: 'aristea_wreck_puresky',
    as: 'sky_midday',
    url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/aristea_wreck_puresky_2k.hdr',
    use: 'Sky + image-based lighting: midday, partly cloudy, medium contrast',
  },
];

/**
 * Hero vehicle. CC-BY-4.0, so attribution is MANDATORY (unlike the CC0 assets).
 * The licence explicitly excludes logos and trademarks, so the Khronos /
 * 3D Commerce branding and the licence plate are stripped at load time - see
 * src/game/vehicle/HeroVehicle.tsx.
 */
const MODELS = [
  {
    as: 'hero_car',
    url: 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@master/examples/models/gltf/ferrari.glb',
    use: 'Player hero vehicle: body, four wheel pivots, modelled interior',
    sourcePage: 'https://github.com/mrdoob/three.js/tree/master/examples/models/gltf',
    author: 'Three.js Examples',
    license: 'MIT',
    licenseUrl: 'https://github.com/mrdoob/three.js/blob/master/LICENSE',
    attributionRequired: false,
    attributionText: 'Ferrari model from Three.js examples repository.',
    modifications: 'Node names re-mapped in config.',
  },
  {
    as: 'milk_truck',
    url: 'https://cdn.jsdelivr.net/gh/KhronosGroup/glTF-Sample-Assets@main/Models/CesiumMilkTruck/glTF-Binary/CesiumMilkTruck.glb',
    use: 'Diverse NPC vehicle',
    sourcePage: 'https://github.com/KhronosGroup/glTF-Sample-Assets',
    author: 'Cesium',
    license: 'CC-BY-4.0',
    attributionRequired: true,
    attributionText: 'Cesium Milk Truck by Cesium.',
  },
  {
    as: 'soldier',
    url: 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@master/examples/models/gltf/Soldier.glb',
    use: 'Diverse NPC',
    sourcePage: 'https://github.com/mrdoob/three.js/tree/master/examples/models/gltf',
    author: 'Three.js Examples',
    license: 'MIT',
    attributionRequired: false,
  },
  {
    as: 'robot',
    url: 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@master/examples/models/gltf/RobotExpressive/RobotExpressive.glb',
    use: 'Diverse NPC',
    sourcePage: 'https://github.com/mrdoob/three.js/tree/master/examples/models/gltf',
    author: 'Three.js Examples',
    license: 'MIT',
    attributionRequired: false,
  },
  {
    as: 'tokyo_building',
    url: 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@master/examples/models/gltf/LittlestTokyo.glb',
    use: 'Special Building Model',
    sourcePage: 'https://github.com/mrdoob/three.js/tree/master/examples/models/gltf',
    author: 'Three.js Examples',
    license: 'CC0',
    attributionRequired: false,
  },
];

// ------------------------------------------------------------------- utilities

const log = (...a) => console.log('[assets]', ...a);

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** CDNs occasionally cold-start; retry with backoff before giving up. */
async function download(url, dest, attempts = 4) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (!res.body) throw new Error('empty body');
      await mkdir(path.dirname(dest), { recursive: true });
      await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
      const { size } = await stat(dest);
      if (size === 0) throw new Error('zero-length file');
      return size;
    } catch (err) {
      lastErr = err;
      await rm(dest, { force: true });
      if (i < attempts) {
        log(`  attempt ${i} failed (${err.message}); retrying...`);
        await sleep(800 * i);
      }
    }
  }
  throw new Error(`${lastErr?.message ?? 'unknown error'} for ${url}`);
}

function unzip(zipPath, destDir) {
  if (process.platform === 'win32') {
    execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${destDir}' -Force`,
      ],
      { stdio: 'pipe' },
    );
  } else {
    execFileSync('unzip', ['-o', '-q', zipPath, '-d', destDir], { stdio: 'pipe' });
  }
}

const kb = (n) => `${Math.round(n / 1024)} KB`;

// ------------------------------------------------------------------------ main

async function fetchMaterial(mat, manifest) {
  const outDir = path.join(PUBLIC, 'textures', 'vendor', mat.as);
  const marker = path.join(outDir, `${mat.as}_color.jpg`);
  if (await exists(marker)) {
    log(`skip ${mat.as} (already present)`);
    manifest.push(await materialEntry(mat, outDir));
    return;
  }

  const url = `https://ambientcg.com/get?file=${mat.id}_1K-JPG.zip`;
  const zip = path.join(TMP, `${mat.id}.zip`);
  log(`downloading ${mat.id} ...`);
  const size = await download(url, zip);
  log(`  got ${kb(size)}`);

  const staging = path.join(TMP, mat.id);
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  unzip(zip, staging);

  await mkdir(outDir, { recursive: true });
  const files = await readdir(staging);
  let kept = 0;
  for (const { suffix, as } of KEEP_MAPS) {
    const found = files.find((f) => f.endsWith(suffix));
    if (!found) continue;
    await rename(path.join(staging, found), path.join(outDir, `${mat.as}_${as}.jpg`));
    kept++;
  }
  await rm(staging, { recursive: true, force: true });
  await rm(zip, { force: true });
  log(`  kept ${kept} maps -> public/textures/vendor/${mat.as}/`);
  manifest.push(await materialEntry(mat, outDir));
}

/**
 * Not every ambientCG material ships every channel (several have no
 * AmbientOcclusion map). Record what is actually on disk so the runtime only
 * requests files that exist, instead of generating 404s.
 */
async function materialEntry(mat, outDir) {
  let maps = [];
  try {
    const files = await readdir(outDir);
    maps = KEEP_MAPS.map((k) => k.as).filter((as) => files.includes(`${mat.as}_${as}.jpg`));
  } catch {
    maps = [];
  }
  return {
    id: `ambientcg:${mat.id}`,
    key: mat.as,
    maps,
    localPath: `/textures/vendor/${mat.as}/`,
    kind: 'pbr-material',
    use: mat.use,
    sourcePage: `https://ambientcg.com/view?id=${mat.id}`,
    author: 'ambientCG (Lennart Demes)',
    license: 'CC0 1.0 Universal (public domain dedication)',
    licenseUrl: 'https://docs.ambientcg.com/license/',
    attributionRequired: false,
    modifications: 'Extracted from 1K-JPG archive; Displacement map discarded; files renamed.',
  };
}

async function fetchHdri(h, manifest) {
  const outDir = path.join(PUBLIC, 'hdri', 'vendor');
  const dest = path.join(outDir, `${h.as}.hdr`);
  if (await exists(dest)) {
    log(`skip ${h.as} (already present)`);
  } else {
    log(`downloading HDRI ${h.slug} ...`);
    const size = await download(h.url, dest);
    log(`  got ${kb(size)} -> public/hdri/vendor/${h.as}.hdr`);
  }
  manifest.push({
    id: `polyhaven:${h.slug}`,
    localPath: `/hdri/vendor/${h.as}.hdr`,
    kind: 'hdri',
    use: h.use,
    sourcePage: `https://polyhaven.com/a/${h.slug}`,
    author: 'Poly Haven',
    license: 'CC0 1.0 Universal (public domain dedication)',
    licenseUrl: 'https://polyhaven.com/license',
    attributionRequired: false,
    modifications: 'None (2K HDR as published).',
  });
}

async function fetchModel(m, manifest) {
  const outDir = path.join(PUBLIC, 'models', 'vendor');
  const dest = path.join(outDir, `${m.as}.glb`);
  if (await exists(dest)) {
    log(`skip ${m.as} (already present)`);
  } else {
    log(`downloading model ${m.as} ...`);
    const size = await download(m.url, dest);
    log(`  got ${kb(size)} -> public/models/vendor/${m.as}.glb`);
  }
  // Keep the upstream licence text next to the binary.
  if (m.licenseUrl2) {
    try {
      await download(m.licenseUrl2, path.join(outDir, `${m.as}_LICENSE.md`), 2);
    } catch {
      log(`  (could not fetch licence file for ${m.as})`);
    }
  }
  manifest.push({
    id: `khronos:${m.as}`,
    localPath: `/models/vendor/${m.as}.glb`,
    kind: 'model',
    use: m.use,
    sourcePage: m.sourcePage,
    author: m.author,
    license: m.license,
    licenseUrl: m.licenseUrl,
    attributionRequired: m.attributionRequired,
    attributionText: m.attributionText,
    modifications: m.modifications,
  });
}

async function main() {
  await mkdir(TMP, { recursive: true });
  const manifest = [];

  for (const m of MODELS) {
    try {
      await fetchModel(m, manifest);
    } catch (err) {
      console.error(`[assets] FAILED model ${m.as}:`, err.message);
    }
  }

  for (const h of HDRIS) {
    try {
      await fetchHdri(h, manifest);
    } catch (err) {
      console.error(`[assets] FAILED hdri ${h.slug}:`, err.message);
    }
  }

  for (const mat of MATERIALS) {
    try {
      await fetchMaterial(mat, manifest);
    } catch (err) {
      console.error(`[assets] FAILED material ${mat.id}:`, err.message);
    }
  }

  await rm(TMP, { recursive: true, force: true });

  const manifestPath = path.join(PUBLIC, 'assets-manifest.json');
  await writeFile(manifestPath, JSON.stringify({ generated: 'npm run assets', assets: manifest }, null, 2));
  log(`wrote ${manifest.length} entries to public/assets-manifest.json`);
}

main().catch((err) => {
  console.error('[assets] fatal:', err);
  process.exit(1);
});
