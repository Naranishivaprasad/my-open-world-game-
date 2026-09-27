import * as THREE from 'three';
import { useMemo, useEffect, useRef } from 'react';
import { MeshBuilder } from './world/meshBuilder';

export function makeGunGeometry() {
  const mb = new MeshBuilder({ vertexColors: true });
  const GUNMETAL = '#2a2e33';
  const BLACK = '#111111';
  
  // Uzi-style SMG
  // Main Receiver Body
  mb.addBox(0, 0, 0, 0.05, 0.08, 0.25, 1, GUNMETAL);
  // Top Cocking Handle / Sight Rail
  mb.addBox(0, 0.05, 0, 0.02, 0.03, 0.15, 1, BLACK);
  // Barrel
  mb.addBox(0, 0.01, 0.15, 0.015, 0.015, 0.15, 1, BLACK);
  // Front Sight
  mb.addBox(0, 0.03, 0.2, 0.01, 0.02, 0.02, 1, BLACK);
  // Rear Sight
  mb.addBox(0, 0.03, -0.1, 0.02, 0.02, 0.02, 1, BLACK);
  // Pistol Grip
  mb.addBox(0, -0.09, -0.05, 0.035, 0.12, 0.05, 1, BLACK);
  // Extended Magazine
  mb.addBox(0, -0.15, -0.04, 0.025, 0.18, 0.04, 1, GUNMETAL);
  // Trigger Guard
  mb.addBox(0, -0.06, 0.01, 0.01, 0.01, 0.06, 1, BLACK);
  // Trigger
  mb.addBox(0, -0.04, -0.01, 0.008, 0.02, 0.01, 1, GUNMETAL);
  // Folding Stock (Folded position)
  mb.addBox(0.03, -0.03, -0.15, 0.01, 0.02, 0.15, 1, GUNMETAL);
  mb.addBox(0.03, -0.03, -0.22, 0.01, 0.08, 0.02, 1, GUNMETAL);
  
  return mb.build();
}
import { useFrame, createPortal } from '@react-three/fiber';
import { sim } from './core/sim';

export function Weapon({ parentBone }: { parentBone: THREE.Object3D }) {
  const geometry = useMemo(() => makeGunGeometry(), []);
  
  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);

  // Use createPortal to attach the weapon directly to the bone in the scene graph
  return createPortal(
    <mesh geometry={geometry} position={[0, 0.15, 0.05]} rotation={[Math.PI / 2, 0, 0]} scale={1.2}>
      <meshStandardMaterial vertexColors={true} roughness={0.7} metalness={0.5} />
    </mesh>,
    parentBone
  );
}
