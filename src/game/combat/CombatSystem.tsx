import { useFrame, useThree } from '@react-three/fiber';
import { useRapier } from '@react-three/rapier';
import { sim } from '../core/sim';
import * as THREE from 'three';
import { audio } from '../audio/AudioSystem';
import { BloodDecalSystem } from './BloodDecalSystem';

export function CombatSystem() {
  const { rapier, world } = useRapier();
  const { camera } = useThree();

  useFrame(() => {
    if (sim.police.state === 'busted') {
      if (!(window as any).bustedTimer) (window as any).bustedTimer = sim.elapsed;
      if (sim.elapsed - (window as any).bustedTimer > 3) {
        if ((window as any).__PALM__?.teleport) {
          (window as any).__PALM__.teleport(0, 1, 0);
        }
        sim.police.wanted = 0;
        sim.police.state = 'unaware';
        if ((window as any).__PALM__?.police) {
          (window as any).__PALM__.police.wanted = 0;
          (window as any).__PALM__.police.state = 'unaware';
        }
        (window as any).bustedTimer = null;
      }
      return;
    } else {
      (window as any).bustedTimer = null;
    }

    if (sim.controlMode !== 'foot') return;

    if (sim.input.firePressed && sim.input.aimHeld) {
      // Fire a raycast from the camera
      const origin = camera.position;
      const direction = new THREE.Vector3(0, 0, -1);
      direction.applyQuaternion(camera.quaternion);

      // Play gunshot
      audio.playGunshotSound();

      const ray = new rapier.Ray(origin, direction);
      const hit = world.castRay(ray, 100, true, rapier.QueryFilterFlags.EXCLUDE_SENSORS);

      if (hit) {
        const point = ray.pointAt((hit as any).toi);
        const pointV3 = new THREE.Vector3(point.x, point.y, point.z);
        // Draw bullet tracer
        VisualEffects.addTracer(origin, pointV3);

        // Find if it hit a pedestrian
        const peds = sim.pedestrians?.peds;
        let hitPed = false;
        if (peds) {
          const ped = peds.find((p: any) => p.collider.handle === hit.collider.handle);
          if (ped) {
            hitPed = true;
            sim.pedestrians.knock(ped);
            ped.body.applyImpulse(direction.multiplyScalar(150), true);
            BloodDecalSystem.addBlood(pointV3);
            audio.playKillSound();
            sim.police.wanted = Math.max(sim.police.wanted, 2);
          }
        }
        
        if (!hitPed) {
          // Hit the ground or wall
          VisualEffects.addBulletImpact(pointV3, ray.pointAt((hit as any).toi - 0.05));
        }
      }
    }
  });

  return null;
}

class VisualEffects {
  static addTracer(start: THREE.Vector3, end: THREE.Vector3) {
    if (!sim.scene) return;
    const material = new THREE.LineBasicMaterial({ color: 0xffff00, transparent: true, opacity: 0.8 });
    const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
    const line = new THREE.Line(geometry, material);
    sim.scene.add(line);
    
    // Fade out and remove
    let opacity = 0.8;
    const interval = setInterval(() => {
      opacity -= 0.1;
      if (opacity <= 0) {
        clearInterval(interval);
        sim.scene?.remove(line);
        geometry.dispose();
        material.dispose();
      } else {
        material.opacity = opacity;
      }
    }, 16);
  }

  static addBulletImpact(position: THREE.Vector3, slightOffset: THREE.Vector3) {
    if (!sim.scene) return;
    
    // Bullet hole decal
    const geo = new THREE.PlaneGeometry(0.1, 0.1);
    const mat = new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.8, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    
    const offsetPos = new THREE.Vector3(slightOffset.x, slightOffset.y, slightOffset.z);
    mesh.position.copy(offsetPos);
    mesh.lookAt(position); // Orient to face the incoming ray
    
    sim.scene.add(mesh);
    
    setTimeout(() => {
      sim.scene?.remove(mesh);
      geo.dispose();
      mat.dispose();
    }, 5000);
  }
}
