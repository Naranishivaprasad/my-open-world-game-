'use client';

import { useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { audio } from './AudioSystem';
import { useGame } from '../core/store';

/**
 * Drives the audio system from the render loop and from settings (spec 28).
 * Mounted inside the Canvas so it shares the frame loop.
 */
export function AudioDriver() {
  const cameraMode = useGame((s) => s.cameraMode);
  const volMaster = useGame((s) => s.settings.volMaster);
  const volSfx = useGame((s) => s.settings.volSfx);
  const phase = useGame((s) => s.phase);

  useEffect(() => {
    audio.setVolumes(volMaster, volSfx);
  }, [volMaster, volSfx]);

  // Backgrounded tabs must go quiet, and recover on return.
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) audio.suspend();
      else if (useGame.getState().phase === 'playing') void audio.start();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    if (phase !== 'playing') audio.suspend();
  }, [phase]);

  useFrame((_, delta) => {
    audio.update(Math.min(delta, 0.1), cameraMode === 'fp-vehicle');
  });

  return null;
}
