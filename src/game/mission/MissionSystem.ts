import { DIALOGUE_LINE_TIME, type Objective } from '../config/mission';
import { CAMPAIGN, nextAvailable, type MissionDef } from '../config/missions';
import { findRoute, type RoutePoint } from '../world/laneNetwork';
import { sim } from '../core/sim';

/**
 * Mission state machine for FIRST DELIVERY (spec 24).
 *
 *   available -> accepted -> active -> completed
 *                              |-> failed
 *                              |-> abandoned
 *
 * Every objective has a REAL completion condition checked against live
 * simulation state: where the player is, whether they are on foot or driving,
 * and whether they pressed the interact key. Nothing completes on a timer.
 *
 * Restarting clears carried state and re-arms every objective, and the reward
 * is guarded so it can only ever be paid once (spec 24).
 */

export type MissionState =
  | 'available'
  | 'accepted'
  | 'active'
  | 'completed'
  | 'failed'
  | 'abandoned';

export interface MissionSnapshot {
  state: MissionState;
  title: string;
  objectiveIndex: number;
  objectiveLabel: string | null;
  /** Straight-line distance to the current objective, metres. */
  distance: number;
  /** True when the player is inside the objective and only a key press remains. */
  inRange: boolean;
  promptKey: string | null;
  promptLabel: string | null;
  dialogue: string | null;
  carryingCrate: boolean;
  reward: number;
  paid: boolean;
  /** Seconds left on a timed mission, or null. */
  timeLeft: number | null;
  /** How many missions in the campaign are finished. */
  completedCount: number;
  totalCount: number;
}

export class MissionSystem {
  private state: MissionState = 'available';
  private index = 0;
  private def: MissionDef = CAMPAIGN[0]!;

  /** Missions finished this save. Drives which job is offered next. */
  readonly completed = new Set<string>();

  /** Seconds left on a timed mission, or null when it is untimed. */
  private timeLeft: number | null = null;
  /** True once the police have actually been on the player, for `evade`. */
  private wasWanted = false;
  /** Which vehicle the player was in when a `steal` objective was handed out. */
  private stealBaseline: string | null = null;

  private dialogueQueue: string[] = [];
  private dialogueTimer = 0;
  private currentLine: string | null = null;

  private carrying = false;
  private paid = false;

  /** Cached route to the current objective, recomputed as the player moves. */
  private route: RoutePoint[] | null = null;
  private routeAge = 0;
  private routeFromX = 0;
  private routeFromZ = 0;

  /** Set by the owner when the interact key is pressed this frame. */
  interactPressed = false;

  /**
   * Hooks the owner wires up, because the mission system must not reach into
   * the police or the vehicle systems directly.
   */
  onSetWanted: ((level: number) => void) | null = null;
  /** Raised when a mission is finished and paid, so progress can be saved. */
  onCompleted: ((id: string) => void) | null = null;

  // ------------------------------------------------------------------ api

  get currentState() {
    return this.state;
  }

  get objective(): Objective | null {
    if (this.state !== 'active' && this.state !== 'accepted') return null;
    return this.def.objectives[this.index] ?? null;
  }

  get currentRoute(): RoutePoint[] | null {
    return this.route;
  }

  /** The job currently on offer, or null once the campaign is finished. */
  get offered(): MissionDef | null {
    return nextAvailable(this.completed);
  }

  /** Begin the next available mission. Safe to call repeatedly. */
  start() {
    if (this.state === 'active' || this.state === 'accepted') return;
    const next = this.offered;
    if (!next) return;
    this.def = next;
    this.reset();
    this.state = 'active';
    this.applyOnStart();
  }

  /**
   * Whole-mission setup: a night job starts at night, a pursuit job starts
   * with the police already looking for you.
   */
  private applyOnStart() {
    this.timeLeft = this.def.timeLimit ?? null;
    this.wasWanted = false;
    this.stealBaseline = null;
    const s = this.def.onStart;
    if (!s) return;
    if (s.hour !== undefined) sim.time.hour = s.hour;
    if (s.wanted !== undefined) this.onSetWanted?.(s.wanted);
  }

