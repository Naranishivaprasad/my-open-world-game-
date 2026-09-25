import * as THREE from 'three';

/**
 * Clothing for the mannequin, without a second model (spec 12).
 *
 * The only rigged humanoid available under a clean licence is an untextured
 * two-tone dummy, which reads as a robot. Rather than leave it that way, each
 * vertex is classified into a BODY REGION - skin, shirt, trousers, shoes, hair
 * - from the bone it is skinned to, and the shader then paints each region a
 * different colour.
 *
 * The classification is baked into the SHARED geometry once, as a single float
 * attribute. Only the four colour uniforms differ per character, so a street
 * full of differently dressed people still costs one copy of the mesh.
 *
 * This is clothing by paint, not by geometry: there are no collars, cuffs or
 * folds. It makes the crowd read as people rather than as machines; it does not
 * make them look modelled.
 */

export const REGION = {
  skin: 0,
  shirt: 1,
  trousers: 2,
  shoes: 3,
  hair: 4,
} as const;

export interface Outfit {
  skin: string;
  shirt: string;
  trousers: string;
  shoes: string;
  hair: string;
}

/** Skin tones, deliberately a wide range. */
const SKIN = ['#f0c8a0', '#e0a97c', '#c68642', '#8d5524', '#5c3317', '#ffdbac', '#a0673c', '#6f4326'];
const HAIR = ['#1b1512', '#2e211a', '#4a3120', '#6d4b2a', '#8a6a3f', '#3a3a3c', '#7d7b78', '#241c19'];
const SHIRT = [
  '#c8503c', '#2f6f7e', '#d99a2b', '#3d7a4e', '#8e4a6b', '#d8d5cf', '#44506b',
  '#7a8288', '#b36a3c', '#2c3e50', '#6b8f71', '#e0dcd2', '#9c3f4a', '#4a6b8a',
];
const TROUSERS = ['#2f3640', '#3d4450', '#5a4634', '#22303c', '#4a4a4a', '#6b6357', '#2b3a2e', '#38404d'];
const SHOES = ['#1c1e20', '#2a2320', '#3a3a3c', '#54463a', '#1a232c'];

const pickFrom = <T,>(list: T[], r: number) => list[Math.floor(r * list.length) % list.length]!;

/**
 * An outfit from a uniform random source.
 *
 * `rand` is passed in rather than using Math.random so pedestrian appearance
 * can ride the seeded generator and stay stable for a given city seed.
 */
export function makeOutfit(rand: () => number): Outfit {
  return {
    skin: pickFrom(SKIN, rand()),
    hair: pickFrom(HAIR, rand()),
    shirt: pickFrom(SHIRT, rand()),
    trousers: pickFrom(TROUSERS, rand()),
    shoes: pickFrom(SHOES, rand()),
  };
}

/** The player's own outfit: a plain, slightly smarter look than the crowd. */
export const PLAYER_OUTFIT: Outfit = {
  skin: '#e0a97c',
  hair: '#2e211a',
  shirt: '#2c3e50',
  trousers: '#2f3640',
  shoes: '#1c1e20',
};

/** The mission contact. Warmer and brighter than the player's outfit. */
export const MARA_OUTFIT: Outfit = {
  skin: '#c68642',
  hair: '#1b1512',
  shirt: '#c8503c',
  trousers: '#3d4450',
  shoes: '#2a2320',
};

/**
 * Which region a bone belongs to.
 *
 * Matched against Rigify DEF- bone names, longest and most specific first, so
 * `DEF-f_index.01.L` is a hand and not caught by a looser rule.
 */
function regionForBone(name: string): number {
  const n = name.toLowerCase();
  if (n.includes('foot') || n.includes('toe')) return REGION.shoes;
  if (n.includes('hand') || n.includes('f_index') || n.includes('f_middle') || n.includes('f_pinky') || n.includes('f_ring') || n.includes('thumb')) {
    return REGION.skin;
  }
  if (n.includes('forearm')) return REGION.skin; // short sleeves
  if (n.includes('head') || n.includes('neck')) return REGION.skin;
  if (n.includes('thigh') || n.includes('shin') || n.includes('hips')) return REGION.trousers;
  // Shoulders, upper arms and the whole spine are shirt.
  return REGION.shirt;
}

/**
 * Bake a per-vertex region attribute into a skinned geometry.
 *
 * The region comes from the bone with the highest skin weight, which is exact
 * enough everywhere except the seams between regions, where a vertex belongs
 * to whichever side pulls on it hardest - the same rule the deformation uses.
 *
 * Safe to call repeatedly; it returns immediately if the attribute exists.
 */
