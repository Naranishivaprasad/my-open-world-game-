/**
 * Player character tuning and asset binding (spec 11, 12).
 *
 * All tuning lives here rather than being scattered through the controller
 * (spec 15's rule applied to the character as well as the vehicle).
 */

export const CHARACTER_MODEL = {
  /**
   * Quaternius Universal Animation Library (Standard), CC0 1.0.
   * Contains the rig, a mannequin body and 46 clips. See ASSETS.md.
   */
  url: '/models/vendor/character_anims.glb',
  /** The GLB is authored at 1 unit = 1 metre; no rescale needed. */
  scale: 1,
  /**
   * Bind-pose facing correction.
   *
   * heading is atan2(dirX, dirZ), so a mesh whose bind pose already faces +Z
   * aligns with travel at rotation.y = heading exactly. Verified in-browser:
   * this model faces +Z, so the offset is zero. A non-zero value here rotated
   * the character to run backwards.
   */
  yawOffset: 0,
};

/** Capsule: 1.8 m tall adult. total height = 2*(halfHeight + radius). */
export const CAPSULE = {
  radius: 0.3,
  /** Half of the cylindrical segment only, as Rapier's capsule() expects. */
  halfHeight: 0.6,
  get totalHeight() {
    return this.halfHeight * 2 + this.radius * 2;
  },
  /** Distance from the capsule centre down to the soles. */
  get centreToFeet() {
    return this.halfHeight + this.radius;
  },
};

export const MOVEMENT = {
  walkSpeed: 1.7,
  runSpeed: 4.2,
  sprintSpeed: 6.6,

  /** Ground acceleration / deceleration, m/s^2. */
  accel: 24,
  decel: 30,
  /** Much weaker control while airborne. */
  airAccel: 5,

  /** How fast the character turns to face its movement direction, rad/s. */
  turnRate: 13,

  gravity: -19,
  /** Chosen so the apex is roughly 0.85 m. */
  jumpSpeed: 5.7,
  /** Grace period after leaving ground during which a jump still registers. */
  coyoteTime: 0.11,

  /** Slope the character can walk up, degrees. */
  maxSlopeClimb: 50,
  /** Slope steep enough to slide back down, degrees. */
  minSlopeSlide: 38,

  /** Autostep must clear the 0.15 m kerb comfortably. */
  autostepMaxHeight: 0.4,
  autostepMinWidth: 0.18,

  /** Keeps the capsule glued to the ground over small dips. */
  snapToGround: 0.45,

  /** Gap the controller keeps from geometry, preventing jitter in corners. */
  collisionOffset: 0.015,

  /** Mass used when pushing dynamic props such as cones. */
  mass: 78,
};

/**
 * Clip names verified by parsing the GLB, not assumed (spec 7).
 * Present in the file: 46 clips on a 53-joint Rigify rig.
 */
export const CLIPS = {
  idle: 'Idle_Loop',
  walk: 'Walk_Loop',
  run: 'Jog_Fwd_Loop',
  sprint: 'Sprint_Loop',
  jumpStart: 'Jump_Start',
  jumpLoop: 'Jump_Loop',
  jumpLand: 'Jump_Land',
  interact: 'Interact',
  // Reserved for Milestone B (vehicle entry/exit and driving).
  sitEnter: 'Sitting_Enter',
  sitIdle: 'Sitting_Idle_Loop',
  sitExit: 'Sitting_Exit',
  drive: 'Driving_Loop',
} as const;

/**
 * Ground speed each locomotion clip was authored at, in m/s. Playback rate is
 * scaled by actualSpeed / nominal so the feet keep pace with travel and foot
 * sliding is reduced (spec 12).
 *
 * These are estimates tuned by eye against the clips - they are not metadata
 * from the file, which contains only in-place animation.
 */
export const CLIP_NOMINAL_SPEED = {
  walk: 1.5,
  run: 3.6,
  sprint: 6.0,
};

/** Speed thresholds with hysteresis, so the animator does not flicker. */
export const LOCOMOTION_THRESHOLDS = {
  idleEnter: 0.18,
  idleExit: 0.32,
  runEnter: 2.5,
  runExit: 2.2,
  sprintEnter: 5.4,
  sprintExit: 5.0,
};

/** Crossfade durations, seconds. */
export const BLEND = {
  locomotion: 0.18,
  toJump: 0.08,
  toLand: 0.1,
  fromLand: 0.22,
};
