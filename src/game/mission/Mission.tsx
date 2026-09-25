'use client';

import * as THREE from 'three';
import { useEffect, useMemo, useRef } from 'react';
import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { MissionSystem } from './MissionSystem';
import type { PoliceSystem } from '../police/PoliceSystem';
import * as campaign from '../config/missions';
import { FIRST_DELIVERY, MISSION_MARKER } from '../config/mission';
import { CHARACTER_MODEL, CLIPS } from '../config/character';
import { MARA_OUTFIT, dressCharacter } from '../character/outfits';
import { DEBUG_HOOKS, sim } from '../core/sim';
import { input } from '../input/InputManager';

/**
 * Mission world content: the contact, the crate, and the objective markers
 * (spec 24).
 *
 * Markers only ever appear for the CURRENT objective, so there are never stale
 * markers left over from a previous run or a restart. The crate is a real
 * object in the world that disappears when collected and reappears at the drop
 * point when delivered.
 */
export function Mission({
  onReady,
  police,
}: {
  onReady?: (m: MissionSystem) => void;
  /** Missions that begin with the police already on you need this. */
  police?: PoliceSystem | null;
}) {
  const gltf = useGLTF(CHARACTER_MODEL.url, false);
  const systemRef = useRef<MissionSystem | null>(null);

  const markerRef = useRef<THREE.Mesh>(null);
  const zoneRef = useRef<THREE.Mesh>(null);
  const crateRef = useRef<THREE.Group>(null);
  const contactRef = useRef<THREE.Group>(null);

  // --- the contact: her own skeleton clone, playing an idle loop ---
  const contact = useMemo(() => {
    const root = skeletonClone(gltf.scene) as THREE.Group;
    // Mara has her own look, so she reads as a person rather than as another
    // copy of the player (spec 12).
    const dispose = dressCharacter(root, MARA_OUTFIT);
    root.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh;
      if (!mesh.isMesh) return;
      mesh.frustumCulled = false;
    });

    const mixer = new THREE.AnimationMixer(root);
    const clip = gltf.animations.find((c) => c.name === CLIPS.idle);
    if (clip) mixer.clipAction(clip).play();

    return { root, mixer, dispose };
  }, [gltf.scene, gltf.animations]);

  useEffect(
    () => () => {
      contact.mixer.stopAllAction();
      contact.dispose();
    },
    [contact],
  );

  // --- marker materials ---
  const markerMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    [],
  );
  const zoneMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    [],
  );
  const crateMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#8a6f52', roughness: 0.85 }),
    [],
  );
  useEffect(
    () => () => {
      markerMat.dispose();
      zoneMat.dispose();
      crateMat.dispose();
    },
    [markerMat, zoneMat, crateMat],
  );

  useEffect(() => {
    const system = new MissionSystem();
    systemRef.current = system;
    system.start();
    onReady?.(system);
    if (DEBUG_HOOKS && typeof window !== 'undefined') {
      const w = window as unknown as { __PALM__?: Record<string, unknown> };
      w.__PALM__ = { ...(w.__PALM__ ?? {}), mission: system, campaign };
    }

    return () => {
      systemRef.current = null;
    };
  }, [onReady]);

  // Missions that start with a wanted level need the police system, which
  // mounts independently, so the hook is refreshed rather than captured once.
  useEffect(() => {
    const system = systemRef.current;
    if (!system) return;
    system.onSetWanted = (level) => {
      const p = sim.player.position;
      police?.setWanted(level, p.x, p.z);
    };
    return () => {
      if (systemRef.current) systemRef.current.onSetWanted = null;
    };
  }, [police]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    const system = systemRef.current;
    if (!system) return;

    // Feed the interact key, and let any key skip dialogue (spec 24).
    if (sim.input.interactPressed) system.interactPressed = true;
    if (input.consumePress('map') && sim.mission.dialogue) system.skipDialogue();

    system.update(dt);
    contact.mixer.update(dt);

    /*
     * What the marker points at: the current objective, or - while a job is
     * merely on offer - the contact who hands it out. An objective with no
     * radius ("lose the police") is not a place and gets no marker.
     */
    const offered = system.currentState === 'available' ? system.offered : null;
    const obj =
      system.objective && system.objective.radius > 0
        ? system.objective
        : offered
          ? { x: offered.contact.x, z: offered.contact.z, radius: 3.2, tone: 'contact' as const }
          : null;

    // --- objective marker ---
    const marker = markerRef.current;
    const zone = zoneRef.current;
    if (marker && zone) {
      if (obj) {
        const colour = MISSION_MARKER.colours[obj.tone ?? 'contact'];
        markerMat.color.set(colour);
        zoneMat.color.set(colour);

        const pulse =
          0.5 + 0.5 * Math.sin((sim.elapsed / MISSION_MARKER.pulsePeriod) * Math.PI * 2);
        marker.visible = true;
        marker.position.set(obj.x, MISSION_MARKER.height / 2, obj.z);
        marker.scale.set(1 + pulse * 0.12, 1, 1 + pulse * 0.12);
        markerMat.opacity = 0.22 + pulse * 0.16;

        // A wide ground ring only for "drive here" zones.
        const wide = obj.radius > 6;
        zone.visible = wide;
        if (wide) {
          zone.position.set(obj.x, 0.06, obj.z);
          const r = obj.radius * MISSION_MARKER.zoneRadiusScale;
          zone.scale.set(r, r, 1);
        }
      } else {
        marker.visible = false;
        zone.visible = false;
      }
    }

    // --- crate: present at the pickup until collected, then at the drop ---
    const crate = crateRef.current;
    if (crate) {
      const collect = FIRST_DELIVERY.objectives.find((o) => o.id === 'collect-crate')!;
      const deliver = FIRST_DELIVERY.objectives.find((o) => o.id === 'deliver-crate')!;
      const state = sim.mission.state;
      const idx = sim.mission.objectiveIndex;
      const collectIdx = FIRST_DELIVERY.objectives.indexOf(collect);
      const deliverIdx = FIRST_DELIVERY.objectives.indexOf(deliver);

      if (state === 'completed') {
        crate.visible = true;
        crate.position.set(deliver.x, 0.3, deliver.z);
      } else if (idx <= collectIdx && state === 'active') {
        crate.visible = true;
        crate.position.set(collect.x, 0.3, collect.z);
      } else if (idx > deliverIdx) {
        crate.visible = true;
        crate.position.set(deliver.x, 0.3, deliver.z);
      } else {
        // Being carried: hidden, because the mannequin has no carry animation.
        crate.visible = false;
      }
    }

    // --- the contact stands at her post, facing the forecourt ---
    const c = contactRef.current;
    if (c) {
      const meet = FIRST_DELIVERY.objectives[0]!;
      c.position.set(meet.x, 0, meet.z);
      c.rotation.y = Math.PI * 0.15;
      // She stays at her post whatever happens, so the mission can be restarted
      // and the contact is never a disappearing mission-critical entity (spec 24).
      c.visible = true;
    }
  });

  return (
    <group name="mission">
      <mesh ref={markerRef} material={markerMat} visible={false}>
        <cylinderGeometry args={[MISSION_MARKER.radius, MISSION_MARKER.radius, MISSION_MARKER.height, 18, 1, true]} />
      </mesh>

      <mesh ref={zoneRef} material={zoneMat} rotation-x={-Math.PI / 2} visible={false}>
        <ringGeometry args={[0.86, 1, 40]} />
      </mesh>

      <group ref={crateRef} visible={false}>
        <mesh castShadow receiveShadow material={crateMat}>
          <boxGeometry args={[0.72, 0.6, 0.72]} />
        </mesh>
        <mesh position={[0, 0.31, 0]} material={crateMat}>
          <boxGeometry args={[0.78, 0.05, 0.78]} />
        </mesh>
      </group>

      <group ref={contactRef}>
        <primitive object={contact.root} />
      </group>
    </group>
  );
}
