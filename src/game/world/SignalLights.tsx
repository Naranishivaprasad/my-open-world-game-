'use client';

import * as THREE from 'three';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { makeSignalLampGeometry, makeSignalPostGeometry } from './propGeometry';
import { getSignalJunctions, lampFor, type Axis } from './trafficSignals';
import type { QualitySettings } from '../config/quality';
import { sim } from '../core/sim';

/**
 * Renders the traffic signals (spec 21).
 *
 * The lit lamp is decided by the SAME `lampFor` the traffic system reads, so
 * what the player sees is what the cars are obeying. There is no separate
 * animation state to fall out of step.
 *
 * One post per approach and three lenses per post, all instanced: a city full
 * of signals costs two draw calls.
 */

/** Where a post stands and which way its lamps face. */
interface Head {
  x: number;
  z: number;
  /** Rotation about Y so the lamp faces oncoming traffic. */
  rotY: number;
  /** The axis of traffic this head governs. */
  axis: Axis;
  junction: ReturnType<typeof getSignalJunctions>[number];
}

const OFF = new THREE.Color('#2a2b2c');
const COLOURS: Record<string, THREE.Color> = {
  red: new THREE.Color('#ff3b30'),
  amber: new THREE.Color('#ffb020'),
  green: new THREE.Color('#34d058'),
};

export function SignalLights({ quality }: { quality: QualitySettings }) {
  const postRef = useRef<THREE.InstancedMesh>(null);
  const lampRef = useRef<THREE.InstancedMesh>(null);

  const postGeo = useMemo(() => makeSignalPostGeometry(), []);
  const lampGeo = useMemo(() => makeSignalLampGeometry(), []);
  const postMat = useMemo(
    () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.35 }),
    [],
  );
  const lampMat = useMemo(
    () =>
      // Unlit so a red lamp reads as red at midnight as well as at noon.
      new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
    [],
  );

  useEffect(
    () => () => {
      postGeo.dispose();
      lampGeo.dispose();
      postMat.dispose();
      lampMat.dispose();
    },
    [postGeo, lampGeo, postMat, lampMat],
  );

  /**
   * Four heads per junction, one per approach, each set back at the near
   * corner and turned to face the traffic it stops.
   */
  const heads = useMemo<Head[]>(() => {
    const out: Head[] = [];
    for (const j of getSignalJunctions()) {
      const d = j.half + 1.6;
      // Traffic arriving from -Z travels along +Z and is north-south.
      out.push({ x: j.x - d, z: j.z - d, rotY: 0, axis: 'ns', junction: j });
      out.push({ x: j.x + d, z: j.z + d, rotY: Math.PI, axis: 'ns', junction: j });
      out.push({ x: j.x - d, z: j.z + d, rotY: -Math.PI / 2, axis: 'ew', junction: j });
      out.push({ x: j.x + d, z: j.z - d, rotY: Math.PI / 2, axis: 'ew', junction: j });
    }
    return out;
  }, []);

  // Posts never move, so their matrices are written once.
  useEffect(() => {
    const mesh = postRef.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const one = new THREE.Vector3(1, 1, 1);
    heads.forEach((h, i) => {
      q.setFromAxisAngle(up, h.rotY);
      m.compose(new THREE.Vector3(h.x, 0, h.z), q, one);
      mesh.setMatrixAt(i, m);
    });
    mesh.count = heads.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [heads]);

  // Lamps never move either; only their colour changes.
  useEffect(() => {
    const mesh = lampRef.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const one = new THREE.Vector3(1, 1, 1);
    const pos = new THREE.Vector3();
    // Lens heights on the backing board: red on top, then amber, then green.
    const HEIGHTS = [4.3, 3.95, 3.6];
    heads.forEach((h, i) => {
      q.setFromAxisAngle(up, h.rotY);
      for (let k = 0; k < 3; k++) {
        // The board sits 2.5 m out along the mast arm, in the head's own frame.
        pos.set(2.51, HEIGHTS[k]!, 0).applyQuaternion(q);
        m.compose(pos.add(new THREE.Vector3(h.x, 0, h.z)), q, one);
        mesh.setMatrixAt(i * 3 + k, m);
      }
    });
    mesh.count = heads.length * 3;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [heads]);

  useFrame(() => {
    const mesh = lampRef.current;
    if (!mesh) return;
    const t = sim.elapsed;
    for (let i = 0; i < heads.length; i++) {
      const h = heads[i]!;
      const lit = lampFor(h.junction, t, h.axis);
      for (let k = 0; k < 3; k++) {
        const name = k === 0 ? 'red' : k === 1 ? 'amber' : 'green';
        mesh.setColorAt(i * 3 + k, lit === name ? COLOURS[name]! : OFF);
      }
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  const max = Math.max(1, heads.length);

  return (
    <group name="traffic-signals">
      <instancedMesh
        ref={postRef}
        args={[postGeo, postMat, max]}
        castShadow={quality.shadowsEnabled}
        receiveShadow
      />
      <instancedMesh ref={lampRef} args={[lampGeo, lampMat, max * 3]} />
    </group>
  );
}
