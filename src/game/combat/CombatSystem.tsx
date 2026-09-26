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
        sim.player.body?.setTranslation({ x: 0, y: 1, z: 0 }, true);
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
        
        // Find if it hit a pedestrian
        const peds = sim.pedestrians?.peds;
        if (peds) {
          const ped = peds.find((p: any) => p.collider.handle === hit.collider.handle);
          if (ped) {
            sim.pedestrians.knock(ped);
            ped.body.applyImpulse(direction.multiplyScalar(150), true);
            BloodDecalSystem.addBlood(pointV3);
            sim.police.wanted = Math.max(sim.police.wanted, 2);
            return;
          }
        }
      }
    }
  });

  return null;
}
