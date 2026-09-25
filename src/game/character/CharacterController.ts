import type Rapier from '@dimforge/rapier3d-compat';
import type { Collider, KinematicCharacterController, RigidBody, World } from '@dimforge/rapier3d-compat';
import { CAPSULE, MOVEMENT } from '../config/character';
import { sim } from '../core/sim';

const DEG = Math.PI / 180;

/**
 * Collision-aware character controller (spec 11).
 *
 * Uses Rapier's KinematicCharacterController, which resolves sliding along
 * walls, slope limits, autostep over kerbs and snap-to-ground for us. Movement
 * is integrated ourselves so acceleration, sprinting and jumping stay in our
 * control; the controller only decides how far the capsule may actually move.
 *
 * This class is deliberately NOT a React component - it runs on the physics
 * step, not the render cycle (spec 33).
 */
export class CharacterController {
  readonly body: RigidBody;
  readonly collider: Collider;
  private controller: KinematicCharacterController;
  private world: World;
  private rapier: typeof Rapier;

  /** Horizontal velocity, m/s. Vertical is tracked separately. */
  private vx = 0;
  private vz = 0;
  private vy = 0;

  private grounded = false;
  private airTime = 0;
  /** Set on takeoff so a held jump key cannot re-trigger mid-air. */
  private jumpLatched = false;

  private disposed = false;

