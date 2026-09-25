'use client';

import * as THREE from 'three';
import { useEffect, useMemo, useRef } from 'react';
import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useBeforePhysicsStep, useRapier } from '@react-three/rapier';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { CharacterController } from './CharacterController';
import { Animator } from './Animator';
import { PLAYER_OUTFIT, dressCharacter } from './outfits';
import { CHARACTER_MODEL } from '../config/character';
import { useGame } from '../core/store';
import { PLAYER_SPAWN } from '../config/world';
import { DEBUG_HOOKS, sim } from '../core/sim';

/**
 * The player character: physics capsule, animated mesh, and the bridge between
 * them (spec 11, 12).
 *
 * PLACEHOLDER BODY - the Quaternius CC0 asset ships an untextured articulated
 * mannequin (verified: images=0). It is styled here as a deliberate two-tone
 * dummy rather than dressed up as a photoreal human. See ASSETS.md.
 */
export function Player({
  onReady,
  onAnimator,
}: {
  onReady?: (ctl: CharacterController) => void;
  onAnimator?: (a: Animator) => void;
}) {
  const { world, rapier } = useRapier();
  const gltf = useGLTF(CHARACTER_MODEL.url, false);

  const groupRef = useRef<THREE.Group>(null);
  const cameraMode = useGame((s) => s.cameraMode);
  const controllerRef = useRef<CharacterController | null>(null);
  const animatorRef = useRef<Animator | null>(null);

  // Clone with SkeletonUtils so the skinned hierarchy and its bones are
  // duplicated properly - a plain .clone() shares one skeleton instance and
  // every copy would animate identically (spec 7).
  const model = useMemo(() => {
    const root = skeletonClone(gltf.scene) as THREE.Group;
    root.scale.setScalar(CHARACTER_MODEL.scale);

    // Clothed rather than left as the bare two-tone dummy (spec 12).
    const dispose = dressCharacter(root, PLAYER_OUTFIT);

    root.traverse((obj) => {
      const mesh = obj as THREE.SkinnedMesh;
      if (!mesh.isMesh) return;
      // The capsule already handles collision; never let the mesh be culled
      // while its bones carry it outside the original bounds.
      mesh.frustumCulled = false;
    });

    return { root, dispose };
  }, [gltf.scene]);

  useEffect(() => () => model.dispose(), [model]);

  // ---------------------------------------------------------------- systems

  useEffect(() => {
    const ctl = new CharacterController(world, rapier, PLAYER_SPAWN);
    controllerRef.current = ctl;
    onReady?.(ctl);

    // Dev-only: lets the automated smoke test place the character at a known
    // open position before measuring movement (spec 36).
    if (DEBUG_HOOKS && typeof window !== 'undefined') {
      const w = window as unknown as { __PALM__?: Record<string, unknown> };
      w.__PALM__ = { ...(w.__PALM__ ?? {}), teleport: (x: number, y: number, z: number) => ctl.teleport(x, y, z) };
    }

    return () => {
      ctl.dispose();
      controllerRef.current = null;
    };
  }, [world, rapier, onReady]);

  useEffect(() => {
    const animator = new Animator(model.root, gltf.animations);
    animatorRef.current = animator;
    onAnimator?.(animator);
    if (animator.missingClips.length) {
      console.warn('[player] clips missing from GLB:', animator.missingClips.join(', '));
    }
    return () => {
      animator.dispose();
      animatorRef.current = null;
    };
  }, [model.root, gltf.animations, onAnimator]);

  // Movement runs on the fixed physics step, not the render frame (spec 20).
  // While the character is entering, seated or exiting, the vehicle
  // interaction system owns its transform instead (spec 17: exactly one
  // controller may drive the character at a time).
  useBeforePhysicsStep(() => {
    if (sim.controlMode !== 'foot') return;
    controllerRef.current?.update(FIXED_DT);
  });

  // Presentation follows the simulation each rendered frame.
  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    const animator = animatorRef.current;
    animator?.update(dt);
    if (animator) sim.player.clip = animator.currentClip;

    const g = groupRef.current;
    if (!g) return;
    const p = sim.player.position;
    g.position.set(p.x, p.y, p.z);
    g.rotation.y = sim.player.heading + CHARACTER_MODEL.yawOffset;
  });

  /*
   * In the cockpit camera the eye sits inside the character's head, so the
   * body is hidden rather than left to clip through the view (spec 18).
   *
   * Being honest about the limitation: this means there are no visible hands
   * on the wheel, unlike reference image 2. Posing the mannequin's arms onto
   * this car's wheel needs IK that is not implemented yet.
   */
  const hidden = cameraMode === 'fp-vehicle';

  return (
    <group ref={groupRef} name="player" visible={!hidden}>
      <primitive object={model.root} />
    </group>
  );
}

/** Must match the Physics `timeStep` prop. */
export const FIXED_DT = 1 / 60;

useGLTF.preload(CHARACTER_MODEL.url, false);
