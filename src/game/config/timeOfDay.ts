import * as THREE from 'three';

/**
 * Time of day: sun position, sky, light colour and haze (spec 10, 27).
 *
 * The whole look of the city is derived from ONE number - the hour - so the
 * sun, the sky shader, the ambient fill, the fog and the image-based lighting
 * can never disagree with each other. Everything here is authored tuning, not
 * an astronomical model: the sun follows a plausible arc rather than a real
 * ephemeris for a real latitude and date.
 */

const DEG = Math.PI / 180;

/** Hours at which the sun crosses the horizon. */
export const SUNRISE = 6.0;
export const SUNSET = 19.0;

/** Sun elevation at local noon, degrees. Matches the original fixed setup. */
const MAX_ELEVATION = 58;

/** Real seconds for a full 24-hour cycle. One real minute is one game hour. */
export const DAY_LENGTH_SECONDS = 24 * 60;

/** The hour a fresh session starts at: mid-morning, so the city reads clearly. */
export const START_HOUR = 9.0;

/**
 * Sun elevation and azimuth for an hour.
 *
 * Elevation goes negative outside daylight, which is exactly what the sky
 * shader and the "is it night" checks want - there is no separate night flag.
 */
export function sunAngles(hour: number) {
  const t = (hour - SUNRISE) / (SUNSET - SUNRISE);
  const elevationDeg = Math.sin(Math.PI * t) * MAX_ELEVATION;
  // Sweeps from roughly east-north-east at dawn to west-north-west at dusk.
  const azimuthDeg = 80 + t * 200;
  return { elevationDeg, azimuthDeg };
}

/** Unit vector from the ground toward the sun at this hour. */
export function sunDirection(hour: number, out = new THREE.Vector3()) {
  const { elevationDeg, azimuthDeg } = sunAngles(hour);
  const az = azimuthDeg * DEG;
  const el = elevationDeg * DEG;
  const h = Math.cos(el);
  // Azimuth is clockwise from north, and north is -Z.
  return out.set(Math.sin(az) * h, Math.sin(el), -Math.cos(az) * h).normalize();
}

/** One authored look, at one hour. Values between keys are interpolated. */
interface SkyKey {
  hour: number;
  /** Direct sun. */
  sun: string;
  sunIntensity: number;
  /** Hemisphere fill. */
  sky: string;
  ground: string;
  ambient: number;
  /** Distance haze. */
  haze: string;
  hazeNear: number;
  hazeFar: number;
  /** Image-based lighting scale. */
  env: number;
  /** Sky dome gradient: straight up, and at the horizon. */
  zenith: string;
  horizon: string;
  /** Strength of the glow around the sun's position in the sky. */
  sunGlow: number;
  /** 0 = no stars, 1 = full starfield. */
  stars: number;
  /** 0 = windows dark, 1 = fully lit. Drives emissive glass and streetlights. */
  lights: number;
}

/**
 * The day, as a small set of authored moments.
 *
 * Deliberately few keys: each one is a look somebody chose, and the curve
 * between them is linear so there are no surprise swings at 3 a.m.
 */
const KEYS: SkyKey[] = [
  { hour: 0.0,  sun: '#2a3a6e', sunIntensity: 0.10, sky: '#16233f', ground: '#0c0e14', ambient: 0.20, haze: '#111a2e', hazeNear: 55, hazeFar: 340, env: 0.09, zenith: '#05091a', horizon: '#111c38', sunGlow: 0.00, stars: 1.0,  lights: 1.0 },
  { hour: 4.5,  sun: '#38456f', sunIntensity: 0.14, sky: '#1d2d4d', ground: '#111319', ambient: 0.24, haze: '#1a2540', hazeNear: 55, hazeFar: 360, env: 0.13, zenith: '#0a1430', horizon: '#26365e', sunGlow: 0.10, stars: 0.85, lights: 1.0 },
  { hour: 6.0,  sun: '#ff9a4d', sunIntensity: 0.9,  sky: '#5f7196', ground: '#3b342c', ambient: 0.40, haze: '#c08a6a', hazeNear: 60, hazeFar: 420, env: 0.42, zenith: '#2b4a7a', horizon: '#ff9a52', sunGlow: 0.95, stars: 0.25, lights: 0.7 },
  { hour: 7.5,  sun: '#ffc489', sunIntensity: 2.0,  sky: '#93b0d6', ground: '#6e6354', ambient: 0.48, haze: '#d8c4b4', hazeNear: 100, hazeFar: 900, env: 0.72, zenith: '#3a72c4', horizon: '#dcc3ab', sunGlow: 0.55, stars: 0.0,  lights: 0.25 },
  { hour: 12.0, sun: '#fff3e0', sunIntensity: 3.1,  sky: '#a8c8f0', ground: '#8a7f6a', ambient: 0.55, haze: '#cfdcea', hazeNear: 120, hazeFar: 1150, env: 0.95, zenith: '#3f7fd4', horizon: '#c3d8ef', sunGlow: 0.22, stars: 0.0,  lights: 0.0 },
  { hour: 16.0, sun: '#ffe7c2', sunIntensity: 2.8,  sky: '#a3c2ea', ground: '#8a7a62', ambient: 0.52, haze: '#d2d9e2', hazeNear: 115, hazeFar: 1080, env: 0.88, zenith: '#3d78c8', horizon: '#ccd9e6', sunGlow: 0.30, stars: 0.0,  lights: 0.0 },
  { hour: 18.2, sun: '#ff9c5c', sunIntensity: 1.7,  sky: '#93a4c6', ground: '#6d5c48', ambient: 0.45, haze: '#dba277', hazeNear: 70, hazeFar: 520, env: 0.62, zenith: '#2f5493', horizon: '#e8a071', sunGlow: 0.85, stars: 0.0,  lights: 0.35 },
  { hour: 19.3, sun: '#e8703c', sunIntensity: 0.6,  sky: '#5c6c92', ground: '#3a3228', ambient: 0.35, haze: '#9a6d63', hazeNear: 60, hazeFar: 430, env: 0.34, zenith: '#16264f', horizon: '#d1602f', sunGlow: 1.00, stars: 0.3,  lights: 0.8 },
  { hour: 20.5, sun: '#38456f', sunIntensity: 0.16, sky: '#22314f', ground: '#14161c', ambient: 0.25, haze: '#1d2742', hazeNear: 55, hazeFar: 370, env: 0.15, zenith: '#0a1330', horizon: '#2a2f53', sunGlow: 0.18, stars: 0.8,  lights: 1.0 },
  { hour: 24.0, sun: '#2a3a6e', sunIntensity: 0.10, sky: '#16233f', ground: '#0c0e14', ambient: 0.20, haze: '#111a2e', hazeNear: 55, hazeFar: 340, env: 0.09, zenith: '#05091a', horizon: '#111c38', sunGlow: 0.00, stars: 1.0,  lights: 1.0 },
];

