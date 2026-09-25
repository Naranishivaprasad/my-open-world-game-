'use client';

import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useRapier } from '@react-three/rapier';
import { sim } from '../core/sim';

/**
 * Feeds real renderer and physics counters into sim.stats for the dev overlay
 * (spec 36). Mounted inside the Canvas; writes nothing to React state.
 */
export function StatsProbe() {
  const gl = useThree((s) => s.gl);
  const { world } = useRapier();
  const acc = useRef({ frames: 0, time: 0 });

  useFrame((_, delta) => {
    const a = acc.current;
    a.frames += 1;
    a.time += delta;
    if (a.time >= 0.5) {
      sim.stats.fps = a.frames / a.time;
      sim.stats.frameMs = (a.time / a.frames) * 1000;
      a.frames = 0;
      a.time = 0;

      const info = gl.info;
      sim.stats.drawCalls = info.render.calls;
      sim.stats.triangles = info.render.triangles;
      sim.stats.rigidBodies = world.bodies.len();
      sim.stats.colliders = world.colliders.len();
    }
  });

  return null;
}
