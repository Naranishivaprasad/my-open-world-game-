/**
 * Hero vehicle configuration (spec 15).
 *
 * Every tuning constant for the car lives here. Nothing in the controller,
 * the renderer or the camera may invent its own magic number.
 *
 * COORDINATE CONVENTION
 * The source GLB is authored with the car facing +Z. Our world convention is
 * forward = -Z (matching the character and the camera), so the model is rotated
 * PI about Y at load. Every figure below is therefore in BODY space:
 *
 *     forward = -Z     up = +Y     right = +X
 *
 * Wheel positions were measured by parsing the GLB, not estimated:
 *   wheelbase 2.800 m, track 1.952 m, hub height 0.384 m.
 */

export const VEHICLE_MODEL = {
  url: '/models/vendor/hero_car.glb',
  /** Model faces +Z; rotate it to face -Z. */
  yawOffset: Math.PI,
  scale: 1,

  /**
   * The CC-BY licence for this asset explicitly EXCLUDES logos and trademarks,
   * so these nodes are hidden at load. Names verified by parsing the GLB.
   */
  hiddenNodes: [],
  hiddenMaterials: [],

  /** Node names for the four wheel pivots, verified present in the GLB. */
  wheelNodes: ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'] as const,

  /** Node name prefixes used to find light meshes for emissive control. */
  lightNodes: {
    head: ['lights'],
    tail: ['lights_red'],
    // The model has no separate reverse lamp; the tail cluster is brightened.
    turn: [],
  },

  /** The steering wheel rim, rotated with steering input (spec 18). */
  /**
   * The parts that turn with the wheel.
   *
   * `InteriorSteeringBase` and `InteriorSteeringDashColumn` are deliberately
   * NOT here: they are the column below the wheel, centred about half a metre
   * from the rim, so spinning them swung them out through the bodywork.
   */
  steeringWheelNodes: [
    'steering_wheel',
    'steering_carbon',
    'steering_centre',
    'steering_leather',
    'steering_metal',
    'steering_red_lights',
    'steering_trim'
  ],
  /** Local pivot the steering wheel turns about, in body space. */
  /**
   * NOTE: there is deliberately no hand-authored pivot position any more. The
   * rim's centre and its axis are measured from the loaded geometry, because
   * a typed-in guess put the axis nowhere near the rim and full lock threw the
   * wheel out through the side of the car.
   */
  /** Steering wheel rotates this many turns lock-to-lock. */
  steeringWheelTurns: 1.1,
};

// ------------------------------------------------------------------ chassis

export const CHASSIS = {
  /** Kerb mass, kg. */
  mass: 1480,
  /**
   * Centre of gravity, body space. Deliberately low and slightly rearward:
   * raising it makes the car trip over itself under cornering load (spec 16).
   */
  centreOfMass: { x: 0, y: 0.42, z: 0.12 },
  /** Principal angular inertia. Roll (x) is kept high to resist flipping. */
  principalInertia: { x: 900, y: 1650, z: 420 },

  /** Simplified collision box, body space. Half extents. */
  collider: {
    hx: 0.95,
    hy: 0.45,
    hz: 2.2,
    /** Centre height so the box clears the ground at full suspension droop. */
    cy: 0.74,
  },

  friction: 0.45,
  restitution: 0.1,
  linearDamping: 0.06,
  /** Angular damping keeps the body from oscillating after a kerb strike. */
  angularDamping: 0.65,
};

// ------------------------------------------------------------------- wheels

export const WHEEL = {
  radius: 0.384,
  /** Suspension travel above the hub at rest. */
  suspensionRestLength: 0.26,
  maxSuspensionTravel: 0.22,
  suspensionStiffness: 62,
  /** Damping on compression and rebound. Rebound is softer than compression. */
  suspensionCompression: 2.3,
  suspensionRelaxation: 1.8,
  maxSuspensionForce: 65000,

  /** Longitudinal grip. Higher = less wheelspin and shorter stops. */
  frictionSlip: 2.6,
  /** Lateral grip. Lower on the rear gives mild, controllable oversteer. */
  sideFrictionStiffnessFront: 1.0,
  sideFrictionStiffnessRear: 0.82,
};

/**
 * Wheel suspension attachment points in body space.
 *
 * These are the measured hub positions raised by the suspension rest length,
 * because the connection point is the TOP of suspension travel and the hub
 * hangs `suspensionRestLength` below it.
 */
const HUB_Y = 0.384;
const CONNECT_Y = HUB_Y + WHEEL.suspensionRestLength;
const HALF_TRACK = 0.976;
const FRONT_Z = -1.485;
const REAR_Z = 1.314;

