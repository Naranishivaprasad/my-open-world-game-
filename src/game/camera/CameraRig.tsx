'use client';

import * as THREE from 'three';
import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useRapier } from '@react-three/rapier';
import type { Collider } from '@dimforge/rapier3d-compat';
import { DEBUG_HOOKS, sim } from '../core/sim';
import type { CameraMode } from '../core/types';
import type { VehicleController } from '../vehicle/VehicleController';
import { ANCHORS, CHASE_CAMERA, DRIVETRAIN } from '../config/vehicle';

/**
 * All player cameras (spec 13, 18).
 *
 *   tp-foot     third-person orbit behind the character
 *   tp-vehicle  chase camera behind the car
 *   fp-vehicle  cockpit camera at the driver's eye, rendering the real cabin
 *
 * Switching mode changes NOTHING about the vehicle's position, speed or physics
 * state (spec 18) - the camera only ever reads.
 *
 * Cameras read sim / the physics body directly rather than another component's
 * Object3D, so they do not depend on useFrame ordering.
 */

const PITCH_MIN = -0.52;
const PITCH_MAX = 1.12;
const FOOT_TARGET_HEIGHT = 1.46;
const FOOT_SHOULDER = 0.5;

const PROBE_RADIUS = 0.26;
const WALL_PADDING = 0.14;

const FOOT_POSITION_DAMPING = 16;
const DISTANCE_IN_DAMPING = 42;
const DISTANCE_OUT_DAMPING = 5;

/** Cockpit free-look limits, radians. */
const COCKPIT_YAW_LIMIT = 1.35;
const COCKPIT_PITCH_MIN = -0.55;
const COCKPIT_PITCH_MAX = 0.5;

