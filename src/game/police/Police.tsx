'use client';

import * as THREE from 'three';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useBeforePhysicsStep, useRapier } from '@react-three/rapier';
import { PoliceSystem } from './PoliceSystem';
import { makePoliceGeometry } from '../world/vehicleGeometry';
import { POLICE_LIVERY } from '../config/police';
import { FIXED_DT } from '../character/Player';
import { DEBUG_HOOKS, sim } from '../core/sim';
import type { QualitySettings } from '../config/quality';

/**
 * Renders police units and their flashing light bar (spec 23).
 *
 * Kept as an instanced mesh like traffic; the light bar flashes by swapping the
 * per-instance tint, which costs nothing extra.
 */
export function Police({
  quality,
  onReady,
}: {
  quality: QualitySettings;
  onReady?: (s: PoliceSystem) => void;
}) {
  const { world, rapier } = useRapier();
  const systemRef = useRef<PoliceSystem | null>(null);
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const barRef = useRef<THREE.InstancedMesh>(null);

  const carGeo = useMemo(() => makePoliceGeometry(), []);
  const barGeo = useMemo(() => new THREE.BoxGeometry(1.15, 0.16, 0.34), []);
  const carMat = useMemo(
    () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.25 }),
    [],
  );
  const barMat = useMemo(
    () => new THREE.MeshStandardMaterial({ toneMapped: false }),
    [],
  );

  useEffect(
    () => () => {
      carGeo.dispose();
      barGeo.dispose();
      carMat.dispose();
      barMat.dispose();
    },
    [carGeo, barGeo, carMat, barMat],
  );

  useEffect(() => {
    const system = new PoliceSystem(world, rapier);
    systemRef.current = system;
    onReady?.(system);
    if (DEBUG_HOOKS && typeof window !== 'undefined') {
      const w = window as unknown as { __PALM__?: Record<string, unknown> };
      w.__PALM__ = { ...(w.__PALM__ ?? {}), police: system };
    }
    return () => {
      system.dispose();
      systemRef.current = null;
    };
  }, [world, rapier, onReady]);

  useBeforePhysicsStep(() => {
    systemRef.current?.update(FIXED_DT);
  });

  useFrame(() => {
    const mesh = meshRef.current;
    const bar = barRef.current;
    const system = systemRef.current;
    if (!mesh || !bar || !system) return;

    const units = system.units;
    const count = Math.min(units.length, MAX_UNITS);

    // Two-tone flash, alternating sides.
    const phase = Math.floor(sim.elapsed * POLICE_LIVERY.flashHz) % 2 === 0;

    for (let i = 0; i < count; i++) {
      const u = units[i]!;
      const t = u.body.translation();
      const r = u.body.rotation();
      POS.set(t.x, t.y - 0.75, t.z);
      QUAT.set(r.x, r.y, r.z, r.w).multiply(MODEL_FIX);
      MAT.compose(POS, QUAT, SCALE);
      mesh.setMatrixAt(i, MAT);
      COLOR.set(POLICE_LIVERY.body);
      mesh.setColorAt(i, COLOR);

      POS.set(t.x, t.y + 0.05, t.z);
      MAT.compose(POS, QUAT, SCALE);
      bar.setMatrixAt(i, MAT);
      COLOR.set(phase ? POLICE_LIVERY.lightbarBlue : POLICE_LIVERY.lightbarRed);
      bar.setColorAt(i, COLOR);
    }
    mesh.count = count;
    bar.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    bar.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    if (bar.instanceColor) bar.instanceColor.needsUpdate = true;
  });

  return (
    <group name="police">
      <instancedMesh
        ref={meshRef}
        args={[carGeo, carMat, MAX_UNITS]}
        castShadow={quality.shadowsEnabled}
        receiveShadow
        frustumCulled={false}
      />
      <instancedMesh ref={barRef} args={[barGeo, barMat, MAX_UNITS]} frustumCulled={false} />
    </group>
  );
}

const MAX_UNITS = 4;
const POS = new THREE.Vector3();
const QUAT = new THREE.Quaternion();
const SCALE = new THREE.Vector3(1, 1, 1);
const MAT = new THREE.Matrix4();
const COLOR = new THREE.Color();
const MODEL_FIX = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
