import type Rapier from '@dimforge/rapier3d-compat';
import type {
  Collider,
  DynamicRayCastVehicleController,
  RigidBody,
  World,
} from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import {
  HERO_BUILD,
  RECOVERY,
  STEERING,
  WHEEL,
  WHEEL_AXES,
  type VehicleBuild,
} from '../config/vehicle';

/**
 * Raycast vehicle built on Rapier's DynamicRayCastVehicleController (spec 16).
 *
 * Runs entirely on the fixed physics step. The renderer never writes to the
 * chassis transform - it only reads it - so forces and transforms can never
 * fight each other (spec 16's explicit warning).
 */

export type Gear = 'P' | 'R' | 'N' | 'D';

export interface WheelState {
  /** Suspension length this step, used to place the wheel visually. */
  suspension: number;
  /** Accumulated spin angle, radians. */
  rotation: number;
  /** Steer angle, radians. */
  steering: number;
  grounded: boolean;
}

export class VehicleController {
  readonly body: RigidBody;
  readonly collider: Collider;
  private vc: DynamicRayCastVehicleController;
  private world: World;
  private disposed = false;

  /** Current road-wheel angle, smoothed toward the requested angle. */
  private steerAngle = 0;
  /** Signed speed along the chassis forward axis, m/s. Negative = reversing. */
  private forwardSpeed = 0;
  private gear: Gear = 'P';
  private engineOn = false;
  private occupied = false;

  private overturnedFor = 0;
  /** Recorded for diagnostics only. */
  private lastBrake = 0;
  private lastEngineForce = 0;

  readonly wheelStates: WheelState[];

  /** The vehicle this chassis is currently built as. Read by the renderer. */
  build: VehicleBuild;

  /** Inputs for this step, written by whoever owns the car. */
  input = { throttle: 0, steer: 0, handbrake: false };

  constructor(
    world: World,
    rapier: typeof Rapier,
    spawn: { x: number; y: number; z: number; heading: number },
    build: VehicleBuild = HERO_BUILD,
  ) {
    this.world = world;
    this.build = build;
    // Local aliases so the construction code below reads as it did when these
    // were module constants.
    const { chassis: CHASSIS, wheels: WHEELS } = build;
    this.wheelStates = WHEELS.map(() => ({
      suspension: WHEEL.suspensionRestLength,
      rotation: 0,
      steering: 0,
      grounded: false,
    }));

    const q = headingToQuat(spawn.heading);

    this.body = world.createRigidBody(
      rapier.RigidBodyDesc.dynamic()
        .setTranslation(spawn.x, spawn.y, spawn.z)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .setLinearDamping(CHASSIS.linearDamping)
        .setAngularDamping(CHASSIS.angularDamping)
        // Explicit mass properties put the centre of gravity low, which is what
        // stops the car tripping over itself in a turn (spec 16).
        .setAdditionalMassProperties(
          CHASSIS.mass,
          CHASSIS.centreOfMass,
          CHASSIS.principalInertia,
          { x: 0, y: 0, z: 0, w: 1 },
        )
        // Fast-moving body: sweep against thin geometry rather than tunnelling.
        .setCcdEnabled(true),
    );

    const c = CHASSIS.collider;
    this.collider = world.createCollider(
      rapier.ColliderDesc.cuboid(c.hx, c.hy, c.hz)
        .setTranslation(0, c.cy, 0)
        .setFriction(CHASSIS.friction)
        .setRestitution(CHASSIS.restitution)
        // Density 0: the explicit mass properties above are authoritative.
        .setDensity(0),
      this.body,
    );

    this.vc = world.createVehicleController(this.body);

    for (const w of WHEELS) {
      this.vc.addWheel(
        w.connection,
        WHEEL_AXES.direction,
        WHEEL_AXES.axle,
        WHEEL.suspensionRestLength,
        build.wheelRadius,
      );
    }

    WHEELS.forEach((w, i) => {
      this.vc.setWheelSuspensionStiffness(i, WHEEL.suspensionStiffness);
      this.vc.setWheelSuspensionCompression(i, WHEEL.suspensionCompression);
      this.vc.setWheelSuspensionRelaxation(i, WHEEL.suspensionRelaxation);
      this.vc.setWheelMaxSuspensionTravel(i, WHEEL.maxSuspensionTravel);
      this.vc.setWheelMaxSuspensionForce(i, WHEEL.maxSuspensionForce);
      this.vc.setWheelFrictionSlip(i, WHEEL.frictionSlip);
      this.vc.setWheelSideFrictionStiffness(i, w.sideFrictionStiffness);
    });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    try {
      // WARNING: Removing a vehicle controller panics the Rapier WASM module ("unreachable").
      // We purposefully skip this to avoid crashing the entire WebGL context during Next.js Fast Refresh.
      // this.world.removeVehicleController(this.vc);
    } catch (err) {
      // Swallowing this silently once hid a Rapier borrow error that then
      // surfaced on an unrelated call several frames later.
      if (process.env.NODE_ENV !== 'production') console.warn('removeVehicleController failed', err);
    }
    try {
      // this.world.removeRigidBody(this.body);
    } catch (err) {
      if (process.env.NODE_ENV !== 'production') console.warn('removeRigidBody failed', err);
    }
  }

