import { useFrame, useThree } from '@react-three/fiber';
import { useRef, useMemo } from 'react';
import * as THREE from 'three';
import { sim } from '../core/sim';

export function WeatherSystem() {
  const { scene } = useThree();
  
  // Rain/Snow particles
  const particlesCount = 2000;
  const particlesGeo = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(particlesCount * 3);
    const velocities = new Float32Array(particlesCount * 3);
    
    for (let i = 0; i < particlesCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 100;
      positions[i * 3 + 1] = Math.random() * 50;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 100;
      
      velocities[i * 3] = (Math.random() - 0.5) * 0.1;
      velocities[i * 3 + 1] = Math.random() * 0.2 + 0.1;
      velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.1;
    }
    
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));
    return geo;
  }, []);
  
  const particlesMat = useMemo(() => new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.1,
    transparent: true,
    opacity: 0.6,
  }), []);

  const particlesMesh = useRef<THREE.Points>(null!);
  
  // Fog and sky colors
  const skyColors = useMemo(() => ({
    sunny: new THREE.Color(0x87CEEB), // Light blue
    rainy: new THREE.Color(0x4a5d66), // Dark grey blue
    snowy: new THREE.Color(0xdcebf2), // Pale white blue
    autumn: new THREE.Color(0xc98e4f), // Orange tint
  }), []);

  useFrame((_, delta) => {
    const season = sim.season;
    
    // Update Sky/Fog color
    const targetColor = skyColors[season];
    if (scene.background instanceof THREE.Color) {
      scene.background.lerp(targetColor, delta);
    } else {
      scene.background = targetColor.clone();
    }
    
    if (scene.fog instanceof THREE.Fog) {
      scene.fog.color.lerp(targetColor, delta);
      // Adjust fog density based on weather
      let targetFar = 1000;
      if (season === 'rainy') targetFar = 200;
      if (season === 'snowy') targetFar = 150;
      scene.fog.far += (targetFar - scene.fog.far) * delta;
    }
    
    // Update Particles (Rain/Snow)
    if (particlesMesh.current) {
      if (season === 'rainy' || season === 'snowy') {
        particlesMesh.current.visible = true;
        
        // Adjust style
        particlesMat.color.setHex(season === 'rainy' ? 0x88bbcc : 0xffffff);
        particlesMat.size = season === 'rainy' ? 0.05 : 0.15;
        
        const pos = particlesGeo.attributes.position.array as Float32Array;
        const vel = particlesGeo.attributes.velocity.array as Float32Array;
        
        const fallSpeedMultiplier = season === 'rainy' ? 4.0 : 1.0;
        const playerPos = sim.player.position;
        
        for (let i = 0; i < particlesCount; i++) {
          pos[i * 3 + 1] -= vel[i * 3 + 1] * fallSpeedMultiplier * (delta * 60);
          pos[i * 3] -= vel[i * 3] * (delta * 60);
          pos[i * 3 + 2] -= vel[i * 3 + 2] * (delta * 60);
          
          if (pos[i * 3 + 1] < 0) {
            pos[i * 3 + 1] = 50; // Reset height
            // Center around player
            pos[i * 3] = playerPos.x + (Math.random() - 0.5) * 100;
            pos[i * 3 + 2] = playerPos.z + (Math.random() - 0.5) * 100;
          }
        }
        particlesGeo.attributes.position.needsUpdate = true;
      } else {
        particlesMesh.current.visible = false;
      }
    }
  });

  return (
    <points ref={particlesMesh} geometry={particlesGeo} material={particlesMat} frustumCulled={false} />
  );
}
