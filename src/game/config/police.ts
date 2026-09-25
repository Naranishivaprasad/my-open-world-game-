/**
 * Police and wanted system (spec 23).
 *
 * The brief asks for a real state machine with detection that depends on line
 * of sight, a last-known position, a search phase and an escape that depends on
 * gameplay conditions. All of the thresholds that decide those live here.
 */

export const POLICE = {
  /** Maximum wanted level implemented. Higher tiers are a later milestone. */
  maxWanted: 3,

  // ------------------------------------------------------------- detection

  /** An officer can see this far in good conditions, metres. */
  sightRange: 62,
  /** Field of view for an officer's sight cone, radians (about 120 degrees). */
  sightFov: 2.1,
  /** A witness on foot needs to be closer than this to report something. */
  witnessRange: 28,
  /** How long an officer must hold line of sight before the pursuit updates. */
  sightConfirmTime: 0.15,

  // ---------------------------------------------------------------- timing

  /** Seconds without line of sight before a pursuit degrades to a search. */
  loseSightTime: 6,
  /**
   * Seconds units may spend merely RESPONDING to a report before the alert
   * lapses into a search.
   *
   * Without this the machine had a hole: if no officer ever acquired line of
   * sight, `responding` had no exit at all and the wanted level could never
   * clear, so a report with no contact hunted the player indefinitely.
   */
  respondTimeout: 26,
  /** Seconds spent searching the last known area before giving up. */
  searchTime: 22,
  /** Seconds of cooldown before the wanted level actually clears. */
  cooldownTime: 7,
  /** Radius units wander within while searching around the last known point. */
  searchRadius: 34,

  // -------------------------------------------------------------- response

  /** Units dispatched per wanted level (index 0 unused). */
  unitsPerLevel: [0, 1, 2, 3],
  /**
   * Units approach from at least this far away, so none appears in your face.
   *
   * Tuned DOWN for the expanded map: the original 95-175 m band was set when
   * the world was a quarter of its current size, and on the larger, sparser
   * road graph it put responders so far out that a report took the best part
   * of a minute to answer.
   */
  spawnMinDistance: 55,
  spawnMaxDistance: 105,
  /** Seconds between dispatches, so a level-3 response arrives in waves. */
  dispatchInterval: 3.5,

  /** Chase speed multiplier over the road's limit. */
  pursuitSpeedFactor: 1.7,
  /** Speed multiplier while merely responding to a report. */
  respondSpeedFactor: 1.45,
  /** Speed multiplier while searching. */
  searchSpeedFactor: 0.85,

  /** Units this close to the player on foot can make an arrest. */
  arrestRange: 3.2,
  /** The player must be this slow to be arrested. */
  arrestSpeed: 1.6,
  /** Seconds a unit must stay within arrest range before the bust lands. */
  arrestHold: 1.6,

  // ------------------------------------------------------------- offences

  /** Wanted level granted by each offence, if it is witnessed. */
  offence: {
    hitPedestrian: 2,
    ramVehicle: 1,
    hitPolice: 3,
  },

  /** Seconds after an offence during which repeats do not re-escalate. */
  escalationCooldown: 4,
} as const;

/** Police livery: white body, dark panels, blue-and-red bar. */
export const POLICE_LIVERY = {
  body: '#e8e9ea',
  lightbarBlue: '#2a5cff',
  lightbarRed: '#ff2a2a',
  /** Flashes per second. */
  flashHz: 3.2,
};