  // ------------------------------------------------------------------ state

  /** Signed forward speed, m/s. Negative when reversing. */
  get speed() {
    return this.forwardSpeed;
  }

  get speedKph() {
    return Math.abs(this.forwardSpeed) * 3.6;
  }

  get currentGear() {
    return this.gear;
  }

  get isEngineOn() {
    return this.engineOn;
  }

  /** Normalised engine load 0..1, for the tachometer and engine audio. */
  get rpm01() {
    if (!this.engineOn) return 0;
    const s = Math.abs(this.forwardSpeed);
    // Simulated gearing makes the note step rather than glide across the range.
    const perGear = this.build.drivetrain.topSpeed / 5;
    const inGear = (s % perGear) / perGear;
    const idle = 0.13;
    return Math.min(1, idle + inGear * 0.82 + (s > 0.5 ? 0 : Math.abs(this.input.throttle) * 0.2));
  }

  /** Road-wheel steer angle, radians. Drives the steering wheel visual. */
  get steer() {
    return this.steerAngle;
  }

  /** Dev-only snapshot for the smoke tests and the debug overlay. */
  get debugState() {
    return {
      occupied: this.occupied,
      engineOn: this.engineOn,
      gear: this.gear,
      throttle: this.input.throttle,
      handbrake: this.input.handbrake,
      lastBrake: this.lastBrake,
      lastEngineForce: this.lastEngineForce,
    };
  }

  get isOverturned() {
    return this.overturnedFor >= RECOVERY.overturnedHold;
  }

  setOccupied(v: boolean) {
    this.occupied = v;
    if (!v) {
      this.input.throttle = 0;
      this.input.steer = 0;
      this.input.handbrake = false;
    }
  }

  setEngine(on: boolean) {
    this.engineOn = on;
    if (!on) this.gear = 'P';
  }

  // ----------------------------------------------------------------- update