export interface WheelConfig {
  name: string;
  connection: { x: number; y: number; z: number };
  steered: boolean;
  driven: boolean;
  /** Handbrake acts on the rear axle only. */
  handbraked: boolean;
  sideFrictionStiffness: number;
  /** Fraction of total brake force this wheel takes (front bias). */
  brakeBias: number;
}

/** Order matters: it is the index order handed to Rapier's addWheel(). */
export const WHEELS: WheelConfig[] = [
  {
    name: 'WheelFrontL',
    connection: { x: -HALF_TRACK, y: CONNECT_Y, z: FRONT_Z },
    steered: true,
    driven: false,
    handbraked: false,
    sideFrictionStiffness: WHEEL.sideFrictionStiffnessFront,
    brakeBias: 0.32,
  },
  {
    name: 'WheelFrontR',
    connection: { x: HALF_TRACK, y: CONNECT_Y, z: FRONT_Z },
    steered: true,
    driven: false,
    handbraked: false,
    sideFrictionStiffness: WHEEL.sideFrictionStiffnessFront,
    brakeBias: 0.32,
  },
  {
    name: 'WheelRearL',
    connection: { x: -HALF_TRACK, y: CONNECT_Y, z: REAR_Z },
    steered: false,
    driven: true,
    handbraked: true,
    sideFrictionStiffness: WHEEL.sideFrictionStiffnessRear,
    brakeBias: 0.18,
  },
  {
    name: 'WheelRearR',
    connection: { x: HALF_TRACK, y: CONNECT_Y, z: REAR_Z },
    steered: false,
    driven: true,
    handbraked: true,
    sideFrictionStiffness: WHEEL.sideFrictionStiffnessRear,
    brakeBias: 0.18,
  },
];

/**
 * Suspension direction and axle direction, body space.
 *
 * IMPORTANT: Rapier derives the wheel's rolling direction as
 * `axle x direction`, NOT `direction x axle`. With axle = (-1,0,0) that yields
 * +Z, which drove the car backwards under positive engine force. Verified in
 * the browser: axle = (+1,0,0) gives (+1,0,0) x (0,-1,0) = (0,0,-1), which is
 * our forward.
 */
export const WHEEL_AXES = {
  /** Suspension pushes the wheel downward. */
  direction: { x: 0, y: -1, z: 0 },
  /** Axle runs across the car. */
  axle: { x: 1, y: 0, z: 0 },
};

// ---------------------------------------------------------------- powertrain

export const DRIVETRAIN = {
  /** Rear-wheel drive; engine force is split across the driven wheels. */
  layout: 'rwd' as const,

  /** Peak force per driven wheel, newtons. */
  engineForce: 7400,
  /** Reverse is deliberately weaker than first gear. */
  reverseForce: 3200,

  /**
   * Brake strength, split across wheels by `brakeBias`.
   *
   * NOTE: Rapier's setWheelBrake() value is NOT newtons. Measured in-browser:
   * a value of 600 stopped a 1480 kg car at ~27 m/s^2, i.e. roughly
   * 0.045 m/s^2 per unit. These numbers are calibrated against that, targeting
   * ~10 m/s^2 on the service brake.
   */
  brakeForce: 230,
  /** Handbrake value applied PER REAR WHEEL, locking the rear axle. */
  handbrakeForce: 60,

  /**
   * Engine braking when the throttle is released. Deliberately tiny: lifting
   * off must NOT stop the car dead (spec 16). ~0.5 m/s^2.
   */
  engineBrake: 12,

  /** Target top speed, m/s (~176 km/h). Engine force tapers toward it. */
  topSpeed: 49,
  /** Reverse top speed, m/s. */
  reverseTopSpeed: 12,

  /**
   * Below this speed a reverse input while rolling forward counts as braking,
   * not as engaging reverse (spec 16).
   */
  reverseEngageSpeed: 1.2,
};

// ------------------------------------------------------------------ steering

export const STEERING = {
  /** Maximum road-wheel angle at a standstill, radians (~33 degrees). */
  maxAngleLowSpeed: 0.58,
  /** Maximum road-wheel angle at or above `fullSpeed`, radians (~7 degrees). */
  maxAngleHighSpeed: 0.125,
  /** Speed at which steering authority has fully reduced, m/s. */
  fullSpeed: 38,

  /** How fast the road wheels turn toward the requested angle, rad/s. */
  rate: 3.4,
  /** How fast they return to centre when input is released, rad/s. */
  returnRate: 5.0,
};

// -------------------------------------------------------------- interaction

/**
 * Anchors used by the enter/exit sequence and the cameras (spec 15, 17, 18).
 * All in body space.
 */