  /**
   * Reset to a clean, restartable state (spec 24: restart behaviour, no stale
   * markers, no duplicate rewards).
   */
  reset() {
    this.state = 'available';
    this.index = 0;
    this.carrying = false;
    this.paid = false;
    this.dialogueQueue = [];
    this.currentLine = null;
    this.dialogueTimer = 0;
    this.route = null;
    this.interactPressed = false;
    this.timeLeft = this.def.timeLimit ?? null;
    this.wasWanted = false;
    this.stealBaseline = null;
  }

  abandon() {
    if (this.state !== 'active') return;
    this.state = 'abandoned';
    this.carrying = false;
    this.route = null;
    this.say(['Delivery abandoned. Mara will not be pleased.']);
  }

  fail(reason: string) {
    if (this.state !== 'active') return;
    this.state = 'failed';
    this.carrying = false;
    this.route = null;
    this.say([reason]);
  }

  /**
   * Jump straight to a named mission, marking everything before it done.
   *
   * For automated tests and for a developer checking a late job without
   * replaying the campaign. Not reachable from the game's own UI.
   */
  debugStart(id: string) {
    const def = CAMPAIGN.find((m) => m.id === id);
    if (!def) return;
    for (const m of CAMPAIGN) {
      if (m.id === id) break;
      this.completed.add(m.id);
    }
    this.def = def;
    this.reset();
    this.state = 'active';
    this.applyOnStart();
  }

  /** Force the remaining time, so the timeout path can be tested. */
  forceTimeLeft(seconds: number) {
    if (this.timeLeft !== null) this.timeLeft = seconds;
  }

  /** Restart from the beginning after a failure or abandonment. */
  restart() {
    this.reset();
    this.state = 'active';
    this.applyOnStart();
    this.say(this.def.briefing.slice(0, 1));
  }

  // --------------------------------------------------------------- update

  update(dt: number) {
    this.tickDialogue(dt);

    if (this.state === 'active') {
      // Getting busted fails the run (spec 24: failure behaviour).
      if (sim.police.state === 'busted') {
        this.fail('Busted. That is the job gone.');
      } else if (this.tickClock(dt)) {
        // tickClock failed the mission.
      } else {
        this.checkObjective();
        this.updateRoute(dt);
      }
    } else if (this.state === 'completed' || this.state === 'failed' || this.state === 'abandoned') {
      // Once the closing lines have played, the next job goes on offer and the
      // player picks it up from the contact, the way they picked up the first.
      if (!this.currentLine && this.dialogueQueue.length === 0 && this.offered) {
        this.state = 'available';
        this.index = 0;
      }
      this.route = null;
    } else if (this.state === 'available') {
      this.checkContact();
      this.updateRoute(dt);
    } else {
      this.route = null;
    }

    this.publish();
  }

  /** Run the mission clock. Returns true if it just ran out. */
  private tickClock(dt: number): boolean {
    if (this.timeLeft === null) return false;
    this.timeLeft -= dt;
    if (this.timeLeft > 0) return false;
    this.timeLeft = 0;
    this.fail('Out of time.');
    return true;
  }

  /**
   * While a job is on offer, the contact is the objective: go to Mara and
   * press interact. The campaign therefore has the same shape as the first
   * mission did, rather than each job starting by itself.
   */
  private checkContact() {
    const next = this.offered;
    if (!next) return;
    if (sim.controlMode !== 'foot') return;
    const p = sim.player.position;
    if (Math.hypot(p.x - next.contact.x, p.z - next.contact.z) > 3.4) return;
    if (!this.interactPressed) return;
    this.interactPressed = false;
    this.start();
  }

