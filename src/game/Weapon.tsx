import * as THREE from 'three';
import { useMemo, useEffect } from 'react';
import { MeshBuilder } from './world/meshBuilder';

/** Generates a low-poly gun mesh. */
export function makeGunGeometry() {
  const mb = new MeshBuilder({ vertexColors: true });
  // Barrel
  mb.addBox(0, 0.05, 0.15, 0.04, 0.04, 0.25, 1, '#333333');
  // Grip
  mb.addBox(0, -0.05, -0.02, 0.03, 0.1, 0.04, 1, '#111111');
  return mb.build();
}

export function Weapon({ parentBone }: { parentBone: THREE.Object3D }) {
  const geometry = useMemo(() => makeGunGeometry(), []);
  const material = useMemo(() => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.5 }), []);
  
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
    mesh.position.set(0, 0.05, 0);
    
    parentBone.add(mesh);
    return () => {
      parentBone.remove(mesh);
    };
  }, [parentBone, geometry, material]);

  return null;
}