/**
 * Measured from the GLB, not estimated. This model is a CENTRE-DRIVE concept
 * car: InteriorSteeringWheel01 sits at body (0.00, 0.654, -0.934) and the seat
 * cluster at (0, 0.588, +0.132), so the driver sits on the centreline. Earlier
 * left-hand-drive anchors put the camera behind and beside the seats.
 */
export const ANCHORS = {
  /** Where the character stands to open the door. Mirrors sit at x = +/-1.045. */
  driverDoor: { x: -1.5, y: 0, z: -0.15 },
  /** Opposite side, used when the near side is blocked (spec 17). */
  passengerDoor: { x: 1.5, y: 0, z: -0.15 },
  /**
   * Character root (feet) when seated.
   *
   * The Quaternius Sitting_/Driving_ clips keep the root at floor level and
   * raise the body, so the root must sit BELOW the car's origin for the head
   * to clear the roofline. At y = 0.18 the driver sat up through the roof.
   *
   * MEASURED in-browser: at y = -0.14 the top of the head sat at 0.836 while
   * the car's roof was at 0.765, so 7 cm of head was outside the car. Dropped
   * 10 cm to tuck it under with a little clearance.
   */
  driverSeat: { x: 0, y: -0.24, z: 0.12 },
  /**
   * Driver eye: on the centreline, behind and above the wheel, below the
   * windscreen top (windscreen centre is body (0, 0.971, -0.874)).
   */
  driverEye: { x: 0, y: 0.96, z: -0.3 },
};

/** Third-person chase camera framing (spec 18). */
export const CHASE_CAMERA = {
  /** Boom length behind the car at rest, metres. */
  distance: 7.4,
  /** Height above the car's origin the camera orbits. */
  height: 2.25,
  /** Point ahead of the car the camera looks at, so the road stays readable. */
  lookAhead: 4.5,
  /** Extra boom length at top speed, communicating speed without lurching. */
  speedStretch: 1.6,
  /** Extra FOV at top speed, degrees. */
  speedFov: 9,
  /** Damping rates: higher follows more tightly. */
  positionDamping: 5.2,
  /** Rate the camera drifts back behind the car after free look, rad/s. */
  recentreRate: 2.6,
  /** Seconds of no meaningful mouse input before recentring speeds up. */
  recentreDelay: 0.55,
  /**
   * Mouse delta (radians/frame) below which input is treated as hand jitter,
   * not as a deliberate look. Without this, a resting hand kept the camera
   * from ever recentring.
   */
  freeLookDeadzone: 0.0012,
  /**
   * Hard limit on how far free look may swing off the car's tail, radians
   * (~100 degrees). The camera must never reach the front of the car: from
   * there the world is mirrored and steering reads as inverted even though
   * the car turns correctly.
   */
  maxYawOffset: 1.75,
};

// ----------------------------------------------------------------- recovery

export const RECOVERY = {
  /** Body is considered overturned past this roll/pitch, radians. */
  overturnedAngle: 1.05,
  /** Must stay overturned this long before recovery is offered. */
  overturnedHold: 1.5,
  /** Height the car is lifted to when recovered. */
  liftHeight: 0.6,
};

// -------------------------------------------------------------------- audio

export const VEHICLE_AUDIO = {
  /** Idle and redline frequencies for the synthesised engine, Hz. */
  idleHz: 46,
  redlineHz: 210,
  /** Speed at which the engine note reaches redline, m/s. */
  redlineSpeed: 42,
  /** Simulated gear count, used to make the note step rather than glide. */
  gears: 5,
};

// --------------------------------------------------------------- vehicle builds

/**
 * Everything the physics controller needs that varies from vehicle to vehicle
 * (spec 16).
 *
 * Suspension, steering geometry and recovery stay global: they are handling
 * character shared by every car in the game. What changes per vehicle is its
 * mass distribution, its footprint, where its wheels are, and how hard it
 * pulls.
 */
export interface VehicleBuild {
  chassis: typeof CHASSIS;
  wheels: WheelConfig[];
  wheelRadius: number;
  drivetrain: typeof DRIVETRAIN;
  /** Where the driver stands, sits and looks from. Scales with the body. */
  anchors: typeof ANCHORS;
  /**
   * Radius of the probe that proves there is room to get in, metres.
   *
   * A car needs a door's worth of space. You step over a motorcycle, so it
   * needs barely any - which matters, because bikes park close together.
   */
  doorClearance: number;
}

/** The hand-tuned hero car, measured from its GLB. */
export const HERO_BUILD: VehicleBuild = {
  chassis: CHASSIS,
  wheels: WHEELS,
  wheelRadius: WHEEL.radius,
  drivetrain: DRIVETRAIN,
  anchors: ANCHORS,
  doorClearance: 0.34,
};