export function CameraRig({
  fov,
  mode,
  phase,
  playerCollider,
  vehicle,
  enabled,
}: {
  fov: number;
  mode: CameraMode;
  phase: string;
  playerCollider?: Collider | null;
  vehicle?: VehicleController | null;
  enabled: boolean;
}) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const { world, rapier } = useRapier();

  const smoothedTarget = useRef(new THREE.Vector3());
  const initialised = useRef(false);
  const probe = useRef<InstanceType<typeof rapier.Ball> | null>(null);

  /** Free-look offset from the car's own heading, radians. */
  const chaseYawOffset = useRef(0);
  const idleSince = useRef(0);
  const smoothedBoom = useRef(CHASE_CAMERA.distance);
  const cockpitYaw = useRef(0);
  const cockpitPitch = useRef(0);
  const baseFov = useRef(fov);

  useEffect(() => {
    probe.current = new rapier.Ball(PROBE_RADIUS);
    return () => {
      probe.current = null;
    };
  }, [rapier]);

  // Dev-only: lets the smoke tests assert on real camera placement.
  useEffect(() => {
    if (!DEBUG_HOOKS || typeof window === 'undefined') return;
    const w = window as unknown as { __PALM__?: Record<string, unknown> };
    w.__PALM__ = { ...(w.__PALM__ ?? {}), camera };
  }, [camera]);

  useEffect(() => {
    baseFov.current = fov;
    camera.fov = fov;
    camera.updateProjectionMatrix();
    sim.camera.fov = fov;
  }, [camera, fov]);

  // Re-seat the camera when the mode changes so it never interpolates across
  // a discontinuity (which would read as a lurch).
  useEffect(() => {
    initialised.current = false;
    chaseYawOffset.current = 0;
    cockpitYaw.current = 0;
    cockpitPitch.current = 0;
  }, [mode]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);

    // Consume look input once, whichever camera is active.
    let lookX = 0;
    let lookY = 0;
    if (enabled) {
      lookX = sim.input.lookX;
      lookY = sim.input.lookY;
    }
    sim.input.lookX = 0;
    sim.input.lookY = 0;

    if (phase === 'menu') {
      type CameraShot = 
        | { posA: THREE.Vector3; posB: THREE.Vector3; lookAt: THREE.Vector3; duration: number; orbit?: undefined }
        | { orbit: { center: THREE.Vector3; radius: number; height: number; speed: number }; duration: number; posA?: undefined; posB?: undefined; lookAt?: undefined };

      const SHOTS: CameraShot[] = [
        // 1. Street level at the wide open Beach Promenade (No buildings here)
        { posA: new THREE.Vector3(365, 3, -150), posB: new THREE.Vector3(365, 3, 50), lookAt: new THREE.Vector3(340, 5, 0), duration: 12000 },
        // 2. Street level at the Sunfuel Gas Station (Wide open lot)
        { posA: new THREE.Vector3(130, 3, -40), posB: new THREE.Vector3(100, 3, -40), lookAt: new THREE.Vector3(130, 4, -70), duration: 10000 },
        // 3. Street level at the vast Parking Lot
        { posA: new THREE.Vector3(140, 3, 50), posB: new THREE.Vector3(140, 3, 80), lookAt: new THREE.Vector3(100, 10, 50), duration: 10000 },
        // 4. Overlooking the ocean towards the city
        { posA: new THREE.Vector3(420, 15, 0), posB: new THREE.Vector3(420, 15, 100), lookAt: new THREE.Vector3(0, 20, 50), duration: 12000 },
        // 5. High cinematic pan across the rooftops (Safe above all buildings)
        { posA: new THREE.Vector3(-100, 80, -100), posB: new THREE.Vector3(100, 70, 100), lookAt: new THREE.Vector3(50, 10, 50), duration: 12000 }
      ];

      const time = performance.now();
      let accumulatedTime = 0;
      let activeShot = SHOTS[0];
      let shotTime = 0;
      
      const totalLoopDuration = SHOTS.reduce((acc, shot) => acc + shot.duration, 0);
      const loopTime = time % totalLoopDuration;
      
      for (const shot of SHOTS) {
        if (loopTime >= accumulatedTime && loopTime < accumulatedTime + shot.duration) {
          activeShot = shot;
          shotTime = loopTime - accumulatedTime;
          break;
        }
        accumulatedTime += shot.duration;
      }

      if (activeShot.orbit) {
        const angle = shotTime * 0.001 * activeShot.orbit.speed;
        const cx = activeShot.orbit.center.x + Math.cos(angle) * activeShot.orbit.radius;
        const cz = activeShot.orbit.center.z + Math.sin(angle) * activeShot.orbit.radius;
        camera.position.set(cx, activeShot.orbit.height, cz);
        TMP_C.copy(activeShot.orbit.center);
        camera.lookAt(TMP_C);
      } else if (activeShot.posA && activeShot.posB && activeShot.lookAt) {
        const progress = shotTime / activeShot.duration;
        const ease = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
        camera.position.lerpVectors(activeShot.posA, activeShot.posB, ease);
        TMP_C.copy(activeShot.lookAt);
        camera.lookAt(TMP_C);
      }
      return;
    }

    if (mode === 'fp-vehicle' && vehicle) {
      updateCockpit(camera, vehicle, lookX, lookY, dt, cockpitYaw, cockpitPitch, baseFov.current);
      return;
    }
    if (mode === 'tp-vehicle' && vehicle) {
      updateChase(
        camera,
        vehicle,
        lookX,
        lookY,
        dt,
        chaseYawOffset,
        idleSince,
        smoothedBoom,
        baseFov.current,
        (origin, dir, maxDist) =>
          sweep(world, rapier, probe.current, origin, dir, maxDist, playerCollider, vehicle.collider),
      );
      return;
    }

    updateFoot(camera, lookX, lookY, dt, smoothedTarget, initialised, (origin, dir, maxDist) =>
      sweep(world, rapier, probe.current, origin, dir, maxDist, playerCollider),
    );
  });

  return null;
}

// ------------------------------------------------------------------ on foot

function updateFoot(
  camera: THREE.PerspectiveCamera,
  lookX: number,
  lookY: number,
  dt: number,
  smoothedTarget: React.MutableRefObject<THREE.Vector3>,
  initialised: React.MutableRefObject<boolean>,
  castBoom: (origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number) => number,
) {
  const cam = sim.camera;
  cam.yaw -= lookX;
  cam.pitch = THREE.MathUtils.clamp(cam.pitch + lookY, PITCH_MIN, PITCH_MAX);

  const p = sim.player.position;
  const desiredTarget = TMP_A.set(p.x, p.y + FOOT_TARGET_HEIGHT, p.z);

  if (!initialised.current) {
    smoothedTarget.current.copy(desiredTarget);
    initialised.current = true;
  } else {
    smoothedTarget.current.lerp(desiredTarget, damp(FOOT_POSITION_DAMPING, dt));
  }
  const target = smoothedTarget.current;
  cam.target.copy(target);

  const cp = Math.cos(cam.pitch);
  const dir = TMP_B.set(Math.sin(cam.yaw) * cp, Math.sin(cam.pitch), Math.cos(cam.yaw) * cp);

  const sideX = Math.cos(cam.yaw);
  const sideZ = -Math.sin(cam.yaw);
  const origin = TMP_C.set(
    target.x + sideX * FOOT_SHOULDER,
    target.y,
    target.z + sideZ * FOOT_SHOULDER,
  );

  const allowed = castBoom(origin, dir, cam.distance);
  const k = allowed < cam.actualDistance ? DISTANCE_IN_DAMPING : DISTANCE_OUT_DAMPING;
  cam.actualDistance = THREE.MathUtils.lerp(cam.actualDistance, allowed, damp(k, dt));

  camera.position.set(
    origin.x + dir.x * cam.actualDistance,
    origin.y + dir.y * cam.actualDistance,
    origin.z + dir.z * cam.actualDistance,
  );
  camera.lookAt(target);
}

