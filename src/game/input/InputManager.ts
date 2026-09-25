'use client';

import { DEFAULT_BINDINGS, type Bindings, type GameAction } from '../config/bindings';
import { sim } from '../core/sim';

/**
 * Owns all keyboard/mouse input (spec 31).
 *
 * Responsibilities:
 *  - Translate physical keys to game actions via remappable bindings.
 *  - Track held vs edge-triggered (pressed) actions.
 *  - Refuse to capture input while a text field is focused.
 *  - Drop every held key when the window loses focus, so the player does not
 *    come back to a character sprinting into a wall.
 *  - Own pointer lock, and surface denial rather than silently breaking the camera.
 */
export class InputManager {
  private bindings: Bindings = { ...DEFAULT_BINDINGS };
  private codeToActions = new Map<string, GameAction[]>();

  private held = new Set<GameAction>();
  private pressed = new Set<GameAction>();

  private mouseDX = 0;
  private mouseDY = 0;

  public hasTouch = false;
  public mobileMoveX = 0;
  public mobileMoveZ = 0;
  public mobileLookX = 0;
  public mobileLookY = 0;
  private mobileHeld = new Set<GameAction>();
  private mobilePressed = new Set<GameAction>();

  setMobileAction(action: GameAction, isDown: boolean) {
    if (isDown) {
      if (!this.mobileHeld.has(action)) {
        this.mobilePressed.add(action);
      }
      this.mobileHeld.add(action);
    } else {
      this.mobileHeld.delete(action);
    }
  }

  /** When false, gameplay input is ignored (menus, loading, cutscenes, lost focus). */
  private gameplayEnabled = false;

  private el: HTMLElement | null = null;
  private attached = false;

  onPause?: () => void;
  /** Map toggle. Like pause, it must work while gameplay input is off. */
  onMap?: () => void;
  onPointerLockChange?: (locked: boolean) => void;
  onPointerLockError?: () => void;
  onAction?: (action: GameAction) => void;

  constructor() {
    this.rebuildLookup();
  }

  // ------------------------------------------------------------------ bindings

  setBindings(next: Bindings) {
    this.bindings = next;
    this.rebuildLookup();
  }

  getBindings(): Bindings {
    return this.bindings;
  }

  private rebuildLookup() {
    this.codeToActions.clear();
    (Object.keys(this.bindings) as GameAction[]).forEach((action) => {
      for (const code of this.bindings[action]) {
        const list = this.codeToActions.get(code) ?? [];
        list.push(action);
        this.codeToActions.set(code, list);
      }
    });
  }

  // ----------------------------------------------------------------- lifecycle

