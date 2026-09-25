'use client';

import * as THREE from 'three';
import { useEffect, useMemo, useRef } from 'react';
import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useBeforePhysicsStep, useRapier } from '@react-three/rapier';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { PedestrianSystem } from './PedestrianSystem';
import type { TrafficSystem } from './TrafficSystem';
import { CHARACTER_MODEL, CLIPS } from '../config/character';
import { PLAYER_OUTFIT, bakeRegions, makeOutfitMaterial, type Outfit } from '../character/outfits';
import { PEDESTRIAN } from '../config/traffic';
import { FIXED_DT } from '../character/Player';
import { DEBUG_HOOKS, sim } from '../core/sim';
import type { QualitySettings } from '../config/quality';

/**
 * Renders pedestrians (spec 22).
 *
 * Each pedestrian gets its OWN skeleton clone and its OWN AnimationMixer via
 * SkeletonUtils.clone - sharing one skinned instance would make every
 * pedestrian move identically (spec 7). Clip time is offset per pedestrian so
 * a group never steps in unison.
 *
 * Distant pedestrians skip mixer updates entirely, which is where most of the
 * cost of a crowd lives (spec 34).
 */
export function Pedestrians({
  quality,
  traffic,
  onReady,
}: {
  quality: QualitySettings;
  traffic: TrafficSystem | null;
  onReady?: (s: PedestrianSystem) => void;
}) {
  const { world, rapier } = useRapier();
  const gltf = useGLTF(CHARACTER_MODEL.url, false);
  const systemRef = useRef<PedestrianSystem | null>(null);
  const groupRef = useRef<THREE.Group>(null);

  const poolSize = quality.pedestrianCount + 3;

  /** Pre-built avatars, reused as pedestrians come and go. */
  const pool = useMemo(() => {
    const avatars = Array.from({ length: poolSize }, () => {
      const root = skeletonClone(gltf.scene) as THREE.Group;
      root.visible = false;
      // Every avatar in the pool owns ONE outfit material whose colours are
      // reassigned as pedestrians come and go, so a crowd of ten costs ten
      // small uniform updates rather than ten copies of the mesh.
      const outfit = makeOutfitMaterial(PLAYER_OUTFIT);
      root.traverse((o) => {
        const mesh = o as THREE.SkinnedMesh;
        if (!mesh.isSkinnedMesh) return;
        bakeRegions(mesh);
        mesh.material = outfit.material;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
      });

      const mixer = new THREE.AnimationMixer(root);
      const byName = new Map(gltf.animations.map((c) => [c.name, c]));
      const walkClip = byName.get(CLIPS.walk);
      const idleClip = byName.get(CLIPS.idle);
      const walk = walkClip ? mixer.clipAction(walkClip) : null;
      const idle = idleClip ? mixer.clipAction(idleClip) : null;
      walk?.play();
      idle?.play();
      if (walk) walk.weight = 1;
      if (idle) idle.weight = 0;

      return { root, mixer, walk, idle, outfit, dressed: null as Outfit | null };
    });

    return { avatars };
  }, [gltf.scene, gltf.animations, poolSize]);

  useEffect(() => {
    const g = groupRef.current;
    if (!g) return;
    for (const a of pool.avatars) g.add(a.root);
    return () => {
      for (const a of pool.avatars) {
        a.mixer.stopAllAction();
        g.remove(a.root);
      }
      for (const a of pool.avatars) a.outfit.material.dispose();
    };
  }, [pool]);

  useEffect(() => {
    const system = new PedestrianSystem(world, rapier);
    systemRef.current = system;
    onReady?.(system);
    if (DEBUG_HOOKS && typeof window !== 'undefined') {
      const w = window as unknown as { __PALM__?: Record<string, unknown> };
      w.__PALM__ = { ...(w.__PALM__ ?? {}), pedestrians: system };
    }
    return () => {
      system.dispose();
      systemRef.current = null;
    };
  }, [world, rapier, onReady]);

  useEffect(() => {
    systemRef.current?.setTraffic(traffic);
  }, [traffic]);

  useEffect(() => {
    systemRef.current?.setTargetCount(quality.pedestrianCount);
  }, [quality.pedestrianCount]);

  useBeforePhysicsStep(() => {
    systemRef.current?.update(FIXED_DT);
  });

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    const system = systemRef.current;
    if (!system) return;

    const px = sim.player.position.x;
    const pz = sim.player.position.z;
    const peds = system.peds;

    for (let i = 0; i < pool.avatars.length; i++) {
      const avatar = pool.avatars[i]!;
      const ped = peds[i];

      if (!ped) {
        avatar.root.visible = false;
        continue;
      }

      const t = ped.body.translation();
      avatar.root.visible = true;
      avatar.root.position.set(t.x, t.y - 0.9 * ped.scale, t.z);
      avatar.root.rotation.y = ped.heading;
      avatar.root.scale.setScalar(ped.scale);

      // Re-dress only when this avatar is reused by a different pedestrian.
      if (avatar.dressed !== ped.outfit) {
        avatar.dressed = ped.outfit;
        avatar.outfit.setOutfit(ped.outfit);
      }

      // Blend walk/idle by actual speed, and skip distant mixers entirely.
      const dist = Math.hypot(t.x - px, t.z - pz);
      if (dist > PEDESTRIAN.nearUpdateDistance * 1.6) continue;

      const moving = Math.min(1, ped.speed / 1.3);
      if (avatar.walk) avatar.walk.weight = moving;
      if (avatar.idle) avatar.idle.weight = 1 - moving;
      if (avatar.walk) {
        avatar.walk.timeScale = THREE.MathUtils.clamp(ped.speed / 1.4, 0.6, 1.5);
      }
      avatar.mixer.update(dt);
    }
  });

  return <group ref={groupRef} name="pedestrians" />;
}
