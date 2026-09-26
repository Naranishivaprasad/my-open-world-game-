'use client';

import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useRapier } from '@react-three/rapier';
import { VehicleInteraction } from './VehicleInteraction';
import { findTakeoverTarget, parkCurrentVehicle } from './takeover';
import type { VehicleOwner } from './VehicleOwner';
import type { VehicleController } from './VehicleController';
import type { CharacterController } from '../character/CharacterController';
import type { Animator } from '../character/Animator';
import { DEBUG_HOOKS, sim } from '../core/sim';
import { useGame } from '../core/store';
import { input } from '../input/InputManager';
import { keyLabel } from '../config/bindings';

/**
 * Wires the car to the player (spec 14, 17, 18).
 *
 * Owns:
 *  - the enter/exit state machine
 *  - routing input to either the character or the car, never both
 *  - the contextual prompt
 *  - camera mode changes on entry and exit
 *  - publishing vehicle state into `sim` for the HUD and audio
 */
/** How close the player must be to a parked vehicle to take it over. */
const TAKEOVER_RADIUS = 3.4;

export function VehicleSystems({
  character,
  vehicle,
  owner,
  animator,
}: {
  character: CharacterController | null;
  vehicle: VehicleController | null;
  owner: VehicleOwner | null;
  animator: Animator | null;
}) {
  const { world, rapier } = useRapier();
  const interactionRef = useRef<VehicleInteraction | null>(null);
  const setCameraMode = useGame((s) => s.setCameraMode);
  const patchHud = useGame((s) => s.patchHud);
  const toastRef = useRef<{ text: string; until: number } | null>(null);
  /** Set after a takeover, so the entry sequence starts on the next frame. */
  const pendingEnterRef = useRef(false);
  /** Set once the player touches the headlight key, so auto never overrides them. */
  const headlightsManualRef = useRef(false);

  useEffect(() => {
    if (!character || !vehicle) return;

    const vi = new VehicleInteraction(world, rapier, character, vehicle, {
      onPlayClip: (clip) => {
        if (!animator) return;
        if (clip === 'idle') animator.setOverride(null);
        else if (clip === 'drive') animator.setOverride('sitIdle');
        else if (clip === 'sitEnter') animator.setOverride('sitEnter', 0.12);
        else if (clip === 'sitExit') animator.setOverride('sitExit', 0.12);
      },
      onEnterComplete: () => setCameraMode('tp-vehicle'),
      onExitComplete: () => setCameraMode('tp-foot'),
      onBlocked: (reason) => {
        toastRef.current = { text: reason, until: sim.elapsed + 2.2 };
      },
    });
    interactionRef.current = vi;

    if (DEBUG_HOOKS && typeof window !== 'undefined') {
      const w = window as unknown as { __PALM__?: Record<string, unknown> };
      w.__PALM__ = { ...(w.__PALM__ ?? {}), interaction: vi };
    }

    return () => {
      interactionRef.current = null;
    };
  }, [world, rapier, character, vehicle, animator, setCameraMode]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    const vi = interactionRef.current;
    if (!vi || !vehicle) return;

    const driving = vi.currentPhase === 'driving';

    // ------------------------------------------------------- route input
    // Exactly one consumer at a time (spec 17: no simultaneous controllers).
    if (driving) {
      vehicle.input.throttle = sim.input.throttle;
      vehicle.input.steer = sim.input.steer;
      vehicle.input.handbrake = sim.input.handbrake;
      // The character must not also try to walk.
      sim.input.moveX = 0;
      sim.input.moveZ = 0;
    } else {
      vehicle.input.throttle = 0;
      vehicle.input.steer = 0;
      vehicle.input.handbrake = false;
    }

    // Freeze walking entirely during a transition.
    if (vi.isBusy) {
      sim.input.moveX = 0;
      sim.input.moveZ = 0;
    }

    // Headlights come on by themselves after dark, until the player takes
    // manual control of them.
    if (!headlightsManualRef.current) {
      sim.vehicle.headlights = sim.time.darkness > 0.35;
    }

    // ---------------------------------------------------- taking a vehicle
    // The swap is applied at the start of the next physics step, so entry has
    // to wait a frame for the chassis to actually be the new car.
    if (pendingEnterRef.current && !vi.isBusy && sim.controlMode === 'foot') {
      pendingEnterRef.current = false;
      vi.toggle();
    }

    // ------------------------------------------------------------ actions
    if (sim.input.enterVehiclePressed) {
      const target =
        !driving && !vi.isBusy && owner
          ? findTakeoverTarget(world, sim.player.position.x, sim.player.position.z, TAKEOVER_RADIUS)
          : null;

      // Prefer whichever is nearer: the car last driven, or a parked one.
      const ownDistance = Math.hypot(
        sim.vehicle.position.x - sim.player.position.x,
        sim.vehicle.position.z - sim.player.position.z,
      );

      if (target && owner && target.distance < ownDistance) {
        parkCurrentVehicle(owner, world, rapier);
        target.commit();
        owner.requestSwap(target.kind, target.at, target.colour);
        pendingEnterRef.current = true;
        toastRef.current = { text: target.label, until: sim.elapsed + 1.8 };
      } else {
        vi.toggle();
      }
    }

    if (sim.police.state === 'busted' && driving) {
      vi.forceExit();
    }

    if (driving) {
      if (sim.input.cameraTogglePressed) {
        const next = useGame.getState().cameraMode === 'tp-vehicle' ? 'fp-vehicle' : 'tp-vehicle';
        setCameraMode(next);
      }
      if (sim.input.headlightsPressed) {
        sim.vehicle.headlights = !sim.vehicle.headlights;
        headlightsManualRef.current = true;
      }
      if (input.consumePress('recoverVehicle')) vehicle.recover();
    }

    // -------------------------------------------------------------- step
    vi.update(dt);

    // ------------------------------------------------- publish vehicle state
    const t = vehicle.body.translation();
    const rot = vehicle.body.rotation();
    sim.vehicle.position.set(t.x, t.y, t.z);
    // Facing, in the shared atan2(dirX, dirZ) convention. Traffic and the
    // police both need it to reason about where the player is heading.
    {
      const fx = 2 * (rot.x * rot.z + rot.w * rot.y);
      const fz = 1 - 2 * (rot.x * rot.x + rot.y * rot.y);
      sim.vehicle.heading = Math.atan2(-fx, -fz);
    }
    sim.vehicle.speedKph = vehicle.speedKph;
    sim.vehicle.forwardSpeed = vehicle.speed;
    sim.vehicle.gear = vehicle.currentGear;
    sim.vehicle.rpm01 = vehicle.rpm01;
    sim.vehicle.steer = vehicle.steer;
    sim.vehicle.engineOn = vehicle.isEngineOn;
    sim.vehicle.overturned = vehicle.isOverturned;
    sim.vehicle.slipping = 
      (vehicle.wheelStates.some((w) => !w.grounded) && Math.abs(vehicle.speed) > 4) ||
      (sim.input.handbrake && Math.abs(vehicle.speed) > 2);

    // ---------------------------------------------- contextual prompt (spec 14)
    const b = input.getBindings();
    let promptKey: string | null = null;
    let promptLabel: string | null = null;

    const toast = toastRef.current;
    sim.toast = toast && sim.elapsed < toast.until ? toast.text : null;

    if (driving) {
      promptKey = keyLabel(b.enterVehicle[0] ?? 'KeyF');
      promptLabel = 'Get out';
      if (vehicle.isOverturned) {
        promptKey = keyLabel(b.recoverVehicle[0] ?? 'KeyR');
        promptLabel = 'Flip the car back';
      }
    } else if (!vi.isBusy) {
      const entry = vi.getEntryPrompt();
      if (entry) {
        promptKey = keyLabel(b.enterVehicle[0] ?? 'KeyF');
        promptLabel = 'Get in';
      } else if (owner) {
        const target = findTakeoverTarget(
          world,
          sim.player.position.x,
          sim.player.position.z,
          TAKEOVER_RADIUS,
        );
        if (target) {
          promptKey = keyLabel(b.enterVehicle[0] ?? 'KeyF');
          promptLabel = `Drive the ${target.label}`;
        }
      }
    }

    sim.interaction = promptLabel
      ? {
          id: 'hero-vehicle',
          kind: 'vehicle',
          label: promptLabel,
          key: promptKey ?? 'F',
          distance: 0,
          position: sim.vehicle.position,
        }
      : null;
  });

  // Keep the discrete HUD store in step at a human rate, not per frame.
  useEffect(() => {
    const id = window.setInterval(() => {
      patchHud({
        speedKph: Math.round(sim.vehicle.speedKph),
        gear: sim.vehicle.gear,
        rpm01: sim.vehicle.rpm01,
      });
    }, 100);
    return () => window.clearInterval(id);
  }, [patchHud]);

  return null;
}
