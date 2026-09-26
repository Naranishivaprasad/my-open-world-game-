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
import { useFrame } from '@react-three/fiber';
import { sim } from './core/sim';

export function Weapon({ parentBone }: { parentBone: THREE.Object3D }) {
  const geometry = useMemo(() => makeGunGeometry(), []);
  const material = useMemo(() => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.5 }), []);
  const meshRef = useRef<THREE.Mesh | null>(null);
  
  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  // We add the mesh into a group, then attach the group to the bone
  // We use createPortal? No, React Three Fiber primitive or createPortal works.
  // The simplest is to just manually add/remove it to the bone in an effect.
  
  useEffect(() => {
    const mesh = new THREE.Mesh(geometry, material);
    // Align weapon with hand bone
    mesh.rotation.y = Math.PI; 
    mesh.rotation.x = Math.PI / 2;
    // Offset so it actually sits in the hand instead of clipping into the neck
    mesh.position.set(0, 0.15, 0.05);
    
    // Default to hidden
    mesh.visible = false;
    
    parentBone.add(mesh);
    
    meshRef.current = mesh;
    
    return () => {
      parentBone.remove(mesh);
      meshRef.current = null;
    };
  }, [parentBone, geometry, material]);

  useFrame(() => {
    if (meshRef.current) {
      // Keep it always visible so the player knows they have a gun!
      meshRef.current.visible = true;
    }
  });

  return null;
}
