import { FIRST_DELIVERY, type Objective } from './mission';

/**
 * The PALM COAST campaign (spec 24).
 *
 * Missions are authored as DATA. Every objective has a real completion
 * condition checked against live simulation state - where you are, what you
 * are driving, whether the police have lost you - and nothing completes on a
 * timer alone.
 *
 * All characters, businesses and dialogue are original to PALM COAST.
 *
 * POSITIONS: every `driveTo` and `checkpoint` here sits on a ROAD JUNCTION
 * whose coordinates come straight from the road graph's own street table, so
 * they are guaranteed to be open carriageway. On-foot objectives are only
 * placed where the ground has been verified clear, which is why the later
 * missions are driving jobs rather than more parcels on pavements.
 */

export interface MissionDef {
  id: string;
  title: string;
  giver: string;
  reward: number;
  /** Missions that must be completed before this one is offered. */
  requires: string[];
  /** Where the job is handed out. */
  contact: { x: number; z: number };
  briefing: string[];
  outro: string[];
  objectives: Objective[];
  /** Whole-mission limit in seconds. Running out fails the mission. */
  timeLimit?: number;
  /** Applied the moment the mission becomes active. */
  onStart?: { wanted?: number; hour?: number };
}

/** Mara works out of the Sunfuel forecourt; every job starts there. */
const FORECOURT = { x: 126, z: -68 };

/**
 * Junctions used as destinations, named for the dialogue.
 * Taken from NS_ROADS x EW_ROADS in the road graph.
 */
const J = {
  calleAtPalm: { x: 85, z: 0 },
  harborAtDock: { x: 235, z: 130 },
  marinaAtCoral: { x: -105, z: -125 },
  westAtPalm: { x: -290, z: 0 },
  oceanAtNorth: { x: 355, z: 280 },
  oceanAtCoral: { x: 355, z: -125 },
  oceanAtPalm: { x: 355, z: 0 },
  oceanAtDock: { x: 355, z: 130 },
  oceanAtSunset: { x: 355, z: -270 },
  ridgeAtSouth: { x: -430, z: -400 },
};

const driveTo = (id: string, label: string, at: { x: number; z: number }, radius = 14): Objective => ({
  id,
  kind: 'driveTo',
  label,
  prompt: 'Stop here',
  x: at.x,
  z: at.z,
  radius,
  requires: 'vehicle',
  needsInteract: false,
  tone: 'dropoff',
});

const checkpoint = (id: string, label: string, at: { x: number; z: number }): Objective => ({
  id,
  kind: 'checkpoint',
  label,
  prompt: 'Through the marker',
  x: at.x,
  z: at.z,
  radius: 15,
  requires: 'vehicle',
  needsInteract: false,
  tone: 'pickup',
});

/** The opening job, kept exactly as authored. */
const OPENER: MissionDef = {
  id: FIRST_DELIVERY.id,
  title: FIRST_DELIVERY.title,
  giver: FIRST_DELIVERY.giver,
  reward: FIRST_DELIVERY.reward,
  requires: [],
  contact: FORECOURT,
  briefing: FIRST_DELIVERY.briefing,
  outro: FIRST_DELIVERY.outro,
  objectives: FIRST_DELIVERY.objectives,
};

/** A timed multi-drop run, set at night so the new lighting is part of it. */
const NIGHT_SHIFT: MissionDef = {
  id: 'night-shift',
  title: 'Night Shift',
  giver: 'Mara Vance',
  reward: 400,
  requires: [FIRST_DELIVERY.id],
  contact: FORECOURT,
  timeLimit: 260,
  onStart: { hour: 21.2 },
  briefing: [
    'Mara: Three parcels, three addresses, and the shops shut at midnight.',
    'Mara: Calle Verde first, then the docks, then Coral. Do not sightsee.',
    'Mara: Four hundred if all three land. Nothing if they do not.',
  ],
  outro: [
    'Mara: All three signed for. You are quicker than you look.',
    'Mara: Four hundred. Get some sleep.',
  ],
  objectives: [
    {
      id: 'ns-take-car',
      kind: 'enterVehicle',
      label: 'Get behind the wheel',
      prompt: 'Get in',
      x: 145,
      z: -26,
      radius: 8,
      requires: 'foot',
      needsInteract: false,
      tone: 'vehicle',
    },
    driveTo('ns-drop-1', 'Drop one: Calle Verde at Palm', J.calleAtPalm),
    driveTo('ns-drop-2', 'Drop two: Harbor at Dock', J.harborAtDock),
    driveTo('ns-drop-3', 'Drop three: Marina at Coral', J.marinaAtCoral),
  ],
};

