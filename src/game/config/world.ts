/**
 * World tunables for PALM COAST. One world unit = one metre (spec 7).
 *
 * Every dimension here is a real-world measurement so that scale reads
 * correctly: a 3.6 m lane, a 0.15 m kerb, a 2.1 m door, a 3.2 m storey.
 */

export const METRE = 1;

// ------------------------------------------------------------------ road shape

export const LANE_WIDTH = 3.6;
export const SIDEWALK_WIDTH_MAIN = 3.6;
export const SIDEWALK_WIDTH_SIDE = 2.8;
/** Kerb face height. Autostep on the character controller must exceed this. */
export const KERB_HEIGHT = 0.15;
/** Road surface sits fractionally below the kerb top; sidewalk top = KERB_HEIGHT. */
export const ROAD_Y = 0.0;
export const SIDEWALK_Y = KERB_HEIGHT;

/** Lane markings are drawn on decal meshes lifted slightly to avoid z-fighting. */
export const MARKING_Y = ROAD_Y + 0.012;

// ------------------------------------------------------------- world extents

/**
 * Playable footprint: roughly 1030 m x 1030 m.
 *
 * Five times the area of the original 460 m district. The eastern edge is the
 * coast rather than a fence: Ocean Drive at x = 355, then the beach, then the
 * sea.
 */
export const WORLD_HALF = 515;

/**
 * East edge of the LAND. The grass plane and its collider stop here; from here
 * out, the beach's own sloping surface is what you stand on.
 *
 * The beach used to slope down BELOW a grass plane that covered the whole
 * world, so the sand and the sea were both buried and you walked on grass out
 * over the water.
 */
export const PROMENADE_X = 366;

/** Everything east of here is beach, then sea. */
export const SHORE_X = 378;
export const SEA_X = 408;
/** Sea surface height. Slightly below the kerb so the beach can slope into it. */
export const SEA_LEVEL = -0.9;

/**
 * The beach profile, shared by the geometry that builds it and the water
 * shader that has to know where the sand is underneath it.
 *
 * It passes THROUGH sea level rather than stopping above it: the waterline is
 * wherever the sand drops below the sea surface, which is what makes the sea
 * meet the beach instead of ending at a straight edge.
 */
export const BEACH = {
  startX: PROMENADE_X,
  endX: 434,
  topY: 0.0,
  bottomY: SEA_LEVEL - 1.3,
};
/** Ground plane extends further so the horizon is never an empty void. */
export const GROUND_HALF = 2200;

// --------------------------------------------------------------- spawn points

/**
 * Player spawns on the open forecourt apron, north of the pump islands and
 * clear of the canopy, facing the gas station (ref 4).
 *
 * Verified clear: canopy deck spans z -60.5..-43.5, pump islands sit at
 * z = -48 and -56, the shop is at z = -77, and bollards run along z = -70.5.
 */
export const PLAYER_SPAWN = { x: 126, y: 0.2, z: -26, heading: Math.PI };
/** `heading` is a FACING direction, atan2(dirX, dirZ): 0 faces +Z. */
export const HERO_VEHICLE_SPAWN = { x: 145, y: 0.45, z: -26, heading: 0 };

// ------------------------------------------------------------------ landmarks

/** Water tower: the readable landmark visible from most of the map (ref 1). */
export const WATER_TOWER = { x: -168, z: 74, legHeight: 22, tankRadius: 7 };

// ------------------------------------------------------------------- lighting

/**
 * Late-morning tropical sun: high, slightly east, warm but not orange.
 * Azimuth measured clockwise from north; elevation above horizon.
 */
export const SUN = {
  azimuthDeg: 118,
  elevationDeg: 58,
  /** Direct sun colour and intensity (physically-ish; tuned against the refs). */
  color: '#fff3e0',
  intensity: 3.1,
  /** Sky/ambient fill so shadowed sides stay readable (spec 10). */
  skyColor: '#a8c8f0',
  groundColor: '#8a7f6a',
  ambientIntensity: 0.55,
};

/** Restrained distance haze (spec 10) - gives depth without milking the road. */
export const HAZE = {
  color: '#cfdcea',
  near: 90,
  far: 620,
};

// ----------------------------------------------------------------- materials

/**
 * Stucco / painted-block facade palette sampled from the reference frames:
 * sun-bleached pastels, warm neutrals, and a few saturated shopfronts.
 */
export const FACADE_COLORS = [
  '#d8d2c4', // bone
  '#c9b9a0', // sand
  '#b8c7c4', // pale teal-grey
  '#d6c0a8', // warm tan
  '#a9b6bd', // cool grey-blue
  '#c8a894', // terracotta wash
  '#dcd6cc', // off-white
  '#9fae9a', // sage
  '#cbbfae', // oatmeal
  '#b9a794', // clay
];

/** Saturated accents used sparingly on storefronts and awnings. */
export const ACCENT_COLORS = [
  '#c8503c', // faded red
  '#2f6f7e', // petrol blue
  '#d99a2b', // ochre
  '#3d7a4e', // palm green
  '#8e4a6b', // dusty magenta
];

export const ROOF_COLORS = ['#6f6a62', '#7d7469', '#5e5a55', '#857b6e'];
