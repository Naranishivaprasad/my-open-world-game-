import * as THREE from 'three';
import type Rapier from '@dimforge/rapier3d-compat';
import type { World } from '@dimforge/rapier3d-compat';
import type { CharacterController } from '../character/CharacterController';
import type { VehicleController } from './VehicleController';

import { CAPSULE } from '../config/character';
import { sim } from '../core/sim';

/**
 * Explicit enter/exit state machine (spec 17).
 *
 *   onFoot -> aligning -> entering -> driving -> exiting -> onFoot
 *
 * Every transition is gated: distance, vehicle speed, occupancy and physical
 * obstruction are all checked before the sequence starts, and the exit side is
 * validated before the character is ever placed, so nobody is spawned inside a
 * wall or another car.
 */

export type InteractionPhase = 'onFoot' | 'aligning' | 'entering' | 'driving' | 'exiting';

/** Clip-driven timings, tuned to the Quaternius Sitting_* clips. */
const ALIGN_TIME = 0.28;
const ENTER_TIME = 0.85;
const EXIT_TIME = 0.72;

/** The player must be at least this close to the door anchor to enter. */
const ENTER_RADIUS = 3.0;
/** Refuse entry to a car that is still rolling. */
const MAX_ENTER_SPEED = 2.2;
/** Refuse exit above this speed (spec 17: handle high-speed restrictions). */
const MAX_EXIT_SPEED = 6.0;



export interface InteractionCallbacks {
  onEnterComplete?: () => void;
  onExitComplete?: () => void;
  /** Raised when an action is refused, for a HUD message. */
  onBlocked?: (reason: string) => void;
  /** Drives the character animator through the sequence. */
  onPlayClip?: (clip: 'sitEnter' | 'sitExit' | 'drive' | 'idle') => void;
}

export class VehicleInteraction {
  private phase: InteractionPhase = 'onFoot';
  private timer = 0;
  private fromPos = new THREE.Vector3();
  private toPos = new THREE.Vector3();
  private fromHeading = 0;
  private toHeading = 0;
  /** Which door the current sequence uses. */
  private usingPassengerSide = false;

  constructor(
    private world: World,
    private rapier: typeof Rapier,
    private character: CharacterController,
    private vehicle: VehicleController,
    private cb: InteractionCallbacks = {},
  ) {}

  /** Anchors of whatever vehicle is currently being driven. */
  private get anchors() {
    return this.vehicle.build.anchors;
  }

  get currentPhase() {
    return this.phase;
  }

  get isBusy() {
    return this.phase === 'aligning' || this.phase === 'entering' || this.phase === 'exiting';
  }

  // ------------------------------------------------------------------ queries

  /** World-space position of a body-space anchor on the car. */
  private anchorWorld(anchor: { x: number; y: number; z: number }, out: THREE.Vector3) {
    const t = this.vehicle.body.translation();
    const r = this.vehicle.body.rotation();
    out.set(anchor.x, anchor.y, anchor.z);
    out.applyQuaternion(QUAT.set(r.x, r.y, r.z, r.w));
    out.set(out.x + t.x, out.y + t.y, out.z + t.z);
    return out;
  }

  private vehicleHeading() {
    const r = this.vehicle.body.rotation();
    FORWARD.set(0, 0, -1).applyQuaternion(QUAT.set(r.x, r.y, r.z, r.w));
    return Math.atan2(FORWARD.x, FORWARD.z);
  }

  /** Is a capsule-sized volume at this spot clear of everything but the car? */
  private isSpotClear(pos: THREE.Vector3): boolean {
    const shape = new this.rapier.Ball(this.vehicle.build.doorClearance);
    // Probe at hip height so a kerb underfoot does not count as an obstruction.
    const hit = this.world.intersectionWithShape(
      { x: pos.x, y: pos.y + CAPSULE.centreToFeet, z: pos.z },
      { x: 0, y: 0, z: 0, w: 1 },
      shape,
      this.rapier.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      this.character.collider,
      this.vehicle.body,
    );
    return hit === null;
  }

