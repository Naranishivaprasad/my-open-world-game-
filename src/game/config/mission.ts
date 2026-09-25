/**
 * FIRST DELIVERY — the first complete gameplay loop (spec 24).
 *
 * The mission is authored as DATA: an ordered list of objectives, each with a
 * real completion condition the mission system checks against live simulation
 * state. Nothing here is cosmetic — every objective must actually be satisfied
 * by playing.
 *
 * All names, businesses and dialogue are original to PALM COAST.
 */

export type ObjectiveKind =
  | 'talk'
  | 'enterVehicle'
  | 'driveTo'
  /** Drive through at any speed, unlike `driveTo` which must be stopped at. */
  | 'checkpoint'
  /** Be driving a vehicle that was not yours when the objective was given. */
  | 'steal'
  /** Reach a clean wanted level after the police have been on you. */
  | 'evade'
  | 'collect'
  | 'deliver';

export interface Objective {
  id: string;
  kind: ObjectiveKind;
  /** Shown in the HUD objective line. */
  label: string;
  /** Prompt shown when the player is in range. */
  prompt: string;
  /** World position of the objective marker. */
  x: number;
  z: number;
  /** How close the player must be, metres. */
  radius: number;
  /** Must the player be on foot / in the car to complete it? */
  requires: 'foot' | 'vehicle' | 'any';
  /** Does completing it need an explicit key press (spec 14)? */
  needsInteract: boolean;
  /** Lines spoken on completion. Original dialogue. */
  dialogue?: string[];
  /** Marker colour hint. */
  tone?: 'contact' | 'pickup' | 'dropoff' | 'vehicle';
}

/**
 * Positions were chosen against the generated city and verified clear:
 *
 *  - the forecourt shop front is open ground south of the shop at z = -71.5
 *  - the service alley's east side has NO building frontage, so the loading
 *    bay at x = -13 sits on open ground beside the carriageway
 *  - the delivery sits in the open industrial yard west of Marina Road, whose
 *    block only has frontage on its east (x = -111.4, extending to about
 *    x = -140) and south (z = 10.8, extending to about z = 40) sides. The drop
 *    at (-150, 78) is clear of both, and clear of the water tower's legs,
 *    which span x = -173.5..-162.5 around its centre at (-168, 74).
 *
 * An earlier drop on the Dock Street pavement technically worked but landed in
 * a narrow gap between two industrial units, which read as being wedged in a
 * crevice rather than arriving somewhere. Putting it under the landmark makes
 * the destination legible from a distance.
 */
export const FIRST_DELIVERY: {
  id: string;
  title: string;
  giver: string;
  reward: number;
  objectives: Objective[];
  briefing: string[];
  outro: string[];
} = {
  id: 'first-delivery',
  title: 'First Delivery',
  giver: 'Mara Vance',
  reward: 250,

  briefing: [
    'Mara Vance: You the one Ruiz sent? Good, you can drive, allegedly.',
    'Mara: There is a crate sitting in the service alley behind Calderon Imports.',
    'Mara: Run it out to the yard under the water tower. Do not make it complicated.',
  ],

  outro: [
    'Mara: Crate arrived in one piece. That puts you ahead of the last three.',
    'Mara: Two fifty. Keep your phone on.',
  ],

  objectives: [
    {
      id: 'meet-mara',
      kind: 'talk',
      label: 'Meet Mara at the Sunfuel forecourt',
      prompt: 'Talk to Mara',
      x: 126,
      z: -68,
      radius: 3.2,
      requires: 'foot',
      needsInteract: true,
      tone: 'contact',
    },
    {
      id: 'take-the-car',
      kind: 'enterVehicle',
      label: 'Get in the car',
      prompt: 'Get in',
      x: 145,
      z: -26,
      radius: 6,
      requires: 'foot',
      needsInteract: false,
      tone: 'vehicle',
    },
    {
      id: 'drive-to-alley',
      kind: 'driveTo',
      label: 'Drive to the service alley behind Calderon Imports',
      prompt: 'Stop here',
      x: -18,
      z: 62,
      radius: 12,
      requires: 'vehicle',
      needsInteract: false,
      tone: 'pickup',
    },
    {
      id: 'collect-crate',
      kind: 'collect',
      label: 'Collect the crate',
      prompt: 'Pick up the crate',
      x: -13,
      z: 62,
      radius: 2.6,
      requires: 'foot',
      needsInteract: true,
      dialogue: ['Crate secured. It is heavier than it looks.'],
      tone: 'pickup',
    },
    {
      id: 'drive-to-yard',
      kind: 'driveTo',
      label: 'Drive the crate to the yard under the water tower',
      prompt: 'Stop here',
      x: -150,
      z: 84,
      radius: 13,
      requires: 'vehicle',
      needsInteract: false,
      tone: 'dropoff',
    },
    {
      id: 'deliver-crate',
      kind: 'deliver',
      label: 'Drop the crate at the yard gate',
      prompt: 'Drop the crate',
      x: -150,
      z: 78,
      radius: 2.8,
      requires: 'foot',
      needsInteract: true,
      tone: 'dropoff',
    },
  ],
};

export const MISSION_MARKER = {
  /** Radius of the ground cylinder, metres. */
  radius: 1.6,
  height: 7,
  /** Radius of a large "drive here" zone marker. */
  zoneRadiusScale: 0.85,
  colours: {
    contact: '#ffb347',
    pickup: '#57b97f',
    dropoff: '#5aa7ff',
    vehicle: '#ffb347',
  },
  /** Seconds per full pulse. */
  pulsePeriod: 1.8,
};

/** How long each briefing line stays on screen, seconds. */
export const DIALOGUE_LINE_TIME = 4.2;
