'use client';

import * as THREE from 'three';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { BEACH, GROUND_HALF, PROMENADE_X, SEA_LEVEL, WORLD_HALF } from '../config/world';

/**
 * The sea off Vista del Mar (spec 8, 9).
 *
 * Four crossed wave trains displace the surface, and the normal is rebuilt
 * from their analytic gradient so the lighting and the sky reflection ride the
 * swell rather than lagging behind it.
 *
 * THREE THINGS MAKE IT READ AS A SEA RATHER THAN A SHEET:
 *
 *  1. The mesh is tessellated NON-UNIFORMLY. A uniform grid stretched over a
 *     1.8 km plane gave quads 25 m across, which is far wider than a wave, so
 *     the swell was invisible exactly where the player stands. Columns here
 *     follow a power curve, so they are about a metre apart at the waterline
 *     and tens of metres apart out at the horizon.
 *  2. Waves SHOAL. Amplitude rises as the water shallows, so the swell builds
 *     toward the beach instead of being the same everywhere.
 *  3. The shader knows where the sand is. The beach profile is a known
 *     quadratic, so the shader can work out the depth under any point and
 *     foam the shallows - which is what actually draws the waterline.
 *
 * Deliberately NOT: refraction, buoyancy, or water you can swim in. Real
 * transmission costs a whole extra scene pass per frame.
 *
 * SHADER ORDER NOTE: three computes normals in <beginnormal_vertex>, which runs
 * BEFORE <begin_vertex>. The wave gradient therefore has to be computed in the
 * normal chunk, not alongside the displacement, or the normals lag the surface.
 */