  /** Advance one fixed physics step. */
  update(dt: number) {
    if (this.disposed) return;

    this.updateForwardSpeed();
    this.updateOverturned(dt);

    const speedAbs = Math.abs(this.forwardSpeed);
    const { throttle, steer, handbrake } = this.input;
    const driving = this.occupied && this.engineOn;

    // ------------------------------------------------------- steering (spec 16)
    // Authority falls off with speed so a twitch at 150 km/h does not spin the car.
    const t = Math.min(1, speedAbs / STEERING.fullSpeed);
    const maxAngle = THREE.MathUtils.lerp(
      STEERING.maxAngleLowSpeed,
      STEERING.maxAngleHighSpeed,
      t * t,
    );
    /*
     * Sign convention, established by measurement rather than assumption.
     *
     * Left is a POSITIVE rotation about +Y in three.js (confirmed against the
     * character controller, whose heading is atan2(dirX, dirZ) and which is
     * known to face its direction of travel). Measurement showed Rapier's
     * setWheelSteering() shares that sign.
     *
     * Input 'A' sets steer = -1, so it is negated once here to make
     * `steerAngle` positive-is-left. That single value then drives BOTH the
     * physics and the visual front wheels, so they can never disagree.
     */
    const targetSteer = driving ? -steer * maxAngle : 0;
    const rate = Math.abs(targetSteer) < Math.abs(this.steerAngle) ? STEERING.returnRate : STEERING.rate;
    this.steerAngle = approach(this.steerAngle, targetSteer, rate * dt);

    // -------------------------------------------- throttle, braking and gear
    let engineForce = 0;
    let brakeTotal = 0;

    if (!driving) {
      // An unoccupied car holds itself still instead of creeping down camber.
      brakeTotal = this.build.drivetrain.brakeForce;
      this.gear = 'P';
    } else if (throttle > 0.01) {
      if (this.forwardSpeed < -this.build.drivetrain.reverseEngageSpeed) {
        // Still rolling backwards: brake to a stop before pulling away.
        brakeTotal = this.build.drivetrain.brakeForce * throttle;
        this.gear = 'N';
      } else {
        this.gear = 'D';
        engineForce = this.build.drivetrain.engineForce * throttle * taper(speedAbs, this.build.drivetrain.topSpeed);
      }
    } else if (throttle < -0.01) {
      if (this.forwardSpeed > this.build.drivetrain.reverseEngageSpeed) {
        // Reverse pressed while moving forward brakes first (spec 16).
        brakeTotal = this.build.drivetrain.brakeForce * -throttle;
        this.gear = 'D';
      } else {
        this.gear = 'R';
        engineForce =
          -this.build.drivetrain.reverseForce * -throttle * taper(speedAbs, this.build.drivetrain.reverseTopSpeed);
      }
    } else {
      // Coasting: only light engine braking, so lifting off does NOT stop the
      // car dead (spec 16).
      brakeTotal = this.build.drivetrain.engineBrake;
      this.gear = speedAbs < 0.3 ? 'N' : this.forwardSpeed > 0 ? 'D' : 'R';
    }

    // ------------------------------------------------------------ apply
    this.build.wheels.forEach((w, i) => {
      this.vc.setWheelSteering(i, w.steered ? this.steerAngle : 0);
      this.vc.setWheelEngineForce(i, w.driven ? engineForce / 2 : 0);

      let brake = brakeTotal * w.brakeBias;
      if (driving && handbrake && w.handbraked) {
        brake = Math.max(brake, this.build.drivetrain.handbrakeForce);
      }
      this.vc.setWheelBrake(i, brake);
    });

    this.lastBrake = brakeTotal;
    this.lastEngineForce = engineForce;

    this.vc.updateVehicle(dt);

    // ---------------------------------------------------- publish wheel state
    //
    // Rapier's wheelRotation() reports 0 in this build (verified in-browser),
    // so wheel spin is integrated here from ground speed instead. Sign derived
    // from the render hierarchy: the model group is rotated PI about Y, so a
    // POSITIVE rotation about the pivot's local X rolls the car forward.
    const spinDelta = (this.forwardSpeed / WHEEL.radius) * dt;
    for (let i = 0; i < this.build.wheels.length; i++) {
      const s = this.wheelStates[i]!;
      s.suspension = this.vc.wheelSuspensionLength(i) ?? WHEEL.suspensionRestLength;
      // Our own value, in the three.js convention, so the visual front wheels
      // point the same way the car actually turns.
      s.steering = this.build.wheels[i]!.steered ? this.steerAngle : 0;
      s.grounded = this.vc.wheelIsInContact(i);
      // A locked wheel under braking should not keep spinning.
      const locked = handbrake && (this.build.wheels[i]?.handbraked ?? false) && speedAbs > 1;
      s.rotation += locked ? 0 : spinDelta;
    }
  }

  private updateForwardSpeed() {
    const v = this.body.linvel();
    const r = this.body.rotation();
    // Chassis forward is -Z in body space; rotate it into world space.
    FORWARD.set(0, 0, -1).applyQuaternion(QUAT.set(r.x, r.y, r.z, r.w));
    this.forwardSpeed = v.x * FORWARD.x + v.y * FORWARD.y + v.z * FORWARD.z;
  }

  private updateOverturned(dt: number) {
    const r = this.body.rotation();
    UP.set(0, 1, 0).applyQuaternion(QUAT.set(r.x, r.y, r.z, r.w));
    // Angle between the car's up axis and world up.
    const tilt = Math.acos(THREE.MathUtils.clamp(UP.y, -1, 1));
    if (tilt > RECOVERY.overturnedAngle && Math.abs(this.forwardSpeed) < 2) {
      this.overturnedFor += dt;
    } else {
      this.overturnedFor = 0;
    }
  }

