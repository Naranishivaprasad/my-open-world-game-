import * as THREE from 'three';
import { useMemo, useEffect, useRef } from 'react';
import { MeshBuilder } from './world/meshBuilder';

export function makeGunGeometry() {
  const mb = new MeshBuilder({ vertexColors: true });
  // Main Receiver
  mb.addBox(0, 0, 0, 0.04, 0.06, 0.2, 1, '#222222');
  // Barrel
  mb.addBox(0, 0, 0.2, 0.02, 0.02, 0.3, 1, '#111111');
  // Grip
  mb.addBox(0, -0.08, -0.05, 0.03, 0.12, 0.05, 1, '#111111');
  // Magazine
  mb.addBox(0, -0.08, 0.05, 0.03, 0.12, 0.06, 1, '#333333');
  // Stock
  mb.addBox(0, -0.02, -0.2, 0.03, 0.08, 0.2, 1, '#222222');
  // Scope
  mb.addBox(0, 0.05, -0.02, 0.03, 0.03, 0.15, 1, '#111111');
  
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
    <mesh geometry={geometry} position={[0, 0.15, 0.05]} rotation={[Math.PI / 2, Math.PI, 0]}>
      <meshStandardMaterial vertexColors={true} roughness={0.7} metalness={0.5} />
    </mesh>,
    parentBone
  );
}