  /**
   * Distance from the player to the nearest usable door, or null when entry is
   * not currently possible. Drives the contextual prompt (spec 14).
   */
  getEntryPrompt(): { distance: number; position: THREE.Vector3 } | null {
    if (this.phase !== 'onFoot') return null;
    if (Math.abs(this.vehicle.speed) > MAX_ENTER_SPEED) return null;

    const p = sim.player.position;
    const driver = this.anchorWorld(this.anchors.driverDoor, TMP_A);
    const dDriver = driver.distanceTo(p);
    const passenger = this.anchorWorld(this.anchors.passengerDoor, TMP_B);
    const dPass = passenger.distanceTo(p);

    const best = dDriver <= dPass ? dDriver : dPass;
    if (best > ENTER_RADIUS) return null;
    return { distance: best, position: (dDriver <= dPass ? driver : passenger).clone() };
  }

  // --------------------------------------------------------------- commands

  /** Player pressed the enter/exit key. */
  toggle() {
    if (this.isBusy) return;
    if (this.phase === 'driving') this.beginExit();
    else this.beginEnter();
  }

  private beginEnter() {
    if (Math.abs(this.vehicle.speed) > MAX_ENTER_SPEED) {
      this.cb.onBlocked?.('The car is still moving');
      return;
    }
    if (sim.vehicle.occupied) {
      this.cb.onBlocked?.('That seat is taken');
      return;
    }

    const p = sim.player.position;
    const driver = this.anchorWorld(this.anchors.driverDoor, TMP_A).clone();
    const passenger = this.anchorWorld(this.anchors.passengerDoor, TMP_B).clone();

    const dDriver = driver.distanceTo(p);
    const dPass = passenger.distanceTo(p);
    if (Math.min(dDriver, dPass) > ENTER_RADIUS) {
      this.cb.onBlocked?.('Too far from the car');
      return;
    }

    // Prefer the nearer door, but fall back if it is against a wall (spec 17).
    let door = driver;
    this.usingPassengerSide = false;
    if (dPass < dDriver) {
      door = passenger;
      this.usingPassengerSide = true;
    }
    if (!this.isSpotClear(door)) {
      const other = this.usingPassengerSide ? driver : passenger;
      if (this.isSpotClear(other)) {
        door = other;
        this.usingPassengerSide = !this.usingPassengerSide;
      } else {
        this.cb.onBlocked?.('No room to open the door');
        return;
      }
    }

    this.fromPos.copy(p);
    this.toPos.copy(door);
    this.fromHeading = sim.player.heading;
    // Face the car while opening the door.
    this.toHeading = Math.atan2(
      this.anchorWorld(this.anchors.driverSeat, TMP_C).x - door.x,
      this.anchorWorld(this.anchors.driverSeat, TMP_C).z - door.z,
    );
    this.timer = 0;
    this.phase = 'aligning';
    sim.controlMode = 'entering';
  }

  private beginExit() {
    if (Math.abs(this.vehicle.speed) > MAX_EXIT_SPEED) {
      this.cb.onBlocked?.('Too fast to get out');
      return;
    }

    const driver = this.anchorWorld(this.anchors.driverDoor, TMP_A).clone();
    const passenger = this.anchorWorld(this.anchors.passengerDoor, TMP_B).clone();

    // Validate before placing the character anywhere (spec 17).
    let target: THREE.Vector3 | null = null;
    if (this.isSpotClear(driver)) target = driver;
    else if (this.isSpotClear(passenger)) target = passenger;

    if (!target) {
      this.cb.onBlocked?.('Both doors are blocked');
      return;
    }

    this.fromPos.copy(this.anchorWorld(this.anchors.driverSeat, TMP_C));
    this.toPos.copy(target);
    this.fromHeading = sim.player.heading;
    this.toHeading = this.vehicleHeading();
    this.timer = 0;
    this.phase = 'exiting';
    sim.controlMode = 'exiting';
    this.cb.onPlayClip?.('sitExit');
  }