export function bakeRegions(mesh: THREE.SkinnedMesh) {
  const geo = mesh.geometry;
  if (geo.getAttribute('aRegion')) return;

  const skinIndex = geo.getAttribute('skinIndex');
  const weights = geo.getAttribute('skinWeight');
  const pos = geo.getAttribute('position');
  if (!skinIndex || !weights || !pos) return;

  const bones = mesh.skeleton.bones;
  const boneRegion = bones.map((b) => regionForBone(b.name));

  const regions = new Float32Array(pos.count);
  let headMinY = Infinity;
  let headMaxY = -Infinity;

  for (let i = 0; i < pos.count; i++) {
    let bestW = -1;
    let bestBone = 0;
    for (let k = 0; k < 4; k++) {
      const w = weights.getComponent(i, k);
      if (w > bestW) {
        bestW = w;
        bestBone = skinIndex.getComponent(i, k);
      }
    }
    const region = boneRegion[bestBone] ?? REGION.shirt;
    regions[i] = region;

    // Track the head's vertical extent so a skullcap can be carved out of it.
    const boneName = bones[bestBone]?.name.toLowerCase() ?? '';
    if (boneName.includes('head')) {
      const y = pos.getY(i);
      if (y < headMinY) headMinY = y;
      if (y > headMaxY) headMaxY = y;
    }
  }

  // Hair: the top of the head only. Without it every character is bald, which
  // reads as a mannequin even once the clothes are on.
  if (headMaxY > headMinY) {
    const hairLine = headMinY + (headMaxY - headMinY) * 0.62;
    for (let i = 0; i < pos.count; i++) {
      if (regions[i] !== REGION.skin) continue;
      if (pos.getY(i) >= hairLine) regions[i] = REGION.hair;
    }
  }

  geo.setAttribute('aRegion', new THREE.BufferAttribute(regions, 1));
}

export interface OutfitMaterial {
  material: THREE.MeshStandardMaterial;
  setOutfit: (o: Outfit) => void;
}

/**
 * A material that paints each baked region its own colour.
 *
 * One of these per character. The geometry stays shared; only these five
 * uniforms differ, so dressing a crowd costs almost nothing.
 */
export function makeOutfitMaterial(outfit: Outfit): OutfitMaterial {
  const uniforms = {
    uSkin: { value: new THREE.Color(outfit.skin) },
    uShirt: { value: new THREE.Color(outfit.shirt) },
    uTrousers: { value: new THREE.Color(outfit.trousers) },
    uShoes: { value: new THREE.Color(outfit.shoes) },
    uHair: { value: new THREE.Color(outfit.hair) },
  };

  const material = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    roughness: 0.82,
    metalness: 0.02,
  });

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aRegion;\nvarying float vRegion;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vRegion = aRegion;');

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         varying float vRegion;
         uniform vec3 uSkin;
         uniform vec3 uShirt;
         uniform vec3 uTrousers;
         uniform vec3 uShoes;
         uniform vec3 uHair;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         {
           // Nearest region, so interpolation across a seam never invents a
           // sixth colour halfway between trousers and shoes.
           float r = floor(vRegion + 0.5);
           vec3 region = uShirt;
           if (r < 0.5)      region = uSkin;
           else if (r < 1.5) region = uShirt;
           else if (r < 2.5) region = uTrousers;
           else if (r < 3.5) region = uShoes;
           else              region = uHair;
           diffuseColor.rgb *= region;
         }`,
      );
  };
  // Changing onBeforeCompile means three must rebuild the program.
  material.customProgramCacheKey = () => 'palm-outfit';

  return {
    material,
    setOutfit: (o: Outfit) => {
      uniforms.uSkin.value.set(o.skin);
      uniforms.uShirt.value.set(o.shirt);
      uniforms.uTrousers.value.set(o.trousers);
      uniforms.uShoes.value.set(o.shoes);
      uniforms.uHair.value.set(o.hair);
    },
  };
}

/**
 * Dress one cloned character: bake the regions and swap every material.
 *
 * Both of the model's materials are replaced, including the dark "joints"
 * material - leaving that one in place is what made the mannequin look like a
 * machine wearing clothes.
 */
export function dressCharacter(root: THREE.Object3D, outfit: Outfit): () => void {
  const { material, setOutfit } = makeOutfitMaterial(outfit);
  setOutfit(outfit);

  root.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    bakeRegions(mesh);
    mesh.material = material;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });

  return () => material.dispose();
}
