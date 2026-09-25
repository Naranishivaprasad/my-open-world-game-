'use client';

import * as THREE from 'three';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useBeforePhysicsStep, useRapier } from '@react-three/rapier';
import { TrafficSystem } from './TrafficSystem';
import { VEHICLE_KEYS, VEHICLE_TYPES, makeVehicleGeometry, type VehicleKey } from '../world/vehicleGeometry';
import { FIXED_DT } from '../character/Player';
import type { QualitySettings } from '../config/quality';
import { DEBUG_HOOKS, sim } from '../core/sim';

/**
 * Renders lane-following traffic as a single instanced mesh (spec 34).
 *
 * The simulation runs on the fixed physics step; this component only reads
 * agent transforms and writes instance matrices.
 */
export function Traffic({
  quality,
  onReady,
}: {
  quality: QualitySettings;
  onReady?: (s: TrafficSystem) => void;
}) {
  const { world, rapier } = useRapier();
  const systemRef = useRef<TrafficSystem | null>(null);
  /** One mesh per body class; agents are bucketed into them each frame. */
  const meshRefs = useRef<Partial<Record<VehicleKey, THREE.InstancedMesh | null>>>({});

  const geos = useMemo(() => {
    const out = {} as Record<VehicleKey, THREE.BufferGeometry>;
    for (const k of VEHICLE_KEYS) out[k] = makeVehicleGeometry(k);
    return out;
  }, []);
  const material = useMemo(
    () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.25 }),
    [],
  );

  useEffect(() => {
    const list = Object.values(geos);
    return () => {
      list.forEach((g) => g.dispose());
      material.dispose();
    };
  }, [geos, material]);

  useEffect(() => {
    const system = new TrafficSystem(world, rapier);
    systemRef.current = system;
    onReady?.(system);
    if (DEBUG_HOOKS && typeof window !== 'undefined') {
      const w = window as unknown as { __PALM__?: Record<string, unknown> };
      w.__PALM__ = { ...(w.__PALM__ ?? {}), traffic: system };
    }
    return () => {
      system.dispose();
      systemRef.current = null;
    };
  }, [world, rapier, onReady]);

  useEffect(() => {
    systemRef.current?.setTargetCount(quality.trafficCount);
  }, [quality.trafficCount]);

  useBeforePhysicsStep(() => {
    systemRef.current?.update(FIXED_DT);
  });

  useFrame(() => {
    const system = systemRef.current;
    if (!system) return;

    const agents = system.agents;
    const count = Math.min(agents.length, quality.trafficCount + 4);

    // Bucket agents by body class, then fill each class's mesh. A mesh's
    // `count` is the number of agents of that class this frame, so classes
    // with nobody on the road cost nothing.
    const used: Partial<Record<VehicleKey, number>> = {};
    for (let i = 0; i < count; i++) {
      const a = agents[i]!;
      const mesh = meshRefs.current[a.kind];
      if (!mesh) continue;
      const n = used[a.kind] ?? 0;
      if (n >= mesh.instanceMatrix.count) continue;

      const t = a.body.translation();
      const r = a.body.rotation();
      // The body's origin is its centre; the geometry's origin is on the road.
      POS.set(t.x, t.y - VEHICLE_TYPES[a.kind].height / 2, t.z);
      QUAT.set(r.x, r.y, r.z, r.w);
      // The vehicle geometry faces +X along its length; the body's facing is -Z.
      QUAT.multiply(MODEL_FIX);
      MAT.compose(POS, QUAT, SCALE);
      mesh.setMatrixAt(n, MAT);
      COLOR.set(a.colour);
      mesh.setColorAt(n, COLOR);
      used[a.kind] = n + 1;
    }

    for (const k of VEHICLE_KEYS) {
      const mesh = meshRefs.current[k];
      if (!mesh) continue;
      mesh.count = used[k] ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }

    sim.stats.trafficCount = agents.length;
  });

  const max = quality.trafficCount + 4;

  return (
    <group name="traffic">
      {VEHICLE_KEYS.map((key) => (
        <instancedMesh
          key={key}
          ref={(m) => {
            meshRefs.current[key] = m;
          }}
          args={[geos[key], material, max]}
          castShadow={quality.shadowsEnabled}
          receiveShadow
          frustumCulled={false}
        />
      ))}
    </group>
  );
}

const POS = new THREE.Vector3();
const QUAT = new THREE.Quaternion();
const SCALE = new THREE.Vector3(1, 1, 1);
const MAT = new THREE.Matrix4();
const COLOR = new THREE.Color();
/** Parked-car geometry runs along X; rotate it to run along the body's -Z. */
const MODEL_FIX = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
