import type { QualityPreset } from '../core/types';

/**
 * Quality presets (spec 34). Every field here must actually be read by a system;
 * no decorative settings.
 */
export interface QualitySettings {
  /** Cap on renderer device pixel ratio. */
  maxPixelRatio: number;
  shadowMapSize: number;
  /** Half-extent of the sun's orthographic shadow camera, in metres. */
  shadowDistance: number;
  shadowsEnabled: boolean;
  /** Camera far plane, metres. */
  viewDistance: number;
  /** Distance past which distant filler scenery is not drawn. */
  sceneryDistance: number;
  trafficCount: number;
  pedestrianCount: number;
  vegetationDensity: number;
  /** Live mirror rendering in the cockpit camera. */
  mirrors: boolean;
  antialias: boolean;
  /** Fog/haze strength multiplier (spec 10: restrained haze for depth). */
  hazeScale: number;
}

export const QUALITY_PRESETS: Record<QualityPreset, QualitySettings> = {
  low: {
    maxPixelRatio: 1,
    shadowMapSize: 1024,
    shadowDistance: 45,
    shadowsEnabled: true,
    viewDistance: 420,
    sceneryDistance: 260,
    trafficCount: 4,
    pedestrianCount: 6,
    vegetationDensity: 0.45,
    mirrors: false,
    antialias: false,
    hazeScale: 1,
  },
  medium: {
    maxPixelRatio: 1.5,
    shadowMapSize: 2048,
    shadowDistance: 70,
    shadowsEnabled: true,
    viewDistance: 700,
    sceneryDistance: 480,
    trafficCount: 8,
    pedestrianCount: 12,
    vegetationDensity: 0.75,
    mirrors: false,
    antialias: true,
    hazeScale: 1,
  },
  high: {
    maxPixelRatio: 2,
    shadowMapSize: 4096,
    shadowDistance: 95,
    shadowsEnabled: true,
    viewDistance: 1000,
    sceneryDistance: 700,
    trafficCount: 14,
    pedestrianCount: 18,
    vegetationDensity: 1,
    mirrors: true,
    antialias: true,
    hazeScale: 1,
  },
};

/** Conservative default until the user picks; medium suits a mid-range desktop GPU. */
export const DEFAULT_PRESET: QualityPreset = 'medium';