/** The interpolated look at an hour. Colours are reused, not reallocated. */
export interface SkyLook {
  sun: THREE.Color;
  sunIntensity: number;
  sky: THREE.Color;
  ground: THREE.Color;
  ambient: number;
  haze: THREE.Color;
  hazeNear: number;
  hazeFar: number;
  env: number;
  zenith: THREE.Color;
  horizon: THREE.Color;
  sunGlow: number;
  stars: number;
  lights: number;
}

export function makeSkyLook(): SkyLook {
  return {
    sun: new THREE.Color(),
    sunIntensity: 0,
    sky: new THREE.Color(),
    ground: new THREE.Color(),
    ambient: 0,
    haze: new THREE.Color(),
    hazeNear: 0,
    hazeFar: 0,
    env: 0,
    zenith: new THREE.Color(),
    horizon: new THREE.Color(),
    sunGlow: 0,
    stars: 0,
    lights: 0,
  };
}

const A = new THREE.Color();
const B = new THREE.Color();
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Fill `out` with the look at `hour` (0..24). */
export function skyLookAt(hour: number, out: SkyLook): SkyLook {
  const h = ((hour % 24) + 24) % 24;

  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1]!.hour <= h) i++;
  const k0 = KEYS[i]!;
  const k1 = KEYS[i + 1]!;
  const span = k1.hour - k0.hour;
  const t = span > 0 ? Math.min(1, Math.max(0, (h - k0.hour) / span)) : 0;

  out.sun.copy(A.set(k0.sun)).lerp(B.set(k1.sun), t);
  out.sky.copy(A.set(k0.sky)).lerp(B.set(k1.sky), t);
  out.ground.copy(A.set(k0.ground)).lerp(B.set(k1.ground), t);
  out.haze.copy(A.set(k0.haze)).lerp(B.set(k1.haze), t);

  out.sunIntensity = lerp(k0.sunIntensity, k1.sunIntensity, t);
  out.ambient = lerp(k0.ambient, k1.ambient, t);
  out.hazeNear = lerp(k0.hazeNear, k1.hazeNear, t);
  out.hazeFar = lerp(k0.hazeFar, k1.hazeFar, t);
  out.env = lerp(k0.env, k1.env, t);
  out.zenith.copy(A.set(k0.zenith)).lerp(B.set(k1.zenith), t);
  out.horizon.copy(A.set(k0.horizon)).lerp(B.set(k1.horizon), t);
  out.sunGlow = lerp(k0.sunGlow, k1.sunGlow, t);
  out.stars = lerp(k0.stars, k1.stars, t);
  out.lights = lerp(k0.lights, k1.lights, t);
  return out;
}

/** Human-readable clock, e.g. "06:45". */
export function formatClock(hour: number) {
  const h = ((hour % 24) + 24) % 24;
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** Coarse phase name, for dialogue and the HUD. */
export function phaseName(hour: number): 'night' | 'dawn' | 'morning' | 'afternoon' | 'dusk' {
  const h = ((hour % 24) + 24) % 24;
  if (h < 5 || h >= 20.5) return 'night';
  if (h < 7.5) return 'dawn';
  if (h < 12) return 'morning';
  if (h < 18) return 'afternoon';
  return 'dusk';
}