  /**
   * Safe recovery for an overturned or stuck car (spec 16).
   * Rights the body, keeps its heading, and lifts it clear of the ground.
   */
  recover() {
    const t = this.body.translation();
    const r = this.body.rotation();
    QUAT.set(r.x, r.y, r.z, r.w);
    EULER.setFromQuaternion(QUAT, 'YXZ');
    const upright = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), EULER.y);

    this.body.setTranslation({ x: t.x, y: t.y + RECOVERY.liftHeight, z: t.z }, true);
    this.body.setRotation({ x: upright.x, y: upright.y, z: upright.z, w: upright.w }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.overturnedFor = 0;
  }

  /**
   * Place the car at a validated position, clearing all momentum.
   * `heading` is the direction the car FACES, in the same atan2(dirX, dirZ)
   * convention used by the character and by vehicleHeading().
   */
  /**
   * Rebuild this chassis AS A DIFFERENT VEHICLE, in place (spec 17).
   *
   * Everything is reconfigured rather than destroyed and recreated. Disposing a
   * Rapier vehicle controller and building a new one mid-session panics the
   * wasm module outright ("unreachable"), after which every later call into
   * Rapier fails with a borrow error and the whole simulation is dead. Rapier
   * exposes setters for exactly the things that differ between vehicles -
   * chassis connection points, wheel radius, collider extents, mass properties
   * - so nothing needs to be torn down at all.
   *
   * Must be called OUTSIDE the physics step; VehicleOwner queues it.
   */
  reconfigure(build: VehicleBuild, at: { x: number; y: number; z: number; heading: number }) {
    this.build = build;
    const { chassis, wheels } = build;

    this.teleport(at.x, at.y, at.z, at.heading);

    this.body.setAdditionalMassProperties(
      chassis.mass,
      chassis.centreOfMass,
      chassis.principalInertia,
      { x: 0, y: 0, z: 0, w: 1 },
      true,
    );
    this.body.setLinearDamping(chassis.linearDamping);
    this.body.setAngularDamping(chassis.angularDamping);

    this.collider.setHalfExtents({ x: chassis.collider.hx, y: chassis.collider.hy, z: chassis.collider.hz });
    this.collider.setTranslationWrtParent({ x: 0, y: chassis.collider.cy, z: 0 });
    this.collider.setFriction(chassis.friction);
    this.collider.setRestitution(chassis.restitution);

    wheels.forEach((w, i) => {
      this.vc.setWheelChassisConnectionPointCs(i, w.connection);
      this.vc.setWheelRadius(i, build.wheelRadius);
      this.vc.setWheelSideFrictionStiffness(i, w.sideFrictionStiffness);
      this.vc.setWheelSteering(i, 0);
      this.vc.setWheelEngineForce(i, 0);
      this.vc.setWheelBrake(i, 0);
      const st = this.wheelStates[i]!;
      st.rotation = 0;
      st.steering = 0;
      st.suspension = WHEEL.suspensionRestLength;
    });
  }

  teleport(x: number, y: number, z: number, heading: number) {
    const q = headingToQuat(heading);
    this.body.setTranslation({ x, y, z }, true);
    this.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.steerAngle = 0;
    this.forwardSpeed = 0;
  }
}

/**
 * Convert a facing direction into a body rotation.
 *
 * `heading` follows atan2(dirX, dirZ), so heading 0 faces +Z. The chassis's
 * own forward axis is -Z, and R_y(phi) maps (0,0,-1) to (-sin phi, 0, -cos phi),
 * so the rotation that achieves a given facing is heading + PI. Getting this
 * wrong sends the car off in the opposite direction, which is exactly what it
 * did before this was unified.
 */
function headingToQuat(heading: number) {
  return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading + Math.PI);
}

// Scratch objects: allocating per physics step would churn the GC.
const FORWARD = new THREE.Vector3();
const UP = new THREE.Vector3();
const QUAT = new THREE.Quaternion();
const EULER = new THREE.Euler();

function approach(current: number, target: number, maxDelta: number) {
  const d = target - current;
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}

/**
 * Engine force falls off as speed approaches the target top speed, which is
 * what actually limits the car in the absence of an aero drag model.
 */
function taper(speed: number, topSpeed: number) {
  const r = Math.min(1, speed / topSpeed);
  return Math.max(0, 1 - r * r);
}
