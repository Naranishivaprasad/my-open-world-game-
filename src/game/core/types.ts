import type * as THREE from 'three';

/** Top-level application phase. Owns who receives input (spec 31). */
export type AppPhase = 'boot' | 'menu' | 'loading' | 'playing' | 'paused' | 'map' | 'error';

/** What the player is currently controlling. */
export type ControlMode = 'foot' | 'entering' | 'vehicle' | 'exiting';

export type CameraMode = 'tp-foot' | 'tp-vehicle' | 'fp-vehicle';

export type QualityPreset = 'low' | 'medium' | 'high';

/** Locomotion states driven by the character controller, consumed by the animator. */
export type LocomotionState = 'idle' | 'walk' | 'run' | 'sprint' | 'jump' | 'fall' | 'land';

export interface InteractionTarget {
  id: string;
  kind: 'vehicle' | 'contact' | 'pickup' | 'door' | 'service';
  label: string;
  /** Key the player must press, e.g. 'F' or 'E'. */
  key: string;
  distance: number;
  position: THREE.Vector3;
}

export interface LoadTask {
  id: string;
  label: string;
  /** 0..1 — real progress where the loader reports it, else 0 then 1. */
  progress: number;
  done: boolean;
  error?: string;
}
