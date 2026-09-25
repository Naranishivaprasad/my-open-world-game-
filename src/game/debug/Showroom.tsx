'use client';

import * as THREE from 'three';
import { useEffect, useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { Environment } from '@react-three/drei';
import { VEHICLE_KEYS, VEHICLE_TYPES, makeVehicleGeometry, makePoliceGeometry, type VehicleKey } from '../world/vehicleGeometry';

/**
 * A turntable strip showing every vehicle body class at a controllable angle.
 *
 * Deliberately standalone: no physics, no city, no HUD, so it loads in about a
 * second and the only thing in frame is the bodywork being judged.
 *
 * Query parameters:
 *   ?view=side|front|rear|iso   camera angle (default iso)
 *   ?only=sedan                 show one class, filling the frame
 */
export function Showroom() {
  const [view, setView] = useState('iso');
  const [only, setOnly] = useState<string | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setView(q.get('view') ?? 'iso');
    setOnly(q.get('only'));
  }, []);

  // 'police' is not a body class of its own; it is the saloon in livery.
  const all = useMemo<ShowKey[]>(() => [...VEHICLE_KEYS, 'police'], []);
  const keys = useMemo<ShowKey[]>(
    () => (only && (all as string[]).includes(only) ? [only as ShowKey] : all),
    [only, all],
  );

  // Bodies face +X, so the strip has to run ACROSS the viewing direction or
  // the vehicles hide behind one another: along X for a broadside view, along
  // Z when looking at noses and tails.
  const alongX = view === 'side';
  const spacing = alongX ? 7.2 : 3.4;
  const span = (keys.length - 1) * spacing;

  const dist = only ? 8 : Math.max(16, span * 0.72);
  const eye: Record<string, [number, number, number]> = {
    side: [0, 1.5, dist],
    front: [dist, 1.5, 0],
    rear: [-dist, 1.5, 0],
    iso: [dist * 0.72, dist * 0.4, dist * 0.62],
  };
  const camPos = eye[view] ?? eye.iso!;

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#aeb8c2' }}>
      <Canvas
        shadows="percentage"
        camera={{ position: camPos, fov: 38 }}
        onCreated={({ camera }) => camera.lookAt(0, 0.7, 0)}
        gl={{ antialias: true }}
      >
        {/* The same HDRI the game uses, so paint and glass read as they will in world. */}
        <Environment files="/hdri/vendor/sky_midday.hdr" environmentIntensity={0.95} />
        <hemisphereLight args={['#cfe2f2', '#6b6257', 0.35]} />
        <directionalLight
          position={[8, 14, 6]}
          intensity={2.2}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-20}
          shadow-camera-right={20}
          shadow-camera-top={20}
          shadow-camera-bottom={-20}
        />
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[120, 120]} />
          <meshStandardMaterial color="#8e9499" roughness={0.95} />
        </mesh>
        {keys.map((k, i) => (
          <Body key={k} vkey={k} offset={only ? 0 : -span / 2 + i * spacing} alongX={alongX} />
        ))}
      </Canvas>
      <div
        style={{
          position: 'fixed', left: 12, bottom: 12, font: '13px ui-monospace, monospace',
          color: '#10161c', background: '#ffffffcc', padding: '6px 10px', borderRadius: 6,
        }}
      >
        {keys.map((k) => (k === 'police' ? 'police cruiser' : `${k} ${VEHICLE_TYPES[k].length.toFixed(2)}x${VEHICLE_TYPES[k].width.toFixed(2)}x${VEHICLE_TYPES[k].height.toFixed(2)}m`)).join('  |  ')}
      </div>
    </div>
  );
}

/** A body class, plus the liveried cruiser. */
type ShowKey = VehicleKey | 'police';

const PAINTS = ['#b8453a', '#d8d5cf', '#2f3f52', '#c9b184', '#264a3d', '#5d6e84', '#8c5a3c', '#a8aeb2'];

function Body({ vkey, offset, alongX }: { vkey: ShowKey; offset: number; alongX: boolean }) {
  const geometry = useMemo(
    () => (vkey === 'police' ? makePoliceGeometry() : makeVehicleGeometry(vkey)),
    [vkey],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);

  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        color: PAINTS[Math.abs(Math.round(offset)) % PAINTS.length],
        roughness: 0.45,
        metalness: 0.32,
      }),
    [offset],
  );
  useEffect(() => () => material.dispose(), [material]);

  return <mesh geometry={geometry} material={material} position={alongX ? [offset, 0, 0] : [0, 0, offset]} castShadow receiveShadow />;
}