/** Uses the takeover system: the job is the car, not the cargo. */
const HOT_PROPERTY: MissionDef = {
  id: 'hot-property',
  title: 'Hot Property',
  giver: 'Mara Vance',
  reward: 600,
  requires: ['night-shift'],
  contact: FORECOURT,
  briefing: [
    'Mara: A client left a vehicle in the Calle Verde lot and stopped paying for it.',
    'Mara: Take anything off that lot that is not yours and bring it to West at Palm.',
    'Mara: If a patrol sees you helping yourself, that is your problem.',
  ],
  outro: [
    'Mara: Repossessed. That is the word we are using.',
    'Mara: Six hundred, and I was never here.',
  ],
  objectives: [
    driveTo('hp-to-lot', 'Get to the Calle Verde parking lot', { x: 136, z: 60 }, 30),
    {
      id: 'hp-steal',
      kind: 'steal',
      label: 'Take a vehicle from the lot',
      prompt: 'Drive it',
      x: 136,
      z: 60,
      radius: 60,
      requires: 'vehicle',
      needsInteract: false,
      tone: 'vehicle',
      dialogue: ['That will do. Now get it off the lot.'],
    },
    driveTo('hp-deliver', 'Deliver it to West at Palm', J.westAtPalm),
  ],
};

/** A pursuit mission: it starts with the police already on you. */
const SHAKE_THEM: MissionDef = {
  id: 'shake-them',
  title: 'Shake Them',
  giver: 'Mara Vance',
  reward: 800,
  requires: ['hot-property'],
  contact: FORECOURT,
  onStart: { wanted: 3 },
  briefing: [
    'Mara: Someone matched that plate to you. There is a unit on the forecourt now.',
    'Mara: Lose them. Properly lose them, not around one block.',
    'Mara: When it is quiet, meet me out at Ridge and South.',
  ],
  outro: [
    'Mara: Quiet again. You drive better frightened.',
    'Mara: Eight hundred. Change the plates next time.',
  ],
  objectives: [
    {
      id: 'st-take-car',
      kind: 'enterVehicle',
      label: 'Get in and go',
      prompt: 'Get in',
      x: 145,
      z: -26,
      radius: 10,
      requires: 'foot',
      needsInteract: false,
      tone: 'vehicle',
    },
    {
      id: 'st-evade',
      kind: 'evade',
      label: 'Lose the police',
      prompt: '',
      x: 0,
      z: 0,
      radius: 0,
      requires: 'vehicle',
      needsInteract: false,
      tone: 'dropoff',
      dialogue: ['Mara: Nothing on the scanner. Go.'],
    },
    driveTo('st-meet', 'Meet Mara at Ridge and South', J.ridgeAtSouth),
  ],
};

/** A timed run the length of the coast road. */
const COAST_RUN: MissionDef = {
  id: 'coast-run',
  title: 'Coast Run',
  giver: 'Mara Vance',
  reward: 1100,
  requires: ['shake-them'],
  contact: FORECOURT,
  timeLimit: 165,
  onStart: { hour: 18.4 },
  briefing: [
    'Mara: A man at the marina bet me you cannot run Ocean Drive end to end before dark.',
    'Mara: Five markers, north to south, in one go.',
    'Mara: I have money on you. Do not embarrass me.',
  ],
  outro: [
    'Mara: He paid up without arguing, which means he expected to lose.',
    'Mara: Eleven hundred. Same time next week.',
  ],
  objectives: [
    {
      id: 'cr-take-car',
      kind: 'enterVehicle',
      label: 'Get in and get to Ocean Drive',
      prompt: 'Get in',
      x: 145,
      z: -26,
      radius: 10,
      requires: 'foot',
      needsInteract: false,
      tone: 'vehicle',
    },
    checkpoint('cr-1', 'Marker 1: Ocean at North', J.oceanAtNorth),
    checkpoint('cr-2', 'Marker 2: Ocean at Dock', J.oceanAtDock),
    checkpoint('cr-3', 'Marker 3: Ocean at Palm', J.oceanAtPalm),
    checkpoint('cr-4', 'Marker 4: Ocean at Coral', J.oceanAtCoral),
    checkpoint('cr-5', 'Marker 5: Ocean at Sunset', J.oceanAtSunset),
  ],
};

export const CAMPAIGN: MissionDef[] = [OPENER, NIGHT_SHIFT, HOT_PROPERTY, SHAKE_THEM, COAST_RUN];

export function missionById(id: string): MissionDef | null {
  return CAMPAIGN.find((m) => m.id === id) ?? null;
}

/** The next mission whose prerequisites are all met and which is not done. */
export function nextAvailable(completed: ReadonlySet<string>): MissionDef | null {
  return CAMPAIGN.find((m) => !completed.has(m.id) && m.requires.every((r) => completed.has(r))) ?? null;
}