// -------------------------------------------------------------- chase (car)

function updateChase(
  camera: THREE.PerspectiveCamera,
  vehicle: VehicleController,
  lookX: number,
  lookY: number,
  dt: number,
  yawOffset: React.MutableRefObject<number>,
  idleSince: React.MutableRefObject<number>,
  smoothedBoom: React.MutableRefObject<number>,
  baseFov: number,
  castBoom: (origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number) => number,
) {
  const cam = sim.camera;
  const t = vehicle.body.translation();
  const r = vehicle.body.rotation();
  QUAT.set(r.x, r.y, r.z, r.w);

  const carForward = TMP_D.set(0, 0, -1).applyQuaternion(QUAT);
  const carHeading = Math.atan2(carForward.x, carForward.z);

  /*
   * Free look, with recentring that actually happens (spec 18).
   *
   * Three things here are deliberate, and each fixes a real defect:
   *
   * 1. DEADZONE. Treating any non-zero mouse delta as free-look intent meant
   *    the hand resting on a mouse reset the idle timer every frame, so the
   *    camera never recentred and the offset accumulated indefinitely.
   * 2. CLAMP to less than a quarter turn. The offset used to be clamped to
   *    +/-PI, which let the camera swing round IN FRONT of the car looking
   *    back - at which point steering reads as inverted on screen even though
   *    the car is turning correctly.
   * 3. ALWAYS recentre, just faster once the player stops looking around,
   *    rather than gating recentring behind a hard idle timer.
   */
  const lookingAround =
    Math.abs(lookX) > CHASE_CAMERA.freeLookDeadzone ||
    Math.abs(lookY) > CHASE_CAMERA.freeLookDeadzone;

  if (lookingAround) {
    yawOffset.current = THREE.MathUtils.clamp(
      yawOffset.current - lookX,
      -CHASE_CAMERA.maxYawOffset,
      CHASE_CAMERA.maxYawOffset,
    );
    cam.pitch = THREE.MathUtils.clamp(cam.pitch + lookY, -0.42, 0.85);
    idleSince.current = 0;
  } else {
    idleSince.current += dt;
  }

  // Recentre always; the idle delay only decides how briskly.
  const settled = idleSince.current > CHASE_CAMERA.recentreDelay;
  const rate = settled ? CHASE_CAMERA.recentreRate : CHASE_CAMERA.recentreRate * 0.25;
  yawOffset.current = approach(yawOffset.current, 0, rate * dt);
  if (settled) cam.pitch = THREE.MathUtils.lerp(cam.pitch, 0.19, damp(2.2, dt));

  const speed = Math.abs(vehicle.speed);
  const speed01 = Math.min(1, speed / DRIVETRAIN.topSpeed);

  // Camera sits behind the car: car heading + PI, plus the free-look offset.
  cam.yaw = carHeading + Math.PI + yawOffset.current;

  const orbit = TMP_A.set(t.x, t.y + CHASE_CAMERA.height, t.z);
  cam.target.copy(orbit);

  const cp = Math.cos(cam.pitch);
  const dir = TMP_B.set(Math.sin(cam.yaw) * cp, Math.sin(cam.pitch), Math.cos(cam.yaw) * cp);

  // Restrained speed-dependent framing.
  const wanted = CHASE_CAMERA.distance + CHASE_CAMERA.speedStretch * speed01;
  const allowed = castBoom(orbit, dir, wanted);
  const k = allowed < smoothedBoom.current ? DISTANCE_IN_DAMPING : CHASE_CAMERA.positionDamping;
  smoothedBoom.current = THREE.MathUtils.lerp(smoothedBoom.current, allowed, damp(k, dt));
  cam.actualDistance = smoothedBoom.current;

  camera.position.set(
    orbit.x + dir.x * smoothedBoom.current,
    orbit.y + dir.y * smoothedBoom.current,
    orbit.z + dir.z * smoothedBoom.current,
  );

  // Look at a point ahead of the car so the road stays readable, not at the
  // car itself. When reversing, look slightly behind instead.
  const ahead = vehicle.speed < -0.5 ? -CHASE_CAMERA.lookAhead * 0.4 : CHASE_CAMERA.lookAhead;
  TMP_C.set(
    t.x + carForward.x * ahead,
    t.y + CHASE_CAMERA.height * 0.62,
    t.z + carForward.z * ahead,
  );
  camera.lookAt(TMP_C);

  const targetFov = baseFov + CHASE_CAMERA.speedFov * speed01;
  if (Math.abs(camera.fov - targetFov) > 0.01) {
    camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, damp(3, dt));
    camera.updateProjectionMatrix();
  }
}