  attach(el: HTMLElement) {
    if (this.attached) this.detach();
    this.el = el;
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleBlur);
    document.addEventListener('visibilitychange', this.handleVisibility);
    document.addEventListener('pointerlockchange', this.handlePointerLockChange);
    document.addEventListener('pointerlockerror', this.handlePointerLockError);
    el.addEventListener('mousemove', this.handleMouseMove);
    el.addEventListener('mousedown', this.handleMouseDown);
    this.attached = true;
  }

  detach() {
    if (!this.attached) return;
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleBlur);
    document.removeEventListener('visibilitychange', this.handleVisibility);
    document.removeEventListener('pointerlockchange', this.handlePointerLockChange);
    document.removeEventListener('pointerlockerror', this.handlePointerLockError);
    this.el?.removeEventListener('mousemove', this.handleMouseMove);
    this.el?.removeEventListener('mousedown', this.handleMouseDown);
    this.el = null;
    this.attached = false;
    this.clearAll();
  }

  setGameplayEnabled(enabled: boolean) {
    if (this.gameplayEnabled === enabled) return;
    this.gameplayEnabled = enabled;
    // Handing control to a menu must not leave keys stuck down.
    if (!enabled) this.clearAll();
  }

  private clearAll() {
    this.held.clear();
    this.pressed.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.mobileHeld.clear();
    this.mobilePressed.clear();
    this.mobileMoveX = 0;
    this.mobileMoveZ = 0;
    this.mobileLookX = 0;
    this.mobileLookY = 0;
    const i = sim.input;
    i.moveX = 0;
    i.moveZ = 0;
    i.lookX = 0;
    i.lookY = 0;
    i.sprint = false;
    i.walk = false;
    i.jumpHeld = false;
    i.jumpPressed = false;
    i.throttle = 0;
    i.steer = 0;
    i.handbrake = false;
    i.hornHeld = false;
  }

  // -------------------------------------------------------------- pointer lock

  requestPointerLock() {
    if (this.hasTouch) return;
    const el = this.el;
    if (!el) return;
    if (document.pointerLockElement === el) return;
    try {
      const res = el.requestPointerLock() as unknown as Promise<void> | undefined;
      if (res && typeof res.catch === 'function') res.catch(() => this.onPointerLockError?.());
    } catch {
      this.onPointerLockError?.();
    }
  }

  exitPointerLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  get isPointerLocked() {
    return this.hasTouch || (!!this.el && document.pointerLockElement === this.el);
  }

  // ------------------------------------------------------------------ handlers

  private isTypingTarget(target: EventTarget | null): boolean {
    const node = target as HTMLElement | null;
    if (!node || !node.tagName) return false;
    const tag = node.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || node.isContentEditable === true;
  }

  private handleKeyDown = (e: KeyboardEvent) => {
    if (this.isTypingTarget(e.target)) return;
    const actions = this.codeToActions.get(e.code);
    if (!actions) return;

    for (const action of actions) {
      // Pause works even when gameplay input is off, so the player always has a
      // way back out.
      if (action === 'pause') {
        if (!e.repeat) {
          e.preventDefault();
          this.onPause?.();
        }
        continue;
      }
      // The map key also has to work while the map itself is open, or there
      // would be no way to close it with the same key that opened it.
      if (action === 'map') {
        if (!e.repeat) {
          e.preventDefault();
          this.onMap?.();
        }
        continue;
      }
      if (!this.gameplayEnabled) continue;
      e.preventDefault();
      // The e.repeat / held guard stops one held key producing repeated presses
      // (spec 11: no repeated jumping from a single held input).
      if (!e.repeat && !this.held.has(action)) {
        this.pressed.add(action);
        this.onAction?.(action);
      }
      this.held.add(action);
    }
  };

  private handleKeyUp = (e: KeyboardEvent) => {
    const actions = this.codeToActions.get(e.code);
    if (!actions) return;
    for (const action of actions) this.held.delete(action);
  };

  private handleBlur = () => this.clearAll();

  private handleVisibility = () => {
    if (document.hidden) this.clearAll();
  };

  private handleMouseMove = (e: MouseEvent) => {
    if (!this.gameplayEnabled || !this.isPointerLocked) return;
    this.mouseDX += e.movementX;
    this.mouseDY += e.movementY;
  };

  private handleMouseDown = () => {
    if (this.gameplayEnabled && !this.isPointerLocked) this.requestPointerLock();
  };

  private handlePointerLockChange = () => {
    const locked = this.isPointerLocked;
    if (!locked) {
      this.mouseDX = 0;
      this.mouseDY = 0;
    }
    this.onPointerLockChange?.(locked);
  };

  private handlePointerLockError = () => this.onPointerLockError?.();

  // ----------------------------------------------------------------- per-frame

  isHeld(action: GameAction) {
    return this.held.has(action);
  }

  /** Consume an edge-triggered press. True at most once per physical press. */
  consumePress(action: GameAction) {
    let pressed = false;
    if (this.pressed.has(action)) {
      this.pressed.delete(action);
      pressed = true;
    }
    if (this.mobilePressed.has(action)) {
      this.mobilePressed.delete(action);
      pressed = true;
    }
    return pressed;
  }

  /** Write this frame's intent into sim.input. */
  update(sensitivity: number, invertY: boolean) {
    const i = sim.input;

    if (!this.gameplayEnabled) {
      i.moveX = 0;
      i.moveZ = 0;
      i.lookX = 0;
      i.lookY = 0;
      // Edge flags MUST be cleared here too. Leaving one latched true means
      // every consumer re-fires it on every frame for as long as gameplay is
      // disabled - which is how a one-shot "get in" press became a permanent
      // refusal toast.
      i.jumpPressed = false;
      i.interactPressed = false;
      i.enterVehiclePressed = false;
      i.cameraTogglePressed = false;
      i.headlightsPressed = false;
      return;
    }

    // Movement, normalised so diagonals are not faster (spec 11).
    let x = this.mobileMoveX;
    let z = this.mobileMoveZ;
    if (this.held.has('moveLeft')) x -= 1;
    if (this.held.has('moveRight')) x += 1;
    if (this.held.has('moveForward')) z -= 1;
    if (this.held.has('moveBack')) z += 1;
    const len = Math.hypot(x, z);
    if (len > 1) {
      x /= len;
      z /= len;
    }
    i.moveX = x;
    i.moveZ = z;

    // Vehicle axes share the same physical keys; control mode decides which is read.
    i.throttle = this.mobileMoveZ !== 0 ? -this.mobileMoveZ : (this.held.has('moveForward') ? 1 : 0) - (this.held.has('moveBack') ? 1 : 0);
    i.steer = this.mobileMoveX !== 0 ? this.mobileMoveX : (this.held.has('moveRight') ? 1 : 0) - (this.held.has('moveLeft') ? 1 : 0);
    i.handbrake = this.held.has('jump') || this.mobileHeld.has('jump');

    i.sprint = this.held.has('sprint') || this.mobileHeld.has('sprint');
    i.walk = this.held.has('walk') || this.mobileHeld.has('walk');
    i.hornHeld = this.held.has('horn') || this.mobileHeld.has('horn');
    i.jumpHeld = this.held.has('jump') || this.mobileHeld.has('jump');

    i.jumpPressed = this.consumePress('jump');
    i.interactPressed = this.consumePress('interact');
    i.enterVehiclePressed = this.consumePress('enterVehicle');
    i.cameraTogglePressed = this.consumePress('cameraToggle');
    i.headlightsPressed = this.consumePress('headlights');

    // Look: radians this frame, already scaled by sensitivity.
    const RADIANS_PER_PIXEL = 0.0022;
    i.lookX = (this.mouseDX + this.mobileLookX) * RADIANS_PER_PIXEL * sensitivity;
    i.lookY = (this.mouseDY + this.mobileLookY) * RADIANS_PER_PIXEL * sensitivity * (invertY ? -1 : 1);
    
    
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.mobileLookX = 0;
    this.mobileLookY = 0;
  }
}

/** One input manager per page; the game mounts and attaches it. */
export const input = new InputManager();
