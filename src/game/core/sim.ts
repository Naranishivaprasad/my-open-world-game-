import * as THREE from 'three';
import { START_HOUR } from '../config/timeOfDay';
import type { ControlMode, InteractionTarget, LocomotionState } from './types';

/**
 * Mutable, NON-REACTIVE simulation state (spec 33).
 *
 * Everything that changes at frame or physics rate lives here. Writing to `sim`
 * never triggers a React render. UI that needs these values samples them on a
 * throttle and pushes only discrete changes into the zustand store.
 *
 * This is deliberately a singleton: there is exactly one running world.
 */
export interface PlayerSim {
  /** Authoritative feet position of the character capsule. */
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  /** Facing direction the character mesh is turning toward, radians. */
  heading: number;
  /** Ground-plane speed, m/s. */
  speed: number;
  grounded: boolean;
  /** Seconds since the character last touched ground (coyote-time / fall anim). */
  airTime: number;
  locomotion: LocomotionState;
  /** Name of the animation clip actually playing, for tests and the overlay. */
  clip: string;
  health: number;
}

export interface CameraSim {
  /** Orbit yaw around the player, radians. */
  yaw: number;
  /** Orbit pitch, radians, clamped. */
  pitch: number;
  /** Desired boom length, metres. */
  distance: number;
  /** Boom length after wall collision, metres. */
  actualDistance: number;
  /** Smoothed point the camera orbits. */
  target: THREE.Vector3;
  fov: number;
}

export interface InputSim {
  /** Camera-relative move intent, magnitude clamped to 1 (prevents fast diagonals). */
  moveX: number;
  moveZ: number;
  /** Mouse delta accumulated since last camera update, radians. */
  lookX: number;
  lookY: number;
  sprint: boolean;
  /** Hold-to-walk modifier, giving a third distinct ground speed. */
  walk: boolean;
  /** Edge-triggered: set true for one frame on press. */
  jumpPressed: boolean;
  jumpHeld: boolean;
  interactPressed: boolean;
  enterVehiclePressed: boolean;
  cameraTogglePressed: boolean;
  hornHeld: boolean;
  headlightsPressed: boolean;
  /** Vehicle axes, -1..1. */
  throttle: number;
  steer: number;
  handbrake: boolean;
}

/** Live hero-vehicle state, published by the vehicle controller each step. */
export interface VehicleSim {
  /** True while the player occupies the driver seat. */
  occupied: boolean;
  engineOn: boolean;
  headlights: boolean;
  speedKph: number;
  /** Signed forward speed, m/s. Negative when reversing. */
  forwardSpeed: number;
  gear: string;
  rpm01: number;
  /** Road-wheel angle, radians. */
  steer: number;
  /** Any wheel losing grip, for tyre-squeal audio and HUD. */
  slipping: boolean;
  overturned: boolean;
  /** World position, so the camera and HUD can follow without a React prop. */
  position: THREE.Vector3;
  heading: number;
  /** Which vehicle is being driven: 'hero', or a body-class key. */
  kind: string;
  /** Display name of the driven vehicle, for the HUD. */
  label: string;
}

/** Police and wanted state, published by the police system (spec 23, 29). */
export interface PoliceSim {
  state: 'unaware' | 'responding' | 'pursuing' | 'searching' | 'cooling' | 'busted';
  wanted: number;
  units: number;
  /** True while at least one officer currently has line of sight. */
  hasSight: boolean;
  /** Last position anyone actually observed, NOT the player's live position. */
  lastKnownX: number;
  lastKnownZ: number;
  searchRemaining: number;
}

/** Mission progress, published by the mission system (spec 24, 29). */
export interface MissionSim {
  state: 'available' | 'accepted' | 'active' | 'completed' | 'failed' | 'abandoned';
  title: string;
  objectiveIndex: number;
  objectiveLabel: string | null;
  /** Straight-line distance to the current objective, metres. */
  distance: number;
  inRange: boolean;
  promptKey: string | null;
  promptLabel: string | null;
  dialogue: string | null;
  carryingCrate: boolean;
  reward: number;
  /** Guards against paying the reward twice (spec 24). */
  paid: boolean;
  /**
   * Road-following route to the current objective, for the minimap.
   * Computed by A* over the lane network - never a straight line (spec 29).
   */
  route: { x: number; z: number }[] | null;
  /** Seconds left on a timed mission, or null when untimed. */
  timeLeft: number | null;
  /** Campaign progress. */
  completedCount: number;
  totalCount: number;
}

export interface StatsSim {
  fps: number;
  frameMs: number;
  physicsMs: number;
  drawCalls: number;
  triangles: number;
  rigidBodies: number;
  /** Static city collision is one body with many colliders; count both. */
  colliders: number;
  trafficCount: number;
  pedestrianCount: number;
}

/** In-game clock and the sky it implies (spec 10). */
export interface TimeSim {
  /** Hour of day, 0..24, fractional. */
  hour: number;
  /** How fast the clock runs relative to a full day. 0 freezes it. */
  scale: number;
  /** 0 = broad daylight, 1 = fully dark. Drives lit windows and headlights. */
  darkness: number;
  phase: 'night' | 'dawn' | 'morning' | 'afternoon' | 'dusk';
}