  constructor(
    world: World,
    rapier: typeof Rapier,
    spawn: { x: number; y: number; z: number; heading: number },
  ) {
    this.world = world;
    this.rapier = rapier;

    // Rapier positions the capsule by its CENTRE; sim stores feet position.
    const centreY = spawn.y + CAPSULE.centreToFeet;

    this.body = world.createRigidBody(
      rapier.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(spawn.x, centreY, spawn.z)
        .setCcdEnabled(false),
    );

    this.collider = world.createCollider(
      rapier.ColliderDesc.capsule(CAPSULE.halfHeight, CAPSULE.radius).setFriction(0),
      this.body,
    );

    const c = world.createCharacterController(MOVEMENT.collisionOffset);
    c.setUp({ x: 0, y: 1, z: 0 });
    c.setSlideEnabled(true);
    c.setMaxSlopeClimbAngle(MOVEMENT.maxSlopeClimb * DEG);
    c.setMinSlopeSlideAngle(MOVEMENT.minSlopeSlide * DEG);
    // Autostep clears the 0.15 m kerb without letting the player climb walls.
    c.enableAutostep(MOVEMENT.autostepMaxHeight, MOVEMENT.autostepMinWidth, true);
    c.enableSnapToGround(MOVEMENT.snapToGround);
    c.setApplyImpulsesToDynamicBodies(true);
    c.setCharacterMass(MOVEMENT.mass);
    this.controller = c;

    sim.player.position.set(spawn.x, spawn.y, spawn.z);
    sim.player.heading = spawn.heading;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this.world.removeCharacterController(this.controller);
      this.world.removeRigidBody(this.body);
    } catch {
      /* world already torn down */
    }
  }

  /** Place the character at a validated safe position, clearing momentum. */
  teleport(x: number, y: number, z: number, heading = sim.player.heading) {
    this.body.setTranslation({ x, y: y + CAPSULE.centreToFeet, z }, true);
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.grounded = false;
    this.airTime = 0;
    sim.player.position.set(x, y, z);
    sim.player.velocity.set(0, 0, 0);
    sim.player.heading = heading;
  }

  /**
   * Advance one fixed physics step.
   * @param dt fixed timestep, seconds
   */
  update(dt: number) {
    if (this.disposed) return;

    const input = sim.input;
    const yaw = sim.camera.yaw;

    // --- camera-relative move intent (spec 11) ---
    // Camera forward on the ground plane, and its right-hand perpendicular.
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);

    // input.moveZ is -1 for "forward", so negate it into world space.
    let dirX = fx * -input.moveZ + rx * input.moveX;
    let dirZ = fz * -input.moveZ + rz * input.moveX;
    const dirLen = Math.hypot(dirX, dirZ);
    const hasInput = dirLen > 0.001;
    if (hasInput) {
      dirX /= dirLen;
      dirZ /= dirLen;
    }

    const targetSpeed = hasInput
      ? input.sprint
        ? MOVEMENT.sprintSpeed
        : input.walk
          ? MOVEMENT.walkSpeed
          : MOVEMENT.runSpeed
      : 0;

    // --- horizontal acceleration ---
    const desiredVX = dirX * targetSpeed;
    const desiredVZ = dirZ * targetSpeed;
    const rate = this.grounded
      ? hasInput
        ? MOVEMENT.accel
        : MOVEMENT.decel
      : MOVEMENT.airAccel;

    this.vx = approach(this.vx, desiredVX, rate * dt);
    this.vz = approach(this.vz, desiredVZ, rate * dt);

    // --- vertical: gravity, jump, coyote time ---
    this.airTime = this.grounded ? 0 : this.airTime + dt;
    const canJump = this.grounded || this.airTime <= MOVEMENT.coyoteTime;

    if (input.jumpPressed && canJump && !this.jumpLatched) {
      this.vy = MOVEMENT.jumpSpeed;
      this.jumpLatched = true;
      this.grounded = false;
    }
    if (!input.jumpHeld) this.jumpLatched = false;

    this.vy += MOVEMENT.gravity * dt;
    // Terminal velocity keeps a long fall from tunnelling.
    if (this.vy < -55) this.vy = -55;

    // --- ask the controller how far we may actually move ---
    const desired = { x: this.vx * dt, y: this.vy * dt, z: this.vz * dt };
    this.controller.computeColliderMovement(
      this.collider,
      desired,
      this.rapier.QueryFilterFlags.EXCLUDE_SENSORS,
    );
    const moved = this.controller.computedMovement();
    const wasGrounded = this.grounded;
    this.grounded = this.controller.computedGrounded();

    const t = this.body.translation();
    const nx = t.x + moved.x;
    const ny = t.y + moved.y;
    const nz = t.z + moved.z;
    this.body.setNextKinematicTranslation({ x: nx, y: ny, z: nz });

    // Landing or head-bump: kill vertical momentum so we do not accumulate.
    if (this.grounded && this.vy < 0) this.vy = 0;
    if (!wasGrounded && this.grounded) this.airTime = 0;
    // Hit a ceiling: moved less upward than asked.
    if (this.vy > 0 && moved.y < desired.y - 1e-4) this.vy = 0;

    // Blocked horizontally (wall slide): bleed the component we could not use,
    // otherwise the character keeps "pressing" and animation reads as running
    // on the spot at full speed.
    const actualVX = moved.x / dt;
    const actualVZ = moved.z / dt;
    if (Math.abs(actualVX) < Math.abs(this.vx)) this.vx = actualVX;
    if (Math.abs(actualVZ) < Math.abs(this.vz)) this.vz = actualVZ;

    // --- turn the mesh toward travel direction ---
    const speed = Math.hypot(actualVX, actualVZ);
    if (hasInput && speed > 0.15) {
      const targetHeading = Math.atan2(dirX, dirZ);
      sim.player.heading = turnToward(sim.player.heading, targetHeading, MOVEMENT.turnRate * dt);
    }

    // --- publish to sim (feet position) ---
    const p = sim.player;
    p.position.set(nx, ny - CAPSULE.centreToFeet, nz);
    p.velocity.set(actualVX, this.vy, actualVZ);
    p.speed = speed;
    p.grounded = this.grounded;
    p.airTime = this.airTime;
  }
}

/** Move `current` toward `target` by at most `maxDelta`. */
function approach(current: number, target: number, maxDelta: number): number {
  const d = target - current;
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}

/** Shortest-path angular interpolation, radians. */
function turnToward(current: number, target: number, maxDelta: number): number {
  let d = target - current;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}