  private checkObjective() {
    const obj = this.objective;
    if (!obj) return;

    const onFoot = sim.controlMode === 'foot';
    const inVehicle = sim.controlMode === 'vehicle';

    // The player's position is the character's, except while driving, when the
    // car is what has to arrive.
    const px = inVehicle ? sim.vehicle.position.x : sim.player.position.x;
    const pz = inVehicle ? sim.vehicle.position.z : sim.player.position.z;
    const distance = Math.hypot(px - obj.x, pz - obj.z);

    /*
     * "Get in the car" is checked BEFORE the on-foot requirement.
     *
     * The objective is authored as requires:'foot' because that is the state
     * you are in when it is handed to you — but it completes precisely when
     * that stops being true. Checking the requirement first made the objective
     * unsatisfiable: on foot it had not happened yet, and in the car the guard
     * rejected it.
     */
    if (obj.kind === 'enterVehicle') {
      if (inVehicle) this.advance(obj);
      return;
    }

    /*
     * "Lose the police" is about the wanted level, not about being anywhere.
     *
     * It only completes once the police have ACTUALLY been on the player:
     * otherwise the objective would be satisfied the instant it was handed
     * out, before a single unit had been dispatched.
     */
    if (obj.kind === 'evade') {
      if (sim.police.wanted > 0) this.wasWanted = true;
      if (this.wasWanted && sim.police.wanted === 0 && sim.police.state === 'unaware') {
        this.advance(obj);
      }
      return;
    }

    /*
     * "Take a vehicle" means a vehicle that was not the one you arrived in.
     *
     * The baseline is recorded the first time the objective is looked at, so
     * driving the car you already had does not count.
     */
    if (obj.kind === 'steal') {
      if (this.stealBaseline === null) this.stealBaseline = inVehicle ? sim.vehicle.kind : '';
      const inLot = distance <= obj.radius;
      if (inVehicle && inLot && sim.vehicle.kind !== this.stealBaseline) this.advance(obj);
      return;
    }

    // --- state requirement ---
    if (obj.requires === 'foot' && !onFoot) return;
    if (obj.requires === 'vehicle' && !inVehicle) return;

    if (distance > obj.radius) return;

    // --- an explicit key press, where the brief asks for one ---
    if (obj.needsInteract) {
      if (!this.interactPressed) return;
      this.interactPressed = false;
    }

    // A "drive to" zone must be reached at a sane speed, not blasted through.
    // A checkpoint is the opposite: it is meant to be driven through.
    if (obj.kind === 'driveTo' && Math.abs(sim.vehicle.forwardSpeed) > 9) return;

    if (obj.kind === 'collect') this.carrying = true;
    if (obj.kind === 'deliver') this.carrying = false;

    this.advance(obj);
  }

  private advance(obj: Objective) {
    if (obj.dialogue) this.say(obj.dialogue);
    // The first objective of any mission is where its briefing is delivered.
    if (this.index === 0) this.say(this.def.briefing);

    this.index++;
    this.route = null;

    if (this.index >= this.def.objectives.length) {
      this.state = 'completed';
      this.timeLeft = null;
      // The reward can only ever be paid once, however the mission is replayed.
      if (!this.paid) {
        this.paid = true;
        sim.money += this.def.reward;
        this.completed.add(this.def.id);
        this.onCompleted?.(this.def.id);
      }
      this.say(this.def.outro);
    }
  }

  // ---------------------------------------------------------------- route