// ------------------------------------------------------------ cockpit (car)

function updateCockpit(
  camera: THREE.PerspectiveCamera,
  vehicle: VehicleController,
  lookX: number,
  lookY: number,
  dt: number,
  yawRef: React.MutableRefObject<number>,
  pitchRef: React.MutableRefObject<number>,
  baseFov: number,
) {
  const t = vehicle.body.translation();
  const r = vehicle.body.rotation();
  QUAT.set(r.x, r.y, r.z, r.w);

  // Free look is limited to what a seated driver can actually turn to see.
  yawRef.current = THREE.MathUtils.clamp(yawRef.current - lookX, -COCKPIT_YAW_LIMIT, COCKPIT_YAW_LIMIT);
  pitchRef.current = THREE.MathUtils.clamp(
    pitchRef.current + lookY,
    COCKPIT_PITCH_MIN,
    COCKPIT_PITCH_MAX,
  );

  // Eye position: body-space anchor rotated into the world.
  TMP_A.set(ANCHORS.driverEye.x, ANCHORS.driverEye.y, ANCHORS.driverEye.z).applyQuaternion(QUAT);
  camera.position.set(t.x + TMP_A.x, t.y + TMP_A.y, t.z + TMP_A.z);

  // Head orientation = car orientation * free look.
  EULER.set(pitchRef.current, yawRef.current, 0, 'YXZ');
  Q_LOOK.setFromEuler(EULER);
  camera.quaternion.copy(QUAT).multiply(Q_LOOK);

  sim.camera.target.set(t.x, t.y, t.z);
  sim.camera.actualDistance = 0;

  // A touch of extra FOV with speed, far gentler than the chase camera.
  const speed01 = Math.min(1, Math.abs(vehicle.speed) / DRIVETRAIN.topSpeed);
  const targetFov = baseFov + 4 * speed01;
  if (Math.abs(camera.fov - targetFov) > 0.01) {
    camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, damp(3, dt));
    camera.updateProjectionMatrix();
  }
}

// ------------------------------------------------------------------ helpers

/**
 * Sweep a sphere out along the boom; returns the distance the camera may use.
 *
 * castShape only accepts ONE excluded collider, but the chase camera has to
 * ignore both the car and the character, so exclusions go through the
 * predicate instead. The predicate returns true for colliders that should be
 * considered.
 */
function sweep(
  world: ReturnType<typeof useRapier>['world'],
  rapier: ReturnType<typeof useRapier>['rapier'],
  ball: unknown,
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  maxDist: number,
  ...exclude: (Collider | null | undefined)[]
): number {
  if (!ball) return maxDist;
  const ignored = exclude.filter(Boolean) as Collider[];
  const hit = world.castShape(
    { x: origin.x, y: origin.y, z: origin.z },
    IDENTITY_ROT,
    { x: dir.x, y: dir.y, z: dir.z },
    ball as never,
    0,
    maxDist,
    true,
    rapier.QueryFilterFlags.EXCLUDE_SENSORS,
    undefined,
    undefined,
    undefined,
    ignored.length ? (c) => !ignored.includes(c) : undefined,
  );
  if (!hit) return maxDist;
  return Math.max(0.6, hit.time_of_impact - WALL_PADDING);
}

const TMP_A = new THREE.Vector3();
const TMP_B = new THREE.Vector3();
const TMP_C = new THREE.Vector3();
const TMP_D = new THREE.Vector3();
const QUAT = new THREE.Quaternion();
const Q_LOOK = new THREE.Quaternion();
const EULER = new THREE.Euler();
const IDENTITY_ROT = { x: 0, y: 0, z: 0, w: 1 };

function damp(rate: number, dt: number) {
  return 1 - Math.exp(-rate * dt);
}

function approach(current: number, target: number, maxDelta: number) {
  const d = target - current;
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}