/** The subset of a body class this module needs; see world/vehicleGeometry. */
export interface BuildSpecInput {
  length: number;
  width: number;
  height: number;
  mass: number;
  engineForce: number;
  topSpeedKph: number;
  wheelbase: number;
  track: number;
  wheelRadius: number;
}

/**
 * Derive a physics build from a body class.
 *
 * The figures are SCALED FROM THE HERO CAR rather than invented independently,
 * so every vehicle inherits handling that is already known to work and differs
 * only in the ways its shape and mass should make it differ: a van rolls more
 * lazily than a coupe because its inertia and centre of gravity say so, not
 * because someone typed a different damping number.
 *
 * NOTE the frame change. Body classes in world/vehicleGeometry are authored
 * with forward = +X; the physics chassis uses forward = -Z. Wheelbase therefore
 * maps onto Z here and track onto X.
 */
export function buildFromSpec(spec: BuildSpecInput): VehicleBuild {
  const massRatio = spec.mass / CHASSIS.mass;
  const widthRatio = spec.width / 1.9;
  const lengthRatio = spec.length / 4.5;
  const heightRatio = spec.height / 1.5;

  const connectY = spec.wheelRadius + WHEEL.suspensionRestLength;

  /**
   * Two-wheelers get a narrow VIRTUAL track.
   *
   * Rapier's raycast vehicle has no notion of balance: it holds the chassis up
   * on its wheel rays alone. Give a motorcycle its real track of zero and all
   * four rays land on one line, the chassis has nothing to stand on sideways,
   * and it neither grounds nor moves. A 0.44 m virtual track keeps it upright
   * and rideable. The cost is that it does not lean into corners - a proper
   * lean model is a separate piece of work (spec 38), and this is an arcade
   * approximation, not motorcycle dynamics.
   */
  const halfTrack = spec.track > 0.4 ? spec.track / 2 : 0.22;
  const frontZ = -spec.wheelbase / 2;
  const rearZ = spec.wheelbase / 2;

  // Body box: full width and length, but only the lower half of the height, so
  // the collider never scrapes at full suspension droop.
  const hy = Math.max(0.34, (spec.height - spec.wheelRadius) * 0.34);
  const chassis: typeof CHASSIS = {
    ...CHASSIS,
    mass: spec.mass,
    centreOfMass: { x: 0, y: spec.wheelRadius * 1.05, z: CHASSIS.centreOfMass.z * lengthRatio },
    principalInertia: {
      // Roll resistance tracks how tall and wide the body is - this is what
      // keeps a van from tipping into a corner it should merely lean through.
      x: CHASSIS.principalInertia.x * massRatio * widthRatio * heightRatio,
      y: CHASSIS.principalInertia.y * massRatio * lengthRatio * lengthRatio,
      z: CHASSIS.principalInertia.z * massRatio * lengthRatio * heightRatio,
    },
    collider: {
      hx: spec.width / 2,
      hy,
      hz: spec.length / 2,
      cy: spec.wheelRadius * 0.85 + hy,
    },
  };

  const wheels: WheelConfig[] = WHEELS.map((w) => ({
    ...w,
    connection: {
      x: Math.sign(w.connection.x) * halfTrack,
      y: connectY,
      z: w.connection.z < 0 ? frontZ : rearZ,
    },
  }));

  // Rapier's brake value is not newtons (see DRIVETRAIN), so to hold a similar
  // deceleration across a 1150 kg hatchback and a 2320 kg van it has to scale
  // with mass.
  const drivetrain: typeof DRIVETRAIN = {
    ...DRIVETRAIN,
    engineForce: spec.engineForce,
    reverseForce: spec.engineForce * 0.43,
    topSpeed: spec.topSpeedKph / 3.6,
    brakeForce: DRIVETRAIN.brakeForce * massRatio,
    handbrakeForce: DRIVETRAIN.handbrakeForce * massRatio,
    engineBrake: DRIVETRAIN.engineBrake * massRatio,
  };

  // Door and seat anchors scale with the body, or the driver of a van stands
  // inside its flank and the driver of a coupe hovers above its roof.
  const twoWheeled = spec.track <= 0.4;
  const reach = twoWheeled ? 0.45 : 0.55;
  const anchors: typeof ANCHORS = {
    driverDoor: { x: -(spec.width / 2 + reach), y: 0, z: -0.15 },
    passengerDoor: { x: spec.width / 2 + reach, y: 0, z: -0.15 },
    driverSeat: { x: 0, y: ANCHORS.driverSeat.y, z: 0.12 },
    driverEye: { x: 0, y: spec.height * 0.62, z: -0.3 },
  };

  return {
    chassis,
    wheels,
    wheelRadius: spec.wheelRadius,
    drivetrain,
    anchors,
    doorClearance: twoWheeled ? 0.16 : 0.26,
  };
}