  /**
   * Recompute the road route to the objective, but only occasionally and only
   * when the player has actually moved — A* every frame would be wasteful.
   */
  private updateRoute(dt: number) {
    let destX = 0;
    let destZ = 0;
    
    if (this.state === 'available' && this.offered) {
      destX = this.offered.contact.x;
      destZ = this.offered.contact.z;
    } else {
      const obj = this.objective;
      // An objective with no radius is not a place - "lose the police" has
      // nowhere to route to.
      if (!obj || obj.radius <= 0) {
        this.route = null;
        return;
      }
      destX = obj.x;
      destZ = obj.z;
    }

    this.routeAge += dt;
    const inVehicle = sim.controlMode === 'vehicle';
    const px = inVehicle ? sim.vehicle.position.x : sim.player.position.x;
    const pz = inVehicle ? sim.vehicle.position.z : sim.player.position.z;
    const moved = Math.hypot(px - this.routeFromX, pz - this.routeFromZ);

    if (this.route && this.routeAge < 1.2 && moved < 18) return;

    this.routeAge = 0;
    this.routeFromX = px;
    this.routeFromZ = pz;
    this.route = findRoute(px, pz, destX, destZ);
  }

  // ------------------------------------------------------------- dialogue

  private say(lines: string[]) {
    this.dialogueQueue.push(...lines);
    if (!this.currentLine) this.nextLine();
  }

  private nextLine() {
    this.currentLine = this.dialogueQueue.shift() ?? null;
    this.dialogueTimer = this.currentLine ? DIALOGUE_LINE_TIME : 0;
  }

  private tickDialogue(dt: number) {
    if (!this.currentLine) return;
    this.dialogueTimer -= dt;
    if (this.dialogueTimer <= 0) this.nextLine();
  }

  /** Skip the rest of the current dialogue (spec 24: cutscenes are skippable). */
  skipDialogue() {
    this.dialogueQueue = [];
    this.currentLine = null;
    this.dialogueTimer = 0;
  }

  // -------------------------------------------------------------- publish

  private publish() {
    // While a job is on offer, the contact stands in for the objective so the
    // HUD, the minimap and the map all point at where to go next.
    if (this.state === 'available' && this.offered) {
      const next = this.offered;
      const p = sim.player.position;
      const d = Math.hypot(p.x - next.contact.x, p.z - next.contact.z);
      const near = d <= 3.4 && sim.controlMode === 'foot';
      const m = sim.mission;
      m.state = this.state;
      m.title = next.title;
      m.objectiveIndex = 0;
      m.objectiveLabel = `New job: meet ${next.giver}`;
      m.distance = d;
      m.inRange = near;
      m.promptKey = near ? 'E' : null;
      m.promptLabel = near ? `Start ${next.title}` : null;
      m.dialogue = this.currentLine;
      m.carryingCrate = false;
      m.reward = next.reward;
      m.paid = false;
      m.timeLeft = null;
      m.completedCount = this.completed.size;
      m.totalCount = CAMPAIGN.length;
      m.route = this.route;
      return;
    }

    const obj = this.objective;
    const inVehicle = sim.controlMode === 'vehicle';
    const px = inVehicle ? sim.vehicle.position.x : sim.player.position.x;
    const pz = inVehicle ? sim.vehicle.position.z : sim.player.position.z;
    const distance = obj ? Math.hypot(px - obj.x, pz - obj.z) : 0;

    const stateOk =
      !!obj &&
      (obj.requires === 'any' ||
        (obj.requires === 'foot' && !inVehicle) ||
        (obj.requires === 'vehicle' && inVehicle));
    const inRange = !!obj && stateOk && distance <= obj.radius;

    const m = sim.mission;
    m.state = this.state;
    m.title = this.def.title;
    m.objectiveIndex = this.index;
    m.objectiveLabel = obj ? obj.label : null;
    m.distance = distance;
    m.inRange = inRange;
    m.promptKey = inRange && obj?.needsInteract ? 'E' : null;
    m.promptLabel = inRange && obj?.needsInteract ? obj.prompt : null;
    m.dialogue = this.currentLine;
    m.carryingCrate = this.carrying;
    m.reward = this.def.reward;
    m.timeLeft = this.timeLeft;
    m.completedCount = this.completed.size;
    m.totalCount = CAMPAIGN.length;
    m.paid = this.paid;
    m.route = this.route;
  }
}
