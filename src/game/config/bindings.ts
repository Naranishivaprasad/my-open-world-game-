/**
 * Remappable key bindings (spec 31). Values are KeyboardEvent.code so the
 * layout is physical-key based and still works on non-QWERTY keyboards.
 */
export type GameAction =
  | 'moveForward'
  | 'moveBack'
  | 'moveLeft'
  | 'moveRight'
  | 'sprint'
  | 'walk'
  | 'jump'
  | 'interact'
  | 'enterVehicle'
  | 'cameraToggle'
  | 'horn'
  | 'headlights'
  | 'map'
  | 'pause'
  | 'debugOverlay'
  | 'debugColliders'
  | 'recoverVehicle';

export type Bindings = Record<GameAction, string[]>;

export const DEFAULT_BINDINGS: Bindings = {
  moveForward: ['KeyW', 'ArrowUp'],
  moveBack: ['KeyS', 'ArrowDown'],
  moveLeft: ['KeyA', 'ArrowLeft'],
  moveRight: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  walk: ['AltLeft', 'KeyZ'],
  jump: ['Space'],
  interact: ['KeyE'],
  enterVehicle: ['KeyF'],
  cameraToggle: ['KeyV'],
  horn: ['KeyH'],
  headlights: ['KeyL'],
  map: ['KeyM'],
  pause: ['Escape'],
  debugOverlay: ['F3'],
  debugColliders: ['F4'],
  recoverVehicle: ['KeyR'],
};

/** Human-readable labels for the controls screen. */
export const ACTION_LABELS: Record<GameAction, string> = {
  moveForward: 'Move forward / Accelerate',
  moveBack: 'Move back / Brake & reverse',
  moveLeft: 'Move left / Steer left',
  moveRight: 'Move right / Steer right',
  sprint: 'Sprint',
  walk: 'Walk (hold)',
  jump: 'Jump / Handbrake',
  interact: 'Interact',
  enterVehicle: 'Enter / exit vehicle',
  cameraToggle: 'Switch camera',
  horn: 'Horn',
  headlights: 'Headlights',
  map: 'Map',
  pause: 'Pause',
  debugOverlay: 'Debug overlay (dev)',
  debugColliders: 'Show colliders (dev)',
  recoverVehicle: 'Recover stuck vehicle',
};

/** Actions the controls screen lets the player rebind. */
export const REBINDABLE: GameAction[] = [
  'moveForward',
  'moveBack',
  'moveLeft',
  'moveRight',
  'sprint',
  'walk',
  'jump',
  'interact',
  'enterVehicle',
  'cameraToggle',
  'horn',
  'headlights',
  'map',
  'recoverVehicle',
];

/** Pretty-print a KeyboardEvent.code for the UI. */
export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Arrow')) return code.slice(5) + ' Arrow';
  switch (code) {
    case 'ShiftLeft':
      return 'L Shift';
    case 'ShiftRight':
      return 'R Shift';
    case 'Space':
      return 'Space';
    case 'Escape':
      return 'Esc';
    default:
      return code;
  }
}
