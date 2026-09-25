'use client';

import * as THREE from 'three';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Environment, Stars } from '@react-three/drei';
import type { QualitySettings } from '../config/quality';
import {
  DAY_LENGTH_SECONDS,
  makeSkyLook,
  phaseName,
  skyLookAt,
  sunDirection,
} from '../config/timeOfDay';
import { sim } from '../core/sim';

/**
 * The sky, the sun and the haze, all driven by the in-game clock (spec 10, 27).
 *
 * Everything visible here comes from ONE number, `sim.time.hour`: the sun's
 * direction, its colour and strength, the hemisphere fill, the fog, how much
 * the HDRI contributes, how red the sky shader renders the horizon, and whether
 * stars are out. Because they all read the same source they cannot drift out of
 * agreement - a sunset sky with midday shadows is not expressible.
 *
 * The HDRI is kept for image-based lighting only. Its own sky is NOT used as
 * the background any more, because a photograph of a midday sky cannot be made
 * to look like midnight; a procedural sky can.
 *
 * The shadow camera rides with the player, which is what keeps a 70-90 m shadow
 * range usable across a city a kilometre across.
 */

/** How far up the boom the light sits. Must exceed the tallest geometry. */
const SUN_DISTANCE = 120;

export function Lighting({ quality }: { quality: QualitySettings }) {
  const lightRef = useRef<THREE.DirectionalLight>(null);
  const targetRef = useRef<THREE.Object3D>(null);
  const hemiRef = useRef<THREE.HemisphereLight>(null);
  const domeRef = useRef<THREE.Mesh>(null);
  const starsRef = useRef<THREE.Points>(null);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);

  /** Just inside the far plane, so it is never clipped and never z-fights. */
  const domeRadius = Math.max(200, quality.viewDistance * 0.92);

  const { domeMaterial, domeUniforms } = useMemo(() => {
    const uniforms = {
      uZenith: { value: new THREE.Color('#3f7fd4') },
      uHorizon: { value: new THREE.Color('#c3d8ef') },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color('#fff3e0') },
      uSunGlow: { value: 0.25 },
    };
    const material = new THREE.ShaderMaterial({
      uniforms,
      side: THREE.BackSide,
      // Drawn LAST with depth testing on, so only pixels the city did not
      // already cover are shaded. Drawing the sky first with depthTest off
      // paints every pixel on screen and then throws most of it away - worth
      // about 3 fps here.
      depthWrite: false,
      depthTest: true,
      fog: false,
      toneMapped: true,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uZenith;
        uniform vec3 uHorizon;
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        uniform float uSunGlow;
        varying vec3 vDir;

        void main() {
          vec3 dir = normalize(vDir);
          // Gradient from the horizon up. Below the horizon it keeps the
          // horizon colour, darkened, so the ground plane meets something
          // sensible at the edges of the map.
          float up = dir.y;
          float t = smoothstep(0.0, 0.55, up);
          vec3 col = mix(uHorizon, uZenith, t);
          col *= mix(0.55, 1.0, smoothstep(-0.25, 0.02, up));

          // A broad glow plus a tight core around the sun's direction.
          float d = max(dot(dir, normalize(uSunDir)), 0.0);
          col += uSunColor * (pow(d, 6.0) * 0.35 + pow(d, 220.0) * 3.0) * uSunGlow;

          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    return { domeMaterial: material, domeUniforms: uniforms };
  }, []);

  useEffect(() => () => domeMaterial.dispose(), [domeMaterial]);

  const look = useMemo(() => makeSkyLook(), []);
  const sunDir = useMemo(() => new THREE.Vector3(), []);
  const fog = useMemo(() => new THREE.Fog('#cfdcea', 90, 620), []);

  // Configure the shadow camera to the quality preset.
  useEffect(() => {
    const light = lightRef.current;
    if (!light) return;
    const d = quality.shadowDistance;
    const cam = light.shadow.camera;
    cam.left = -d;
    cam.right = d;
    cam.top = d;
    cam.bottom = -d;
    cam.near = 1;
    cam.far = SUN_DISTANCE * 2.2;
    cam.updateProjectionMatrix();

    light.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
    // Normal bias handles acne on the large flat road far better than a
    // constant bias, which would detach contact shadows.
    light.shadow.bias = -0.0006;
    light.shadow.normalBias = 0.035;
    if (light.shadow.map) {
      light.shadow.map.dispose();
      light.shadow.map = null as unknown as THREE.WebGLRenderTarget;
    }
  }, [quality.shadowDistance, quality.shadowMapSize]);

  // Fog is restrained haze for depth, not a screen effect (spec 10).
  useEffect(() => {
    scene.fog = fog;
    return () => {
      scene.fog = null;
    };
  }, [scene, fog]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);

    // ------------------------------------------------------------- clock
    const t = sim.time;
    if (t.scale > 0) {
      t.hour = (t.hour + (dt / DAY_LENGTH_SECONDS) * 24 * t.scale) % 24;
    }
    skyLookAt(t.hour, look);
    t.phase = phaseName(t.hour);
    // Darkness drives lit windows, streetlights and automatic headlights.
    t.darkness = look.lights;

    // --------------------------------------------------------------- sun
    sunDirection(t.hour, sunDir);

    const light = lightRef.current;
    const target = targetRef.current;
    if (light && target) {
      const p = sim.player.position;
      target.position.set(p.x, p.y, p.z);
      target.updateMatrixWorld();
      light.position.set(
        p.x + sunDir.x * SUN_DISTANCE,
        p.y + sunDir.y * SUN_DISTANCE,
        p.z + sunDir.z * SUN_DISTANCE,
      );
      light.color.copy(look.sun);
      light.intensity = look.sunIntensity;
      // Below the horizon the sun casts nothing; leaving the shadow pass on
      // would draw the whole city twice for a light contributing nothing.
      const up = sunDir.y > 0.02;
      light.castShadow = quality.shadowsEnabled && up;
      light.visible = look.sunIntensity > 0.01;
    }

    const hemi = hemiRef.current;
    if (hemi) {
      hemi.color.copy(look.sky);
      hemi.groundColor.copy(look.ground);
      hemi.intensity = look.ambient;
    }

    // --------------------------------------------------------------- haze
    fog.color.copy(look.haze);
    fog.near = look.hazeNear;
    fog.far = look.hazeFar * quality.hazeScale;

    // ------------------------------------------------------------ sky dome
    const dome = domeRef.current;
    if (dome) {
      // The dome rides with the camera so it can sit just inside the far
      // plane: three's own Sky sits at 4000 m, which this game's 420-1000 m
      // view distance clips away entirely.
      dome.position.copy(camera.position);
      domeUniforms.uZenith.value.copy(look.zenith);
      domeUniforms.uHorizon.value.copy(look.horizon);
      domeUniforms.uSunColor.value.copy(look.sun);
      domeUniforms.uSunDir.value.copy(sunDir);
      domeUniforms.uSunGlow.value = look.sunGlow;
    }

    const stars = starsRef.current;
    if (stars) {
      stars.visible = look.stars > 0.01;
      const mat = stars.material as THREE.ShaderMaterial | undefined;
      if (mat) {
        mat.transparent = true;
        mat.opacity = look.stars;
      }
      // Keep the starfield centred on the player so it never runs out.
      stars.position.copy(camera.position);
    }

    // Image-based lighting follows the clock too, or a night street would be
    // lit by a midday photograph.
    scene.environmentIntensity = look.env;
  });

  return (
    <>
      {/* HDRI for image-based lighting only - the sky itself is procedural. */}
      <Environment files="/hdri/vendor/sky_midday.hdr" environmentIntensity={0.95} />

      <mesh ref={domeRef} renderOrder={1000} frustumCulled={false}>
        <sphereGeometry args={[domeRadius, 32, 20]} />
        <primitive object={domeMaterial} attach="material" />
      </mesh>
      <Stars
        ref={starsRef}
        radius={domeRadius * 0.9}
        depth={domeRadius * 0.25}
        count={2200}
        factor={domeRadius * 0.012}
        saturation={0}
        fade
        speed={0.4}
      />

      <object3D ref={targetRef} />
      <directionalLight
        ref={lightRef}
        castShadow={quality.shadowsEnabled}
        target={targetRef.current ?? undefined}
      />

      {/* Sky/ground bounce so shadowed faces stay readable (spec 10). */}
      <hemisphereLight ref={hemiRef} />
    </>
  );
}
