import * as THREE from 'three';
import { BLEND, CLIPS, CLIP_NOMINAL_SPEED, LOCOMOTION_THRESHOLDS } from '../config/character';
import type { LocomotionState } from '../core/types';
import { sim } from '../core/sim';

type ClipKey = keyof typeof CLIPS;

/**
 * Explicit animation state machine (spec 12).
 *
 * Transitions are crossfaded, locomotion playback rate follows actual ground
 * speed to cut foot sliding, and one-shot clips (jump start / land) clamp and
 * hand control back rather than looping.
 *
 * Only clips actually present in the GLB are used; a missing clip degrades to
 * the nearest available state instead of throwing.
 */
export class Animator {
  private mixer: THREE.AnimationMixer;
  private actions = new Map<ClipKey, THREE.AnimationAction>();
  private current: ClipKey = 'idle';
  /** Set while a one-shot clip owns the body. */
  private oneShotUntil = 0;
  private elapsed = 0;
  private wasGrounded = true;
  /**
   * When set, this clip owns the body and locomotion is ignored - used while
   * seated in a vehicle, where ground speed is the car's, not the character's.
   */
  private override: ClipKey | null = null;

  constructor(root: THREE.Object3D, clips: THREE.AnimationClip[]) {
    this.mixer = new THREE.AnimationMixer(root);

    const byName = new Map(clips.map((c) => [c.name, c]));
    (Object.keys(CLIPS) as ClipKey[]).forEach((key) => {
      const clip = byName.get(CLIPS[key]);
      if (!clip) return;
      const action = this.mixer.clipAction(clip);
      // Jump start / land and interact are one-shots.
      if (key === 'jumpStart' || key === 'jumpLand' || key === 'interact' || key === 'sitEnter' || key === 'sitExit') {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      } else {
        action.setLoop(THREE.LoopRepeat, Infinity);
      }
      this.actions.set(key, action);
    });

    const idle = this.actions.get('idle');
    if (idle) {
      idle.play();
      idle.weight = 1;
    }
  }

  /** The clip currently playing, for the debug overlay and tests. */
  get currentClip(): string {
    return CLIPS[this.current];
  }

  /** Clip names that were requested but not found, for the debug overlay. */
  get missingClips(): string[] {
    return (Object.keys(CLIPS) as ClipKey[]).filter((k) => !this.actions.has(k)).map((k) => CLIPS[k]);
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.mixer.getRoot());
  }

  /**
   * Force a specific clip until cleared. Pass null to hand control back to the
   * locomotion state machine.
   */
  setOverride(key: ClipKey | null, blend = BLEND.locomotion) {
    if (this.override === key) return;
    this.override = key;
    if (key) this.fadeTo(key, blend);
  }

  /** Play a one-shot clip that temporarily owns the body (e.g. Interact). */
  playOneShot(key: ClipKey, holdSeconds: number) {
    const action = this.actions.get(key);
    if (!action) return;
    this.fadeTo(key, BLEND.toJump);
    this.oneShotUntil = this.elapsed + holdSeconds;
  }

  update(dt: number) {
    this.elapsed += dt;
    const p = sim.player;

    const next = this.chooseState(p.speed, p.grounded, p.velocity.y);
    if (next !== this.current) {
      const blend =
        next === 'jumpStart' || next === 'jumpLoop'
          ? BLEND.toJump
          : next === 'jumpLand'
            ? BLEND.toLand
            : this.current === 'jumpLand'
              ? BLEND.fromLand
              : BLEND.locomotion;
      this.fadeTo(next, blend);
    }

    // Keep the feet in step with real travel speed (spec 12). While seated the
    // character is not walking, so playback stays at 1x.
    this.applyPlaybackRate(this.override ? 0 : p.speed);

    this.mixer.update(dt);
    this.wasGrounded = p.grounded;
    p.locomotion = this.toLocomotion(this.current);
  }

  // ------------------------------------------------------------------ internals

  private chooseState(speed: number, grounded: boolean, vy: number): ClipKey {
    // A seated/override clip beats everything.
    if (this.override) return this.override;
    // A one-shot owns the body until it expires.
    if (this.elapsed < this.oneShotUntil) return this.current;

    if (!grounded) {
      // Rising just after takeoff plays the launch clip, then the loop.
      if (vy > 1.2 && this.current !== 'jumpLoop' && this.has('jumpStart')) return 'jumpStart';
      return this.has('jumpLoop') ? 'jumpLoop' : 'idle';
    }

    // Touchdown after being airborne.
    if (!this.wasGrounded && this.has('jumpLand')) {
      this.oneShotUntil = this.elapsed + 0.26;
      return 'jumpLand';
    }
    if (this.current === 'jumpLand' && this.elapsed < this.oneShotUntil) return 'jumpLand';

    return this.chooseLocomotion(speed);
  }

  /** Speed bands with hysteresis so the animator does not flicker at a boundary. */
  private chooseLocomotion(speed: number): ClipKey {
    const t = LOCOMOTION_THRESHOLDS;
    const c = this.current;

    if (c === 'idle') return speed > t.idleExit ? 'walk' : 'idle';
    if (c === 'walk') {
      if (speed < t.idleEnter) return 'idle';
      if (speed > t.runEnter) return 'run';
      return 'walk';
    }
    if (c === 'run') {
      if (speed < t.runExit) return 'walk';
      if (speed > t.sprintEnter) return 'sprint';
      return 'run';
    }
    if (c === 'sprint') return speed < t.sprintExit ? 'run' : 'sprint';

    // Coming out of a jump or one-shot: pick purely on speed.
    if (speed < t.idleEnter) return 'idle';
    if (speed < t.runEnter) return 'walk';
    if (speed < t.sprintEnter) return 'run';
    return 'sprint';
  }

  private applyPlaybackRate(speed: number) {
    const key = this.current;
    const nominal =
      key === 'walk'
        ? CLIP_NOMINAL_SPEED.walk
        : key === 'run'
          ? CLIP_NOMINAL_SPEED.run
          : key === 'sprint'
            ? CLIP_NOMINAL_SPEED.sprint
            : 0;
    const action = this.actions.get(key);
    if (!action) return;
    if (nominal > 0) {
      // Clamped so a stall or a downhill sprint never looks like fast-forward.
      action.timeScale = THREE.MathUtils.clamp(speed / nominal, 0.55, 1.65);
    } else {
      action.timeScale = 1;
    }
  }

  private has(key: ClipKey) {
    return this.actions.has(key);
  }

  private fadeTo(key: ClipKey, duration: number) {
    const next = this.actions.get(key);
    if (!next) return;
    const prev = this.actions.get(this.current);

    if (next === prev) return;

    next.reset();
    next.enabled = true;
    next.setEffectiveTimeScale(1);
    next.setEffectiveWeight(1);
    next.play();

    if (prev) prev.crossFadeTo(next, duration, false);
    this.current = key;
  }

  private toLocomotion(key: ClipKey): LocomotionState {
    switch (key) {
      case 'walk':
        return 'walk';
      case 'run':
        return 'run';
      case 'sprint':
        return 'sprint';
      case 'jumpStart':
      case 'jumpLoop':
        return sim.player.velocity.y > 0 ? 'jump' : 'fall';
      case 'jumpLand':
        return 'land';
      default:
        return 'idle';
    }
  }
}