  // ----------------------------------------------------------------- update

  /** Advance the sequence. Called once per rendered frame. */
  update(dt: number) {
    switch (this.phase) {
      case 'aligning': {
        this.timer += dt;
        const t = Math.min(1, this.timer / ALIGN_TIME);
        sim.player.position.lerpVectors(this.fromPos, this.toPos, ease(t));
        sim.player.heading = lerpAngle(this.fromHeading, this.toHeading, ease(t));
        if (t >= 1) {
          this.timer = 0;
          this.phase = 'entering';
          // The capsule must stop colliding before it is moved into the car.
          this.character.collider.setEnabled(false);
          this.cb.onPlayClip?.('sitEnter');
        }
        break;
      }

      case 'entering': {
        this.timer += dt;
        const t = Math.min(1, this.timer / ENTER_TIME);
        const seat = this.anchorWorld(this.anchors.driverSeat, TMP_C);
        sim.player.position.lerpVectors(this.toPos, seat, ease(t));
        sim.player.heading = lerpAngle(this.toHeading, this.vehicleHeading(), ease(t));
        if (t >= 1) {
          this.phase = 'driving';
          sim.controlMode = 'vehicle';
          sim.vehicle.occupied = true;
          this.vehicle.setOccupied(true);
          this.vehicle.setEngine(true);
          this.cb.onPlayClip?.('drive');
          this.cb.onEnterComplete?.();
        }
        break;
      }

      case 'driving': {
        // Ride with the car: the seat anchor is authoritative each frame, so the
        // character can never drift out of the seat.
        this.anchorWorld(this.anchors.driverSeat, sim.player.position);
        sim.player.heading = this.vehicleHeading();
        break;
      }

      case 'exiting': {
        this.timer += dt;
        const t = Math.min(1, this.timer / EXIT_TIME);
        sim.player.position.lerpVectors(this.fromPos, this.toPos, ease(t));
        sim.player.heading = lerpAngle(this.fromHeading, this.toHeading, ease(t));
        if (t >= 1) {
          this.phase = 'onFoot';
          sim.controlMode = 'foot';
          sim.vehicle.occupied = false;
          this.vehicle.setOccupied(false);
          this.vehicle.setEngine(false);
          // Restore collision and hand the capsule back its position.
          this.character.collider.setEnabled(true);
          this.character.teleport(this.toPos.x, this.toPos.y, this.toPos.z, this.toHeading);
          this.cb.onPlayClip?.('idle');
          this.cb.onExitComplete?.();
        }
        break;
      }

      default:
        break;
    }
  }

  /** Force the player out of the car without an animation (error recovery). */
  forceExit() {
    if (this.phase === 'onFoot') return;
    const door = this.anchorWorld(this.anchors.driverDoor, TMP_A).clone();
    this.phase = 'onFoot';
    sim.controlMode = 'foot';
    sim.vehicle.occupied = false;
    this.vehicle.setOccupied(false);
    this.vehicle.setEngine(false);
    this.character.collider.setEnabled(true);
    this.character.teleport(door.x, door.y, door.z, this.vehicleHeading());
    this.cb.onPlayClip?.('idle');
  }
}

// ------------------------------------------------------------------- helpers

const TMP_A = new THREE.Vector3();
const TMP_B = new THREE.Vector3();
const TMP_C = new THREE.Vector3();
const FORWARD = new THREE.Vector3();
const QUAT = new THREE.Quaternion();

/** Smoothstep, so the character eases rather than snapping into the seat. */
function ease(t: number) {
  return t * t * (3 - 2 * t);
}

function lerpAngle(a: number, b: number, t: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
