import * as THREE from 'three';
import { sim } from '../core/sim';

/** Simple class to spawn blood decals directly in the scene. */
export class BloodDecalSystem {
  static addBlood(position: THREE.Vector3) {
    if (!sim.scene) return;
    const geo = new THREE.PlaneGeometry(1.5, 1.5);
    const mat = new THREE.MeshStandardMaterial({ 
      color: 0x660000, 
      transparent: true, 
      opacity: 0.9, 
      roughness: 0.2,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    
    // Flatten against ground
    mesh.position.copy(position);
    mesh.position.y = 0.02 + Math.random() * 0.01; 
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = Math.random() * Math.PI * 2;
    mesh.scale.setScalar(0.5 + Math.random() * 0.8);
    
    sim.scene.add(mesh);
    
    // Clean up after 20 seconds
    setTimeout(() => {
      if (sim.scene) sim.scene.remove(mesh);
      geo.dispose();
      mat.dispose();
    }, 20000);
  }
}