export function Sea() {
  const time = useRef({ value: 0 });

  const geometry = useMemo(() => {
    const COLS = 112;
    const ROWS = 170;
    const zSpan = WORLD_HALF * 2.4;

    const positions = new Float32Array(COLS * ROWS * 3);
    const normals = new Float32Array(COLS * ROWS * 3);
    const uvs = new Float32Array(COLS * ROWS * 2);
    const indices: number[] = [];

    for (let i = 0; i < COLS; i++) {
      // Power curve: dense at the shore, sparse at the horizon.
      const t = Math.pow(i / (COLS - 1), 2.4);
      const x = PROMENADE_X + (GROUND_HALF - PROMENADE_X) * t;
      for (let j = 0; j < ROWS; j++) {
        const z = -zSpan / 2 + (zSpan * j) / (ROWS - 1);
        const k = i * ROWS + j;
        positions[k * 3] = x;
        positions[k * 3 + 1] = 0;
        positions[k * 3 + 2] = z;
        normals[k * 3 + 1] = 1;
        uvs[k * 2] = t;
        uvs[k * 2 + 1] = j / (ROWS - 1);
      }
    }

    for (let i = 0; i < COLS - 1; i++) {
      for (let j = 0; j < ROWS - 1; j++) {
        const a = i * ROWS + j;
        const b = (i + 1) * ROWS + j;
        const c = (i + 1) * ROWS + j + 1;
        const d = i * ROWS + j + 1;
        indices.push(a, b, c, a, c, d);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.translate(0, SEA_LEVEL, 0);
    geo.computeBoundingSphere();
    return geo;
  }, []);

  const material = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
      color: '#15566d',
      /*
       * Rough enough to be water rather than a mirror.
       *
       * At roughness 0.14 with envMapIntensity 1.6 the surface reflected the
       * sky almost perfectly, so the whole sea rendered as a sheet of white
       * and neither the waves nor the depth gradient could be seen at all.
       */
      roughness: 0.42,
      metalness: 0.02,
      envMapIntensity: 0.65,
    });

    /**
     * Shared wave code. The gradient is written out by hand rather than
     * sampled, so the normals match the displacement exactly.
     */
    const WAVES = /* glsl */ `
      uniform float uTime;

      /*
       * The sea bed: the beach profile the geometry generator builds, and
       * beyond its far edge a continental slope carrying on downward.
       *
       * Without that slope the bed stopped at the beach's last height, so
       * every point in the ocean counted as barely a metre deep and the whole
       * sea rendered as shallow, foaming water.
       */
      float seabed(float x) {
        float t = clamp((x - ${BEACH.startX.toFixed(1)}) / ${(BEACH.endX - BEACH.startX).toFixed(1)}, 0.0, 1.0);
        float beach = ${BEACH.topY.toFixed(3)} + (${BEACH.bottomY.toFixed(3)} - ${BEACH.topY.toFixed(3)}) * t * t;
        float beyond = max(0.0, x - ${BEACH.endX.toFixed(1)});
        return beach - beyond * 0.09;
      }

      /* Waves build as the water shallows, and ease off in deep water. */
      float shoal(float x) {
        float d = clamp((x - ${BEACH.startX.toFixed(1)}) / 150.0, 0.0, 1.0);
        return mix(1.5, 0.55, d);
      }

      float waveHeight(vec3 p, float t) {
        float a = shoal(p.x);
        float h = 0.0;
        // Shore-parallel swell rolling in toward the beach (-X).
        h += sin(p.x * 0.30 - t * 1.85 + sin(p.z * 0.02) * 1.4) * 0.17 * a;
        h += sin(p.x * 0.155 - t * 1.15 + p.z * 0.026) * 0.27 * a;
        // Cross swell and chop, which stop the crests looking like corduroy.
        h += sin(p.z * 0.075 + t * 0.72) * 0.13;
        h += sin((p.x * 0.52 + p.z * 0.31) - t * 2.5) * 0.065 * a;
        return h;
      }

      vec3 waveNormal(vec3 p, float t) {
        float a = shoal(p.x);
        float dx =
            cos(p.x * 0.30 - t * 1.85 + sin(p.z * 0.02) * 1.4) * 0.17 * a * 0.30
          + cos(p.x * 0.155 - t * 1.15 + p.z * 0.026) * 0.27 * a * 0.155
          + cos((p.x * 0.52 + p.z * 0.31) - t * 2.5) * 0.065 * a * 0.52;
        float dz =
            cos(p.x * 0.155 - t * 1.15 + p.z * 0.026) * 0.27 * a * 0.026
          + cos(p.z * 0.075 + t * 0.72) * 0.13 * 0.075
          + cos((p.x * 0.52 + p.z * 0.31) - t * 2.5) * 0.065 * a * 0.31;
        return normalize(vec3(-dx, 1.0, -dz));
      }
    `;

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = time.current;

      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${WAVES}\nvarying vec3 vWorld;\nvarying float vWave;`)
        // Normals first, from the gradient of the same wave function.
        .replace('#include <beginnormal_vertex>', `vec3 objectNormal = waveNormal(position, uTime);`)
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           float wh = waveHeight(position, uTime);
           transformed.y += wh;
           vWorld = transformed;
           vWave = wh;`,
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
           uniform float uTime;
           varying vec3 vWorld;
           varying float vWave;

           float seabedF(float x) {
             float t = clamp((x - ${BEACH.startX.toFixed(1)}) / ${(BEACH.endX - BEACH.startX).toFixed(1)}, 0.0, 1.0);
             float beach = ${BEACH.topY.toFixed(3)} + (${BEACH.bottomY.toFixed(3)} - ${BEACH.topY.toFixed(3)}) * t * t;
             float beyond = max(0.0, x - ${BEACH.endX.toFixed(1)});
             return beach - beyond * 0.09;
           }`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
           {
             // How deep the water is here, given the bed underneath it.
             float depth = vWorld.y - seabedF(vWorld.x);

             // Shallow water is lighter and greener; deep water goes darker.
             float shallow = 1.0 - clamp(depth / 3.2, 0.0, 1.0);
             diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.48, 0.52), shallow * 0.8);
             float deep = clamp((depth - 4.0) / 12.0, 0.0, 1.0);
             diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03, 0.15, 0.24), deep * 0.65);

             // Surf: a band of foam in the last half-metre of water, plus the
             // crest of any wave steep enough to be breaking.
             float surf = smoothstep(0.50, 0.04, depth);
             float crest = smoothstep(0.16, 0.34, vWave);
             float foam = clamp(surf * 0.8 + crest * surf * 0.8 + crest * 0.18, 0.0, 1.0);
             diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.96, 0.97), foam);
           }`,
        );
    };
    // The custom shader must not share a cached program with a plain material.
    mat.customProgramCacheKey = () => 'palm-sea';
    return mat;
  }, []);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  useFrame((_, delta) => {
    time.current.value += Math.min(delta, 0.1);
  });

  return <mesh geometry={geometry} material={material} frustumCulled={false} receiveShadow={false} />;
}