export interface Sim {
  /** Seconds since the session started running (excludes paused time). */
  elapsed: number;
  time: TimeSim;
  /** Player-placed map marker, or null. Shown on the map, minimap and HUD. */
  waypoint: { x: number; z: number } | null;
  /** Last frame delta, clamped. */
  dt: number;
  controlMode: ControlMode;
  player: PlayerSim;
  camera: CameraSim;
  input: InputSim;
  stats: StatsSim;
  vehicle: VehicleSim;
  police: PoliceSim;
  mission: MissionSim;
  /** Fictional in-game currency (spec 26). */
  money: number;
  /** Best interaction candidate this frame, or null. */
  interaction: InteractionTarget | null;
  /** Transient message ("Both doors are blocked"), shown separately from the prompt. */
  toast: string | null;
  /** Set by the renderer so non-React systems can raycast against the world. */
  scene: THREE.Scene | null;
}

export const sim: Sim = {
  elapsed: 0,
  time: { hour: START_HOUR, scale: 1, darkness: 0, phase: 'morning' },
  waypoint: null,
  dt: 0,
  controlMode: 'foot',
  player: {
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    heading: 0,
    speed: 0,
    grounded: false,
    airTime: 0,
    locomotion: 'idle',
    clip: '',
    health: 100,
  },
  camera: {
    yaw: 0,
    pitch: -0.12,
    distance: 4.6,
    actualDistance: 4.6,
    target: new THREE.Vector3(),
    fov: 62,
  },
  input: {
    moveX: 0,
    moveZ: 0,
    lookX: 0,
    lookY: 0,
    sprint: false,
    walk: false,
    jumpPressed: false,
    jumpHeld: false,
    interactPressed: false,
    enterVehiclePressed: false,
    cameraTogglePressed: false,
    hornHeld: false,
    headlightsPressed: false,
    throttle: 0,
    steer: 0,
    handbrake: false,
  },
  vehicle: {
    occupied: false,
    engineOn: false,
    headlights: false,
    speedKph: 0,
    forwardSpeed: 0,
    gear: 'P',
    rpm01: 0,
    steer: 0,
    slipping: false,
    overturned: false,
    position: new THREE.Vector3(),
    heading: 0,
    /** Which vehicle is being driven: the hero car, or a body class key. */
    kind: 'hero' as string,
    /** Display name of the driven vehicle, for the HUD. */
    label: 'Hero car',
  },
  police: {
    state: 'unaware',
    wanted: 0,
    units: 0,
    hasSight: false,
    lastKnownX: 0,
    lastKnownZ: 0,
    searchRemaining: 0,
  },
  mission: {
    state: 'available',
    title: '',
    objectiveIndex: 0,
    objectiveLabel: null,
    distance: 0,
    inRange: false,
    promptKey: null,
    promptLabel: null,
    dialogue: null,
    carryingCrate: false,
    reward: 0,
    paid: false,
    route: null,
    timeLeft: null,
    completedCount: 0,
    totalCount: 0,
  },
  money: 0,
  stats: { fps: 0, frameMs: 0, physicsMs: 0, drawCalls: 0, triangles: 0, rigidBodies: 0, colliders: 0, trafficCount: 0, pedestrianCount: 0 },
  interaction: null,
  toast: null,
  scene: null,
};

/** Clear per-frame edge-triggered flags. Called at the END of each frame. */
export function consumeEdgeInputs() {
  const i = sim.input;
  i.jumpPressed = false;
  i.interactPressed = false;
  i.enterVehiclePressed = false;
  i.cameraTogglePressed = false;
  i.headlightsPressed = false;
}

/** Reset the simulation to a clean state (new session / restart). */
export function resetSim() {
  sim.elapsed = 0;
  sim.dt = 0;
  sim.controlMode = 'foot';
  sim.player.position.set(0, 0, 0);
  sim.player.velocity.set(0, 0, 0);
  sim.player.heading = 0;
  sim.player.speed = 0;
  sim.player.grounded = false;
  sim.player.airTime = 0;
  sim.player.locomotion = 'idle';
  sim.player.health = 100;
  sim.vehicle.occupied = false;
  sim.vehicle.engineOn = false;
  sim.vehicle.headlights = false;
  sim.vehicle.speedKph = 0;
  sim.vehicle.forwardSpeed = 0;
  sim.vehicle.gear = 'P';
  sim.vehicle.rpm01 = 0;
  sim.vehicle.steer = 0;
  sim.vehicle.slipping = false;
  sim.vehicle.overturned = false;
  sim.police.state = 'unaware';
  sim.police.wanted = 0;
  sim.police.units = 0;
  sim.police.hasSight = false;
  sim.police.searchRemaining = 0;
  sim.mission.state = 'available';
  sim.mission.objectiveIndex = 0;
  sim.mission.objectiveLabel = null;
  sim.mission.dialogue = null;
  sim.mission.carryingCrate = false;
  sim.mission.paid = false;
  sim.mission.route = null;
  sim.money = 0;
  sim.camera.yaw = 0;
  sim.camera.pitch = -0.12;
  sim.camera.distance = 4.6;
  sim.camera.actualDistance = 4.6;
  sim.interaction = null;
  sim.toast = null;
}

/**
 * Is the test/debug hook enabled?
 *
 * On by default in development, and switchable ON in a production build with
 * NEXT_PUBLIC_PALM_DEBUG=1. Tying it to NODE_ENV alone meant the only build we
 * could measure was the dev build, which carries React development overhead -
 * so the frame rates we were asserting on were never the ones a player sees.
 * A normal production build (flag unset) still ships without the hook.
 */
export const DEBUG_HOOKS =
  process.env.NODE_ENV !== 'production' || process.env.NEXT_PUBLIC_PALM_DEBUG === '1';

/**
 * Development hook: exposes the live simulation so automated smoke tests (and a
 * human at the console) can assert on real state - position, speed, grounded -
 * rather than guessing from pixels.
 */
if (DEBUG_HOOKS && typeof window !== 'undefined') {
  (window as unknown as { __PALM__: unknown }).__PALM__ = { sim, THREE };
}
