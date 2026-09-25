/**
 * Traffic and pedestrian tuning (spec 21, 22).
 *
 * Population counts come from the quality preset; everything about how agents
 * behave lives here.
 */

export const TRAFFIC = {
  /** Body dimensions, matching the parked-car geometry. */
  length: 4.6,
  width: 1.9,
  height: 1.5,
  mass: 1300,

  /** Longitudinal response, m/s^2. */
  accel: 3.4,
  brake: 7.5,
  /** Emergency braking when something is suddenly close. */
  hardBrake: 14,

  /** Fraction of the lane limit an ordinary driver actually drives at. */
  speedFactorMin: 0.78,
  speedFactorMax: 1.04,

  /** Gap kept to whatever is ahead, metres, plus a per-speed term. */
  minGap: 6.5,
  /** Seconds of headway added on top of minGap. */
  headway: 1.15,
  /** How far ahead an agent looks for obstacles. */
  lookahead: 34,

  /** Slow to this fraction of the limit while crossing a junction. */
  junctionSpeedFactor: 0.55,
  /** Distance before a junction at which an agent starts checking it. */
  junctionApproach: 16,
  /** A junction is considered occupied within this radius of its centre. */
  junctionRadius: 11,

  /** How quickly an agent turns to face its lane, rad/s. */
  turnRate: 2.6,

  /** Spawn at least this far from the player, and never closer. */
  spawnMinDistance: 72,
  spawnMaxDistance: 190,
  /** Never spawn inside this cone directly ahead of a moving player. */
  spawnAheadConeDot: 0.65,
  /** Remove agents beyond this distance so the population stays local. */
  despawnDistance: 240,
  /** Seconds between spawn attempts. */
  spawnInterval: 0.8,

  /**
   * If an agent's body drifts this far from where its lane says it should be,
   * it has been hit. Steering stops so it reacts like an object rather than
   * snapping back onto the lane (spec 21: react to player collisions).
   */
  knockedDistance: 1.9,
  /** Seconds an agent stays uncontrolled after being knocked. */
  knockedRecovery: 4.5,
} as const;

export const PEDESTRIAN = {
  /** Walking speed range, m/s. */
  speedMin: 1.05,
  speedMax: 1.7,
  /** Radius used for avoidance between pedestrians. */
  radius: 0.4,
  /** How strongly a pedestrian steers around others, m/s^2. */
  avoidStrength: 5.5,
  /** How far ahead a pedestrian looks for others. */
  avoidRange: 3.2,
  turnRate: 7,

  /** Chance of pausing at a waypoint rather than walking straight on. */
  idleChance: 0.28,
  idleMin: 1.5,
  idleMax: 5,

  /** Distance at which an approaching vehicle makes a pedestrian stop. */
  vehicleAlarmRange: 9,
  /** Vehicle speed above which pedestrians treat it as dangerous, m/s. */
  vehicleAlarmSpeed: 3,

  spawnMinDistance: 22,
  spawnMaxDistance: 95,
  despawnDistance: 130,
  spawnInterval: 0.6,

  /**
   * Distant pedestrians get their decisions updated less often (spec 22:
   * bounded perception ranges and update frequencies).
   */
  nearUpdateDistance: 45,
  farUpdateInterval: 0.25,
} as const;
